mod asr;
mod backups;
mod companion;
mod db;
#[cfg(feature = "desktop-smoke")]
mod desktop_smoke;
mod files;
mod learning_integrations;
mod mac_reminders;
mod media_duration;
mod notion;
#[cfg(target_os = "macos")]
mod notion_popup_macos;
mod programming;
mod programming_process;
mod reminder_links;
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
    restore_pending: AtomicBool,
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
        if method != "GET" && state.restore_pending.load(Ordering::SeqCst) {
            return Err("恢复已准备完成，请重新启动应用".into());
        }
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
async fn export_study_digest(
    app: tauri::AppHandle,
    name: String,
    format: String,
    bytes: Vec<u8>,
) -> db::Result<bool> {
    if bytes.len() > 20_000_000 || !matches!(format.as_str(), "md" | "png" | "ics") {
        return Err("报告格式或大小无效".into());
    }
    if (format == "png" && !bytes.starts_with(b"\x89PNG\r\n\x1a\n"))
        || (matches!(format.as_str(), "md" | "ics") && std::str::from_utf8(&bytes).is_err())
    {
        return Err("报告内容无效".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let safe_name = PathBuf::from(name)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| format!("Playbo-report.{format}"));
        let Some(path) = app
            .dialog()
            .file()
            .set_title("导出学习报告")
            .set_file_name(safe_name)
            .add_filter("学习报告", &[format.as_str()])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        std::fs::write(path.into_path().map_err(|e| e.to_string())?, bytes)
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_performance_report(app: tauri::AppHandle, content: String) -> db::Result<bool> {
    if content.len() > 32_768 || serde_json::from_str::<Value>(&content).is_err() {
        return Err("性能报告格式无效".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title("导出本地性能报告")
            .set_file_name("AI-Player-performance.json")
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
    let builder = tauri::Builder::default();
    #[cfg(feature = "desktop-smoke")]
    let builder = builder.plugin(desktop_smoke::init());
    builder
        .manage(asr::AsrManager::default())
        .manage(programming::ProgrammingManager::default())
        .manage(reminder_links::ReminderLinks::default())
        .manage(learning_integrations::CalendarServer::default())
        .manage(companion::CompanionHitState::default())
        .manage(notion::NotionState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(not(feature = "desktop-smoke"))]
            let directory = app.path().app_data_dir()?;
            #[cfg(not(feature = "desktop-smoke"))]
            let directory = if std::env::var("AI_PLAYER_DEV_ISOLATE")
                .map(|v| v == "1")
                .unwrap_or(false)
            {
                directory.join("development")
            } else {
                directory
            };
            #[cfg(feature = "desktop-smoke")]
            let directory = desktop_smoke::directory().map_err(std::io::Error::other)?;
            std::fs::create_dir_all(&directory)?;
            let backups = backups::initialize(&directory, &app.package_info().version.to_string())
                .map_err(std::io::Error::other)?;
            app.manage(backups);
            let conn = db::open(&directory.join("ai-player.db")).map_err(std::io::Error::other)?;
            let roots = files::saved_roots(&conn).map_err(std::io::Error::other)?;
            for root in &roots {
                app.asset_protocol_scope().allow_directory(root, true)?;
            }
            app.manage(AppState {
                db: Mutex::new(conn),
                roots: Mutex::new(roots),
                frontend_ready: AtomicBool::new(false),
                restore_pending: AtomicBool::new(false),
            });
            backups::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(feature = "desktop-smoke")]
            desktop_smoke::desktop_smoke_report,
            #[cfg(feature = "desktop-smoke")]
            desktop_smoke::desktop_smoke_notion,
            #[cfg(feature = "desktop-smoke")]
            desktop_smoke::desktop_smoke_notion_popup,
            backups::backup_status,
            backups::set_backup_enabled,
            backups::create_backup,
            backups::import_backup,
            backups::export_backup,
            backups::restore_backup,
            backups::restart_after_restore,
            asr::confirm_asr_quit,
            asr::asr_start,
            asr::asr_stop,
            asr::asr_health,
            asr::asr_transcribe,
            asr::asr_cancel,
            programming::programming_environments,
            programming::choose_programming_directory,
            programming::run_programming,
            programming::cancel_programming,
            frontend_ready,
            finish_close,
            notion::notion_prepare,
            notion::notion_layout,
            notion::notion_action,
            companion::open_companion,
            companion::close_companion,
            companion::companion_is_open,
            companion::set_companion_hit_regions,
            companion::set_companion_fullscreen,
            companion::reveal_learning_window,
            database_request,
            export_learning_plan,
            export_study_digest,
            learning_integrations::publish_learning_calendar,
            learning_integrations::choose_knowledge_vault,
            learning_integrations::knowledge_vault_document,
            learning_integrations::open_learning_resource,
            learning_integrations::run_focus_shortcut,
            export_performance_report,
            mac_reminders::mac_reminders_status,
            mac_reminders::mac_reminders_export,
            mac_reminders::mac_reminders_remove,
            reminder_links::pending_reminder_link,
            reminder_links::acknowledge_reminder_link,
            reminder_links::resolve_reminder_link,
            reminder_links::resolve_lesson_link,
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
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { ref urls } = event {
                reminder_links::opened(app, urls);
            }
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<asr::AsrManager>().shutdown();
                app.state::<programming::ProgrammingManager>().shutdown();
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
