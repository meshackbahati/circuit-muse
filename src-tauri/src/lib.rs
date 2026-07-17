mod commands;

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Start the engine sidecar in the background
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
    use tauri_plugin_shell::process::{CommandChild, CommandEvent};
    use tauri_plugin_shell::ShellExt;

    // Try to start the engine sidecar
    match app.shell().sidecar("circuit-muse-engine") {
        Ok(command) => {
            let (mut rx, _child) = command.spawn().expect("Failed to spawn engine sidecar");

            // Listen for engine output
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes);
                        // Engine outputs "Starting on port XXXX" when ready
                        if line.contains("Starting on port") {
                            // Extract port from output
                            if let Some(port_str) = line.split("port ").nth(1) {
                                if let Ok(port) = port_str.trim().parse::<u16>() {
                                    let _ = app.emit("engine-ready", port);
                                }
                            }
                        }
                    }
                    CommandEvent::Stderr(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes);
                        eprintln!("[engine stderr] {}", line);
                    }
                    CommandEvent::Error(err) => {
                        eprintln!("[engine error] {}", err);
                    }
                    CommandEvent::Terminated(status) => {
                        eprintln!("[engine] exited with status: {:?}", status);
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("[engine] sidecar not found: {}. Falling back to manual start.", e);
            // Fallback: try to start engine from PATH or bundled location
            start_engine_fallback(app).await;
        }
    }
}

async fn start_engine_fallback(app: &tauri::AppHandle) {
    use tauri_plugin_shell::ShellExt;

    // Try common engine locations
    let paths = vec![
        "circuit-muse-engine",
        "./circuit-muse-engine",
        "../circuit-muse-engine",
    ];

    for path in paths {
        match app.shell().sidecar(path) {
            Ok(command) => {
                let (mut rx, _) = command.spawn().unwrap_or_else(|_| {
                    panic!("Failed to start engine from {}", path);
                });

                while let Some(event) = rx.recv().await {
                    if let tauri_plugin_shell::process::CommandEvent::Stdout(line) = event {
                        let line = String::from_utf8_lossy(&line);
                        if line.contains("Starting on port") {
                            if let Some(port_str) = line.split("port ").nth(1) {
                                if let Ok(port) = port_str.trim().parse::<u16>() {
                                    let _ = app.emit("engine-ready", port);
                                }
                            }
                        }
                    }
                }
                return;
            }
            Err(_) => continue,
        }
    }
}
