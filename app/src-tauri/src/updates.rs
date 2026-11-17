//! Only these application commands expose the updater. Plugin IPC permissions
//! are intentionally NOT granted: endpoints, target, key and paths are native.
use serde::Serialize;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

const FEED_ROOT: &str = "https://raw.githubusercontent.com/GustavoCarisRezende/racing-data-studio/updates";
const ASSET_ROOT: &str = "/GustavoCarisRezende/racing-data-studio/releases/download/";
const DOWNLOAD_LIMIT: usize = 512 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    phase: String,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    error: Option<String>,
}

struct Inner {
    status: Status,
    update: Option<Update>,
    bytes: Option<Arc<Vec<u8>>>,
    checked_at: Option<Instant>,
}

pub struct UpdateState {
    busy: AtomicBool,
    inner: Mutex<Inner>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            busy: AtomicBool::new(false),
            inner: Mutex::new(Inner {
                status: Status {
                    enabled: false, phase: "disabled".into(),
                    current_version: env!("CARGO_PKG_VERSION").into(),
                    version: None, notes: None, downloaded: 0, total: None, error: None,
                },
                update: None, bytes: None, checked_at: None,
            }),
        }
    }
}

struct Operation(Arc<UpdateState>);
impl Drop for Operation {
    fn drop(&mut self) { self.0.busy.store(false, Ordering::Release); }
}

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("UPDATE_WINDOW_DENIED".into()) }
}

fn configured(app: &tauri::AppHandle) -> bool {
    app.config().plugins.0.get("updater")
        .and_then(|v| v.get("pubkey")).and_then(|v| v.as_str())
        .is_some_and(|key| !key.trim().is_empty())
}

fn channel(version: &str) -> &'static str {
    if version.contains("-beta.") { "beta" } else { "stable" }
}

fn valid_asset(url: &str, version: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else { return false; };
    url.scheme() == "https" && url.host_str() == Some("github.com")
        && url.username().is_empty() && url.password().is_none()
        && url.port().is_none() && url.query().is_none() && url.fragment().is_none()
        && url.path().starts_with(&format!("{ASSET_ROOT}v{version}/"))
}

fn read_package(mut reader: impl std::io::Read, limit: usize, mut progress: impl FnMut(usize)) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let size = reader.read(&mut buffer).map_err(|_| "UPDATE_DOWNLOAD_FAILED")?;
        if size == 0 { return Ok(bytes); }
        if size > limit.saturating_sub(bytes.len()) { return Err("UPDATE_TOO_LARGE".into()); }
        bytes.extend_from_slice(&buffer[..size]);
        progress(size);
    }
}

impl UpdateState {
    fn begin(self: &Arc<Self>) -> Result<Operation, String> {
        self.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "UPDATE_BUSY".to_string())?;
        Ok(Operation(self.clone()))
    }
    fn change(&self, f: impl FnOnce(&mut Inner)) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "UPDATE_STATE_UNAVAILABLE")?;
        f(&mut inner);
        Ok(())
    }
    fn snapshot(&self) -> Result<Status, String> {
        self.inner.lock().map(|i| i.status.clone()).map_err(|_| "UPDATE_STATE_UNAVAILABLE".into())
    }
    fn failed(&self, code: &str) -> Result<Status, String> {
        self.change(|i| { i.status.phase = "error".into(); i.status.error = Some(code.into()); })?;
        self.snapshot()
    }
}

#[tauri::command]
pub fn update_status(app: tauri::AppHandle, window: WebviewWindow, state: tauri::State<'_, Arc<UpdateState>>) -> Result<Status, String> {
    main_window(&window)?;
    // Native installation detection prevents an MSI from silently becoming NSIS,
    // and prevents replacing a raw development ELF as if it were an AppImage.
    let supported = supported_installation();
    state.change(|i| {
        i.status.enabled = configured(&app) && supported;
        if i.status.phase == "disabled" && i.status.enabled { i.status.phase = "idle".into(); }
    })?;
    state.snapshot()
}

