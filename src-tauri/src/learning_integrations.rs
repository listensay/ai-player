use crate::{db, AppState};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

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
        let link = format!("webcal://127.0.0.1:{port}/{token}/learning.ics");
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

#[tauri::command]
pub async fn choose_knowledge_vault(app: tauri::AppHandle) -> db::Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("选择 Obsidian Vault / Markdown 知识库")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let folder = folder
            .into_path()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let path = folder.to_string_lossy().to_string();
        let state = app.state::<AppState>();
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        db::request(
            &mut db,
            "settings",
            "POST",
            json!({}),
            json!({"key":"learning-vault-root","value":path}),
        )?;
        Ok(Some(path))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn document_name(identity: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in identity.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("lesson-{hash:016x}.md")
}
fn vault_file(root: &Path, identity: &str) -> db::Result<PathBuf> {
    let base = root
        .canonicalize()
        .map_err(|_| "知识库目录不可用，请重新选择。".to_string())?;
    let directory = base.join("AI Player");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let directory = directory.canonicalize().map_err(|e| e.to_string())?;
    if !directory.starts_with(&base) {
        return Err("知识库目录指向了其他位置。".into());
    }
    let file = directory.join(document_name(identity));
    if file.exists() && file.canonicalize().map_err(|e| e.to_string())? != file {
        return Err("知识库文件不能是符号链接。".into());
    }
    Ok(file)
}
fn read_document(path: &Path) -> db::Result<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    if path.metadata().map_err(|e| e.to_string())?.len() > 4_000_000 {
        return Err("知识库文件过大。".into());
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}
fn write_document(path: &Path, content: &str, expected: &Option<String>) -> db::Result<()> {
    if read_document(path)? != *expected {
        return Err("知识库文件刚刚发生修改，请重新同步。".into());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("文件路径无效")?)
        .map_err(|e| e.to_string())?;
    temporary
        .write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn knowledge_vault_document(
    app: tauri::AppHandle,
    identity: String,
    content: Option<String>,
    expected: Option<String>,
) -> db::Result<Value> {
    if identity.is_empty()
        || identity.len() > 4000
        || content.as_ref().is_some_and(|s| s.len() > 4_000_000)
    {
        return Err("知识库文档无效。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let root = db::request(
            &mut *state.db.lock().map_err(|e| e.to_string())?,
            "settings",
            "GET",
            json!({"key":"learning-vault-root"}),
            Value::Null,
        )?;
        let root = root.as_str().ok_or("请先选择知识库目录。")?;
        let file = vault_file(Path::new(root), &identity)?;
        if let Some(content) = content {
            write_document(&file, &content, &expected)?;
        }
        Ok(json!({"content":read_document(&file)?,"path":file.to_string_lossy()}))
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
#[tauri::command]
pub async fn run_focus_shortcut(name: String) -> db::Result<()> {
    if name.trim().is_empty()
        || name.len() > 200
        || name.chars().any(char::is_control)
        || name.starts_with('-')
    {
        return Err("快捷指令名称无效。".into());
    }
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || {
        let mut child = Command::new("/usr/bin/shortcuts")
            .args(["run", &name])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|_| "无法启动快捷指令。".to_string())?;
        let started = std::time::Instant::now();
        loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                return if status.success() {
                    Ok(())
                } else {
                    Err("快捷指令未完成，请检查名称与系统权限。".into())
                };
            }
            if started.elapsed() > Duration::from_secs(30) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("快捷指令执行超时。".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    Err("此功能需要 macOS。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn vault_writes_are_atomic_and_check_external_edits() {
        let dir = tempfile::tempdir().unwrap();
        let file = vault_file(dir.path(), "../../test").unwrap();
        assert!(file.starts_with(dir.path().canonicalize().unwrap()));
        write_document(&file, "original", &None).unwrap();
        assert!(write_document(&file, "overwrite", &None).is_err());
        write_document(&file, "updated", &Some("original".into())).unwrap();
        assert_eq!(read_document(&file).unwrap(), Some("updated".into()));
    }
    #[test]
    fn resource_links_reject_shell_commands_and_non_web_protocols() {
        assert!(resource_command("javascript:alert(1)").is_err());
        assert!(resource_command("--args").is_err());
        assert!(resource_command("https://example.com/demo").is_ok());
    }
    #[cfg(unix)]
    #[test]
    fn vault_rejects_symlink_escape() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("AI Player")).unwrap();
        assert!(vault_file(root.path(), "lesson").is_err());
    }
}
