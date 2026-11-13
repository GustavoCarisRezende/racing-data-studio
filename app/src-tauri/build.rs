fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "f1_sync", "f1_sync_status", "f1_local_seasons", "f1_analysis_snapshots", "f1_analysis_pinned", "f1_analyses_list", "f1_analysis_load", "f1_analysis_save", "f1_models_list", "f1_model_load", "f1_model_save", "f1_model_delete", "f1_models_v3_list", "f1_model_v3_load", "f1_model_v3_save", "f1_model_v3_delete", "f1_models_restore_defaults", "f1_season_details", "f1_remote_seasons", "f1_snapshots", "f1_restore_snapshot", "f1_copy_snapshot_events",
        ]),
    )).expect("failed to build Tauri application manifest")
}
