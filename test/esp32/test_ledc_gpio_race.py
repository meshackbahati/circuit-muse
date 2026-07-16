"""
test_ledc_gpio_race.py

Tests for the LEDC GPIO mapping race condition fix in esp32_worker.py.

The core issue: when firmware calls ledcWrite(), the 0x5000 sync callback
fires immediately but the LEDC polling thread (100ms interval) hasn't yet
scanned gpio_out_sel to build _ledc_gpio_map.  The fix adds an eager scan
inside the 0x5000 handler on cache miss.

These tests exercise the scan logic and the cache-miss-triggered refresh
as pure functions, without loading QEMU.
"""



# ---------------------------------------------------------------------------
# Replicate the scan logic from esp32_worker._refresh_ledc_gpio_map()
# so we can test it in isolation.
# ---------------------------------------------------------------------------

def scan_out_sel(out_sel: list[int]) -> dict[int, int]:
    """Pure-Python equivalent of the gpio_out_sel scan in the worker.

    Returns a dict mapping LEDC channel -> GPIO pin.
    Signal 72-79 = LEDC HS ch 0-7; 80-87 = LEDC LS ch 0-7.
    """
    ledc_gpio_map: dict[int, int] = {}
    for gpio_pin in range(len(out_sel)):
        signal = out_sel[gpio_pin] & 0xFF
        if 72 <= signal <= 87:
            ledc_ch = signal - 72
            ledc_gpio_map[ledc_ch] = gpio_pin
    return ledc_gpio_map


