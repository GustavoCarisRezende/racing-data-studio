use std::sync::Mutex;
use tauri::WebviewWindow;

#[derive(Default)]
pub struct FullscreenRestore(pub Mutex<Option<bool>>);

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("This command is only available to the main window".into());
    }
    Ok(())
}

fn validate_zoom(factor: f64) -> Result<f64, String> {
    if !factor.is_finite() || !(0.7..=2.0).contains(&factor) {
        return Err("INVALID_ZOOM".into());
    }
    Ok((factor * 100.0).round() / 100.0)
}

#[tauri::command]
pub fn set_application_zoom(window: WebviewWindow, factor: f64) -> Result<f64, String> {
    main_window(&window)?;
    let factor = validate_zoom(factor)?;
    window.set_zoom(factor).map_err(|_| "ZOOM_FAILED".to_string())?;
    Ok(factor)
}

#[cfg(test)]
mod zoom_tests {
    use super::*;
    #[test]
    fn zoom_is_finite_bounded_and_rounded() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, 0.69, 2.01] {
            assert!(validate_zoom(value).is_err());
        }
        assert_eq!(validate_zoom(0.7).unwrap(), 0.7);
        assert_eq!(validate_zoom(2.0).unwrap(), 2.0);
        assert_eq!(validate_zoom(0.951).unwrap(), 0.95);
    }
}

#[tauri::command]
pub fn open_github(window: WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    let url = "https://github.com/GustavoCarisRezende/racing-data-studio";
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };
    command.spawn().map(|_| ()).map_err(|error| format!("Could not open the system browser: {error}"))
}

#[tauri::command]
pub fn toggle_fullscreen(window: WebviewWindow, restore: tauri::State<'_, FullscreenRestore>) -> Result<(), String> {
    main_window(&window)?;
    let mut previous_maximized = restore.0.lock().map_err(|_| "Fullscreen state is unavailable")?;
    let fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;
    if fullscreen {
        window.set_fullscreen(false).map_err(|error| error.to_string())?;
        if let Some(was_maximized) = previous_maximized.take() {
            if was_maximized {
                window.maximize().map_err(|error| error.to_string())?;
            } else {
                window.unmaximize().map_err(|error| error.to_string())?;
            }
        }
    } else {
        *previous_maximized = Some(window.is_maximized().map_err(|error| error.to_string())?);
        window.set_fullscreen(true).map_err(|error| error.to_string())?;
    }
    Ok(())
}
