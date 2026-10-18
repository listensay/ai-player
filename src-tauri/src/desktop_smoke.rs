//! Compiled only into the separately identified desktop regression executable.
use std::{fs, path::PathBuf};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};

#[tauri::command]
pub async fn desktop_smoke_affine(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    text: Option<String>,
    storage_action: Option<String>,
    note_action: Option<String>,
) -> Result<serde_json::Value, String> {
    if webview.label() != "main" {
        return Err("Only the test host may inspect notes".into());
    }
    let Some(view) = app.get_webview(crate::affine::LABEL) else {
        return Ok(serde_json::json!({"exists":false}));
    };
    crate::affine::require_notes(&view)?;
    let script = format!(
        r#"(() => {{
      const workspace = window.currentWorkspace;
      const docId = location.pathname.split('/')[3];
      const lesson = window.__AI_PLAYER_LESSON__;
      const createButton = document.querySelector('[data-testid="new-page-button-trigger"] button');
      const summary = {{docId,lesson,docCount:workspace?.docCollection.meta.docMetas.length,listReady:docId === 'all' && !!createButton}};
      const noteAction = {};
      if (noteAction === 'create') createButton?.click();
      const doc = workspace?.docCollection.getDoc(docId);
      if (!doc) return {{...summary,ready:false}};
      const paragraphs = Array.from(doc.yBlocks.values()).map(block => block.get('prop:text')).filter(text => text && typeof text.insert === 'function');
      if (!paragraphs.length) return {{...summary,ready:false}};
      if (noteAction === 'bind-lesson' && lesson) {{
        // Seed a legacy binding so reopening existing lesson notes remains covered.
        const title = Array.from(doc.yBlocks.values()).map(block => block.get('prop:title')).find(title => title && typeof title.insert === 'function');
        if (!title) throw Error('Fixture note has no title block');
        doc.spaceDoc.transact(() => {{ title.delete(0,title.length); title.insert(0,lesson.title); }});
        workspace.docCollection.meta.setDocMeta(docId, {{title:lesson.title}});
        localStorage.setItem(`ai-player:lesson:${{JSON.stringify([lesson.courseId,lesson.path])}}`, JSON.stringify({{workspaceId:workspace.id,docId}}));
      }}
      const storageAction = {};
      if (storageAction && !window.__NOTES_STORAGE_TEST__) {{
        window.__NOTES_STORAGE_TEST__ = {{pending:true}};
        (async () => {{
          const invoke = window.__TAURI__.core.invoke;
          if (storageAction === 'write') {{
            await workspace.engine.blob.set({{key:'smoke-image',data:new Uint8Array([137,80,78,71,1,2,3]),mime:'image/png'}});
            localStorage.setItem('ai-player:storage-test', 'metadata-value');
          }}
          const blob = await workspace.engine.blob.get('smoke-image');
          await window.__AI_PLAYER_NOTES_FLUSH__();
          window.__NOTES_STORAGE_TEST__ = {{pending:false, blob:Array.from(blob?.data || []), metadata:localStorage.getItem('ai-player:storage-test')}};
        }})().catch(e => {{window.__NOTES_STORAGE_TEST__ = {{error:String(e.message || e)}};}});
      }}
      const content = {};
      if (content !== null) doc.spaceDoc.transact(() => {{ const text = paragraphs[0]; text.delete(0,text.length); text.insert(0,content); }});
      if (window.__AI_PLAYER_PROBE_IPC__ === undefined) {{
        window.__AI_PLAYER_PROBE_IPC__ = 'pending';
        window.__TAURI__.core.invoke('database_request', {{endpoint:'settings',method:'GET',query:{{key:'ai_settings'}},body:null}})
          .then(() => {{window.__AI_PLAYER_PROBE_IPC__ = false;}})
          .catch(() => {{window.__AI_PLAYER_PROBE_IPC__ = true;}});
      }}
      return {{...summary,ready:true,storage:window.__NOTES_STORAGE_TEST__,workspaceId:workspace.id,title:doc.meta?.title,text:paragraphs.map(text=>text.toString()).join('\n'),
        ipcBlocked:window.__AI_PLAYER_PROBE_IPC__ === true, hasLogin:!!document.querySelector('[data-testid="sidebar-user-avatar"]'), lesson:window.__AI_PLAYER_LESSON__ }};
    }})()"#,
        serde_json::json!(note_action),
        serde_json::json!(storage_action),
        serde_json::json!(text)
    );
    let (tx, rx) = std::sync::mpsc::channel();
    view.eval_with_callback(script, move |json| {
        let _ = tx.send(json);
    })
    .map_err(|e| e.to_string())?;
    let probe = match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(json) if !json.is_empty() => {
            serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?
        }
        Ok(_) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => serde_json::Value::Null,
        Err(error) => return Err(error.to_string()),
    };
    #[cfg(target_os = "macos")]
    let (hidden, cursor_routing) = {
        let (tx, rx) = std::sync::mpsc::channel();
        view.with_webview(move |view| {
            use objc2::{msg_send, runtime::AnyObject};
            use objc2_foundation::{NSPoint, NSRect};
            let view = unsafe { &*(view.inner() as *const AnyObject) };
            let hidden: bool = unsafe { msg_send![view, isHidden] };
            let bounds: NSRect = unsafe { msg_send![view, bounds] };
            let points: Vec<_> = [(0.1, 0.1), (0.9, 0.1), (0.5, 0.5), (0.1, 0.9), (0.9, 0.9)]
                .into_iter()
                .map(|(x, y)| {
                    let local = NSPoint::new(
                        bounds.origin.x + bounds.size.width * x,
                        bounds.origin.y + bounds.size.height * y,
                    );
                    let point: NSPoint = unsafe {
                        msg_send![view, convertPoint: local, toView: std::ptr::null::<AnyObject>()]
                    };
                    let owns = unsafe { crate::webview_cursor_macos::owns_point(view, point) };
                    (point, owns)
                })
                .collect();
            let _ = tx.send((hidden, points));
        })
        .map_err(|e| e.to_string())?;
        let (hidden, points) = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let (tx, rx) = std::sync::mpsc::channel();
        webview
            .with_webview(move |view| {
                use objc2::{msg_send, runtime::AnyObject};
                use objc2_foundation::{NSPoint, NSRect};
                let view = unsafe { &*(view.inner() as *const AnyObject) };
                let host_owns: Vec<_> = points
                    .iter()
                    .map(|(point, _)| unsafe {
                        crate::webview_cursor_macos::owns_point(view, *point)
                    })
                    .collect();
                let bounds: NSRect = unsafe { msg_send![view, bounds] };
                // The main toolbar remains exposed above both note layouts.
                let local = NSPoint::new(bounds.origin.x + 5.0, bounds.origin.y + 5.0);
                let point: NSPoint = unsafe {
                    msg_send![view, convertPoint: local, toView: std::ptr::null::<AnyObject>()]
                };
                let toolbar_owns = unsafe { crate::webview_cursor_macos::owns_point(view, point) };
                let _ = tx.send(serde_json::json!({
                    "attached":unsafe { crate::webview_cursor_macos::is_attached(view) },
                    "notesOwn":points.iter().map(|(_, owns)| owns).collect::<Vec<_>>(),
                    "hostOwn":host_owns,
                    "toolbarOwn":toolbar_owns,
                }));
            })
            .map_err(|e| e.to_string())?;
        (
            hidden,
            rx.recv_timeout(std::time::Duration::from_secs(5))
                .map_err(|e| e.to_string())?,
        )
    };
    #[cfg(not(target_os = "macos"))]
    let (hidden, cursor_routing) = (false, serde_json::Value::Null);
    let scale = webview.window().scale_factor().map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"exists":true,"hidden":hidden,"probe":probe,"cursorRouting":cursor_routing,
      "position":view.position().map_err(|e|e.to_string())?.to_logical::<f64>(scale),
      "size":view.size().map_err(|e|e.to_string())?.to_logical::<f64>(scale),
      "windowGeometry":{"hostSize":webview.size().map_err(|e|e.to_string())?,"scale":scale}}),
    )
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
    if ![
        "first",
        "second",
        "lessons",
        "lesson-restart",
        "library",
        "library-restart",
        "catalog",
        "home",
        "home-restart",
        "storage-legacy",
        "storage-migrate",
        "storage-move",
        "storage-other-computer",
    ]
    .contains(&phase.as_str())
    {
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
                if ![
                    "first",
                    "second",
                    "lessons",
                    "lesson-restart",
                    "library",
                    "library-restart",
                    "catalog",
                    "home",
                    "home-restart",
                    "storage-legacy",
                    "storage-migrate",
                    "storage-move",
                    "storage-other-computer",
                ]
                .contains(&phase.as_str())
                {
                    return;
                }
                let script = format!(
                    "globalThis.__AI_PLAYER_SMOKE_PHASE__ = {};\n{}",
                    serde_json::json!(phase),
                    if phase.starts_with("storage-") {
                        include_str!("../../tests/desktop/notesStorage.js")
                    } else if phase.starts_with("home") {
                        include_str!("../../tests/desktop/home.js")
                    } else if phase == "catalog" {
                        include_str!("../../tests/desktop/courseCatalog.js")
                    } else if phase.starts_with("library") {
                        include_str!("../../tests/desktop/courseLibrary.js")
                    } else {
                        include_str!("../../tests/desktop/smoke.js")
                    }
                );
                if let Err(error) = webview.eval(&script) {
                    eprintln!("Desktop smoke injection failed: {error}");
                }
            }
        })
        .build()
}

#[tauri::command]
pub fn desktop_smoke_notes_directory(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    next: bool,
) -> Result<serde_json::Value, String> {
    if webview.label() != "main" {
        return Err("Invalid test host".into());
    }
    let parent = directory()?.with_extension(if next { "data-second" } else { "data-first" });
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    app.state::<crate::data_storage::DataStorage>()
        .choose(&parent, false)
}
