#ifndef VELXIO_COMPAT_H
#define VELXIO_COMPAT_H

// Compatibility shims for sketches written against arduino-esp32 3.x running
// on the toolchain pinned to 2.0.17. Only kept until we bump the toolchain.
//
// arduino-esp32 3.x reshaped the LEDC API around pins:
//   - ledcAttach(pin, freq, res)      // auto-allocates a channel
//   - ledcAttachChannel(pin, freq, res, channel)
//   - ledcWrite(pin, duty)            // takes pin, looks up channel
//
// arduino-esp32 2.x is channel-centric:
//   - ledcSetup(channel, freq, res)
//   - ledcAttachPin(pin, channel)
//   - ledcWrite(channel, duty)
//
// We shim the 3.x calls onto the 2.x pair so unmodified 3.x sketches both
// compile AND drive the LEDC peripheral correctly. A pin-to-channel table
// keeps `ledcWrite(pin, ...)` working — without that translation
// `ledcWrite(16, ...)` writes to LEDC channel 16 (invalid; channels are
// 0-15) and the duty register never changes, so qemu-lcgamboa never emits
// a duty event and the LED stays dark.

#if defined(ARDUINO_ARCH_ESP32) && !defined(ledcAttach)
#include "Arduino.h"

// ESP32 / S2 / S3 / C3 all have <40 usable GPIOs. Sentinel 0xFF = unmapped.
static uint8_t _velxio_pin_to_channel[40] = {
    0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,
    0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,
    0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,
    0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,
};

static inline bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution) {
    static uint8_t _velxio_next_channel = 0;
    if (_velxio_next_channel >= 16) return false;
    uint8_t ch = _velxio_next_channel++;
    ledcSetup(ch, freq, resolution);
    ledcAttachPin(pin, ch);
    if (pin < 40) _velxio_pin_to_channel[pin] = ch;
    return true;
}

static inline bool ledcAttachChannel(uint8_t pin, uint32_t freq, uint8_t resolution, uint8_t channel) {
    if (channel >= 16) return false;
    ledcSetup(channel, freq, resolution);
    ledcAttachPin(pin, channel);
    if (pin < 40) _velxio_pin_to_channel[pin] = channel;
    return true;
}

// 3.x-style ledcWrite(pin, duty). Translate pin→channel via the table if
// we know about this pin; otherwise fall through to 2.x channel semantics
// so plain 2.x sketches keep working unchanged.
static inline void _velxio_ledc_write(uint32_t pin_or_channel, uint32_t duty) {
    if (pin_or_channel < 40) {
        uint8_t ch = _velxio_pin_to_channel[pin_or_channel];
        if (ch != 0xFF) {
            // The extra parentheses around `ledcWrite` block macro expansion
            // (function-like macros only expand when followed by `(`), so
            // this calls the real 2.x ledcWrite from esp32-hal-ledc.h.
            (ledcWrite)((uint8_t)ch, duty);
            return;
        }
    }
    (ledcWrite)((uint8_t)pin_or_channel, duty);
}

#define ledcWrite(pin_or_channel, duty) _velxio_ledc_write((pin_or_channel), (duty))
#endif

#endif // VELXIO_COMPAT_H
