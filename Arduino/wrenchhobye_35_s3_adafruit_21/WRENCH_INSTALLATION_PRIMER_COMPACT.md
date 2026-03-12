# Wrench Installation Primer (Compact)

This is the short, safe version of the installation spec for generating reliable Wrench code.
Use it as a strict programming guide. When in doubt, choose the simpler option.

## 1) What You Are Programming
- The sculpture is a tetrahedral pyramid with 6 LED tubes
- Tubes 0,1,2 form the base triangle
- Tubes 3,4,5 run from the base corners to the apex
- Think in tube indices first, not absolute LED indices

The safest mental model is:
- program a 3D tetrahedron
- addressed through 6 tube edges
- rendered mainly with SDF spheres and boxes

Small example:
```wrench
// one sphere in the middle of the tetrahedron
sdf_set_sphere(0, 0.0, 0.0, 0.0, 60.0, 32, 255, 255, 0.9, 0.6);
```

## 2) Core Geometry
- Coordinates are in centimeters
- Safe volume:
  - x,z ≈ -90..+90
  - y ≈ -60..+90
- Key points:
  - Center: `(0.0, 0.0, 0.0)`
  - Base center: `(0.0, -38.784, 0.0)`
  - Apex: `(0.0, 116.351, 0.0)`
- Base corners:
  - A = (-95.0, -38.784, -54.848)
  - B = (95.0, -38.784, -54.848)
  - C = (0.0, -38.784, 109.697)
- Tube midpoints:
  - Tube 0: (0.0, -38.784, -54.848)
  - Tube 1: (47.5, -38.784, 27.424)
  - Tube 2: (-47.5, -38.784, 27.424)
  - Tube 3: (-47.5, 38.784, -27.425)
  - Tube 4: (47.5, 38.784, -27.425)
  - Tube 5: (0.0, 38.784, 54.848)

Use these coordinates when you need stable anchors for symbols, swarms, or structural forms.

Small example:
```wrench
// anchor a sphere at the base center
sdf_set_sphere(0, 0.0, -38.784, 0.0, 50.0, 160, 220, 255, 0.8, 0.6);
```

## 3) Tube Ordering
Use this mapping consistently:
- Tube 0 = A → B
- Tube 1 = B → C
- Tube 2 = C → A
- Tube 3 = A → D
- Tube 4 = B → D
- Tube 5 = C → D

For movement around the base, 0 → 1 → 2 follows the triangle cycle.

Small example:
```wrench
// move along apex edge A -> D
var x = tube_lerp(3, 0.5, 0);
var y = tube_lerp(3, 0.5, 1);
var z = tube_lerp(3, 0.5, 2);
```

## 4) LED Topology
- TUBES = 6
- STRIPS_PER_TUBE = 4
- STRIP_LEN = 223
- One full tube contains 223 * 4 = 892 pixels
- TOTAL_LEDS = 5352
- Each tube is physically built from 4 LED sections / faces
- The LEDs on each tube are routed in a zig-zag / snake pattern
- In firmware addressing, the sculpture is treated as one continuous absolute LED space from 0 to 5351
- Tubes are laid out contiguously in that absolute index space:
  - Tube 0 = 0..891
  - Tube 1 = 892..1783
  - Tube 2 = 1784..2675
  - Tube 3 = 2676..3567
  - Tube 4 = 3568..4459
  - Tube 5 = 4460..5351

Absolute LED index for one tube:
```wrench
tubeIndex * (STRIP_LEN * STRIPS_PER_TUBE) + localTubePixel
```

Small example:
```wrench
// first pixel of tube 2
leds_set_pixel(2 * (STRIP_LEN * STRIPS_PER_TUBE), 255, 0, 0);
```

Important:
- tubeIndex is always 0..5
- localTubePixel is always 0..891
- STRIP_LEN is not a whole tube length
- leds_strip_len() returns 223, not 892
- Although the whole sculpture can be addressed as one long absolute LED strip, spatial reasoning should still be done in tube coordinates whenever possible

## 5) Safe Wrench Rules
- No nested functions
- No ternary operator
- No `%` operator
- Prefer while loops over for
- Declare all var at the top of a function
- Use one `var` declaration per line
- Keep `tick()` fast
- Avoid heavy per-pixel loops unless necessary
- Prefer SDF shapes over raw LED loops

Additional safe rules:
- Keep lines short and simple
- Prefer a few clear shapes over many tiny shapes
- Do not rely on undocumented bindings
- Do not invent utility functions from other languages or LED libraries
- If a shape is invisible, first make it larger and brighter before changing the whole idea

Use this pattern:
```wrench
var t0;

function setup() {
  leds_begin();
  leds_set_brightness(255);
  t0 = millis();
}

function tick() {
  var ms;
  var t;

  ms = millis();
  t = (ms - t0) * 0.001;
}
```

Small example:
```wrench
// good: declare first, assign after
var ms;
ms = millis();
```

## 6) Common Signatures (Safe Subset)

Use these exact call shapes.

