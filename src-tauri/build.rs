fn main() {
    // Ensure the src-tauri/binaries directory exists to prevent tauri-build or compilation errors
    std::fs::create_dir_all("binaries").ok();
    tauri_build::build()
}
