# Hardware flashing and multi-board workflow

## Purpose

This note records the hardware path that exists in CircuitMuse 1.0.5 and the
work required to make it a first-class part of the design loop. The target
workflow is that a user designs a circuit, runs it in the emulator, and then
writes the same verified firmware to a physical board without leaving the
application.

## Current capabilities

### Selecting and editing a board

The canvas header contains an active board selector. Selecting a board makes
its pins visible, marks it as the target for compile and run actions, and
switches the editor to the file group that belongs to that board. The file
explorer lists each board as its own section, so a user can also open a
board's files directly. Every board owns an independent file group, which
means a multi-board project can hold a different sketch for each board.

### Compiling

The compile action builds the active board from its own file group. The agent
tool `compile_all_code` performs the same operation for every board in one
call, so a multi-board project produces one firmware image per board rather
than one shared image. Compilation output is written to the console panel.

### Flashing

The flash path is implemented for desktop builds. A compiled board exposes two
entry points:

1. The lightning button in the canvas header, which flashes the active board.
2. The board context menu item `Flash to real board`.

Both open the flash dialog. The dialog enumerates USB serial ports, asks for a
port when more than one is present, streams `arduino-cli` output, reports a
progress percentage, and offers a retry after a failure. The program format is
chosen from the board FQBN: Intel HEX for AVR, binary for ESP32 and SAMD, and
UF2 for RP2040. The flash endpoint refuses to start when the board has no
compiled program.

### Port discovery and readable names

The Tauri command `list_serial_ports` uses the Rust `serialport` crate and
returns the native path together with USB vendor id, product id, manufacturer,
product, and serial number. The dialog maps known vendor and product pairs to
names such as `Arduino Uno`, `Arduino Mega`, `CH340 USB serial`, `CP210x USB
serial`, `FTDI USB serial`, `ESP32 USB`, and `Raspberry Pi Pico`. Unrecognised
devices fall back to the reported manufacturer and product, then to the path.
The path remains visible in parentheses, so the technical identifier is never
lost.

A `Name this port` control stores a custom label in local storage, keyed by
serial number when the device reports one and by path otherwise. The label is
reused when the same device returns. This removes the need to remember which
`COM*` or `/dev/tty*` entry belongs to which board.

### Platform constraints

The web build cannot enumerate local serial ports, so the flash controls are
hidden outside the desktop shell. On Linux, native USB boards appear as
`/dev/ttyACM*`, adapter boards as `/dev/ttyUSB*`, and the user must belong to
the `dialout` group (`uucp` on Arch Linux). Log out and back in after
`sudo usermod -a -G dialout $USER` (Arch: `sudo usermod -a -G uucp $USER`).
On macOS, use `/dev/cu.usbmodem*` for native boards and
`/dev/cu.usbserial*` for adapters; CH340 and CP210x parts need a vendor driver,
and recent macOS versions require approval of driver extensions under Privacy
and Security. On Windows, ports are `COM*` entries and a vendor driver is
required; Zadig is needed when a board presents an unclaimed USB interface.

## Gaps

The following gaps separate the current implementation from a complete
hardware loop.

1. The flash button is disabled until the active board has a compiled program,
   but it does not explain that the program may be stale relative to the
   current editor contents. A compile timestamp and a stale warning are needed.
2. The flash dialog handles one board at a time. A multi-board project with
   three physical boards requires three separate selections.
3. Custom port labels are stored locally per device, but a project does not
   remember which physical port belongs to which canvas board. Users with
   several identical boards still confirm the mapping on each run.
4. The emulator run and the hardware flash are separate actions. There is no
   post-run handoff that offers to flash the firmware that was just tested.
5. Upload verification relies on `arduino-cli` exit status. There is no
   read-back or checksum confirmation for boards that support it.

## Planned work

### Phase 1: Trust and clarity

- Store the compile timestamp on each board and mark the firmware stale when
  the file group changes after compilation.
- Show the compiled sketch name, board name, and compile time in the flash
  dialog before the port list.
- Add a `Flash` action to the run toolbar after a successful compile, so the
  path from test to hardware is one click.
- Persist the last successful port per board id and preselect it.

### Phase 2: Multi-board flashing

- Add a `Flash all compiled boards` action that walks the boards in canvas
  order, asks for a port for each, and reports per-board progress.
- Allow a port map in project settings so a saved project remembers which
  physical device corresponds to which canvas board.
- Keep each board's firmware artifact in the project file so a saved project
  can be flashed without recompiling.

### Phase 3: Verification

- Read back the programmed image where the uploader supports it and compare a
  checksum with the compiled artifact.
- Detect the connected board signature through `arduino-cli board list` and
  warn when the selected FQBN does not match the attached device.
- Record a flash history entry with board, port, firmware hash, result, and
  duration.

### Phase 4: Agent integration

- Add a `flash_board` tool that accepts a board id and optional port. The agent
  can then compile, verify in the emulator, and flash in one supervised run.
- Require explicit user confirmation before the agent opens a physical port.
- Report the flash result in the console and in the conversation transcript.

## Operational notes

The flash endpoint is `POST /api/flash/upload` and returns server-sent events.
The frontend client is `app/src/services/flashService.ts`, and the dialog is
`app/src/components/simulator/FlashModal.tsx`. Board FQBNs come from
`BOARD_KIND_FQBN` in `app/src/types/board.ts`. The engine writes the program to
a temporary file and runs the uploader: the bundled esptool for ESP32 boards
(`write-flash 0x0` for the merged bootloader, partition table and app image the
compiler produces, or `0x10000` for a plain app image), and `arduino-cli upload`
for the other families. It finds arduino-cli the same way the compiler does
(the app's bundled sidecar via `ARDUINO_CLI_PATH`, then PATH, then the copy
installed from Setup).
