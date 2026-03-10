
static float g_tubeA_cm[6][3];
static float g_tubeB_cm[6][3];
static int g_tubeAB_valid = 0;

static float g_tubeA[6][3];
static float g_tubeB[6][3];

bool getTubeEndpointsCm(int tube, float& ax, float& ay, float& az, float& bx, float& by, float& bz) {
  if (tube < 0 || tube >= 6) return false;
  ax = g_tubeA[tube][0];
  ay = g_tubeA[tube][1];
  az = g_tubeA[tube][2];
  bx = g_tubeB[tube][0];
  by = g_tubeB[tube][1];
  bz = g_tubeB[tube][2];
  return true;
}

static int fillLedPositionsForOneStripU(IVec3S16* out, int outCount,
                                        const LedSegmentF* segs, int numSegs) {
  if (!out || outCount <= 0 || !segs || numSegs <= 0) return 0;

  // ------------------------------------------------------------
  // 1) Decide how many LEDs per segment (sum must equal outCount)
  //    We treat segs[s].count as weights, but rescale to outCount.
  // ------------------------------------------------------------
  int32_t wsum = 0;
  for (int s = 0; s < numSegs; s++) {
    int w = segs[s].count;
    if (w < 0) w = 0;
    wsum += w;
  }

  // If counts are useless, fall back to equal distribution.
  if (wsum <= 0) wsum = numSegs;

  int assigned = 0;

  for (int s = 0; s < numSegs; s++) {
    // compute c, but ensure total ends exactly at outCount
    int w = segs[s].count;
    if (w < 0) w = 0;
    if (wsum == numSegs) w = 1;  // equal fallback case

    // rounded proportional assignment
    int c = (int)((int64_t)outCount * (int64_t)w + (wsum / 2)) / wsum;
    if (c < 0) c = 0;

    // ensure we don't over-assign
    if (assigned + c > outCount) c = outCount - assigned;

    // if we have remaining LEDs but rounding gave 0, give at least 1
    // (unless we're already full)
    if (c == 0 && assigned < outCount && w > 0) c = 1;
    if (assigned + c > outCount) c = outCount - assigned;

    // last segment: force exact fill
    if (s == numSegs - 1) c = outCount - assigned;

    if (c <= 0) continue;

    // ------------------------------------------------------------
    // 2) Normalize direction and sample points
    //    Midpoint sampling avoids duplicate pixels at seams.
    // ------------------------------------------------------------
    float dl = fLen3(segs[s].dx, segs[s].dy, segs[s].dz);
    float ndx = (dl > 1e-6f) ? (segs[s].dx / dl) : 1.0f;
    float ndy = (dl > 1e-6f) ? (segs[s].dy / dl) : 0.0f;
    float ndz = (dl > 1e-6f) ? (segs[s].dz / dl) : 0.0f;

    const float invC = 1.0f / (float)c;

    for (int i = 0; i < c && assigned < outCount; i++) {
      // midpoint in [0..1]
      float t = ((float)i + 0.5f) * invC;

      // (optional) tiny clamp for paranoia
      if (t < 0.0f) t = 0.0f;
      if (t > 1.0f) t = 1.0f;

      float dist = t * segs[s].len;

      float px = segs[s].x + ndx * dist;
      float py = segs[s].y + ndy * dist;
      float pz = segs[s].z + ndz * dist;

      out[assigned++] = { cmToU_s16(px), cmToU_s16(py), cmToU_s16(pz) };
    }
  }

  // ------------------------------------------------------------
  // 3) Safety fill (should not happen, but keep it)
  // ------------------------------------------------------------
  if (assigned < outCount) {
    IVec3S16 last = (assigned > 0) ? out[assigned - 1] : IVec3S16{ 0, 0, 0 };
    for (int i = assigned; i < outCount; i++) out[i] = last;
    assigned = outCount;
  }

  return outCount;
}




/*
static int fillLedPositionsForOneStripU(IVec3S16* out, int outCount,
                                        const LedSegmentF* segs, int numSegs) {
  int n = 0;
  for (int s = 0; s < numSegs && n < outCount; s++) {
    int c = segs[s].count;
    if (c <= 0) continue;



    float dl = fLen3(segs[s].dx, segs[s].dy, segs[s].dz);
    float ndx = (dl > 1e-6f) ? (segs[s].dx / dl) : 1.0f;
    float ndy = (dl > 1e-6f) ? (segs[s].dy / dl) : 0.0f;
    float ndz = (dl > 1e-6f) ? (segs[s].dz / dl) : 0.0f;
// dead pixel fix
    //float invDen = (c > 1) ? (1.0f / (float)(c - 1)) : 0.0f;
    float invDen = 1.0f / (float)c;  

    for (int i = 0; i < c && n < outCount; i++) {
      float t = ((float)i + 0.5f) * invDen; 
      //float t = (c > 1) ? ((float)i * invDen) : 0.0f;
      float dist = t * segs[s].len;

      float px = segs[s].x + ndx * dist;
      float py = segs[s].y + ndy * dist;
      float pz = segs[s].z + ndz * dist;

      out[n++] = { cmToU_s16(px), cmToU_s16(py), cmToU_s16(pz) };
    }
  }

  if (n > 0) {
    IVec3S16 last = out[n - 1];
    for (int i = n; i < outCount; i++) out[i] = last;
  } else {
    for (int i = 0; i < outCount; i++) out[i] = { 0, 0, 0 };
  }

  return n;
}*/

