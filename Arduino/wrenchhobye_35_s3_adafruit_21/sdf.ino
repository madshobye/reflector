// ============================================================
// sdf.ino (unified shapes + per-shape material texture)
// - Integer "U" units (cm -> U)
// - LED positions stored as int16 (IVec3S16) in g_ledPosU
// - Shapes contribute ONLY inside (no falloff / no glow)
// - Bias curve inside (NN-style) + exponent "power" for hardness
// - Per-tube relevance lists: tube AABB intersects shape's bounding sphere
//
// NEW: per-shape "material" = XOR-ish texture
//   - texId       : 0..9 (pattern selector)
//   - texStrength : 0..255 (0=off)
//   - texCellU    : cell size in U
//   - texShift    : if texCellU is power-of-two, shift for fast division
//   - texSeed     : uint32 seed
//   - texMode     : 0=XY, 1=XZ, 2=YZ, 3=radial-ish (L1)
//
// Texture application:
//   - compute pat8 in [0..255]
//   - modulate intensity weight (wQ16) around 1.0
//     modQ16 = ONE_Q + ( (pat-128) * texStrength * (ONE_Q/2) >> 15 )
//     => up to ~0.5x..1.5x at strength=255
//
// NOTE: all texture eval is integer only; no sqrt/trig.
// ============================================================

#include <stdint.h>
#include <math.h>
#include <string.h>

static CRGBPalette16 g_palettes[] = {
  RainbowColors_p,
  LavaColors_p,
  OceanColors_p,
  ForestColors_p,
  PartyColors_p,
  HeatColors_p,
  GoldenDecay_p
};
static const uint8_t g_paletteCount = sizeof(g_palettes) / sizeof(g_palettes[0]);


static int g_lastShapeIndex = -1;  // "current sphere" convenience


// ------------------------------------------------------------
// Forward declarations for external things you already have
// ------------------------------------------------------------
// FastLED types
// (Assumes CRGB, CHSV, hsv2rgb_rainbow, clampi, clampf exist in your project)
/*#ifndef clampi
static inline int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
#endif
#ifndef clampf
static inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
#endif
*/
static inline float fLen3(float x, float y, float z) {
  return sqrtf(x * x + y * y + z * z);
}

// Your globals (existing in your project)
/*extern void* g_ledPosU;         // buffer holding IVec3S16[TOTAL_LEDS]
extern CRGB* g_renderBuf;       // front render buffer
extern bool renderBufIsFree();  // your swap/lock logic*/

// Your compile-time constants
/*#ifndef NUM_STRIPS
#define NUM_STRIPS 6
#endif
#ifndef NUM_LEDS_PER_STRIP
#define NUM_LEDS_PER_STRIP 128
#endif
#ifndef TOTAL_LEDS
#define TOTAL_LEDS (NUM_STRIPS * NUM_LEDS_PER_STRIP)
#endif
#ifndef NUMSECTIONS_PR_TUBE
#define NUMSECTIONS_PR_TUBE 4
#endif*/

// ------------------------------------------------------------
// Units + fixedpoint
// ------------------------------------------------------------
static constexpr int32_t U_PER_MM = 4;
static constexpr int32_t U_PER_CM = 40;

static constexpr int Q = 16;
static constexpr int32_t ONE_Q = (1 << Q);

// ------------------------------------------------------------
// Limits
// ------------------------------------------------------------
static constexpr int MAX_TUBES = 6;
static constexpr int MAX_SHAPES = 256;  // must match sdfSetCount clamp

// ------------------------------------------------------------
// Shape types
// ------------------------------------------------------------
static constexpr uint8_t SDF_SPHERE = 0;
static constexpr uint8_t SDF_BOX = 1;

// ------------------------------------------------------------
// Texture patterns (10)
// ------------------------------------------------------------
static constexpr uint8_t TEX_XOR_CHECKER = 0;
static constexpr uint8_t TEX_XOR_DIAG_STRIPES = 1;
static constexpr uint8_t TEX_XOR_MOIRE = 2;
static constexpr uint8_t TEX_XOR_CROSSHATCH = 3;
static constexpr uint8_t TEX_XOR_HASH_NOISE = 4;
static constexpr uint8_t TEX_XOR_BITPLANE = 5;
static constexpr uint8_t TEX_PARITY_LATTICE = 6;
static constexpr uint8_t TEX_CELL_RINGS_LINF = 7;
static constexpr uint8_t TEX_MANHATTAN_XOR = 8;
static constexpr uint8_t TEX_TEMPORAL_XOR = 9;

// texMode (projection)
static constexpr uint8_t TEXMODE_XY = 0;
static constexpr uint8_t TEXMODE_XZ = 1;
static constexpr uint8_t TEXMODE_YZ = 2;
static constexpr uint8_t TEXMODE_RADIAL = 3;  // uses L1-ish radius in chosen plane

// ------------------------------------------------------------
// Basic vector + segment types
// ------------------------------------------------------------
//struct hsv2rgb_rainbowIVec3S16 { int16_t x, y, z; };

/*struct LedSegmentF {
  float x,y,z;     // start
  float dx,dy,dz;  // direction (not necessarily normalized)
  float len;       // length
  int   count;     // weight / intended LEDs for this segment
};*/

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
static inline int32_t i32min(int32_t a, int32_t b) {
  return (a < b) ? a : b;
}
static inline int32_t i32max(int32_t a, int32_t b) {
  return (a > b) ? a : b;
}
static inline int32_t iabs32(int32_t v) {
  return (v < 0) ? -v : v;
}

static inline int32_t clamp_i32(int32_t v, int32_t lo, int32_t hi) {
  return (v < lo) ? lo : (v > hi) ? hi
                                  : v;
}
static inline int32_t clampQ16(int32_t v) {
  if ((uint32_t)v > (uint32_t)ONE_Q) return (v < 0) ? 0 : ONE_Q;
  return v;
}
static inline int32_t q16_mul(int32_t a, int32_t b) {
  return (int32_t)(((int64_t)a * (int64_t)b) >> Q);
}

static void sdfSetPalette(int i, int palId, int mix, int scroll, int bright, int blend) {
  if (i < 0 || i >= g_shapeCount) return;
  SDFShapeI& s = g_shapes[i];

  s.palId = (uint8_t)clampi(palId, 0, (int)g_paletteCount - 1);
  s.palMix = (uint8_t)clampi(mix, 0, 255);
  s.palScroll = (uint8_t)clampi(scroll, 0, 255);
  s.palBright = (uint8_t)clampi(bright, 0, 255);
  s.palBlend = (uint8_t)(blend ? 1 : 0);
}


// Helpers (non-hot)
static inline int16_t cmToU_s16(float cm) {
  int32_t v = (int32_t)lroundf(cm * (float)U_PER_CM);
  if (v < -32768) v = -32768;
  if (v > 32767) v = 32767;
  return (int16_t)v;
}
static inline uint16_t alphaToQ8(float a) {
  float aa = clampf(a, 0.0f, 8.0f);
  int v = (int)lroundf(aa * 256.0f);
  if (v < 0) v = 0;
  if (v > 2048) v = 2048;
  return (uint16_t)v;
}

