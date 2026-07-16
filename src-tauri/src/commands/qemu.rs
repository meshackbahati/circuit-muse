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

#[tauri::command]
pub fn esp32_qemu_status(app: AppHandle) -> Result<QemuStatus, String> {
    let dir = qemu_dir(&app, "esp32")?;
    let lib_name = if cfg!(target_os = "windows") {
        "libqemu-xtensa.dll"
    } else if cfg!(target_os = "macos") {
        "libqemu-xtensa.dylib"
    } else {
        "libqemu-xtensa.so"
    };
    let lib_path = dir.join(lib_name);
    Ok(QemuStatus {
        installed: lib_path.exists(),
        path: Some(dir.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn esp32_qemu_install(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    let dir = qemu_dir(&app, "esp32")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    window.emit("esp32-qemu-progress", serde_json::json!({"progress": 100, "phase": "done"}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn stm32_qemu_status(app: AppHandle) -> Result<QemuStatus, String> {
    let dir = qemu_dir(&app, "stm32")?;
    let lib_name = if cfg!(target_os = "windows") {
        "libqemu-arm.dll"
    } else if cfg!(target_os = "macos") {
        "libqemu-arm.dylib"
    } else {
        "libqemu-arm.so"
    };
    let lib_path = dir.join(lib_name);
    Ok(QemuStatus {
        installed: lib_path.exists(),
        path: Some(dir.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn stm32_qemu_install(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    let dir = qemu_dir(&app, "stm32")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    window.emit("stm32-qemu-progress", serde_json::json!({"progress": 100, "phase": "done"}))
        .map_err(|e| e.to_string())?;
    Ok(())
}
