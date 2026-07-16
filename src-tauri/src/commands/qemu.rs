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
        _ => "unknown",
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
    let dir = qemu_dir(&app, "stm32").unwrap_or_default();
    let bin_path = dir.join("bin").join("qemu-system-arm");
    Ok(QemuStatus {
        installed: bin_path.exists(),
        path: Some(dir.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn esp32_qemu_install(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    let dir = qemu_dir(&app, "esp32")?;
    std::fs::create_dir_all(&dir).map_err(|e: std::io::Error| e.to_string())?;
    let event_name = "esp32-qemu-progress".to_string();
    let _ = window.emit(&event_name, serde_json::json!({"phase": "downloading"}));

    // Download Espressif QEMU for the current platform
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

    // Download and extract
    let resp = reqwest::blocking::get(&url).map_err(|e| format!("Download failed: {}", e))?;
    let bytes = resp.bytes().map_err(|e| format!("Read failed: {}", e))?;
    let tarball = dir.join("download.tar.xz");
    std::fs::write(&tarball, &bytes).map_err(|e| format!("Write failed: {}", e))?;

    let status = std::process::Command::new("tar")
        .args(["xf", tarball.to_str().unwrap(), "-C", dir.to_str().unwrap(), "--strip-components=1"])
        .status()
        .map_err(|e| format!("tar failed: {}", e))?;
    std::fs::remove_file(&tarball).ok();

    if !status.success() {
        return Err("Extract failed".to_string());
    }

    let _ = window.emit(&event_name, serde_json::json!({"phase": "done"}));
    Ok(())
}

#[tauri::command]
pub async fn stm32_qemu_install(_app: AppHandle, _window: tauri::Window) -> Result<(), String> {
    Err("STM32 QEMU not available for automatic installation yet".to_string())
}