// ------------------------------------------------------------
// Bias curve (NN-style)
// ------------------------------------------------------------
static inline int32_t bias_q16(int32_t tQ16, int32_t bQ16) {
  if (tQ16 <= 0) return 0;
  if (tQ16 >= ONE_Q) return ONE_Q;

  if (bQ16 < 1) bQ16 = 1;
  if (bQ16 > ONE_Q - 1) bQ16 = ONE_Q - 1;

  const uint32_t invbQ16 = (uint32_t)((1ULL << 32) / (uint32_t)bQ16);  // Q16
  const int32_t kQ16 = (int32_t)invbQ16 - (2 << Q);                    // Q16

  const int32_t oneMinusT = ONE_Q - tQ16;
  int32_t denomQ16 = q16_mul(kQ16, oneMinusT) + ONE_Q;
  if (denomQ16 <= 0) return ONE_Q;

  return (int32_t)(((int64_t)tQ16 << Q) / denomQ16);
}
static inline uint16_t biasToQ16(float b) {
  float bb = clampf(b, 0.01f, 0.99f);
  int v = (int)lroundf(bb * 65535.0f);
  if (v < 1) v = 1;
  if (v > 65534) v = 65534;
  return (uint16_t)v;
}

// ------------------------------------------------------------
// Reciprocal helpers
// ------------------------------------------------------------
static inline int32_t fastDiv_Q32(int64_t xQ, uint32_t invDen_Q32) {
  return (int32_t)(((uint64_t)xQ * (uint64_t)invDen_Q32) >> 32);
}
static inline uint32_t recip_u32_Q32(int32_t den) {
  if (den <= 0) den = 1;
  return (uint32_t)((1ULL << 32) / (uint32_t)den);
}

// ------------------------------------------------------------
// Power curve t^p  (p=1..8)
// ------------------------------------------------------------
static inline uint8_t clampPower(uint8_t p) {
  if (p < 1) p = 1;
  if (p > 8) p = 8;
  return p;
}
static inline int32_t curve_pow_q16(int32_t tQ16, uint8_t p) {
  if (tQ16 <= 0) return 0;
  if (tQ16 >= ONE_Q) return ONE_Q;
  p = clampPower(p);
  int32_t out = tQ16;
  for (uint8_t k = 1; k < p; k++) out = q16_mul(out, tQ16);
  return out;
}

// ------------------------------------------------------------
// Texture helpers
// ------------------------------------------------------------
static inline bool isPow2_u32(uint32_t v) {
  return v && ((v & (v - 1)) == 0);
}
static inline uint8_t log2_u32(uint32_t v) {
  uint8_t r = 0;
  while (v > 1) {
    v >>= 1;
    r++;
  }
  return r;
}

// Cheap 2D hash -> 0..255
static inline uint8_t hash2_8(int32_t ix, int32_t iy, uint32_t seed) {
  uint32_t h = seed ^ (uint32_t)(ix * 374761393) ^ (uint32_t)(iy * 668265263);
  h ^= h >> 13;
  h *= 1274126177u;
  h ^= h >> 16;
  return (uint8_t)(h & 255u);
}

// pick (u,v) from (x,y,z) according to texMode plane.
// For RADIAL, we still return a plane (u,v); radial is computed later.
static inline void tex_pick_uv(uint8_t mode, int32_t x, int32_t y, int32_t z, int32_t& u, int32_t& v) {
  switch (mode) {
    default:
    case TEXMODE_XY:
      u = x;
      v = y;
      break;
    case TEXMODE_XZ:
      u = x;
      v = z;
      break;
    case TEXMODE_YZ:
      u = y;
      v = z;
      break;
  }
}

// cell index by either shift (pow2) or division.
static inline int32_t tex_cell_index(int32_t coordU, int32_t cellU, uint8_t shift) {
  if (shift != 255) return coordU >> shift;  // power-of-two path
  return coordU / cellU;                     // general path
}

// Core eval: returns pat8 0..255
// If texMode has bit4 set, texture is evaluated in shape-local space.
static inline uint8_t sdfTex_eval(const SDFShapeI& s, int32_t px, int32_t py, int32_t pz, uint32_t timeParam) {
  if (s.texStrength == 0) return 128;  // neutral

  // optional local space (stick texture to shape)
  if (s.texMode & 0x10) {
    px -= (int32_t)s.centerU.x;
    py -= (int32_t)s.centerU.y;
    pz -= (int32_t)s.centerU.z;
  }

  // choose projection plane
  int32_t u, v;
  uint8_t mode = (uint8_t)(s.texMode & 3);
  tex_pick_uv(mode == TEXMODE_RADIAL ? TEXMODE_XY : mode, px, py, pz, u, v);

  // scale to cells
  const int32_t cellU = (s.texCellU > 0) ? s.texCellU : 1;
  const uint8_t sh = s.texShift;

  int32_t ix = tex_cell_index(u, cellU, sh);
  int32_t iy = tex_cell_index(v, cellU, sh);

  // local coordinate inside cell (only used for rings)
  int32_t lx = u - ix * cellU;
  int32_t ly = v - iy * cellU;

  // make lx,ly positive-ish
  if (lx < 0) lx += cellU;
  if (ly < 0) ly += cellU;

  const uint32_t seed = s.texSeed;

  switch (s.texId) {
    default:
    case TEX_XOR_CHECKER:
      {
        return ((ix ^ iy) & 1) ? 255 : 0;
      }
    case TEX_XOR_DIAG_STRIPES:
      {
        // 0..224
        return (uint8_t)((((ix ^ (iy << 1)) & 7) << 5) & 255);
      }
    case TEX_XOR_MOIRE:
      {
        // 0,85,170,255
        return (uint8_t)((((ix ^ iy ^ (ix >> 1)) & 3) * 85) & 255);
      }
    case TEX_XOR_CROSSHATCH:
      {
        return (uint8_t)((((ix ^ iy ^ (iy >> 2)) & 7) << 5) & 255);
      }
    case TEX_XOR_HASH_NOISE:
      {
        return hash2_8(ix, iy, seed);
      }
    case TEX_XOR_BITPLANE:
      {
        uint8_t b = (uint8_t)(seed & 7u);  // or expose “bit” separately if you want
        return (((((ix ^ iy) >> b) & 1) ? 255 : 0));
      }
    case TEX_PARITY_LATTICE:
      {
        int32_t iz = (int32_t)(timeParam >> 4);  // slow temporal parity
        return ((ix + iy + iz) & 1) ? 220 : 30;
      }
    case TEX_CELL_RINGS_LINF:
      {
        // L∞ rings inside each cell + XOR macro structure
        int32_t dx = iabs32(lx - (cellU >> 1));
        int32_t dy = iabs32(ly - (cellU >> 1));
        int32_t d = i32max(dx, dy);
        int32_t ring = (d >> 2);  // thickness knob
        return (uint8_t)(((ix ^ iy) + ring) & 255);
      }
    case TEX_MANHATTAN_XOR:
      {
        int32_t ax = iabs32(ix);
        int32_t ay = iabs32(iy);
        return (uint8_t)((ax ^ ay) & 255);
      }
    case TEX_TEMPORAL_XOR:
      {
        int32_t tt = (int32_t)(timeParam >> 3);
        return (uint8_t)((ix ^ iy ^ tt) & 255);
      }
  }
}

