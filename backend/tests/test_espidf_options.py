"""Unit tests for ESP-IDF compiler option normalisation, sdkconfig rendering,
and partition CSV rendering. These touch pure-Python helpers only — no
toolchain or QEMU involvement — so they run anywhere pytest does.
"""
from __future__ import annotations

import pytest

from app.services.espidf_compiler import ESPIDFCompiler


@pytest.fixture
def compiler() -> ESPIDFCompiler:
    return ESPIDFCompiler()


# ── _normalize_options ────────────────────────────────────────────────────


def test_normalize_options_fills_defaults(compiler: ESPIDFCompiler) -> None:
    opts = compiler._normalize_options(None, idf_target='esp32')
    assert opts['partitionScheme'] == 'huge_app'
    assert opts['cpuFreqMHz'] == 240
    assert opts['flashMode'] == 'dio'
    assert opts['flashSize'] == '4MB'
    assert opts['psram'] == 'disabled'
    assert opts['coreDebugLevel'] == 'none'
    assert opts['arduinoRunsOnCore'] == 1
    assert opts['eventsRunOnCore'] == 1


def test_normalize_options_keeps_explicit_values(compiler: ESPIDFCompiler) -> None:
    opts = compiler._normalize_options(
        {'partitionScheme': 'min_spiffs', 'flashMode': 'qio', 'cpuFreqMHz': 80},
        idf_target='esp32',
    )
    assert opts['partitionScheme'] == 'min_spiffs'
    assert opts['flashMode'] == 'qio'
    assert opts['cpuFreqMHz'] == 80
    # Unspecified field still falls back to default
    assert opts['flashSize'] == '4MB'


def test_normalize_options_rejects_unknown_enum(compiler: ESPIDFCompiler) -> None:
    with pytest.raises(ValueError, match='partitionScheme'):
        compiler._normalize_options(
            {'partitionScheme': 'fake_scheme'}, idf_target='esp32',
        )


def test_normalize_options_strips_psram_on_c3(compiler: ESPIDFCompiler) -> None:
    opts = compiler._normalize_options(
        {'psram': 'enabled'}, idf_target='esp32c3',
    )
    # C3 has no external PSRAM controller — silently disabled.
    assert opts['psram'] == 'disabled'


def test_normalize_options_downgrades_opi_psram_off_s3(compiler: ESPIDFCompiler) -> None:
    # OPI PSRAM only exists on S3. On classic Xtensa we downgrade to 'enabled'
    # so the user doesn't get a stuck build after switching board family.
    opts = compiler._normalize_options(
        {'psram': 'opi'}, idf_target='esp32',
    )
    assert opts['psram'] == 'enabled'


def test_normalize_options_keeps_opi_on_s3(compiler: ESPIDFCompiler) -> None:
    opts = compiler._normalize_options(
        {'psram': 'opi'}, idf_target='esp32s3',
    )
    assert opts['psram'] == 'opi'


def test_normalize_options_ignores_unknown_keys(compiler: ESPIDFCompiler) -> None:
    # Forward-compat: a future frontend field shouldn't crash the backend.
    opts = compiler._normalize_options(
        {'futureField': 'something', 'cpuFreqMHz': 160},
        idf_target='esp32',
    )
    assert 'futureField' not in opts
    assert opts['cpuFreqMHz'] == 160


# ── _render_partition_csv ─────────────────────────────────────────────────


def test_render_partition_csv_known_schemes(compiler: ESPIDFCompiler) -> None:
    for scheme in ('huge_app', 'default', 'min_spiffs', 'no_ota', 'no_fs'):
        csv = compiler._render_partition_csv(scheme)
        assert '# Name' in csv
        assert 'app' in csv  # at least one app partition
        # Parser round-trips the data
        entries = compiler._parse_partition_csv(csv)
        assert any(e['type'] == 'app' for e in entries), \
            f'{scheme} must have at least one app partition'


def test_render_partition_csv_unknown_falls_back(compiler: ESPIDFCompiler) -> None:
    # Should not crash — defensive fallback to huge_app.
    csv = compiler._render_partition_csv('never_existed')
    assert 'app' in csv


def test_partition_huge_app_layout(compiler: ESPIDFCompiler) -> None:
    """huge_app must keep app0 at 0x10000 with 0x300000 size — matches the
    historical Velxio layout, so projects without options remain bit-for-bit
    compatible after upgrade.
    """
    entries = compiler._parse_partition_csv(
        compiler._render_partition_csv('huge_app')
    )
    apps = [e for e in entries if e['type'] == 'app']
    assert len(apps) == 1
    assert apps[0]['offset'] == 0x10000
    assert apps[0]['size'] == 0x300000


def test_partition_min_spiffs_has_two_ota_apps(compiler: ESPIDFCompiler) -> None:
    entries = compiler._parse_partition_csv(
        compiler._render_partition_csv('min_spiffs')
    )
    apps = [e for e in entries if e['type'] == 'app']
    assert len(apps) == 2
    subtypes = {a['subtype'] for a in apps}
    assert subtypes == {'ota_0', 'ota_1'}


def test_partition_no_fs_has_no_filesystem(compiler: ESPIDFCompiler) -> None:
    csv = compiler._render_partition_csv('no_fs')
    assert compiler._find_filesystem_partition(csv) is None


def test_partition_default_has_spiffs(compiler: ESPIDFCompiler) -> None:
    csv = compiler._render_partition_csv('default')
    fs = compiler._find_filesystem_partition(csv)
    assert fs is not None
    assert fs['subtype'] == 'spiffs'
    assert fs['size'] > 0


