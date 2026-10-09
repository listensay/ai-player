use serde::Deserialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{Emitter, Manager, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "companion";
const WIDTH: f64 = 280.0;
const HEIGHT: f64 = 400.0;

#[derive(Clone, Debug, Deserialize)]
pub struct HitRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
}

impl HitRegion {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height, self.radius]
            .iter()
            .all(|v| v.is_finite())
            && self.x.abs() <= WIDTH
            && self.y.abs() <= HEIGHT
            && self.width > 0.0
            && self.width <= WIDTH
            && self.height > 0.0
            && self.height <= HEIGHT
            && self.radius >= 0.0
            && self.radius <= self.width.min(self.height) / 2.0
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        if x < self.x || y < self.y || x > self.x + self.width || y > self.y + self.height {
            return false;
        }
        let cx = x.clamp(self.x + self.radius, self.x + self.width - self.radius);
        let cy = y.clamp(self.y + self.radius, self.y + self.height - self.radius);
        (x - cx).powi(2) + (y - cy).powi(2) <= self.radius.powi(2)
    }
}

#[derive(Default)]
pub struct CompanionHitState(Arc<Mutex<Vec<HitRegion>>>);

#[tauri::command]
pub fn set_companion_hit_regions(
    window: WebviewWindow,
    state: tauri::State<CompanionHitState>,
    regions: Vec<HitRegion>,
) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("此操作仅用于桌宠".into());
    }
    if regions.len() > 16 || regions.iter().any(|region| !region.valid()) {
        return Err("桌宠点击区域无效".into());
    }
    *state.0.lock().map_err(|e| e.to_string())? = regions;
    Ok(())
}

fn hits_cursor(
    regions: &[HitRegion],
    cursor: (f64, f64),
    origin: (f64, f64),
    cursor_scale: f64,
    window_scale: f64,
) -> bool {
    if [cursor_scale, window_scale]
        .iter()
        .any(|scale| !scale.is_finite() || *scale <= 0.0)
    {
        return false;
    }
    let (x, y) = (
        cursor.0 / cursor_scale - origin.0 / window_scale,
        cursor.1 / cursor_scale - origin.1 / window_scale,
    );
    x.is_finite() && y.is_finite() && regions.iter().any(|region| region.contains(x, y))
}

// Tao reports the macOS global cursor in the primary monitor's scale, while
// window origins use the window monitor's scale. Normalize them independently.
fn cursor_scale(window: &WebviewWindow, window_scale: f64) -> tauri::Result<f64> {
    #[cfg(target_os = "macos")]
    {
        Ok(window
            .primary_monitor()?
            .map(|monitor| monitor.scale_factor())
            .unwrap_or(window_scale))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(window_scale)
    }
}

