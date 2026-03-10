#define ARDUINO_LOOP_STACK_SIZE 65536
//#define ARDUINO_LOOP_STACK_SIZE 16384
//#define MADSTESTER  // lille prototype board

// ============================================================
// main.ino (REWRITE): 2-BUFFER MODEL (Adafruit_NeoPXL8 OUTPUT)
//
//   - g_renderBuf : Core 1 (Wrench) renders here
//   - g_leds      : Core 0 copies into this (front buffer)
//   - NeoPXL8 reads its own internal pixel buffer; Core 0 converts g_leds -> NeoPXL8
//
// Handshake:
//   - Core 1 calls w_leds_show() when frame is ready
//   - Core 0 memcpy(renderBuf->g_leds), then releases renderBuf immediately,
//     then converts to NeoPXL8 buffer + show() while Core 1 can already render next frame.
//
// NOTE: Your "front buffer write" functions must write into g_renderBuf.
// ============================================================

#include <WiFi.h>
#include <MQTT.h>
#include <time.h>
#include <Arduino.h>
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static String g_mqttInbox;
static volatile bool g_mqttInboxDirty = false;

#include <esp_system.h>
#include <Preferences.h>

// Keep FastLED ONLY for CRGB/CHSV convenience types (we do NOT call FastLED.show)
#include <FastLED.h>

// Adafruit 8-lane driver (works great on ESP32-S3)
#include <Adafruit_NeoPXL8.h>

#include "wrench.h"
#include <ctype.h>
#include <math.h>

/*#ifndef PXL8_USE_SWIZZLE
#ifdef MADSTESTER
#define PXL8_USE_SWIZZLE 0
#else

#endif
#endif*/
#define PXL8_USE_SWIZZLE 0

#ifndef countof
#define countof(a) (sizeof(a) / sizeof((a)[0]))
#endif

struct SDFShapeI;
//static inline float fLen3(float x, float y, float z);

WiFiClient net;
// mqtt.setBufferSize(32768);   // try 8192, 16384, 32768
MQTTClient mqtt(32768);

// ------------------------------------------------------------
// Types / shared data
// ------------------------------------------------------------
// INT16 LED positions (big RAM + bandwidth win)
struct IVec3S16 {
  int16_t x, y, z;
};

// LED positions in integer units (stored compact)
static IVec3S16* g_ledPosU = nullptr;  // [TOTAL_LEDS]


/*struct MaterialI {
  uint8_t hue, sat, val;
  uint16_t alphaQ8;  // alpha in Q8.8 (0..8 -> 0..2048)
  int32_t falloffU;  // falloff thickness in units (>=1)
};*/
// Unified SDF shape (single list for spheres + boxes)
//static constexpr uint8_t SDF_SPHERE = 0;
//static constexpr uint8_t SDF_BOX    = 1;

/*struct SDFShapeI {
  IVec3S16 centerU;        // int16 center (fast loads)

  uint8_t  type;           // SDF_SPHERE or SDF_BOX
  uint8_t  power;          // 1..8 hardness (t^power)
  uint16_t alphaQ8;        // 0..2048 (0..8.0 * 256)
  uint16_t biasQ16;        // 0..65535 (0.5 neutral)

  CRGB     rgb;

  // dims in U:
  //  - sphere: aU = rU, bU/cU unused
  //  - box:    aU,bU,cU = half-extents (hx,hy,hz)
  int32_t  aU, bU, cU;

  // cached relevance radius^2 (bounding sphere):
  //  - sphere: rU^2
  //  - box:    hx^2 + hy^2 + hz^2 (conservative)
  int64_t  cull2;

  // cached reciprocals:
  //  - sphere: inv_a2_Q32 = 1/(rU^2)
  //  - box:    inv_a_Q32 = 1/hx, inv_b_Q32 = 1/hy, inv_c_Q32 = 1/hz
  uint32_t inv_a2_Q32;
  uint32_t inv_a_Q32, inv_b_Q32, inv_c_Q32;
};*/

