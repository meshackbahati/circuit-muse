mod commands;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Linux: force X11 and software rendering for compatibility with
    // low-resource machines that lack proper GPU/EGL support.
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

async fn start_engine(app: &tauri::AppHandle) {
    use tauri_plugin_shell::process::CommandEvent;
    use tauri_plugin_shell::ShellExt;

    match app.shell().sidecar("circuit-muse-engine") {
        Ok(command) => {
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
