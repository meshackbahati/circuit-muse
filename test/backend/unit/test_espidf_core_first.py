"""Regression tests for ESP32 library-resolution core-first behaviour.

A user library that ships a core-named header (e.g. WiFiEspAT/src/WiFi.h)
must never shadow the arduino-esp32 core. This guards the WiFi.h ->
WiFiEspAT -> EspAtDrv.cpp 'const char OK[]'/'STATUS[]' clash with ESP-IDF's
enum STATUS in rom/ets_sys.h, which broke every ESP32 sketch that
#include <WiFi.h>.

No ESP-IDF toolchain required — pure resolution logic.
"""

import sys
import tempfile
import shutil
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'backend'))

from app.services.espidf_compiler import ESPIDFCompiler


def _mk(p: Path, content: str = "x") -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)


class TestCoreFirstResolution(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_core_header_not_resolved_to_user_lib(self):
        core = self.tmp / "arduino-esp32"
        _mk(core / "cores" / "esp32" / "Arduino.h")
        _mk(core / "libraries" / "WiFi" / "src" / "WiFi.h")

        ulibs = self.tmp / "Arduino" / "libraries"
        _mk(ulibs / "WiFiEspAT" / "library.properties",
            "name=WiFiEspAT\narchitectures=*\n")
        _mk(ulibs / "WiFiEspAT" / "src" / "WiFi.h")
        _mk(ulibs / "WiFiEspAT" / "src" / "utility" / "EspAtDrv.cpp",
            "const char OK[];")
        # a legit cross-platform lib (no architectures field) must still merge
        _mk(ulibs / "DHT_sensor_library" / "DHT.h", "#include <Arduino.h>\n")
        _mk(ulibs / "DHT_sensor_library" / "DHT.cpp")

        c = ESPIDFCompiler()
        c.arduino_path = str(core)
        c._core_headers_cache = None
        out = self.tmp / "project" / "user_libs"
        out.mkdir(parents=True)

        names, hdr2comp = c._resolve_library_components(
            ["WiFi.h", "DHT.h"],
            arduino_libs=ulibs, esp32_libs=None,
            arduino_comp_name="arduino-esp32", user_libs_dir=out,
        )

        merged = out / "user_libs_all"
        copied = [p.name for p in merged.rglob("*")] if merged.exists() else []
        self.assertNotIn("EspAtDrv.cpp", copied,
                         "WiFiEspAT was merged — WiFi.h shadowed the core")
        self.assertNotIn("WiFi.h", hdr2comp)
        self.assertIn("DHT.cpp", copied)
        self.assertEqual(hdr2comp.get("DHT.h"), "user_libs_all")

    def test_arch_excluded_lib_skipped(self):
        ulibs = self.tmp / "Arduino" / "libraries"
        _mk(ulibs / "AvrOnlyLib" / "library.properties",
            "name=AvrOnlyLib\narchitectures=avr\n")
        _mk(ulibs / "AvrOnlyLib" / "Foo.h")
        _mk(ulibs / "AvrOnlyLib" / "Foo.cpp")

        c = ESPIDFCompiler()
        c.arduino_path = ""           # no core path -> static fallback set
        c._core_headers_cache = None
        out = self.tmp / "project" / "user_libs"
        out.mkdir(parents=True)

        names, hdr2comp = c._resolve_library_components(
            ["Foo.h"],
            arduino_libs=ulibs, esp32_libs=None,
            arduino_comp_name="arduino-esp32", user_libs_dir=out,
        )
        self.assertNotIn("Foo.h", hdr2comp)


class TestManifestScope(unittest.TestCase):
    """P2: when a project declares a library manifest, only declared libraries
    are merged — a user-installed lib outside the manifest is never picked up,
    even if its header is included. None manifest = legacy scan-all (unchanged)."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.ulibs = self.tmp / "Arduino" / "libraries"
        # In-manifest lib, declared by Library Manager display name; on-disk
        # folder name differs by separators/case (the realistic shape).
        _mk(self.ulibs / "DHT_sensor_library" / "library.properties",
            "name=DHT sensor library\n")
        _mk(self.ulibs / "DHT_sensor_library" / "DHT.h")
        _mk(self.ulibs / "DHT_sensor_library" / "DHT.cpp")
        # A STRAY lib that also ships DHT.h and sorts BEFORE the manifest lib
        # (real case: DHT118266 sorts before DHT_sensor_library). The manifest
        # must still resolve DHT.h to the declared lib, not this stray.
        _mk(self.ulibs / "AAAA_strayDHT" / "DHT.h")
        _mk(self.ulibs / "AAAA_strayDHT" / "stray_marker.cpp")
        # Out-of-manifest lib (e.g. another user's install / a clash).
        _mk(self.ulibs / "RandomOtherLib" / "Foo.h")
        _mk(self.ulibs / "RandomOtherLib" / "Foo.cpp")
        self.c = ESPIDFCompiler()
        self.c.arduino_path = ""
        self.c._core_headers_cache = None
        self.out = self.tmp / "project" / "user_libs"
        self.out.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _resolve(self, headers, allowed):
        return self.c._resolve_library_components(
            headers, arduino_libs=self.ulibs, esp32_libs=None,
            arduino_comp_name="arduino-esp32", user_libs_dir=self.out,
            allowed_libraries=allowed,
        )

    def test_only_manifest_libs_merge(self):
        # Manifest declares DHT (by display name) but not Foo's lib.
        _, hdr2comp = self._resolve(["DHT.h", "Foo.h"], {"DHT sensor library"})
        self.assertEqual(hdr2comp.get("DHT.h"), "user_libs_all")  # declared → merged
        self.assertNotIn("Foo.h", hdr2comp)                       # undeclared → dropped
        merged = self.out / "user_libs_all"
        copied = [p.name for p in merged.rglob("*")] if merged.exists() else []
        # The DECLARED DHT lib was merged, not the stray that sorts first.
        self.assertIn("DHT.cpp", copied)
        self.assertNotIn("stray_marker.cpp", copied)

    def test_none_manifest_is_scan_all(self):
        # No manifest → legacy behaviour: both resolve.
        _, hdr2comp = self._resolve(["DHT.h", "Foo.h"], None)
        self.assertEqual(hdr2comp.get("DHT.h"), "user_libs_all")
        self.assertEqual(hdr2comp.get("Foo.h"), "user_libs_all")

    def test_match_by_folder_name(self):
        # Manifest may also reference the on-disk folder name directly.
        _, hdr2comp = self._resolve(["Foo.h"], {"RandomOtherLib"})
        self.assertEqual(hdr2comp.get("Foo.h"), "user_libs_all")


if __name__ == "__main__":
    unittest.main()
