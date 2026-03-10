

// ============================================================
// Tiny JSON helpers
// ============================================================
static inline bool isWS(char c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}
static const char* skipWS(const char* p) {
  while (*p && isWS(*p)) p++;
  return p;
}

static bool parseQuotedString(const char*& p, String& out) {
  out = "";
  p = skipWS(p);
  if (*p != '"') return false;
  p++;
  while (*p) {
    char c = *p++;
    if (c == '"') return true;
    if (c == '\\') {
      char e = *p++;
      if (!e) return false;
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        default: out += e; break;
      }
    } else out += c;
  }
  return false;
}

static bool parseNumber(const char*& p) {
  p = skipWS(p);
  if (!*p) return false;

  if (*p == '-') p++;

  bool any = false;
  while (isdigit((unsigned char)*p)) {
    p++;
    any = true;
  }

  if (*p == '.') {
    p++;
    while (isdigit((unsigned char)*p)) {
      p++;
      any = true;
    }
  }

  // optional exponent
  if (*p == 'e' || *p == 'E') {
    p++;
    if (*p == '+' || *p == '-') p++;
    bool expAny = false;
    while (isdigit((unsigned char)*p)) {
      p++;
      expAny = true;
    }
    if (!expAny) return false;
    any = true;
  }

  return any;
}


static bool parseInt(const char*& p, long& v) {
  p = skipWS(p);
  bool neg = false;
  if (*p == '-') {
    neg = true;
    p++;
  }
  if (!isdigit((unsigned char)*p)) return false;
  long x = 0;
  while (isdigit((unsigned char)*p)) {
    x = x * 10 + (*p - '0');
    p++;
  }
  v = neg ? -x : x;
  return true;
}

static bool parseLiteral(const char*& p, const char* lit) {
  p = skipWS(p);
  while (*lit) {
    if (*p++ != *lit++) return false;
  }
  return true;
}

static const char* findKeyValue(const char* json, const char* key) {
  const char* p = skipWS(json);
  if (*p != '{') return nullptr;
  p++;
  while (*p) {
    p = skipWS(p);
    if (*p == '}') return nullptr;

    String k;
    if (!parseQuotedString(p, k)) return nullptr;
    p = skipWS(p);
    if (*p != ':') return nullptr;
    p++;
    p = skipWS(p);

    if (k == key) return p;

    // skip value
    if (*p == '"') {
      String tmp;
      if (!parseQuotedString(p, tmp)) return nullptr;
    } else if (*p == 't') {
      if (!parseLiteral(p, "true")) return nullptr;
    } else if (*p == 'f') {
      if (!parseLiteral(p, "false")) return nullptr;
    } else if (*p == 'n') {
      if (!parseLiteral(p, "null")) return nullptr;
    } else {
      if (!parseNumber(p)) return nullptr;
    }

    p = skipWS(p);
    if (*p == ',') {
      p++;
      continue;
    }
    if (*p == '}') return nullptr;
    return nullptr;
  }
  return nullptr;
}

static bool getJsonString(const char* json, const char* key, String& out) {
  const char* p = findKeyValue(json, key);
  if (!p) return false;
  return parseQuotedString(p, out);
}
// ============================================================
// JSON response/event builder (NO Serial.print anywhere else)
// ============================================================
static void jsonWriteEscaped(const String& s) {
  commWriteChar('"');
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    switch (c) {
      case '"': commWriteCStr("\\\""); break;
      case '\\': commWriteCStr("\\\\"); break;
      case '\n': commWriteCStr("\\n"); break;
      case '\r': commWriteCStr("\\r"); break;
      case '\t': commWriteCStr("\\t"); break;
      default:
        if ((uint8_t)c < 0x20) commWriteChar(' ');
        else commWriteChar(c);
        break;
    }
  }
  commWriteChar('"');
}

static void jsonWriteEscapedCStr(const char* s, bool addNewline) {
  commWriteChar('"');
  if (s) {
    for (const char* p = s; *p; ++p) {
      char c = *p;
      switch (c) {
        case '"': commWriteCStr("\\\""); break;
        case '\\': commWriteCStr("\\\\"); break;
        case '\n': commWriteCStr("\\n"); break;
        case '\r': commWriteCStr("\\r"); break;
        case '\t': commWriteCStr("\\t"); break;
        default:
          if ((uint8_t)c < 0x20) commWriteChar(' ');
          else commWriteChar(c);
          break;
      }
    }
  }
  if (addNewline) {
    commWriteCStr("\\n");
  }
  commWriteChar('"');
}

static SemaphoreHandle_t g_jsonMutex = nullptr;
static inline void jsonLock() {
  if (!g_jsonMutex) g_jsonMutex = xSemaphoreCreateMutex();
  if (g_jsonMutex) xSemaphoreTake(g_jsonMutex, portMAX_DELAY);
}
static inline void jsonUnlock() {
  if (g_jsonMutex) xSemaphoreGive(g_jsonMutex);
}

