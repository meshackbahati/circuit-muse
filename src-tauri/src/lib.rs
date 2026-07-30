mod commands;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Force software rendering on Linux — prevents EGL_BAD_PARAMETER white screen
    // on systems without proper GPU drivers or Wayland compositor issues.
    // Must be set BEFORE Tauri creates the webview.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                start_engine(&handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::serial::list_serial_ports,
            commands::debug::write_debug_log,
            commands::qemu::esp32_qemu_status,
            commands::qemu::esp32_qemu_install,
            commands::qemu::stm32_qemu_status,
            commands::qemu::stm32_qemu_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn get_target_triple() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    { "x86_64-pc-windows-msvc" }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    { "x86_64-unknown-linux-gnu" }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    { "aarch64-unknown-linux-gnu" }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    { "x86_64-apple-darwin" }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    { "aarch64-apple-darwin" }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64")
    )))]
    { "unknown" }
}

fn resolve_sidecar_path(_app: &tauri::AppHandle, name: &str) -> Option<String> {
    // Tauri bundles sidecar binaries in the same directory as the main executable.
    // On Linux/macOS they sit next to the binary; on Windows they're in the same dir.
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let triple = get_target_triple();

    let candidates = if cfg!(target_os = "windows") {
        vec![
            exe_dir.join(format!("{}-{}.exe", name, triple)),
            exe_dir.join(format!("{}.exe", name)),
        ]
    } else {
        vec![
            exe_dir.join(format!("{}-{}", name, triple)),
            exe_dir.join(name),
        ]
    };

    for path in candidates {
        if path.exists() {
            return path.to_str().map(String::from);
        }
    }
    None
}

fn find_engine_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    let mut candidates = vec![
        std::path::PathBuf::from("engine"),
    ];
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(parent) = exe_dir.parent() {
            candidates.push(parent.join("engine"));
            candidates.push(parent.join("../../../engine"));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("engine"));
    }

    for path in candidates {
        if path.join("__main__.py").exists() {
            return Some(path);
        }
    }
    None
}

fn spawn_python_fallback(app: &tauri::AppHandle, engine_dir: &std::path::Path, arduino_cli_path: &Option<String>) -> Option<()> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    let engine_dir_str = engine_dir.to_string_lossy().to_string();

    // Try python3 first, then python
    let mut child = Command::new("python3")
        .arg(&engine_dir_str)
        .env("ARDUINO_CLI_PATH", arduino_cli_path.as_deref().unwrap_or(""))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .or_else(|_| {
            Command::new("python")
                .arg(&engine_dir_str)
                .env("ARDUINO_CLI_PATH", arduino_cli_path.as_deref().unwrap_or(""))
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        })
        .ok()?;

    let stdout = child.stdout.take()?;
    let stderr = child.stderr.take()?;
    let app_clone = app.clone();

    // Read stdout in a background thread
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line_result in reader.lines() {
            if let Ok(line) = line_result {
                println!("[engine-python-stdout] {}", line);
                if line.contains("Starting on port") {
                    if let Some(port_str) = line.split("port ").nth(1) {
                        if let Ok(port) = port_str.trim().parse::<u16>() {
                            let _ = app_clone.emit("engine-ready", port);
                        }
                    }
                }
            } else {
                break;
            }
        }
    });

    // Read stderr in a background thread
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line_result in reader.lines() {
            if let Ok(line) = line_result {
                eprintln!("[engine-python-stderr] {}", line);
            } else {
                break;
            }
        }
    });

    Some(())
}

async fn start_engine(app: &tauri::AppHandle) {
    use tauri_plugin_shell::process::CommandEvent;
    use tauri_plugin_shell::ShellExt;

    // Resolve arduino-cli sidecar path and pass it to the engine via env var.
    // Tauri places all sidecar binaries alongside the main executable.
    let arduino_cli_path = resolve_sidecar_path(app, "arduino-cli");
    if let Some(ref p) = arduino_cli_path {
        eprintln!("[engine] arduino-cli sidecar: {}", p);
    }

    match app.shell().sidecar("circuit-muse-engine") {
        Ok(command) => {
            let mut command = command;
            if let Some(ref cli_path) = arduino_cli_path {
                command = command.env("ARDUINO_CLI_PATH", cli_path);
            }
            match command.spawn() {
                Ok((mut rx, _child)) => {
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line_bytes) => {
                                let line = String::from_utf8_lossy(&line_bytes);
                                if line.contains("Starting on port") {
                                    if let Some(port_str) = line.split("port ").nth(1) {
                                        if let Ok(port) = port_str.trim().parse::<u16>() {
                                            let _ = app.emit("engine-ready", port);
                                        }
                                    }
                                }
                            }
                            CommandEvent::Stderr(line_bytes) => {
                                eprintln!("[engine] {}", String::from_utf8_lossy(&line_bytes));
                            }
                            CommandEvent::Error(err) => {
                                eprintln!("[engine] error: {}", err);
                            }
                            CommandEvent::Terminated(status) => {
                                eprintln!("[engine] exited: {:?}", status);
                            }
                            _ => {}
                        }
                    }
                }
                Err(err) => {
                    eprintln!("[engine] Failed to spawn engine sidecar: {}. Trying Python fallback...", err);
                    if let Some(engine_dir) = find_engine_dir(app) {
                        if spawn_python_fallback(app, &engine_dir, &arduino_cli_path).is_some() {
                            eprintln!("[engine] Python fallback started successfully from {}", engine_dir.display());
                            return;
                        }
                    }
                    eprintln!("[engine] Python fallback failed.");
                }
            }
        }
        Err(e) => {
            eprintln!("[engine] sidecar not found: {}. Trying Python fallback...", e);
            if let Some(engine_dir) = find_engine_dir(app) {
                if spawn_python_fallback(app, &engine_dir, &arduino_cli_path).is_some() {
                    eprintln!("[engine] Python fallback started successfully from {}", engine_dir.display());
                    return;
                }
            }
            eprintln!("[engine] Python fallback failed.");
        }
    }
}
