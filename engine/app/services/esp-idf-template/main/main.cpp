/**
 * Arduino-as-ESP-IDF-component wrapper.
 *
 * The espidf_compiler writes the user's entry .ino as "sketch.ino.cpp"
 * into this directory and drops every helper .h/.cpp alongside it.
 * The CMakeLists.txt globs *.cpp/*.c into SRCS, so each TU compiles
 * standalone — setup() and loop() are defined exactly once across the
 * link (in sketch.ino.cpp) and we just call them from app_main() with
 * a forward declaration.
 *
 * Note: do NOT switch this back to `#include "sketch.ino.cpp"` — the
 * textual include would re-define setup()/loop() inside this TU as
 * well, fighting the standalone sketch.ino.cpp.obj for the symbol
 * and tripping the linker with "multiple definition of `setup'".
 */
#include "Arduino.h"

void setup();
void loop();

extern "C" void app_main(void) {
    initArduino();
    setup();
    while (true) {
        loop();
        vTaskDelay(1);
    }
}
