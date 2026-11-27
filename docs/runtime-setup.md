# Runtime setup by operating system

The setup wizard detects the host system and shows the matching instructions.
The Install button behaves the same in the interface on every platform, while
the Tauri command selects a different archive under the hood. Installs run
independently, so clicking Install for one runtime does not grey out the
others.

## What the wizard detects

`hostPlatform()` in `app/src/services/dependencyChecker.ts` reports Windows,
macOS, Linux, or unknown, together with `x64` or `arm64` where available. The
subtitle in the wizard shows that result. Manual dependencies show a command
for the detected system and a Copy button.

| Dependency | Auto-install | Source |
|------------|--------------|--------|
| Backend server | No, bundled with the app | Local Python engine |
| Arduino CLI | No | `winget`, `brew`, or the distribution package manager |
| ESP-IDF | No | Manual toolchain install from Espressif |
| ESP32 QEMU | Yes | Espressif QEMU release for the host platform |
| STM32 QEMU | Yes | xPack QEMU Arm release for the host platform |
| WASI SDK | Yes | WebAssembly WASI SDK release for the host platform |

## Auto-installed archives

The Rust command `install_archive` in `src-tauri/src/commands/qemu.rs` handles
download, progress events, extraction, verification, and an atomic swap into
place. It uses `tar` on Linux and macOS and `System32\tar.exe` on Windows. A
Windows `.zip` is unpacked by the same tool. A download that ends before the
advertised byte count is rejected rather than unpacked.

ESP32 QEMU uses the Espressif `esp-develop` tag with a per-platform archive
for `qemu-system-xtensa`. The required file after extraction is
`bin/qemu-system-xtensa`, with `.exe` on Windows.

STM32 QEMU uses xPack QEMU Arm `v9.2.4-1`. The release names are:

- `xpack-qemu-arm-9.2.4-1-linux-x64.tar.gz`
- `xpack-qemu-arm-9.2.4-1-linux-arm64.tar.gz`
- `xpack-qemu-arm-9.2.4-1-darwin-x64.tar.gz`
- `xpack-qemu-arm-9.2.4-1-darwin-arm64.tar.gz`
- `xpack-qemu-arm-9.2.4-1-win32-x64.zip`

The archive has one top-level folder, which extraction strips. After install,
`qemu/stm32/bin/qemu-system-arm` exists under the application data directory,
and `stm32_qemu_status` reports it as installed. The progress event is
`stm32-qemu-progress`, shared by the board prompt and the setup wizard.

WASI SDK uses the WebAssembly `wasi-sdk-34` release with platform names
`x86_64-linux`, `arm64-linux`, `x86_64-macos`, `arm64-macos`, and
`x86_64-windows`. The engine rechecks for it on every status call, so a setup
install is picked up without a restart.

## Limits

ESP-IDF is a multi-step toolchain of roughly 1.5 GB and remains manual. The
STM32 board emulator in the engine uses the `libqemu-arm` shared library when
that path is selected; installing xPack QEMU Arm provides the standalone
`qemu-system-arm` runtime but does not supply that shared library. Windows and
macOS install paths are written for each platform but have only been exercised
on Linux in the development environment.