fn supported_installation() -> bool {
    if cfg!(debug_assertions) || !cfg!(target_arch = "x86_64") { return false; }
    #[cfg(target_os = "linux")]
    { return std::env::var_os("APPIMAGE").is_some(); }
    #[cfg(target_os = "windows")]
    { return matches!(tauri::utils::platform::bundle_type(), Some(tauri::utils::config::BundleType::Nsis)); }
    #[allow(unreachable_code)]
    false
}

#[tauri::command]
pub async fn update_check(app: tauri::AppHandle, window: WebviewWindow, state: tauri::State<'_, Arc<UpdateState>>) -> Result<Status, String> {
    main_window(&window)?;
    if !configured(&app) || !supported_installation() { return state.snapshot(); }
    let _operation = state.inner().begin()?;
    {
        let inner = state.inner.lock().map_err(|_| "UPDATE_STATE_UNAVAILABLE")?;
        // Applies to manual checks too. Prevent polling GitHub on repeated clicks.
        if inner.checked_at.is_some_and(|t| t.elapsed() < Duration::from_secs(60)) {
            return Ok(inner.status.clone());
        }
        if inner.bytes.is_some() { return Ok(inner.status.clone()); }
    }
    state.change(|i| {
        i.checked_at = Some(Instant::now());
        i.status.enabled = true;
        i.status.phase = "checking".into(); i.status.error = None;
    })?;
    let endpoint = format!("{FEED_ROOT}/{}.json", channel(env!("CARGO_PKG_VERSION")));
    let builder = app.updater_builder()
        .timeout(Duration::from_secs(15))
        .configure_client(|client| client.https_only(true)
            .connect_timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::limited(5)))
        .version_comparator(|current, release| release.version > current
            && (release.version.pre.is_empty() || release.version.pre.as_str().starts_with("beta."))
            && (!current.pre.is_empty() || release.version.pre.is_empty()));
    let updater = match builder.endpoints(vec![endpoint.parse().map_err(|_| "UPDATE_CONFIG")?])
        .and_then(|b| b.build()) {
        Ok(updater) => updater,
        Err(_) => return state.failed("UPDATE_CONFIG"),
    };
    match updater.check().await {
        Ok(Some(mut update)) => {
            if !valid_asset(update.download_url.as_str(), &update.version) {
                return state.failed("UPDATE_SOURCE_DENIED");
            }
            update.timeout = Some(Duration::from_secs(180));
            state.change(|i| {
                i.status.phase = "available".into(); i.status.version = Some(update.version.clone());
                i.status.notes = update.body.clone(); i.status.downloaded = 0;
                i.status.total = None; i.status.error = None;
                i.update = Some(update); i.bytes = None;
            })?;
        }
        Ok(None) => state.change(|i| {
            i.status.phase = "current".into(); i.status.version = None; i.status.notes = None;
            i.update = None; i.bytes = None;
        })?,
        Err(_) => return state.failed("UPDATE_CHECK_FAILED"),
    }
    state.snapshot()
}

#[tauri::command]
pub async fn update_download(window: WebviewWindow, state: tauri::State<'_, Arc<UpdateState>>) -> Result<Status, String> {
    main_window(&window)?;
    let _operation = state.inner().begin()?;
    let update = state.inner.lock().map_err(|_| "UPDATE_STATE_UNAVAILABLE")?
        .update.clone().ok_or("UPDATE_NOT_AVAILABLE")?;
    state.change(|i| {
        i.status.phase = "downloading".into(); i.status.error = None;
        i.status.downloaded = 0; i.status.total = None; i.bytes = None;
    })?;
    let progress = state.inner().clone();
    // Bounded streaming download; the same plugin verifier also runs on install.
    let downloaded = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let client = reqwest::blocking::Client::builder()
            .https_only(true).timeout(Duration::from_secs(180))
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent("RacingDataStudio-Updater")
            .build().map_err(|_| "UPDATE_DOWNLOAD_FAILED")?;
        let response = client.get(update.download_url.clone()).send()
            .and_then(|r| r.error_for_status()).map_err(|_| "UPDATE_DOWNLOAD_FAILED")?;
        let total = response.content_length();
        if total.is_some_and(|n| n > DOWNLOAD_LIMIT as u64) { return Err("UPDATE_TOO_LARGE".into()); }
        let bytes = read_package(response, DOWNLOAD_LIMIT, |size| {
            let _ = progress.change(|i| {
                i.status.downloaded = i.status.downloaded.saturating_add(size as u64);
                i.status.total = total;
            });
        })?;
        update.verify(&bytes).map_err(|_| "UPDATE_SIGNATURE_INVALID")?;
        Ok(bytes)
    }).await.map_err(|_| "UPDATE_DOWNLOAD_FAILED".to_string())?;
    match downloaded {
        Ok(bytes) => state.change(|i| {
            i.bytes = Some(Arc::new(bytes)); i.status.phase = "ready".into();
        })?,
        Err(code) => return state.failed(&code),
    }
    state.snapshot()
}

