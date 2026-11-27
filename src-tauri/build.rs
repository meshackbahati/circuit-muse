fn main() {
    // Tauri can package zero-byte sidecar placeholders without reporting a
    // useful error. Stop release builds unless both shipped tools are real.
    let target = std::env::var("TARGET").unwrap_or_default();
    let is_windows = target.contains("windows");
    let suffix = if is_windows { ".exe" } else { "" };

    // Tauri refuses to build when a declared sidecar file is missing. The real
    // binaries are downloaded or built locally and are ignored by git, so a
    // fresh clone gets empty placeholders for dev builds on any platform.
    // Release builds still require the real files (checked below).
    for name in ["circuit-muse-engine", "arduino-cli"] {
        let path = format!("binaries/{name}-{target}{suffix}");
        if !std::path::Path::new(&path).exists() {
            let _ = std::fs::create_dir_all("binaries");
            let _ = std::fs::File::create(&path);
        }
    }

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
