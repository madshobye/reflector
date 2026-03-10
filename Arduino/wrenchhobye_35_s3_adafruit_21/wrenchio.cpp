#include <Arduino.h>

// Wrench stdio hooks (needed when std/printf is compiled in)
void wr_stdout(const char* s, int len) {
  if (!s || len <= 0) return;
  Serial.write((const uint8_t*)s, (size_t)len);
}

void wr_stderr(const char* s, int len) {
  if (!s || len <= 0) return;
  Serial.write((const uint8_t*)s, (size_t)len);
}