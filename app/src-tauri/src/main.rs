#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod f1;
mod desktop;
mod reset;
#[cfg(debug_assertions)]
mod dev_assets;

use tauri::Manager;

fn main() {
    #[cfg(debug_assertions)]
    let context = {
        let reset_restart = reset::take_restart_fallback_request();
        let mut context = tauri::generate_context!(
            "tauri.conf.json",
            assets = if reset_restart {
                dev_assets::DevelopmentAssets::from_dist(
                    &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist"),
                )
                .unwrap_or_else(|error| panic!("{error}"))
            } else {
                dev_assets::DevelopmentAssets::empty()
            }
        );
        if reset_restart {
            // Only this replacement process bypasses the Vite URL. Its assets
            // are an immutable snapshot; normal development remains HMR-backed.
            context.config_mut().build.dev_url = None;
        }
        context
    };
    #[cfg(not(debug_assertions))]
    let context = tauri::generate_context!();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(std::sync::Arc::new(f1::commands::SyncState::default()))
        .manage(desktop::FullscreenRestore::default())
        .invoke_handler(tauri::generate_handler![desktop::open_github, desktop::toggle_fullscreen, reset::reset_application, f1::commands::f1_export_text, f1::commands::f1_sync, f1::commands::f1_sync_status, f1::commands::f1_local_seasons, f1::commands::f1_analysis_snapshots, f1::commands::f1_analysis_pinned, f1::commands::f1_analyses_list, f1::commands::f1_analysis_load, f1::commands::f1_analysis_save, f1::commands::f1_analysis_delete, f1::commands::f1_models_list, f1::commands::f1_model_load, f1::commands::f1_model_save, f1::commands::f1_model_delete, f1::commands::f1_models_restore_defaults, f1::commands::f1_models_v3_list, f1::commands::f1_model_v3_load, f1::commands::f1_model_v3_save, f1::commands::f1_model_v3_delete, f1::commands::f1_season_details, f1::commands::f1_remote_seasons, f1::commands::f1_snapshots, f1::commands::f1_restore_snapshot, f1::commands::f1_copy_snapshot_events, f1::commands::f1_snapshot_rename, f1::commands::f1_snapshot_activate, f1::commands::f1_snapshot_delete])
        .setup(|app| {
            reset::apply_pending_reset(app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            let data_dir = app.path().app_data_dir()?;
            f1::repository::F1Repository::open(&data_dir)?;
            for window in &app.config().app.windows {
                tauri::WebviewWindowBuilder::from_config(app.handle(), window)?.build()?;
            }
            Ok(())
        })
        .run(context)
        .expect("failed to run Racing Data Studio");
}
