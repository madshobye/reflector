# Wrench Installation Primer (ESP32‑S3 / NeoPXL8)

This document collects the primary information an LLM needs to generate Wrench code for this installation. It covers geometry, capabilities, and Wrench syntax constraints that matter for reliable runtime behavior.

## 1) System Summary
- MCU: ESP32‑S3
- LED output: Adafruit NeoPXL8 (8‑lane driver), using **6 output lanes**
- Render model: 2‑buffer; Wrench renders into `g_renderBuf` (Core 1), Core 0 copies to front buffer and pushes to NeoPXL8
- Wrench runs on Core 1, LED push task runs on Core 0

## 2) Physical Geometry
- Sculpture: tetrahedral pyramid built from **6 LED tubes** (2 meters each)
- Each tube corresponds to an **edge** of the tetrahedron
- Base edges: tubes **0,1,2**
- Apex edges: tubes **3,4,5** (from base corners to apex)

### Edge ordering (important for choreography)
Use this edge mapping consistently when reasoning about motion, symmetry, and clockwise / counterclockwise travel:
- Tube `0` = base edge **A → B**
- Tube `1` = base edge **B → C**
- Tube `2` = base edge **C → A**
- Tube `3` = apex edge **A → D**
- Tube `4` = apex edge **B → D**
- Tube `5` = apex edge **C → D**

Where:
- `A = (-95.0, -38.784, -54.848)`
- `B = (95.0, -38.784, -54.848)`
- `C = (0.0, -38.784, 109.697)`
- `D = apex = (0.0, 116.351, 0.0)`

For base-triangle motion, `0 → 1 → 2` follows the triangle cycle `A→B→C→A`. If you want clockwise or counterclockwise movement, reason from these vertex connections rather than from a camera view or screen layout.

## 3) LED Topology
- `NUM_STRIPS = 6` (**tubes**, one addressable hardware lane per tube)
- Each tube contains **4 physical sections/faces** (square tube, 360-degree output)
- `NUMSECTIONS_PR_TUBE = 4`
- Each tube is addressed by a **tube index** (`0..5`)
- LEDs are contiguous per tube: `tubeIndex * (STRIP_LEN * STRIPS_PER_TUBE) + localTubePixel`
- Per-tube pixel count: **892** (4 strips × 223 pixels)
- Physical routing: zig-zag / snake pattern along the tube

### Terminology used in this document
- **tube** = one of the 6 tetrahedron edges; this is the main spatial unit for programming
- **section** = one of the 4 physical LED runs around a square tube
- **hardware lane** = one NeoPXL8 output driving one full tube
- **strip** in firmware constants usually means a hardware lane / tube, while `STRIP_LEN` means one section length

When writing Wrench, think primarily in **tube indices** (`0..5`) and only drop down to absolute LED indices when needed.

### Wrench constants
These are injected into Wrench automatically:
- `STRIPS` = number of hardware lanes / tubes (`6`)
- `TUBES` = same as `STRIPS`
- `STRIPS_PER_TUBE` = `4`
- `SDF_STRIP_BITS` = `STRIPS * STRIPS_PER_TUBE`
- `STRIP_LEN` = LEDs per physical section (`223`)
- `TOTAL_LEDS` = total LEDs
- `SDF_SPHERE = 0`, `SDF_BOX = 1`
- `SDF_UNITS = "cm"`
- `SDF_STEP_MM = 0.25`

## 4) Geometry & Coordinate System
- SDF coordinates are **in centimeters**.
- LED positions for each tube are mapped into 3D space with a tetrahedron‑like structure.
- Each tube has two endpoints in cm; Wrench can query these.
### Safe volume (cm)
- `x,z ≈ -90..+90`
- `y ≈ -60..+90`

### Pixel index ranges per tube (strip-major)
- Tube 0: `0–891`
- Tube 1: `892–1783`
- Tube 2: `1784–2675`
- Tube 3: `2676–3567`
- Tube 4: `3568–4459`
- Tube 5: `4460–5351`

Within each tube, pixel `0` is one physical end and pixel `891` is the other end (usually “bottom → top”).

