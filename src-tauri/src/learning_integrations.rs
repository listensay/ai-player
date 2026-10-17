use crate::{db, AppState};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Manager;

#[derive(Default)]
pub struct CalendarServer {
    content: Arc<Mutex<String>>,
    url: Mutex<Option<String>>,
}

fn calendar_response(request: &str, token: &str, content: &str) -> String {
    let expected = format!("GET /{token}/learning.ics HTTP/1.");
    if !request.starts_with(&expected) {
        return "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into();
    }
    format!("HTTP/1.1 200 OK\r\nContent-Type: text/calendar; charset=utf-8\r\nCache-Control: no-cache\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",content.len(),content)
}

#[tauri::command]
pub async fn publish_learning_calendar(
    app: tauri::AppHandle,
    content: String,
) -> db::Result<String> {
    if content.len() > 8_000_000
        || !content.starts_with("BEGIN:VCALENDAR\r\n")
        || !content.ends_with("END:VCALENDAR\r\n")
    {
        return Err("日历内容无效".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let server = app.state::<CalendarServer>();
        let mut url = server.url.lock().map_err(|e| e.to_string())?;
        *server.content.lock().map_err(|e| e.to_string())? = content;
        if let Some(url) = url.as_ref() {
            return Ok(url.clone());
        }
        let state = app.state::<AppState>();
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let saved = db::request(
            &mut db,
            "settings",
            "GET",
            json!({"key":"learning-calendar-server"}),
            Value::Null,
        )?;
        let port = saved["port"]
            .as_u64()
            .filter(|p| *p > 1024 && *p <= 65535)
            .unwrap_or(0) as u16;
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .map_err(|_| "日历订阅端口暂不可用，请关闭占用该端口的应用后重试。".to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let token = saved["token"]
            .as_str()
            .and_then(|s| uuid::Uuid::parse_str(s).ok())
            .unwrap_or_else(uuid::Uuid::new_v4)
            .to_string();
        db::request(
            &mut db,
            "settings",
            "POST",
            json!({}),
            json!({"key":"learning-calendar-server","value":{"port":port,"token":token}}),
        )?;
        let link = format!("http://127.0.0.1:{port}/{token}/learning.ics");
        let content = Arc::clone(&server.content);
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
                let mut bytes = [0_u8; 2048];
                if let Ok(count) = stream.read(&mut bytes) {
                    if let Ok(value) = content.lock() {
                        let _ = stream.write_all(
                            calendar_response(
                                &String::from_utf8_lossy(&bytes[..count]),
                                &token,
                                &value,
                            )
                            .as_bytes(),
                        );
                    }
                }
            }
        });
        *url = Some(link.clone());
        Ok(link)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn calendar_subscription_command(location: &str) -> db::Result<Command> {
    #[cfg(target_os = "macos")]
    {
        // Calendar upgrades webcal to HTTPS; this loopback feed only serves HTTP.
        let mut command = Command::new("/usr/bin/open");
        command.args(["-b", "com.apple.iCal", location]);
        Ok(command)
    }
    #[cfg(not(target_os = "macos"))]
    resource_command(&location.replacen("http://", "webcal://", 1))
}

#[tauri::command]
pub async fn subscribe_learning_calendar(app: tauri::AppHandle) -> db::Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let location = app
            .state::<CalendarServer>()
            .url
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("日历订阅未就绪。")?;
        let status = calendar_subscription_command(&location)?
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("无法打开日历，请复制订阅链接到日历应用中添加。".into());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn resource_command(location: &str) -> db::Result<Command> {
    if location.is_empty() || location.len() > 12000 || location.chars().any(char::is_control) {
        return Err("作品地址无效。".into());
    }
    let valid_url = tauri::Url::parse(location).ok().is_some_and(|u| {
        matches!(u.scheme(), "https" | "http" | "webcal")
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
    });
    if !valid_url && !(Path::new(location).is_absolute() && Path::new(location).exists()) {
        return Err("作品地址或文件路径无效。".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = Command::new("xdg-open");
    command.arg(location);
    Ok(command)
}
#[tauri::command]
pub async fn open_learning_resource(location: String) -> db::Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        resource_command(&location)?
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn calendar_subscription_opens_http_in_apple_calendar() {
        let location = "http://127.0.0.1:63388/secret/learning.ics";
        let command = calendar_subscription_command(location).unwrap();
        assert_eq!(command.get_program(), "/usr/bin/open");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            ["-b", "com.apple.iCal", location]
        );
        let resource = resource_command("https://example.com/demo").unwrap();
        assert_eq!(resource.get_args().count(), 1);
    }

    #[test]
    fn calendar_requires_private_route_and_correct_method() {
        assert!(
            calendar_response("GET /secret/learning.ics HTTP/1.1\r\n", "secret", "你好")
                .contains("Content-Length: 6")
        );
        for request in [
            "GET /learning.ics HTTP/1.1",
            "POST /secret/learning.ics HTTP/1.1",
            "GET /wrong/learning.ics HTTP/1.1",
        ] {
            assert!(calendar_response(request, "secret", "private").contains("404"));
        }
    }
    #[test]
    fn resource_links_reject_shell_commands_and_non_web_protocols() {
        assert!(resource_command("javascript:alert(1)").is_err());
        assert!(resource_command("--args").is_err());
        assert!(resource_command("https://example.com/demo").is_ok());
    }
}
