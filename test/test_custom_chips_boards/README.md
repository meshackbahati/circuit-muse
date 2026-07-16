# test_custom_chips_boards

Multi-board validation suite for the Velxio Custom Chip system. These tests
hit a **running backend** (the same uvicorn the frontend talks to) and assert
that the integration works end-to-end on every supported board family.

## Pre-requisites

- Backend running and reachable. By default the suite expects it at
  `http://127.0.0.1:8765`. Override with:
  ```bash
  export VELXIO_BACKEND_URL=http://localhost:8001
  ```
- WASI-SDK installed on the backend host (the `/api/compile-chip/status`
  endpoint reports this).
- Python deps: `pip install httpx websockets pytest pytest-asyncio`.

## Running

From the repo root:

```bash
# All tests
pytest test/test_custom_chips_boards/ -v

# Just the compile-endpoint smoke (no QEMU needed):
pytest test/test_custom_chips_boards/test_compile_endpoint.py -v

# Just the ESP32 WS bridge E2E (requires QEMU running in backend):
pytest test/test_custom_chips_boards/test_esp32_gpio_bridge.py -v
```

## Files

| Test | What it validates |
|------|-------------------|
| `test_compile_endpoint.py` | All 11 example chips compile via `/api/compile-chip` and produce valid WASM |
| `test_esp32_gpio_bridge.py` | An ESP32 sketch can exchange GPIO events with the WebSocket — the same path a custom chip would use |

## Why "validation" not "integration"

Custom chips run **inside the browser** for AVR, RP2040 and ESP32-C3. There's
no Python runtime that can host them. So this suite tests the parts that
*do* live on the backend (compile endpoint, ESP32 QEMU GPIO bridge), and the
browser-side AVR coverage stays in the JS sandbox at `test/test_custom_chips/`.

The full multi-board support matrix is documented in
[`../autosearch/07_multi_board_support.md`](../autosearch/07_multi_board_support.md).
