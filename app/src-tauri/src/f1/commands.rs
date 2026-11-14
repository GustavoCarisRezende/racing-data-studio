use super::{event_archive, jolpica, repository::F1Repository};
use serde_json::{json, Value};
use std::{fs::{self, File, OpenOptions}, path::Path, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}};
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
    file.write_all(content).and_then(|_| file.sync_all()).map_err(|_| "EXPORT_WRITE_FAILED".to_string())
}
#[cfg(test)]
fn write_export_text(path: &Path, extension: &str, content: &str) -> Result<(), String> { write_export_bytes(path, extension, content.as_bytes()) }

fn decode_export_image(kind: &str, content: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if content.len() > EXPORT_TEXT_LIMIT { return Err("INVALID_EXPORT".into()); }
    let bytes = STANDARD.decode(content.as_bytes()).map_err(|_| "INVALID_EXPORT".to_string())?;
    if bytes.len() > 8 * 1024 * 1024 || match kind {
        "png" => !bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpeg" => !bytes.starts_with(b"\xff\xd8\xff") || !bytes.ends_with(b"\xff\xd9"),
        "svg" => !std::str::from_utf8(&bytes).is_ok_and(|text| text.starts_with("<svg ") && text.ends_with("</svg>")),
        _ => true,
    } { return Err("INVALID_EXPORT".into()); }
    Ok(bytes)
}

/// The frontend never supplies a path; each artifact requires a native chooser.
#[tauri::command]
pub async fn f1_export_text(app: tauri::AppHandle, kind: String, content: String) -> Result<bool, String> {
    let (extension, name, filter, binary) = match kind.as_str() {
        "csv" => ("csv", "racing-data.csv", "CSV", false),
        "manifest" => ("json", "racing-data.manifest.json", "JSON", false),
        "svg" => ("svg", "racing-data.svg", "SVG", true),
        "png" => ("png", "racing-data.png", "PNG", true),
        "jpeg" => ("jpeg", "racing-data.jpeg", "JPEG", true),
        _ => return Err("INVALID_EXPORT".into()),
    };
    if content.len() > EXPORT_TEXT_LIMIT { return Err("INVALID_EXPORT".into()); }
    let bytes = if binary { decode_export_image(&kind, &content)? } else { content.into_bytes() };
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().set_file_name(name).add_filter(filter, &[extension]).blocking_save_file();
        match selected {
            None => Ok(false),
            Some(selected) => {
                let path = selected.into_path().map_err(|_| "INVALID_EXPORT".to_string())?;
                write_export_bytes(&path, extension, &bytes)?;
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
        assert!(decode_export_image("jpeg", &STANDARD.encode(b"\xff\xd8\xffsynthetic\xff\xd9")).is_ok());
        assert!(decode_export_image("svg", &STANDARD.encode(b"<svg xmlns=\"x\"></svg>")).is_ok());
        assert!(decode_export_image("csv", &png).is_err());
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
fn acquire_file_lock(data_dir: &Path) -> Result<File, String> {
    let dir = data_dir.join("categories");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = OpenOptions::new().write(true).create(true).truncate(false).open(dir.join("f1-sync.lock")).map_err(|e| e.to_string())?;
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
pub async fn f1_analysis_save(app: tauri::AppHandle, document: Value, expected_revision: Option<String>) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.saved_save(document, expected_revision)).await.map_err(|e| e.to_string())?
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
pub async fn f1_model_save(app: tauri::AppHandle, document: Value, expected_revision: Option<String>) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.model_save(document, expected_revision)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_model_delete(app: tauri::AppHandle, id: String, expected_revision: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.model_delete(&id, &expected_revision)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_models_restore_defaults(app: tauri::AppHandle) -> Result<usize, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.models_restore_defaults()).await.map_err(|e| e.to_string())?
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
pub async fn f1_model_v3_save(app: tauri::AppHandle, document: Value, expected_revision: Option<String>) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.model_v3_save(document, expected_revision)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn f1_model_v3_delete(app: tauri::AppHandle, id: String, expected_revision: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || F1Repository::open(&dir).map_err(|e| e.to_string())?.model_v3_delete(&id, &expected_revision)).await.map_err(|e| e.to_string())?
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
    fn file_lock_rejects_a_second_open_until_released() {
        let dir = std::env::temp_dir().join(format!("rds-lock-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let first = acquire_file_lock(&dir).unwrap();
        assert!(acquire_file_lock(&dir).is_err());
        drop(first);
        assert!(acquire_file_lock(&dir).is_ok());
        std::fs::remove_file(dir.join("categories/f1-sync.lock")).unwrap();
        std::fs::remove_dir(dir.join("categories")).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