### Practical indexing reminder
- `STRIP_LEN` is **per physical section**, not per whole tube
- One full tube contains `STRIP_LEN * STRIPS_PER_TUBE = 223 * 4 = 892` pixels
- Absolute pixel writes should therefore use:
  - `tubeIndex * (STRIP_LEN * STRIPS_PER_TUBE) + localTubePixel`
  - not `tubeIndex * STRIP_LEN + ...`

### Tube endpoints API
- `tube_endpoints(tubeIndex)` → string: `"ax ay az bx by bz"`
- `tube_endpoints(tubeIndex, 1)` → `{ a: Vec3, b: Vec3 }` (container, reused)
- `tube_xyz(tubeIndex, t01)` → string: `"x y z"`
- `tube_xyz(tubeIndex, t01, 1)` → `Vec3` (container, reused)
- `tube_lerp(tubeIndex, t01, which)` → float (`which: 0=x,1=y,2=z`)
- `tube_endpoints3(tubeIndex)` → `{ a: Vec3, b: Vec3 }` (container, reused)
- `tube_xyz3(tubeIndex, t01)` → `Vec3` (container, reused)
- `tube_xyz_out(tubeIndex, t01, outVec3)` → writes into `outVec3`, returns 1/0 (no allocations)
- `tube_endpoints_out(tubeIndex, outA, outB)` → writes into `outA/outB`, returns 1/0 (no allocations)

### Container lifetime warning
The following return **reused containers** and should not be stored across frames:
- `tube_xyz3(...)`
- `tube_endpoints3(...)`
- `lerp3(...)`
- `lerp_color(...)`

If you need persistence across frames or loops, use:
- `tube_xyz_out(...)`
- `tube_endpoints_out(...)`
- your own `Vec3` / `Color` containers

### Reference coordinates (current firmware geometry)
These are derived from the current constants in `ledPositions.ino` (`PYRAMID_EDGE_CM=190`, `TUBE_LEN_CM=155.5`, `EDGE_PAD=17.25`), centered at origin. If geometry changes, recompute via `tube_endpoints3()`.

Key points (cm):
- Center: `(0.0, 0.0, 0.0)`
- Base center: `(0.0, -38.784, 0.0)`
- Apex: `(0.0, 116.351, 0.0)`

Base corners (cm):
- A: `(-95.0, -38.784, -54.848)`
- B: `(95.0, -38.784, -54.848)`
- C: `(0.0, -38.784, 109.697)`

Tube midpoints (cm):
- Tube 0: `(0.0, -38.784, -54.848)`
- Tube 1: `(47.5, -38.784, 27.424)`
- Tube 2: `(-47.5, -38.784, 27.424)`
- Tube 3: `(-47.5, 38.784, -27.425)`
- Tube 4: `(47.5, 38.784, -27.425)`
- Tube 5: `(0.0, 38.784, 54.848)`

Tube endpoints (cm, trimmed by EDGE_PAD):
- Tube 0: `(-77.75, -38.784, -54.848) → (77.75, -38.784, -54.848)`
- Tube 1: `(86.375, -38.784, -39.909) → (8.625, -38.784, 94.758)`
- Tube 2: `(-8.625, -38.784, 94.758) → (-86.375, -38.784, -39.909)`
- Tube 3: `(-86.375, -24.699, -49.869) → (-8.625, 102.266, -4.980)`
- Tube 4: `(8.625, 102.266, -4.980) → (86.375, -24.699, -49.869)` (flipped in firmware)
- Tube 5: `(0.0, -24.699, 99.737) → (0.0, 102.266, 9.959)`

Distances:
- Center to any vertex ≈ `116.351 cm`
- Center to base plane ≈ `38.784 cm`

## 5) Core Wrench Syntax (important constraints)
Wrench is not full JavaScript. Key constraints:
- No nested functions
- No ternary operator
- No range syntax (`a..b`)
- Variables must be declared before use in a function
- No `%` operator; use manual modulo/triangle logic instead
- Declare all `var` at the top of a function before any statements
- Do not combine `var` declaration with `millis()` (or other calls) on the same line. Use two lines:
  - `var ms;`
  - `ms = millis();`
- Avoid `for` loops; prefer `while`
- Arrays are dynamic but slow; initialize in `setup()`
- Avoid heavy math in tight loops
- No multiple `var` declarations on the same line; use one per line
- Keep lines < ~200 chars

### Authoritative API rule
Only use the bindings documented in this file (and the examples that directly follow from them). Do **not** invent convenience helpers that are common in other LED environments.

