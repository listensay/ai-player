use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowFeatures, NewWindowResponse, PageLoadEvent, WebviewBuilder},
    Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "notion-notes";
pub const POPUP_PREFIX: &str = "notion-popup-";

#[derive(Default)]
pub struct NotionState {
    target: tauri::async_runtime::Mutex<Option<(String, String)>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_height: f64,
}

impl Bounds {
    fn valid(&self, width: f64, height: f64) -> bool {
        [
            self.x,
            self.y,
            self.width,
            self.height,
            self.viewport_height,
        ]
        .iter()
        .all(|v| v.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width >= 1.0
            && self.height >= 1.0
            && self.viewport_height > 0.0
            && self.viewport_height <= height + 1.0
            && self.x + self.width <= width + 1.0
            && self.y + self.height <= self.viewport_height + 1.0
    }
}

pub fn is_notion_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.host_str().is_some_and(|host| {
            matches!(
                host,
                "notion.so" | "notion.site" | "notion.com" | "www.notion.com" | "app.notion.com"
            ) || host.ends_with(".notion.so")
                || host.ends_with(".notion.site")
        })
}

fn parse_url(value: &str) -> Result<Url, String> {
    if value.len() > 4096 {
        return Err("Notion 链接过长。".into());
    }
    let url = Url::parse(value).map_err(|_| "请填写完整的 Notion 页面链接。")?;
    if !is_notion_url(&url) {
        return Err("请使用 https 开头的 Notion 页面链接。".into());
    }
    Ok(url)
}

fn navigation_allowed(url: &Url) -> bool {
    #[cfg(feature = "desktop-smoke")]
    if crate::desktop_smoke::is_notion_fixture(url) {
        return true;
    }
    // Wry calls this for subframes too. Notion's authentication and embedded
    // content need cross-origin HTTPS frames; none receive Tauri capabilities.
    // Keep local application protocols unreachable from the remote view.
    (url.scheme() == "https" && url.username().is_empty() && url.password().is_none())
        || url.as_str() == "about:blank"
}

fn require_main(webview: &Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("只能从学习主窗口操作 Notion。".into());
    }
    Ok(())
}

fn page_event(app: &tauri::AppHandle, url: &Url, loading: bool) {
    if is_notion_url(url) {
        let _ = app.emit_to(
            "main",
            "notion-page",
            serde_json::json!({ "url": url, "loading": loading }),
        );
    }
}

fn external_event(app: &tauri::AppHandle, url: &Url) {
    if matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
    {
        let _ = app.emit_to("main", "notion-external", url.as_str());
    }
}

fn open_popup(
    app: &tauri::AppHandle,
    url: Url,
    features: NewWindowFeatures,
) -> NewWindowResponse<tauri::Wry> {
    if !navigation_allowed(&url) {
        external_event(app, &url);
        return NewWindowResponse::Deny;
    }
    let nested_app = app.clone();
    let label = format!("{POPUP_PREFIX}{}", uuid::Uuid::new_v4());
    // Return the actual new browsing context. Navigating the opener or returning
    // Deny breaks window.open(), window.opener, postMessage and OAuth callbacks.
    // window_features also shares WKWebView configuration / WebView2 environment /
    // WebKit related view, preserving the originating browser session on each OS.
    let builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .window_features(features)
    .title("Notion 登录")
    .inner_size(560.0, 720.0)
    .min_inner_size(400.0, 480.0)
    .center()
    .visible(false)
    .on_navigation(navigation_allowed)
    .on_document_title_changed(|window, title| {
        let title: String = title
            .chars()
            .filter(|c| !c.is_control())
            .take(160)
            .collect();
        let _ = window.set_title(&format!("{title} — Notion"));
    })
    .on_new_window(move |url, features| open_popup(&nested_app, url, features));
    match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "macos")]
            if crate::notion_popup_macos::attach(&window).is_err() {
                let _ = window.close();
                let _ = app.emit_to("main", "notion-popup-error", "登录窗口初始化失败，请重试。");
                return NewWindowResponse::Deny;
            }
            // JS screen coordinates can refer to a different monitor/scale.
            // Place the login window with the learning window that opened it.
            if let Some(main) = app.get_window("main") {
                if let (Ok(position), Ok(parent), Ok(popup)) = (
                    main.outer_position(),
                    main.outer_size(),
                    window.outer_size(),
                ) {
                    let _ = window.set_position(tauri::PhysicalPosition::new(
                        position.x + (parent.width as i32 - popup.width as i32) / 2,
                        position.y + (parent.height as i32 - popup.height as i32) / 2,
                    ));
                }
            }
            let _ = window.show();
            let _ = window.set_focus();
            NewWindowResponse::Create { window }
        }
        Err(_) => {
            let _ = app.emit_to("main", "notion-popup-error", "登录窗口打开失败，请重试。");
            NewWindowResponse::Deny
        }
    }
}