### LED
```wrench
leds_begin()
leds_total()
leds_strip_count()
leds_strip_len()
leds_clear()
leds_set_brightness(b)
leds_get_brightness()
leds_set_pixel(pos, r, g, b)
leds_set_pixel(strip, idx, r, g, b)
leds_show()
create_Color()
leds_get_pixel_c(pos)
```

Notes:
- pos is an absolute LED index 0..5351
- strip means tube index 0..5
- idx in leds_set_pixel(strip, idx, ...) is per section index, not whole tube index
- for whole-tube addressing, absolute indexing is usually clearer

Small example:
```wrench
leds_set_pixel(0, 255, 0, 0);
leds_set_pixel(1000, 0, 0, 255);
```

### Geometry
```wrench
tube_lerp(tubeIndex, t01, which)
tube_xyz_out(tubeIndex, t01, outVec3)
tube_endpoints_out(tubeIndex, outA, outB)
tube_xyz3(tubeIndex, t01)
tube_endpoints3(tubeIndex)
```

Notes:
- tubeIndex is 0..5
- t01 is 0.0..1.0
- which is 0=x, 1=y, 2=z

Small example:
```wrench
var x = tube_lerp(1, 0.25, 0);
var y = tube_lerp(1, 0.25, 1);
var z = tube_lerp(1, 0.25, 2);
```

### SDF
```wrench
sdf_set_count(n)
sdf_get_count()
sdf_set_sphere(i, x, y, z, r, hue, sat, val, alpha, bias)
sdf_set_box(i, x, y, z, w, h, d, hue, sat, val, alpha, bias, power)
sdf_set_shape(i, type, x, y, z, a, b, c, hue, sat, val, alpha, bias, power)
sdf_render()
sdf_set_palette(i, palId, mix, scroll, bright, blend)
sdf_palette_hsv3(palId, h0,s0,v0, h1,s1,v1, h2,s2,v2, mix, scroll, bright, blend, mid)
sdf_palette_rgb3(...)
sdf_set_material(i, texId, cell_cm, strength, seed, mode)
create_Sphere()
create_Box()
sdf_update_sphere(...)
sdf_update_box(...)
```

Notes:
- i is the shape index
- define the shape count first with sdf_set_count(n)
- define a palette before assigning it with sdf_set_palette(...)
- alpha and bias strongly affect visibility

Small example:
```wrench
sdf_set_count(1);
sdf_set_sphere(0, 0.0, 0.0, 0.0, 70.0, 32, 255, 255, 0.9, 0.6);
sdf_render();
```

### Time / Noise / Messaging
```wrench
millis()
time_is_valid()
time_local_seconds()
time_now()
time_sync()
noise_seed(seed)
simplex3(x, y, z)
simplex3_01(x, y, z)
print(...)
println(...)
inbox_has()
inbox_get()
```

Small example:
```wrench
var ms;
var n;
ms = millis();
n = simplex3_01(0.1, 0.2, ms * 0.001);
```

## 7) Use Only These Reliable Bindings

### LED
- `leds_begin()`
- `leds_total()`
- `leds_strip_count()`
- `leds_strip_len()`
- `leds_clear()`
- `leds_set_brightness(b)`
- `leds_get_brightness()`
- `leds_set_pixel(...)`
- `leds_set_pixel_c(...)`
- `leds_get_pixel_c(...)`
- `leds_show()`
- `create_Color()`

### Geometry
- `tube_lerp(tubeIndex, t01, which)`
- `tube_xyz_out(tubeIndex, t01, outVec3)`
- `tube_endpoints_out(tubeIndex, outA, outB)`
- `tube_xyz3(...)`
- `tube_endpoints3(...)`

### SDF
- `sdf_set_count(n)`
- `sdf_get_count()`
- `sdf_set_sphere(...)`
- `sdf_set_box(...)`
- `sdf_set_shape(...)`
- `sdf_render()`
- `sdf_set_palette(...)`
- `sdf_palette_hsv3(...)`
- `sdf_palette_rgb3(...)`
- `sdf_set_material(...)`
- `create_Sphere()`
- `create_Box()`
- `sdf_update_sphere(...)`
- `sdf_update_box(...)`

### Time / Noise / Messaging
- `millis()`
- `time_is_valid()`
- `time_local_seconds()`
- `time_now()`
- `time_sync()`
- `noise_seed(seed)`
- `simplex3(x,y,z)`
- `simplex3_01(x,y,z)`
- `print(...)`
- `println(...)`
- `inbox_has()`
- `inbox_get()`

Do not invent undocumented helper functions.

Small example:
```wrench
// safe
leds_set_brightness(255);

// not safe unless documented in this file
// leds_fade_to_black(8);
```

## 8) Container Safety
These return reused containers and should not be stored across frames:
- tube_xyz3(...)
- tube_endpoints3(...)
- lerp3(...)
- lerp_color(...)

If you need persistence, use tube_xyz_out(...) / tube_endpoints_out(...) with your own container.

Small example:
```wrench
var p;
p = new Vec3();
tube_xyz_out(3, 0.5, p);
```

