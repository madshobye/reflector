// ============================================================
// MQTT publisher indirection (NO MQTTClient type here)
// ============================================================
// Return true if published, false otherwise.
typedef bool (*MqttPublishFn)(const char* topic, const char* payload, void* user);

struct MqttLineOut {
  MqttPublishFn publish = nullptr;
  void* user = nullptr;
  const char* topic = nullptr;

  String buf;
  size_t maxLen = 16384;
};

static MqttLineOut g_mqttLineOut;
static bool g_mqttOutAdded = false;


// ============================================================
// comm.ino (LittleFS storage for Wrench sketches)
// - Keeps your command protocol intact
// - Stores Wrench code in LittleFS
// - RUNSTATE stays in Preferences (NVS)
// - Comm fan-out: Serial default, MQTT is LINE-BUFFERED (1 publish per JSON line)
// ============================================================

#include <Arduino.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <MQTT.h>

// ============================================================
// Serial line buffering (must be visible to pollSerial())
// ============================================================
static const size_t WRENCH_LINE_MAX = 32768;
static char g_lineBuf[WRENCH_LINE_MAX];
static size_t g_lineLen = 0;

// ============================================================
// Unified I/O sink (fan-out to multiple outputs)
// ============================================================
typedef void (*CommOutFn)(const char* data, size_t len, void* user);

struct CommOut {
  CommOutFn fn;
  void* user;
};

static CommOut g_outs[4];
static int g_outCount = 0;

static void commAddOutput(CommOutFn fn, void* user = nullptr) {
  if (!fn) return;
  if (g_outCount >= (int)(sizeof(g_outs) / sizeof(g_outs[0]))) return;
  g_outs[g_outCount++] = { fn, user };
}

static void commDefaultSerialOut(const char* data, size_t len, void*) {
  Serial.write((const uint8_t*)data, len);
}
// ============================================================
// MQTT line-buffered output (library-agnostic)
// - Buffers until '\n' then calls a publish callback
// ============================================================

typedef bool (*MqttPublishFn)(const char* topic, const char* payload, void* user);

static void commMqttLineOutFn(const char* data, size_t len, void* user) {
  MqttLineOut* o = (MqttLineOut*)user;
  if (!o || !o->publish || !o->topic) return;

  for (size_t i = 0; i < len; i++) {
    char c = data[i];

    // cap runaway
    if (o->buf.length() >= o->maxLen) {
      // flush partial to avoid silent loss
      o->publish(o->topic, o->buf.c_str(), o->user);
      o->buf = "";
    }

    o->buf += c;

    if (c == '\n') {
      // strip newline for MQTT payload cleanliness
      if (o->buf.length() && o->buf[o->buf.length() - 1] == '\n') {
        o->buf.remove(o->buf.length() - 1);
      }

      if (o->buf.length()) {
        o->publish(o->topic, o->buf.c_str(), o->user);
      }
      o->buf = "";
    }
  }
}

// Call this AFTER MQTT connects (safe to call multiple times; won't add duplicates).
void commAttachMqttPublisher(MqttPublishFn fn, void* user, const char* topic) {
  g_mqttLineOut.publish = fn;
  g_mqttLineOut.user    = user;
  g_mqttLineOut.topic   = topic;

  if (!g_mqttOutAdded) {
    commAddOutput(commMqttLineOutFn, &g_mqttLineOut);
    g_mqttOutAdded = true;
  }
}

// ============================================================
// commWrite
// ============================================================
static inline void commWrite(const char* data, size_t len) {
  if (g_outCount == 0) {
    commAddOutput(commDefaultSerialOut, nullptr);
  }
  for (int i = 0; i < g_outCount; i++) {
    g_outs[i].fn(data, len, g_outs[i].user);
  }
}


static inline void commWriteCStr(const char* s) {
  commWrite(s, s ? strlen(s) : 0);
}

static inline void commWriteChar(char c) {
  commWrite(&c, 1);
}

static void commFeedLine(const char* line) {
  if (!line || !line[0]) return;
  handleJsonLine(line);
}

unsigned long lastPublishMs = 0;
unsigned long lastReconnectAttemptMs = 0;
bool mqttWasConnected = false;

static String makeClientId() {
  uint64_t chipid = ESP.getEfuseMac();
  char buf[40];
  snprintf(buf, sizeof(buf), "esp32-%04X%08X",
           (uint16_t)(chipid >> 32), (uint32_t)chipid);
  return String(buf);
}

// ============================================================
// LittleFS-backed code storage
// ============================================================
static const char* WRENCH_CODE_PATH = "/wrench_code.txt";

// ------------------------------------------------------------
// Background compile task (prevents loopTask stack overflow)
// ------------------------------------------------------------
extern bool wrenchCompileAndRun(const String& userCode, String& errOut);

static TaskHandle_t g_compileTaskHandle = nullptr;
static SemaphoreHandle_t g_compileReqSem = nullptr;
static SemaphoreHandle_t g_compileDoneSem = nullptr;
static SemaphoreHandle_t g_compileMutex = nullptr;
static String g_compileCode;
static String g_compileErr;
static bool g_compileOk = false;