static inline float fDot3(float ax, float ay, float az, float bx, float by, float bz) {
  return ax * bx + ay * by + az * bz;
}
static inline void fCross3(float ax, float ay, float az, float bx, float by, float bz,
                           float& rx, float& ry, float& rz) {
  rx = ay * bz - az * by;
  ry = az * bx - ax * bz;
  rz = ax * by - ay * bx;
}
static inline void fNorm3(float& x, float& y, float& z) {
  float l = sqrtf(x * x + y * y + z * z);
  if (l < 1e-6f) {
    x = 1;
    y = 0;
    z = 0;
    return;
  }
  float inv = 1.0f / l;
  x *= inv;
  y *= inv;
  z *= inv;
}
static inline void pickBottomTop(
  float ax, float ay, float az,
  float bx, float by, float bz,
  float& ox, float& oy, float& oz,
  float& tx, float& ty, float& tz) {
  bool aIsBottom;
  if (ay < by) aIsBottom = true;
  else if (ay > by) aIsBottom = false;
  else if (az < bz) aIsBottom = true;
  else if (az > bz) aIsBottom = false;
  else aIsBottom = (ax < bx);

  if (aIsBottom) {
    ox = ax;
    oy = ay;
    oz = az;
    tx = bx;
    ty = by;
    tz = bz;
  } else {
    ox = bx;
    oy = by;
    oz = bz;
    tx = ax;
    ty = ay;
    tz = az;
  }
}
// ------------------------------------------------------------
// initAllLedPositionsU
// Writes into g_ledPosU, assumed allocated as IVec3S16[TOTAL_LEDS].
// ------------------------------------------------------------