// ------------------------------------------------------------
// Shape struct (UPDATED with texture/material fields)
// ------------------------------------------------------------
struct SDFShapeI {
  IVec3S16 centerU;
  uint8_t type;  // SDF_SPHERE / SDF_BOX
// In your SDFShapeI struct:
CRGBPalette16 palDyn;   // per-shape runtime palette
uint8_t       palDynOn; // 0=off, 1=use palDyn
  // geometry
  int32_t aU, bU, cU;  // sphere: aU=radius; box: aU,bU,cU=half extents

  // color + intensity
  CRGB rgb;
  uint16_t alphaQ8;  // 0..2048 (8x)
  uint16_t biasQ16;  // 0..65535 (0.5 = identity)
  uint8_t power;     // 1..8

  // culling + fast reciprocals
  int64_t cull2;        // bounding sphere radius^2 in U^2
  uint32_t inv_a2_Q32;  // sphere: 1/(r^2) in Q32
  uint32_t inv_a_Q32;   // box: 1/hx
  uint32_t inv_b_Q32;   // box: 1/hy
  uint32_t inv_c_Q32;   // box: 1/hz

  // --- MATERIAL / TEXTURE ---
  uint8_t texId;        // 0..9
  uint8_t texStrength;  // 0..255 (0 = off)
  uint8_t texMode;      // 0..3
  uint8_t texShift;     // if texCellU is power-of-two => shift, else 255
  int32_t texCellU;     // cell size in U (>=1)
  uint32_t texSeed;     // seed

  // palette material
  uint8_t palId;      // which palette
  uint8_t palMix;     // 0..255 (0=use rgb only, 255=use palette only)
  uint8_t palScroll;  // 0..255 scroll speed (adds time)
  uint8_t palBright;  // 0..255 max brightness for ColorFromPalette
  uint8_t palBlend;   // 0=LINEARBLEND off, 1=on
};

// ------------------------------------------------------------
// Shape storage (existing globals in your project; define here if needed)
// ------------------------------------------------------------
static SDFShapeI* g_shapes = nullptr;
static int g_shapeCount = 0;
static int g_shapeCap = 0;


// did not bother to rename sphere so added this:

/*using SphereI = SDFShapeI;
static SphereI* g_spheres = nullptr;
//static SDFShapeI* g_shapes = nullptr;
static int g_sphereCount = 0;
static int g_sphereCap = 0;*/


struct LedSegmentF {
  float x, y, z;
  float dx, dy, dz;
  float len;
  int count;
};

// ------------------------------------------------------------
// Debug / stats
// ------------------------------------------------------------
static uint32_t g_runStartMs = 0;
static bool g_verificationArmed = false;
static uint32_t g_fpsTickCount = 0;
static uint32_t g_fpsLastMs = 0;
static TaskHandle_t g_wrenchTaskHandle = nullptr;
static TaskHandle_t g_loopTaskHandle = nullptr;
static portMUX_TYPE g_fpsMux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool g_wrenchSetupPending = false;

// defined in wrenchbindings.ino
extern bool g_hasProgram;
extern void wrenchBindSetupPendingFlag(volatile bool* flag);
extern void wrenchCallSetup();
// defined in comm.ino
extern void commInitCompileTask();
extern bool runCompileTaskNow(const String& code, String& errOut);
extern UBaseType_t commGetCompileStackHW();

static void wrenchTask(void* arg) {
  (void)arg;
  while (true) {
    uint32_t now = millis();

    if (g_hasProgram) {
      if (g_wrenchSetupPending) {
        g_wrenchSetupPending = false;
        wrenchCallSetup();
      }
      renderBufWatchdogUnwedge(now, 200);
      if (renderBufIsFree()) {
        wrenchTickSafe();
        portENTER_CRITICAL(&g_fpsMux);
        g_fpsTickCount++;
        portEXIT_CRITICAL(&g_fpsMux);
      }
    }

    // FPS reporting moved to loopTask (avoids cross-task JSON writes)

    vTaskDelay(1);
  }
}

