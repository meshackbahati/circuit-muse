// Minimal blink sketch for ESP32-P4
// Toggles GPIO2 every 500 ms.

#define LED_PIN 2

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("ESP32-P4 blink starting");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("HIGH");
  delay(500);
  digitalWrite(LED_PIN, LOW);
  Serial.println("LOW");
  delay(500);
}
