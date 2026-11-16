use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use tauri::Manager;

const APP_ID: &str = "org.racingdatastudio.app";
const MARKER_NAME: &str = ".org.racingdatastudio.app.reset-pending";
const MARKER_CONTENT: &[u8] = b"racing-data-studio-reset-v1\n";
const MARKER_MAX_BYTES: u64 = 64;
const RESTART_FALLBACK_ENV: &str = "RACING_DATA_STUDIO_RESET_RESTART";

/// Development-only handoff to the replacement process. The handoff flag is
/// consumed before startup continues, so ordinary restarts keep using Vite HMR.
#[cfg(debug_assertions)]
pub fn take_restart_fallback_request() -> bool {
    let requested = std::env::var_os(RESTART_FALLBACK_ENV).is_some_and(|value| value == "1");
    std::env::remove_var(RESTART_FALLBACK_ENV);
    requested
}

fn marker_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    data.parent()
        .ok_or_else(|| "RESET_UNSUPPORTED: diretório de dados sem pasta pai".to_string())
        .map(|parent| parent.join(MARKER_NAME))
}

fn reset_targets(app: &tauri::AppHandle) -> Result<(Vec<PathBuf>, PathBuf), String> {
    let resolver = app.path();
    let data = resolver.app_data_dir().map_err(|e| e.to_string())?;
    let marker = marker_path(app)?;
    let mut targets = vec![
        data,
        resolver.app_config_dir().map_err(|e| e.to_string())?,
        resolver.app_local_data_dir().map_err(|e| e.to_string())?,
        resolver.app_cache_dir().map_err(|e| e.to_string())?,
    ];
    #[cfg(target_os = "linux")]
    targets.push(linux_state_dir()?);
    // On macOS logs live in a separate `~/Library/Logs/<app-id>` root.
    // On Linux and Windows they are already covered by app_local_data_dir.
    #[cfg(target_os = "macos")]
    targets.push(resolver.app_log_dir().map_err(|e| e.to_string())?);

    let mut validated = Vec::new();
    for target in targets {
        validate_app_root(&target)?;
        if !validated.contains(&target) {
            validated.push(target);
        }
    }
    Ok((validated, marker))
}

#[cfg(target_os = "linux")]
fn linux_state_dir() -> Result<PathBuf, String> {
    let base = match std::env::var_os("XDG_STATE_HOME") {
        Some(path) => {
            let path = PathBuf::from(path);
            if !path.is_absolute() {
                return Err("RESET_UNSUPPORTED: XDG_STATE_HOME precisa ser absoluto".into());
            }
            path
        }
        None => std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "RESET_UNSUPPORTED: diretório pessoal indisponível".to_string())?
            .join(".local/state"),
    };
    Ok(base.join(APP_ID))
}

fn validate_app_root(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.file_name().and_then(|name| name.to_str()) != Some(APP_ID) {
        return Err(format!(
            "RESET_UNSUPPORTED: caminho de dados inesperado ({})",
            path.display()
        ));
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("RESET_FAILED: {}", error)),
    };
    if let Some(metadata) = metadata {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!(
                "RESET_UNSUPPORTED: diretório de dados não é seguro ({})",
                path.display()
            ));
        }
    }
    let parent = path
        .parent()
        .ok_or_else(|| "RESET_UNSUPPORTED: diretório de dados sem pasta pai".to_string())?;
    let mut existing_parent = parent;
    while !existing_parent.exists() {
        existing_parent = existing_parent.parent().ok_or_else(|| {
            "RESET_UNSUPPORTED: diretório de dados sem pasta pai".to_string()
        })?;
    }
    let canonical_parent = existing_parent
        .canonicalize()
        .map_err(|e| format!("RESET_FAILED: {}", e))?;
    if canonical_parent.parent().is_none() {
        return Err("RESET_UNSUPPORTED: diretório de dados aponta para a raiz".into());
    }
    if path.exists() {
        let canonical = path
            .canonicalize()
            .map_err(|e| format!("RESET_FAILED: {}", e))?;
        let canonical_suffix = canonical.file_name().and_then(|name| name.to_str())
            == path.file_name().and_then(|name| name.to_str());
        if !canonical_suffix {
            return Err("RESET_UNSUPPORTED: caminho de dados resolve fora da pasta do app".into());
        }
    }
    Ok(())
}