// Convert pat8 (0..255) into a Q16 multiplier around 1.0
// Strength controls how much +- modulation you get.
static inline int32_t sdfTex_mulQ16(uint8_t pat8, uint8_t strength) {
  if (strength == 0) return ONE_Q;

  // d in [-128..127]
  const int32_t d = (int32_t)pat8 - 128;

  // mod = 1.0 + d*strength*(0.5)   (scaled)
  // d*strength ~ [-32640..32385] fits 16 bits.
  // multiply by (ONE_Q/2)=32768 -> fits 32-bit signed.
  int32_t add = (int32_t)(((int64_t)d * (int64_t)strength * (int64_t)(ONE_Q / 2)) >> 15);
  int32_t modQ16 = ONE_Q + add;

  // clamp to [0..2.0]
  if (modQ16 < 0) modQ16 = 0;
  if (modQ16 > (2 * ONE_Q)) modQ16 = 2 * ONE_Q;
  return modQ16;
}

// Convert pat8 into a scale around 1.0 in Q7.1-ish (128 = 1.0)
static inline uint8_t sdfTex_scale8(uint8_t pat8, uint8_t strength) {
  if (strength == 0) return 128;
  const int32_t d = (int32_t)pat8 - 128;
  int32_t scaled = 128 + ((d * (int32_t)strength) >> 8);
  if (scaled < 0) scaled = 0;
  if (scaled > 255) scaled = 255;
  return (uint8_t)scaled;
}

// ------------------------------------------------------------
// Per-tube relevance lists + tube bounds
// ------------------------------------------------------------
static int32_t g_tubeMinU[MAX_TUBES][3];
static int32_t g_tubeMaxU[MAX_TUBES][3];
static bool g_tubeBoundsValid = false;

static uint16_t g_tubeShapeIdx[MAX_TUBES][MAX_SHAPES];
static uint16_t g_tubeShapeCount[MAX_TUBES];
static bool g_tubeListsDirty = true;

// Global time param used by some textures (set from millis or Wrench)
static uint32_t g_sdfTexTime = 0;
static inline void sdfSetTexTime(uint32_t t) {
  g_sdfTexTime = t;
}

// Distance^2 from point to AABB (no sqrt). If inside, returns 0.
static inline int64_t dist2_point_aabb(
  int32_t px, int32_t py, int32_t pz,
  int32_t minx, int32_t miny, int32_t minz,
  int32_t maxx, int32_t maxy, int32_t maxz) {

  int32_t cx = clamp_i32(px, minx, maxx);
  int32_t cy = clamp_i32(py, miny, maxy);
  int32_t cz = clamp_i32(pz, minz, maxz);
  int32_t dx = px - cx;
  int32_t dy = py - cy;
  int32_t dz = pz - cz;
  return (int64_t)dx * dx + (int64_t)dy * dy + (int64_t)dz * dz;
}

static void sdfComputeTubeBoundsFromLedPos() {
  if (!g_ledPosU) return;

  const int tubes = (NUM_STRIPS < MAX_TUBES) ? NUM_STRIPS : MAX_TUBES;
  const IVec3S16* pos16 = (const IVec3S16*)g_ledPosU;

  for (int t = 0; t < tubes; t++) {
    const int base = t * NUM_LEDS_PER_STRIP;

    int32_t minx = 0x7fffffff, miny = 0x7fffffff, minz = 0x7fffffff;
    int32_t maxx = -0x7fffffff, maxy = -0x7fffffff, maxz = -0x7fffffff;

    for (int i = 0; i < NUM_LEDS_PER_STRIP; i++) {
      const IVec3S16& p = pos16[base + i];
      const int32_t x = (int32_t)p.x;
      const int32_t y = (int32_t)p.y;
      const int32_t z = (int32_t)p.z;
      minx = i32min(minx, x);
      maxx = i32max(maxx, x);
      miny = i32min(miny, y);
      maxy = i32max(maxy, y);
      minz = i32min(minz, z);
      maxz = i32max(maxz, z);
    }

    const int32_t PAD = (int32_t)cmToU_s16(1.0f);  // 1 cm
    g_tubeMinU[t][0] = minx - PAD;
    g_tubeMaxU[t][0] = maxx + PAD;
    g_tubeMinU[t][1] = miny - PAD;
    g_tubeMaxU[t][1] = maxy + PAD;
    g_tubeMinU[t][2] = minz - PAD;
    g_tubeMaxU[t][2] = maxz + PAD;
  }

  for (int t = tubes; t < MAX_TUBES; t++) {
    g_tubeMinU[t][0] = g_tubeMinU[t][1] = g_tubeMinU[t][2] = 0;
    g_tubeMaxU[t][0] = g_tubeMaxU[t][1] = g_tubeMaxU[t][2] = 0;
  }

  g_tubeBoundsValid = true;
  g_tubeListsDirty = true;
}

static void sdfRebuildTubeShapeLists() {
  if (!g_tubeBoundsValid) return;

  for (int t = 0; t < MAX_TUBES; t++) g_tubeShapeCount[t] = 0;

  const int tubes = (NUM_STRIPS < MAX_TUBES) ? NUM_STRIPS : MAX_TUBES;

  for (int i = 0; i < g_shapeCount; i++) {
    const SDFShapeI& s = g_shapes[i];
    if (!s.alphaQ8) continue;

    const int32_t sx = (int32_t)s.centerU.x;
    const int32_t sy = (int32_t)s.centerU.y;
    const int32_t sz = (int32_t)s.centerU.z;

    int32_t rU_cheap = 0;
    if (s.type == SDF_SPHERE) rU_cheap = s.aU;
    else rU_cheap = i32max(s.aU, i32max(s.bU, s.cU));

    for (int t = 0; t < tubes; t++) {
      const int32_t minx = g_tubeMinU[t][0], miny = g_tubeMinU[t][1], minz = g_tubeMinU[t][2];
      const int32_t maxx = g_tubeMaxU[t][0], maxy = g_tubeMaxU[t][1], maxz = g_tubeMaxU[t][2];

      if (sx < (minx - rU_cheap) || sx > (maxx + rU_cheap) || sy < (miny - rU_cheap) || sy > (maxy + rU_cheap) || sz < (minz - rU_cheap) || sz > (maxz + rU_cheap)) {
        continue;
      }

      const int64_t d2 = dist2_point_aabb(sx, sy, sz, minx, miny, minz, maxx, maxy, maxz);
      if (d2 <= s.cull2) {
        uint16_t& cnt = g_tubeShapeCount[t];
        if (cnt < MAX_SHAPES) g_tubeShapeIdx[t][cnt++] = (uint16_t)i;
      }
    }
  }

  g_tubeListsDirty = false;
}

