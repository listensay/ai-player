//! Compiled only into the separately identified desktop regression executable.
use std::{fs, path::PathBuf};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Url, Wry,
};

fn interactive_ime() -> bool {
    std::env::var("AI_PLAYER_SMOKE_IME").as_deref() == Ok("1")
}

fn fixture_origin() -> Option<Url> {
    let url = Url::parse(&std::env::var("AI_PLAYER_NOTION_SMOKE_URL").ok()?).ok()?;
    (url.scheme() == "http" && url.host_str() == Some("127.0.0.1")).then_some(url)
}
pub fn is_notion_fixture(url: &Url) -> bool {
    fixture_origin().is_some_and(|base| base.origin() == url.origin())
}
pub fn notion_fixture_url(url: &Url) -> Url {
    if let Some(mut fixture) = fixture_origin() {
        fixture.set_path(url.path());
        fixture
    } else {
        url.clone()
    }
}
pub fn notion_public_url(url: Url) -> Url {
    if is_notion_fixture(&url) {
        let mut public = Url::parse("https://app.notion.com/").unwrap();
        public.set_path(url.path());
        public
    } else {
        url
    }
}

#[tauri::command]
pub async fn desktop_smoke_notion(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    text: Option<String>,
) -> Result<serde_json::Value, String> {
    if webview.label() != "main" {
        return Err("Only the test host may inspect the fixture".into());
    }
    let Some(view) = app.get_webview(crate::notion::LABEL) else {
        return Ok(serde_json::json!({ "exists": false }));
    };
    let url = view.url().map_err(|e| e.to_string())?;
    if !is_notion_fixture(&url) {
        return Err("Not a fixture".into());
    }
    if let Some(text) = text {
        view.eval(format!("document.querySelector('textarea').value={};document.querySelector('textarea').dispatchEvent(new Event('input'))", serde_json::json!(text))).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let (hidden, native_input) = (false, serde_json::Value::Null);
    #[cfg(target_os = "macos")]
    let (hidden, native_input) = {
        let (tx, rx) = std::sync::mpsc::channel();
        view.with_webview(move |view| {
            use objc2::{msg_send, rc::Retained, runtime::AnyObject};
            use objc2_foundation::NSString;
            // Read-only diagnostics in the isolated fixture, never real Notion content.
            let (hidden, input) = unsafe {
                let native = &*(view.inner() as *const AnyObject);
                let hidden: bool = msg_send![native, isHidden];
                let mut input = serde_json::Value::Null;
                if interactive_ime() {
                    let window: Retained<AnyObject> = msg_send![native, window];
                    let responder: Option<Retained<AnyObject>> = msg_send![&window, firstResponder];
                    if let Some(responder) = responder {
                        let context: Option<Retained<AnyObject>> =
                            msg_send![&responder, inputContext];
                        let source: Option<Retained<NSString>> = context
                            .as_ref()
                            .and_then(|context| msg_send![context, selectedKeyboardInputSource]);
                        input = serde_json::json!({
                            "notionFocused": std::ptr::eq(&*responder, native),
                            "hasInputContext": context.is_some(),
                            "keyboardInputSource": source.map(|source| source.to_string()),
                        });
                    }
                }
                (hidden, input)
            };
            let _ = tx.send((hidden, input));
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?
    };
    // Title-change notifications truncate long input traces on WebKit. Read the
    // fixture snapshot directly instead, with an in-page origin check in case it
    // navigated between the native URL check and this evaluation.
    let (tx, rx) = std::sync::mpsc::channel();
    view.eval_with_callback(
        format!(
            "location.origin === {} ? (window.__NOTION_FIXTURE_PROBE__ ?? null) : null",
            serde_json::json!(url.origin().ascii_serialization())
        ),
        move |json| {
            let _ = tx.send(json);
        },
    )
    .map_err(|e| e.to_string())?;
    let probe: serde_json::Value = match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(json) if !json.is_empty() => serde_json::from_str(&json).map_err(|e| e.to_string())?,
        // Wry queues scripts but drops their callbacks before the first page
        // finishes loading. A navigation can also invalidate an evaluation.
        // Report "not ready" and let the bounded JS poll retry, never stale data.
        Ok(_) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => serde_json::Value::Null,
        Err(error) => return Err(error.to_string()),
    };
    let scale = webview.window().scale_factor().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "exists": true, "hidden": hidden, "nativeInput": native_input,
        "windowGeometry": {
            "innerPosition": webview.window().inner_position().map_err(|e| e.to_string())?,
            "outerPosition": webview.window().outer_position().map_err(|e| e.to_string())?,
            "innerSize": webview.window().inner_size().map_err(|e| e.to_string())?,
            "outerSize": webview.window().outer_size().map_err(|e| e.to_string())?,
            "hostSize": webview.size().map_err(|e| e.to_string())?, "scale": scale
        },
        "position": view.position().map_err(|e| e.to_string())?.to_logical::<f64>(scale),
        "hostPosition": webview.position().map_err(|e| e.to_string())?.to_logical::<f64>(scale),
        "size": view.size().map_err(|e| e.to_string())?.to_logical::<f64>(scale), "probe": probe
    }))
}

