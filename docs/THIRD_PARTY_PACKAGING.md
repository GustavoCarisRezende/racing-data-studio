# Sources for packaging components

Racing Data Studio uses Tauri CLI 2.12.4 to package the desktop application.
The platform archives include the dependency notices and inventories generated
for each target. The links below identify the packaging components supplied
outside the application's Cargo and npm dependency graphs.

## Linux AppImage

- The AppImage runtime reports its upstream commit in `APPIMAGE-RUNTIME.txt`.
  Use that commit to inspect the runtime sources, license and dependency versions.
  [AppImage type-2 runtime](https://github.com/AppImage/type2-runtime)
- The `AppRun.wrapped` launcher comes from the AppImageKit binary mirror used
  by Tauri. [Tauri launcher archive](https://github.com/tauri-apps/binary-releases/releases/tag/apprun-old)
  · [AppImageKit sources](https://github.com/AppImage/AppImageKit)
- The GTK launcher and hook are supplied by the Tauri Linux packaging code.
  [Tauri AppImage bundler](https://github.com/tauri-apps/tauri/tree/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/linux/appimage)

## Windows NSIS

- The bootstrap executable and standard plug-ins come from NSIS 3.13.
  [NSIS 3.13 files and source](https://sourceforge.net/projects/nsis/files/NSIS%203/3.13/)
  · [NSIS license and compression-module terms](https://nsis.sourceforge.io/License)
- Tauri adds the `nsis_tauri_utils` plug-in at version 0.5.3.
  [Plug-in source and licenses](https://github.com/tauri-apps/nsis-tauri-utils/tree/nsis_tauri_utils-v0.5.3)
  · [Tauri NSIS bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs)
