mod commands;
mod engine_process;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(engine_process::EngineProcess::default())
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Without this the engine and every QEMU process it started keep
            // running, with their memory, after the window is closed.
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                app.state::<engine_process::EngineProcess>().stop();
            }
        });
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

fn qemu_binary_path(app: &tauri::AppHandle, arch: &str) -> Option<String> {
    use tauri::Manager;
    let name = match arch {
        "esp32" => "qemu-system-xtensa",
        "riscv32" => "qemu-system-riscv32",
        _ => return None,
    };
    let name = if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let path = app
        .path()
        .app_data_dir()
        .ok()?
        .join("qemu")
        .join("esp32")
        .join("bin")
        .join(name);
    Some(path.to_string_lossy().to_string())
}

fn spawn_python_fallback(
    app: &tauri::AppHandle,
    engine_dir: &std::path::Path,
    arduino_cli_path: &Option<String>,
    qemu_xtensa_path: &Option<String>,
) -> Option<()> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    let engine_dir_str = engine_dir.to_string_lossy().to_string();

    // Look for virtual environment python executable
    let venv_python = if cfg!(target_os = "windows") {
        engine_dir.join("venv").join("Scripts").join("python.exe")
    } else {
        engine_dir.join("venv").join("bin").join("python")
    };

    let mut child = if venv_python.exists() {
        eprintln!("[engine] Spawning fallback using virtualenv python: {}", venv_python.display());
        Command::new(venv_python)
            .arg(&engine_dir_str)
            .env("ARDUINO_CLI_PATH", arduino_cli_path.as_deref().unwrap_or(""))
            .env("QEMU_ESP32_BINARY", qemu_xtensa_path.as_deref().unwrap_or("qemu-system-xtensa"))
            .env("CIRCUIT_MUSE_PARENT_PID", std::process::id().to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .ok()
    } else {
        None
    };

    // Try system python3, then system python if virtualenv wasn't found or failed to spawn
    if child.is_none() {
        child = Command::new("python3")
            .arg(&engine_dir_str)
            .env("ARDUINO_CLI_PATH", arduino_cli_path.as_deref().unwrap_or(""))
            .env("QEMU_ESP32_BINARY", qemu_xtensa_path.as_deref().unwrap_or("qemu-system-xtensa"))
            .env("CIRCUIT_MUSE_PARENT_PID", std::process::id().to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .or_else(|_| {
                Command::new("python")
                    .arg(&engine_dir_str)
                    .env("ARDUINO_CLI_PATH", arduino_cli_path.as_deref().unwrap_or(""))
                    .env("QEMU_ESP32_BINARY", qemu_xtensa_path.as_deref().unwrap_or("qemu-system-xtensa"))
                    .env("CIRCUIT_MUSE_PARENT_PID", std::process::id().to_string())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
            })
            .ok();
    }

    let mut child = child?;
    let stdout = child.stdout.take()?;
    let stderr = child.stderr.take()?;
    let app_clone = app.clone();
    {
        use tauri::Manager;
        app.state::<engine_process::EngineProcess>()
            .set(engine_process::EngineChild::Std(child));
    }

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
    let qemu_xtensa_path = qemu_binary_path(app, "esp32");
    let qemu_riscv_path = qemu_binary_path(app, "riscv32");

    // Tauri bundles external binaries under their target-triple filename
    // (for example `circuit-muse-engine-x86_64-unknown-linux-gnu`). The
    // shell plugin's `sidecar("circuit-muse-engine")` resolves the plain
    // unsuffixed name, which is absent in installed packages on Linux,
    // Windows, and macOS. Resolve the bundled filename next to the app and
    // spawn that exact path. Keep the plugin lookup as a dev-mode fallback.
    let engine_sidecar = match resolve_sidecar_path(app, "circuit-muse-engine") {
        Some(path) => {
            eprintln!("[engine] engine sidecar: {}", path);
            Ok(app.shell().command(path))
        }
        None => app.shell().sidecar("circuit-muse-engine"),
    };

    match engine_sidecar {
        Ok(command) => {
            let mut command =
                command.env("CIRCUIT_MUSE_PARENT_PID", std::process::id().to_string());
            if let Some(ref cli_path) = arduino_cli_path {
                command = command.env("ARDUINO_CLI_PATH", cli_path);
            }
            if let Some(ref path) = qemu_xtensa_path {
                command = command.env("QEMU_ESP32_BINARY", path);
            }
            if let Some(ref path) = qemu_riscv_path {
                if std::path::Path::new(path).exists() {
                    command = command.env("QEMU_RISCV32_BINARY", path);
                }
            }
            match command.spawn() {
                Ok((mut rx, child)) => {
                    use tauri::Manager;
                    app.state::<engine_process::EngineProcess>()
                        .set(engine_process::EngineChild::Sidecar(child));
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
                        if spawn_python_fallback(app, &engine_dir, &arduino_cli_path, &qemu_xtensa_path).is_some() {
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
                if spawn_python_fallback(app, &engine_dir, &arduino_cli_path, &qemu_xtensa_path).is_some() {
                    eprintln!("[engine] Python fallback started successfully from {}", engine_dir.display());
                    return;
                }
            }
            eprintln!("[engine] Python fallback failed.");
        }
    }
}
