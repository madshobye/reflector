static volatile uint32_t g_renderClaimMs = 0;
static volatile uint32_t g_lastFrameNotifyMs = 0;
static int g_nextSphereIdx = 0;
// warn-once flags (forward declaration)
static bool g_warn_leds_set_pixel_striplen = false;
static bool g_warn_leds_get_pixel_striplen = false;

// Time sync hooks (mqttwifi.ino)
bool timeIsSynced();
void timeRequestSync();
void timeSetTimezone(const char* tz);
// ============================================================
// Wrench arg/ret helpers
// ============================================================
static inline int clampi(int v, int lo, int hi) {
  return (v < lo) ? lo : ((v > hi) ? hi : v);
}
static inline float clampf(float v, float lo, float hi) {
  return (v < lo) ? lo : ((v > hi) ? hi : v);
}

static inline int argInt(const WRValue* argv, int argn, int idx, int def) {
  if (!argv || idx >= argn) return def;
  const WRValue& v = argv[idx];
  if (v.isInt()) return v.asInt();
  if (v.isFloat()) return (int)v.asFloat();
  WRValue::MallocStrScoped s(v);
  return s ? atoi((const char*)s) : def;
}
static inline float argFloat(const WRValue* argv, int argn, int idx, float def) {
  if (!argv || idx >= argn) return def;
  const WRValue& v = argv[idx];
  if (v.isFloat()) return v.asFloat();
  if (v.isInt()) return (float)v.asInt();
  WRValue::MallocStrScoped s(v);
  return s ? (float)atof((const char*)s) : def;
}
static inline const char* argCStringTmp(const WRValue* argv, int argn, int idx, char* buf, size_t buflen) {
  if (!argv || idx >= argn) {
    if (buflen) buf[0] = 0;
    return buf;
  }
  const WRValue& v = argv[idx];
  v.asString(buf, (unsigned int)buflen);
  return buf;
}

static inline int structInt(const WRValue& v, const char* name, int def) {
  const WRValue& dv = v.deref();
  if (dv.isHashTable()) {
    WRValue* h = wr_getValueFromContainer(dv, name);
    if (!h) return def;
    if (h->isInt()) return h->asInt();
    if (h->isFloat()) return (int)h->asFloat();
    return def;
  }
  WRValue* m = dv.indexStruct(name);
  if (m) {
    if (m->isInt()) return m->asInt();
    if (m->isFloat()) return (int)m->asFloat();
    return def;
  }
  return def;
}
static inline float structFloat(const WRValue& v, const char* name, float def) {
  const WRValue& dv = v.deref();
  if (dv.isHashTable()) {
    WRValue* h = wr_getValueFromContainer(dv, name);
    if (!h) return def;
    if (h->isFloat()) return h->asFloat();
    if (h->isInt()) return (float)h->asInt();
    return def;
  }
  WRValue* m = dv.indexStruct(name);
  if (m) {
    if (m->isFloat()) return m->asFloat();
    if (m->isInt()) return (float)m->asInt();
    return def;
  }
  return def;
}
static inline void structSetInt(WRValue& v, const char* name, int val) {
  WRValue& dv = v.deref();
  if (dv.isHashTable()) {
    WRValue* h = wr_getValueFromContainer(dv, name);
    if (h) {
      h->setInt(val);
    } else {
      wr_addIntToContainer(&dv, name, val);
    }
    return;
  }
  WRValue* m = dv.indexStruct(name);
  if (m) {
    m->setInt(val);
  }
}
static inline void structSetFloat(WRValue& v, const char* name, float val) {
  WRValue& dv = v.deref();
  if (dv.isHashTable()) {
    WRValue* h = wr_getValueFromContainer(dv, name);
    if (h) {
      h->setFloat(val);
    } else {
      wr_addFloatToContainer(&dv, name, val);
    }
    return;
  }
  WRValue* m = dv.indexStruct(name);
  if (m) {
    m->setFloat(val);
  }
}

// Forward declarations for struct-based overloads
static void w_sdf_update_sphere(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*);
static void w_sdf_update_box(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*);
void sdfResetAll();

// Reused containers to avoid per-tick allocations
static WRValue g_vec3Tmp;
static bool g_vec3TmpInit = false;
static WRValue g_endpointsTmp;
static WRValue g_endA;
static WRValue g_endB;
static bool g_endpointsTmpInit = false;
static WRValue g_colorTmp;
static bool g_colorTmpInit = false;
static bool g_warn_tube_xyz3 = false;
static bool g_warn_tube_endpoints3 = false;
static bool g_warn_lerp3 = false;
static bool g_warn_lerp_color = false;

// out-parameter helpers (no allocations per tick)
static void w_tube_xyz_out(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*);
static void w_tube_endpoints_out(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*);

static inline void retInt(WRValue& retVal, int v) {
  wr_makeInt(&retVal, v);
}
static inline void retFloat(WRValue& retVal, float v) {
  wr_makeFloat(&retVal, v);
}
static inline void retString(WRContext* c, WRValue& retVal, const char* s) {
  wr_makeString(c, &retVal, s ? s : "", 0);
}


// ============================================================
// Wrench "Arduino-ish" bindings
// ============================================================
static void w_pinMode(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = argInt(argv, argn, 0, -1);
  int mode = argInt(argv, argn, 1, INPUT);
  if (pin >= 0) pinMode(pin, mode);
  retInt(retVal, 0);
}
static void w_digitalWrite(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = argInt(argv, argn, 0, -1);
  int v = argInt(argv, argn, 1, LOW);
  if (pin >= 0) digitalWrite(pin, v);
  retInt(retVal, 0);
}
static void w_digitalRead(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = argInt(argv, argn, 0, -1);
  retInt(retVal, (pin >= 0) ? digitalRead(pin) : 0);
}
static void w_analogRead(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = argInt(argv, argn, 0, -1);
  retInt(retVal, (pin >= 0) ? analogRead(pin) : 0);
}
static void w_analogWrite(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pin = argInt(argv, argn, 0, -1);
  int v = clampi(argInt(argv, argn, 1, 0), 0, 255);
  if (pin >= 0) analogWrite(pin, v);
  retInt(retVal, 0);
}
static void w_delay(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int ms = argInt(argv, argn, 0, 0);
  if (ms < 0) ms = 0;
  delay((uint32_t)ms);
  retInt(retVal, 0);
}
static void w_millis(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  retInt(retVal, (int)millis());
}
static void w_micros(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  retInt(retVal, (int)micros());
}

// ============================================================
// Time helpers (NTP-synced if available)
// ============================================================
static bool timeLocal(struct tm& out) {
  if (!timeIsSynced()) return false;
  time_t now = 0;
  time(&now);
  if (now < 100000) return false;  // not synced / invalid
  localtime_r(&now, &out);
  return true;
}

static void w_time_is_valid(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  retInt(retVal, timeIsSynced() ? 1 : 0);
}

// Seconds since Unix epoch (UTC)
static void w_time_now(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  time_t now = 0;
  time(&now);
  retInt(retVal, (int)now);
}

// Seconds since local midnight (0..86399), or -1 if not valid
static void w_time_local_seconds(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  struct tm t;
  if (!timeLocal(t)) {
    retInt(retVal, -1);
    return;
  }
  retInt(retVal, (int)(t.tm_hour * 3600 + t.tm_min * 60 + t.tm_sec));
}

static void w_time_local_hour(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  struct tm t;
  if (!timeLocal(t)) { retInt(retVal, -1); return; }
  retInt(retVal, t.tm_hour);
}

static void w_time_local_minute(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  struct tm t;
  if (!timeLocal(t)) { retInt(retVal, -1); return; }
  retInt(retVal, t.tm_min);
}

static void w_time_local_second(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  struct tm t;
  if (!timeLocal(t)) { retInt(retVal, -1); return; }
  retInt(retVal, t.tm_sec);
}

// YYYYMMDD as int, or -1 if not valid
static void w_time_local_ymd(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  struct tm t;
  if (!timeLocal(t)) { retInt(retVal, -1); return; }
  int y = t.tm_year + 1900;
  int m = t.tm_mon + 1;
  int d = t.tm_mday;
  retInt(retVal, y * 10000 + m * 100 + d);
}

// Set TZ string (POSIX TZ format), e.g. "CET-1CEST,M3.5.0/02,M10.5.0/03"
static void w_time_set_timezone(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char buf[128];
  const char* tz = argCStringTmp(argv, argn, 0, buf, sizeof(buf));
  timeSetTimezone(tz);
  timeRequestSync();
  retInt(retVal, 0);
}

// Request a sync retry (in case WiFi was down)
static void w_time_sync(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  timeRequestSync();
  retInt(retVal, 0);
}