fn create_marker(marker: &Path) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker)
        .map_err(|e| format!("RESET_FAILED: não foi possível preparar a restauração: {e}"))?;
    if let Err(error) = file.write_all(MARKER_CONTENT).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(marker);
        return Err(format!(
            "RESET_FAILED: não foi possível preparar a restauração: {error}"
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn reset_application(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, std::sync::Arc<crate::f1::commands::SyncState>>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("RESET_UNSUPPORTED: janela não autorizada".into());
    }
    state.reserve_reset().map_err(|_| "RESET_BUSY".to_string())?;
    let result = reset_targets(&app).and_then(|(targets, marker)| {
        #[cfg(debug_assertions)]
        crate::dev_assets::DevelopmentAssets::from_dist(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist"),
        )?;
        let data_dir = targets
            .iter()
            .find(|path| path.file_name().and_then(|name| name.to_str()) == Some(APP_ID))
            .ok_or_else(|| "RESET_UNSUPPORTED: diretório de dados indisponível".to_string())?;
        let lock = crate::f1::commands::acquire_file_lock(data_dir)
            .map_err(|_| "RESET_BUSY".to_string())?;
        create_marker(&marker)?;
        // Keep the lock until this process exits. Tauri spawns the replacement
        // immediately before exiting, so startup allows a bounded handover.
        std::mem::forget(lock);
        Ok(())
    });
    if let Err(error) = result {
        state.cancel_reset();
        return Err(error);
    }
    #[cfg(debug_assertions)]
    std::env::set_var(RESTART_FALLBACK_ENV, "1");
    app.request_restart();
    Ok(())
}

/// Called during Tauri setup, before the repository or WebView database opens.
pub fn apply_pending_reset(app: &tauri::AppHandle) -> Result<(), String> {
    let marker = marker_path(app)?;
    if !marker_is_pending(&marker)? {
        return Ok(());
    }

    let (targets, marker) = reset_targets(app)?;
    // Validate every target before deleting any of them.
    for target in &targets {
        validate_app_root(target)?;
    }
    // The lock is outside every reset target, so deleting the data roots
    // cannot unlink the inode and allow another process to start a sync.
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _sync_lock = wait_for_restart_lock(&data_dir)?;
    apply_reset_targets(&targets, &marker).map(|_| ())
}

fn wait_for_restart_lock(data_dir: &Path) -> Result<File, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if let Ok(lock) = crate::f1::commands::acquire_file_lock(data_dir) {
            return Ok(lock);
        }
        if std::time::Instant::now() >= deadline {
            return Err("RESET_BUSY: outra instância está usando os dados".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

fn marker_is_pending(marker: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(marker) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("RESET_FAILED: {}", error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MARKER_MAX_BYTES {
        return Err("RESET_FAILED: marcador de restauração inválido".into());
    }
    let mut contents = Vec::new();
    File::open(marker)
        .and_then(|file| file.take(MARKER_MAX_BYTES + 1).read_to_end(&mut contents))
        .map_err(|e| format!("RESET_FAILED: {}", e))?;
    if contents != MARKER_CONTENT {
        return Err("RESET_FAILED: marcador de restauração inválido".into());
    }
    Ok(true)
}

fn apply_reset_targets(targets: &[PathBuf], marker: &Path) -> Result<bool, String> {
    if !marker_is_pending(marker)? {
        return Ok(false);
    }
    // Validate every target before deleting any of them.
    for target in targets {
        validate_app_root(target)?;
    }
    for target in targets {
        match fs::symlink_metadata(&target) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("RESET_FAILED: {}", error)),
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("RESET_FAILED: diretório de dados mudou durante a restauração".into())
            }
            Ok(_) => {}
        }
        fs::remove_dir_all(&target)
            .map_err(|e| format!("RESET_FAILED: não foi possível limpar os dados do app: {e}"))?;
    }
    fs::remove_file(marker)
        .map_err(|e| format!("RESET_FAILED: não foi possível finalizar a restauração: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_root() -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "rds-reset-fixture-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&base).unwrap();
        base
    }

    #[test]
    fn pending_reset_is_bounded_idempotent_and_preserves_siblings() {
        let base = fixture_root();
        let data_root = base.join("data").join(APP_ID);
        let config_root = base.join("config").join(APP_ID);
        let marker = base.join(MARKER_NAME);
        let sibling = base.join("keep.txt");
        fs::create_dir_all(&data_root).unwrap();
        fs::create_dir_all(&config_root).unwrap();
        fs::write(data_root.join("db.sqlite"), b"fixture").unwrap();
        fs::write(config_root.join("settings.json"), b"fixture").unwrap();
        fs::write(&sibling, b"preserve").unwrap();

        assert!(!apply_reset_targets(
            &[data_root.clone(), config_root.clone()],
            &marker
        )
        .unwrap());
        fs::write(&marker, b"not-a-reset-marker").unwrap();
        assert!(apply_reset_targets(&[data_root.clone(), config_root.clone()], &marker).is_err());
        assert!(data_root.exists());
        assert!(config_root.exists());

        fs::write(&marker, MARKER_CONTENT).unwrap();
        assert!(apply_reset_targets(&[data_root.clone(), config_root.clone()], &marker).unwrap());
        assert!(!data_root.exists());
        assert!(!config_root.exists());
        assert!(!marker.exists());
        assert_eq!(fs::read(&sibling).unwrap(), b"preserve");
        assert!(!apply_reset_targets(&[data_root, config_root], &marker).unwrap());
        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn validates_all_roots_before_deleting_anything_and_rejects_symlinks() {
        let base = fixture_root();
        let good_root = base.join("good").join(APP_ID);
        let linked_root = base.join("linked").join(APP_ID);
        let outside = base.join("outside");
        let marker = base.join(MARKER_NAME);
        fs::create_dir_all(&good_root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(linked_root.parent().unwrap()).unwrap();
        fs::write(good_root.join("db.sqlite"), b"fixture").unwrap();
        fs::write(outside.join("important.txt"), b"preserve").unwrap();
        std::os::unix::fs::symlink(&outside, &linked_root).unwrap();
        fs::write(&marker, MARKER_CONTENT).unwrap();

        assert!(apply_reset_targets(&[good_root.clone(), linked_root], &marker).is_err());
        assert!(good_root.exists());
        assert_eq!(fs::read(outside.join("important.txt")).unwrap(), b"preserve");
        assert!(marker.exists());
        fs::remove_dir_all(&base).unwrap();
    }
}