## 9) Stable SDF Guidance
- Start with large shapes so they are clearly visible
- Good first-test sizes:
  - spheres: 40..140 cm
  - boxes: 40..220 cm
- Typical visible alpha:
  - 0.6..1.0
- Typical usable bias:
  - 0.45..0.85
- Keep shapes inside the safe volume

If nothing shows:
1. increase size
2. increase alpha
3. lower bias slightly
4. move the shape closer to the center or a tube midpoint
5. make sure the palette exists before calling sdf_set_palette(...)

Small example:
```wrench
// first-try visible sphere
sdf_set_sphere(0, 0.0, 0.0, 0.0, 90.0, 32, 255, 255, 0.9, 0.55);
```

## 10) Palette Rules
- sdf_set_palette(...) only works if the palette was defined first
- sdf_palette_hsv3(...) must receive the full argument list
- Built-in palette IDs:
  - 0 Rainbow
  - 1 Lava
  - 2 Ocean
  - 3 Forest
  - 4 Party
  - 5 Heat
  - 6 GoldenDecay

Safe palette example:
```wrench
sdf_palette_hsv3(
  10,
  32, 255, 255,
  160, 180, 220,
  0, 240, 255,
  0.45, 0.02, 255, 1, 128
);

sdf_set_palette(0, 10, 180, 0, 255, 1);
```

Another small example:
```wrench
sdf_set_sphere(0, 0.0, 0.0, 0.0, 70.0, 32, 255, 255, 0.9, 0.6);
sdf_set_palette(0, 10, 200, 0, 255, 1);
```

## 11) Texture Rules
- mode lower bits:
  - 0=XY
  - 1=XZ
  - 2=YZ
  - 3=RADIAL
- Target bits:
  - 0=intensity
  - 1=palette brightness
  - 2=palette mix
  - 3=base color
- Bit 1<<4 = local space

Safe starting example:
```wrench
var mode;
mode = 3 | (1 << 2);
sdf_set_material(0, 0, 6.0, 0.5, 123, mode);
```

Another small example:
```wrench
// XZ stripes affecting intensity
var mode;
mode = 1;
sdf_set_material(0, 1, 10.0, 0.25, 200, mode);
```

## 12) Reliable Design Strategies
These are usually safe and readable on this sculpture:
- A few large spheres filling the whole volume
- Large boxes/slabs crossing the tetrahedron
- Motion from base to apex
- Stable shapes anchored at tube midpoints
- One symbolic apex element
- Slow simplex-noise drift
- Custom palettes for mood
- Subtle textures, not aggressive per-pixel effects

Avoid as a first attempt:
- many tiny shapes
- dense per-pixel effects
- complex message-driven logic
- undocumented helper calls
- code that depends on a very specific camera viewpoint

Small example:
```wrench
// safer first attempt: 3 large spheres, not 80 tiny ones
sdf_set_count(3);
```

## 13) Recommended Patterns
- Use setup() to initialize arrays, palettes, and counts
- Use tick() to update positions and call sdf_render()
- Prefer scalar APIs in hot paths
- If in doubt, choose simpler geometry and fewer shapes

### Pattern A: One stable anchor sphere
```wrench
var t0;

function setup() {
  leds_begin();
  leds_set_brightness(255);
  sdf_set_count(1);
  t0 = millis();
}

function tick() {
  var ms;
  var t;

  ms = millis();
  t = (ms - t0) * 0.001;

  sdf_set_sphere(0, 0.0, 0.0, 0.0, 60.0, 32, 255, 255, 0.9, 0.6);
  sdf_render();
}
```

### Pattern B: Motion along one tube
```wrench
var t0;

function setup() {
  leds_begin();
  leds_set_brightness(255);
  sdf_set_count(1);
  t0 = millis();
}

function tick() {
  var ms;
  var t;
  var u;
  var x;
  var y;
  var z;

  ms = millis();
  t = (ms - t0) * 0.001;
  u = 0.5 + 0.5 * math::sin(t * 0.4);

  x = tube_lerp(3, u, 0);
  y = tube_lerp(3, u, 1);
  z = tube_lerp(3, u, 2);

  sdf_set_sphere(0, x, y, z, 26.0, 160, 220, 255, 0.9, 0.6);
  sdf_render();
}
```

### Pattern C: Safe palette + texture
```wrench
var t0;
var mode;

function setup() {
  leds_begin();
  leds_set_brightness(255);
  sdf_set_count(1);

  sdf_palette_hsv3(
    10,
    32, 255, 255,
    160, 180, 220,
    0, 240, 255,
    0.45, 0.02, 255, 1, 128
  );

  mode = 3 | (1 << 2);
  t0 = millis();
}

function tick() {
  sdf_set_sphere(0, 0.0, 0.0, 0.0, 70.0, 32, 255, 255, 0.9, 0.6);
  sdf_set_palette(0, 10, 180, 0, 255, 1);
  sdf_set_material(0, 0, 6.0, 0.5, 123, mode);
  sdf_render();
}
```
