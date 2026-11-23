fn main() {
    // Tauri can package zero-byte sidecar placeholders without reporting a
    // useful error. Stop release builds unless both shipped tools are real.
    let target = std::env::var("TARGET").unwrap_or_default();
    let is_windows = target.contains("windows");
    let suffix = if is_windows { ".exe" } else { "" };
    if std::env::var("PROFILE")
        .map(|profile| profile == "release")
        .unwrap_or(false)
    {
        for name in ["circuit-muse-engine", "arduino-cli"] {
            let path = format!("binaries/{name}-{target}{suffix}");
            let size = std::fs::metadata(&path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            if size == 0 {
                panic!(
                    "Required release sidecar is missing or empty: {path}. Run scripts/build-engine.sh and scripts/download-deps.sh before packaging."
                );
            }
            println!("cargo:rerun-if-changed={path}");
        }
    }
    tauri_build::build()
}
