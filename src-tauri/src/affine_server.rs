use std::{
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};
#[cfg(not(feature = "desktop-smoke"))]
use tauri::Manager;

// This loopback endpoint serves bundled assets only. All user content stays in
// the persistent WebView database, and privileged actions use scoped IPC.
pub fn start(app: &tauri::AppHandle) -> Result<String, String> {
    #[cfg(not(feature = "desktop-smoke"))]
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    #[cfg(feature = "desktop-smoke")]
    let directory = crate::desktop_smoke::directory()?;
    let settings = directory.join("affine-port");
    let port = match std::fs::read_to_string(&settings) {
        Ok(value) => value
            .trim()
            .parse::<u16>()
            .map_err(|_| "笔记地址配置无效")?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => 0,
        Err(e) => return Err(e.to_string()),
    };
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .map_err(|_| "笔记本机地址被占用，请关闭另一份应用后重试")?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::fs::write(&settings, port.to_string()).map_err(|e| e.to_string())?;
    let handle = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else {
                continue;
            };
            let app = handle.clone();
            std::thread::spawn(move || {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(20)));
                let mut bytes = Vec::new();
                let mut block = [0u8; 2048];
                while bytes.len() < 16384 && !bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut block) {
                        Ok(0) | Err(_) => return,
                        Ok(n) => bytes.extend_from_slice(&block[..n]),
                    }
                }
                let Ok(header) = std::str::from_utf8(&bytes) else {
                    return;
                };
                let Some(path) = request_path(header, port) else {
                    let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                    return;
                };
                let Ok(request) = tauri::http::Request::builder().uri(path).body(Vec::new()) else {
                    return;
                };
                let response = super::affine::asset_response(&app, request);
                let mut head = format!(
                    "HTTP/1.1 {}\r\nConnection: close\r\nContent-Length: {}\r\n",
                    response.status(),
                    response.body().len()
                );
                for (key, value) in response.headers() {
                    if let Ok(value) = value.to_str() {
                        head.push_str(&format!("{key}: {value}\r\n"));
                    }
                }
                head.push_str("\r\n");
                if stream.write_all(head.as_bytes()).is_ok() {
                    let _ = stream.write_all(response.body());
                }
            });
        }
    });
    Ok(format!("http://127.0.0.1:{port}"))
}

fn request_path(header: &str, port: u16) -> Option<&str> {
    if !header.contains("\r\n\r\n") {
        return None;
    }
    let mut words = header.lines().next()?.split_whitespace();
    if words.next()? != "GET" {
        return None;
    }
    let path = words.next()?;
    if !path.starts_with('/') || path.starts_with("//") || words.next()? != "HTTP/1.1" {
        return None;
    }
    let expected = format!("127.0.0.1:{port}");
    let hosts: Vec<_> = header
        .lines()
        .filter_map(|line| {
            line.split_once(':')
                .filter(|(key, _)| key.eq_ignore_ascii_case("host"))
                .map(|(_, value)| value.trim())
        })
        .collect();
    if hosts.as_slice() != [expected.as_str()] {
        return None;
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_local_asset_requests() {
        assert_eq!(
            request_path(
                "GET /js/app.js HTTP/1.1\r\nHost: 127.0.0.1:4300\r\n\r\n",
                4300
            ),
            Some("/js/app.js")
        );
        for header in [
            "POST / HTTP/1.1\r\nHost: 127.0.0.1:4300\r\n\r\n",
            "GET / HTTP/1.1\r\nHost: attacker.example\r\n\r\n",
            "GET //attacker.example HTTP/1.1\r\nHost: 127.0.0.1:4300\r\n\r\n",
        ] {
            assert!(request_path(header, 4300).is_none());
        }
    }
}