// ------------------------------------------------------------
// LED geometry init
// (KEEP YOUR EXISTING TETRAHEDRON MAPPER)
// Make sure initAllLedPositionsU ends with sdfComputeTubeBoundsFromLedPos()
// ------------------------------------------------------------

// ------------------------------------------------------------
// Shape API (allocation)
// ------------------------------------------------------------
static bool sdfEnsureCapacity(int n) {
  if (n <= g_shapeCap) return true;

  int newCap = g_shapeCap ? g_shapeCap : 4;
  while (newCap < n) newCap *= 2;

  SDFShapeI* ns = (SDFShapeI*)heap_caps_malloc((size_t)newCap * sizeof(SDFShapeI), MALLOC_CAP_8BIT);
  if (!ns) return false;

  if (g_shapes && g_shapeCount > 0) memcpy(ns, g_shapes, (size_t)g_shapeCount * sizeof(SDFShapeI));
  if (g_shapes) free(g_shapes);

  g_shapes = ns;
  g_shapeCap = newCap;
  return true;
}

static void sdfSetCount(int n) {
  if (n < 0) n = 0;
  if (n > MAX_SHAPES) n = MAX_SHAPES;
  if (!sdfEnsureCapacity(n)) return;

  //for (int i = g_shapeCount; i < n; i++) {
  for (int i = 0; i < n; i++) {
    SDFShapeI& s = g_shapes[i];
    s.centerU = { 0, 0, 0 };
    s.type = SDF_SPHERE;

    s.palId = 0;
    s.palMix = 0;  // back-compat: palette off
    s.palScroll = 0;
    s.palBright = 255;
    s.palBlend = 1;

    s.aU = (int32_t)cmToU_s16(1.0f);
    if (s.aU < 1) s.aU = 1;
    s.bU = s.cU = 0;

    s.rgb = CRGB::Black;
    s.alphaQ8 = 0;

    s.biasQ16 = (uint16_t)(ONE_Q / 2);
    s.power = 4;

    const int64_t r2 = (int64_t)s.aU * (int64_t)s.aU;
    s.cull2 = r2;
    s.inv_a2_Q32 = (uint32_t)((1ULL << 32) / (uint64_t)(r2 ? r2 : 1));
    s.inv_a_Q32 = recip_u32_Q32(s.aU);
    s.inv_b_Q32 = 0;
    s.inv_c_Q32 = 0;

    // ---- material defaults ----
    s.texId = TEX_XOR_HASH_NOISE;  // default pattern (nice “grain”)
    s.texStrength = 0;             // off by default (back-compat)
    s.texMode = TEXMODE_XY;
    s.texCellU = (int32_t)cmToU_s16(6.0f);
    if (s.texCellU < 1) s.texCellU = 1;
    s.texShift = isPow2_u32((uint32_t)s.texCellU) ? log2_u32((uint32_t)s.texCellU) : 255;
    s.texSeed = 1337u;
  }

  g_shapeCount = n;
  g_tubeListsDirty = true;
}

// ------------------------------------------------------------
// Unified setter (geometry + color + field knobs)
// (kept identical signature to your current version)
// ------------------------------------------------------------
static void sdfSetShape(int i,
                        int type,
                        float x, float y, float z,
                        float a, float b, float c,
                        int hue, int sat, int val,
                        float alpha,
                        float bias,
                        int power) {
  if (i < 0 || i >= g_shapeCount) return;

  SDFShapeI& s = g_shapes[i];
  s.type = (type == (int)SDF_BOX) ? SDF_BOX : SDF_SPHERE;

  s.centerU = { cmToU_s16(x), cmToU_s16(y), cmToU_s16(z) };

  uint8_t H = (uint8_t)clampi(hue, 0, 255);
  uint8_t S = (uint8_t)clampi(sat, 0, 255);
  uint8_t V = (uint8_t)clampi(val, 0, 255);
  CHSV hsv(H, S, V);
  hsv2rgb_rainbow(hsv, s.rgb);

  s.alphaQ8 = alphaToQ8(alpha);
  s.biasQ16 = biasToQ16(bias);
  s.power = clampPower((uint8_t)power);

  if (s.type == SDF_SPHERE) {
    s.aU = (int32_t)cmToU_s16(a);
    if (s.aU < 1) s.aU = 1;
    s.bU = s.cU = 0;

    const int64_t r2 = (int64_t)s.aU * (int64_t)s.aU;
    s.cull2 = r2;
    s.inv_a2_Q32 = (uint32_t)((1ULL << 32) / (uint64_t)(r2 ? r2 : 1));
    s.inv_a_Q32 = recip_u32_Q32(s.aU);
    s.inv_b_Q32 = 0;
    s.inv_c_Q32 = 0;

  } else {
    int32_t hx = (int32_t)cmToU_s16(a * 0.5f);
    int32_t hy = (int32_t)cmToU_s16(b * 0.5f);
    int32_t hz = (int32_t)cmToU_s16(c * 0.5f);
    if (hx < 1) hx = 1;
    if (hy < 1) hy = 1;
    if (hz < 1) hz = 1;

    s.aU = hx;
    s.bU = hy;
    s.cU = hz;

    const int64_t r2 = (int64_t)hx * hx + (int64_t)hy * hy + (int64_t)hz * hz;
    s.cull2 = r2;

    s.inv_a_Q32 = recip_u32_Q32(hx);
    s.inv_b_Q32 = recip_u32_Q32(hy);
    s.inv_c_Q32 = recip_u32_Q32(hz);

    s.inv_a2_Q32 = recip_u32_Q32(i32max(hx, i32max(hy, hz)));  // harmless
  }
  g_lastShapeIndex = i;
  g_tubeListsDirty = true;
}

// Back-compat sphere setter
static void sdfSetSphere(int i, float x, float y, float z, float r,
                         int hue, int sat, int val,
                         float alpha, float bias) {
  sdfSetShape(i, (int)SDF_SPHERE, x, y, z, r, 0, 0, hue, sat, val, alpha, bias, 4);
}

// ------------------------------------------------------------
// NEW: Material setter (per shape)
// - id: 0..9
// - cell_cm: pick something like 2..15cm
// - strength: 0..255 (0 disables texture)
// - seed: stable material identity
// - mode: 0=XY 1=XZ 2=YZ 3=RADIAL
// ------------------------------------------------------------
static void sdfSetMaterial(int i, int id, float cell_cm, int strength, uint32_t seed, int mode) {
  if (i < 0 || i >= g_shapeCount) return;

  SDFShapeI& s = g_shapes[i];

  s.texId = (uint8_t)clampi(id, 0, 9);
  s.texStrength = (uint8_t)clampi(strength, 0, 255);
  s.texSeed = seed;
  // keep upper bits for affect target and flags; lower 2 bits are plane
  s.texMode = (uint8_t)clampi(mode, 0, 31);

  int32_t cellU = (int32_t)cmToU_s16(cell_cm);
  if (cellU < 1) cellU = 1;
  s.texCellU = cellU;

  s.texShift = isPow2_u32((uint32_t)cellU) ? log2_u32((uint32_t)cellU) : 255;
}