Examples of functions that should **not** be assumed unless explicitly documented for this firmware:
- `leds_fade_to_black(...)`
- `leds_add_solid(...)`
- undocumented FastLED helpers
- undocumented simulator-only helpers

### Structs and dot access
Wrench supports `struct` and `new` with dot access for members:
```js
struct S
{
  var member1;
  var member2;
};

var s = new S();
s.member1 = 20;
s.member2 = 50 + s.member1;
```

Hash tables also support dot access for string keys:
```js
var h = { "r": 255, "g": 0, "b": 0 };
print(h.r);
```

There is no `create_Vec3()` binding. To make a Vec3, use `new Vec3()` or `{}`.

Bindings that return “structs” (like `create_Sphere()` or `time_get()`) currently return hash containers from C. They behave like structs in Wrench (dot access), and are stable across firmware builds.

### Global scope operator
Force global scope with `::`:
```js
var g = 20;
function foo() {
  ::g = 30;
}
```

### Minimal Wrench skeleton
```js
var t0 = 0;

function setup() {
  leds_begin();
  leds_set_brightness(255);
  t0 = millis();
}

function tick() {
  var now = millis();
  var t = (now - t0) * 0.001;
  // ... draw ...
  leds_show();
}
```

### Generation guidance
- Prefer documented scalar APIs in hot paths:
  - `sdf_set_sphere(i, x,y,z, r, h,s,v, alpha, bias)`
  - `sdf_set_box(i, x,y,z, w,h,d, h,s,v, alpha, bias, power)`
  - `leds_set_pixel(pos, r,g,b)`
- Use `tube_lerp(...)` / `tube_xyz_out(...)` when anchoring motion to tube geometry.
- Use the explicit edge mapping from Section 2 when referring to “clockwise”, “counterclockwise”, “left”, or “right”; do not rely on camera orientation or a mirrored preview.
- Keep scenes inside the safe volume unless there is a strong reason not to.
- Prefer SDF-driven scenes over heavy per-pixel loops.
- If using `sdf_set_palette(...)`, always define that palette first with `sdf_palette_*`.
- If using `sdf_palette_hsv3(...)`, provide the full argument list.

### Vector lerp helper
```js
var a = tube_xyz3(0, 0.0);
var b = tube_xyz3(0, 1.0);
var p = lerp3(a, b, 0.5);
// p.x, p.y, p.z
```
Note: `lerp3()` returns a reused container; don’t store it across frames.

### Color lerp helper
```js
var c0 = create_Color();
var c1 = create_Color();
c0.r = 255; c0.g = 0; c0.b = 0;
c1.r = 0; c1.g = 0; c1.b = 255;
var c = lerp_color(c0, c1, 0.5);
// c.r, c.g, c.b
```
Note: `lerp_color()` returns a reused container; don’t store it across frames.

On every new Wrench program load, the firmware clears the SDF shape list and render buffer to avoid “stuck” shapes from previous sketches.

## 6) LED API (Wrench)
- `leds_begin()` → 1/0
- `leds_total()` → total LEDs
- `leds_strip_count()` → number of tubes / hardware lanes
- `leds_strip_len()` → LEDs per physical section (`223`)
- `leds_clear()`
- `leds_set_brightness(b)`
- `leds_get_brightness()`
- `leds_set_pixel(pos, r,g,b)` OR `leds_set_pixel(strip, idx, r,g,b)`
- `leds_set_pixel(pos, Color)` OR `leds_set_pixel(strip, idx, Color)` (struct/Container overload)
- `leds_set_pixel_c(pos, Color)` OR `leds_set_pixel_c(strip, idx, Color)` (wrapper)
- `create_Color()` → Color container (`r,g,b`)
- `leds_get_pixel_c(pos)` → Color container (`r,g,b`)
- `leds_show()` (optional manual push; frames are auto‑submitted after each `tick()`)

Do not assume additional LED helpers exist beyond the list above.

## 7) SDF API (Wrench)
SDF rendering draws into the render buffer. This is the primary way to create volumetric effects.