static void initAllLedPositionsU() {
  if (!g_ledPosU) return;

  // reinterpret g_ledPosU memory as int16 positions
  IVec3S16* pos16 = (IVec3S16*)g_ledPosU;

  const int SEG_LEDS = NUM_LEDS_PER_STRIP / NUMSECTIONS_PR_TUBE;

  const float SIDE = 1.5f;
  const float FACE_OFF = SIDE * 0.5f * 0.98f;

  const float PYRAMID_EDGE_CM = 190.0f;
  const float TUBE_LEN_CM = 155.5f;

  const float EDGE_LEN = PYRAMID_EDGE_CM;
  const float TUBE_LEN = TUBE_LEN_CM;

  float EDGE_PAD = 0.5f * (EDGE_LEN - TUBE_LEN);
  Serial.printf("EDGE_PAD=%.2fcm\n", EDGE_PAD);
  if (EDGE_PAD < 0.0f) EDGE_PAD = 0.0f;

  float Ax = 0.0f, Ay = 0.0f, Az = 0.0f;
  float Bx = EDGE_LEN, By = 0.0f, Bz = 0.0f;
  float Cx = 0.5f * EDGE_LEN, Cy = 0.0f, Cz = (sqrtf(3.0f) * 0.5f) * EDGE_LEN;
  float Dx = 0.5f * EDGE_LEN, Dy = sqrtf(2.0f / 3.0f) * EDGE_LEN, Dz = (sqrtf(3.0f) / 6.0f) * EDGE_LEN;

  float cx = (Ax + Bx + Cx + Dx) * 0.25f;
  float cy = (Ay + By + Cy + Dy) * 0.25f;
  float cz = (Az + Bz + Cz + Dz) * 0.25f;

  Ax -= cx;
  Ay -= cy;
  Az -= cz;
  Bx -= cx;
  By -= cy;
  Bz -= cz;
  Cx -= cx;
  Cy -= cy;
  Cz -= cz;
  Dx -= cx;
  Dy -= cy;
  Dz -= cz;

  const float PCx = 0.0f, PCy = 0.0f, PCz = 0.0f;

  struct EdgeF {
    float ax, ay, az, bx, by, bz;
  };
  EdgeF edges[6] = {
    { Ax, Ay, Az, Bx, By, Bz },
    { Bx, By, Bz, Cx, Cy, Cz },
    { Cx, Cy, Cz, Ax, Ay, Az },
    { Ax, Ay, Az, Dx, Dy, Dz },
    { Bx, By, Bz, Dx, Dy, Dz },
    { Cx, Cy, Cz, Dx, Dy, Dz },
  };

  int tubes = NUM_STRIPS;
  if (tubes > 6) tubes = 6;

  for (int s = 0; s < tubes; s++) {
    float ox, oy, oz, tx, ty, tz;
    pickBottomTop(edges[s].ax, edges[s].ay, edges[s].az,
                  edges[s].bx, edges[s].by, edges[s].bz,
                  ox, oy, oz, tx, ty, tz);


// pusher street reflector one tube 4 flip // fablab 2 flip

    if (s == 4 ) { float tmp;
      tmp=ox; ox=tx; tx=tmp;
      tmp=oy; oy=ty; ty=tmp;
      tmp=oz; oz=tz; tz=tmp;
    }

    float ux = tx - ox, uy = ty - oy, uz = tz - oz;
    fNorm3(ux, uy, uz);

    float sx = ox + ux * EDGE_PAD;
    float sy = oy + uy * EDGE_PAD;
    float sz = oz + uz * EDGE_PAD;



    float mx = sx + ux * (0.5f * TUBE_LEN);
    float my = sy + uy * (0.5f * TUBE_LEN);
    float mz = sz + uz * (0.5f * TUBE_LEN);

    float ix = PCx - mx, iy = PCy - my, iz = PCz - mz;

    float idotu = fDot3(ix, iy, iz, ux, uy, uz);
    float vx = ix - ux * idotu;
    float vy = iy - uy * idotu;
    float vz = iz - uz * idotu;
    fNorm3(vx, vy, vz);

    float wx, wy, wz;
    fCross3(ux, uy, uz, vx, vy, vz, wx, wy, wz);
    fNorm3(wx, wy, wz);

    const float invS = 0.70710678f;

    float o0x = (vx + wx) * invS, o0y = (vy + wy) * invS, o0z = (vz + wz) * invS;
    float o1x = (vx - wx) * invS, o1y = (vy - wy) * invS, o1z = (vz - wz) * invS;
    float o2x = (-vx + wx) * invS, o2y = (-vy + wy) * invS, o2z = (-vz + wz) * invS;
    float o3x = (-vx - wx) * invS, o3y = (-vy - wy) * invS, o3z = (-vz - wz) * invS;

    float ex = sx + ux * TUBE_LEN;
    float ey = sy + uy * TUBE_LEN;
    float ez = sz + uz * TUBE_LEN;
    g_tubeA_cm[s][0] = sx;
    g_tubeA_cm[s][1] = sy;
    g_tubeA_cm[s][2] = sz;
    g_tubeB_cm[s][0] = ex;
    g_tubeB_cm[s][1] = ey;
    g_tubeB_cm[s][2] = ez;
    g_tubeAB_valid = 1;

    g_tubeA[s][0] = sx;
    g_tubeA[s][1] = sy;
    g_tubeA[s][2] = sz;
    g_tubeB[s][0] = ex;
    g_tubeB[s][1] = ey;
    g_tubeB[s][2] = ez;

    LedSegmentF segs[NUMSECTIONS_PR_TUBE] = {
      { sx + o0x * FACE_OFF, sy + o0y * FACE_OFF, sz + o0z * FACE_OFF, +ux, +uy, +uz, TUBE_LEN, SEG_LEDS },
      { ex + o1x * FACE_OFF, ey + o1y * FACE_OFF, ez + o1z * FACE_OFF, -ux, -uy, -uz, TUBE_LEN, SEG_LEDS },
      { sx + o2x * FACE_OFF, sy + o2y * FACE_OFF, sz + o2z * FACE_OFF, +ux, +uy, +uz, TUBE_LEN, SEG_LEDS },
      { ex + o3x * FACE_OFF, ey + o3y * FACE_OFF, ez + o3z * FACE_OFF, -ux, -uy, -uz, TUBE_LEN, SEG_LEDS },
    };

    IVec3S16* base = pos16 + (s * NUM_LEDS_PER_STRIP);
    int wrote = fillLedPositionsForOneStripU(base, NUM_LEDS_PER_STRIP, segs, 4);
    if (wrote != NUM_LEDS_PER_STRIP) {
      Serial.printf("WARN: strip %d wrote=%d expected=%d\n", s, wrote, NUM_LEDS_PER_STRIP);
    }
  }

  for (int s = tubes; s < NUM_STRIPS; s++) {
    IVec3S16* base = pos16 + (s * NUM_LEDS_PER_STRIP);
    for (int i = 0; i < NUM_LEDS_PER_STRIP; i++) base[i] = { 0, 0, 0 };
  }
  sdfComputeTubeBoundsFromLedPos();
}
