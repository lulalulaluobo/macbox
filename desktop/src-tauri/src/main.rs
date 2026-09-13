use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use url::Url;

const DEFAULT_PORT: u16 = 19808;
const HEALTH_PATH: &str = "/api/auth/status";

struct BackendProcess(Mutex<Option<CommandChild>>);

fn config_port() -> u16 {
    let home = match env::var_os("HOME") {
        Some(value) => PathBuf::from(value),
        None => return DEFAULT_PORT,
    };
    let contents = match fs::read_to_string(home.join(".macbox").join("config.yaml")) {
        Ok(contents) => contents,
        Err(_) => return DEFAULT_PORT,
    };
    contents
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            if key.trim() != "port" {
                return None;
            }
            value.trim().parse::<u16>().ok().filter(|port| *port > 0)
        })
        .unwrap_or(DEFAULT_PORT)
}

fn desktop_command_path() -> String {
    let mut paths = vec![
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    if let Some(path) = env::var_os("PATH") {
        paths.push(path.to_string_lossy().into_owned());
    }
    paths.join(":")
}

fn backend_ready(port: u16) -> bool {
    let mut stream = match TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        Duration::from_millis(350),
    ) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request = format!(
        "GET {HEALTH_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = [0_u8; 256];
    let size = match stream.read(&mut response) {
        Ok(size) => size,
        Err(_) => return false,
    };
    let response = String::from_utf8_lossy(&response[..size]);
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn wait_for_backend(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if backend_ready(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let port = config_port();
            let mut child = None;

            // Reuse a backend already installed as a LaunchAgent instead of
            // starting a second process on the same port.
            if !backend_ready(port) {
                let (mut events, spawned) = app
                    .shell()
                    .sidecar("macbox")
                    .map_err(|error| format!("无法定位 MacBox 后端: {error}"))?
                    .args(["--host", "127.0.0.1"])
                    .env("PATH", desktop_command_path())
                    .spawn()
                    .map_err(|error| format!("无法启动 MacBox 后端: {error}"))?;
                child = Some(spawned);

                tauri::async_runtime::spawn(async move {
                    while let Some(event) = events.recv().await {
                        match event {
                            CommandEvent::Error(error) => eprintln!("[MacBox] {error}"),
                            CommandEvent::Stderr(line) => {
                                eprintln!("[MacBox] {}", String::from_utf8_lossy(&line))
                            }
                            CommandEvent::Stdout(line) => {
                                println!("[MacBox] {}", String::from_utf8_lossy(&line))
                            }
                            CommandEvent::Terminated(payload) => {
                                eprintln!("[MacBox] 后端已退出: {payload:?}");
                                break;
                            }
                            _ => {}
                        }
                    }
                });

                if !wait_for_backend(port, Duration::from_secs(30)) {
                    if let Some(child) = child.take() {
                        let _ = child.kill();
                    }
                    return Err("MacBox 后端启动超时，请查看 ~/.macbox/macbox.log".into());
                }
            }

            app.manage(BackendProcess(Mutex::new(child)));
            if let Some(window) = app.get_webview_window("main") {
                let address = Url::parse(&format!("http://127.0.0.1:{port}"))
                    .map_err(|error| format!("MacBox 地址无效: {error}"))?;
                window
                    .navigate(address)
                    .map_err(|error| format!("打开 MacBox 控制台失败: {error}"))?;
                window
                    .show()
                    .map_err(|error| format!("显示 MacBox 窗口失败: {error}"))?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<BackendProcess>() {
                    if let Ok(mut process) = state.0.lock() {
                        if let Some(child) = process.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 MacBox 桌面应用失败");
}
