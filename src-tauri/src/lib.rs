mod asr;
mod db;
mod files;
mod media_duration;
use rusqlite::Connection;
use serde_json::Value;
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    db: Mutex<Connection>,
    roots: Mutex<HashSet<PathBuf>>,
    frontend_ready: AtomicBool,
}

#[tauri::command]
async fn database_request(
    app: tauri::AppHandle,
    endpoint: String,
    method: String,
    query: Value,
    body: Value,
) -> db::Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        db::request(&mut conn, &endpoint, &method, query, body)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_learning_plan(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> db::Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let safe_name = PathBuf::from(name)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "学习路线.json".into());
        let Some(path) = app
            .dialog()
            .file()
            .set_title("导出学习路线")
            .set_file_name(safe_name)
            .add_filter("JSON", &["json"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        std::fs::write(path.into_path().map_err(|e| e.to_string())?, content)
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn frontend_ready(state: tauri::State<AppState>) {
    state.frontend_ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn finish_close(app: tauri::AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .manage(asr::AsrManager::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // 调试窗口不能与已安装的正式版互相覆盖学习数据。
            let directory = app.path().app_data_dir()?;
            let directory = if cfg!(debug_assertions) {
                directory.join("development")
            } else {
                directory
            };
            std::fs::create_dir_all(&directory)?;
            let conn = db::open(&directory.join("ai-player.db")).map_err(std::io::Error::other)?;
            let roots = files::saved_roots(&conn).map_err(std::io::Error::other)?;
            for root in &roots {
                app.asset_protocol_scope().allow_directory(root, true)?;
            }
            app.manage(AppState {
                db: Mutex::new(conn),
                roots: Mutex::new(roots),
                frontend_ready: AtomicBool::new(false),
            });
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            asr::confirm_asr_quit,
            asr::asr_start,
            asr::asr_stop,
            asr::asr_health,
            asr::asr_transcribe,
            asr::asr_cancel,
            frontend_ready,
            finish_close,
            database_request,
            export_learning_plan,
            files::choose_course_folder,
            files::course_locations,
            files::save_course_location,
            files::fs_stat,
            files::fs_video_metadata,
            files::fs_entries,
            files::fs_child,
            files::fs_read,
            files::fs_write
        ])
        .build(tauri::generate_context!())
        .expect("启动 AI Player 失败")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<asr::AsrManager>().shutdown();
            }
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none()
                    && app
                        .state::<AppState>()
                        .frontend_ready
                        .load(Ordering::SeqCst)
                {
                    api.prevent_exit();
                    let _ = app.emit("desktop-quit-requested", ());
                }
            }
        });
}
