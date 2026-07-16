"""Unit tests for app.services.signal_router.SignalRouter.

Mirror of the ESP32 GPIO Matrix abstraction.  Covers:

* idempotent updates (re-emitting the same routing is a no-op)
* signal re-routing (a pin moves from signal A to signal B → reverse
  index stays a clean partition; A's set loses the pin, B's set
  gains it)
* multi-pin routing (rare but legal: one signal drives multiple pins)
* clear_routing (firmware resets the matrix entry)
* snapshot replace returning the diff (changed_routes + cleared_pins)
* the LEDC channel ↔ signal id translation helpers in esp32_signals

Fidelity rule (memory `feedback_tests_import_real_code`): imports
the real production modules; no duplicated mock implementation.
"""

from __future__ import annotations

import pytest

from app.services.signal_router import SignalRouter
from app.services.esp32_signals import (
    SIG_LEDC_HS_CH0_OUT_IDX,
    SIG_LEDC_LS_CH0_OUT_IDX,
    channel_for_ledc_signal,
    ledc_signal_for_channel,
)


# ──────────────────────────────────────────────────────────────────────────
# SignalRouter — core update/lookup
# ──────────────────────────────────────────────────────────────────────────


def test_update_routing_populates_both_indexes() -> None:
    r = SignalRouter()
    r.update_routing(13, SIG_LEDC_HS_CH0_OUT_IDX)
    assert r.signal_for_gpio(13) == SIG_LEDC_HS_CH0_OUT_IDX
    assert r.pins_for_signal(SIG_LEDC_HS_CH0_OUT_IDX) == (13,)


def test_update_routing_idempotent() -> None:
    r = SignalRouter()
    r.update_routing(13, SIG_LEDC_HS_CH0_OUT_IDX)
    r.update_routing(13, SIG_LEDC_HS_CH0_OUT_IDX)  # exact same call
    r.update_routing(13, SIG_LEDC_HS_CH0_OUT_IDX)
    assert r.pins_for_signal(SIG_LEDC_HS_CH0_OUT_IDX) == (13,)


def test_rerouting_pin_moves_it_in_reverse_index() -> None:
    r = SignalRouter()
    sig_a = SIG_LEDC_HS_CH0_OUT_IDX      # 72
    sig_b = SIG_LEDC_HS_CH0_OUT_IDX + 1  # 73
    r.update_routing(13, sig_a)
    r.update_routing(13, sig_b)
    # Forward: pin 13 now points at signal B
    assert r.signal_for_gpio(13) == sig_b
    # Reverse: signal A is empty; signal B has pin 13
    assert r.pins_for_signal(sig_a) == ()
    assert r.pins_for_signal(sig_b) == (13,)


def test_multi_pin_routing_for_one_signal() -> None:
    """Same signal driving two pins (legal in ESP32 GPIO Matrix —
    e.g. clock-out signal mirrored to two debug pins)."""
    r = SignalRouter()
    sig = SIG_LEDC_HS_CH0_OUT_IDX
    r.update_routing(12, sig)
    r.update_routing(13, sig)
    assert r.pins_for_signal(sig) == (12, 13)  # sorted


def test_clear_routing_removes_pin() -> None:
    r = SignalRouter()
    sig = SIG_LEDC_HS_CH0_OUT_IDX
    r.update_routing(13, sig)
    r.clear_routing(13)
    assert r.signal_for_gpio(13) is None
    assert r.pins_for_signal(sig) == ()


def test_clear_routing_idempotent_when_unset() -> None:
    r = SignalRouter()
    r.clear_routing(99)  # never set; should not raise
    assert r.signal_for_gpio(99) is None


def test_pins_for_signal_returns_tuple_safe_for_iteration() -> None:
    """The returned tuple must not change if the router mutates
    afterwards — protects callers iterating the result while the
    QEMU thread is updating the routing."""
    r = SignalRouter()
    sig = SIG_LEDC_HS_CH0_OUT_IDX
    r.update_routing(13, sig)
    snapshot = r.pins_for_signal(sig)
    r.update_routing(12, sig)  # add another pin
    assert snapshot == (13,)   # unchanged
    assert r.pins_for_signal(sig) == (12, 13)


def test_routes_iterator_returns_full_matrix() -> None:
    r = SignalRouter()
    r.update_routing(13, 72)
    r.update_routing(12, 73)
    r.update_routing(14, 80)
    assert dict(r.routes()) == {13: 72, 12: 73, 14: 80}


