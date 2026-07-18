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

fn resolve_sidecar_path(_app: &tauri::AppHandle, name: &str) -> Option<String> {
    // Tauri bundles sidecar binaries in the same directory as the main executable.
    // On Linux/macOS they sit next to the binary; on Windows they're in the same dir.
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    let candidates = if cfg!(target_os = "windows") {
        vec![exe_dir.join(format!("{}.exe", name))]
    } else {
        vec![exe_dir.join(name)]
    };

    for path in candidates {
        if path.exists() {
            return path.to_str().map(String::from);
        }
    }
    None
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
            let (mut rx, _child) = command.spawn().expect("Failed to spawn engine sidecar");
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
        Err(e) => {
            eprintln!("[engine] sidecar not found: {}", e);
        }
    }
}
