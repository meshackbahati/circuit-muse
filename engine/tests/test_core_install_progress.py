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

