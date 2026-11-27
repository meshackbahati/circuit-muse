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
    let required = format!("bin/{}", exe_name("qemu-system-xtensa"));
    install_archive(window, "esp32-qemu-progress", url, dir, required).await
}

fn exe_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{}.exe", name)
    } else {
        name.to_string()
    }
}

fn wasi_sdk_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e: tauri::Error| e.to_string())?;
    Ok(data_dir.join("wasi-sdk"))
}

/// Where the engine should look for wasi-sdk. Passed as WASI_SDK when the
/// engine starts; the engine re-checks on every status call, so an install
/// made while it runs is picked up without a restart.
pub fn wasi_sdk_path(app: &AppHandle) -> Option<PathBuf> {
    wasi_sdk_dir(app).ok()
}

#[tauri::command]
pub fn wasi_sdk_status(app: AppHandle) -> Result<QemuStatus, String> {
    let dir = wasi_sdk_dir(&app)?;
    Ok(QemuStatus {
        installed: dir.join("bin").join(exe_name("clang")).exists(),
        path: Some(dir.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn wasi_sdk_install(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    const VERSION: &str = "34";
    let platform = if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") {
        "x86_64-linux"
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
        "arm64-linux"
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        "arm64-macos"
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "x86_64") {
        "x86_64-macos"
    } else if cfg!(target_os = "windows") && cfg!(target_arch = "x86_64") {
        "x86_64-windows"
    } else {
        return Err("Unsupported platform".to_string());
    };
    let url = format!(
        "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-{v}/wasi-sdk-{v}.0-{p}.tar.gz",
        v = VERSION,
        p = platform
    );
    let dir = wasi_sdk_dir(&app)?;
    let required = format!("bin/{}", exe_name("clang"));
    install_archive(window, "wasi-sdk-progress", url, dir, required).await
}

/// Download a .tar.xz / .tar.gz release archive, unpack it (dropping the
/// top-level folder) and check that `required` exists before replacing any
/// previous install. Progress is emitted on `event` as
/// `{phase, progress, bytes_downloaded, total_bytes}`.
async fn install_archive(
    window: tauri::Window,
    event: &'static str,
    url: String,
    dir: PathBuf,
    required: String,
) -> Result<(), String> {
    let _ = window.emit(event, serde_json::json!({"phase": "starting", "progress": 0}));
    tokio::task::spawn_blocking(move || download_and_extract(&window, event, &url, &dir, &required))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn download_and_extract(
    window: &tauri::Window,
    event: &str,
    url: &str,
    dir: &std::path::Path,
    required: &str,
) -> Result<(), String> {
    use std::io::{Read, Write};

    let parent = dir
        .parent()
        .ok_or_else(|| "Install folder has no parent".to_string())?
        .to_path_buf();
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "tool".to_string());
    let staging = parent.join(format!("{}.partial", name));
    let archive_ext = if url.ends_with(".tar.gz") {
        "tar.gz"
    } else if url.ends_with(".zip") {
        "zip"
    } else {
        "tar.xz"
    };
    let archive = parent.join(format!("{}.download.{}", name, archive_ext));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let client = reqwest::blocking::Client::builder()
        .user_agent("CircuitMuse/1.0")
        .timeout(None)
        .build()
        .map_err(|e| format!("Client creation failed: {}", e))?;
    let mut resp = client.get(url).send().map_err(|e| format!("Download failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    let total_size = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&archive).map_err(|e| format!("File creation failed: {}", e))?;
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut buffer = [0u8; 65536];
    loop {
        // A dropped connection used to end the loop silently and leave a
        // truncated archive that only failed later, at extraction.
        let len = resp
            .read(&mut buffer)
            .map_err(|e| format!("Download interrupted: {}", e))?;
        if len == 0 {
            break;
        }
        file.write_all(&buffer[..len]).map_err(|e| format!("Write failed: {}", e))?;
        downloaded += len as u64;
        if last_emit.elapsed().as_millis() > 150 {
            let pct = if total_size > 0 { (downloaded * 100 / total_size) as u32 } else { 0 };
            let _ = window.emit(event, serde_json::json!({
                "phase": "downloading",
                "progress": pct,
                "bytes_downloaded": downloaded,
                "total_bytes": total_size
            }));
            last_emit = std::time::Instant::now();
        }
    }
    drop(file);
    if total_size > 0 && downloaded < total_size {
        std::fs::remove_file(&archive).ok();
        return Err(format!("Download incomplete: received {} of {} bytes", downloaded, total_size));
    }

    let _ = window.emit(event, serde_json::json!({
        "phase": "extracting",
        "progress": 100,
        "bytes_downloaded": downloaded,
        "total_bytes": total_size
    }));

    let result = extract(&archive, &staging);
    std::fs::remove_file(&archive).ok();
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    if !staging.join(required).exists() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("Unpacked archive is missing {}", required));
    }

    // Swap the verified install into place.
    let _ = std::fs::remove_dir_all(dir);
    std::fs::rename(&staging, dir).map_err(|e| format!("Could not move install into place: {}", e))?;

    let _ = window.emit(event, serde_json::json!({"phase": "done", "progress": 100}));
    Ok(())
}

/// Unpack with the system `tar` (bsdtar ships with Windows 10 and later at
/// System32\tar.exe, GNU or bsd tar elsewhere), falling back to 7-Zip.
fn extract(archive: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    let archive_str = archive.to_string_lossy().to_string();
    let dest_str = dest.to_string_lossy().to_string();
    let tar_args = ["-xf", archive_str.as_str(), "-C", dest_str.as_str(), "--strip-components=1"];

    let mut candidates: Vec<std::path::PathBuf> = vec![std::path::PathBuf::from("tar")];
    if cfg!(target_os = "windows") {
        candidates.insert(0, std::path::PathBuf::from(r"C:\Windows\System32\tar.exe"));
    }
    for tar in &candidates {
        let mut cmd = std::process::Command::new(tar);
        cmd.args(tar_args);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        match cmd.status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => return Err("Extraction failed".to_string()),
            Err(_) => continue,
        }
    }
    Err("No tar program found to unpack the download".to_string())
}

#[tauri::command]
pub async fn stm32_qemu_install(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    // xPack publishes a self-contained QEMU Arm build for Cortex-M targets.
    // The archive layout is `xpack-qemu-arm-<version>/bin/qemu-system-arm`,
    // which install_archive flattens into the runtime directory.
    const TAG: &str = "v9.2.4-1";
    const VERSION: &str = "9.2.4-1";
    let platform = if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") {
        "linux-x64"
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
        "linux-arm64"
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        "darwin-arm64"
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "x86_64") {
        "darwin-x64"
    } else if cfg!(target_os = "windows") && cfg!(target_arch = "x86_64") {
        "win32-x64"
    } else {
        return Err("Unsupported platform".to_string());
    };
    let ext = if platform.starts_with("win32") { "zip" } else { "tar.gz" };
    let filename = format!("xpack-qemu-arm-{VERSION}-{platform}.{ext}");
    let url = format!(
        "https://github.com/xpack-dev-tools/qemu-arm-xpack/releases/download/{TAG}/{filename}"
    );
    let dir = qemu_dir(&app, "stm32")?;
    let required = format!("bin/{}", exe_name("qemu-system-arm"));
    install_archive(window, "stm32-qemu-progress", url, dir, required).await
}