// ------------------------------------------------------------
// Sampling: sphere + box (inside-only)
// ------------------------------------------------------------
static inline int32_t sphere_field_q16(const SDFShapeI& s, int32_t dx, int32_t dy, int32_t dz) {
  const int32_t rU = s.aU;

  if (dx > rU || dx < -rU || dy > rU || dy < -rU || dz > rU || dz < -rU) return 0;

  const int64_t d2 = (int64_t)dx * dx + (int64_t)dy * dy + (int64_t)dz * dz;
  const int64_t r2 = (int64_t)rU * rU;
  if (d2 > r2) return 0;

  const int64_t d2Q = (d2 << Q);
  int32_t fracQ16 = fastDiv_Q32(d2Q, s.inv_a2_Q32);
  fracQ16 = clampQ16(fracQ16);

  int32_t tQ16 = ONE_Q - fracQ16;
  if (tQ16 <= 0) return 0;

  tQ16 = bias_q16(tQ16, (int32_t)s.biasQ16);
  return curve_pow_q16(tQ16, s.power);
}

// Palette index from raw geometry (independent of bias/power)
// Returns 0..255 where 255 = center, 0 = edge/outside.
static inline uint8_t pal_index_raw(const SDFShapeI& s, int32_t dx, int32_t dy, int32_t dz) {
  if (s.type == SDF_SPHERE) {
    const int32_t rU = s.aU;
    if (rU <= 0) return 0;
    const int64_t d2 = (int64_t)dx * dx + (int64_t)dy * dy + (int64_t)dz * dz;
    const int64_t r2 = (int64_t)rU * rU;
    if (d2 >= r2) return 0;
    // map center->255, edge->0
    uint32_t frac = (uint32_t)((d2 * 255) / (r2 ? r2 : 1));
    return (uint8_t)(255 - (frac > 255 ? 255 : frac));
  } else {
    // box: use max normalized distance to a face
    int32_t ax = iabs32(dx);
    int32_t ay = iabs32(dy);
    int32_t az = iabs32(dz);
    int32_t aU = s.aU > 0 ? s.aU : 1;
    int32_t bU = s.bU > 0 ? s.bU : 1;
    int32_t cU = s.cU > 0 ? s.cU : 1;
    int32_t fxQ16 = (int32_t)(((int64_t)ax << Q) / aU);
    int32_t fyQ16 = (int32_t)(((int64_t)ay << Q) / bU);
    int32_t fzQ16 = (int32_t)(((int64_t)az << Q) / cU);
    int32_t fQ16 = i32max(fxQ16, i32max(fyQ16, fzQ16));
    if (fQ16 >= ONE_Q) return 0;
    uint32_t frac = (uint32_t)(fQ16 >> 8); // 0..255
    return (uint8_t)(255 - (frac > 255 ? 255 : frac));
  }
}