// time_get() -> Time struct
static void w_time_get(WRContext* c, const WRValue*, const int, WRValue& retVal, void*) {
  // Use container (struct-like) for stability from C.
  wr_makeContainer(&retVal, 7);

  struct tm t;
  int valid = timeLocal(t) ? 1 : 0;

  time_t now = 0;
  time(&now);

  structSetInt(retVal, "valid", valid);
  structSetInt(retVal, "epoch", (int)now);

  if (valid) {
    int y = t.tm_year + 1900;
    int m = t.tm_mon + 1;
    int d = t.tm_mday;
    structSetInt(retVal, "ymd", y * 10000 + m * 100 + d);
    structSetInt(retVal, "h", t.tm_hour);
    structSetInt(retVal, "m", t.tm_min);
    structSetInt(retVal, "s", t.tm_sec);
    structSetInt(retVal, "seconds", t.tm_hour * 3600 + t.tm_min * 60 + t.tm_sec);
  } else {
    structSetInt(retVal, "ymd", -1);
    structSetInt(retVal, "h", -1);
    structSetInt(retVal, "m", -1);
    structSetInt(retVal, "s", -1);
    structSetInt(retVal, "seconds", -1);
  }
}
static void w_randomSeed(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  uint32_t seed = (uint32_t)argInt(argv, argn, 0, (int)esp_random());
  randomSeed(seed);
  retInt(retVal, 0);
}
static void w_random(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  long r;
  if (argn <= 1) {
    int a = argInt(argv, argn, 0, 0);
    r = random(a);
  } else {
    int a = argInt(argv, argn, 0, 0);
    int b = argInt(argv, argn, 1, 0);
    r = random(a, b);
  }
  retInt(retVal, (int)r);
}

// print/println -> JSON event
static void w_print(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char buf[512];
  const char* s = argCStringTmp(argv, argn, 0, buf, sizeof(buf));
  emitPrintEventCStr(s, false);
  retInt(retVal, 0);
}
static void w_println(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  char buf[512];
  const char* s = argCStringTmp(argv, argn, 0, buf, sizeof(buf));
  emitPrintEventCStr(s, true);
  retInt(retVal, 0);
}
// noise_seed(seed) -> int
static void w_noise_seed(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  uint32_t seed = (uint32_t)argInt(argv, argn, 0, (int)esp_random());
  simplexSeed(seed);
  retInt(retVal, (int)seed);
}

// simplex3(x,y,z) -> float in ~[-1..1]
static void w_simplex3(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  float x = argFloat(argv, argn, 0, 0.0f);
  float y = argFloat(argv, argn, 1, 0.0f);
  float z = argFloat(argv, argn, 2, 0.0f);
  retFloat(retVal, simplex3(x, y, z));
}

// simplex3_01(x,y,z) -> float in ~[0..1]
static void w_simplex3_01(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  float x = argFloat(argv, argn, 0, 0.0f);
  float y = argFloat(argv, argn, 1, 0.0f);
  float z = argFloat(argv, argn, 2, 0.0f);
  float n = simplex3(x, y, z);
  // map (roughly) [-1..1] to [0..1]
  float u = 0.5f + 0.5f * n;
  if (u < 0.0f) u = 0.0f;
  if (u > 1.0f) u = 1.0f;
  retFloat(retVal, u);
}

// ------------------------------------------------------------
// NEW: small helper (optional, but convenient)
// ------------------------------------------------------------
static inline bool renderBufTryClaimForShow() {
  bool ok = false;
  portENTER_CRITICAL(&g_mux);
  if (g_renderFree) {
    g_renderFree = false;
    g_renderClaimMs = millis();
    ok = true;
  }
  portEXIT_CRITICAL(&g_mux);
  return ok;
}


// ------------------------------------------------------------
// LED API (Wrench) - FIXED CONFIG (2-buffer model)
// ------------------------------------------------------------
static void w_leds_begin(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  startLedTaskIfNeeded();
  // In 2buf model we only require renderBuf + ledTask
  if (g_renderBuf && g_ledTaskHandle) retInt(retVal, 1);
  else retInt(retVal, 0);
}

static void w_leds_total(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  retInt(retVal, TOTAL_LEDS);
}
static void w_leds_strip_count(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  retInt(retVal, NUM_STRIPS);
}
static void w_leds_strip_len(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  retInt(retVal, NUM_LEDS_PER_STRIP);
}

// Clear the render buffer (Core1 buffer)
static void w_leds_clear(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  if (g_renderBuf) {
    // Safety: only allow clearing if Core1 owns it (free == true)
    // Otherwise Core0 might be memcpy'ing it.
    if (renderBufIsFree()) {
      memset(g_renderBuf, 0, (size_t)TOTAL_LEDS * sizeof(CRGB));
    } else {
      // Non-blocking: ignore if not free
    }
  }
  retInt(retVal, 0);
}

static void w_leds_set_brightness(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int b = clampi(argInt(argv, argn, 0, (int)g_brightness), 0, 255);
  g_brightness = (uint8_t)b;
  retInt(retVal, 0);
}
static void w_leds_get_brightness(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  retInt(retVal, (int)g_brightness);
}

// supports:
// - (pos, r, g, b)
// - (strip, idx, r, g, b)
static void w_leds_set_pixel(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (!g_renderBuf) {
    retInt(retVal, 0);
    return;
  }

  // Safety: do not write if Core0 owns the buffer (copy in progress)
  if (!renderBufIsFree()) {
    retInt(retVal, 0);
    return;
  }

  int strip = 0, idx = 0;
  int r = 0, g = 0, b = 0;

  // Overload: if last arg is a struct, treat as Color
  const WRValue* cval = nullptr;
  if (argn >= 2 && (argv[argn - 1].isStruct() || argv[argn - 1].isHashTable())) {
    if (argn == 2) {
      int pos = argInt(argv, argn, 0, 0);
      if (pos < 0 || pos >= TOTAL_LEDS) {
        retInt(retVal, 0);
        return;
      }
      if (NUM_LEDS_PER_STRIP <= 0) {
        warnOnce(g_warn_leds_set_pixel_striplen, "NUM_LEDS_PER_STRIP=0 in leds_set_pixel");
        retInt(retVal, 0);
        return;
      }
      strip = pos / NUM_LEDS_PER_STRIP;
      idx = pos - strip * NUM_LEDS_PER_STRIP;
      cval = &argv[1];
    } else if (argn >= 3) {
      strip = argInt(argv, argn, 0, 0);
      idx = argInt(argv, argn, 1, 0);
      if (strip < 0 || strip >= NUM_STRIPS) {
        retInt(retVal, 0);
        return;
      }
      if (idx < 0 || idx >= NUM_LEDS_PER_STRIP) {
        retInt(retVal, 0);
        return;
      }
      cval = &argv[2];
    }
    if (!cval) {
      retInt(retVal, 0);
      return;
    }
    r = clampi(structInt(*cval, "r", 0), 0, 255);
    g = clampi(structInt(*cval, "g", 0), 0, 255);
    b = clampi(structInt(*cval, "b", 0), 0, 255);
  } else if (argn == 4) {
    int pos = argInt(argv, argn, 0, 0);
    r = argInt(argv, argn, 1, 0);
    g = argInt(argv, argn, 2, 0);
    b = argInt(argv, argn, 3, 0);
    if (pos < 0 || pos >= TOTAL_LEDS) {
      retInt(retVal, 0);
      return;
    }
    if (NUM_LEDS_PER_STRIP <= 0) {
      warnOnce(g_warn_leds_set_pixel_striplen, "NUM_LEDS_PER_STRIP=0 in leds_set_pixel");
      retInt(retVal, 0);
      return;
    }
    strip = pos / NUM_LEDS_PER_STRIP;
    idx = pos - strip * NUM_LEDS_PER_STRIP;
  } else if (argn >= 5) {
    strip = argInt(argv, argn, 0, 0);
    idx = argInt(argv, argn, 1, 0);
    r = argInt(argv, argn, 2, 0);
    g = argInt(argv, argn, 3, 0);
    b = argInt(argv, argn, 4, 0);
    if (strip < 0 || strip >= NUM_STRIPS) {
      retInt(retVal, 0);
      return;
    }
    if (idx < 0 || idx >= NUM_LEDS_PER_STRIP) {
      retInt(retVal, 0);
      return;
    }
  } else {
    retInt(retVal, 0);
    return;
  }

  r = clampi(r, 0, 255);
  g = clampi(g, 0, 255);
  b = clampi(b, 0, 255);

  int pos = strip * NUM_LEDS_PER_STRIP + idx;
  g_renderBuf[pos].setRGB((uint8_t)r, (uint8_t)g, (uint8_t)b);

  retInt(retVal, 1);
}

static void w_leds_set_pixel_c(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  // Back-compat wrapper; handled by w_leds_set_pixel overload.
  w_leds_set_pixel(nullptr, argv, argn, retVal, nullptr);
}

