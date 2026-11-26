use serde::Serialize;

#[derive(Serialize)]
pub struct SerialPortInfo {
    pub path: String,
    pub port_type: String,
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
        .map(|p| {
            // USB metadata lets the UI show "Arduino Uno" instead of a raw
            // /dev/ttyACM0 or COM3 path. Serial adapters report their chip
            // and vendor, which is enough for a readable label.
            let (vid, pid, manufacturer, product, serial_number) = match &p.port_type {
                serialport::SerialPortType::UsbPort(info) => (
                    Some(info.vid),
                    Some(info.pid),
                    info.manufacturer.clone(),
                    info.product.clone(),
                    info.serial_number.clone(),
                ),
                _ => (None, None, None, None, None),
            };
            SerialPortInfo {
                path: p.port_name,
                port_type: format!("{:?}", p.port_type),
                vid,
                pid,
                manufacturer,
                product,
                serial_number,
            }
        })
        .collect())
}