/// Preparation is separate from showing: a late creation must not cover a newer dialog or lesson.
#[tauri::command]
pub async fn notion_prepare(
    app: tauri::AppHandle,
    webview: Webview,
    key: String,
    url: String,
) -> Result<(), String> {
    require_main(&webview)?;
    if key.is_empty() || key.len() > 8192 {
        return Err("课节无效。".into());
    }
    let url = parse_url(&url)?;
    let state = app.state::<NotionState>();
    let mut target = state.target.lock().await;
    let next = (key, url.to_string());
    #[cfg(feature = "desktop-smoke")]
    let url = crate::desktop_smoke::notion_fixture_url(&url);
    if let Some(view) = app.get_webview(LABEL) {
        if target.as_ref() != Some(&next) {
            view.hide().map_err(|e| e.to_string())?;
            if view.url().map_err(|e| e.to_string())? != url {
                view.navigate(url).map_err(|e| e.to_string())?;
            }
            *target = Some(next);
        }
        return Ok(());
    }
    let popup_app = app.clone();
    let loaded_app = app.clone();
    let mut builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        .incognito(false)
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(true)
        .on_navigation(navigation_allowed)
        .on_new_window(move |url, features| open_popup(&popup_app, url, features))
        .on_page_load(move |_, payload| {
            page_event(
                &loaded_app,
                payload.url(),
                matches!(payload.event(), PageLoadEvent::Started),
            );
        });
    // macOS uses its persistent WKWebsiteDataStore. It is separate from Safari/Chrome.
    // Other desktop platforms have a persistent profile under this app's data directory.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.data_directory(
            app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("notion-profile"),
        );
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
    }
    #[cfg(feature = "desktop-smoke")]
    {
        builder = builder.on_document_title_changed(|view, title| {
            if view
                .url()
                .is_ok_and(|url| crate::desktop_smoke::is_notion_fixture(&url))
            {
                if let Some(json) = title.strip_prefix("notion-probe:") {
                    if let Ok(value) = serde_json::from_str(json) {
                        if let Ok(mut data) = view
                            .app_handle()
                            .state::<crate::desktop_smoke::NotionProbe>()
                            .0
                            .lock()
                        {
                            *data = value;
                        }
                    }
                }
            }
        });
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
    *target = Some(next);
    Ok(())
}

#[tauri::command]
pub async fn notion_layout(
    app: tauri::AppHandle,
    webview: Webview,
    bounds: Option<Bounds>,
) -> Result<(), String> {
    require_main(&webview)?;
    let Some(view) = app.get_webview(LABEL) else {
        return Ok(());
    };
    let Some(bounds) = bounds else {
        return view.hide().map_err(|e| e.to_string());
    };
    let window = webview.window();
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = webview
        .size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    if !bounds.valid(size.width, size.height) {
        let _ = view.hide();
        return Err("Notion 面板尺寸已变化，请重试。".into());
    }
    // WKWebView's native frame includes the title bar, while its DOM viewport
    // starts below the automatic top inset. In fullscreen this difference is zero.
    #[cfg(target_os = "macos")]
    let top_inset = (size.height - bounds.viewport_height).max(0.0);
    #[cfg(not(target_os = "macos"))]
    let top_inset = 0.0;
    view.set_bounds(Rect {
        position: LogicalPosition::new(bounds.x, bounds.y + top_inset).into(),
        size: LogicalSize::new(bounds.width, bounds.height).into(),
    })
    .map_err(|e| e.to_string())?;
    view.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notion_action(
    app: tauri::AppHandle,
    webview: Webview,
    action: String,
) -> Result<String, String> {
    require_main(&webview)?;
    let view = app.get_webview(LABEL).ok_or("请先打开 Notion。")?;
    match action.as_str() {
        "back" => view
            .eval("window.history.back()")
            .map_err(|e| e.to_string())?,
        "reload" => view.reload().map_err(|e| e.to_string())?,
        "url" => {}
        _ => return Err("Notion 操作无效。".into()),
    }
    let url = view.url().map_err(|e| e.to_string())?;
    #[cfg(feature = "desktop-smoke")]
    let url = crate::desktop_smoke::notion_public_url(url);
    if !is_notion_url(&url) {
        return Err("当前页面不是 Notion 页面。".into());
    }
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_notion_https_pages_are_accepted() {
        for url in [
            "https://app.notion.com/abc",
            "https://www.notion.so/abc?v=1#x",
            "https://team.notion.site/page",
            "https://notion.so/page",
        ] {
            assert!(parse_url(url).is_ok(), "{url}");
        }
        for url in [
            "http://notion.so/a",
            "https://notion.so.evil.test/a",
            "https://evilnotion.so/a",
            "https://notion.so@evil.test/",
            "https://user@notion.so/",
            "https://notion.so:8080/a",
            "file:///tmp/a",
            "javascript:alert(1)",
            "https://accounts.google.com/",
        ] {
            assert!(parse_url(url).is_err(), "{url}");
        }
    }

    #[test]
    fn bounds_must_stay_inside_the_host_window() {
        let bounds = Bounds {
            x: 800.0,
            y: 120.0,
            width: 400.0,
            height: 600.0,
            viewport_height: 900.0,
        };
        assert!(bounds.valid(1280.0, 900.0));
        assert!(!bounds.valid(900.0, 600.0));
        assert!(!Bounds { x: -1.0, ..bounds }.valid(1280.0, 900.0));
        assert!(!Bounds {
            width: f64::NAN,
            ..bounds
        }
        .valid(1280.0, 900.0));
        assert!(!Bounds {
            height: 0.0,
            ..bounds
        }
        .valid(1280.0, 900.0));
    }

    #[test]
    fn remote_subframes_work_without_allowing_local_application_navigation() {
        assert!(navigation_allowed(
            &Url::parse("https://challenges.cloudflare.com/widget").unwrap()
        ));
        assert!(navigation_allowed(
            &Url::parse("https://www.youtube.com/embed/example").unwrap()
        ));
        assert!(navigation_allowed(&Url::parse("about:blank").unwrap()));
        assert!(!navigation_allowed(
            &Url::parse("tauri://localhost/").unwrap()
        ));
        assert!(!navigation_allowed(
            &Url::parse("file:///tmp/note").unwrap()
        ));
        assert!(!navigation_allowed(
            &Url::parse("javascript:alert(1)").unwrap()
        ));
    }
}