### SDF shape setup
- `sdf_set_count(n)`
- `sdf_get_count()`
- `sdf_set_sphere(i, x,y,z, r, hue,sat,val, alpha, bias)`
- `sdf_set_sphere(Sphere)` (struct/Container overload)
- `create_Sphere()` → Sphere container with assigned `idx`
- `sdf_update_sphere(Sphere)` (accepts container)
- `sdf_set_box(i, x,y,z, w,h,d, hue,sat,val, alpha, bias, power)`
- `sdf_set_box(Box)` (struct/Container overload)
- `create_Box()` → Box container with assigned `idx`
- `sdf_update_box(Box)` (accepts container)
- `sdf_set_shape(i, type, x,y,z, a,b,c, hue,sat,val, alpha, bias, power)`

### SDF render
- `sdf_render()` renders all shapes to all tubes.

### SDF palette helpers
- `sdf_set_palette(i, palId, mix, scroll, bright, blend)`
- `sdf_palette_rgb3(...)`, `sdf_palette_hsv3(...)`
- `sdf_palette_rgbN_cur(...)`, `sdf_palette_hsvN_cur(...)`

Important: `sdf_set_palette(...)` only selects a palette. You must define the palette first with `sdf_palette_*` or the shape will render black.
Important: `sdf_palette_hsv3(...)` requires full arguments (3 HSV colors + mix + scroll + bright + blend + mid). If you pass too few values, the palette won't be created.

## 8) Palette & Texture Behavior (current)
- **Palette is radial**: for spheres, palette index follows distance from center to surface (center maps to palette start).
- **Texture modulates** intensity OR palette brightness OR palette mix OR base color.
- Texture strength (`0..1`, internally scaled) controls how subtle or strong the effect is.

### Texture config
`mode` in `sdf_set_material(i, texId, cell_cm, strength, seed, mode)`:
- Lower 2 bits (0..3): plane
  - `0=XY`, `1=XZ`, `2=YZ`, `3=RADIAL`
- Upper bits: affect target
  - `0=intensity`
  - `1=palette brightness`
  - `2=palette mix`
  - `3=base color`
- Bit 4 (`1<<4`): **local space** (texture moves with the shape)

### Built-in palette IDs (FastLED)
These are the firmware defaults in `sdf.ino`:
- `0` = `RainbowColors_p`
- `1` = `LavaColors_p`
- `2` = `OceanColors_p`
- `3` = `ForestColors_p`
- `4` = `PartyColors_p`
- `5` = `HeatColors_p`
- `6` = `GoldenDecay_p`

### Texture IDs
- `0` = `TEX_XOR_CHECKER`
- `1` = `TEX_XOR_DIAG_STRIPES`
- `2` = `TEX_XOR_MOIRE`
- `3` = `TEX_XOR_CROSSHATCH`
- `4` = `TEX_XOR_HASH_NOISE`
- `5` = `TEX_XOR_BITPLANE`
- `6` = `TEX_PARITY_LATTICE`
- `7` = `TEX_CELL_RINGS_LINF`
- `8` = `TEX_MANHATTAN_XOR`
- `9` = `TEX_TEMPORAL_XOR`

Example:
```js
// RADIAL texture modulates palette brightness
var mode = 3 | (1 << 2);
sdf_set_material(0, 0, 6.0, 0.5, 123, mode);
```

## 9) Time API (Wrench)
Firmware syncs time via NTP. Default timezone: Copenhagen.

- `time_get()` → Time container (`valid, epoch, ymd, h, m, s, seconds`)
- `time_is_valid()` → 1/0
- `time_now()` → epoch seconds
- `time_local_seconds()` → seconds since local midnight
- `time_local_hour()` / `time_local_minute()` / `time_local_second()`
- `time_local_ymd()` → YYYYMMDD
- `time_set_timezone("TZ")`
- `time_sync()`

## 10) Noise API (Wrench)
- `noise_seed(seed)`
- `simplex3(x,y,z)` → ~[-1..1]
- `simplex3_01(x,y,z)` → ~[0..1]

## 11) Messaging / I/O
- `print(...)`, `println(...)` emit JSON events
- `inbox_has()` / `inbox_get()` for messages

## 12) Containers & Arrays (built-in libs)
Use with care in `tick()`; they allocate.

Arrays:
```js
array::clear(a, [size])
array::count(a)
array::insert(a, where, [count])
array::remove(a, where, [count])
array::truncate(a, size)
```

