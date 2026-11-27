//! Ownership of the engine process so it stops when the app exits.
//!
//! The engine starts emulator processes (QEMU, worker interpreters). If the
//! engine is left running after the window closes, all of them keep their
//! memory and CPU. On exit the engine is asked to stop (SIGTERM on Unix) so
//! its own shutdown hook can stop the emulators, then it is force-killed if
//! it has not exited in time.

use std::sync::Mutex;
#[cfg(unix)]
use std::time::{Duration, Instant};

use tauri_plugin_shell::process::CommandChild;

/// How long the engine gets to stop its emulators before it is killed.
/// The engine bounds its own cleanup to 10 s.
#[cfg(unix)]
const GRACEFUL_TIMEOUT: Duration = Duration::from_secs(12);

pub enum EngineChild {
    /// Bundled engine started through the shell plugin.
    Sidecar(CommandChild),
    /// Source checkout started with a system or virtualenv Python.
    Std(std::process::Child),
}

impl EngineChild {
    fn pid(&self) -> u32 {
        match self {
            EngineChild::Sidecar(child) => child.pid(),
            EngineChild::Std(child) => child.id(),
        }
    }

    #[cfg(unix)]
    fn has_exited(&mut self) -> bool {
        match self {
            // The shell plugin reaps the sidecar in its own thread, so a
            // missing pid means the process is gone.
            EngineChild::Sidecar(child) => unsafe { libc::kill(child.pid() as i32, 0) != 0 },
            EngineChild::Std(child) => !matches!(child.try_wait(), Ok(None)),
        }
    }

    fn force_kill(self) {
        match self {
            EngineChild::Sidecar(child) => {
                let _ = child.kill();
            }
            EngineChild::Std(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Default)]
pub struct EngineProcess(Mutex<Option<EngineChild>>);

impl EngineProcess {
    pub fn set(&self, child: EngineChild) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(child);
        }
    }

    /// Stop the engine and the emulator processes it owns. Safe to call twice.
    pub fn stop(&self) {
        let child = match self.0.lock() {
            Ok(mut slot) => slot.take(),
            Err(_) => None,
        };
        let Some(child) = child else { return };
        let pid = child.pid();
        eprintln!("[engine] stopping engine (pid {pid})");
        stop_child(child, pid);
    }
}

#[cfg(unix)]
fn stop_child(mut child: EngineChild, pid: u32) {
    // SIGTERM lets uvicorn run the lifespan shutdown, which stops every
    // emulator. A PyInstaller one-file bootloader forwards it to Python.
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
    let deadline = Instant::now() + GRACEFUL_TIMEOUT;
    while Instant::now() < deadline {
        if child.has_exited() {
            eprintln!("[engine] engine stopped");
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    eprintln!("[engine] engine did not stop in time, killing it");
    child.force_kill();
}

#[cfg(windows)]
fn stop_child(child: EngineChild, pid: u32) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // Windows has no SIGTERM for console-less processes. Kill the whole
    // tree so QEMU and worker processes do not outlive the engine.
    let tree_killed = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !tree_killed {
        child.force_kill();
    }
}

/// Port the engine reported ("Starting on port N"). The window asks for it at
/// startup with the `engine_port` command: the `engine-ready` event can fire
/// before the page listens, and guessing or scanning ports could reach a
/// different engine (an old instance or another app on 8001).
#[derive(Default)]
pub struct EnginePort(Mutex<Option<u16>>);

impl EnginePort {
    pub fn set(&self, port: u16) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(port);
        }
    }

    pub fn get(&self) -> Option<u16> {
        self.0.lock().ok().and_then(|slot| *slot)
    }
}

#[tauri::command]
pub fn engine_port(state: tauri::State<'_, EnginePort>) -> Option<u16> {
    state.get()
}