def simulate_0x5000_handler(
    direction: int,
    ledc_gpio_map: dict[int, int],
    out_sel: list[int] | None = None,
) -> dict:
    """Simulate the 0x5000 LEDC duty callback with the eager-scan fix.

    If the map has no entry for the channel and out_sel is provided,
    it performs an eager scan (like the real worker does).

    Returns the event dict that would be emitted.
    """
    ledc_ch = (direction >> 8) & 0x0F
    intensity = direction & 0xFF
    gpio = ledc_gpio_map.get(ledc_ch, -1)
    if gpio == -1 and out_sel is not None:
        # Eager scan (same as _refresh_ledc_gpio_map)
        refreshed = scan_out_sel(out_sel)
        ledc_gpio_map.update(refreshed)
        gpio = ledc_gpio_map.get(ledc_ch, -1)
    return {
        'type': 'ledc_update',
        'channel': ledc_ch,
        'duty': intensity,
        'duty_pct': intensity,
        'gpio': gpio,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestScanOutSel:
    """Test the gpio_out_sel scanning logic."""

    def test_detects_ledc_hs_ch0_on_gpio13(self):
        out_sel = [256] * 40  # 256 = no function assigned
        out_sel[13] = 72      # LEDC HS ch0 -> GPIO 13
        result = scan_out_sel(out_sel)
        assert result[0] == 13
        assert len(result) == 1

    def test_detects_ledc_ls_ch0_on_gpio2(self):
        out_sel = [256] * 40
        out_sel[2] = 80       # LEDC LS ch0 (signal 80 = ch 8)
        result = scan_out_sel(out_sel)
        assert result[8] == 2

    def test_detects_multiple_channels(self):
        out_sel = [256] * 40
        out_sel[13] = 72  # HS ch0 -> GPIO 13
        out_sel[12] = 73  # HS ch1 -> GPIO 12
        out_sel[14] = 80  # LS ch0 -> GPIO 14
        result = scan_out_sel(out_sel)
        assert result[0] == 13
        assert result[1] == 12
        assert result[8] == 14
        assert len(result) == 3

    def test_ignores_non_ledc_signals(self):
        out_sel = [256] * 40
        out_sel[5] = 71   # signal 71 = not LEDC
        out_sel[6] = 88   # signal 88 = not LEDC
        out_sel[7] = 0    # signal 0 = GPIO simple output
        result = scan_out_sel(out_sel)
        assert len(result) == 0

    def test_masks_to_low_byte(self):
        out_sel = [256] * 40
        # High bytes should be masked off; 0x0148 & 0xFF = 72 = LEDC HS ch0
        out_sel[13] = 0x0148
        result = scan_out_sel(out_sel)
        assert result[0] == 13


class TestEagerScanOn0x5000:
    """Test the 0x5000 handler with eager scan on cache miss."""

    def _make_direction(self, ledc_ch: int, intensity: int) -> int:
        """Build a 0x5000-marker direction value."""
        return 0x5000 | ((ledc_ch & 0x0F) << 8) | (intensity & 0xFF)

    def test_eager_scan_populates_map_on_first_ledc_write(self):
        """When _ledc_gpio_map is empty, the handler should scan gpio_out_sel
        and emit the correct gpio pin."""
        ledc_gpio_map: dict[int, int] = {}
        out_sel = [256] * 40
        out_sel[13] = 72  # LEDC HS ch0 -> GPIO 13

        direction = self._make_direction(ledc_ch=0, intensity=5)
        event = simulate_0x5000_handler(direction, ledc_gpio_map, out_sel)

        assert event['gpio'] == 13
        assert event['channel'] == 0
        assert event['duty'] == 5
        # Map should now be populated for future calls
        assert ledc_gpio_map[0] == 13

    def test_no_scan_when_map_already_populated(self):
        """When the map already has the channel, no scan should occur."""
        ledc_gpio_map = {0: 13}
        # Pass out_sel=None to prove the scan is never reached
        direction = self._make_direction(ledc_ch=0, intensity=7)
        event = simulate_0x5000_handler(direction, ledc_gpio_map, out_sel=None)

        assert event['gpio'] == 13
        assert event['channel'] == 0

    def test_scan_only_on_cache_miss(self):
        """First call triggers scan (miss), second call skips it (hit)."""
        ledc_gpio_map: dict[int, int] = {}
        out_sel = [256] * 40
        out_sel[13] = 72

        # First call: cache miss -> scan
        dir1 = self._make_direction(ledc_ch=0, intensity=5)
        ev1 = simulate_0x5000_handler(dir1, ledc_gpio_map, out_sel)
        assert ev1['gpio'] == 13

        # Second call: cache hit -> no scan needed (pass None to prove)
        dir2 = self._make_direction(ledc_ch=0, intensity=10)
        ev2 = simulate_0x5000_handler(dir2, ledc_gpio_map, out_sel=None)
        assert ev2['gpio'] == 13
        assert ev2['duty'] == 10

    def test_multiple_channels_mapped_correctly(self):
        """Multiple LEDC channels resolve to correct GPIO pins."""
        ledc_gpio_map: dict[int, int] = {}
        out_sel = [256] * 40
        out_sel[13] = 72  # ch0 -> GPIO 13
        out_sel[12] = 73  # ch1 -> GPIO 12

        dir0 = self._make_direction(ledc_ch=0, intensity=5)
        ev0 = simulate_0x5000_handler(dir0, ledc_gpio_map, out_sel)
        assert ev0['gpio'] == 13

        dir1 = self._make_direction(ledc_ch=1, intensity=10)
        ev1 = simulate_0x5000_handler(dir1, ledc_gpio_map, out_sel=None)
        assert ev1['gpio'] == 12

    def test_fallback_when_no_mapping_exists(self):
        """When gpio_out_sel has no LEDC signals, gpio=-1 is emitted."""
        ledc_gpio_map: dict[int, int] = {}
        out_sel = [256] * 40  # No LEDC signals anywhere

        direction = self._make_direction(ledc_ch=0, intensity=5)
        event = simulate_0x5000_handler(direction, ledc_gpio_map, out_sel)

        assert event['gpio'] == -1

    def test_servo_angle_from_ledc_duty(self):
        """Verify that a correct LEDC duty maps to the expected servo angle.

        This is the end-to-end path: LEDC duty -> duty_pct/100 -> servo angle.
        For a servo at 50Hz with 544-2400us pulse range:
          7.5% duty = 1500us pulse -> ~93 degrees (close to 90)
        """
        duty_pct = 7.5
        duty_fraction = duty_pct / 100  # 0.075

        MIN_DC = 544 / 20000    # 0.0272
        MAX_DC = 2400 / 20000   # 0.12
        angle = round(((duty_fraction - MIN_DC) / (MAX_DC - MIN_DC)) * 180)

        assert 88 <= angle <= 95


class TestDirectionEncoding:
    """Verify the 0x5000 marker direction encoding/decoding."""

    def test_encode_decode_roundtrip(self):
        ledc_ch = 3
        intensity = 42
        direction = 0x5000 | ((ledc_ch & 0x0F) << 8) | (intensity & 0xFF)

        decoded_marker = direction & 0xF000
        decoded_ch = (direction >> 8) & 0x0F
        decoded_intensity = direction & 0xFF

        assert decoded_marker == 0x5000
        assert decoded_ch == ledc_ch
        assert decoded_intensity == intensity

    def test_channel_range_0_to_15(self):
        for ch in range(16):
            direction = 0x5000 | ((ch & 0x0F) << 8) | 50
            decoded_ch = (direction >> 8) & 0x0F
            assert decoded_ch == ch

    def test_intensity_range_0_to_100(self):
        for intensity in [0, 1, 50, 99, 100]:
            direction = 0x5000 | (0 << 8) | (intensity & 0xFF)
            decoded_intensity = direction & 0xFF
            assert decoded_intensity == intensity