// leds_get_pixel_c(pos) -> Color
// reads render buffer if free, otherwise front buffer
static void w_leds_get_pixel_c(WRContext* c, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int pos = argInt(argv, argn, 0, 0);
  if (pos < 0 || pos >= TOTAL_LEDS) {
    wr_makeContainer(&retVal, 3);
    structSetInt(retVal, "r", 0);
    structSetInt(retVal, "g", 0);
    structSetInt(retVal, "b", 0);
    return;
  }

  const CRGB* src = nullptr;
  if (NUM_LEDS_PER_STRIP <= 0) {
    warnOnce(g_warn_leds_get_pixel_striplen, "NUM_LEDS_PER_STRIP=0 in leds_get_pixel_c");
    wr_makeContainer(&retVal, 3);
    structSetInt(retVal, "r", 0);
    structSetInt(retVal, "g", 0);
    structSetInt(retVal, "b", 0);
    return;
  }
  if (g_renderBuf && renderBufIsFree()) {
    src = g_renderBuf;
  } else {
    src = g_leds;
  }

  wr_makeContainer(&retVal, 3);
  structSetInt(retVal, "r", src[pos].r);
  structSetInt(retVal, "g", src[pos].g);
  structSetInt(retVal, "b", src[pos].b);
}
// Queue current render buffer to LED task (2-buffer model).
// Non-blocking: returns 0 if Core0 hasn't released renderBuf yet.
static void w_leds_show(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  if (!(g_ledTaskHandle && g_mainTaskHandle && g_renderBuf)) {
    retInt(retVal, 0);
    return;
  }

  // If wedged for too long, force release (prevents permanent “stuck”)
  const uint32_t now = millis();
  portENTER_CRITICAL(&g_mux);
  bool freeNow = g_renderFree;
  uint32_t claimMs = g_renderClaimMs;
  portEXIT_CRITICAL(&g_mux);

  if (!freeNow && claimMs != 0 && (uint32_t)(now - claimMs) > 200) {
    portENTER_CRITICAL(&g_mux);
    g_renderFree = true;
    g_renderClaimMs = 0;
    portEXIT_CRITICAL(&g_mux);
  }

  if (!renderBufTryClaimForShow()) {
    retInt(retVal, 0);
    return;
  }

  g_lastFrameNotifyMs = millis();
  xTaskNotify(g_ledTaskHandle, NOTIF_FRAME, eSetBits);
  retInt(retVal, 1);
}



// inbox (same behavior as your original)
static void w_inbox_get(WRContext* c, const WRValue*, const int, WRValue& retVal, void*) {
  g_inboxDirty = false;
  retString(c, retVal, g_inbox.c_str());
}
static void w_inbox_has(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  retInt(retVal, g_inboxDirty ? 1 : 0);
}

static void wr_sdf_palette_hsvN_cur(WRValue*, const WRValue* argv, int argn) {
  int n = argInt(argv, argn, 0, 0);
  if (n < 2 || n > 8) return;

  CHSV hsvs[8];
  int idx = 1;

  for (int i = 0; i < n; i++) {
    hsvs[i].h = (uint8_t)argInt(argv, argn, idx++, 0);
    hsvs[i].s = (uint8_t)argInt(argv, argn, idx++, 255);
    hsvs[i].v = (uint8_t)argInt(argv, argn, idx++, 255);
  }

  int mix = argInt(argv, argn, idx++, 255);
  int scroll = argInt(argv, argn, idx++, 0);
  int bright = argInt(argv, argn, idx++, 255);
  int blend = argInt(argv, argn, idx++, 1);

  sdfSetPaletteHSV_N_current(hsvs, n, mix, scroll, bright, blend);
}


static void wr_sdf_palette_rgbN_cur(WRValue*, const WRValue* argv, int argn) {
  int n = argInt(argv, argn, 0, 0);
  if (n < 2 || n > 8) return;

  CRGB cols[8];
  int idx = 1;

  for (int i = 0; i < n; i++) {
    cols[i].r = (uint8_t)argInt(argv, argn, idx++, 0);
    cols[i].g = (uint8_t)argInt(argv, argn, idx++, 0);
    cols[i].b = (uint8_t)argInt(argv, argn, idx++, 0);
  }

  int mix = argInt(argv, argn, idx++, 255);
  int scroll = argInt(argv, argn, idx++, 0);
  int bright = argInt(argv, argn, idx++, 255);
  int blend = argInt(argv, argn, idx++, 1);

  sdfSetPaletteRGB_N_current(cols, n, mix, scroll, bright, blend);
}
static void w_sdf_palette_rgbN_cur(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wr_sdf_palette_rgbN_cur(&retVal, argv, argn);
}

static void w_sdf_palette_hsvN_cur(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wr_sdf_palette_hsvN_cur(&retVal, argv, argn);
}

// Wrench-callable signatures (examples):
// sdf_palette_rgb3(i, r0,g0,b0, r1,g1,b1, r2,g2,b2, mix, scroll, bright, blend)
// sdf_palette_hsv3(i, h0,s0,v0, h1,s1,v1, h2,s2,v2, mix, scroll, bright, blend)
// sdf_palette_rgb3_cur(r0,g0,b0, r1,g1,b1, r2,g2,b2, mix, scroll, bright, blend)
// sdf_palette_hsv3_cur(h0,s0,v0, h1,s1,v1, h2,s2,v2, mix, scroll, bright, blend)
// ---- palette helper wrappers (WR_C_CALLBACK signature) ----
// These wrappers adapt your existing wr_sdf_palette_* helpers that use:
//   void fn(WRValue* ret, const WRValue* argv, int argn)

static void w_sdf_palette_rgb3(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wr_sdf_palette_rgb3(&retVal, argv, argn);
}

static void w_sdf_palette_hsv3(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wr_sdf_palette_hsv3(&retVal, argv, argn);
}

static void w_sdf_palette_rgb3_cur(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wr_sdf_palette_rgb3_cur(&retVal, argv, argn);
}

static void w_sdf_palette_hsv3_cur(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  wr_sdf_palette_hsv3_cur(&retVal, argv, argn);
}


static void wr_sdf_palette_rgb3(WRValue* ret, const WRValue* argv, int argn) {
  (void)ret;
  int i = argInt(argv, argn, 0, -1);
  uint8_t r0 = (uint8_t)argInt(argv, argn, 1, 0);
  uint8_t g0 = (uint8_t)argInt(argv, argn, 2, 0);
  uint8_t b0 = (uint8_t)argInt(argv, argn, 3, 0);
  uint8_t r1 = (uint8_t)argInt(argv, argn, 4, 0);
  uint8_t g1 = (uint8_t)argInt(argv, argn, 5, 0);
  uint8_t b1 = (uint8_t)argInt(argv, argn, 6, 0);
  uint8_t r2 = (uint8_t)argInt(argv, argn, 7, 0);
  uint8_t g2 = (uint8_t)argInt(argv, argn, 8, 0);
  uint8_t b2 = (uint8_t)argInt(argv, argn, 9, 0);

  int mix = argInt(argv, argn, 10, 255);
  int scroll = argInt(argv, argn, 11, 0);
  int bright = argInt(argv, argn, 12, 255);
  int blend = argInt(argv, argn, 13, 1);

  // Optional mid stop as arg 14 (defaults to 115)
  uint8_t mid = (uint8_t)clampi(argInt(argv, argn, 14, 115), 0, 255);

  sdfSetPaletteRGB3(i, r0, g0, b0, r1, g1, b1, r2, g2, b2, mix, scroll, bright, blend, mid);
}

static void wr_sdf_palette_hsv3(WRValue* ret, const WRValue* argv, int argn) {
  (void)ret;
  int i = argInt(argv, argn, 0, -1);
  uint8_t h0 = (uint8_t)argInt(argv, argn, 1, 0);
  uint8_t s0 = (uint8_t)argInt(argv, argn, 2, 255);
  uint8_t v0 = (uint8_t)argInt(argv, argn, 3, 255);
  uint8_t h1 = (uint8_t)argInt(argv, argn, 4, 0);
  uint8_t s1 = (uint8_t)argInt(argv, argn, 5, 255);
  uint8_t v1 = (uint8_t)argInt(argv, argn, 6, 255);
  uint8_t h2 = (uint8_t)argInt(argv, argn, 7, 0);
  uint8_t s2 = (uint8_t)argInt(argv, argn, 8, 255);
  uint8_t v2 = (uint8_t)argInt(argv, argn, 9, 255);

  int mix = argInt(argv, argn, 10, 255);
  int scroll = argInt(argv, argn, 11, 0);
  int bright = argInt(argv, argn, 12, 255);
  int blend = argInt(argv, argn, 13, 1);

  uint8_t mid = (uint8_t)clampi(argInt(argv, argn, 14, 115), 0, 255);

  sdfSetPaletteHSV3(i, h0, s0, v0, h1, s1, v1, h2, s2, v2, mix, scroll, bright, blend, mid);
}

