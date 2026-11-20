use super::{event_archive, jolpica, repository::F1Repository};
use serde_json::{json, Value};
use std::{fs::{File, OpenOptions}, path::Path, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const EXPORT_TEXT_LIMIT: usize = 16 * 1024 * 1024;

fn write_export_bytes(path: &Path, extension: &str, content: &[u8]) -> Result<(), String> {
    use std::io::Write;
    if content.len() > EXPORT_TEXT_LIMIT || !path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) || !path.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case(extension)) { return Err("INVALID_EXPORT".into()); }
    // Atomic exclusive creation: never follow an existing final symlink or overwrite a file.
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| "EXPORT_CREATE_FAILED".to_string())?;
    if file.write_all(content).and_then(|_| file.sync_all()).is_err() {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err("EXPORT_WRITE_FAILED".into());
    }
    Ok(())
}

fn write_export(path: &Path, extension: &str, bytes: &[u8], manifest: Option<&str>) -> Result<(), String> {
    write_export_bytes(path, extension, bytes)?;
    if let Some(manifest) = manifest {
        if let Err(error) = write_export_bytes(&path.with_extension("manifest.json"), "json", manifest.as_bytes()) {
            let _ = std::fs::remove_file(path);
            return Err(error);
        }
    }
    Ok(())
}
#[cfg(test)]
fn write_export_text(path: &Path, extension: &str, content: &str) -> Result<(), String> { write_export_bytes(path, extension, content.as_bytes()) }

fn decode_export_image(kind: &str, content: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if content.len() > EXPORT_TEXT_LIMIT { return Err("INVALID_EXPORT".into()); }
    let bytes = STANDARD.decode(content.as_bytes()).map_err(|_| "INVALID_EXPORT".to_string())?;
    if bytes.len() > 8 * 1024 * 1024 || match kind {
        "png" => !bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "svg" => !std::str::from_utf8(&bytes).is_ok_and(|text| text.starts_with("<svg ") && text.ends_with("</svg>")),
        _ => true,
    } { return Err("INVALID_EXPORT".into()); }
    Ok(bytes)
}

/// The frontend never supplies a path; each artifact requires a native chooser.
#[tauri::command]
pub async fn f1_export_text(app: tauri::AppHandle, kind: String, content: String, manifest: Option<String>) -> Result<bool, String> {
    let (extension, name, filter, binary) = match kind.as_str() {
        "csv" => ("csv", "racing-data.csv", "CSV", false),
        "svg" => ("svg", "racing-data.svg", "SVG", true),
        "png" => ("png", "racing-data.png", "PNG", true),
        _ => return Err("INVALID_EXPORT".into()),
    };
    if content.len() > EXPORT_TEXT_LIMIT { return Err("INVALID_EXPORT".into()); }
    if let Some(manifest) = &manifest {
        if kind != "csv" || manifest.len() > EXPORT_TEXT_LIMIT || !serde_json::from_str::<Value>(manifest).is_ok_and(|doc| doc["format"] == "rds-table-export" && doc["version"] == 1) {
            return Err("INVALID_EXPORT".into());
        }
    }
    let bytes = if binary { decode_export_image(&kind, &content)? } else { content.into_bytes() };
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().set_file_name(name).add_filter(filter, &[extension]).blocking_save_file();
        match selected {
            None => Ok(false),
            Some(selected) => {
                let path = selected.into_path().map_err(|_| "INVALID_EXPORT".to_string())?;
                write_export(&path, extension, &bytes, manifest.as_deref())?;
                Ok(true)
            }
        }
    }).await.map_err(|_| "EXPORT_FAILED".to_string())?
}

