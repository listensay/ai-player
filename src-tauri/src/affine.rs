use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{
    http::{Request, Response},
    webview::{NewWindowResponse, WebviewBuilder},
    Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl,
};
use tauri_plugin_dialog::DialogExt;

pub const LABEL: &str = "affine-workspace";

#[derive(Default)]
pub struct AffineState {
    prepare: tauri::async_runtime::Mutex<()>,
    origin: Mutex<Option<String>>,
    lesson: Mutex<Option<Lesson>>,
    pending: Mutex<HashMap<String, mpsc::SyncSender<Result<String, String>>>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiMessage {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    images: Vec<AiImage>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiImage {
    name: String,
    media_type: String,
    data: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lesson {
    course_id: String,
    path: String,
    title: String,
}

fn open_lesson(view: &Webview, lesson: Option<&Lesson>) -> Result<(), String> {
    if lesson.is_some_and(|lesson| {
        lesson.course_id.is_empty()
            || lesson.course_id.len() > 256
            || lesson.path.is_empty()
            || lesson.path.len() > 8192
            || lesson.title.len() > 8192
    }) {
        return Err("课节笔记标识无效".into());
    }
    let value = serde_json::to_string(&lesson).map_err(|e| e.to_string())?;
    view.eval(format!("window.__AI_PLAYER_LESSON__ = {value}; window.dispatchEvent(new Event('ai-player-open-lesson'));"))
        .map_err(|e|e.to_string())
}

#[tauri::command]
pub fn affine_lesson_context(
    app: tauri::AppHandle,
    webview: Webview,
) -> Result<Option<Lesson>, String> {
    require_notes(&webview)?;
    Ok(app
        .state::<AffineState>()
        .lesson
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}

#[derive(Clone, Serialize)]
struct AiRequest {
    id: String,
    prompt: String,
    messages: Vec<AiMessage>,
}

pub(crate) fn require_notes(view: &Webview) -> Result<(), String> {
    let url = view.url().map_err(|e| e.to_string())?;
    let state = view.app_handle().state::<AffineState>();
    let origin = state.origin.lock().map_err(|e| e.to_string())?;
    if view.label() != LABEL
        || origin.as_deref() != Some(url.origin().ascii_serialization().as_str())
    {
        return Err("笔记请求来源无效".into());
    }
    Ok(())
}

fn valid_ai_request(id: &str, prompt: &str, messages: &[AiMessage]) -> bool {
    uuid::Uuid::parse_str(id).is_ok()
        && !prompt.is_empty()
        && prompt.len() <= 16000
        && !messages.is_empty()
        && messages.len() <= 32
        && messages
            .iter()
            .all(|m| matches!(m.role.as_str(), "user" | "assistant"))
        && messages.iter().map(|m| m.content.len()).sum::<usize>() <= 800000
        && messages.iter().map(|m| m.images.len()).sum::<usize>() <= 4
        && messages.iter().flat_map(|m| &m.images).all(|image| {
            image.name.len() <= 1024
                && matches!(
                    image.media_type.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                )
                && image.data.len() <= 9 * 1024 * 1024
                && image
                    .data
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
        })
}

#[tauri::command]
pub async fn affine_save_export(
    app: tauri::AppHandle,
    webview: Webview,
    name: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    require_notes(&webview)?;
    if bytes.len() > 128 * 1024 * 1024 {
        return Err("导出内容超过 128 MB，请分批导出".into());
    }
    let name = Path::new(&name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("笔记.zip")
        .to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title("导出笔记")
            .set_file_name(name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path.into_path().map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("导出位置无效")?)
            .map_err(|e| e.to_string())?;
        use std::io::Write;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(path).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn affine_ai_request(
    app: tauri::AppHandle,
    webview: Webview,
    id: String,
    prompt: String,
    messages: Vec<AiMessage>,
) -> Result<String, String> {
    require_notes(&webview)?;
    if !valid_ai_request(&id, &prompt, &messages) {
        return Err("笔记内容过长或请求无效".into());
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    {
        let state = app.state::<AffineState>();
        let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
        if pending.len() >= 4 || pending.contains_key(&id) {
            return Err("请等待当前 AI 请求完成".into());
        }
        pending.insert(id.clone(), sender);
    }
    let sent = app.emit_to(
        "main",
        "affine-ai-request",
        AiRequest {
            id: id.clone(),
            prompt,
            messages,
        },
    );
    if sent.is_err() {
        app.state::<AffineState>()
            .pending
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id);
        return Err("无法连接学习助手".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(1810))
    })
    .await
    .map_err(|e| e.to_string());
    app.state::<AffineState>()
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    if !matches!(result, Ok(Ok(_))) {
        let _ = app.emit_to("main", "affine-ai-cancel", &id);
    }
    result?.map_err(|_| "AI 请求已结束或超时".to_string())?
}

#[tauri::command]
pub fn affine_ai_cancel(app: tauri::AppHandle, webview: Webview, id: String) -> Result<(), String> {
    require_notes(&webview)?;
    if let Some(sender) = app
        .state::<AffineState>()
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
    {
        let _ = sender.send(Err("已取消".into()));
    }
    app.emit_to("main", "affine-ai-cancel", &id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn affine_ai_response(
    app: tauri::AppHandle,
    webview: Webview,
    id: String,
    text: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    require_main(&webview)?;
    let result = match (text, error) {
        (Some(text), None) if text.len() <= 8_000_000 => Ok(text),
        (_, Some(error)) if error.len() <= 4096 => Err(error),
        _ => Err("AI 响应无效".into()),
    };
    if let Some(sender) = app
        .state::<AffineState>()
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
    {
        let _ = sender.send(result);
    }
    Ok(())
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_height: f64,
}

fn require_main(view: &Webview) -> Result<(), String> {
    if view.label() != "main" {
        return Err("只能从学习主窗口操作笔记".into());
    }
    Ok(())
}

fn asset_path(root: &Path, path: &str) -> Option<PathBuf> {
    let path = path.trim_start_matches('/');
    if path.contains('%') || path.contains('\\') || path.contains('\0') {
        return None;
    }
    let relative = Path::new(path);
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return None;
    }
    Some(root.join(relative))
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "zip" => "application/zip",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(feature = "desktop-smoke")]
    {
        let _ = app;
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("affine"))
    }
    #[cfg(not(feature = "desktop-smoke"))]
    {
        Ok(app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("affine"))
    }
}

pub fn asset_response(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let response = || -> Result<(Vec<u8>, &'static str), String> {
        if request.method() != "GET" {
            return Err("method".into());
        }
        let root = resource_root(app)?;
        let path = asset_path(&root, request.uri().path()).ok_or("path")?;
        let path = if path.is_file() {
            path
        } else if request.uri().path().starts_with("/workspace/") || request.uri().path() == "/" {
            root.join("index.html")
        } else {
            return Err("not found".into());
        };
        std::fs::read(&path)
            .map(|bytes| (bytes, mime(&path)))
            .map_err(|e| e.to_string())
    };
    match response() {
        Ok((bytes, mime)) => Response::builder()
            .header("Content-Type", mime)
            .header("X-Content-Type-Options", "nosniff")
            .header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'")
            .body(bytes).unwrap(),
        Err(_) => Response::builder().status(404).body(b"Not found".to_vec()).unwrap(),
    }
}

#[tauri::command]
pub async fn affine_prepare(
    app: tauri::AppHandle,
    webview: Webview,
    lesson: Option<Lesson>,
) -> Result<(), String> {
    require_main(&webview)?;
    let state = app.state::<AffineState>();
    let _guard = state.prepare.lock().await;
    *state.lesson.lock().map_err(|e| e.to_string())? = lesson.clone();
    if let Some(view) = app.get_webview(LABEL) {
        return open_lesson(&view, lesson.as_ref());
    }
    #[cfg(target_os = "macos")]
    crate::webview_cursor_macos::attach(&webview).await?;
    let root = resource_root(&app)?;
    if !root.join("index.html").is_file() {
        return Err("笔记组件未安装，请重新构建应用".into());
    }
    let origin = {
        let mut origin = state.origin.lock().map_err(|e| e.to_string())?;
        if origin.is_none() {
            *origin = Some(super::affine_server::start(&app)?);
        }
        origin.clone().ok_or("笔记地址不可用")?
    };
    let expected_origin = origin.clone();
    let mut builder = WebviewBuilder::new(
        LABEL,
        WebviewUrl::External(Url::parse(&origin).map_err(|e| e.to_string())?),
    )
    .incognito(false)
    .disable_drag_drop_handler()
    .zoom_hotkeys_enabled(true)
    .on_navigation(move |url| {
        url.origin().ascii_serialization() == expected_origin
            && url.username().is_empty()
            && url.password().is_none()
    })
    .on_new_window(|_, _| NewWindowResponse::Deny);
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.data_directory(
            app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("affine-profile"),
        );
    }
    let view = webview
        .window()
        .add_child(
            builder,
            LogicalPosition::new(-10000.0, -10000.0),
            LogicalSize::new(1.0, 1.0),
        )
        .map_err(|e| e.to_string())?;
    view.hide().map_err(|e| e.to_string())?;
    open_lesson(&view, lesson.as_ref())
}

#[tauri::command]
pub async fn affine_layout(
    app: tauri::AppHandle,
    webview: Webview,
    bounds: Option<Bounds>,
) -> Result<(), String> {
    require_main(&webview)?;
    let Some(view) = app.get_webview(LABEL) else {
        return Ok(());
    };
    let Some(b) = bounds else {
        return view.hide().map_err(|e| e.to_string());
    };
    let scale = webview.window().scale_factor().map_err(|e| e.to_string())?;
    let size = webview
        .size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    if ![b.x, b.y, b.width, b.height, b.viewport_height]
        .iter()
        .all(|v| v.is_finite())
        || b.x < 0.0
        || b.y < 0.0
        || b.width < 1.0
        || b.height < 1.0
        || b.viewport_height <= 0.0
        || b.viewport_height > size.height + 1.0
        || b.x + b.width > size.width + 1.0
        || b.y + b.height > b.viewport_height + 1.0
    {
        let _ = view.hide();
        return Err("笔记面板尺寸已变化，请重试".into());
    }
    #[cfg(target_os = "macos")]
    let top = (size.height - b.viewport_height).max(0.0);
    #[cfg(not(target_os = "macos"))]
    let top = 0.0;
    view.set_bounds(Rect {
        position: LogicalPosition::new(b.x, b.y + top).into(),
        size: LogicalSize::new(b.width, b.height).into(),
    })
    .map_err(|e| e.to_string())?;
    view.show().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn assets_stay_in_the_bundle() {
        let root = Path::new("/application/affine");
        assert_eq!(
            asset_path(root, "/js/main.js"),
            Some(root.join("js/main.js"))
        );
        for path in [
            "/../secrets",
            "/%2e%2e/secrets",
            "/js/../../secrets",
            "/js\\secrets",
        ] {
            assert!(asset_path(root, path).is_none(), "{path}");
        }
    }
}
