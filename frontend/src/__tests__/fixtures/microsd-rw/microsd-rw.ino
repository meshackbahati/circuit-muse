#include <SPI.h>
#include <SD.h>
void setup() {
  Serial.begin(9600);
  if (!SD.begin(10)) { Serial.println(F("BEGIN_FAIL")); return; }
  File f = SD.open("hello.txt");
  if (!f) { Serial.println(F("OPEN_FAIL")); return; }
  Serial.print(F("READ:"));
  while (f.available()) Serial.write(f.read());
  Serial.println();
  f.close();
  File w = SD.open("out.txt", FILE_WRITE);
  if (!w) { Serial.println(F("WOPEN_FAIL")); return; }
  w.print(F("written-123"));
  w.close();
  File r = SD.open("out.txt");
  if (!r) { Serial.println(F("RBACK_FAIL")); return; }
  Serial.print(F("RBACK:"));
  while (r.available()) Serial.write(r.read());
  Serial.println();
  r.close();
  Serial.println(F("DONE"));
}
void loop() {}
