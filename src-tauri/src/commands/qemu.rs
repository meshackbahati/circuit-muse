use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
pub struct QemuStatus {
    pub installed: bool,
    pub path: Option<String>,
}

fn qemu_dir(app: &AppHandle, arch: &str) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e: tauri::Error| e.to_string())?;
    Ok(data_dir.join("qemu").join(arch))
}

fn qemu_binary_name(arch: &str) -> &'static str {
    match arch {
        "esp32" => "qemu-system-xtensa",
        "riscv32" => "qemu-system-riscv32",
        "stm32" => "qemu-system-arm",
        _ => "qemu-system-unknown",
    }
}

fn qemu_status_for(app: &AppHandle, arch: &str) -> Result<QemuStatus, String> {
    let dir = qemu_dir(app, arch)?;
    let bin_name = if cfg!(target_os = "windows") {
        format!("{}.exe", qemu_binary_name(arch))
    } else {
        qemu_binary_name(arch).to_string()
    };
    let bin_path = dir.join("bin").join(&bin_name);
    Ok(QemuStatus {
        installed: bin_path.exists(),
        path: Some(dir.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub fn esp32_qemu_status(app: AppHandle) -> Result<QemuStatus, String> {
    qemu_status_for(&app, "esp32")
}

#[tauri::command]
pub fn stm32_qemu_status(app: AppHandle) -> Result<QemuStatus, String> {
    qemu_status_for(&app, "stm32")
}

#[tauri::command]
pub async fn esp32_qemu_install(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    let dir = qemu_dir(&app, "esp32")?;
    std::fs::create_dir_all(&dir).map_err(|e: std::io::Error| e.to_string())?;
    let event_name = "esp32-qemu-progress".to_string();
    let _ = window.emit(&event_name, serde_json::json!({"phase": "downloading"}));

    let tag = "esp-develop-9.2.2-20260417";
    let base = format!("https://github.com/espressif/qemu/releases/download/{}", tag);
    let filename = if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") {
        "qemu-xtensa-softmmu-esp_develop_9.2.2_20260417-x86_64-linux-gnu.tar.xz"
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
        "qemu-xtensa-softmmu-esp_develop_9.2.2_20260417-aarch64-linux-gnu.tar.xz"
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        "qemu-xtensa-softmmu-esp_develop_9.2.2_20260417-aarch64-apple-darwin.tar.xz"
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "x86_64") {
        "qemu-xtensa-softmmu-esp_develop_9.2.2_20260417-x86_64-apple-darwin.tar.xz"
    } else if cfg!(target_os = "windows") {
        "qemu-xtensa-softmmu-esp_develop_9.2.2_20260417-x86_64-w64-mingw32.tar.xz"
    } else {
        return Err("Unsupported platform".to_string());
    };
    let url = format!("{}/{}", base, filename);

    // Use spawn_blocking so async runtime isn't frozen during download
    let dir_clone = dir.clone();
    let event_clone = event_name.clone();
    let window_clone = window.clone();

    tokio::task::spawn_blocking(move || {
        use std::io::{Read, Write};

        // Emit starting phase
        let _ = window_clone.emit(&event_clone, serde_json::json!({
            "phase": "starting",
            "progress": 0
        }));

        // Configure client with User-Agent
        let client = reqwest::blocking::Client::builder()
            .user_agent("CircuitMuse/1.0")
            .build()
            .map_err(|e| format!("Client creation failed: {}", e))?;

        let mut resp = client.get(&url)
            .send()
            .map_err(|e| format!("Download failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Download failed with status: {}", resp.status()));
        }

        let total_size = resp.content_length().unwrap_or(0);
        let tarball = dir_clone.join("download.tar.xz");
        let mut file = std::fs::File::create(&tarball).map_err(|e| format!("File creation failed: {}", e))?;

        let mut downloaded = 0;
        let mut last_emit = std::time::Instant::now();
        let mut buffer = [0; 16384];

        while let Ok(len) = resp.read(&mut buffer) {
            if len == 0 {
                break;
            }
            file.write_all(&buffer[..len]).map_err(|e| format!("Write failed: {}", e))?;
            downloaded += len;

            if last_emit.elapsed().as_millis() > 100 {
                let pct = if total_size > 0 {
                    (downloaded as f64 / total_size as f64 * 100.0) as u32
                } else {
                    0
                };
                let _ = window_clone.emit(&event_clone, serde_json::json!({
                    "phase": "downloading",
                    "progress": pct,
                    "bytes_downloaded": downloaded,
                    "total_bytes": total_size
                }));
                last_emit = std::time::Instant::now();
            }
        }

        // Emit final downloading progress
        let _ = window_clone.emit(&event_clone, serde_json::json!({
            "phase": "downloading",
            "progress": 100,
            "bytes_downloaded": downloaded,
            "total_bytes": total_size
        }));

        // Emit extracting phase
        let _ = window_clone.emit(&event_clone, serde_json::json!({
            "phase": "extracting",
            "progress": 100,
            "bytes_downloaded": downloaded,
            "total_bytes": total_size
        }));

        // Extract - try tar first, then try System32 tar on Windows, then fall back to 7z
        let tarball_str = tarball.to_string_lossy().to_string();
        let dir_str = dir_clone.to_string_lossy().to_string();

        let mut cmd = std::process::Command::new("tar");
        cmd.args(["xf", &tarball_str, "-C", &dir_str, "--strip-components=1"]);

        let status = cmd.status()
            .or_else(|_| {
                if cfg!(target_os = "windows") {
                    let system32_tar = std::path::PathBuf::from(r"C:\Windows\System32\tar.exe");
                    if system32_tar.exists() {
                        return std::process::Command::new(system32_tar)
                            .args(["xf", &tarball_str, "-C", &dir_str, "--strip-components=1"])
                            .status();
                    }
                }
                Err(std::io::Error::new(std::io::ErrorKind::NotFound, "tar not found"))
            })
            .or_else(|_| {
                let out_arg = format!("-o{}", dir_str);
                std::process::Command::new("7z")
                    .args(["x", &tarball_str, &out_arg, "-y"])
                    .status()
            })
            .map_err(|e| format!("Extraction failed: {}", e))?;

        std::fs::remove_file(&tarball).ok();

        if !status.success() {
            return Err("Extraction failed".to_string());
        }

        let _ = window_clone.emit(&event_clone, serde_json::json!({
            "phase": "done",
            "progress": 100
        }));
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub fn stm32_qemu_install(_app: AppHandle, _window: tauri::Window) -> Result<(), String> {
    Err("STM32 QEMU not available for automatic installation yet".to_string())
}
