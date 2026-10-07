use std::{
    io::{Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

pub struct Output {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub overflow: bool,
}

fn terminate(child: &mut Child) {
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

fn capture(mut stream: impl Read, overflow: Arc<AtomicBool>) -> String {
    let mut result = Vec::new();
    let mut buffer = [0; 4096];
    while let Ok(count) = stream.read(&mut buffer) {
        if count == 0 {
            break;
        }
        let remaining = 64 * 1024 - result.len();
        result.extend_from_slice(&buffer[..count.min(remaining)]);
        if count > remaining {
            overflow.store(true, Ordering::SeqCst);
        }
    }
    String::from_utf8_lossy(&result).into_owned()
}

/// No shell interpolation. Every process has a deadline and its own process group.
pub fn run(
    executable: &Path,
    args: &[String],
    directory: &Path,
    input: &str,
    timeout: Duration,
    cancelled: &AtomicBool,
    search_path: Option<&std::ffi::OsStr>,
) -> Result<Output, String> {
    if cancelled.load(Ordering::SeqCst) {
        return Err("已取消代码执行。".into());
    }
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = search_path {
        command.env("PATH", path);
    }
    command
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .env("DOTNET_NOLOGO", "1");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动运行环境：{e}"))?;
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout = child.stdout.take().ok_or("无法读取运行输出")?;
    let stderr = child.stderr.take().ok_or("无法读取运行错误")?;
    let out_flag = overflow.clone();
    let err_flag = overflow.clone();
    let out_thread = thread::spawn(move || capture(stdout, out_flag));
    let err_thread = thread::spawn(move || capture(stderr, err_flag));
    let mut stdin = child.stdin.take().ok_or("无法写入测试输入")?;
    let bytes = input.as_bytes().to_vec();
    let writer = thread::spawn(move || {
        let _ = stdin.write_all(&bytes);
    });
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if cancelled.load(Ordering::SeqCst)
            || overflow.load(Ordering::SeqCst)
            || start.elapsed() >= timeout
        {
            timed_out = start.elapsed() >= timeout;
            terminate(&mut child);
            break None;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                terminate(&mut child);
                break Some(status);
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                terminate(&mut child);
                break None;
            }
        }
    };
    let _ = writer.join();
    let stdout = out_thread.join().unwrap_or_default();
    let stderr = err_thread.join().unwrap_or_default();
    if cancelled.load(Ordering::SeqCst) {
        return Err("已取消代码执行。".into());
    }
    Ok(Output {
        success: status.is_some_and(|s| s.success()),
        stdout,
        stderr,
        timed_out,
        overflow: overflow.load(Ordering::SeqCst),
    })
}