static inline int32_t box_field_q16(const SDFShapeI& s, int32_t dx, int32_t dy, int32_t dz) {
  const int32_t hx = s.aU, hy = s.bU, hz = s.cU;
  const int32_t adx = iabs32(dx);
  const int32_t ady = iabs32(dy);
  const int32_t adz = iabs32(dz);

  if (adx > hx || ady > hy || adz > hz) return 0;

  int32_t fx = (int32_t)(((int64_t)adx << Q) * (int64_t)s.inv_a_Q32 >> 32);
  int32_t fy = (int32_t)(((int64_t)ady << Q) * (int64_t)s.inv_b_Q32 >> 32);
  int32_t fz = (int32_t)(((int64_t)adz << Q) * (int64_t)s.inv_c_Q32 >> 32);

  fx = clampQ16(fx);
  fy = clampQ16(fy);
  fz = clampQ16(fz);

  int32_t nx = ONE_Q - fx;
  int32_t ny = ONE_Q - fy;
  int32_t nz = ONE_Q - fz;

  int32_t tQ16 = i32min(nx, i32min(ny, nz));
  if (tQ16 <= 0) return 0;

  tQ16 = bias_q16(tQ16, (int32_t)s.biasQ16);
  return curve_pow_q16(tQ16, s.power);
}
/* GOES TO WHITE
// ------------------------------------------------------------
// Sample (with texture modulation)
// ------------------------------------------------------------
static inline CRGB sdfSampleAtU_list(const IVec3S16& p,
                                     const uint16_t* idxList,
                                     uint16_t idxCount) {
  if (idxCount == 0) return CRGB::Black;

  int32_t accumR = 0, accumG = 0, accumB = 0;

  const int32_t px = (int32_t)p.x;
  const int32_t py = (int32_t)p.y;
  const int32_t pz = (int32_t)p.z;

  for (uint16_t li = 0; li < idxCount; li++) {
    const SDFShapeI& s = g_shapes[(int)idxList[li]];
    const uint16_t aQ8 = s.alphaQ8;
    if (!aQ8) continue;

    const int32_t dx = px - (int32_t)s.centerU.x;
    const int32_t dy = py - (int32_t)s.centerU.y;
    const int32_t dz = pz - (int32_t)s.centerU.z;

    int32_t fieldQ16 = (s.type == SDF_SPHERE) ? sphere_field_q16(s, dx, dy, dz)
                                              : box_field_q16(s, dx, dy, dz);
    if (fieldQ16 <= 0) continue;

    // weightQ24 = alphaQ8 * fieldQ16  -> wQ16-ish
    const int32_t weightQ24 = (int32_t)((int64_t)aQ8 * (int64_t)fieldQ16);
    int32_t wQ16 = weightQ24 >> 8;

    // --- texture modulation (cheap, only when inside) ---
    uint8_t pat8 = 128;
    if (s.texStrength) {
      pat8 = sdfTex_eval(s, px, py, pz, g_sdfTexTime);
      uint8_t affect = (uint8_t)((s.texMode >> 2) & 3);
      if (affect == 0) {
        int32_t modQ16 = sdfTex_mulQ16(pat8, s.texStrength);
        wQ16 = q16_mul(wQ16, modQ16);
      }
    }

    CRGB base = s.rgb;
    if (s.texStrength) {
      uint8_t affect = (uint8_t)((s.texMode >> 2) & 3);
      if (affect == 3) {
        uint8_t scale = sdfTex_scale8(pat8, s.texStrength);
        base.r = (uint8_t)clampi(((uint16_t)base.r * scale) >> 7, 0, 255);
        base.g = (uint8_t)clampi(((uint16_t)base.g * scale) >> 7, 0, 255);
        base.b = (uint8_t)clampi(((uint16_t)base.b * scale) >> 7, 0, 255);
      }
    }

    if (s.palMix) {
      // scroll the palette through time (super cheap)
      // uint8_t idx = pat8 + (uint8_t)((g_sdfTexTime * (uint32_t)s.palScroll) >> 8);
      uint8_t f8 = (uint8_t)(fieldQ16 >> 8);  // 0..255 (radial for spheres)
      uint8_t idx = f8
                    + (uint8_t)((g_sdfTexTime * (uint32_t)s.palScroll) >> 8);

      const TBlendType bt = s.palBlend ? LINEARBLEND : NOBLEND;
      CRGB palC = ColorFromPalette(g_palettes[s.palId], idx, s.palBright, bt);

      // Mix palette color with base shape rgb (0..255)
      // (FastLED has nblend, but this is predictable & cheap)
      uint16_t inv = 255 - s.palMix;
      base.r = (uint8_t)((base.r * inv + palC.r * s.palMix) >> 8);
      base.g = (uint8_t)((base.g * inv + palC.g * s.palMix) >> 8);
      base.b = (uint8_t)((base.b * inv + palC.b * s.palMix) >> 8);
    }

    // then accumulate using base instead of s.rgb
    accumR += (base.r * wQ16) >> Q;
    accumG += (base.g * wQ16) >> Q;
    accumB += (base.b * wQ16) >> Q;
  }

  return CRGB(
    (uint8_t)clampi(accumR, 0, 255),
    (uint8_t)clampi(accumG, 0, 255),
    (uint8_t)clampi(accumB, 0, 255));
}*/
/*
static inline CRGB sdfSampleAtU_list(const IVec3S16& p,
                                     const uint16_t* idxList,
                                     uint16_t idxCount) {
  if (idxCount == 0) return CRGB::Black;

  int64_t accumR = 0, accumG = 0, accumB = 0;
  int32_t sumW   = 0; // Q16-ish

  const int32_t px = (int32_t)p.x;
  const int32_t py = (int32_t)p.y;
  const int32_t pz = (int32_t)p.z;

  for (uint16_t li = 0; li < idxCount; li++) {
    const SDFShapeI& s = g_shapes[(int)idxList[li]];
    const uint16_t aQ8 = s.alphaQ8;
    if (!aQ8) continue;

    const int32_t dx = px - (int32_t)s.centerU.x;
    const int32_t dy = py - (int32_t)s.centerU.y;
    const int32_t dz = pz - (int32_t)s.centerU.z;

    int32_t fieldQ16 = (s.type == SDF_SPHERE) ? sphere_field_q16(s, dx, dy, dz)
                                              : box_field_q16(s, dx, dy, dz);
    if (fieldQ16 <= 0) continue;

    // wQ16 ≈ alpha * field
    const int32_t weightQ24 = (int32_t)((int64_t)aQ8 * (int64_t)fieldQ16);
    int32_t wQ16 = weightQ24 >> 8;
    if (wQ16 <= 0) continue;

    if (s.texStrength) {
      uint8_t pat8 = sdfTex_eval(s, px, py, pz, g_sdfTexTime);
      int32_t modQ16 = sdfTex_mulQ16(pat8, s.texStrength);
      wQ16 = q16_mul(wQ16, modQ16);
      if (wQ16 <= 0) continue;
    }

    CRGB base = s.rgb;

    if (s.palMix) {
      // palette index is radial (field), with optional scroll
      uint8_t f8 = (uint8_t)(fieldQ16 >> 8);  // 0..255
      uint8_t idx = f8 + (uint8_t)((g_sdfTexTime * (uint32_t)s.palScroll) >> 8);
      const TBlendType bt = s.palBlend ? LINEARBLEND : NOBLEND;
      CRGB palC = ColorFromPalette(g_palettes[s.palId], idx, s.palBright, bt);

      uint16_t inv = 255 - s.palMix;
      base.r = (uint8_t)((base.r * inv + palC.r * s.palMix) >> 8);
      base.g = (uint8_t)((base.g * inv + palC.g * s.palMix) >> 8);
      base.b = (uint8_t)((base.b * inv + palC.b * s.palMix) >> 8);
    }

    sumW   += wQ16;
    accumR += (int64_t)base.r * (int64_t)wQ16;
    accumG += (int64_t)base.g * (int64_t)wQ16;
    accumB += (int64_t)base.b * (int64_t)wQ16;
  }

    if (sumW <= 0) return CRGB::Black;

  // Q32 reciprocal once (FAST)
  const uint32_t invSumW_Q32 = recip_u32_Q32(sumW);

  // avg in 0..255 (accum*inv >> 32), no divides
  const int32_t avgR = (int32_t)(((uint64_t)accumR * (uint64_t)invSumW_Q32) >> 32);
  const int32_t avgG = (int32_t)(((uint64_t)accumG * (uint64_t)invSumW_Q32) >> 32);
  const int32_t avgB = (int32_t)(((uint64_t)accumB * (uint64_t)invSumW_Q32) >> 32);

  // intensity from coverage (restores bias/power shading)
  int32_t intenQ16 = sumW;
  if (intenQ16 < 0) intenQ16 = 0;
  if (intenQ16 > ONE_Q) intenQ16 = ONE_Q;

  const int32_t r = (int32_t)(((int64_t)avgR * (int64_t)intenQ16) >> Q);
  const int32_t g = (int32_t)(((int64_t)avgG * (int64_t)intenQ16) >> Q);
  const int32_t b = (int32_t)(((int64_t)avgB * (int64_t)intenQ16) >> Q);

  return CRGB((uint8_t)clampi(r, 0, 255),
              (uint8_t)clampi(g, 0, 255),
              (uint8_t)clampi(b, 0, 255));

}*/