#[cfg(test)]
mod export_text_tests {
    use super::*;
    #[test]
    fn exclusive_creation_refuses_overwrite_and_wrong_extension() {
        let base = std::env::temp_dir().join(format!("rds-export-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&base).unwrap();
        let path = base.join("synthetic.csv");
        write_export_text(&path, "csv", "test").unwrap();
        assert!(write_export_text(&path, "csv", "overwrite").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "test");
        assert!(write_export_text(&base.join("other.sqlite"), "csv", "test").is_err());
        assert!(write_export_text(Path::new("relative.csv"), "csv", "test").is_err());
        assert!(write_export_text(&base.join("../bad.csv"), "csv", "test").is_err());
        let image = base.join("synthetic.png");
        write_export_bytes(&image, "png", b"\x89PNG\r\n\x1a\nsynthetic").unwrap();
        assert_eq!(std::fs::read(&image).unwrap(), b"\x89PNG\r\n\x1a\nsynthetic");
        assert!(write_export_bytes(&base.join("wrong.jpeg"), "png", b"x").is_err());
        std::fs::remove_file(image).unwrap();
        #[cfg(unix)] {
            let link = base.join("link.csv");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(write_export_text(&link, "csv", "overwrite").is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "test");
            std::fs::remove_file(link).unwrap();
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(base).unwrap();
    }
    #[test]
    fn image_payload_checks_type_encoding_and_signatures() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let png = STANDARD.encode(b"\x89PNG\r\n\x1a\nsynthetic");
        assert!(decode_export_image("png", &png).is_ok());
        assert!(decode_export_image("jpeg", &png).is_err());
        assert!(decode_export_image("png", "not base64!").is_err());
        assert!(decode_export_image("jpeg", &STANDARD.encode(b"\xff\xd8\xffsynthetic\xff\xd9")).is_err());
        assert!(decode_export_image("svg", &STANDARD.encode(b"<svg xmlns=\"x\"></svg>")).is_ok());
        assert!(decode_export_image("csv", &png).is_err());
    }

    #[test]
    fn csv_with_manifest_keeps_the_existing_file_on_a_name_collision() {
        let base = tempfile::tempdir().unwrap();
        let csv = base.path().join("analysis.csv");
        let manifest = base.path().join("analysis.manifest.json");
        std::fs::write(&manifest, "original").unwrap();
        assert_eq!(write_export(&csv, "csv", b"header", Some("{}")), Err("EXPORT_CREATE_FAILED".into()));
        assert!(!csv.exists());
        assert_eq!(std::fs::read_to_string(&manifest).unwrap(), "original");
        std::fs::remove_file(&manifest).unwrap();
        write_export(&csv, "csv", b"header", Some("{}")).unwrap();
        assert_eq!(std::fs::read_to_string(&csv).unwrap(), "header");
        assert_eq!(std::fs::read_to_string(&manifest).unwrap(), "{}");
    }
}

#[derive(Default)]
pub struct SyncState {
    busy: AtomicBool,
    progress: Mutex<Value>,
}

struct Guard(Arc<SyncState>);
impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut progress) = self.0.progress.lock() { *progress = Value::Null; }
        self.0.busy.store(false, Ordering::Release);
    }
}
impl SyncState {
    pub fn reserve_reset(&self) -> Result<(), String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| "Não é possível restaurar enquanto uma sincronização está em andamento".into())
    }

    pub fn cancel_reset(&self) {
        self.busy.store(false, Ordering::Release);
    }

    fn begin(self: &Arc<Self>, year: u16) -> Result<Guard, String> {
        self.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).map_err(|_| "Another synchronization is already running")?;
        if let Ok(mut progress) = self.progress.lock() { *progress = json!({"year":year,"phase":"starting","offset":0}); }
        Ok(Guard(self.clone()))
    }
    fn set(&self, year: u16, phase: &str, offset: usize) {
        if let Ok(mut progress) = self.progress.lock() { *progress = json!({"year":year,"phase":phase,"offset":offset}); }
    }
}

// OS advisory lock remains held for the entire download and transaction, also
// across two app processes. Dropping the file (including on crash) releases it.
pub(crate) fn acquire_file_lock(data_dir: &Path) -> Result<File, String> {
    let parent = data_dir.parent().ok_or_else(|| "App data directory has no parent".to_string())?;
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(parent.join(".org.racingdatastudio.app.f1-sync.lock"))
        .map_err(|e| e.to_string())?;
    file.try_lock().map_err(|e| format!("Another synchronization may be running, or lock unavailable: {e}"))?;
    Ok(file)
}

#[tauri::command]
pub fn f1_sync_status(state: tauri::State<'_, Arc<SyncState>>) -> Result<Value, String> {
    state.progress.lock().map(|p| p.clone()).map_err(|_| "Progress unavailable".into())
}

#[tauri::command]
pub async fn f1_sync(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, year: u16) -> Result<(), String> {
    if !(1950..=2100).contains(&year) { return Err("Invalid season".into()); }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let guard = state.inner().begin(year)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _file_lock = acquire_file_lock(&data_dir)?;
        let pages = jolpica::download(year, |phase, offset| _guard.0.set(year, phase, offset))?;
        _guard.0.set(year, "saving", 0);
        let mut repo = F1Repository::open(&data_dir).map_err(|e| e.to_string())?;
        repo.save(year, &pages).map_err(|e| e.to_string())
    }).await.map_err(|e| format!("Synchronization worker failed: {e}"))?
}

