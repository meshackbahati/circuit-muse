"""Regression test — ATTinyCore (ATtiny85) is registered for arduino-cli.

Reported by users compiling ATtiny85 sketches from the editor:

    Error during build: Platform 'ATTinyCore:avr' not found: platform not installed
    Platform ATTinyCore:avr is not found in any known index
    Maybe you need to add a 3rd party URL?
    ✕ Compilation failed

Root cause: the frontend sends the FQBN
``ATTinyCore:avr:attinyx5:chip=85,clock=internal16mhz`` for any ``boardKind ==
'attiny85'``, but ``ArduinoCLIService`` only knew about ``rp2040``,
``mbed_rp2040`` and ``esp32`` cores. So the auto-install hook never ran for
ATTinyCore and arduino-cli didn't have the drazzy.com index URL configured.

Fix lives in ``backend/app/services/arduino_cli.py`` (CORE_URLS +
ON_DEMAND_CORES), ``docker/entrypoint.sh`` (production image), and
``backend/Dockerfile`` (dev image).

These tests run pure-Python — no arduino-cli subprocess, no network. They
just verify that the data the service uses to decide what to install is
correctly populated.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Add backend to import path so app.services.* resolve
_REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO / "backend"))


# Avoid the constructor side effects (it calls arduino-cli config dump etc.)
# by accessing the class-level dicts directly.
def _get_cls():
    from app.services.arduino_cli import ArduinoCLIService  # noqa: WPS433

    return ArduinoCLIService


# ── CORE_URLS ───────────────────────────────────────────────────────────────


def test_attinycore_url_is_registered():
    """The drazzy.com index URL must be in CORE_URLS so _ensure_board_urls()
    adds it to arduino-cli config at startup."""
    cls = _get_cls()
    url = cls.CORE_URLS.get("ATTinyCore:avr")
    assert url is not None, (
        "CORE_URLS is missing ATTinyCore:avr — without it arduino-cli's index "
        "doesn't know about the ATTinyCore platform and `core install` fails."
    )
    assert "drazzy.com" in url, f"Expected drazzy.com URL, got {url!r}"


def test_existing_core_urls_still_present():
    """Adding ATTinyCore must not have dropped the RP2040/ESP32 URLs."""
    cls = _get_cls()
    assert "rp2040:rp2040" in cls.CORE_URLS
    assert "esp32:esp32" in cls.CORE_URLS


# ── ON_DEMAND_CORES — auto-install on first compile ──────────────────────────


def test_attinycore_is_an_on_demand_core():
    """The auto-installer must know which core to install when an ATtiny85
    FQBN is requested."""
    cls = _get_cls()
    assert "ATTinyCore:avr" in cls.ON_DEMAND_CORES, (
        "ON_DEMAND_CORES is missing ATTinyCore:avr — the auto-install hook "
        "won't run when the editor sends an ATtiny85 FQBN."
    )
    assert cls.ON_DEMAND_CORES["ATTinyCore:avr"] == "ATTinyCore:avr"


def test_core_id_for_fqbn_routes_attiny85():
    """The matcher used by ensure_core_for_board() must pick ATTinyCore for
    ATtiny85 FQBNs and not mis-route them to esp32 / rp2040."""
    cls = _get_cls()
    # We don't want to construct the service (it shells out to arduino-cli).
    # Instead, instantiate a bare object and call the bound method via
    # __get__, exercising only the in-memory matching logic.
    matcher = cls._core_id_for_fqbn

    # Create a stub instance with just the dict attribute the method reads.
    class _Stub:
        ON_DEMAND_CORES = cls.ON_DEMAND_CORES

    stub = _Stub()

    fqbn = "ATTinyCore:avr:attinyx5:chip=85,clock=internal16mhz"
    assert matcher(stub, fqbn) == "ATTinyCore:avr", (
        f"FQBN {fqbn!r} should resolve to ATTinyCore:avr"
    )

    # Negative: ESP32 / RP2040 must not accidentally match ATTinyCore now.
    assert matcher(stub, "esp32:esp32:esp32") == "esp32:esp32"
    assert matcher(stub, "rp2040:rp2040:rpipico") == "rp2040:rp2040"
    # Built-in core has no match — the service then short-circuits to the
    # "no install needed" branch.
    assert matcher(stub, "arduino:avr:uno") is None


# ── Production deploy script — entrypoint.sh ────────────────────────────────


def test_entrypoint_installs_attinycore_in_production():
    """docker/entrypoint.sh must add the drazzy URL and `core install
    ATTinyCore:avr` so the standalone Docker image can compile ATtiny85
    sketches without the auto-install penalty on the first request."""
    script = (_REPO / "docker" / "entrypoint.sh").read_text(encoding="utf-8")
    assert "drazzy.com/package_drazzy.com_index.json" in script, (
        "entrypoint.sh is missing the drazzy.com board-manager URL — first "
        "ATtiny85 compile will fail in the production Docker image."
    )
    assert "core install ATTinyCore:avr" in script, (
        "entrypoint.sh must run `arduino-cli core install ATTinyCore:avr`."
    )


def test_backend_dockerfile_prebakes_attinycore():
    """backend/Dockerfile (used by docker-compose dev) should pre-install
    ATTinyCore so the test environment matches production."""
    dockerfile = (_REPO / "backend" / "Dockerfile").read_text(encoding="utf-8")
    assert "ATTinyCore:avr" in dockerfile, (
        "backend/Dockerfile doesn't install ATTinyCore — the dev container "
        "won't be able to compile ATtiny85 sketches."
    )
    assert "drazzy.com" in dockerfile, (
        "backend/Dockerfile must add the drazzy.com URL before installing "
        "ATTinyCore:avr (otherwise the platform can't be resolved)."
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