// ------------------------------------------------------------
// Sample (with texture modulation)
// ------------------------------------------------------------
static inline CRGB sdfSampleAtU_list(const IVec3S16& p,
                                     const uint16_t* idxList,
                                     uint16_t idxCount) {
  if (idxCount == 0) return CRGB::Black;

  int32_t accumR = 0, accumG = 0, accumB = 0;

  const int32_t px = (int32_t)p.x;
  const int32_t py = (int32_t)p.y;
  const int32_t pz = (int32_t)p.z;

  for (uint16_t li = 0; li < idxCount; li++) {
    const SDFShapeI& s = g_shapes[(int)idxList[li]];
    const uint16_t aQ8 = s.alphaQ8;
    if (!aQ8) continue;

    const int32_t dx = px - (int32_t)s.centerU.x;
    const int32_t dy = py - (int32_t)s.centerU.y;
    const int32_t dz = pz - (int32_t)s.centerU.z;

    int32_t fieldQ16 = (s.type == SDF_SPHERE) ? sphere_field_q16(s, dx, dy, dz)
                                              : box_field_q16(s, dx, dy, dz);
    if (fieldQ16 <= 0) continue;

    // weightQ24 = alphaQ8 * fieldQ16  -> wQ16-ish
    const int32_t weightQ24 = (int32_t)((int64_t)aQ8 * (int64_t)fieldQ16);
    int32_t wQ16 = weightQ24 >> 8;

    // --- texture modulation (cheap, only when inside) ---
    uint8_t pat8 = 128;
    if (s.texStrength) {
      pat8 = sdfTex_eval(s, px, py, pz, g_sdfTexTime);
      int32_t modQ16 = sdfTex_mulQ16(pat8, s.texStrength);
      wQ16 = q16_mul(wQ16, modQ16);
    }

    CRGB base = s.rgb;

    if (s.palMix) {
      // palette index from raw geometry (independent of bias/power)
      // palette index: invert so center=0, edge=255
      uint8_t f8 = pal_index_raw(s, dx, dy, dz);
      uint8_t idx = (uint8_t)(255 - f8)
                    + (uint8_t)((g_sdfTexTime * (uint32_t)s.palScroll) >> 8);

      /*
      const TBlendType bt = s.palBlend ? LINEARBLEND : NOBLEND;
      CRGB palC = ColorFromPalette(g_palettes[s.palId], idx, s.palBright, bt);
      */

      const TBlendType bt = s.palBlend ? LINEARBLEND : NOBLEND;

      const CRGBPalette16& usePal =
        (s.palDynOn ? s.palDyn : g_palettes[s.palId]);

      uint8_t palBright = s.palBright;
      uint8_t palMix = s.palMix;
      uint8_t affect = (uint8_t)((s.texMode >> 2) & 3);
      if (s.texStrength) {
        uint8_t scale = sdfTex_scale8(pat8, s.texStrength);
        if (affect == 1) {
          palBright = (uint8_t)clampi(((uint16_t)palBright * scale) >> 7, 0, 255);
        } else if (affect == 2) {
          palMix = (uint8_t)clampi(((uint16_t)palMix * scale) >> 7, 0, 255);
        }
      }

      CRGB palC = ColorFromPalette(usePal, idx, palBright, bt);

      // Mix palette color with base shape rgb (0..255)
      // (FastLED has nblend, but this is predictable & cheap)
      uint16_t inv = 255 - palMix;
      base.r = (uint8_t)((base.r * inv + palC.r * palMix) >> 8);
      base.g = (uint8_t)((base.g * inv + palC.g * palMix) >> 8);
      base.b = (uint8_t)((base.b * inv + palC.b * palMix) >> 8);
    }

    // then accumulate using base instead of s.rgb
    accumR += (base.r * wQ16) >> Q;
    accumG += (base.g * wQ16) >> Q;
    accumB += (base.b * wQ16) >> Q;
  }

  return CRGB(
    (uint8_t)clampi(accumR, 0, 255),
    (uint8_t)clampi(accumG, 0, 255),
    (uint8_t)clampi(accumB, 0, 255));
}



// ------------------------------------------------------------
// Render
// ------------------------------------------------------------
static void sdfRenderIntoFront(uint32_t stripMask) {
  if (!g_renderBuf || !g_ledPosU) return;
  if (!renderBufIsFree()) return;

  if (!g_tubeBoundsValid) sdfComputeTubeBoundsFromLedPos();
  if (g_tubeListsDirty) sdfRebuildTubeShapeLists();

  // If you want texture time to just follow firmware time:
  // sdfSetTexTime((uint32_t)millis());

  CRGB* __restrict dst = g_renderBuf;
  const IVec3S16* __restrict pos16 = (const IVec3S16*)g_ledPosU;

  const int tubes = (NUM_STRIPS < MAX_TUBES) ? NUM_STRIPS : MAX_TUBES;
  const int segLen = (NUMSECTIONS_PR_TUBE > 0) ? (NUM_LEDS_PER_STRIP / NUMSECTIONS_PR_TUBE) : NUM_LEDS_PER_STRIP;

  for (int t = 0; t < tubes; t++) {
    const uint16_t* idxList = g_tubeShapeIdx[t];
    const uint16_t idxCnt = g_tubeShapeCount[t];

    const int base = t * NUM_LEDS_PER_STRIP;

    for (int s = 0; s < NUMSECTIONS_PR_TUBE; s++) {
      const int bit = t * NUMSECTIONS_PR_TUBE + s;
      if (bit < 32) {
        if (((stripMask >> bit) & 1u) == 0u) continue;
      } else {
        // out of mask range => skip
        continue;
      }

      const int start = s * segLen;
      const int end = (s == (NUMSECTIONS_PR_TUBE - 1)) ? NUM_LEDS_PER_STRIP : (s + 1) * segLen;
      if (idxCnt == 0) {
        memset(dst + base + start, 0, (size_t)(end - start) * sizeof(CRGB));
        continue;
      }
      for (int i = start; i < end; i++) {
        dst[base + i] = sdfSampleAtU_list(pos16[base + i], idxList, idxCnt);
      }
    }
  }

  for (int t = tubes; t < NUM_STRIPS; t++) {
    const int base = t * NUM_LEDS_PER_STRIP;
    for (int i = 0; i < NUM_LEDS_PER_STRIP; i++) dst[base + i] = CRGB::Black;
  }
}

// ============================================================
// Dynamic per-shape palette (generated on the fly, stored once)
// - build a CRGBPalette16 with LINEAR blend between 3 or 4 stops
// - keep your existing palMix/palScroll/palBright/palBlend pipeline
// ============================================================

// Build a 16-entry palette from 3 colors with a mid stop at ~45% (115/255)
static inline CRGBPalette16 buildPal16_3(CRGB c0, CRGB c1, CRGB c2, uint8_t mid = 115) {
  CRGBPalette16 pal;
  for (int i = 0; i < 16; i++) {
    uint8_t x = (uint8_t)((i * 255) / 15);  // 0..255
    if (x <= mid) {
      uint8_t t = (mid == 0) ? 0 : (uint8_t)((uint16_t)x * 255 / mid);
      pal[i] = blend(c0, c1, t);
    } else {
      uint8_t denom = (uint8_t)(255 - mid);
      uint8_t t = (denom == 0) ? 255 : (uint8_t)(((uint16_t)(x - mid) * 255) / denom);
      pal[i] = blend(c1, c2, t);
    }
  }
  return pal;
}

// Optional: 4-stop builder (if you want more control later)
static inline CRGBPalette16 buildPal16_4(CRGB c0, CRGB c1, CRGB c2, CRGB c3,
                                         uint8_t p1 = 85, uint8_t p2 = 170) {
  CRGBPalette16 pal;
  for (int i = 0; i < 16; i++) {
    uint8_t x = (uint8_t)((i * 255) / 15);
    if (x <= p1) {
      uint8_t t = (p1 == 0) ? 0 : (uint8_t)((uint16_t)x * 255 / p1);
      pal[i] = blend(c0, c1, t);
    } else if (x <= p2) {
      uint8_t denom = (uint8_t)(p2 - p1);
      uint8_t t = (denom == 0) ? 0 : (uint8_t)(((uint16_t)(x - p1) * 255) / denom);
      pal[i] = blend(c1, c2, t);
    } else {
      uint8_t denom = (uint8_t)(255 - p2);
      uint8_t t = (denom == 0) ? 255 : (uint8_t)(((uint16_t)(x - p2) * 255) / denom);
      pal[i] = blend(c2, c3, t);
    }
  }
  return pal;
}

