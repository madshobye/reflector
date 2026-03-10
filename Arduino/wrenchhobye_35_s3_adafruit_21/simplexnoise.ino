// ============================================================
// Fast 3D Simplex noise (seeded) + Wrench bindings
// - returns ~[-1..+1]
// - cheap enough for per-frame sphere motion
// ============================================================

static uint8_t g_perm[512];
static bool g_permInit = false;

static inline uint32_t xorshift32(uint32_t& s) {
  s ^= s << 13; s ^= s >> 17; s ^= s << 5;
  return s;
}

static void simplexSeed(uint32_t seed) {
  uint8_t p[256];
  for (int i = 0; i < 256; i++) p[i] = (uint8_t)i;

  uint32_t s = seed ? seed : 0x12345678u;
  // Fisher–Yates shuffle
  for (int i = 255; i > 0; i--) {
    uint32_t r = xorshift32(s);
    int j = (int)(r % (uint32_t)(i + 1));
    uint8_t tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }

  for (int i = 0; i < 512; i++) g_perm[i] = p[i & 255];
  g_permInit = true;
}

static inline int fastFloor(float x) {
  int i = (int)x;
  return (x < (float)i) ? (i - 1) : i;
}

// Gradient function (12 directions)
static inline float grad3(int hash, float x, float y, float z) {
  int h = hash & 15;
  float u = (h < 8) ? x : y;
  float v = (h < 4) ? y : ((h == 12 || h == 14) ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

static float simplex3(float xin, float yin, float zin) {
  if (!g_permInit) simplexSeed((uint32_t)esp_random());

  // Skew/unskew factors for 3D
  const float F3 = 1.0f / 3.0f;
  const float G3 = 1.0f / 6.0f;

  float s = (xin + yin + zin) * F3;
  int i = fastFloor(xin + s);
  int j = fastFloor(yin + s);
  int k = fastFloor(zin + s);

  float t = (float)(i + j + k) * G3;
  float X0 = (float)i - t;
  float Y0 = (float)j - t;
  float Z0 = (float)k - t;

  float x0 = xin - X0;
  float y0 = yin - Y0;
  float z0 = zin - Z0;

  // Determine simplex corner ordering
  int i1, j1, k1;
  int i2, j2, k2;

  if (x0 >= y0) {
    if (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }       // X Y Z
    else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }  // X Z Y
    else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }                // Z X Y
  } else {
    if (y0 < z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }        // Z Y X
    else if (x0 < z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }   // Y Z X
    else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }                // Y X Z
  }

  float x1 = x0 - (float)i1 + G3;
  float y1 = y0 - (float)j1 + G3;
  float z1 = z0 - (float)k1 + G3;

  float x2 = x0 - (float)i2 + 2.0f * G3;
  float y2 = y0 - (float)j2 + 2.0f * G3;
  float z2 = z0 - (float)k2 + 2.0f * G3;

  float x3 = x0 - 1.0f + 3.0f * G3;
  float y3 = y0 - 1.0f + 3.0f * G3;
  float z3 = z0 - 1.0f + 3.0f * G3;

  int ii = i & 255;
  int jj = j & 255;
  int kk = k & 255;

  // 4 corners contributions
  float n0, n1, n2, n3;

  float t0 = 0.6f - x0*x0 - y0*y0 - z0*z0;
  if (t0 < 0) n0 = 0.0f;
  else {
    t0 *= t0;
    int gi0 = g_perm[ii + g_perm[jj + g_perm[kk]]];
    n0 = t0 * t0 * grad3(gi0, x0, y0, z0);
  }

  float t1 = 0.6f - x1*x1 - y1*y1 - z1*z1;
  if (t1 < 0) n1 = 0.0f;
  else {
    t1 *= t1;
    int gi1 = g_perm[ii + i1 + g_perm[jj + j1 + g_perm[kk + k1]]];
    n1 = t1 * t1 * grad3(gi1, x1, y1, z1);
  }

  float t2 = 0.6f - x2*x2 - y2*y2 - z2*z2;
  if (t2 < 0) n2 = 0.0f;
  else {
    t2 *= t2;
    int gi2 = g_perm[ii + i2 + g_perm[jj + j2 + g_perm[kk + k2]]];
    n2 = t2 * t2 * grad3(gi2, x2, y2, z2);
  }

  float t3 = 0.6f - x3*x3 - y3*y3 - z3*z3;
  if (t3 < 0) n3 = 0.0f;
  else {
    t3 *= t3;
    int gi3 = g_perm[ii + 1 + g_perm[jj + 1 + g_perm[kk + 1]]];
    n3 = t3 * t3 * grad3(gi3, x3, y3, z3);
  }

  // Scale to roughly [-1,1]
  return 32.0f * (n0 + n1 + n2 + n3);
}