static void wr_sdf_palette_rgb3_cur(WRValue* ret, const WRValue* argv, int argn) {
  (void)ret;
  uint8_t r0 = (uint8_t)argInt(argv, argn, 0, 0);
  uint8_t g0 = (uint8_t)argInt(argv, argn, 1, 0);
  uint8_t b0 = (uint8_t)argInt(argv, argn, 2, 0);
  uint8_t r1 = (uint8_t)argInt(argv, argn, 3, 0);
  uint8_t g1 = (uint8_t)argInt(argv, argn, 4, 0);
  uint8_t b1 = (uint8_t)argInt(argv, argn, 5, 0);
  uint8_t r2 = (uint8_t)argInt(argv, argn, 6, 0);
  uint8_t g2 = (uint8_t)argInt(argv, argn, 7, 0);
  uint8_t b2 = (uint8_t)argInt(argv, argn, 8, 0);

  int mix = argInt(argv, argn, 9, 255);
  int scroll = argInt(argv, argn, 10, 0);
  int bright = argInt(argv, argn, 11, 255);
  int blend = argInt(argv, argn, 12, 1);
  uint8_t mid = (uint8_t)clampi(argInt(argv, argn, 13, 115), 0, 255);

  sdfSetPaletteRGB3_current(r0, g0, b0, r1, g1, b1, r2, g2, b2, mix, scroll, bright, blend, mid);
}

static void wr_sdf_palette_hsv3_cur(WRValue* ret, const WRValue* argv, int argn) {
  (void)ret;
  uint8_t h0 = (uint8_t)argInt(argv, argn, 0, 0);
  uint8_t s0 = (uint8_t)argInt(argv, argn, 1, 255);
  uint8_t v0 = (uint8_t)argInt(argv, argn, 2, 255);
  uint8_t h1 = (uint8_t)argInt(argv, argn, 3, 0);
  uint8_t s1 = (uint8_t)argInt(argv, argn, 4, 255);
  uint8_t v1 = (uint8_t)argInt(argv, argn, 5, 255);
  uint8_t h2 = (uint8_t)argInt(argv, argn, 6, 0);
  uint8_t s2 = (uint8_t)argInt(argv, argn, 7, 255);
  uint8_t v2 = (uint8_t)argInt(argv, argn, 8, 255);

  int mix = argInt(argv, argn, 9, 255);
  int scroll = argInt(argv, argn, 10, 0);
  int bright = argInt(argv, argn, 11, 255);
  int blend = argInt(argv, argn, 12, 1);
  uint8_t mid = (uint8_t)clampi(argInt(argv, argn, 13, 115), 0, 255);

  sdfSetPaletteHSV3_current(h0, s0, v0, h1, s1, v1, h2, s2, v2, mix, scroll, bright, blend, mid);
}


// ------------------------------------------------------------
// SDF bindings for Wrench
// sdf_set_count(n)
// sdf_set_sphere(i, x,y,z, r, hue,sat,val, alpha, falloff)
// sdf_render()
//
// sdf_set_material(i, texId, cell_cm, strength, seed, mode)
//   mode: lower 2 bits = pattern plane (0=XY,1=XZ,2=YZ,3=RADIAL)
//         upper bits = affect target
//           0 = intensity (default)
//           1 = palette brightness
//           2 = palette mix
//           3 = base color
// ------------------------------------------------------------

static void w_sdf_set_material(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (argn < 2) {
    retInt(retVal, 0);
    return;
  }

  int i = argInt(argv, argn, 0, 0);
  int texId = argInt(argv, argn, 1, 0);
  float cell = argFloat(argv, argn, 2, 8.0f);  // cm
  float str = argFloat(argv, argn, 3, 0.0f);   // 0..1
  int seed = argInt(argv, argn, 4, 1337);
  int mode = argInt(argv, argn, 5, 0);

  texId = clampi(texId, 0, 9);
  cell = clampf(cell, 0.25f, 200.0f);
  str = clampf(str, 0.0f, 2.0f);                        // allow “overdrive”
  int strength8 = (int)lroundf((str / 2.0f) * 255.0f);  // map 0..2 -> 0..255
  sdfSetMaterial(i, texId, cell, strength8, (uint32_t)seed, mode);

  retInt(retVal, 1);
}

static void w_sdf_set_tex_time(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  uint32_t t = (uint32_t)argInt(argv, argn, 0, (int)millis());
  sdfSetTexTime(t);
  retInt(retVal, 1);
}
static void w_sdf_set_count(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int n = argInt(argv, argn, 0, 0);
  sdfSetCount(n);
  if (n > g_nextSphereIdx) g_nextSphereIdx = n;
  retInt(retVal, g_shapeCount);
}

static void w_sdf_set_sphere(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  // Overload: sdf_set_sphere(SphereStruct)
  if (argn == 1 && argv && argv[0].isStruct()) {
    w_sdf_update_sphere(nullptr, argv, argn, retVal, nullptr);
    return;
  }
  // New signature (no falloff):
  // sdf_set_sphere(i, x, y, z, r, hue, sat, val, alpha, bias)
  //
  // Back-compat:
  // - if argn == 9: bias defaults to 0.5 (neutral)
  // - if argn >= 10: use argv[9] as bias

  if (argn < 9) {  // need at least up to alpha
    retInt(retVal, 0);
    return;
  }

  int i = argInt(argv, argn, 0, 0);
  float x = argFloat(argv, argn, 1, 0.0f);
  float y = argFloat(argv, argn, 2, 0.0f);
  float z = argFloat(argv, argn, 3, 0.0f);
  float r = argFloat(argv, argn, 4, 1.0f);
  int hue = argInt(argv, argn, 5, 0);
  int sat = argInt(argv, argn, 6, 255);
  int val = argInt(argv, argn, 7, 255);
  float alpha = argFloat(argv, argn, 8, 1.0f);

  // Neutral by default (bias=0.5 => identity curve)
  float bias = (argn >= 10) ? argFloat(argv, argn, 9, 0.5f) : 0.5f;

  // Optional safety clamp (keeps math stable and predictable)
  if (bias < 0.01f) bias = 0.01f;
  if (bias > 0.99f) bias = 0.99f;

  sdfSetSphere(i, x, y, z, r, hue, sat, val, alpha, bias);
  retInt(retVal, 1);
}

// create_Sphere() -> Sphere struct with assigned idx (auto-extends sdf_set_count)
static void w_create_sphere(WRContext* c, const WRValue*, const int, WRValue& retVal, void*) {
  int idx = g_nextSphereIdx++;
  if (idx >= g_shapeCount) {
    sdfSetCount(idx + 1);
  }

  // Wrench docs only guarantee container construction from C.
  // Containers behave like structs in Wrench (dot access), and are stable.
  wr_makeContainer(&retVal, 10);
  structSetInt(retVal, "idx", idx);
  structSetFloat(retVal, "x", 0.0f);
  structSetFloat(retVal, "y", 0.0f);
  structSetFloat(retVal, "z", 0.0f);
  structSetFloat(retVal, "r", 1.0f);
  structSetInt(retVal, "h", 0);
  structSetInt(retVal, "s", 255);
  structSetInt(retVal, "v", 255);
  structSetFloat(retVal, "alpha", 1.0f);
  structSetFloat(retVal, "bias", 0.5f);
}

// sdf_update_sphere(sphereStruct)
static void w_sdf_update_sphere(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (argn < 1 || !argv || !(argv[0].isStruct() || argv[0].isHashTable())) {
    retInt(retVal, 0);
    return;
  }
  const WRValue& s = argv[0];
  int i = structInt(s, "idx", -1);
  if (i < 0) {
    retInt(retVal, 0);
    return;
  }

  float x = structFloat(s, "x", 0.0f);
  float y = structFloat(s, "y", 0.0f);
  float z = structFloat(s, "z", 0.0f);
  float r = structFloat(s, "r", 1.0f);
  int h = structInt(s, "h", 0);
  int ss = structInt(s, "s", 255);
  int v = structInt(s, "v", 255);
  float alpha = structFloat(s, "alpha", 1.0f);
  float bias = structFloat(s, "bias", 0.5f);

  if (bias < 0.01f) bias = 0.01f;
  if (bias > 0.99f) bias = 0.99f;

  sdfSetSphere(i, x, y, z, r, h, ss, v, alpha, bias);
  retInt(retVal, 1);
}