static void sendOk(const String& msg) {
  jsonLock();
  commWriteCStr("{\"ok\":true,\"msg\":");
  jsonWriteEscaped(msg);
  commWriteCStr("}\n");
  jsonUnlock();
}

static void send(const String& key, const String& msg) {
  
}

static void sendErr(const String& msg) {
  jsonLock();
  commWriteCStr("{\"ok\":false,\"err\":");
  jsonWriteEscaped(msg);
  commWriteCStr("}\n");
  jsonUnlock();
}

static void emitPrintEvent(const String& text) {
  jsonLock();
  commWriteCStr("{\"event\":\"print\",\"text\":");
  jsonWriteEscaped(text);
  commWriteCStr("}\n");
  jsonUnlock();
}

static void emitPrintEventCStr(const char* text, bool addNewline) {
  jsonLock();
  commWriteCStr("{\"event\":\"print\",\"text\":");
  jsonWriteEscapedCStr(text, addNewline);
  commWriteCStr("}\n");
  jsonUnlock();
}

static void emitDbgCodeRx(size_t len, uint32_t fnv) {
  char buf[128];
  int n = snprintf(buf, sizeof(buf),
                   "{\"dbg\":\"code_rx\",\"len\":%u,\"fnv\":%u}\n",
                   (unsigned)len, (unsigned)fnv);
  if (n > 0) {
    jsonLock();
    commWrite(buf, (size_t)n);
    jsonUnlock();
  }
}





// ============================================================
// Generic JSON key/value send helpers
// ============================================================

static void jsonBeginObj() {
  commWriteChar('{');
}
static void jsonEndObjLn() {
  commWriteCStr("}\n");
}

static void jsonKey(const char* k) {
  commWriteChar('"');
  commWriteCStr(k ? k : "");
  commWriteCStr("\":");
}

static void jsonComma() {
  commWriteChar(',');
}

// value writers
static void jsonValBool(bool v) {
  commWriteCStr(v ? "true" : "false");
}
static void jsonValInt(int v) {
  char buf[32];
  int n = snprintf(buf, sizeof(buf), "%d", v);
  if (n > 0) commWrite(buf, (size_t)n);
}
static void jsonValUInt(uint32_t v) {
  char buf[32];
  int n = snprintf(buf, sizeof(buf), "%u", (unsigned)v);
  if (n > 0) commWrite(buf, (size_t)n);
}
static void jsonValFloat(float v) {
  // keep short + stable
  char buf[48];
  int n = snprintf(buf, sizeof(buf), "%.6f", (double)v);
  if (n > 0) commWrite(buf, (size_t)n);
}
static void jsonValString(const String& s) {
  jsonWriteEscaped(s);
}
static void jsonValCString(const char* s) {
  jsonWriteEscaped(String(s ? s : ""));
}

// ============================================================
// High-level "send KV" convenience
// ============================================================

// {"event":"name","key":"value"} or {"event":"name","key":123}
static void sendKV_str(const char* eventName, const char* key, const String& value) {
  jsonLock();
  jsonBeginObj();
  jsonKey("event");
  jsonValCString(eventName);
  jsonComma();
  jsonKey(key);
  jsonValString(value);
  jsonEndObjLn();
  jsonUnlock();
}

static void sendKV_cstr(const char* eventName, const char* key, const char* value) {
  jsonLock();
  jsonBeginObj();
  jsonKey("event");
  jsonValCString(eventName);
  jsonComma();
  jsonKey(key);
  jsonValCString(value);
  jsonEndObjLn();
  jsonUnlock();
}

static void sendKV_int(const char* eventName, const char* key, int value) {
  jsonLock();
  jsonBeginObj();
  jsonKey("event");
  jsonValCString(eventName);
  jsonComma();
  jsonKey(key);
  jsonValInt(value);
  jsonEndObjLn();
  jsonUnlock();
}

static void sendKV_uint(const char* eventName, const char* key, uint32_t value) {
  jsonLock();
  jsonBeginObj();
  jsonKey("event");
  jsonValCString(eventName);
  jsonComma();
  jsonKey(key);
  jsonValUInt(value);
  jsonEndObjLn();
  jsonUnlock();
}

static void sendKV_bool(const char* eventName, const char* key, bool value) {
  jsonLock();
  jsonBeginObj();
  jsonKey("event");
  jsonValCString(eventName);
  jsonComma();
  jsonKey(key);
  jsonValBool(value);
  jsonEndObjLn();
  jsonUnlock();
}

static void sendKV_float(const char* eventName, const char* key, float value) {
  jsonLock();
  jsonBeginObj();
  jsonKey("event");
  jsonValCString(eventName);
  jsonComma();
  jsonKey(key);
  jsonValFloat(value);
  jsonEndObjLn();
  jsonUnlock();
}