def test_len_reports_number_of_routed_pins() -> None:
    r = SignalRouter()
    assert len(r) == 0
    r.update_routing(13, 72)
    assert len(r) == 1
    r.update_routing(12, 73)
    assert len(r) == 2
    r.clear_routing(13)
    assert len(r) == 1


# ──────────────────────────────────────────────────────────────────────────
# replace_snapshot — used by the polling-fallback path
# ──────────────────────────────────────────────────────────────────────────


def test_replace_snapshot_returns_diff_for_brand_new_entries() -> None:
    r = SignalRouter()
    changed, cleared = r.replace_snapshot({13: 72, 12: 73})
    assert sorted(changed) == [(12, 73), (13, 72)]
    assert cleared == []


def test_replace_snapshot_returns_diff_for_changed_routes_only() -> None:
    r = SignalRouter()
    r.update_routing(13, 72)
    r.update_routing(12, 73)
    # Move pin 13 to a new signal; keep pin 12; add pin 14.
    changed, cleared = r.replace_snapshot({13: 75, 12: 73, 14: 80})
    assert (13, 75) in changed
    assert (14, 80) in changed
    assert (12, 73) not in changed   # unchanged, not in diff
    assert cleared == []


def test_replace_snapshot_reports_cleared_pins() -> None:
    r = SignalRouter()
    r.update_routing(13, 72)
    r.update_routing(12, 73)
    changed, cleared = r.replace_snapshot({13: 72})  # pin 12 dropped
    assert changed == []
    assert cleared == [12]


def test_replace_snapshot_combines_changes_and_clears() -> None:
    r = SignalRouter()
    r.update_routing(13, 72)
    r.update_routing(12, 73)
    r.update_routing(14, 80)
    # Drop 13, re-route 12, keep 14.
    changed, cleared = r.replace_snapshot({12: 75, 14: 80})
    assert (12, 75) in changed
    assert (14, 80) not in changed
    assert cleared == [13]
    # Post-state matches the snapshot exactly.
    assert dict(r.routes()) == {12: 75, 14: 80}


# ──────────────────────────────────────────────────────────────────────────
# esp32_signals — channel ↔ signal id helpers
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "channel,expected",
    [
        (0,  SIG_LEDC_HS_CH0_OUT_IDX),      # 71 (HS ch 0)
        (7,  SIG_LEDC_HS_CH0_OUT_IDX + 7),  # 78 (HS ch 7)
        (8,  SIG_LEDC_LS_CH0_OUT_IDX),      # 79 (LS ch 0)
        (15, SIG_LEDC_LS_CH0_OUT_IDX + 7),  # 86 (LS ch 7)
    ],
)
def test_ledc_signal_for_channel_roundtrip(channel: int, expected: int) -> None:
    assert ledc_signal_for_channel(channel) == expected
    assert channel_for_ledc_signal(expected) == channel


def test_ledc_signal_for_channel_rejects_out_of_range() -> None:
    with pytest.raises(ValueError):
        ledc_signal_for_channel(-1)
    with pytest.raises(ValueError):
        ledc_signal_for_channel(16)


def test_channel_for_ledc_signal_returns_none_for_non_ledc() -> None:
    # 70 is the signal immediately below the LEDC range; 87 is the
    # signal immediately above.  Both must return None — anything
    # else implies the constants drifted away from the ESP32 TRM.
    assert channel_for_ledc_signal(0) is None
    assert channel_for_ledc_signal(70) is None
    assert channel_for_ledc_signal(87) is None
    assert channel_for_ledc_signal(256) is None


# ──────────────────────────────────────────────────────────────────────────
# Multi-servo blink regression — the original bug
# ──────────────────────────────────────────────────────────────────────────


def test_multi_servo_routing_does_not_alias() -> None:
    """The exact scenario from the user report
    (project 5218f9e3, solar-tracker): two servos on GPIO 13 and 12,
    each on its own LEDC HS channel. Writing duty to channel 0
    must only affect pin 13; writing to channel 1 only affects
    pin 12. The old broadcastPwm path made both pins mirror the
    last channel written."""
    r = SignalRouter()
    sig_pan  = ledc_signal_for_channel(0)  # 72
    sig_tilt = ledc_signal_for_channel(1)  # 73
    r.update_routing(13, sig_pan)
    r.update_routing(12, sig_tilt)

    # The router must produce disjoint pin sets per channel.
    assert r.pins_for_signal(sig_pan) == (13,)
    assert r.pins_for_signal(sig_tilt) == (12,)
    # A duty on channel 0 routes ONLY to pin 13, not pin 12.
    assert 12 not in r.pins_for_signal(sig_pan)
    assert 13 not in r.pins_for_signal(sig_tilt)