// Attach a generated RGB palette to shape i
static void sdfSetPaletteRGB3(int i,
                              uint8_t r0, uint8_t g0, uint8_t b0,
                              uint8_t r1, uint8_t g1, uint8_t b1,
                              uint8_t r2, uint8_t g2, uint8_t b2,
                              int mix, int scroll, int bright, int blend,
                              uint8_t midPos /*0..255*/ = 115) {
  if (i < 0 || i >= g_shapeCount) return;
  SDFShapeI& s = g_shapes[i];

  s.palDyn = buildPal16_3(CRGB(r0, g0, b0), CRGB(r1, g1, b1), CRGB(r2, g2, b2), midPos);
  s.palDynOn = 1;

  // Reuse your existing knobs
  s.palMix = (uint8_t)clampi(mix, 0, 255);
  s.palScroll = (uint8_t)clampi(scroll, 0, 255);
  s.palBright = (uint8_t)clampi(bright, 0, 255);
  s.palBlend = (uint8_t)(blend ? 1 : 0);
}

// HSV version (uses FastLED hsv2rgb_rainbow for nice saturation)
static void sdfSetPaletteHSV3(int i,
                              uint8_t h0, uint8_t s0, uint8_t v0,
                              uint8_t h1, uint8_t s1, uint8_t v1,
                              uint8_t h2, uint8_t s2, uint8_t v2,
                              int mix, int scroll, int bright, int blend,
                              uint8_t midPos /*0..255*/ = 115) {
  if (i < 0 || i >= g_shapeCount) return;

  CRGB c0, c1, c2;
  hsv2rgb_rainbow(CHSV(h0, s0, v0), c0);
  hsv2rgb_rainbow(CHSV(h1, s1, v1), c1);
  hsv2rgb_rainbow(CHSV(h2, s2, v2), c2);

  sdfSetPaletteRGB3(i,
                    c0.r, c0.g, c0.b,
                    c1.r, c1.g, c1.b,
                    c2.r, c2.g, c2.b,
                    mix, scroll, bright, blend, midPos);
}

// Convenience: apply to "current" shape (last sdfSetShape / sdfSetSphere)
static inline int sdfCurrentShape() {
  return g_lastShapeIndex;
}

static void sdfSetPaletteRGB3_current(uint8_t r0, uint8_t g0, uint8_t b0,
                                      uint8_t r1, uint8_t g1, uint8_t b1,
                                      uint8_t r2, uint8_t g2, uint8_t b2,
                                      int mix, int scroll, int bright, int blend,
                                      uint8_t midPos = 115) {
  int i = sdfCurrentShape();
  if (i < 0) return;
  sdfSetPaletteRGB3(i, r0, g0, b0, r1, g1, b1, r2, g2, b2, mix, scroll, bright, blend, midPos);
}

static void sdfSetPaletteHSV3_current(uint8_t h0, uint8_t s0, uint8_t v0,
                                      uint8_t h1, uint8_t s1, uint8_t v1,
                                      uint8_t h2, uint8_t s2, uint8_t v2,
                                      int mix, int scroll, int bright, int blend,
                                      uint8_t midPos = 115) {
  int i = sdfCurrentShape();
  if (i < 0) return;
  sdfSetPaletteHSV3(i, h0, s0, v0, h1, s1, v1, h2, s2, v2, mix, scroll, bright, blend, midPos);
}

// ============================================================
// Dynamic N-stop palette builder (2..8 colors)
// ============================================================

static inline CRGBPalette16 buildPal16_N(const CRGB* cols, uint8_t n) {
  CRGBPalette16 pal;

  if (n < 2) {
    for (int i = 0; i < 16; i++) pal[i] = cols[0];
    return pal;
  }

  // map palette index 0..15 -> 0..255
  for (int i = 0; i < 16; i++) {
    uint8_t x = (uint8_t)((i * 255) / 15);

    // segment index
    uint8_t segLen = 255 / (n - 1);
    uint8_t seg = x / segLen;
    if (seg >= n - 1) seg = n - 2;

    uint8_t segStart = seg * segLen;
    uint8_t t = (uint8_t)(((uint16_t)(x - segStart) * 255) / segLen);

    pal[i] = blend(cols[seg], cols[seg + 1], t);
  }

  return pal;
}
static void sdfSetPaletteRGB_N(int i,
                               const CRGB* cols, uint8_t n,
                               int mix, int scroll, int bright, int blend) {
  if (i < 0 || i >= g_shapeCount) return;
  if (n < 2) return;

  SDFShapeI& s = g_shapes[i];

  s.palDyn = buildPal16_N(cols, n);
  s.palDynOn = 1;

  s.palMix = (uint8_t)clampi(mix, 0, 255);
  s.palScroll = (uint8_t)clampi(scroll, 0, 255);
  s.palBright = (uint8_t)clampi(bright, 0, 255);
  s.palBlend = (uint8_t)(blend ? 1 : 0);
}

static void sdfSetPaletteHSV_N(int i,
                               const CHSV* hsvs, uint8_t n,
                               int mix, int scroll, int bright, int blend) {
  if (n < 2) return;

  CRGB cols[8];
  if (n > 8) n = 8;

  for (uint8_t k = 0; k < n; k++) {
    hsv2rgb_rainbow(hsvs[k], cols[k]);
  }

  sdfSetPaletteRGB_N(i, cols, n, mix, scroll, bright, blend);
}



static inline void sdfSetPaletteRGB_N_current(const CRGB* cols, uint8_t n,
                                              int mix, int scroll, int bright, int blend) {
  if (g_lastShapeIndex < 0) return;
  sdfSetPaletteRGB_N(g_lastShapeIndex, cols, n, mix, scroll, bright, blend);
}

static inline void sdfSetPaletteHSV_N_current(const CHSV* hsvs, uint8_t n,
                                              int mix, int scroll, int bright, int blend) {
  if (g_lastShapeIndex < 0) return;
  sdfSetPaletteHSV_N(g_lastShapeIndex, hsvs, n, mix, scroll, bright, blend);
}


// Reset all SDF state (called when loading a new Wrench program)
void sdfResetAll() {
  g_lastShapeIndex = -1;
  g_shapeCount = 0;
  g_tubeListsDirty = true;
  for (int t = 0; t < MAX_TUBES; t++) g_tubeShapeCount[t] = 0;
  if (g_shapes && g_shapeCap > 0) {
    memset(g_shapes, 0, (size_t)g_shapeCap * sizeof(SDFShapeI));
  }
  if (g_renderBuf && renderBufIsFree()) {
    memset(g_renderBuf, 0, (size_t)TOTAL_LEDS * sizeof(CRGB));
  }
}