static void compileTask(void* arg) {
  (void)arg;
  for (;;) {
    if (xSemaphoreTake(g_compileReqSem, portMAX_DELAY) == pdTRUE) {
      String code;
      if (g_compileMutex) xSemaphoreTake(g_compileMutex, portMAX_DELAY);
      code = g_compileCode;
      if (g_compileMutex) xSemaphoreGive(g_compileMutex);

      String err;
      bool ok = wrenchCompileAndRun(code, err);

      if (g_compileMutex) xSemaphoreTake(g_compileMutex, portMAX_DELAY);
      g_compileOk = ok;
      g_compileErr = err;
      if (g_compileMutex) xSemaphoreGive(g_compileMutex);

      xSemaphoreGive(g_compileDoneSem);
    }
  }
}

void commInitCompileTask() {
  if (!g_compileReqSem) g_compileReqSem = xSemaphoreCreateBinary();
  if (!g_compileDoneSem) g_compileDoneSem = xSemaphoreCreateBinary();
  if (!g_compileMutex) g_compileMutex = xSemaphoreCreateMutex();
  if (!g_compileTaskHandle) {
    BaseType_t ok = xTaskCreatePinnedToCore(
      compileTask,
      "wrenchCompile",
      32768,
      nullptr,
      2,
      &g_compileTaskHandle,
      1);
    if (ok != pdPASS) {
      g_compileTaskHandle = nullptr;
      sendErr("compile task create failed");
    }
  }
}

static bool runCompileTask(const String& code, String& errOut) {
  if (g_compileMutex) xSemaphoreTake(g_compileMutex, portMAX_DELAY);
  g_compileCode = code;
  if (g_compileMutex) xSemaphoreGive(g_compileMutex);

  xSemaphoreGive(g_compileReqSem);

  if (xSemaphoreTake(g_compileDoneSem, pdMS_TO_TICKS(10000)) != pdTRUE) {
    errOut = "compile timeout";
    return false;
  }

  if (g_compileMutex) xSemaphoreTake(g_compileMutex, portMAX_DELAY);
  bool ok = g_compileOk;
  errOut = g_compileErr;
  if (g_compileMutex) xSemaphoreGive(g_compileMutex);
  return ok;
}

// Expose compile task runner for other translation units (e.g. setup boot path)
bool runCompileTaskNow(const String& code, String& errOut) {
  return runCompileTask(code, errOut);
}

UBaseType_t commGetCompileStackHW() {
  if (!g_compileTaskHandle) return 0;
  return uxTaskGetStackHighWaterMark(g_compileTaskHandle);
}
static bool g_fsReady = false;

static bool ensureLittleFS() {
  if (g_fsReady) return true;

  if (!LittleFS.begin(false)) {
    if (!LittleFS.begin(true)) {
      return false;
    }
  }
  g_fsReady = true;
  return true;
}

static bool readFileToString(const char* path, String& out) {
  out = "";
  if (!ensureLittleFS()) return false;

  File f = LittleFS.open(path, "r");
  if (!f) return false;

  size_t n = (size_t)f.size();
  if (n == 0) {
    f.close();
    out = "";
    return true;
  }

  if (n > 256000) { // adjust if needed
    f.close();
    return false;
  }

  char* buf = (char*)malloc(n + 1);
  if (!buf) {
    f.close();
    return false;
  }

  size_t got = f.readBytes(buf, n);
  buf[got] = 0;
  f.close();

  out = String(buf);
  free(buf);
  return (got == n);
}

static bool writeStringToFile(const char* path, const String& s) {
  if (!ensureLittleFS()) return false;

  if (LittleFS.exists(path)) {
    LittleFS.remove(path);
  }

  File f = LittleFS.open(path, "w");
  if (!f) return false;

  const size_t n = (size_t)s.length();
  size_t wrote = f.write((const uint8_t*)s.c_str(), n);
  f.flush();
  f.close();

  return (wrote == n);
}

// Compatibility wrappers
static bool loadCodeFromNVS(String& out) {
 // return false; // fix for first time boot
  return readFileToString(WRENCH_CODE_PATH, out);
}

static bool saveCodeToNVS(const String& code) {
  return writeStringToFile(WRENCH_CODE_PATH, code);
}

