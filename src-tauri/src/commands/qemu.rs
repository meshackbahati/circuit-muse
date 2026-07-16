use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct QemuStatus {
    pub installed: bool,
    pub path: Option<String>,
}

fn qemu_dir(app: &AppHandle, arch: &str) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(data_dir.join("qemu").join(arch))
}

fn lib_name(arch: &str) -> &'static str {
    match arch {
        "esp32" => {
            if cfg!(target_os = "windows") { "libqemu-xtensa.dll" }
            else if cfg!(target_os = "macos") { "libqemu-xtensa.dylib" }
            else { "libqemu-xtensa.so" }
        }
        "stm32" => {
            if cfg!(target_os = "windows") { "libqemu-arm.dll" }
            else if cfg!(target_os = "macos") { "libqemu-arm.dylib" }
            else { "libqemu-arm.so" }
        }
        "riscv32" => {
            if cfg!(target_os = "windows") { "libqemu-riscv32.dll" }
            else if cfg!(target_os = "macos") { "libqemu-riscv32.dylib" }
            else { "libqemu-riscv32.so" }
        }
        _ => "unknown",
    }
}

/// Download URL for QEMU shared libraries.
/// Points to lcgamboa/PICSimLab releases which publish the exact
/// shared libraries we need for ESP32 (Xtensa) and STM32 (ARM) emulation.
fn download_url(arch: &str) -> Result<String, String> {
    let base = "https://github.com/lcgamboa/PICSimLab/releases/latest/download";
    match arch {
        "esp32" => Ok(format!("{}/libqemu-xtensa.so", base)),
        "stm32" => Ok(format!("{}/libqemu-arm.so", base)),
        "riscv32" => Ok(format!("{}/libqemu-riscv32.so", base)),
        _ => Err(format!("Unknown architecture: {}", arch)),
    }
}

#[tauri::command]
pub fn esp32_qemu_status(app: AppHandle) -> Result<QemuStatus, String> {
    qemu_status_for(&app, "esp32")
}

#[tauri::command]
pub async fn esp32_qemu_install(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    qemu_install_for(&app, &window, "esp32").await
}

#[tauri::command]
pub fn stm32_qemu_status(app: AppHandle) -> Result<QemuStatus, String> {
    qemu_status_for(&app, "stm32")
}

#[tauri::command]
pub async fn stm32_qemu_install(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    qemu_install_for(&app, &window, "stm32").await
}

fn qemu_status_for(app: &AppHandle, arch: &str) -> Result<QemuStatus, String> {
    let dir = qemu_dir(app, arch)?;
    let name = lib_name(arch);
    let lib_path = dir.join(name);
    Ok(QemuStatus {
        installed: lib_path.exists(),
        path: Some(dir.to_string_lossy().to_string()),
    })
}

async fn qemu_install_for(app: &AppHandle, window: &tauri::Window, arch: &str) -> Result<(), String> {
    let dir = qemu_dir(app, arch)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let url = download_url(arch)?;
    let name = lib_name(arch);
    let dest = dir.join(name);

    // Emit progress: starting
    window.emit(&format!("{}-qemu-progress", arch), serde_json::json!({
        "bytes_downloaded": 0,
        "total_bytes": null,
        "phase": "downloading"
    })).map_err(|e| e.to_string())?;

    // Download using httpx-like approach via ureq or reqwest
    // We use a simple HTTP GET with progress reporting
    let client = reqwest::Client::new();
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut bytes = Vec::new();

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);

        // Emit progress every ~5%
        if total > 0 && (downloaded * 20 / total) != ((downloaded - chunk.len() as u64) * 20 / total) {
            let pct = (downloaded * 100 / total) as u64;
            window.emit(&format!("{}-qemu-progress", arch), serde_json::json!({
                "bytes_downloaded": downloaded,
                "total_bytes": total,
                "phase": "downloading",
                "progress": pct
            })).map_err(|e| e.to_string())?;
        }
    }

    // Write to disk
    std::fs::write(&dest, &bytes).map_err(|e| format!("Failed to write file: {}", e))?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
    }

    // Emit progress: done
    window.emit(&format!("{}-qemu-progress", arch), serde_json::json!({
        "bytes_downloaded": downloaded,
        "total_bytes": total,
        "phase": "done"
    })).map_err(|e| e.to_string())?;

    Ok(())
}
