"""The first compile for a board family installs its core, which can take
minutes. Installer output must reach the compile console as it arrives."""
from __future__ import annotations

import stat
import sys
import textwrap

import pytest

from app.services.arduino_cli import ArduinoCLIService


@pytest.mark.skipif(sys.platform == "win32", reason="uses a POSIX shebang script")
def test_core_install_streams_output(tmp_path) -> None:
    fake = tmp_path / "arduino-cli"
    fake.write_text(textwrap.dedent(f"""\
        #!{sys.executable}
        import sys
        if sys.argv[1:3] == ["config", "get"]:
            print({str(tmp_path)!r})
            sys.exit(0)
        print("Downloading packages", flush=True)
        for i in range(50):
            print(f"esp32:esp-rv32 {{i}}.00 MiB / 784.13 MiB  {{i/7.84:.2f}}%", flush=True)
        print("esp32:xtensa-esp-elf-gcc downloaded", flush=True)
        sys.exit(0)
    """))
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)

    service = ArduinoCLIService.__new__(ArduinoCLIService)
    service.cli_path = str(fake)
    seen: list[str] = []
    result = service._run_core_install("esp32:esp32", seen.append)

    assert result.returncode == 0
    assert "Downloading packages\n" in seen
    assert any("xtensa-esp-elf-gcc" in line for line in seen)
    assert all(line.endswith("\n") for line in seen)
    # 50 progress redraws in a burst are thinned to one line, not 50.
    assert sum("MiB /" in line for line in seen) == 1



@pytest.mark.skipif(sys.platform == "win32", reason="uses a POSIX shebang script")
def test_cli_installed_later_is_found_without_restart(tmp_path, monkeypatch) -> None:
    target = tmp_path / "arduino-cli"
    monkeypatch.delenv("ARDUINO_CLI_PATH", raising=False)
    monkeypatch.setenv("ARDUINO_CLI_FALLBACK", str(target))
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    service = ArduinoCLIService(cli_path=str(tmp_path / "missing"))
    assert service.cli_path == "arduino-cli"  # nothing usable yet

    target.write_text(f"#!{sys.executable}\n")
    target.chmod(target.stat().st_mode | stat.S_IXUSR)
    assert service.cli_path == str(target)
