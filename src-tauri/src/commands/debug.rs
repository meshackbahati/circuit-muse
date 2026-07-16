use std::fs::OpenOptions;
use std::io::Write;
use tauri::AppHandle;

#[tauri::command]
pub fn write_debug_log(app: AppHandle, message: String) -> Result<(), String> {
    let log_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log_path = log_dir.join("desktop-debug.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", message).map_err(|e| e.to_string())?;
    Ok(())
}
