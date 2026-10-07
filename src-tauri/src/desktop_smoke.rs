//! Compiled only into the separately identified desktop regression executable.
use std::{fs, path::PathBuf};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Wry,
};

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
                let script = format!(
                    "globalThis.__AI_PLAYER_SMOKE_PHASE__ = {};\n{}",
                    serde_json::json!(phase),
                    include_str!("../../tests/desktop/smoke.js")
                );
                if let Err(error) = webview.eval(&script) {
                    eprintln!("Desktop smoke injection failed: {error}");
                }
            }
        })
        .build()
}
