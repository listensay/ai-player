use rodio::{source::SineWave, OutputStreamBuilder, Sink, Source};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt;

pub const TRAY_ID: &str = "study-helper-tray";

#[derive(Default)]
pub struct DesktopState {
    sound_gate: Mutex<()>,
    #[cfg(feature = "desktop-smoke")]
    pub sound_plays: std::sync::atomic::AtomicUsize,
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray-open", "打开 Study Helper", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出 Study Helper", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("application icon".into()))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Study Helper")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => {
                let _ = show_main_window(app.clone());
            }
            "tray-quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_main_window(tray.app_handle().clone());
            }
        })
        .build(app)?;
    if std::env::args().any(|arg| arg == "--autostart") {
        hide_main_window(app.handle().clone())
            .map_err(|error| tauri::Error::Io(std::io::Error::other(error)))?;
    } else if let Some(window) = app.get_window("main") {
        window.show()?;
    }
    Ok(())
}

pub fn request_quit(app: &tauri::AppHandle) {
    let _ = show_main_window(app.clone());
    if app.try_state::<crate::AppState>().is_some_and(|state| {
        state
            .frontend_ready
            .load(std::sync::atomic::Ordering::SeqCst)
    }) {
        let _ = app.emit("desktop-quit-requested", ());
    } else {
        app.exit(0);
    }
}

#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_window("main").ok_or("主窗口不可用")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    app.emit("desktop-window-visible", true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_window("main")
        .ok_or("主窗口不可用")?
        .hide()
        .map_err(|e| e.to_string())?;
    app.emit("desktop-window-visible", false)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_window_visible(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app.get_window("main").ok_or("主窗口不可用")?;
    Ok(window.is_visible().map_err(|e| e.to_string())?
        && !window.is_minimized().map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.autolaunch().is_enabled().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.autolaunch();
        if !enabled && !manager.is_enabled().map_err(|e| e.to_string())? {
            return Ok(false);
        }
        if enabled {
            manager.enable()
        } else {
            manager.disable()
        }
        .map_err(|e| e.to_string())?;
        manager.is_enabled().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn reminder_chime() -> impl Source<Item = f32> + Send {
    rodio::source::from_iter([880.0, 660.0].map(|frequency| {
        SineWave::new(frequency)
            .take_duration(Duration::from_millis(550))
            .fade_in(Duration::from_millis(5))
            .fade_out(Duration::from_millis(550))
            .amplify(0.18)
    }))
}

#[tauri::command]
pub async fn play_reminder_sound(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DesktopState>();
        let _guard = match state.sound_gate.try_lock() {
            Ok(guard) => guard,
            Err(std::sync::TryLockError::WouldBlock) => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        let mut stream = OutputStreamBuilder::open_default_stream().map_err(|e| e.to_string())?;
        stream.log_on_drop(false);
        let sink = Sink::connect_new(stream.mixer());
        sink.append(reminder_chime());
        let deadline = Instant::now() + Duration::from_secs(3);
        while !sink.empty() {
            if Instant::now() >= deadline {
                sink.stop();
                return Err("响铃播放超时，请重试".into());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        #[cfg(feature = "desktop-smoke")]
        state
            .sound_plays
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chime_is_finite_and_has_a_safe_nonzero_level() {
        let samples: Vec<_> = reminder_chime().collect();
        assert!((52_000..54_000).contains(&samples.len()));
        assert!(samples
            .iter()
            .all(|sample| sample.is_finite() && sample.abs() <= 0.18));
        assert!(samples.iter().any(|sample| sample.abs() > 0.1));
        assert!(samples[26_399].abs() < 0.001);
        assert!(samples.last().unwrap().abs() < 0.001);
    }
}
