#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    if should_use_software_rendering() {
        // Preserve GTK's native Wayland/X11 choice while asking WebKit to use
        // Mesa's CPU renderer on machines without a GPU render node.
        std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    circuit_muse_lib::run()
}

#[cfg(target_os = "linux")]
fn should_use_software_rendering() -> bool {
    if std::env::var_os("CIRCUIT_MUSE_HARDWARE_RENDERING").is_some() {
        return false;
    }
    if std::env::var_os("CIRCUIT_MUSE_SOFTWARE_RENDERING").is_some() {
        return true;
    }

    std::fs::read_dir("/dev/dri")
        .map(|entries| {
            entries.flatten().any(|entry| {
                entry.file_name().to_string_lossy().starts_with("renderD")
            })
        })
        .unwrap_or(true)
}
