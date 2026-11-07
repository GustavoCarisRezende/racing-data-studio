//! Non-authoritative, append-only event projections. SQLite remains the source
//! for browsing and restoration. Paths never include source-provided names.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;

pub struct EventArchive {
    pub year: u16,
    pub round: u16,
    pub snapshot_id: i64,
    pub payload: Value,
}

fn encoded(event: &EventArchive) -> Result<Vec<u8>, String> {
    if !(1950..=2100).contains(&event.year) || event.round == 0 || event.snapshot_id <= 0 {
        return Err("Invalid event identity".into());
    }
    if event.payload["season"].as_u64() != Some(event.year as u64)
        || event.payload["round"].as_u64() != Some(event.round as u64)
        || event.payload["snapshot_id"].as_i64() != Some(event.snapshot_id) {
        return Err("Event identity mismatch".into());
    }
    let payload = serde_json::to_vec(&event.payload).map_err(|e| e.to_string())?;
    let checksum = format!("{:x}", Sha256::digest(&payload));
    serde_json::to_vec(&serde_json::json!({"format":"rds-f1-event-copy-v1", "sha256":checksum, "payload":event.payload})).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use rustix::{fs::{fsync, mkdirat, openat, renameat_with, Mode, OFlags, RenameFlags}, io::Errno};
    use std::{fs::File, io::{Read, Seek, SeekFrom, Write}};

    fn checked_dir(parent: &File, name: &str) -> Result<File, String> {
        match mkdirat(parent, name, Mode::from_raw_mode(0o700)) {
            Ok(()) => {},
            Err(Errno::EXIST) => {},
            Err(e) => return Err(format!("Cannot create directory {name}: {e}")),
        }
        // Also sync on retries: the directory may have been created by an interrupted run.
        fsync(parent).map_err(|e| e.to_string())?;
        let fd = openat(parent, name, OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC, Mode::empty())
            .map_err(|e| format!("Unsafe or inaccessible directory {name}: {e}"))?;
        Ok(File::from(fd))
    }

    fn read_checked(dir: &File, name: &str, expected: &[u8]) -> Result<bool, String> {
        let fd = match openat(dir, name, OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK, Mode::empty()) {
            Ok(fd) => fd,
            Err(Errno::NOENT) => return Ok(false),
            Err(e) => return Err(format!("Unsafe or inaccessible file {name}: {e}")),
        };
        let mut file = File::from(fd);
        if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err(format!("Not a regular file: {name}")); }
        let mut actual = Vec::new();
        (&mut file).take(expected.len() as u64 + 1).read_to_end(&mut actual).map_err(|e| e.to_string())?;
        if actual != expected { return Err(format!("Existing file differs from source; not overwritten: {name}")); }
        let value: Value = serde_json::from_slice(&actual).map_err(|e| e.to_string())?;
        let payload = serde_json::to_vec(value.get("payload").ok_or("Missing payload")?).map_err(|e| e.to_string())?;
        if value["format"].as_str() != Some("rds-f1-event-copy-v1") || value["sha256"].as_str() != Some(&format!("{:x}", Sha256::digest(&payload))) {
            return Err(format!("Invalid checksum: {name}"));
        }
        file.sync_all().map_err(|e| format!("File sync failed: {e}"))?;
        Ok(true)
    }

    pub(super) fn write_all(root: &Path, events: &[EventArchive]) -> Result<usize, String> {
        let root = File::open(root).map_err(|e| format!("Cannot open app data directory: {e}"))?;
        if !root.metadata().map_err(|e| e.to_string())?.is_dir() { return Err("Invalid app data directory".into()); }
        let categories = checked_dir(&root, "categories")?;
        let f1 = checked_dir(&categories, "f1")?;
        let event_root = checked_dir(&f1, "events")?;
        let mut count = 0;
        for event in events {
            let bytes = encoded(event)?;
            let dir = checked_dir(&event_root, &format!("{}-{}", event.year, event.round))?;
            let final_name = format!("snapshot-{}.json", event.snapshot_id);
            let stage_name = format!(".snapshot-{}.staging", event.snapshot_id);
            if read_checked(&dir, &final_name, &bytes)? {
                fsync(&dir).map_err(|e| format!("Directory sync failed: {e}"))?;
                count += 1; continue;
            }
            let fd = match openat(&dir, stage_name.as_str(), OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC, Mode::from_raw_mode(0o600)) {
                Ok(fd) => Some(fd),
                Err(Errno::EXIST) => None,
                Err(e) => return Err(format!("Cannot create staging file: {e}")),
            };
            if let Some(fd) = fd {
                let mut file = File::from(fd);
                file.write_all(&bytes).map_err(|e| format!("Staging write failed: {e}"))?;
                file.sync_all().map_err(|e| format!("Staging sync failed: {e}"))?;
                file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
                let mut written = Vec::new();
                file.read_to_end(&mut written).map_err(|e| e.to_string())?;
                if written != bytes { return Err("Staging verification failed".into()); }
            }
            if !read_checked(&dir, &stage_name, &bytes)? { return Err("Staging file disappeared".into()); }
            // Resume only a byte-for-byte verified staging file after interruption.
            let stage = openat(&dir, stage_name.as_str(), OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK, Mode::empty()).map_err(|e| e.to_string())?;
            let stage_file = File::from(stage);
            if !stage_file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("Staging path is not a regular file".into()); }
            fsync(&stage_file).map_err(|e| e.to_string())?;
            match renameat_with(&dir, stage_name.as_str(), &dir, final_name.as_str(), RenameFlags::NOREPLACE) {
                Ok(()) => {},
                Err(Errno::EXIST) if read_checked(&dir, &final_name, &bytes)? => {},
                Err(e) => return Err(format!("Atomic publication failed: {e}")),
            }
            fsync(&dir).map_err(|e| format!("Directory sync failed: {e}"))?;
            if !read_checked(&dir, &final_name, &bytes)? { return Err("Published file disappeared".into()); }
            count += 1;
        }
        Ok(count)
    }
}