#[tauri::command]
pub async fn f1_local_seasons(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).and_then(|r| r.list()).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_analysis_snapshots(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).and_then(|mut r| r.analysis_snapshots()).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_analysis_catalog(app: tauri::AppHandle, revisions: Option<Vec<super::saved_analysis::Revision>>) -> Result<Vec<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).and_then(|mut r| r.analysis_catalog(revisions)).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_analysis_pinned(app: tauri::AppHandle, revisions: Vec<super::saved_analysis::Revision>) -> Result<Vec<Value>, String> {
    if revisions.is_empty() || revisions.len() > 151 { return Err("INVALID_CONTRACT".into()); }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).and_then(|mut r| r.analysis_snapshots_for(Some(revisions))).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_analyses_list(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.saved_list()).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_analysis_load(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.saved_load(&id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_analysis_save(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, document: Value, expected_revision: Option<String>) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let guard = state.inner().begin(1950)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|e| e.to_string())?.saved_save(document, expected_revision)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_analysis_delete(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, id: String, expected_revision: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|_| "DATABASE_ERROR".to_string())?;
    let guard = state.inner().begin(1950)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|_| "DATABASE_ERROR".to_string())?.saved_delete(&id, &expected_revision)
    }).await.map_err(|_| "DATABASE_ERROR".to_string())?
}

#[tauri::command]
pub async fn f1_models_list(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.models_list()).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_model_load(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.model_load(&id)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_model_save(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, document: Value, expected_revision: Option<String>) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let guard = state.inner().begin(1950)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|e| e.to_string())?.model_save(document, expected_revision)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_model_delete(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, id: String, expected_revision: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let guard = state.inner().begin(1950)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|e| e.to_string())?.model_delete(&id, &expected_revision)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_models_restore_defaults(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>) -> Result<usize, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let guard = state.inner().begin(1950)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|e| e.to_string())?.models_restore_defaults()
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_models_v3_list(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.models_v3_list()).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_model_v3_load(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.model_v3_load(&id)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_model_v3_save(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, document: Value, expected_revision: Option<String>) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let guard = state.inner().begin(1950)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|e| e.to_string())?.model_v3_save(document, expected_revision)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_model_v3_delete(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, id: String, expected_revision: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let guard = state.inner().begin(1950)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|e| e.to_string())?.model_v3_delete(&id, &expected_revision)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_season_details(app: tauri::AppHandle, year: u16) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).and_then(|r| r.details(year)).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_remote_seasons() -> Result<Vec<u16>, String> {
    tauri::async_runtime::spawn_blocking(jolpica::seasons).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_snapshots(app: tauri::AppHandle, year: u16) -> Result<Vec<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).and_then(|r| r.snapshots(year)).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_backup_database(app: tauri::AppHandle, restore: bool) -> Result<bool, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let selection = if restore {
            dialog.add_filter("Racing Data Studio", &["zip", "sqlite"]).blocking_pick_file()
        } else {
            dialog.add_filter("ZIP", &["zip"])
                .set_file_name(super::backup::file_name(chrono::Local::now().naive_local()))
                .blocking_save_file()
        };
        let Some(selection) = selection else { return Ok(false); };
        let mut path = selection.into_path().map_err(|_| "BACKUP_INVALID_PATH".to_string())?;
        if !restore && path.extension().is_none() {
            path.set_extension("zip");
        }
        super::backup::validate_path(&data_dir, &path, restore).map_err(|e| e.to_string())?;
        let _lock = acquire_file_lock(&data_dir)?;
        let mut repository = F1Repository::open(&data_dir).map_err(|e| e.to_string())?;
        if restore { repository.restore_backup(&path) }
        else { repository.export_backup(&path) }.map_err(|e| e.to_string())?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_snapshot_rename(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, year: i32, snapshot_id: i64, name: String) -> Result<(), String> {
    if !(1950..=2100).contains(&year) || snapshot_id <= 0 { return Err("INVALID_SNAPSHOT".into()); }
    let dir = app.path().app_data_dir().map_err(|_| "DATABASE_ERROR".to_string())?;
    let guard = state.inner().begin(year as u16)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|_| "DATABASE_ERROR".to_string())?.rename_snapshot(year, snapshot_id, &name)
    }).await.map_err(|_| "DATABASE_ERROR".to_string())?
}