static void heapDetail() {
  Serial.printf("[HEAP] free=%u minEver=%u largest=%u\n",
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
}

static void debugPrint(int count) {
  Serial.print("Debug : ");
  Serial.println(count);
  // heapDetail();
}

// ------------------------------------------------------------
// LED CONFIG  (KEEP PINS + STRIP GEOMETRY ASSUMPTIONS)
// ------------------------------------------------------------
static const int NUM_STRIPS = 6;
static uint32_t g_bootMs = 0;

// Your project assumes 6 strips laid out linearly: index = strip*LEN + pixel

#ifdef MADSTESTER
static const int NUM_LEDS_PER_STRIP = 128;

#define PXL8_COLOR_ORDER NEO_GRB
#else
static const int NUM_LEDS_PER_STRIP = 892;
#define PXL8_COLOR_ORDER NEO_RGB

#endif

#define NUMSECTIONS_PR_TUBE 4

static const int TOTAL_LEDS = NUM_STRIPS * NUM_LEDS_PER_STRIP;

// Output buffer: ONLY Core 0 writes/reads this (our "front buffer")
static CRGB g_leds[TOTAL_LEDS];

static inline CRGB* stripPtr(int s) {
  return g_leds + (s * NUM_LEDS_PER_STRIP);
}

// --- Adafruit NeoPXL8: MUST be 8 entries; keep your pins unchanged ---
//static int8_t g_pxl8Pins[8] = { 8, 9, 10, 11, 12, 13, -1, -1 };

// correct wiring:
static int8_t g_pxl8Pins[8] = { 4, 5, 6, 7, 15, 16, -1, -1 };

// pusher street wiring:
//static int8_t g_pxl8Pins[8] = { 4, 5, 16, 7, 15, 6, -1, -1 };

//static int8_t g_pxl8Pins[8] = { 5, 4, 7, 16, 15, 6, -1, -1 };

// NeoPXL8 wants "LEDs per lane"
//#define PXL8_COLOR_ORDER NEO_RGB
#ifdef MADSTESTER
static Adafruit_NeoPXL8 g_pxl8(NUM_LEDS_PER_STRIP * 2, g_pxl8Pins, PXL8_COLOR_ORDER);
//static int8_t g_pxl8Pins[8] = {16,15,7,6,5,4, -1, -1};

#else
static Adafruit_NeoPXL8 g_pxl8(NUM_LEDS_PER_STRIP, g_pxl8Pins, PXL8_COLOR_ORDER);

#endif


// ------------------------------------------------------------
// 2-BUFFER MODEL (renderBuf + g_leds)
// ------------------------------------------------------------
static TaskHandle_t g_mainTaskHandle = nullptr;  // Core 1 (Arduino loop)
static TaskHandle_t g_ledTaskHandle = nullptr;   // Core 0 (LED push)

static CRGB* g_renderBuf = nullptr;        // Core 1 renders here
static volatile bool g_renderFree = true;  // true => Core1 may write renderBuf

static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

// Task notifications (bits)
static const uint32_t NOTIF_TICK = (1u << 0);   // "tick credit" (Core0->Core1)
static const uint32_t NOTIF_FRAME = (1u << 1);  // "frame ready" (Core1->Core0)

// ------------------------------------------------------------
// NVS keys
// ------------------------------------------------------------
static const char* NVS_NS = "wrench";
static const char* NVS_KEY = "code";
static const char* NVS_RUNSTATE = "runstate";
static const uint8_t RUN_NONE = 0;
static const uint8_t RUN_PENDING_NEW = 1;
static const uint8_t RUN_PENDING_TRIED = 2;
static const uint8_t RUN_OK = 3;

// ------------------------------------------------------------
// Wrench state
// ------------------------------------------------------------
static WRState* g_wr = nullptr;
static WRContext* g_ctx = nullptr;
static WRFunction* g_fnSetup = nullptr;
static WRFunction* g_fnTick = nullptr;
static WRFunction* g_fnOnMessage = nullptr;

static String g_code;
bool g_hasProgram = false;

// Inbox from host -> Wrench
static String g_inbox;
static bool g_inboxDirty = false;

// Brightness
static uint8_t g_brightness = 255;

// ------------------------------------------------------------
// LED push task (Core 0)
//  - Wait NOTIF_FRAME
//  - memcpy(renderBuf -> g_leds)
//  - release renderBuf immediately (Core1 can start next frame)
//  - convert g_leds -> NeoPXL8 buffer
//  - NeoPXL8.show()
// ------------------------------------------------------------
static const int LED_TASK_CORE = 0;
static const int LED_TASK_STACK = 8192;
static const int LED_TASK_PRIO = 2;
#ifdef MADSTESTER
static inline int mapLogical32x4_to_Phys32x8_serp8(int logicalIdx) {
  static bool inited = false;
  static uint8_t lut[128];
  if (!inited) {
    for (int i = 0; i < 128; i++) {
      int x = i % 32;
      int y = i / 32;
      if (y & 1) x = 31 - x;
      if (x & 1) y = 7 - y;
      lut[i] = (uint8_t)(y + x * 8);
    }
    inited = true;
  }
  if (logicalIdx < 0) logicalIdx = 0;
  if (logicalIdx > 127) logicalIdx = 127;
  return (int)lut[logicalIdx];
}

/*
static inline int mapLogical32x4_to_Phys32x8_serp8(int logicalIdx) {
  // logical: 32x4, row-major
  int x = logicalIdx % 32;  // 0..31
  int y = logicalIdx / 32;  // 0..3  (top half of 8-high physical)
                            //int panel = logicalIdx % 128;

  // physical: 32 columns, each column is 8 tall, serpentine per column
  /*int row = y;                     // use rows 0..3 of the 0..7 physical height
  if (x & 1) row = 7 - row;        // serpentine: odd columns reverse the 8 direction

  if (y & 1) {
    x = 31 - x;
  }

  if (x & 1) y = 7 - y;

  //Serial.println(y  + x *8);
  return y + x * 8;  //+ panel*128;              // column-major index (0..255)
}
*/
#endif


static inline void pushFrameToNeoPXL8_Std(const CRGB* src) {
  // src is lane-major: src[strip*NUM_LEDS_PER_STRIP + p]
  for (int strip = 0; strip < NUM_STRIPS; strip++) {
    const int base = strip * NUM_LEDS_PER_STRIP;

    for (int p = 0; p < NUM_LEDS_PER_STRIP; p++) {

#ifdef MADSTESTER
      // Use only 32x4 = 128 pixels of this strip as a matrix
      // and remap logical order -> physical wiring order.
      int outIndex;

      outIndex = base * 2 + mapLogical32x4_to_Phys32x8_serp8(p);


      const CRGB& c = src[base + p];  // keep logical sampling from src in 32x4 order
      g_pxl8.setPixelColor(outIndex, c.r, c.g, c.b);

#else
      const CRGB& c = src[base + p];
      g_pxl8.setPixelColor(base + p, c.r, c.g, c.b);
#endif
    }
  }
}

static inline void pushFrameToNeoPXL8_Swizzle(const CRGB* src) {
  uint8_t* px = g_pxl8.getPixels();
  if (!px) return;
  copyCRGB_to_PXL8_Swizzle(px, src);
}

/*
static inline void pushFrameToNeoPXL8_Std(const CRGB* src) {
  // src is lane-major: src[strip*NUM_LEDS_PER_STRIP + p]
  for (int strip = 0; strip < NUM_STRIPS; strip++) {
    int base = strip * NUM_LEDS_PER_STRIP;
    for (int p = 0; p < NUM_LEDS_PER_STRIP; p++) {
      const CRGB& c = src[base + p];
      // Adafruit standard: setPixelColor(index, r,g,b)
      g_pxl8.setPixelColor(base + p, c.r, c.g, c.b);
    }
  }
}*/
static inline void copyCRGB_to_PXL8_Swizzle(uint8_t* dst, const CRGB* src) {
  static constexpr int LANES_HW = 8;    // NeoPXL8 DMA layout
  static constexpr int LANES_USED = 6;  // you use 6 tubes

  for (int p = 0; p < NUM_LEDS_PER_STRIP; p++) {
    const int base = (p * LANES_HW) * 3;

    // fill lanes you use
    for (int lane = 0; lane < LANES_USED; lane++) {
      const CRGB& c = src[lane * NUM_LEDS_PER_STRIP + p];
      const int di = base + lane * 3;
      dst[di + 0] = c.g;
      dst[di + 1] = c.r;
      dst[di + 2] = c.b;
    }

    // hard-zero unused lanes every frame
    for (int lane = LANES_USED; lane < LANES_HW; lane++) {
      const int di = base + lane * 3;
      dst[di + 0] = 0;
      dst[di + 1] = 0;
      dst[di + 2] = 0;
    }
  }
}

static void ledPushTask(void*) {
  uint8_t lastBrightness = 255;
  for (;;) {
    uint32_t bits = 0;
    xTaskNotifyWait(0, 0xFFFFFFFFu, &bits, portMAX_DELAY);

    if (bits & NOTIF_FRAME) {
      memcpy(g_leds, g_renderBuf, (size_t)TOTAL_LEDS * sizeof(CRGB));

      // release render buffer now (Core1 can render next frame)
      portENTER_CRITICAL(&g_mux);
      g_renderFree = true;
      portEXIT_CRITICAL(&g_mux);

      if (g_brightness != lastBrightness) {
        g_pxl8.setBrightness(g_brightness);
        lastBrightness = g_brightness;
      }
#if PXL8_USE_SWIZZLE
      pushFrameToNeoPXL8_Swizzle(g_leds);
#else
      pushFrameToNeoPXL8_Std(g_leds);
#endif
      g_pxl8.show();

      vTaskDelay(1);
      if (g_mainTaskHandle) xTaskNotify(g_mainTaskHandle, NOTIF_TICK, eSetBits);
    }
  }
}

static void startLedTaskIfNeeded() {
  if (g_ledTaskHandle) return;
  xTaskCreatePinnedToCore(
    ledPushTask,
    "ledPush",
    LED_TASK_STACK,
    nullptr,
    LED_TASK_PRIO,
    &g_ledTaskHandle,
    LED_TASK_CORE);
}

// ------------------------------------------------------------
// Render buffer helpers
// ------------------------------------------------------------
static inline bool renderBufIsFree() {
  bool free;
  portENTER_CRITICAL(&g_mux);
  free = g_renderFree;
  portEXIT_CRITICAL(&g_mux);
  return free;
}

static void alloc2buf() {
  uint32_t caps =
    psramFound() ? (MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) : MALLOC_CAP_8BIT;

  g_renderBuf = (CRGB*)heap_caps_malloc((size_t)TOTAL_LEDS * sizeof(CRGB), caps);
  g_ledPosU = (IVec3S16*)heap_caps_malloc((size_t)TOTAL_LEDS * sizeof(IVec3S16), caps);

  if (!g_renderBuf || !g_ledPosU) {
    sendErr("alloc failed (renderBuf or ledPosU)");
    while (true) { delay(1000); }
  }

  memset(g_renderBuf, 0, (size_t)TOTAL_LEDS * sizeof(CRGB));

  portENTER_CRITICAL(&g_mux);
  g_renderFree = true;
  portEXIT_CRITICAL(&g_mux);
}


// ------------------------------------------------------------
// Arduino setup/loop (keep flow the same; only LED init changed)
// ------------------------------------------------------------
void setup() {
  g_loopTaskHandle = xTaskGetCurrentTaskHandle();

  if (psramFound()) {
    heap_caps_malloc_extmem_enable(1024);  // >=1KB allocations prefer PSRAM
  }
  Serial.setRxBufferSize(8192);
  Serial.begin(115200);
  debugPrint(50);

  delay(50);

  // --- NeoPXL8 controller setup FIRST (pins unchanged) ---
  if (!g_pxl8.begin()) {
    pinMode(LED_BUILTIN, OUTPUT);
    for (;;) digitalWrite(LED_BUILTIN, (millis() / 500) & 1);
  }

  debugPrint(51);
  g_pxl8.setBrightness(g_brightness);

  // Clear our front buffer + NeoPXL8 buffer
  fill_solid(g_leds, TOTAL_LEDS, CRGB::Black);
  uint8_t* px = g_pxl8.getPixels();
  if (px) memset(px, 0, (size_t)TOTAL_LEDS * 3);
  // Optional initial show:
  // g_pxl8.show();

  debugPrint(512);

  Serial.printf("PSRAM found: %s\n", psramFound() ? "YES" : "NO");
  Serial.printf("freeHeap=%u maxAlloc=%u\n", ESP.getFreeHeap(), ESP.getMaxAllocHeap());

  // --- NOW do heap allocations (2buf model) ---
  debugPrint(52);
  alloc2buf();
  debugPrint(53);

  setupWifi();
  g_bootMs = millis();
  debugPrint(54);

  g_mainTaskHandle = xTaskGetCurrentTaskHandle();
  debugPrint(55);

  // Init default scene
  sdfSetCount(0);
  debugPrint(58);

  // Init LED geometry in world space -> integer units
  initAllLedPositionsU();
  debugPrint(59);

  // Boot message
  sendOk("boot");
  sendStatus();

  // Start LED push task on Core 0
  startLedTaskIfNeeded();

  // Start background compile task (prevents loopTask stack overflow)
  commInitCompileTask();

  if (!g_wrenchTaskHandle) {
    BaseType_t ok = xTaskCreatePinnedToCore(
      wrenchTask,
      "wrenchTask",
      16384,
      nullptr,
      2,
      &g_wrenchTaskHandle,
      1);
    if (ok != pdPASS) {
      g_wrenchTaskHandle = nullptr;
      sendErr("wrench task create failed");
    }
  }

  // Ensure setup() runs on the wrenchTask (not compile task)
  wrenchBindSetupPendingFlag(&g_wrenchSetupPending);

  // Give an initial tick credit (optional)
  xTaskNotify(g_mainTaskHandle, NOTIF_TICK, eSetBits);

  // --- Run-state gate + load stored code (same as before) ---
  debugPrint(0);
  uint8_t rs = loadRunState();
  debugPrint(1);

  String stored;
  if (loadCodeFromNVS(stored)) {
    debugPrint(11);
    if (rs == RUN_PENDING_TRIED) {
      sendErr("stored code skipped (crashed before verification)");
    } else {
      debugPrint(12);
      g_code = stored;
      String err;
      debugPrint(13);

      if (runCompileTaskNow(g_code, err)) {
        sendOk("stored code running");
        debugPrint(14);

        g_runStartMs = millis();
        g_verificationArmed = (rs != RUN_OK);

        if (rs == RUN_PENDING_NEW) {
          debugPrint(15);
          saveRunState(RUN_PENDING_TRIED);  // one-try latch
        }
      } else {
        debugPrint(16);
        sendErr("stored code failed");
        if (rs == RUN_PENDING_NEW) saveRunState(RUN_PENDING_TRIED);
        debugPrint(17);
      }
    }
  }

  debugPrint(5);
}
static uint32_t lastPrint = 0;

void loop() {
  pollSerial();
  timeService();

  if (ensureMqtt()) {
    mqtt.loop();
  }

  if (g_mqttInboxDirty) {
    g_mqttInboxDirty = false;
    handleJsonLine(g_mqttInbox.c_str());
  }

  // 5s crash-verification gate
  if (g_verificationArmed && (millis() - g_runStartMs) > 5000) {
    saveRunState(RUN_OK);
    g_verificationArmed = false;
    sendOk("code verified (5s)");
  }

  // ------------------------------------------------------------
  // FPS + memory reporting (loop task only)
  // ------------------------------------------------------------
  uint32_t now = millis();
  if (g_hasProgram && (now - g_fpsLastMs) >= 5000) {
    uint32_t dt = now - g_fpsLastMs;
    uint32_t count;
    portENTER_CRITICAL(&g_fpsMux);
    count = g_fpsTickCount;
    g_fpsTickCount = 0;
    portEXIT_CRITICAL(&g_fpsMux);

    uint32_t fps = (count * 1000) / (dt ? dt : 1);
    sendKV_int("fps", "fps", (int)fps);

    uint32_t free8 = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    uint32_t large8 = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    sendKV_int("heap_free", "bytes", (int)free8);
    sendKV_int("heap_largest", "bytes", (int)large8);

    if (g_wrenchTaskHandle) {
      UBaseType_t wHw = uxTaskGetStackHighWaterMark(g_wrenchTaskHandle);
      sendKV_int("wrench_stack_hw", "words", (int)wHw);
    }
    UBaseType_t cHw = commGetCompileStackHW();
    if (cHw) {
      sendKV_int("compile_stack_hw", "words", (int)cHw);
    }
    UBaseType_t lHw = uxTaskGetStackHighWaterMark(NULL);
    sendKV_int("loop_stack_hw", "words", (int)lHw);

    g_fpsLastMs = now;
  }

  taskYIELD();
}