# ── _render_sdkconfig ─────────────────────────────────────────────────────


def test_render_sdkconfig_emits_partition_custom(compiler: ESPIDFCompiler) -> None:
    # The template lives next to the compiler module.
    from app.services.espidf_compiler import _TEMPLATE_DIR
    opts = compiler._normalize_options(None, idf_target='esp32')
    text = compiler._render_sdkconfig(opts, _TEMPLATE_DIR)
    assert 'CONFIG_PARTITION_TABLE_CUSTOM=y' in text
    assert 'CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"' in text


def test_render_sdkconfig_flash_mode_exclusive(compiler: ESPIDFCompiler) -> None:
    from app.services.espidf_compiler import _TEMPLATE_DIR
    opts = compiler._normalize_options({'flashMode': 'qio'}, idf_target='esp32')
    text = compiler._render_sdkconfig(opts, _TEMPLATE_DIR)
    assert 'CONFIG_ESPTOOLPY_FLASHMODE_QIO=y' in text
    assert 'CONFIG_ESPTOOLPY_FLASHMODE_DIO=n' in text


def test_render_sdkconfig_psram_off_emits_disabled(compiler: ESPIDFCompiler) -> None:
    from app.services.espidf_compiler import _TEMPLATE_DIR
    opts = compiler._normalize_options(None, idf_target='esp32')
    text = compiler._render_sdkconfig(opts, _TEMPLATE_DIR)
    assert 'CONFIG_SPIRAM=n' in text


def test_render_sdkconfig_psram_opi_for_s3(compiler: ESPIDFCompiler) -> None:
    from app.services.espidf_compiler import _TEMPLATE_DIR
    opts = compiler._normalize_options({'psram': 'opi'}, idf_target='esp32s3')
    text = compiler._render_sdkconfig(opts, _TEMPLATE_DIR)
    assert 'CONFIG_SPIRAM=y' in text
    assert 'CONFIG_SPIRAM_MODE_OCT=y' in text


def test_render_sdkconfig_cpu_freq(compiler: ESPIDFCompiler) -> None:
    from app.services.espidf_compiler import _TEMPLATE_DIR
    opts = compiler._normalize_options({'cpuFreqMHz': 160}, idf_target='esp32')
    text = compiler._render_sdkconfig(opts, _TEMPLATE_DIR)
    assert 'CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ_160=y' in text
    assert 'CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ_240=n' in text
    assert 'CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ=160' in text


def test_render_sdkconfig_enables_mbedtls_psk(compiler: ESPIDFCompiler) -> None:
    # arduino-esp32's WiFiClientSecure/ssl_client.cpp guards its whole body on a
    # PSK key-exchange being enabled. Without it the object compiles empty and
    # any WiFiClientSecure / HTTPClient.begin() sketch fails to link with
    # "undefined reference to start_ssl_client".
    from app.services.espidf_compiler import _TEMPLATE_DIR
    opts = compiler._normalize_options(None, idf_target='esp32')
    text = compiler._render_sdkconfig(opts, _TEMPLATE_DIR)
    assert 'CONFIG_MBEDTLS_PSK_MODES=y' in text
    assert 'CONFIG_MBEDTLS_KEY_EXCHANGE_PSK=y' in text


def test_render_sdkconfig_debug_level_verbose(compiler: ESPIDFCompiler) -> None:
    from app.services.espidf_compiler import _TEMPLATE_DIR
    opts = compiler._normalize_options(
        {'coreDebugLevel': 'verbose'}, idf_target='esp32',
    )
    text = compiler._render_sdkconfig(opts, _TEMPLATE_DIR)
    assert 'CONFIG_ARDUHAL_LOG_DEFAULT_LEVEL=5' in text


def test_render_sdkconfig_arduino_running_core(compiler: ESPIDFCompiler) -> None:
    from app.services.espidf_compiler import _TEMPLATE_DIR
    opts = compiler._normalize_options(
        {'arduinoRunsOnCore': 0, 'eventsRunOnCore': 0}, idf_target='esp32',
    )
    text = compiler._render_sdkconfig(opts, _TEMPLATE_DIR)
    assert 'CONFIG_ARDUINO_RUNNING_CORE=0' in text
    assert 'CONFIG_ARDUINO_EVENT_RUNNING_CORE=0' in text


# ── _parse_partition_csv ──────────────────────────────────────────────────


def test_parse_partition_csv_handles_comments_and_blanks(compiler: ESPIDFCompiler) -> None:
    csv = (
        '# Comment\n'
        '\n'
        'nvs,      data, nvs,     0x9000,  0x5000,\n'
        'app0,     app,  ota_0,   0x10000, 0x100000,\n'
    )
    entries = compiler._parse_partition_csv(csv)
    assert len(entries) == 2
    assert entries[0]['name'] == 'nvs'
    assert entries[0]['offset'] == 0x9000
    assert entries[1]['name'] == 'app0'
    assert entries[1]['size'] == 0x100000


def test_find_filesystem_partition_prefers_spiffs(compiler: ESPIDFCompiler) -> None:
    csv = (
        'app0,     app,  ota_0,   0x10000, 0x100000,\n'
        'spiffs,   data, spiffs,  0x290000,0x160000,\n'
    )
    fs = compiler._find_filesystem_partition(csv)
    assert fs is not None
    assert fs['name'] == 'spiffs'
    assert fs['offset'] == 0x290000