// create_Box() -> Box struct with assigned idx (auto-extends sdf_set_count)
static void w_create_box(WRContext* c, const WRValue*, const int, WRValue& retVal, void*) {
  int idx = g_nextSphereIdx++;
  if (idx >= g_shapeCount) {
    sdfSetCount(idx + 1);
  }

  // Use container (struct-like) for stability from C.
  wr_makeContainer(&retVal, 14);
  structSetInt(retVal, "idx", idx);
  structSetFloat(retVal, "x", 0.0f);
  structSetFloat(retVal, "y", 0.0f);
  structSetFloat(retVal, "z", 0.0f);
  structSetFloat(retVal, "w", 1.0f);
  structSetFloat(retVal, "h", 1.0f);
  structSetFloat(retVal, "d", 1.0f);
  structSetInt(retVal, "hue", 0);
  structSetInt(retVal, "sat", 255);
  structSetInt(retVal, "val", 255);
  structSetFloat(retVal, "alpha", 1.0f);
  structSetFloat(retVal, "bias", 0.5f);
  structSetInt(retVal, "power", 4);
}

// sdf_update_box(boxStruct)
static void w_sdf_update_box(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (argn < 1 || !argv || !(argv[0].isStruct() || argv[0].isHashTable())) {
    retInt(retVal, 0);
    return;
  }
  const WRValue& b = argv[0];
  int i = structInt(b, "idx", -1);
  if (i < 0) {
    retInt(retVal, 0);
    return;
  }

  float x = structFloat(b, "x", 0.0f);
  float y = structFloat(b, "y", 0.0f);
  float z = structFloat(b, "z", 0.0f);
  float w = structFloat(b, "w", 1.0f);
  float h = structFloat(b, "h", 1.0f);
  float d = structFloat(b, "d", 1.0f);
  int hue = structInt(b, "hue", 0);
  int sat = structInt(b, "sat", 255);
  int val = structInt(b, "val", 255);
  float alpha = structFloat(b, "alpha", 1.0f);
  float bias = structFloat(b, "bias", 0.5f);
  int power = structInt(b, "power", 4);

  if (bias < 0.01f) bias = 0.01f;
  if (bias > 0.99f) bias = 0.99f;

  sdfSetShape(i, SDF_BOX, x, y, z, w, h, d, hue, sat, val, alpha, bias, power);
  retInt(retVal, 1);
}

// create_Color() -> Color struct
static void w_create_color(WRContext* c, const WRValue*, const int, WRValue& retVal, void*) {
  // Use container (struct-like) for stability from C.
  wr_makeContainer(&retVal, 3);
  structSetInt(retVal, "r", 0);
  structSetInt(retVal, "g", 0);
  structSetInt(retVal, "b", 0);
}

// sdf_set_shape(i, type, x,y,z, a,b,c, hue,sat,val, alpha, bias, power)
//
// type=0 sphere: a=radius (cm) [b,c ignored]
// type=1 box:    a=width, b=height, c=depth (cm)
//
// bias:  0..1 (0.5 neutral)
// power: 1..8 (hardness)

static void w_sdf_set_shape(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (argn < 13) {
    retInt(retVal, 0);
    return;
  }

  int i = argInt(argv, argn, 0, 0);
  int type = argInt(argv, argn, 1, 0);
  float x = argFloat(argv, argn, 2, 0.0f);
  float y = argFloat(argv, argn, 3, 0.0f);
  float z = argFloat(argv, argn, 4, 0.0f);
  float a = argFloat(argv, argn, 5, 1.0f);
  float b = argFloat(argv, argn, 6, 1.0f);
  float c = argFloat(argv, argn, 7, 1.0f);
  int hue = argInt(argv, argn, 8, 0);
  int sat = argInt(argv, argn, 9, 255);
  int val = argInt(argv, argn, 10, 255);
  float alpha = argFloat(argv, argn, 11, 1.0f);
  float bias = argFloat(argv, argn, 12, 0.5f);
  int power = (argn >= 14) ? argInt(argv, argn, 13, 4) : 4;

  if (bias < 0.01f) bias = 0.01f;
  if (bias > 0.99f) bias = 0.99f;

  sdfSetShape(i, type, x, y, z, a, b, c, hue, sat, val, alpha, bias, power);
  retInt(retVal, 1);
}

// sdf_set_box(i, x,y,z, w,h,d, hue,sat,val, alpha, bias, power)
static void w_sdf_set_box(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  // Overload: sdf_set_box(BoxStruct)
  if (argn == 1 && argv && argv[0].isStruct()) {
    w_sdf_update_box(nullptr, argv, argn, retVal, nullptr);
    return;
  }
  if (argn < 12) {
    retInt(retVal, 0);
    return;
  }

  int i = argInt(argv, argn, 0, 0);
  float x = argFloat(argv, argn, 1, 0.0f);
  float y = argFloat(argv, argn, 2, 0.0f);
  float z = argFloat(argv, argn, 3, 0.0f);
  float w = argFloat(argv, argn, 4, 1.0f);
  float h = argFloat(argv, argn, 5, 1.0f);
  float d = argFloat(argv, argn, 6, 1.0f);
  int hue = argInt(argv, argn, 7, 0);
  int sat = argInt(argv, argn, 8, 255);
  int val = argInt(argv, argn, 9, 255);
  float alpha = argFloat(argv, argn, 10, 1.0f);
  float bias = argFloat(argv, argn, 11, 0.5f);
  int power = (argn >= 13) ? argInt(argv, argn, 12, 4) : 4;

  if (bias < 0.01f) bias = 0.01f;
  if (bias > 0.99f) bias = 0.99f;

  sdfSetShape(i, SDF_BOX, x, y, z, w, h, d, hue, sat, val, alpha, bias, power);
  retInt(retVal, 1);
}


// sdf_render([stripMask])
// stripMask: bit i = tube * NUMSECTIONS_PR_TUBE + section (0..NUMSECTIONS_PR_TUBE-1)
//            1 = render, 0 = leave as-is
static void w_sdf_render(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  uint32_t mask = 0xFFFFFFFFu;
  if (argn >= 1) {
    mask = (uint32_t)argInt(argv, argn, 0, (int)mask);
  }
  sdfRenderIntoFront(mask);
  retInt(retVal, 1);
}

static void w_sdf_get_count(WRContext*, const WRValue*, const int, WRValue& retVal, void*) {
  retInt(retVal, g_shapeCount);
}

// DEPRECATED: tube_endpoints(tubeIndex) -> string
// Use tube_endpoints3(tubeIndex) for Vec3 structs.
static void w_tube_endpoints(WRContext* c, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int t = argInt(argv, argn, 0, 0);
  t = clampi(t, 0, 5);
  bool wantStruct = (argn >= 2) ? (argInt(argv, argn, 1, 0) != 0) : false;
  if (!g_tubeAB_valid) {
    if (wantStruct) {
      if (!g_endpointsTmpInit) {
        wr_makeContainer(&g_endA, 3);
        wr_makeContainer(&g_endB, 3);
        wr_makeContainer(&g_endpointsTmp, 2);
        wr_addValueToContainer(&g_endpointsTmp, "a", &g_endA);
        wr_addValueToContainer(&g_endpointsTmp, "b", &g_endB);
        g_endpointsTmpInit = true;
      }
      structSetFloat(g_endA, "x", 0.0f);
      structSetFloat(g_endA, "y", 0.0f);
      structSetFloat(g_endA, "z", 0.0f);
      structSetFloat(g_endB, "x", 0.0f);
      structSetFloat(g_endB, "y", 0.0f);
      structSetFloat(g_endB, "z", 0.0f);
      retVal = g_endpointsTmp;
    } else {
      retString(c, retVal, "0 0 0 0 0 0");
    }
    return;
  }

  if (wantStruct) {
    if (!g_endpointsTmpInit) {
      wr_makeContainer(&g_endA, 3);
      wr_makeContainer(&g_endB, 3);
      wr_makeContainer(&g_endpointsTmp, 2);
      wr_addValueToContainer(&g_endpointsTmp, "a", &g_endA);
      wr_addValueToContainer(&g_endpointsTmp, "b", &g_endB);
      g_endpointsTmpInit = true;
    }
    structSetFloat(g_endA, "x", g_tubeA_cm[t][0]);
    structSetFloat(g_endA, "y", g_tubeA_cm[t][1]);
    structSetFloat(g_endA, "z", g_tubeA_cm[t][2]);
    structSetFloat(g_endB, "x", g_tubeB_cm[t][0]);
    structSetFloat(g_endB, "y", g_tubeB_cm[t][1]);
    structSetFloat(g_endB, "z", g_tubeB_cm[t][2]);
    retVal = g_endpointsTmp;
  } else {
    char buf[128];
    snprintf(buf, sizeof(buf), "%.3f %.3f %.3f %.3f %.3f %.3f",
             g_tubeA_cm[t][0], g_tubeA_cm[t][1], g_tubeA_cm[t][2],
             g_tubeB_cm[t][0], g_tubeB_cm[t][1], g_tubeB_cm[t][2]);
    retString(c, retVal, buf);
  }
}
// tube_endpoints3(tubeIndex) -> { a: Vec3, b: Vec3 }
static void w_tube_endpoints3(WRContext* c, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  warnOnce(g_warn_tube_endpoints3, "tube_endpoints3 returns a reused container; do not store across frames. Use tube_endpoints_out for persistence.");
  if (argn < 1 || !argv) {
    if (!g_endpointsTmpInit) {
      wr_makeContainer(&g_endA, 3);
      wr_makeContainer(&g_endB, 3);
      wr_makeContainer(&g_endpointsTmp, 2);
      wr_addValueToContainer(&g_endpointsTmp, "a", &g_endA);
      wr_addValueToContainer(&g_endpointsTmp, "b", &g_endB);
      g_endpointsTmpInit = true;
    }
    structSetFloat(g_endA, "x", 0.0f);
    structSetFloat(g_endA, "y", 0.0f);
    structSetFloat(g_endA, "z", 0.0f);
    structSetFloat(g_endB, "x", 0.0f);
    structSetFloat(g_endB, "y", 0.0f);
    structSetFloat(g_endB, "z", 0.0f);
    retVal = g_endpointsTmp;
    return;
  }
  WRValue tmp[2];
  tmp[0] = argv[0];
  tmp[1].init(1);
  w_tube_endpoints(c, tmp, 2, retVal, nullptr);
}
// ------------------------------------------------------------
// Wrench program lifecycle
// ------------------------------------------------------------
static volatile bool* g_setupPendingPtr = nullptr;