fn track_cursor(window: &WebviewWindow, state: &CompanionHitState) -> Result<(), String> {
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;
    let stopped = Arc::new(AtomicBool::new(false));
    let on_destroy = stopped.clone();
    let app = window.app_handle().clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            on_destroy.store(true, Ordering::Relaxed);
            let _ = app.emit_to("main", "companion-window-state", false);
        }
    });
    let window = window.clone();
    let regions = state.0.clone();
    // An ignored native window receives no pointer events. Poll the global cursor so
    // moving back onto the robot re-enables it, including on scaled/negative monitors.
    std::thread::spawn(move || {
        let mut ignoring = true;
        while !stopped.load(Ordering::Relaxed) {
            let next = match (
                window.cursor_position(),
                window.inner_position(),
                window.scale_factor(),
            ) {
                (Ok(cursor), Ok(origin), Ok(scale)) => cursor_scale(&window, scale)
                    .ok()
                    .and_then(|cursor_scale| {
                        regions.lock().ok().map(|regions| {
                            !hits_cursor(
                                &regions,
                                (cursor.x, cursor.y),
                                (origin.x as f64, origin.y as f64),
                                cursor_scale,
                                scale,
                            )
                        })
                    })
                    .unwrap_or(false),
                // Keep controls reachable on platforms without global cursor support.
                _ => false,
            };
            if next != ignoring && window.set_ignore_cursor_events(next).is_ok() {
                ignoring = next;
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn companion_is_open(app: tauri::AppHandle, webview: Webview) -> Result<bool, String> {
    if webview.label() != "main" {
        return Err("只能从学习主窗口查询桌宠".into());
    }
    Ok(app.get_webview_window(LABEL).is_some())
}

#[tauri::command]
pub fn close_companion(app: tauri::AppHandle, webview: Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("只能从学习主窗口关闭桌宠".into());
    }
    if let Some(companion) = app.get_webview_window(LABEL) {
        companion.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A single, local companion WebView. Playback and persistence stay in the main window.
#[tauri::command]
pub async fn open_companion(app: tauri::AppHandle, webview: Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("只能从学习主窗口打开桌宠".into());
    }
    let window = webview.window();
    if window.is_fullscreen().map_err(|e| e.to_string())? {
        return Ok(());
    }
    if let Some(companion) = app.get_webview_window(LABEL) {
        companion
            .set_always_on_top(true)
            .map_err(|e| e.to_string())?;
        companion.show().map_err(|e| e.to_string())?;
        companion.set_focus().map_err(|e| e.to_string())?;
        let _ = app.emit_to("main", "companion-window-state", true);
        return Ok(());
    }
    app.state::<CompanionHitState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clear();
    let companion = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Karen · 桌宠")
        // Space for the centered bubble/menu; transparent surroundings pass clicks through.
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    // Keep the initial position on the monitor containing the learning window.
    if let Ok(Some(monitor)) = window.current_monitor() {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let x = area.position.x as f64 + area.size.width as f64 - (WIDTH + 20.0) * scale;
        let y = area.position.y as f64 + area.size.height as f64 - (HEIGHT + 20.0) * scale;
        let _ = companion.set_position(tauri::PhysicalPosition::new(
            x.max(area.position.x as f64) as i32,
            y.max(area.position.y as f64) as i32,
        ));
    }
    if let Err(error) = track_cursor(&companion, &app.state::<CompanionHitState>()) {
        let _ = companion.close();
        return Err(error);
    }
    companion.show().map_err(|e| e.to_string())?;
    let _ = app.emit_to("main", "companion-window-state", true);
    Ok(())
}

#[tauri::command]
pub async fn reveal_learning_window(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("此操作仅用于桌宠".into());
    }
    let main = app.get_window("main").ok_or("学习窗口已关闭")?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())
}

/// Only change an existing pet; leaving fullscreen must not reopen a closed pet.
#[tauri::command]
pub fn set_companion_fullscreen(
    app: tauri::AppHandle,
    webview: Webview,
    fullscreen: bool,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("只能从学习主窗口更新桌宠".into());
    }
    if let Some(companion) = app.get_webview_window(LABEL) {
        if fullscreen {
            companion.hide().map_err(|e| e.to_string())?;
        } else {
            companion
                .set_always_on_top(true)
                .map_err(|e| e.to_string())?;
            companion.show().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn robot() -> HitRegion {
        HitRegion {
            x: 60.0,
            y: 220.0,
            width: 148.0,
            height: 148.0,
            radius: 59.2,
        }
    }

    #[test]
    fn transparent_surroundings_and_rounded_corners_pass_through() {
        let region = robot();
        assert!(region.contains(134.0, 290.0));
        assert!(region.contains(60.0, 294.0));
        assert!(!region.contains(60.0, 220.0));
        assert!(!region.contains(134.0, 180.0));
        assert!(!region.contains(220.0, 290.0));
        assert!(!hits_cursor(&[], (134.0, 290.0), (0.0, 0.0), 1.0, 1.0));
    }

    #[test]
    fn cursor_hit_testing_respects_scale_and_negative_monitor_coordinates() {
        for scale in [1.0, 1.25, 2.0] {
            let origin = (-1800.0, -900.0);
            let cursor = (origin.0 + 134.0 * scale, origin.1 + 290.0 * scale);
            assert!(hits_cursor(&[robot()], cursor, origin, scale, scale));
            assert!(!hits_cursor(
                &[robot()],
                (origin.0 + 20.0 * scale, cursor.1),
                origin,
                scale,
                scale
            ));
        }
        assert!(!hits_cursor(
            &[robot()],
            (f64::NAN, 290.0),
            (0.0, 0.0),
            1.0,
            1.0
        ));
        assert!(!hits_cursor(
            &[robot()],
            (134.0, 290.0),
            (0.0, 0.0),
            0.0,
            1.0
        ));
    }

    #[test]
    fn macos_cursor_and_window_can_use_different_monitor_scales() {
        let origin = (-1800.0, 200.0);
        let cursor = ((origin.0 + 134.0) * 2.0, (origin.1 + 290.0) * 2.0);
        assert!(hits_cursor(&[robot()], cursor, origin, 2.0, 1.0));
        assert!(!hits_cursor(&[robot()], cursor, origin, 1.0, 1.0));
    }

    #[test]
    fn invalid_regions_are_rejected_before_hit_testing() {
        assert!(robot().valid());
        for invalid in [
            HitRegion {
                radius: 100.0,
                ..robot()
            },
            HitRegion {
                x: f64::NAN,
                ..robot()
            },
            HitRegion {
                width: 0.0,
                ..robot()
            },
            HitRegion {
                height: 500.0,
                ..robot()
            },
        ] {
            assert!(!invalid.valid());
        }
    }
}
