use crate::{db, files, AppState};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};

#[derive(Default)]
struct Runtime {
    child: Option<Child>,
    port: Option<u16>,
    token: String,
    error: String,
    started: Option<Instant>,
    jobs: HashSet<String>,
}
#[derive(Default, Clone)]
pub struct AsrManager(Arc<Mutex<Runtime>>);

fn stop_process(runtime: &mut Runtime) {
    if let Some(mut child) = runtime.child.take() {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    runtime.port = None;
    runtime.jobs.clear();
}
impl AsrManager {
    pub fn shutdown(&self) {
        if let Ok(mut runtime) = self.0.lock() {
            stop_process(&mut runtime);
        }
    }
    fn connection(&self) -> db::Result<(String, String)> {
        let mut runtime = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(child) = runtime.child.as_mut() {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                runtime.child = None;
                runtime.port = None;
                runtime.error = format!("转写服务已退出（{status}），请重新启动");
            }
        }
        if !runtime.error.is_empty() {
            return Err(runtime.error.clone());
        }
        let port = runtime.port.ok_or("转写服务正在启动")?;
        Ok((format!("http://127.0.0.1:{port}"), runtime.token.clone()))
    }
}
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("HTTP client")
}

#[tauri::command]
pub async fn asr_start(
    app: tauri::AppHandle,
    manager: tauri::State<'_, AsrManager>,
) -> db::Result<()> {
    let mut runtime = manager.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = runtime.child.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(());
        }
    }
    stop_process(&mut runtime);
    let base = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("runtime")
    };
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let log_path = data.join("asr.log");
    if fs::metadata(&log_path)
        .map(|s| s.len() > 2_000_000)
        .unwrap_or(false)
    {
        let _ = fs::rename(&log_path, data.join("asr.previous.log"));
    }
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| e.to_string())?;
    let token = uuid::Uuid::new_v4().to_string();
    let platform = if cfg!(target_os = "windows") {
        "win"
    } else {
        std::env::consts::OS
    };
    let platform = if platform == "macos" {
        "darwin"
    } else {
        platform
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "ia32",
        v => v,
    };
    let libraries = base.join(format!("node_modules/sherpa-onnx-{platform}-{arch}"));
    let mut command = Command::new(base.join(if cfg!(windows) { "node.exe" } else { "node" }));
    command
        .arg(base.join("asr-server/server.mjs"))
        .current_dir(&data)
        .env("ASR_PORT", "0")
        .env("ASR_TOKEN", &token)
        .env("AI_PLAYER_PARENT_PID", std::process::id().to_string())
        .env("AI_PLAYER_MODEL_DIR", data.join("models"))
        .env(
            "AI_PLAYER_FFMPEG",
            base.join(if cfg!(windows) {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            }),
        )
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(log.try_clone().map_err(|e| e.to_string())?);
    #[cfg(target_os = "macos")]
    command.env("DYLD_LIBRARY_PATH", &libraries);
    #[cfg(target_os = "linux")]
    command.env("LD_LIBRARY_PATH", &libraries);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command
            .env(
                "PATH",
                format!(
                    "{};{}",
                    libraries.display(),
                    std::env::var("PATH").unwrap_or_default()
                ),
            )
            .creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动内置转写服务：{e}"))?;
    let stdout = child.stdout.take().ok_or("转写服务输出不可用")?;
    let pid = child.id();
    runtime.child = Some(child);
    runtime.port = None;
    runtime.token = token;
    runtime.error.clear();
    runtime.started = Some(Instant::now());
    let shared = manager.0.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(event) = serde_json::from_str::<Value>(&line) {
                if event["event"] == "listening" {
                    if let Some(port) = event["port"].as_u64().and_then(|p| u16::try_from(p).ok()) {
                        if let Ok(mut runtime) = shared.lock() {
                            if runtime.child.as_ref().map(|c| c.id()) == Some(pid) {
                                runtime.port = Some(port);
                            }
                        }
                    }
                }
            }
            let _ = writeln!(log, "{line}");
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn asr_health(manager: tauri::State<'_, AsrManager>) -> db::Result<Value> {
    let connection = manager.connection();
    let (url, token) = match connection {
        Ok(c) => c,
        Err(error) => {
            let runtime = manager.0.lock().map_err(|e| e.to_string())?;
            let status = if !runtime.error.is_empty()
                || runtime
                    .started
                    .is_some_and(|s| s.elapsed() > Duration::from_secs(30))
                    && runtime.child.is_some()
            {
                "error"
            } else if runtime.child.is_some() {
                "checking"
            } else {
                "stopped"
            };
            return Ok(
                json!({"status":status, "error":if status=="error" {error} else {String::new()}}),
            );
        }
    };
    client()
        .get(format!("{url}/health"))
        .bearer_auth(token)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn asr_stop(manager: tauri::State<AsrManager>) -> db::Result<()> {
    let mut runtime = manager.0.lock().map_err(|e| e.to_string())?;
    if !runtime.jobs.is_empty() {
        return Err("请先取消正在进行的转写任务".into());
    }
    stop_process(&mut runtime);
    runtime.error.clear();
    runtime.started = None;
    Ok(())
}
#[tauri::command]
pub async fn asr_cancel(manager: tauri::State<'_, AsrManager>, job_id: String) -> db::Result<()> {
    let (url, token) = manager.connection()?;
    client()
        .post(format!("{url}/cancel"))
        .bearer_auth(token)
        .json(&json!({"jobId":job_id}))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn asr_transcribe(
    app: tauri::AppHandle,
    manager: tauri::State<'_, AsrManager>,
    root: String,
    relative: String,
    duration: f64,
    job_id: String,
    on_event: Channel<Value>,
) -> db::Result<Value> {
    let path = files::authorized(&app.state::<AppState>(), &root, &relative, false)?;
    if !path.is_file() {
        return Err("请选择视频文件".into());
    }
    let (url, token) = manager.connection()?;
    manager
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .jobs
        .insert(job_id.clone());
    let result = async {
        let response = client()
            .post(format!("{url}/transcribe-local"))
            .bearer_auth(token)
            .json(&json!({"path":path,"duration":duration,"jobId":job_id}))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            let body: Value = response.json().await.map_err(|e| e.to_string())?;
            return Err(body["error"].as_str().unwrap_or("转写失败").to_string());
        }
        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        let mut completed = None;
        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
            while let Some(end) = buffer.windows(2).position(|b| b == b"\n\n") {
                let block = String::from_utf8_lossy(&buffer[..end]).into_owned();
                buffer.drain(..end + 2);
                let mut event = "message";
                let mut data = "";
                for line in block.lines() {
                    if let Some(v) = line.strip_prefix("event: ") {
                        event = v;
                    } else if let Some(v) = line.strip_prefix("data: ") {
                        data = v;
                    }
                }
                if let Ok(value) = serde_json::from_str::<Value>(data) {
                    if event == "error" {
                        return Err(value["message"].as_str().unwrap_or("转写失败").to_string());
                    }
                    if event == "done" {
                        completed = Some(value.clone());
                    }
                    on_event
                        .send(json!({"event":event,"data":value}))
                        .map_err(|e| e.to_string())?;
                }
            }
            if buffer.len() > 2_000_000 {
                return Err("转写响应过大".into());
            }
        }
        completed.ok_or_else(|| "转写已取消或中断".into())
    }
    .await;
    manager
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .jobs
        .remove(&job_id);
    result
}

#[tauri::command]
pub async fn confirm_asr_quit(app: tauri::AppHandle) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message("仍有转写任务正在进行。退出将停止未完成任务，已保存的字幕和笔记会保留。")
            .title("退出 AI Player")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "停止并退出".into(),
                "继续转写".into(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false)
}