pub fn write_copies(root: &Path, events: &[EventArchive]) -> Result<usize, String> {
    // Check every identity and encode before touching the filesystem.
    if events.is_empty() { return Err("No events in snapshot".into()); }
    for event in events { encoded(event)?; }
    #[cfg(target_os = "linux")]
    { platform::write_all(root, events) }
    #[cfg(not(target_os = "linux"))]
    { let _ = root; Err("Event copies are currently supported only on Linux".into()) }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::symlink};

    fn temp_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("rds-events-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&root).unwrap();
        root
    }
    fn event(round: u16) -> EventArchive {
        EventArchive { year: 2024, round, snapshot_id: 9, payload: serde_json::json!({"season":2024,"round":round,"snapshot_id":9,"calendar":{"raceName":"Synthetic"},"race_fragments":[],"sprint_fragments":[]}) }
    }
    #[test]
    fn publishes_verified_files_idempotently_without_overwriting() {
        let root = temp_root();
        assert_eq!(write_copies(&root, &[event(1), event(2)]).unwrap(), 2);
        assert_eq!(write_copies(&root, &[event(1), event(2)]).unwrap(), 2);
        let path = root.join("categories/f1/events/2024-1/snapshot-9.json");
        let original = fs::read(&path).unwrap();
        let wrapper: Value = serde_json::from_slice(&original).unwrap();
        assert_eq!(wrapper["sha256"].as_str().unwrap().len(), 64);
        fs::write(&path, b"foreign content").unwrap();
        assert!(write_copies(&root, &[event(1)]).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"foreign content");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn resumes_matching_stage_but_never_replaces_mismatched_stage() {
        let root = temp_root();
        let dir = root.join("categories/f1/events/2024-1");
        fs::create_dir_all(&dir).unwrap();
        let stage = dir.join(".snapshot-9.staging");
        fs::write(&stage, b"partial").unwrap();
        assert!(write_copies(&root, &[event(1)]).is_err());
        assert_eq!(fs::read(&stage).unwrap(), b"partial");
        assert!(!dir.join("snapshot-9.json").exists());
        // This is a test-owned file; simulate the exact bytes of a completed write.
        fs::write(&stage, encoded(&event(1)).unwrap()).unwrap();
        assert_eq!(write_copies(&root, &[event(1)]).unwrap(), 1);
        assert!(dir.join("snapshot-9.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_symlinks_and_invalid_identities() {
        let root = temp_root();
        let outside = temp_root();
        fs::create_dir_all(root.join("categories/f1")).unwrap();
        symlink(&outside, root.join("categories/f1/events")).unwrap();
        assert!(write_copies(&root, &[event(1)]).is_err());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        assert!(write_copies(&root, &[event(0)]).is_err());
        let mut wrong = event(1); wrong.payload["round"] = 2.into();
        assert!(write_copies(&root, &[wrong]).is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
    #[test]
    fn rejects_final_and_staging_symlinks() {
        let root = temp_root(); let outside = temp_root();
        let dir = root.join("categories/f1/events/2024-1"); fs::create_dir_all(&dir).unwrap();
        let target = outside.join("sentinel"); fs::write(&target, b"safe").unwrap();
        symlink(&target, dir.join("snapshot-9.json")).unwrap();
        assert!(write_copies(&root, &[event(1)]).is_err());
        fs::remove_file(dir.join("snapshot-9.json")).unwrap();
        symlink(&target, dir.join(".snapshot-9.staging")).unwrap();
        assert!(write_copies(&root, &[event(1)]).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"safe");
        fs::remove_dir_all(root).unwrap(); fs::remove_dir_all(outside).unwrap();
    }
    #[test]
    fn partial_publication_keeps_both_existing_and_new_files() {
        let root = temp_root();
        let second = root.join("categories/f1/events/2024-2"); fs::create_dir_all(&second).unwrap();
        let collision = second.join("snapshot-9.json"); fs::write(&collision, b"do not overwrite").unwrap();
        assert!(write_copies(&root, &[event(1), event(2)]).is_err());
        assert_eq!(fs::read(&collision).unwrap(), b"do not overwrite");
        assert_eq!(fs::read(root.join("categories/f1/events/2024-1/snapshot-9.json")).unwrap(), encoded(&event(1)).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn untrusted_event_names_do_not_change_paths() {
        let root = temp_root();
        let mut item = event(3);
        item.payload["calendar"]["raceName"] = "../../outside".into();
        assert_eq!(write_copies(&root, &[item]).unwrap(), 1);
        assert!(root.join("categories/f1/events/2024-3/snapshot-9.json").is_file());
        assert!(!root.join("outside").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