// Warn-once flags (defined near top)
static void wrenchShutdown() {
  if (g_ctx) {
    wr_destroyContext(g_ctx);
    g_ctx = nullptr;
  }
  if (g_wr) {
    wr_destroyState(g_wr);
    g_wr = nullptr;
  }
  if (g_endpointsTmpInit) {
    wr_destroyContainer(&g_endpointsTmp);
    wr_destroyContainer(&g_endA);
    wr_destroyContainer(&g_endB);
    g_endpointsTmpInit = false;
  }
  if (g_vec3TmpInit) {
    wr_destroyContainer(&g_vec3Tmp);
    g_vec3TmpInit = false;
  }
  if (g_colorTmpInit) {
    wr_destroyContainer(&g_colorTmp);
    g_colorTmpInit = false;
  }
  g_fnSetup = g_fnTick = g_fnOnMessage = nullptr;
  g_hasProgram = false;
  g_nextSphereIdx = 0;
  sdfResetAll();
}

static String buildPrelude() {
  String p;
  p += "var SDF_SPHERE = 0;\n";
  p += "var SDF_BOX    = 1;\n";
  p += "struct Vec3 { var x; var y; var z; };\n";
  p += "struct Color { var r; var g; var b; };\n";
  p += "struct Sphere { var idx; var x; var y; var z; var r; var h; var s; var v; var alpha; var bias; };\n";
  p += "struct Box { var idx; var x; var y; var z; var w; var h; var d; var hue; var sat; var val; var alpha; var bias; var power; };\n";
  p += "struct Time { var valid; var epoch; var ymd; var h; var m; var s; var seconds; };\n";
  p += "var STRIPS=" + String(NUM_STRIPS) + ";\n";
  p += "var TUBES=" + String(NUM_STRIPS) + ";\n";
  p += "var STRIPS_PER_TUBE=" + String(NUMSECTIONS_PR_TUBE) + ";\n";
  p += "var SDF_STRIP_BITS=" + String(NUM_STRIPS * NUMSECTIONS_PR_TUBE) + ";\n";
  p += "var STRIP_LEN=" + String(NUM_LEDS_PER_STRIP) + ";\n";
  p += "var TOTAL_LEDS=" + String(TOTAL_LEDS) + ";\n";
  // Tell users that x/y/z/r/falloff are interpreted as "cm" in this firmware:
  p += "var SDF_UNITS=\"cm\";\n";
  p += "var SDF_STEP_MM=0.25;\n";
  return p;
}

static void sendWrenchError(const char* phase, const String& err) {
  // implemented in your old sketch; keep or route through sendErr/jsonWriteEscaped in xtra.ino
  sendErr(String("wrench ") + phase + ": " + err);
}

static void warnOnce(bool& flag, const char* msg) {
  if (flag) return;
  flag = true;
  sendErr(String("wrench warn: ") + msg);
}


static void dumpHeap(const char* tag) {
  uint32_t free8 = heap_caps_get_free_size(MALLOC_CAP_8BIT);
  uint32_t large8 = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  Serial.printf("[HEAP] %s free8=%u largest8=%u\n", tag, free8, large8);
}

static bool heapOkForCompile(size_t needLargest = 12 * 1024, size_t needFree = 20 * 1024) {
  size_t free8 = heap_caps_get_free_size(MALLOC_CAP_8BIT);
  size_t large8 = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  Serial.printf("[HEAP] gate free8=%u largest8=%u\n", (unsigned)free8, (unsigned)large8);
  return (free8 >= needFree) && (large8 >= needLargest);
}

static void w_lerp(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  float a = argFloat(argv, argn, 0, 0.0f);
  float b = argFloat(argv, argn, 1, 0.0f);
  float t = argFloat(argv, argn, 2, 0.0f);

  // (optional) clamp t
  if (t < 0.0f) t = 0.0f;
  if (t > 1.0f) t = 1.0f;

  retFloat(retVal, a + (b - a) * t);
}

// lerp3(aVec3, bVec3, t01) -> Vec3
static void w_lerp3(WRContext* c, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  warnOnce(g_warn_lerp3, "lerp3 returns a reused container; do not store across frames.");
  if (argn < 3 || !argv ||
      !(argv[0].isStruct() || argv[0].isHashTable()) ||
      !(argv[1].isStruct() || argv[1].isHashTable())) {
    if (!g_vec3TmpInit) {
      wr_makeContainer(&g_vec3Tmp, 3);
      g_vec3TmpInit = true;
    }
    structSetFloat(g_vec3Tmp, "x", 0.0f);
    structSetFloat(g_vec3Tmp, "y", 0.0f);
    structSetFloat(g_vec3Tmp, "z", 0.0f);
    retVal = g_vec3Tmp;
    return;
  }

  const WRValue& a = argv[0];
  const WRValue& b = argv[1];
  float t = argFloat(argv, argn, 2, 0.0f);

  if (t < 0.0f) t = 0.0f;
  if (t > 1.0f) t = 1.0f;

  float ax = structFloat(a, "x", 0.0f);
  float ay = structFloat(a, "y", 0.0f);
  float az = structFloat(a, "z", 0.0f);

  float bx = structFloat(b, "x", 0.0f);
  float by = structFloat(b, "y", 0.0f);
  float bz = structFloat(b, "z", 0.0f);

  if (!g_vec3TmpInit) {
    wr_makeContainer(&g_vec3Tmp, 3);
    g_vec3TmpInit = true;
  }
  structSetFloat(g_vec3Tmp, "x", ax + (bx - ax) * t);
  structSetFloat(g_vec3Tmp, "y", ay + (by - ay) * t);
  structSetFloat(g_vec3Tmp, "z", az + (bz - az) * t);
  retVal = g_vec3Tmp;
}

// lerp_color(aColor, bColor, t01) -> Color
static void w_lerp_color(WRContext* c, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  warnOnce(g_warn_lerp_color, "lerp_color returns a reused container; do not store across frames.");
  if (argn < 3 || !argv ||
      !(argv[0].isStruct() || argv[0].isHashTable()) ||
      !(argv[1].isStruct() || argv[1].isHashTable())) {
    if (!g_colorTmpInit) {
      wr_makeContainer(&g_colorTmp, 3);
      g_colorTmpInit = true;
    }
    structSetInt(g_colorTmp, "r", 0);
    structSetInt(g_colorTmp, "g", 0);
    structSetInt(g_colorTmp, "b", 0);
    retVal = g_colorTmp;
    return;
  }

  const WRValue& a = argv[0];
  const WRValue& b = argv[1];
  float t = argFloat(argv, argn, 2, 0.0f);

  if (t < 0.0f) t = 0.0f;
  if (t > 1.0f) t = 1.0f;

  int ar = clampi(structInt(a, "r", 0), 0, 255);
  int ag = clampi(structInt(a, "g", 0), 0, 255);
  int ab = clampi(structInt(a, "b", 0), 0, 255);

  int br = clampi(structInt(b, "r", 0), 0, 255);
  int bg = clampi(structInt(b, "g", 0), 0, 255);
  int bb = clampi(structInt(b, "b", 0), 0, 255);

  int r = (int)lroundf((float)ar + ((float)(br - ar) * t));
  int g = (int)lroundf((float)ag + ((float)(bg - ag) * t));
  int bcol = (int)lroundf((float)ab + ((float)(bb - ab) * t));

  wr_instanceStruct(&retVal, c, "Color", nullptr, 0);
  if (!g_colorTmpInit) {
    wr_makeContainer(&g_colorTmp, 3);
    g_colorTmpInit = true;
  }
  structSetInt(g_colorTmp, "r", clampi(r, 0, 255));
  structSetInt(g_colorTmp, "g", clampi(g, 0, 255));
  structSetInt(g_colorTmp, "b", clampi(bcol, 0, 255));
  retVal = g_colorTmp;
}



