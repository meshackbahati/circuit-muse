use serde::Serialize;

#[derive(Serialize)]
pub struct SerialPortInfo {
    pub path: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| SerialPortInfo {
            path: p.port_name,
            vid: p.vid,
            pid: p.pid,
            manufacturer: p.manufacturer,
            product: p.product,
            serial_number: p.serial_number,
        })
        .collect())
}