#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, window: WebviewWindow, state: tauri::State<'_, Arc<UpdateState>>, sync: tauri::State<'_, Arc<crate::f1::commands::SyncState>>, confirmed: bool) -> Result<(), String> {
    main_window(&window)?;
    if !confirmed { return Err("UPDATE_CONFIRMATION_REQUIRED".into()); }
    let operation = state.inner().begin()?;
    // Shares the native synchronization/reset gate; a status poll alone would race.
    sync.reserve_reset().map_err(|_| "UPDATE_SYNC_BUSY".to_string())?;
    let sync = sync.inner().clone();
    struct Maintenance(Arc<crate::f1::commands::SyncState>);
    impl Drop for Maintenance { fn drop(&mut self) { self.0.cancel_reset(); } }
    let maintenance = Maintenance(sync);
    let (update, bytes) = {
        let inner = state.inner.lock().map_err(|_| "UPDATE_STATE_UNAVAILABLE")?;
        (inner.update.clone().ok_or("UPDATE_NOT_AVAILABLE")?, inner.bytes.clone().ok_or("UPDATE_NOT_DOWNLOADED")?)
    };
    let data_dir = app.path().app_data_dir().map_err(|_| "UPDATE_DATA_PATH")?;
    let file_lock = crate::f1::commands::acquire_file_lock(&data_dir).map_err(|_| "UPDATE_SYNC_BUSY".to_string())?;
    state.change(|i| { i.status.phase = "installing".into(); i.status.error = None; })?;
    let update_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (_operation, _maintenance, _file_lock) = (operation, maintenance, file_lock);
        // Windows exits here only after the user confirmed; Linux returns.
        if update.install(bytes.as_slice()).is_err() {
            let _ = update_state.failed("UPDATE_INSTALL_FAILED");
            return Err("UPDATE_INSTALL_FAILED".into());
        }
        app.restart();
    }).await.map_err(|_| "UPDATE_INSTALL_FAILED".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_channels_and_assets() {
        assert_eq!(channel("0.0.1-beta.2"), "beta");
        assert_eq!(channel("0.0.1"), "stable");
        assert!(valid_asset("https://github.com/GustavoCarisRezende/racing-data-studio/releases/download/v0.0.1/a.AppImage", "0.0.1"));
        for url in [
            "http://github.com/GustavoCarisRezende/racing-data-studio/releases/download/v0.0.1/a",
            "https://evil.test/GustavoCarisRezende/racing-data-studio/releases/download/v0.0.1/a",
            "https://github.com/other/repo/releases/download/v0.0.1/a",
            "https://github.com/GustavoCarisRezende/racing-data-studio/releases/download/v0.0.2/a",
        ] { assert!(!valid_asset(url, "0.0.1")); }
    }
    #[test]
    fn operations_are_exclusive_and_release_on_drop() {
        let state = Arc::new(UpdateState::default());
        let guard = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(guard);
        assert!(state.begin().is_ok());
    }
    #[test]
    fn streamed_body_is_bounded_even_without_content_length() {
        let mut count = 0;
        assert_eq!(read_package(&b"test"[..], 4, |size| count += size).unwrap(), b"test");
        assert_eq!(count, 4);
        assert!(read_package(&b"oversized"[..], 4, |_| {}).is_err());
    }
}
