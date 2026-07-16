use serde::Serialize;

#[derive(Serialize)]
pub struct SerialPortInfo {
    pub path: String,
    pub port_type: String,
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| SerialPortInfo {
            path: p.port_name,
            port_type: format!("{:?}", p.port_type),
        })
        .collect())
}
