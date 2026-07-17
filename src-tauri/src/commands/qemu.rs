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
        let resp = reqwest::blocking::get(&url).map_err(|e| format!("Download failed: {}", e))?;
        let bytes = resp.bytes().map_err(|e| format!("Read failed: {}", e))?;
        let tarball = dir_clone.join("download.tar.xz");
        std::fs::write(&tarball, &bytes).map_err(|e| format!("Write failed: {}", e))?;

        // Extract - try tar first, fall back to 7z on Windows
        let tarball_str = tarball.to_string_lossy().to_string();
        let dir_str = dir_clone.to_string_lossy().to_string();
        let status = std::process::Command::new("tar")
            .args(["xf", &tarball_str, "-C", &dir_str, "--strip-components=1"])
            .status()
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

        let _ = window_clone.emit(&event_clone, serde_json::json!({"phase": "done"}));
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub fn stm32_qemu_install(_app: AppHandle, _window: tauri::Window) -> Result<(), String> {
    Err("STM32 QEMU not available for automatic installation yet".to_string())
}