#[tauri::command]
pub async fn desktop_smoke_notion_popup(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    action: String,
) -> Result<usize, String> {
    if webview.label() != "main" {
        return Err("Only the test host may operate the fixture".into());
    }
    let view = app
        .get_webview(crate::notion::LABEL)
        .ok_or("Missing Notion fixture")?;
    if !is_notion_fixture(&view.url().map_err(|e| e.to_string())?) {
        return Err("Not a fixture".into());
    }
    match action.as_str() {
        "blank" => view
            .eval("window.startPopupLogin(true, false)")
            .map_err(|e| e.to_string())?,
        "direct" => view
            .eval("window.startPopupLogin(false, false)")
            .map_err(|e| e.to_string())?,
        "hold" => view
            .eval("window.startPopupLogin(true, true)")
            .map_err(|e| e.to_string())?,
        "close" => {
            for (label, popup) in app.webview_windows() {
                if label.starts_with(crate::notion::POPUP_PREFIX) {
                    popup.close().map_err(|e| e.to_string())?;
                }
            }
        }
        "count" => {}
        _ => return Err("Unknown popup fixture action".into()),
    }
    Ok(app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with(crate::notion::POPUP_PREFIX))
        .count())
}

pub fn directory() -> Result<PathBuf, String> {
    let path = PathBuf::from(
        std::env::var("AI_PLAYER_SMOKE_DATA").map_err(|_| "Missing smoke data directory")?,
    );
    if fs::read_to_string(path.join(".ai-player-smoke")).map_err(|e| e.to_string())?
        != "isolated desktop regression\n"
    {
        return Err("Invalid smoke data marker".into());
    }
    path.canonicalize().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn desktop_smoke_report(
    app: tauri::AppHandle,
    result: serde_json::Value,
) -> Result<(), String> {
    let phase = std::env::var("AI_PLAYER_SMOKE_PHASE").unwrap_or_default();
    if !["first", "second"].contains(&phase.as_str()) {
        return Err("Invalid smoke phase".into());
    }
    if let Some(progress) = result["progress"].as_str() {
        println!("Desktop smoke: {progress}");
        return Ok(());
    }
    let success = result["success"] == true;
    fs::write(
        directory()?.join(format!("{phase}.json")),
        serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    app.exit(if success { 0 } else { 1 });
    Ok(())
}
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("desktop-smoke")
        .setup(|app, _| {
            if app.config().identifier != "app.aiplayer.smoke" {
                return Err("Smoke tests require a separate app identifier".into());
            }
            directory().map_err(std::io::Error::other)?;
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                let phase = std::env::var("AI_PLAYER_SMOKE_PHASE").unwrap_or_default();
                if !["first", "second"].contains(&phase.as_str()) {
                    return;
                }
                let script = format!(
                    "globalThis.__AI_PLAYER_SMOKE_PHASE__ = {}; globalThis.__AI_PLAYER_SMOKE_IME__ = {};\n{}",
                    serde_json::json!(phase),
                    interactive_ime(),
                    include_str!("../../tests/desktop/smoke.js")
                );
                if let Err(error) = webview.eval(&script) {
                    eprintln!("Desktop smoke injection failed: {error}");
                }
            }
        })
        .build()
}