// DEPRECATED: tube_lerp(tubeIndex, t01, which) -> float
// Use tube_xyz3(tubeIndex, t01) for a Vec3 struct instead.
// which: 0=x, 1=y, 2=z
static void w_tube_lerp(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int tube = clampi(argInt(argv, argn, 0, 0), 0, 5);
  float t = argFloat(argv, argn, 1, 0.0f);
  int which = clampi(argInt(argv, argn, 2, 0), 0, 2);

  if (!g_tubeAB_valid) {
    retFloat(retVal, 0.0f);
    return;
  }

  if (t < 0.0f) t = 0.0f;
  if (t > 1.0f) t = 1.0f;

  float a = g_tubeA_cm[tube][which];
  float b = g_tubeB_cm[tube][which];

  retFloat(retVal, a + (b - a) * t);
}
static void w_tube_xyz(WRContext* c, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  int tube = clampi(argInt(argv, argn, 0, 0), 0, 5);
  float t = argFloat(argv, argn, 1, 0.0f);
  bool wantStruct = (argn >= 3) ? (argInt(argv, argn, 2, 0) != 0) : false;

  if (!g_tubeAB_valid) {
    if (wantStruct) {
      if (!g_vec3TmpInit) {
        wr_makeContainer(&g_vec3Tmp, 3);
        g_vec3TmpInit = true;
      }
      structSetFloat(g_vec3Tmp, "x", 0.0f);
      structSetFloat(g_vec3Tmp, "y", 0.0f);
      structSetFloat(g_vec3Tmp, "z", 0.0f);
      retVal = g_vec3Tmp;
    } else {
      retString(c, retVal, "0 0 0");
    }
    return;
  }

  if (t < 0.0f) t = 0.0f;
  if (t > 1.0f) t = 1.0f;

  float x = g_tubeA_cm[tube][0] + (g_tubeB_cm[tube][0] - g_tubeA_cm[tube][0]) * t;
  float y = g_tubeA_cm[tube][1] + (g_tubeB_cm[tube][1] - g_tubeA_cm[tube][1]) * t;
  float z = g_tubeA_cm[tube][2] + (g_tubeB_cm[tube][2] - g_tubeA_cm[tube][2]) * t;

  if (wantStruct) {
    if (!g_vec3TmpInit) {
      wr_makeContainer(&g_vec3Tmp, 3);
      g_vec3TmpInit = true;
    }
    structSetFloat(g_vec3Tmp, "x", x);
    structSetFloat(g_vec3Tmp, "y", y);
    structSetFloat(g_vec3Tmp, "z", z);
    retVal = g_vec3Tmp;
  } else {
    char buf[96];
    snprintf(buf, sizeof(buf), "%.3f %.3f %.3f", x, y, z);
    retString(c, retVal, buf);
  }
}
// tube_xyz3(tubeIndex, t01) -> Vec3 struct
static void w_tube_xyz3(WRContext* c, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  warnOnce(g_warn_tube_xyz3, "tube_xyz3 returns a reused container; do not store across frames. Use tube_xyz_out for persistence.");
  // Wrapper to overloaded tube_xyz with struct flag
  if (argn < 2 || !argv) {
    if (!g_vec3TmpInit) {
      wr_makeContainer(&g_vec3Tmp, 3);
      g_vec3TmpInit = true;
    }
    structSetFloat(g_vec3Tmp, "x", 0.0f);
    structSetFloat(g_vec3Tmp, "y", 0.0f);
    structSetFloat(g_vec3Tmp, "z", 0.0f);
    retVal = g_vec3Tmp;
    return;
  }
  WRValue tmp[3];
  tmp[0] = argv[0];
  tmp[1] = argv[1];
  tmp[2].init(1);
  w_tube_xyz(c, tmp, 3, retVal, nullptr);
}

// tube_xyz_out(tubeIndex, t01, outVec3) -> 1/0
static void w_tube_xyz_out(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (argn < 3 || !argv || !(argv[2].isStruct() || argv[2].isHashTable())) {
    retInt(retVal, 0);
    return;
  }
  int tube = clampi(argInt(argv, argn, 0, 0), 0, 5);
  float t = argFloat(argv, argn, 1, 0.0f);
  if (!g_tubeAB_valid) {
    retInt(retVal, 0);
    return;
  }
  if (t < 0.0f) t = 0.0f;
  if (t > 1.0f) t = 1.0f;

  float x = g_tubeA_cm[tube][0] + (g_tubeB_cm[tube][0] - g_tubeA_cm[tube][0]) * t;
  float y = g_tubeA_cm[tube][1] + (g_tubeB_cm[tube][1] - g_tubeA_cm[tube][1]) * t;
  float z = g_tubeA_cm[tube][2] + (g_tubeB_cm[tube][2] - g_tubeA_cm[tube][2]) * t;

  WRValue& out = const_cast<WRValue&>(argv[2]);
  structSetFloat(out, "x", x);
  structSetFloat(out, "y", y);
  structSetFloat(out, "z", z);
  retInt(retVal, 1);
}

// tube_endpoints_out(tubeIndex, outA, outB) -> 1/0
static void w_tube_endpoints_out(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  if (argn < 3 || !argv ||
      !(argv[1].isStruct() || argv[1].isHashTable()) ||
      !(argv[2].isStruct() || argv[2].isHashTable())) {
    retInt(retVal, 0);
    return;
  }
  int t = clampi(argInt(argv, argn, 0, 0), 0, 5);
  if (!g_tubeAB_valid) {
    retInt(retVal, 0);
    return;
  }
  WRValue& outA = const_cast<WRValue&>(argv[1]);
  WRValue& outB = const_cast<WRValue&>(argv[2]);
  structSetFloat(outA, "x", g_tubeA_cm[t][0]);
  structSetFloat(outA, "y", g_tubeA_cm[t][1]);
  structSetFloat(outA, "z", g_tubeA_cm[t][2]);
  structSetFloat(outB, "x", g_tubeB_cm[t][0]);
  structSetFloat(outB, "y", g_tubeB_cm[t][1]);
  structSetFloat(outB, "z", g_tubeB_cm[t][2]);
  retInt(retVal, 1);
}
// ============================================================
// Wrench binding: sdf_set_palette(i, palId, mix, scroll, bright, blend)
// - i       : shape index
// - palId   : which palette (0..N-1)
// - mix     : 0..255 (0 = use rgb only, 255 = palette only)
// - scroll  : 0..255 (palette scroll speed)
// - bright  : 0..255 (palette brightness passed to ColorFromPalette)
// - blend   : 0/1   (LINEARBLEND on/off)
// ============================================================
static void w_sdf_set_palette(WRContext*, const WRValue* argv, const int argn, WRValue& retVal, void*) {
  // Need at least i, palId
  if (argn < 2) {
    retInt(retVal, 0);
    return;
  }

  if (!g_shapes || g_shapeCount <= 0) {
    retInt(retVal, 0);
    return;
  }

  const int i = argInt(argv, argn, 0, -1);
  if (i < 0 || i >= g_shapeCount) {
    retInt(retVal, 0);
    return;
  }

  int palId = argInt(argv, argn, 1, 0);
  int mix = argInt(argv, argn, 2, 255);
  int scroll = argInt(argv, argn, 3, 0);
  int bright = argInt(argv, argn, 4, 255);
  int blend = argInt(argv, argn, 5, 1);

  // Clamp to actual palette count (THIS MATTERS)
  palId = clampi(palId, 0, (int)g_paletteCount - 1);

  sdfSetPalette(i,
                palId,
                clampi(mix, 0, 255),
                clampi(scroll, 0, 255),
                clampi(bright, 0, 255),
                blend ? 1 : 0);

  retInt(retVal, 1);
}



