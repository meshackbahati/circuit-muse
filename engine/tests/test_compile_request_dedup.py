"""Unit tests for the /compile/start dedup key (_job_key).

Identical content + board + options should map to the same job_id (a duplicate
click while one build is in flight reuses the existing job). Any meaningful
change — different sketch, different board, different partition scheme,
different SPIFFS file content — must change the key so a fresh build runs.
"""
from __future__ import annotations

from app.api.routes.compile import _job_key


def _files() -> list[dict[str, str]]:
    return [{'name': 'sketch.ino', 'content': 'void setup(){} void loop(){}'}]


def test_same_inputs_same_key() -> None:
    key1 = _job_key(_files(), 'esp32:esp32:esp32')
    key2 = _job_key(_files(), 'esp32:esp32:esp32')
    assert key1 == key2


def test_different_sketch_changes_key() -> None:
    other_files = [{'name': 'sketch.ino', 'content': '// different'}]
    a = _job_key(_files(), 'esp32:esp32:esp32')
    b = _job_key(other_files, 'esp32:esp32:esp32')
    assert a != b


def test_different_board_changes_key() -> None:
    a = _job_key(_files(), 'esp32:esp32:esp32')
    b = _job_key(_files(), 'esp32:esp32:esp32s3')
    assert a != b


def test_board_options_change_changes_key() -> None:
    a = _job_key(_files(), 'esp32:esp32:esp32',
                 board_options={'partitionScheme': 'huge_app'})
    b = _job_key(_files(), 'esp32:esp32:esp32',
                 board_options={'partitionScheme': 'min_spiffs'})
    assert a != b


def test_board_options_order_does_not_matter() -> None:
    # The hash sorts keys so option-order doesn't perturb dedup.
    a = _job_key(_files(), 'esp32:esp32:esp32',
                 board_options={'partitionScheme': 'huge_app', 'cpuFreqMHz': 240})
    b = _job_key(_files(), 'esp32:esp32:esp32',
                 board_options={'cpuFreqMHz': 240, 'partitionScheme': 'huge_app'})
    assert a == b


def test_spiffs_files_change_changes_key() -> None:
    a = _job_key(_files(), 'esp32:esp32:esp32',
                 spiffs_files=[{'name': 'a.txt', 'content_b64': 'aGVsbG8='}])
    b = _job_key(_files(), 'esp32:esp32:esp32',
                 spiffs_files=[{'name': 'a.txt', 'content_b64': 'd29ybGQ='}])
    assert a != b


def test_spiffs_files_order_does_not_matter() -> None:
    files1 = [
        {'name': 'a.txt', 'content_b64': 'YQ=='},
        {'name': 'b.txt', 'content_b64': 'Yg=='},
    ]
    files2 = [
        {'name': 'b.txt', 'content_b64': 'Yg=='},
        {'name': 'a.txt', 'content_b64': 'YQ=='},
    ]
    assert _job_key(_files(), 'esp32:esp32:esp32', spiffs_files=files1) == \
           _job_key(_files(), 'esp32:esp32:esp32', spiffs_files=files2)


def test_no_options_no_spiffs_legacy_key() -> None:
    # Backwards-compat: calling without the new kwargs yields the same key
    # as explicit None — pre-feature clients keep working.
    a = _job_key(_files(), 'esp32:esp32:esp32')
    b = _job_key(_files(), 'esp32:esp32:esp32', board_options=None, spiffs_files=None)
    assert a == b
