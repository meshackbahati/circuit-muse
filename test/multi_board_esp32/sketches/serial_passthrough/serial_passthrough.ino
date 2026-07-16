// Bidirectional ESP32 ↔ ESP32 serial passthrough.
//
// Each ESP32's USB Serial talks to the host Python; Serial2 (UART2 on
// GPIO16=RX / GPIO17=TX) talks to the OTHER ESP32 via the wire that
// the Velxio Interconnect routes through the WebSocket bridge.
//
// Usage in the dual-ESP32 integration test:
//   - Host writes "PING-A" to ESP32-A's USB Serial
//   - ESP32-A forwards it to Serial2 (TX on GPIO17)
//   - The frontend Interconnect bridges A.GPIO17 → B.GPIO16 over WS
//   - ESP32-B reads it from Serial2 (RX on GPIO16)
//   - ESP32-B prints the received line back on USB Serial
//   - Host observes "PING-A" on ESP32-B's USB Serial output
//
// Compile (one-shot):
//   arduino-cli compile --fqbn esp32:esp32:esp32 \
//     --output-dir test/multi_board_esp32/out \
//     test/multi_board_esp32/sketches/serial_passthrough

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  delay(100);
  Serial.println("READY");
}

void loop() {
  if (Serial.available()) {
    int c = Serial.read();
    Serial2.write(c);
  }
  if (Serial2.available()) {
    int c = Serial2.read();
    Serial.write(c);
  }
}
