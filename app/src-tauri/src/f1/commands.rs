use super::{event_archive, jolpica, repository::F1Repository};
use serde_json::{json, Value};
use std::{fs::{self, File, OpenOptions}, path::Path, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}};
use tauri::Manager;

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