// ============================================================
// JSON command handling
// ============================================================
static void handleJsonLine(const char* json) {
  String cmd;
  if (!getJsonString(json, "cmd", cmd)) {
    sendErr("missing cmd");
    return;
  }

  if (cmd == "status") {
    sendStatus();
    return;
  }

  if (cmd == "get_code") {
    jsonBeginObj();
    jsonKey("ok");
    jsonValBool(true);
    jsonComma();
    jsonKey("code");
    jsonValString(g_code);
    jsonEndObjLn();
    return;
  }

  if (cmd == "set_code") {
    String code;
    if (!getJsonString(json, "code", code)) {
      sendErr("missing code");
      return;
    }
    if (code.length() == 0) {
      sendErr("empty code");
      return;
    }
    if (code.length() > 256000) {
      sendErr("code too large");
      return;
    }

    if (!saveCodeToNVS(code)) {
      sendErr("failed to save to LittleFS");
      return;
    }

    g_code = code;
    sendOk("stored; will run after reboot (send {\"cmd\":\"reboot\"} to restart now)");
    return;
  }

  if (cmd == "run_now") {
    String code;
    if (!getJsonString(json, "code", code)) {
      sendErr("missing code");
      return;
    }
    String err;
    if (!runCompileTask(code, err)) {
      sendErr(String("compile/run error: ") + err);
      return;
    }
    g_code = code;
    sendOk("compiled and running (not stored unless set_code)");
    return;
  }

  if (cmd == "send") {
    String data;
    if (!getJsonString(json, "data", data)) {
      sendErr("missing data");
      return;
    }
    g_inbox = data;
    g_inboxDirty = true;
    wrenchDeliverInboxIfHandler();
    sendOk("delivered");
    return;
  }

  if (cmd == "reboot") {
    if (millis() - g_bootMs < 3000) {
      sendErr("reboot ignored (too soon after boot)");
      return;
    }
    sendOk("rebooting");
    delay(50);
    ESP.restart();
    return;
  }

  if (cmd == "run_and_store") {
    String code;
    if (!getJsonString(json, "code", code)) {
      sendErr("missing code");
      return;
    }
    if (code.length() == 0) {
      sendErr("empty code");
      return;
    }
    if (code.length() > 256000) {
      sendErr("code too large");
      return;
    }

    // Debug hash (unchanged)
    uint32_t h = 2166136261u;  // FNV-1a
    for (size_t i = 0; i < code.length(); i++) {
      h ^= (uint8_t)code[i];
      h *= 16777619u;
    }
    jsonBeginObj();
    jsonKey("dbg");
    jsonValCString("code_rx");
    jsonComma();
    jsonKey("len");
    jsonValUInt(code.length());
    jsonComma();
    jsonKey("fnv");
    jsonValUInt(h);
    jsonEndObjLn();

    if (!saveCodeToNVS(code)) {
      sendErr("failed to save");
      return;
    }

    saveRunState(RUN_PENDING_NEW);

    String err;
    if (!runCompileTask(code, err)) {
      sendErr("compile/run failed");
      return;
    }

    g_code = code;
    g_runStartMs = millis();
    g_verificationArmed = true;

    sendOk("running + stored (will verify after 5s)");
    return;
  }

  sendErr(String("unknown cmd: ") + cmd);
}

// ============================================================
// Serial input
// ============================================================
static bool g_discardLine = false;

static void pollSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (g_discardLine) {
      if (c == '\n') {
        g_discardLine = false;
        g_lineLen = 0;
      }
      continue;
    }

    if (c == '\n') {
      g_lineBuf[g_lineLen] = 0;
      if (g_lineLen > 0) commFeedLine(g_lineBuf);
      g_lineLen = 0;
      continue;
    }
    if (c == '\r') continue;

    if (g_lineLen + 1 < WRENCH_LINE_MAX) g_lineBuf[g_lineLen++] = c;
    else {
      g_discardLine = true;
      g_lineLen = 0;
      sendErr("line too long (discarding until newline)");
    }
  }
}

// ============================================================
// RUNSTATE remains in NVS (Preferences) — unchanged
// ============================================================
static uint8_t loadRunState() {
  Preferences p;
  if (!p.begin(NVS_NS, true)) return RUN_NONE;
  uint8_t v = p.getUChar(NVS_RUNSTATE, RUN_NONE);
  p.end();
  return v;
}

static void saveRunState(uint8_t v) {
  Preferences p;
  if (!p.begin(NVS_NS, false)) return;
  p.putUChar(NVS_RUNSTATE, v);
  p.end();
}

// ============================================================
// Status reporting (unchanged)
// ============================================================
static void sendStatus() {
  jsonBeginObj();

  jsonKey("ok");
  jsonValBool(true);

  jsonComma();
  jsonKey("hasProgram");
  jsonValBool(g_hasProgram);

  jsonComma();
  jsonKey("tickExists");
  jsonValBool(g_fnTick != nullptr);

  jsonComma();
  jsonKey("onMsgExists");
  jsonValBool(g_fnOnMessage != nullptr);

  jsonComma();
  jsonKey("stripCount");
  jsonValInt(NUM_STRIPS);

  jsonComma();
  jsonKey("stripLen");
  jsonValInt(NUM_LEDS_PER_STRIP);

  jsonComma();
  jsonKey("totalLeds");
  jsonValInt(TOTAL_LEDS);

  jsonComma();
  jsonKey("brightness");
  jsonValInt((int)g_brightness);

  jsonComma();
  jsonKey("codeBytes");
  jsonValInt((int)g_code.length());

  jsonComma();
  jsonKey("ledTaskCore");
  jsonValInt(LED_TASK_CORE);

  jsonComma();
  jsonKey("spheres");
  jsonValInt(g_shapeCount);

  jsonEndObjLn();
}