Hash tables:
```js
hash::clear(h)
hash::count(h)
hash::add(h, item, key)
hash::remove(h, key)
hash::exists(h, key)
```

## 13) Performance Guidance
- Keep `tick()` fast and bounded
- Prefer incremental updates over clearing every frame
- Avoid heavy per‑pixel loops when SDF can do the work
- Minimize heap allocations in Wrench (especially in `tick()`)

## 13.2) Design Strategy Ideas
When generating concepts for this sculpture, these approaches tend to work well:
- **Whole-volume atmosphere**: fill the tetrahedron with a few large SDF shapes so the whole object reads as one field or mood.
- **Edge-anchored structure**: use tube midpoints, base edges, or apex edges so the tetrahedral form stays legible.
- **Base-to-apex narrative**: let forms rise from the base triangle toward the apex to express emergence, escalation, warning, prayer, or pressure.
- **Apex icon**: place a symbolic focal form near the apex (eye, beacon, siren, halo, scanner, crown, flame).
- **Base pressure zone**: keep haze or density near the base center or along the base triangle to suggest burden, crowding, sediment, oil, fog, or memory.
- **Flag / tricolor mode**: turn the whole sculpture into a symbolic color field using strong vertical or horizontal divisions.
- **Warning-sign language**: use scan bars, hazard slices, alert pulses, red/amber intrusions, or harsh textures.
- **Weather / material motion**: snow, ash, smoke, sparks, rain, fog, dripping oil, rising steam.
- **Swarm / orbit**: many spheres drifting with simplex noise around the volume or along tubes.
- **Architectural reading**: columns, slabs, towers, cathedral/spire logic, brutalist blocks, monument silhouettes.
- **Order vs noise**: combine precise boxes/planes with drifting organic spheres to create tension between system and chaos.
- **Palette as meaning**: let custom palettes carry the concept (oil-black to gold, toxic green to cyan, siren red to amber, blue to pearl).
- **Texture as meaning**: crosshatch, moire, checker, rings, diagonal stripes can imply print, stained glass, barcode, circuitry, or interference.
- **Surface + core layering**: combine a large ambient field, a symbolic core, and smaller moving accents so the scene has hierarchy.
- **Time-evolving scene**: use 1 / 5 / 10 / 30 minute evolution to slowly shift scale, speed, density, and emotional intensity.

## 13.1) Visibility Tips (SDF)
- The sculpture volume is large. Small SDF shapes can appear “invisible.”
- Use **large radii/sizes** for first tests (spheres `120–180 cm`, boxes `150–250 cm` in width/height).
- Use **higher alpha** (≈ `0.8–1.6`) and moderate bias (≈ `0.45–0.65`) to make shapes clearly visible.
- If nothing shows, it’s often just **scale/alpha**, not a firmware issue.

### Scalar vs Struct APIs (performance note)
Scalar APIs take plain numbers instead of structs/objects. Examples:
- `sdf_set_sphere(i, x,y,z, r, h,s,v, alpha, bias)`
- `sdf_set_box(i, x,y,z, w,h,d, h,s,v, alpha, bias, power)`
- `leds_set_pixel(pos, r,g,b)` or `leds_set_pixel(strip, idx, r,g,b)`
- `lerp(a, b, t)`

These are faster because they avoid struct field lookups. Use them in tight loops or performance‑critical code. Struct APIs are nicer to read but slightly slower.

## 14) Required Program Structure
Return a complete Wrench program with:
- global state vars
- `function setup()`
- `function tick()`

## 15) Example SDF Scene
```js
var t0 = 0;

function setup(){
  leds_begin();
  leds_set_brightness(255);
  sdf_set_count(2);
  t0 = millis();
}

function tick(){
  var t = (millis() - t0) * 0.001;

  sdf_set_sphere(0, math::sin(t)*10.0, 0, 0, 6.0, 0,255,255, 1.0, 0.5);
  sdf_set_box(1, 0, 0, 0, 8,8,8, 160,255,200, 0.8, 0.5, 4);

  // palette on shape 0
  sdf_set_palette(0, 0, 255, 0, 255, 1);

  // texture: radial, modulate palette brightness
  var mode = 3 | (1<<2);
  sdf_set_material(0, 0, 6.0, 0.5, 123, mode);

  sdf_render();
  leds_show();
}
```
