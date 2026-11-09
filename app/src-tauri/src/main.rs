#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod f1;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .manage(std::sync::Arc::new(f1::commands::SyncState::default()))
        .invoke_handler(tauri::generate_handler![f1::commands::f1_sync, f1::commands::f1_sync_status, f1::commands::f1_local_seasons, f1::commands::f1_analysis_snapshots, f1::commands::f1_analysis_pinned, f1::commands::f1_analyses_list, f1::commands::f1_analysis_load, f1::commands::f1_analysis_save, f1::commands::f1_season_details, f1::commands::f1_remote_seasons, f1::commands::f1_snapshots, f1::commands::f1_restore_snapshot, f1::commands::f1_copy_snapshot_events])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            f1::repository::F1Repository::open(&data_dir)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Racing Data Studio");
}
