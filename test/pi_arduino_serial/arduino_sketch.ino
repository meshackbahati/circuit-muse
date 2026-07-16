/**
 * arduino_sketch.ino
 * ------------------
 * Part of the Pi <-> Arduino Serial Integration Test.
 *
 * Protocol (9600 baud, newline-terminated messages):
 *   Pi  --> Arduino : "HELLO_FROM_PI"
 *   Arduino --> Pi  : "ACK_FROM_ARDUINO"
 *
 * The sketch accumulates incoming characters into a line buffer.
 * When a full line arrives and it contains "HELLO_FROM_PI" it
 * replies "ACK_FROM_ARDUINO\n".  All other input is silently
 * ignored so kernel boot chatter from the Pi console does not
 * produce spurious replies.
 */

static String lineBuffer = "";

void setup() {
  Serial.begin(9600);
  // Signal that the Arduino is ready (useful for debugging via a real UART)
  Serial.println("ARDUINO_READY");
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') {
      // ignore carriage-return (Windows / Pi console may send \r\n)
      continue;
    }

    if (c == '\n') {
      // Process complete line
      if (lineBuffer.indexOf("HELLO_FROM_PI") >= 0) {
        Serial.println("ACK_FROM_ARDUINO");
      }
      lineBuffer = "";
    } else {
      lineBuffer += c;
      // Safety: prevent unbounded growth from high-volume console noise
      if (lineBuffer.length() > 256) {
        lineBuffer = "";
      }
    }
  }
}