#[tauri::command]
pub async fn f1_snapshot_activate(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, year: i32, snapshot_id: i64) -> Result<(), String> {
    if !(1950..=2100).contains(&year) || snapshot_id <= 0 { return Err("INVALID_SNAPSHOT".into()); }
    let dir = app.path().app_data_dir().map_err(|_| "DATABASE_ERROR".to_string())?;
    let guard = state.inner().begin(year as u16)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|_| "DATABASE_ERROR".to_string())?.activate_snapshot(year, snapshot_id)
    }).await.map_err(|_| "DATABASE_ERROR".to_string())?
}

#[tauri::command]
pub async fn f1_snapshot_dependents(app: tauri::AppHandle, year: i32, snapshot_id: i64) -> Result<Vec<super::saved_analysis::SnapshotDependent>, String> {
    let dir = app.path().app_data_dir().map_err(|_| "DATABASE_ERROR".to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|_| "DATABASE_ERROR".to_string())?.snapshot_dependents(year, snapshot_id))
        .await.map_err(|_| "DATABASE_ERROR".to_string())?
}

#[tauri::command]
pub async fn f1_snapshot_delete(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, year: i32, snapshot_id: i64, confirmed: Vec<super::saved_analysis::SnapshotDependent>) -> Result<(), String> {
    if !(1950..=2100).contains(&year) || snapshot_id <= 0 { return Err("INVALID_SNAPSHOT".into()); }
    let dir = app.path().app_data_dir().map_err(|_| "DATABASE_ERROR".to_string())?;
    let guard = state.inner().begin(year as u16)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        F1Repository::open(&dir).map_err(|_| "DATABASE_ERROR".to_string())?.delete_snapshot(year, snapshot_id, &confirmed)
    }).await.map_err(|_| "DATABASE_ERROR".to_string())?
}

#[tauri::command]
pub async fn f1_restore_snapshot(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, year: u16, id: i64) -> Result<(), String> {
    if !(1950..=2100).contains(&year) || id <= 0 { return Err("Invalid season or snapshot".into()); }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let guard = state.inner().begin(year)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        _guard.0.set(year, "saving", 0);
        F1Repository::open(&dir).and_then(|mut repo| repo.restore(year, id)).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn f1_copy_snapshot_events(app: tauri::AppHandle, state: tauri::State<'_, Arc<SyncState>>, year: u16, id: i64) -> Result<usize, String> {
    if !(1950..=2100).contains(&year) || id <= 0 { return Err("Invalid season or snapshot".into()); }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let guard = state.inner().begin(year)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _lock = acquire_file_lock(&dir)?;
        _guard.0.set(year, "saving", 0);
        let mut repo = F1Repository::open(&dir).map_err(|e| e.to_string())?;
        let events = repo.event_archives(year, id).map_err(|e| e.to_string())?;
        event_archive::write_copies(&dir, &events).map_err(|e| format!("Event copies may be partially published; SQLite is unchanged. {e}"))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_one_import_and_guard_releases_after_failure() {
        let state = Arc::new(SyncState::default());
        let guard = state.begin(2024).unwrap();
        assert!(state.begin(2025).is_err());
        assert_eq!(state.progress.lock().unwrap()["year"], 2024);
        drop(guard);
        assert!(state.progress.lock().unwrap().is_null());
        assert!(state.begin(2025).is_ok());
    }
    #[test]
    fn concurrent_attempt_is_rejected() {
        let state = Arc::new(SyncState::default());
        let guard = state.begin(2024).unwrap();
        let other = state.clone();
        assert!(std::thread::spawn(move || other.begin(2025).is_err()).join().unwrap());
        drop(guard);
        assert!(state.begin(2025).is_ok());
    }
    #[test]
    fn reset_reservation_rejects_active_sync_and_blocks_new_work() {
        let state = Arc::new(SyncState::default());
        let guard = state.begin(2024).unwrap();
        assert!(state.reserve_reset().is_err());
        drop(guard);
        state.reserve_reset().unwrap();
        assert!(state.begin(2025).is_err());
        state.cancel_reset();
        assert!(state.begin(2025).is_ok());
    }
    #[test]
    fn file_lock_rejects_a_second_open_until_released() {
        let base = std::env::temp_dir().join(format!("rds-lock-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&base).unwrap();
        let dir = base.join("org.racingdatastudio.app");
        let first = acquire_file_lock(&dir).unwrap();
        assert!(acquire_file_lock(&dir).is_err());
        drop(first);
        assert!(acquire_file_lock(&dir).is_ok());
        std::fs::remove_file(base.join(".org.racingdatastudio.app.f1-sync.lock")).unwrap();
        std::fs::remove_dir(base).unwrap();
    }
}