static bool wrenchInitAndCompile(const String& userCode, String& errOut) {
  debugPrint(21);
  wrenchShutdown();
  errOut = "";
  debugPrint(22);
  g_wr = wr_newState();
  if (!g_wr) {
    errOut = "wr_newState failed";
    return false;
  }
  debugPrint(23);
  wr_loadAllLibs(g_wr);
  debugPrint(24);
  // core functions
  wr_registerFunction(g_wr, "pinMode", w_pinMode);

  wr_registerFunction(g_wr, "digitalWrite", w_digitalWrite);
  wr_registerFunction(g_wr, "digitalRead", w_digitalRead);
  wr_registerFunction(g_wr, "analogRead", w_analogRead);
  wr_registerFunction(g_wr, "analogWrite", w_analogWrite);
  wr_registerFunction(g_wr, "delay", w_delay);
  wr_registerFunction(g_wr, "millis", w_millis);
  wr_registerFunction(g_wr, "time_is_valid", w_time_is_valid);
  wr_registerFunction(g_wr, "time_now", w_time_now);
  wr_registerFunction(g_wr, "time_local_seconds", w_time_local_seconds);
  wr_registerFunction(g_wr, "time_local_hour", w_time_local_hour);
  wr_registerFunction(g_wr, "time_local_minute", w_time_local_minute);
  wr_registerFunction(g_wr, "time_local_second", w_time_local_second);
  wr_registerFunction(g_wr, "time_local_ymd", w_time_local_ymd);
  wr_registerFunction(g_wr, "time_get", w_time_get);
  wr_registerFunction(g_wr, "time_set_timezone", w_time_set_timezone);
  wr_registerFunction(g_wr, "time_sync", w_time_sync);
  wr_registerFunction(g_wr, "tube_xyz", w_tube_xyz);
  wr_registerFunction(g_wr, "tube_xyz3", w_tube_xyz3);
  wr_registerFunction(g_wr, "lerp", w_lerp);
  wr_registerFunction(g_wr, "lerp3", w_lerp3);
  wr_registerFunction(g_wr, "lerp_color", w_lerp_color);
  wr_registerFunction(g_wr, "micros", w_micros);
  wr_registerFunction(g_wr, "randomSeed", w_randomSeed);
  wr_registerFunction(g_wr, "tube_lerp", w_tube_lerp);
  wr_registerFunction(g_wr, "noise_seed", w_noise_seed);
  wr_registerFunction(g_wr, "simplex3", w_simplex3);
  wr_registerFunction(g_wr, "simplex3_01", w_simplex3_01);

  wr_registerFunction(g_wr, "random", w_random);
  wr_registerFunction(g_wr, "sdf_set_tex_time", w_sdf_set_tex_time);
  wr_registerFunction(g_wr, "tube_endpoints", w_tube_endpoints);
  wr_registerFunction(g_wr, "print", w_print);
  wr_registerFunction(g_wr, "println", w_println);

  wr_registerFunction(g_wr, "inbox_get", w_inbox_get);
  wr_registerFunction(g_wr, "inbox_has", w_inbox_has);
  wr_registerFunction(g_wr, "sdf_palette_rgbN_cur", w_sdf_palette_rgbN_cur);
  wr_registerFunction(g_wr, "sdf_palette_hsvN_cur", w_sdf_palette_hsvN_cur);



  wr_registerFunction(g_wr, "sdf_palette_rgb3", w_sdf_palette_rgb3);
  wr_registerFunction(g_wr, "sdf_palette_hsv3", w_sdf_palette_hsv3);
  wr_registerFunction(g_wr, "sdf_palette_rgb3_cur", w_sdf_palette_rgb3_cur);
  wr_registerFunction(g_wr, "sdf_palette_hsv3_cur", w_sdf_palette_hsv3_cur);


  // LED API
  wr_registerFunction(g_wr, "leds_begin", w_leds_begin);
  wr_registerFunction(g_wr, "leds_total", w_leds_total);
  wr_registerFunction(g_wr, "leds_strip_count", w_leds_strip_count);
  wr_registerFunction(g_wr, "leds_strip_len", w_leds_strip_len);
  wr_registerFunction(g_wr, "leds_show", w_leds_show);
  wr_registerFunction(g_wr, "leds_clear", w_leds_clear);
  wr_registerFunction(g_wr, "leds_set_brightness", w_leds_set_brightness);
  wr_registerFunction(g_wr, "leds_get_brightness", w_leds_get_brightness);
  wr_registerFunction(g_wr, "leds_set_pixel", w_leds_set_pixel);
  wr_registerFunction(g_wr, "leds_set_pixel_c", w_leds_set_pixel_c);
  wr_registerFunction(g_wr, "leds_get_pixel_c", w_leds_get_pixel_c);
  wr_registerFunction(g_wr, "sdf_set_palette", w_sdf_set_palette);

  // SDF API
  wr_registerFunction(g_wr, "sdf_set_material", w_sdf_set_material);
  wr_registerFunction(g_wr, "sdf_set_count", w_sdf_set_count);
  wr_registerFunction(g_wr, "sdf_get_count", w_sdf_get_count);
  wr_registerFunction(g_wr, "sdf_set_sphere", w_sdf_set_sphere);
  wr_registerFunction(g_wr, "create_Sphere", w_create_sphere);
  wr_registerFunction(g_wr, "sdf_update_sphere", w_sdf_update_sphere);
  wr_registerFunction(g_wr, "create_Box", w_create_box);
  wr_registerFunction(g_wr, "sdf_update_box", w_sdf_update_box);
  wr_registerFunction(g_wr, "create_Color", w_create_color);
  wr_registerFunction(g_wr, "sdf_set_box", w_sdf_set_box);
  wr_registerFunction(g_wr, "sdf_set_shape", w_sdf_set_shape);
  wr_registerFunction(g_wr, "sdf_render", w_sdf_render);
  wr_registerFunction(g_wr, "tube_endpoints3", w_tube_endpoints3);
  wr_registerFunction(g_wr, "tube_xyz_out", w_tube_xyz_out);
  wr_registerFunction(g_wr, "tube_endpoints_out", w_tube_endpoints_out);
  debugPrint(25);
  String pre = buildPrelude();
  String src;
  src.reserve(pre.length() + 1 + userCode.length());
  src = pre;
  src += '\n';
  src += userCode;
  unsigned char* bytecode = nullptr;
  int byteLen = 0;
  static char errMsg[1024];
  errMsg[0] = 0;
  debugPrint(26);

  //if(!heapOkForCompile()){
  //  sendWrenchError("compile", "not enough heap/fragmented (need bigger contiguous block)");
  //  return false;
  //}
  WRError ce = wr_compile(src.c_str(), (int)src.length(), &bytecode, &byteLen, errMsg, WR_INCLUDE_GLOBALS);
  debugPrint(30);

  if (ce != WR_ERR_None || !bytecode || byteLen <= 0) {
    String msg = errMsg[0] ? String(errMsg) : "compile failed";
    sendWrenchError("compile", msg);
    wrenchShutdown();
    return false;
  }
  debugPrint(27);
  g_ctx = wr_run(g_wr, bytecode, byteLen, true, false);
  if (!g_ctx) {
    WRError re = wr_getLastError(g_wr);
    sendWrenchError("run", String("runtime error code=") + (int)re);
    wrenchShutdown();
    return false;
  }

  g_fnSetup = wr_getFunction(g_ctx, "setup");
  g_fnTick = wr_getFunction(g_ctx, "tick");
  g_fnOnMessage = wr_getFunction(g_ctx, "onMessage");

  g_hasProgram = true;

  if (g_setupPendingPtr) {
    *g_setupPendingPtr = (g_fnSetup != nullptr);
  }
  debugPrint(28);
  return true;
}

// Expose compile/run for background task (defined in comm.ino)
bool wrenchCompileAndRun(const String& userCode, String& errOut) {
  return wrenchInitAndCompile(userCode, errOut);
}

void wrenchBindSetupPendingFlag(volatile bool* flag) {
  g_setupPendingPtr = flag;
}

void wrenchCallSetup() {
  if (!g_hasProgram || !g_ctx || !g_fnSetup) return;
  wr_callFunction(g_ctx, g_fnSetup, nullptr, 0);
}

static void wrenchTickSafe() {
  if (!g_hasProgram || !g_ctx || !g_fnTick) return;

  // Run user tick (should write into g_renderBuf)
  wr_callFunction(g_ctx, g_fnTick, nullptr, 0);

  // Submit frame (non-blocking)
  if (g_ledTaskHandle && g_renderBuf) {
    if (renderBufTryClaimForShow()) {
      xTaskNotify(g_ledTaskHandle, NOTIF_FRAME, eSetBits);
    }
  }
}



static inline void renderBufWatchdogUnwedge(uint32_t now, uint32_t timeoutMs) {
  portENTER_CRITICAL(&g_mux);
  if (!g_renderFree && g_renderClaimMs && (uint32_t)(now - g_renderClaimMs) > timeoutMs) {
    // Only do this if you're comfortable with "better to keep running than perfect frames".
    g_renderFree = true;
    g_renderClaimMs = 0;
  }
  portEXIT_CRITICAL(&g_mux);
}

static void wrenchDeliverInboxIfHandler() {
  if (!g_hasProgram || !g_ctx || !g_fnOnMessage) return;
  if (!g_inboxDirty) return;
  wr_callFunction(g_ctx, g_fnOnMessage, nullptr, 0);
  g_inboxDirty = false;
}
