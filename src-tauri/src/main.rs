#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Set env vars as early as possible — before ANY Tauri/webview init.
    // AppImage wraps the binary and may not pass parent env vars through.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
    }

    circuit_muse_lib::run()
}
