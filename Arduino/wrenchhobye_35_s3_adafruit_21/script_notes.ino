/*
{
  "cmd": "run_and_store",
  "code": "var pos = 0; var frames = 0; var lastMs = 0; function setup(){ var ok = leds_begin(); println(\"ok=\" + ok + \" total=\" + TOTAL_LEDS); leds_set_brightness(255); leds_clear(); leds_show(); lastMs = millis(); } function tick(){ var total = TOTAL_LEDS; var i = 0; while(i < total){ leds_set_pixel(i, 0, 0, 0); i = i + 1; } leds_set_pixel(pos, 255, 255, 255); pos = pos + 1; if(pos >= 20) pos = 0; leds_show(); frames = frames + 1; var now = millis(); if(now - lastMs >= 1000){ println(\"fps=\" + frames); frames = 0; lastMs = now; } }"
}
Wrench coding pitfalls (prompt checklist)

Language constraints

❌ No nested functions

❌ No ternary (a ? b : c)

❌ No range syntax (a..b)

❌ No block-scoped var like JS → declare all var at top level or function top

❌ Variables must be declared before use in a function

❌ Avoid for → prefer while (safer, simpler)

Parser / syntax gotchas

⚠️ Trailing commas in arrays or objects can break parsing

⚠️ Missing semicolons sometimes surface as errors on later lines

⚠️ } errors often mean a missing var declaration earlier

⚠️ Error like var_not_seen_before_label usually means:

a variable assigned without var

or a scope mismatch caused by parser confusion

Runtime / stability

⚠️ Large locals or many arrays → stack overflow

⚠️ Deep loops inside tick() can trip watchdog

⚠️ Always keep tick() bounded and fast

⚠️ Prefer incremental state over full clears

⚠️ Avoid heavy math in Wrench (no sin in tight loops if possible)

Math / stdlib

⚠️ Use math::sin, math::cos, math::abs (not JS globals)

⚠️ % with floats is allowed but fragile → keep operands sane

⚠️ Be explicit with parentheses (parser is shallow)

Arrays

⚠️ Arrays are dynamic but slow

⚠️ Use parallel arrays instead of arrays of objects

⚠️ Don’t resize arrays inside tick()

⚠️ Initialize arrays in setup(), not lazily

LED API usage

⚠️ leds_show() must be called to push frame

⚠️ Don’t call leds_show() multiple times per tick

⚠️ leds_clear() every frame is expensive; overwrite selectively

⚠️ leds_set_pixel() is safest for simple patterns

⚠️ SDF is powerful but heavy — limit sphere count

Serial / JSON interaction

⚠️ Partial uploads or serial noise can corrupt code → re-send once if error looks nonsensical

⚠️ If compile error changes on re-upload → suspect serial framing, not logic

⚠️ Avoid extremely long lines (keep under ~200 chars)

Performance heuristics

✅ Prefer spatial coherence (slow movement)

✅ Prefer symbolic / ceremonial animations over high-frequency effects

✅ Let firmware do heavy lifting (SDF, blending)

✅ Use Wrench as scene control, not a renderer

One-line mental model

Wrench is closer to a fragile embedded DSL than JavaScript — write like C with training wheels.

If you want, I can turn this into:

a comment header template for every Wrench sketch

or a “safe skeleton” Wrench file you always start from

*/
/*
FPS;

{
  "cmd": "run_and_store",
  "code": "var pos = 0; var frames = 0; var lastMs = 0; function setup(){ var ok = leds_begin(); println(\"ok=\" + ok + \" total=\" + TOTAL_LEDS); leds_set_brightness(255); leds_clear(); leds_show(); lastMs = millis(); } function tick(){ var total = TOTAL_LEDS; var i = 0; while(i < total){ leds_set_pixel(i, 0, 0, 0); i = i + 1; } leds_set_pixel(pos, 255, 255, 255); pos = pos + 1; if(pos >= 20) pos = 0; leds_show(); frames = frames + 1; var now = millis(); if(now - lastMs >= 1000){ println(\"fps=\" + frames); frames = 0; lastMs = now; } }"
}

{"cmd":"reboot"}


{"cmd":"status"}

{"cmd":"run_now","code":"println(\"ok=\");"}

{"cmd":"set_code","code":"println(\"ok=\");"}

{"cmd":"run_now","code":"var t0=0; var frames=0; var lastMs=0; function setup(){ var ok=leds_begin(); println(\"ok=\"+ok+\" total=\"+TOTAL_LEDS); leds_set_brightness(255); sdf_set_count(3); t0=millis(); lastMs=t0; } function tick(){ var now=millis(); var t=(now-t0)*0.001; sdf_set_sphere(0, math::sin(t*0.6)*10.0, math::cos(t*0.4)*10.5, 0.0, 5.2, 0,255,255, 1.0,1.0); sdf_set_sphere(1, math::cos(t*0.4)*30.3, math::sin(t*0.7)*30.6, math::sin(t)*20.8, 10.4, 160,255,200, 1.0,2.4); sdf_set_sphere(2, 0.0, -0.5+math::sin(t*0.2)*20.4, math::cos(t*0.4)*11.5, 10.5, 96,255,180, 0.40,3.2); sdf_render(); leds_show(); frames=frames+1; if(now-lastMs>=1000){ println(\"fps=\"+frames); frames=0; lastMs=now; } }"}

function setup() {
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);

  leds_set_brightness(255);

  sdf_set_count(1);

  // Single sphere at origin (center of LED geometry)
  sdf_set_sphere(
    0,
    -30.0, 0.0, 10.0,     // x, y, z
    4.0,              // radius
    90, 255, 255,    // hue, sat, val (cyan)
    1.0, 1.0          // alpha, falloff
  );

  // Kick the LED task so tick() starts
  leds_show();
  
}

function tick() {
  sdf_render();
  leds_show();
}

// ------------------------------------------------------------
// Wrench demo: multiple spheres orbiting around STRIP 0 geometry
// - Global SPHERES controls how many are active
// - setup() initializes colors/radii/phases
// - tick() moves spheres around the FIRST LED tube string (strip 0)
// ------------------------------------------------------------

// === GLOBALS ===
var SPHERES = 6;      // change this number
var t0 = 0;

// Per-sphere params (parallel arrays for speed/simplicity)
var rad[];    // radius (cm)
var hue[];    // 0..255
var sat[];    // 0..255
var val[];    // 0..255
var alp[];    // alpha
var fall[];   // falloff (cm)
var ph[];     // phase offset
var sp[];     // speed multiplier
var yOff[];   // small y offsets

function setup() {
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);

  leds_set_brightness(255);

  // tell firmware how many spheres we will drive
  sdf_set_count(SPHERES);

  // allocate/init arrays
  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};
  yOff = {};

  // pick a base center near strip 0 (matches your mapping: strip 0 is around x ~ -(NUM_STRIPS-1)*0.5*spacing)
  // We'll orbit around this point.
  // (These are in "cm" as your firmware expects.)
  var xBase = -30.0;
  var yBase = 0.0;
  var zBase = 0.0;

  var i = 0;
  while (i < SPHERES) {
    // radii and looks
    rad[i]  = 2.5 + i * 1.2;          // cm
    hue[i]  = (i * 35) & 255;          // different colors
    sat[i]  = 255;
    val[i]  = 255;
    alp[i]  = 0.6 + (i % 3) * 0.35;    // 0.6..1.3
    fall[i] = 0.6 + (i % 4) * 0.7;     // cm edge band thickness-ish

    // motion params
    ph[i]   = i * 0.85;
    sp[i]   = 0.55 + i * 0.10;
    yOff[i] = (i - (SPHERES - 1) * 0.5) * 0.7;

    // initialize each sphere somewhere on the ring (so you see them immediately)
    var a = ph[i];
    var ringR = 8.0 + i * 1.5;        // cm, orbit radius around the tube

    var x = xBase + math::cos(a) * ringR;
    var y = yBase + yOff[i];
    var z = zBase + math::sin(a) * ringR;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  t0 = millis();

  // kick LED task so tick() starts
  leds_show();
}

function tick() {
  var t = (millis() - t0) * 0.001;

  // Approx center for strip 0 in your current debug-separated layout.
  // Feel free to tweak xBase/zBase to align with your real tube.
  var xBase = -30.0;
  var yBase = 0.0;
  var zBase = 0.0;

  // Tube "ring" around the strip: we orbit in XZ around the tube center,
  // and also slide slowly along Z to mimic traveling along the tube length.
  var tubeHalfLen = 60.0; // cm-ish (just for motion; doesn't need to match exactly)

  var i = 0;
  while (i < SPHERES) {
    var a = t * sp[i] + ph[i];

    // orbit radius (bigger spheres orbit a bit wider)
    var ringR = 7.0 + rad[i] * 0.8;

    // orbit around tube in XZ
    var x = xBase + math::cos(a) * ringR;
    var z = zBase + math::sin(a) * ringR;

    // drift along tube (triangle wave along z), plus small per-sphere offset
    // tri goes 0..1..0..1
    var tri = 1.0 - math::abs(((t * 0.12 + i * 0.07) % 2.0) - 1.0);
    z = z + (tri * 2.0 - 1.0) * tubeHalfLen;

    // small y wobble so it doesn't look planar
    var y = yBase + yOff[i] + math::sin(a * 1.3) * 1.2;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  sdf_render();
  leds_show();
}


//// 

// ------------------------------------------------------------
// Wrench demo: multiple spheres orbiting around STRIP 0 geometry
// - Global SPHERES controls how many are active
// - setup() initializes colors/radii/phases
// - tick() moves spheres around the FIRST LED tube string (strip 0)
// ------------------------------------------------------------

// === GLOBALS ===
var SPHERES = 20;      // change this number
var t0 = 0;

// Per-sphere params (parallel arrays for speed/simplicity)
var rad[];    // radius (cm)
var hue[];    // 0..255
var sat[];    // 0..255
var val[];    // 0..255
var alp[];    // alpha
var fall[];   // falloff (cm)
var ph[];     // phase offset
var sp[];     // speed multiplier
var yOff[];   // small y offsets
var frames = 0; 
var lastMs = 0; 
function setup() {
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);

  leds_set_brightness(255);

  // tell firmware how many spheres we will drive
  sdf_set_count(SPHERES);

  // allocate/init arrays
  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};
  yOff = {};

  // pick a base center near strip 0 (matches your mapping: strip 0 is around x ~ -(NUM_STRIPS-1)*0.5*spacing)
  // We'll orbit around this point.
  // (These are in "cm" as your firmware expects.)
  var xBase = -30.0;
  var yBase = 30.0;
  var zBase = 0.0;

  var i = 0;
  while (i < SPHERES) {
    // radii and looks
    rad[i]  = 2.5 + i * 2.2;          // cm
    hue[i]  = (i * 35) & 255;          // different colors
    sat[i]  = 255;
    val[i]  = 255;
    alp[i]  = 0.6 + (i % 3) * 0.35;    // 0.6..1.3
    fall[i] = 0.6 + (i % 4) * 0.7;     // cm edge band thickness-ish

    // motion params
    ph[i]   = i * 0.85;
    sp[i]   = 0.55 + i * 0.10;
    yOff[i] = (i - (SPHERES - 1) * 0.5) * 0.7;

    // initialize each sphere somewhere on the ring (so you see them immediately)
    var a = ph[i];
    var ringR = 8.0 + i * 1.5;        // cm, orbit radius around the tube

    var x = xBase + math::cos(a) * ringR;
    var y = yBase + yOff[i];
    var z = zBase + math::sin(a) * ringR;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  t0 = millis();

  // kick LED task so tick() starts
  leds_show();
}

function tick() {
  var t = (millis() - t0) * 0.001;

  // Approx center for strip 0 in your current debug-separated layout.
  // Feel free to tweak xBase/zBase to align with your real tube.
  var xBase = -30.0;
  var yBase = 0.0;
  var zBase = 0.0;

  // Tube "ring" around the strip: we orbit in XZ around the tube center,
  // and also slide slowly along Z to mimic traveling along the tube length.
  var tubeHalfLen = 60.0; // cm-ish (just for motion; doesn't need to match exactly)

  var i = 0;
  while (i < SPHERES) {
    var a = t * sp[i] + ph[i];

    // orbit radius (bigger spheres orbit a bit wider)
    var ringR = 7.0 + rad[i] * 0.8;

    // orbit around tube in XZ
    var x = xBase + math::cos(a) * ringR;
    var z = zBase + math::sin(a) * ringR;

    // drift along tube (triangle wave along z), plus small per-sphere offset
    // tri goes 0..1..0..1
    var tri = 1.0 - math::abs(((t * 0.12 + i * 0.07) % 2.0) - 1.0);
    z = z + (tri * 2.0 - 1.0) * tubeHalfLen;

    // small y wobble so it doesn't look planar
    var y = yBase + yOff[i] + math::sin(a * 1.3) * 1.2;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  sdf_render();
  leds_show();
 var now = millis();
frames++;
 if(now - lastMs >= 1000){ println("fps=" + frames); frames = 0; lastMs = now; }
}


xxxxx


// ------------------------------------------------------------
// Wrench demo: ONE yellow sphere fixed in the middle of STRIP 0
// ------------------------------------------------------------

// ----------------------------------------------------------
  // Center of STRIP 0 (matches your debug-separated geometry)
  // ----------------------------------------------------------
  var xCenter = -30.0;   // strip 0 X center
  var yCenter = 0.0;
  var zCenter = 0.0;    // middle of tube

  // Yellow sphere
  var radius  = 50.0;    // cm
  var hue     = 50;     // yellow (HSV rainbow)
  var sat     = 0;
  var val     = 255;
  var alpha   = 0.2;
  var falloff = 0;    // edge / glow thickness (cm)

function setup() {
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);

  leds_set_brightness(255);

  // One sphere only
  sdf_set_count(1);

  
  sdf_set_sphere(
    0,
    xCenter, yCenter, zCenter,
    radius,
    hue, sat, val,
    alpha, falloff
  );

  // Kick the LED task so tick() starts
  sdf_render();
  leds_show();
}

var offsetX = 0;

function tick() {
  // Static scene – just re-render
offsetX =offsetX + 0.5;
if(offsetX > 30)
{
offsetX = -30;
}
sdf_set_sphere(
    0,
    xCenter+ offsetX, yCenter, zCenter,
    radius,
    hue, sat, val,
    alpha, falloff
  );

  sdf_render();
  leds_show();
}




///XXXXXX

// ------------------------------------------------------------
// Wrench demo: "Fire" spheres (red / yellow / white on black)
// - Uses only 4-color palette via HSV (red, amber/yellow, near-white)
// - Mix of big red ember bodies + small hot white cores + yellow tongues
// ------------------------------------------------------------

var SPHERES = 20;
var t0 = 0;

var rad[];
var hue[];
var sat[];
var val[];
var alp[];
var fall[];
var ph[];
var sp[];
var yOff[];

var frames = 0;
var lastMs = 0;

function setup() {
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);
  leds_set_brightness(255);

  sdf_set_count(SPHERES);

  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};
  yOff = {};

  // Base center near strip 0 (cm)
  var xBase = -30.0;
  var yBase =  0.0;
  var zBase =  0.0;

  var i = 0;
  while (i < SPHERES) {
    // --- size groups: ember bodies, flame tongues, hot cores
    var kind = i % 3;

    if (kind == 0) {
      // red ember body (bigger, softer)
      rad[i]  = 10.0 + (i * 0.35);
      hue[i]  = 0;        // red
      sat[i]  = 255;
      val[i]  = 180;
      alp[i]  = 0.55;
      fall[i] = 4.0;
    } else if (kind == 1) {
      // yellow/orange tongue (medium, sharper)
      rad[i]  = 6.0 + (i * 0.20);
      hue[i]  = 28;       // amber/yellow (0=red, ~30=orange/yellow)
      sat[i]  = 255;
      val[i]  = 255;
      alp[i]  = 0.70;
      fall[i] = 2.0;
    } else {
      // hot core (small, crisp, near-white)
      rad[i]  = 3.2 + (i * 0.10);
      hue[i]  = 40;       // yellow-ish hue but low sat => white-ish
      sat[i]  = 35;       // low saturation => white
      val[i]  = 255;
      alp[i]  = 0.85;
      fall[i] = 1.0;
    }

    ph[i]   = i * 0.83;
    sp[i]   = 0.35 + i * 0.06;
    yOff[i] = (i - (SPHERES - 1) * 0.5) * 0.55;

    // initial placement around tube
    var a = ph[i];
    var ringR = 7.0 + rad[i] * 0.35;

    var x = xBase + math::cos(a) * ringR;
    var y = yBase + yOff[i];
    var z = zBase + math::sin(a) * ringR;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);
    i = i + 1;
  }

  t0 = millis();
  leds_show();
}

function tick() {
  var t = (millis() - t0) * 0.001;

  // tube center (cm)
  var xBase = -30.0;
  var yBase =  0.0;
  var zBase =  0.0;

  var tubeHalfLen = 60.0;

  var i = 0;
  while (i < SPHERES) {
    var a = t * sp[i] + ph[i];

    // orbit radius changes by sphere size
    var ringR = 6.0 + rad[i] * 0.40;

    // orbit around tube in XZ
    var x = xBase + math::cos(a) * ringR;
    var z = zBase + math::sin(a) * ringR;

    // drift along tube (triangle wave)
    var tri = 1.0 - math::abs(((t * 0.10 + i * 0.07) % 2.0) - 1.0);
    z = z + (tri * 2.0 - 1.0) * tubeHalfLen;

    // vertical "lick" + wobble
    var lick = math::sin(a * 1.7 + tri * 3.0) * 1.5;
    var y = yBase + yOff[i] + lick;

    // slight flicker via value modulation (keeps palette: red/yellow/white on black)
    var v = val[i];
    var f = 0.75 + 0.25 * math::sin(t * 6.0 + ph[i] * 2.0);
    v = v * f;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], v, alp[i], fall[i]);
    i = i + 1;
  }

  sdf_render();
  leds_show();

  // fps
  var now = millis();
  frames = frames + 1;
  if (now - lastMs >= 1000) {
    println("fps=" + frames);
    frames = 0;
    lastMs = now;
  }
}

// Tube/strip ID test (no SDF)
// Idea:
// - You have 6 strips ("tubes")
// - Each strip has 4 sequential sections (quarters of STRIP_LEN)
// - In section 0 (first quarter) we draw "tube index + 1" groups
// - Each group = 6 white pixels, separated by a gap
// So tube 4 (strip index 3) shows 4 dots (groups) of 6 pixels in section 0.

function setup(){
  leds_begin();
  leds_set_brightness(255);
}

function tick(){
  var strips = STRIPS;
  var L = STRIP_LEN;
  var quarter = (L / 4) | 0;

  var total = TOTAL_LEDS;
  var i = 0;

  // clear all
  i = 0;
  while(i < total){
    leds_set_pixel(i, 0, 0, 0);
    i = i + 1;
  }

  // draw identifiers
  var s = 0;
  while(s < strips){
    var groups = s + 1;          // tube 0 -> 1 group, tube 3 -> 4 groups, ...
    var base = s * L;            // start index of this strip
    var start = base;            // section 0 start
    var pos = start + 4;         // small inset so it's not at index 0

    var g = 0;
    while(g < groups){
      // one "dot" = 6 pixels ON
      var k = 0;
      while(k < 6){
        var p = pos + k;
        if(p < start + quarter){
          leds_set_pixel(p, 255, 255, 255);
        }
        k = k + 1;
      }

      // advance to next dot (6 on + 6 off gap)
      pos = pos + 12;
      g = g + 1;
    }

    s = s + 1;
  }

  leds_show();
}

// Simple non-SDF test pattern
// Five white pixels in a row, repeated every 50 LEDs,
// moving along the lines.

var phase = 0;

function setup(){
  leds_begin();
  leds_set_brightness(255);
}

function tick(){
  var total = TOTAL_LEDS;
  var i = 0;
  var j = 0;

  // clear
  i = 0;
  while(i < total){
    leds_set_pixel(i, 0, 0, 0);
    i = i + 1;
  }

  // draw 5-pixel blocks every 50 LEDs
  i = 0;
  while(i < total){
    j = 0;
    while(j < 5){
      var p = i + phase + j;
      while(p >= total) p = p - total;
      leds_set_pixel(p, 255, 255, 255);
      j = j + 1;
    }
    i = i + 50;
  }

  leds_show();

  // move forward
  phase = phase + 1;
  while(phase >= total) phase = phase - total;
}


// ------------------------------------------------------------
// Wrench: One big red sphere orbiting around the pyramid center
// and "hitting" different sides in a circular motion.
// Assumes your C++ mapping is centered at (0,0,0) = pyramid center.
// Units: cm (as your firmware expects).
// ------------------------------------------------------------

var t0 = 0;

function setup(){
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);
  leds_set_brightness(255);

  sdf_set_count(1);

  t0 = millis();
  leds_show();
}

function tick(){
  var t = (millis() - t0) * 0.001;

  // Orbit around center in XZ, with a little Y bob.
  // Radius chosen so the sphere reaches toward edges/sides.
  var R = 55.0;          // cm orbit radius (tweak 40..80)
  var x = math::cos(t * 0.55) * R;
  var z = math::sin(t * 0.55) * R;
  var y = math::sin(t * 0.30) * 18.0;

  // Big sphere so it "hits" sides
  var r = 28.0;          // cm sphere radius (tweak 18..40)

  // Fire-red
  var hue = 0;
  var sat = 255;
  var val = 220;

  // Strong presence + crisp-ish edge
  var alpha = 1.2;       // can go >1 in your firmware (clamped to 8)
  var fall  = 2.5;       // cm

  sdf_set_sphere(0, x, y, z, r, hue, sat, val, alpha, fall);

  sdf_render();
  leds_show();
}

// ------------------------------------------------------------
// Wrench demo: spheres roam the WHOLE pyramid volume (tetra centered at 0,0,0)
// - Slow, legible motion
// - Uses a 3D Lissajous-style path per sphere (covers volume, not one corner)
// - Wrench-safe: no nested functions, while loops, parallel arrays
// ------------------------------------------------------------

var SPHERES = 8;
var t0 = 0;

var rad[];
var hue[];
var sat[];
var val[];
var alp[];
var fall[];
var ph[];
var sp[];

var frames = 0;
var lastMs = 0;

function setup(){
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);
  leds_set_brightness(255);

  sdf_set_count(SPHERES);

  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};

  var i = 0;
  while(i < SPHERES){
    rad[i]  = 10.0 + i/6 * 40.0;   // cm
    hue[i]  = (i * 28) & 255;
    sat[i]  = 255;
    val[i]  = 120;
    alp[i]  = 0.55 + (i % 3) * 0.22;
    fall[i] = 1.0 + (i % 4) * 0.9;

    ph[i]   = i * 0.73;
    sp[i]   = 0.05 + i * 0.003;       // slow global speed

    sdf_set_sphere(i, 0.0, 0.0, 0.0, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);
    i = i + 1;
  }

  t0 = millis();
  lastMs = t0;
  leds_show();
}

function tick(){
  var t = (millis() - t0) * 0.001;

  // Approx volume limits for your 190cm tetra (centered):
  // Keep within a conservative envelope so spheres actually "hit sides"
  // without spending time outside the sculpture.
  var Rxy = 45.0;   // horizontal reach (cm)
  var Ry  = 40.0;   // vertical reach (cm)
  var Rz  = 45.0;   // depth reach (cm)

  var i = 0;
  while(i < SPHERES){
    var a = ph[i] + t * sp[i];

    // Per-sphere frequencies (small integers) -> fill volume over time
    var fx = 1.0 + (i % 3) * 0.5;       // 1.0, 1.5, 2.0
    var fy = 0.8 + (i % 4) * 0.35;      // 0.8..1.85
    var fz = 1.1 + (i % 5) * 0.27;      // 1.1..2.18

    // Lissajous 3D roam (covers whole volume)
    var x = math::sin(a * fx) * Rxy + math::sin(a * 0.31 + i) * (0.20 * Rxy);
    var y = math::sin(a * fy + 1.7) * Ry  + math::sin(a * 0.23 + i) * (0.15 * Ry);
    var z = math::sin(a * fz + 3.1) * Rz  + math::sin(a * 0.29 + i) * (0.20 * Rz);

    // Very slow global drift so it doesn't feel periodic
    x = x + math::sin(t * 0.03) * 10.0;
    z = z + math::cos(t * 0.027) * 10.0;
    y = y + math::sin(t * 0.021) * 6.0;

    // Gentle breathing on radius
    var rr = rad[i] * (0.85 + 0.15 * (1.0 + math::sin(a * 0.7)) * 0.5);

    sdf_set_sphere(i, x, y, z, rr, hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  sdf_render();
  leds_show();

  frames = frames + 1;
  var now = millis();
  if(now - lastMs >= 1000){
    println("fps=" + frames);
    frames = 0;
    lastMs = now;
  }
}




// Snowstorm (short + visible): 30 balls, gusts always re-trigger

var SPHERES = 30;
var t0 = 0;
var last = 0;

var x[];
var y[];
var z[];
var vx[];
var vy[];
var vz[];
var nextMs[];

function setup(){
  leds_begin();
  leds_set_brightness(255);
  sdf_set_count(SPHERES);

  x = {}; y = {}; z = {};
  vx = {}; vy = {}; vz = {};
  nextMs = {};

  t0 = millis();
  last = t0;

  var i = 0;
  while(i < SPHERES){
    x[i] = (random(-1000,1000)/1000.0) * 65.0;
    z[i] = (random(-1000,1000)/1000.0) * 65.0;
    y[i] = -38.0;

    vx[i] = 0.0; vy[i] = 0.0; vz[i] = 0.0;
    nextMs[i] = t0 + random(0,1200);

    // visible white flakes (sat=0 => white)
    sdf_set_sphere(i, x[i], y[i], z[i], 100.0 , 0, 0, 255, 0.9, 4.0);

    i = i + 1;
  }
  leds_show();
}

function tick(){
  var now = millis();
  var dt = (now - last) * 0.001;
  if(dt > 0.05) dt = 0.05;
  if(dt < 0.0) dt = 0.0;
  last = now;

  var t = (now - t0) * 0.001;

  var GROUND = -38.0;
  var R = 65.0;

  var GRAV = 70.0;
  var DRAG = 0.98;

  // stronger, changing wind
  var windX = math::sin(t * 0.35) * 45.0 + math::sin(t * 0.11) * 50.0;
  var windZ = math::cos(t * 0.31) * 45.0 + math::cos(t * 0.09) * 50.0;

  var i = 0;
  while(i < SPHERES){

    // If on ground: drift + occasional gust
    if(y[i] <= GROUND + 0.01){
      // tiny crawling drift so it never freezes
      x[i] = x[i] + windX * 0.03 * dt;
      z[i] = z[i] + windZ * 0.03 * dt;

      if(now >= nextMs[i]){
        // gust: random sideways + upward kick
        vx[i] = (random(-1000,1000)/1000.0) * (60.0 + random(0,600)/10.0);
        vz[i] = (random(-1000,1000)/1000.0) * (60.0 + random(0,600)/10.0);
        vy[i] = 125.0 + random(0,900)/10.0; // 45..135

        // schedule next gust after it lands
        nextMs[i] = now + 600 + random(0,2200);
      }
    }

    // forces
    vx[i] = vx[i] + windX * 0.35 * dt;
    vz[i] = vz[i] + windZ * 0.35 * dt;
    vy[i] = vy[i] - GRAV * dt;

    // integrate
    x[i] = x[i] + vx[i] * dt;
    y[i] = y[i] + vy[i] * dt;
    z[i] = z[i] + vz[i] * dt;

    // drag
    vx[i] = vx[i] * DRAG;
    vy[i] = vy[i] * DRAG;
    vz[i] = vz[i] * DRAG;

    // bounds
    if(x[i] < -R){ x[i] = -R; vx[i] = -vx[i] * 0.5; }
    if(x[i] >  R){ x[i] =  R; vx[i] = -vx[i] * 0.5; }
    if(z[i] < -R){ z[i] = -R; vz[i] = -vz[i] * 0.5; }
    if(z[i] >  R){ z[i] =  R; vz[i] = -vz[i] * 0.5; }

    // ground + settle
    if(y[i] <= GROUND){
      y[i] = GROUND;
      if(vy[i] < -12.0) vy[i] = -vy[i] * 0.25;
      else { vx[i] = vx[i] * 0.4; vy[i] = 0.0; vz[i] = vz[i] * 0.4; }
    }

    sdf_set_sphere(i, x[i], y[i], z[i], i*i/40, 0, 0, 155, 0.9, 2.0);

    i = i + 1;
  }

  sdf_render();
  leds_show();
}


Skov!!!!


// ------------------------------------------------------------
// Wrench demo: spheres roam the WHOLE pyramid volume (tetra centered at 0,0,0)
// - Slow, legible motion
// - Uses a 3D Lissajous-style path per sphere (covers volume, not one corner)
// - Wrench-safe: no nested functions, while loops, parallel arrays
// ------------------------------------------------------------

var SPHERES = 20;
var t0 = 0;

var rad[];
var hue[];
var sat[];
var val[];
var alp[];
var fall[];
var ph[];
var sp[];

var frames = 0;
var lastMs = 0;

function setup(){
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);
  leds_set_brightness(255);

  sdf_set_count(SPHERES);

  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};

  var i = 0;
  while(i < SPHERES){
    
if(i % 2 == 0)
{
  sat[i]  = 225;
    val[i]  = 30;
 hue[i]  = 66;//255/2-10;
rad[i]  =  60;   // cm
 fall[i] = 0 ;
}
else // lille
{
  sat[i]  = 255;
    val[i]  = 225;
hue[i]  = 192;
rad[i]  =  0.01;   // cm
 fall[i] = 10.0 ;

}
   // hue[i]  = (i * 28) & 255;
  
    alp[i]  = 0.25 + (i % 3) * 0.22;
   
    ph[i]   = i * 0.73;
    sp[i]   = 0.05 + i * 0.003;       // slow global speed

    sdf_set_sphere(i, 0.0, 0.0, 0.0, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);
    i = i + 1;
  }

  t0 = millis();
  lastMs = t0;
  leds_show();
}

function tick(){
  var t = (millis() - t0) * 0.005;

  // Approx volume limits for your 190cm tetra (centered):
  // Keep within a conservative envelope so spheres actually "hit sides"
  // without spending time outside the sculpture.
  var Rxy = 45.0;   // horizontal reach (cm)
  var Ry  = 40.0;   // vertical reach (cm)
  var Rz  = 45.0;   // depth reach (cm)

  var i = 0;
  while(i < SPHERES){
    var a = ph[i] + t * sp[i];

    // Per-sphere frequencies (small integers) -> fill volume over time
    var fx = 1.0 + (i % 3) * 0.5;       // 1.0, 1.5, 2.0
    var fy = 0.8 + (i % 4) * 0.35;      // 0.8..1.85
    var fz = 1.1 + (i % 5) * 0.27;      // 1.1..2.18

    // Lissajous 3D roam (covers whole volume)
    var x = math::sin(a * fx) * Rxy + math::sin(a * 0.31 + i) * (0.20 * Rxy);
    var y = math::sin(a * fy + 1.7) * Ry  + math::sin(a * 0.23 + i) * (0.15 * Ry);
    var z = math::sin(a * fz + 3.1) * Rz  + math::sin(a * 0.29 + i) * (0.20 * Rz);

    // Very slow global drift so it doesn't feel periodic
    x = x + math::sin(t * 0.03) * 10.0;
    z = z + math::cos(t * 0.027) * 10.0;
    y = y + math::sin(t * 0.021) * 6.0;

    // Gentle breathing on radius
    var rr = rad[i] * (0.85 + 0.15 * (1.0 + math::sin(a * 0.7)) * 0.5);

    sdf_set_sphere(i, x, y, z, rr, hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  sdf_render();
  leds_show();

  frames = frames + 1;
  var now = millis();
  if(now - lastMs >= 1000){
    println("fps=" + frames);
    frames = 0;
    lastMs = now;
  }
}

Skov to:


// ------------------------------------------------------------
// Wrench demo: spheres roam the WHOLE pyramid volume (tetra centered at 0,0,0)
// - Slow, legible motion
// - Uses a 3D Lissajous-style path per sphere (covers volume, not one corner)
// - Wrench-safe: no nested functions, while loops, parallel arrays
// ------------------------------------------------------------

var SPHERES = 20;
var t0 = 0;

var rad[];
var hue[];
var sat[];
var val[];
var alp[];
var fall[];
var ph[];
var sp[];

var frames = 0;
var lastMs = 0;

function setup(){
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);
  leds_set_brightness(255);

  sdf_set_count(SPHERES);

  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};

  var i = 0;
  while(i < SPHERES){
    
if(i % 2 == 0)
{
  sat[i]  = 225;
    val[i]  = 30;
 hue[i]  = 66;//255/2-10;
rad[i]  =  5;   // cm
 fall[i] = 15 ;
alp[i]  = 0.1;// + (i % 3) * 0.22;
}
else // lille
{
  sat[i]  = 255;
    val[i]  = 225;
hue[i]  = 192;
rad[i]  =  0.01;   // cm
 fall[i] = 4.0 ;
alp[i]  =0.8;// 0.25 + (i % 3) * 0.22;

}
   // hue[i]  = (i * 28) & 255;
  
    
   
    ph[i]   = i * 0.73;
    sp[i]   = 0.05 + i * 0.003;       // slow global speed

    sdf_set_sphere(i, 0.0, 0.0, 0.0, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);
    i = i + 1;
  }

  t0 = millis();
  lastMs = t0;
  leds_show();
}

function tick(){
  var t = (millis() - t0) * 0.005;

  // Approx volume limits for your 190cm tetra (centered):
  // Keep within a conservative envelope so spheres actually "hit sides"
  // without spending time outside the sculpture.
  var Rxy = 45.0;   // horizontal reach (cm)
  var Ry  = 40.0;   // vertical reach (cm)
  var Rz  = 45.0;   // depth reach (cm)

  var i = 0;
  while(i < SPHERES){
    var a = ph[i] + t * sp[i];

    // Per-sphere frequencies (small integers) -> fill volume over time
    var fx = 1.0 + (i % 3) * 0.5;       // 1.0, 1.5, 2.0
    var fy = 0.8 + (i % 4) * 0.35;      // 0.8..1.85
    var fz = 1.1 + (i % 5) * 0.27;      // 1.1..2.18

    // Lissajous 3D roam (covers whole volume)
    var x = math::sin(a * fx) * Rxy + math::sin(a * 0.31 + i) * (0.20 * Rxy);
    var y = math::sin(a * fy + 1.7) * Ry  + math::sin(a * 0.23 + i) * (0.15 * Ry);
    var z = math::sin(a * fz + 3.1) * Rz  + math::sin(a * 0.29 + i) * (0.20 * Rz);

    // Very slow global drift so it doesn't feel periodic
    x = x + math::sin(t * 0.03) * 10.0;
    z = z + math::cos(t * 0.027) * 10.0;
    y = y + math::sin(t * 0.021) * 6.0;

    // Gentle breathing on radius
    var rr = rad[i] * (0.85 + 0.15 * (1.0 + math::sin(a * 0.7)) * 0.5);

    sdf_set_sphere(i, x, y, z, rr, hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  sdf_render();
  leds_show();

  frames = frames + 1;
  var now = millis();
  if(now - lastMs >= 1000){
    println("fps=" + frames);
    frames = 0;
    lastMs = now;
  }
}
final for today:


// ------------------------------------------------------------
// Wrench demo: spheres roam the WHOLE pyramid volume (tetra centered at 0,0,0)
// - Slow, legible motion
// - Uses a 3D Lissajous-style path per sphere (covers volume, not one corner)
// - Wrench-safe: no nested functions, while loops, parallel arrays
// ------------------------------------------------------------

var SPHERES = 20;
var t0 = 0;

var rad[];
var hue[];
var sat[];
var val[];
var alp[];
var fall[];
var ph[];
var sp[];

var frames = 0;
var lastMs = 0;

function setup(){
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);
  leds_set_brightness(255);

  sdf_set_count(SPHERES);

  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};

  var i = 0;
  while(i < SPHERES){
    
if(i % 2 == 0)
{
  sat[i]  = 225;
    val[i]  = 10;
 hue[i]  = 66;//255/2-10;
rad[i]  =  30;   // cm
 fall[i] = 15 ;
alp[i]  = 0.1;// + (i % 3) * 0.22;
}
else // lille
{
  sat[i]  = 255;
    val[i]  = 225;
hue[i]  = 192;
rad[i]  =  0.01;   // cm
 fall[i] = 4.0 ;
alp[i]  =0.8;// 0.25 + (i % 3) * 0.22;

}
   // hue[i]  = (i * 28) & 255;
  
    
   
    ph[i]   = i * 0.73;
    sp[i]   = 0.05 + i * 0.003;       // slow global speed

    sdf_set_sphere(i, 0.0, 0.0, 0.0, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);
    i = i + 1;
  }

  t0 = millis();
  lastMs = t0;
  leds_show();
}

function tick(){
  var t = (millis() - t0) * 0.005;

  // Approx volume limits for your 190cm tetra (centered):
  // Keep within a conservative envelope so spheres actually "hit sides"
  // without spending time outside the sculpture.
  var Rxy = 45.0;   // horizontal reach (cm)
  var Ry  = 40.0;   // vertical reach (cm)
  var Rz  = 45.0;   // depth reach (cm)

  var i = 0;
  while(i < SPHERES){
    var a = ph[i] + t * sp[i];

    // Per-sphere frequencies (small integers) -> fill volume over time
    var fx = 1.0 + (i % 3) * 0.5;       // 1.0, 1.5, 2.0
    var fy = 0.8 + (i % 4) * 0.35;      // 0.8..1.85
    var fz = 1.1 + (i % 5) * 0.27;      // 1.1..2.18

    // Lissajous 3D roam (covers whole volume)
    var x = math::sin(a * fx/i) * Rxy + math::sin(a * 0.31 + i) * (0.20 * Rxy);
    var y = math::sin(a * fy + 1.7/i) * Ry  + math::sin(a * 0.23 + i) * (0.15 * Ry);
    var z = math::sin(a * fz + 3.1/i) * Rz  + math::sin(a * 0.29 + i) * (0.20 * Rz);

    // Very slow global drift so it doesn't feel periodic
    x = x + math::sin(t * 0.03) * 10.0;
    z = z + math::cos(t * 0.027) * 10.0;
    y = y + math::sin(t * 0.021) * 6.0;

    // Gentle breathing on radius
    var rr = rad[i] * (0.85 + 0.15 * (1.0 + math::sin(a * 0.7)) * 0.5);

    sdf_set_sphere(i, x, y, z, rr, hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

t = (millis() - t0) * 0.0005;

  // Orbit around center in XZ, with a little Y bob.
  // Radius chosen so the sphere reaches toward edges/sides.
  var R = 55.0;          // cm orbit radius (tweak 40..80)
  var x = math::cos(t * 0.55) * R;
  var z = math::sin(t * 0.55) * R;
  var y = math::sin(t * 0.30) * 18.0;

  // Big sphere so it "hits" sides
  var r = 28.0;          // cm sphere radius (tweak 18..40)

  // Fire-red
  var hue = 0;
  var sat = 50+100*(math::sin(t)+1);
  var val = 220;

  // Strong presence + crisp-ish edge
  var alpha = 6;       // can go >1 in your firmware (clamped to 8)
  var fall  = 2.5;       // cm

  sdf_set_sphere(0, x, y, z, r, hue, sat, val, alpha, fall);


  sdf_render();
  leds_show();

  
}

//// 


// ------------------------------------------------------------
// Wrench demo: spheres roam the WHOLE pyramid volume (tetra centered at 0,0,0)
// - Slow, legible motion
// - Uses a 3D Lissajous-style path per sphere (covers volume, not one corner)
// - Wrench-safe: no nested functions, while loops, parallel arrays
// ------------------------------------------------------------

var SPHERES = 20;
var t0 = 0;

var rad[];
var hue[];
var sat[];
var val[];
var alp[];
var fall[];
var ph[];
var sp[];

var frames = 0;
var lastMs = 0;

function setup(){
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);
  leds_set_brightness(255);

  sdf_set_count(SPHERES);

  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};

  var i = 0;
  while(i < SPHERES){
    
if(i % 2 == 0)
{
  sat[i]  = 225;
    val[i]  = 10;
 hue[i]  = 66;//255/2-10;
rad[i]  =  30;   // cm
 fall[i] = 15 ;
alp[i]  = 0.1;// + (i % 3) * 0.22;
}
else // lille
{
  sat[i]  = 255;
    val[i]  = 225;
hue[i]  = 192;
rad[i]  =  0.01;   // cm
 fall[i] = 4.0 ;
alp[i]  =0.8;// 0.25 + (i % 3) * 0.22;

}
   // hue[i]  = (i * 28) & 255;
  
    
   
    ph[i]   = i * 0.73;
    sp[i]   = 0.05 + i * 0.003;       // slow global speed

    sdf_set_sphere(i, 0.0, 0.0, 0.0, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);
    i = i + 1;
  }

  t0 = millis();
  lastMs = t0;
  leds_show();
}

function tick(){
  var t = (millis() - t0) * 0.005;

  // Approx volume limits for your 190cm tetra (centered):
  // Keep within a conservative envelope so spheres actually "hit sides"
  // without spending time outside the sculpture.
  var Rxy = 45.0;   // horizontal reach (cm)
  var Ry  = 40.0;   // vertical reach (cm)
  var Rz  = 45.0;   // depth reach (cm)

  var i = 0;
  while(i < SPHERES){
    var a = ph[i] + t * sp[i];

    // Per-sphere frequencies (small integers) -> fill volume over time
    var fx = 1.0 + (i % 3) * 0.5;       // 1.0, 1.5, 2.0
    var fy = 0.8 + (i % 4) * 0.35;      // 0.8..1.85
    var fz = 1.1 + (i % 5) * 0.27;      // 1.1..2.18

    // Lissajous 3D roam (covers whole volume)
    var x = math::sin(a * fx/i) * Rxy + math::sin(a * 0.31 + i) * (0.20 * Rxy);
    var y = math::sin(a * fy + 1.7/i) * Ry  + math::sin(a * 0.23 + i) * (0.15 * Ry);
    var z = math::sin(a * fz + 3.1/i) * Rz  + math::sin(a * 0.29 + i) * (0.20 * Rz);

    // Very slow global drift so it doesn't feel periodic
    x = x + math::sin(t * 0.03) * 10.0;
    z = z + math::cos(t * 0.027) * 10.0;
    y = y + math::sin(t * 0.021) * 6.0;

    // Gentle breathing on radius
    var rr = rad[i] * (0.85 + 0.15 * (1.0 + math::sin(a * 0.7)) * 0.5);

    sdf_set_sphere(i, x, y, z, rr, hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

t = (millis() - t0) * 0.0005;

  // Orbit around center in XZ, with a little Y bob.
  // Radius chosen so the sphere reaches toward edges/sides.
  var R = 55.0;          // cm orbit radius (tweak 40..80)
  var x = math::cos(t * 0.55) * R;
  var z = math::sin(t * 0.55) * R;
  var y = math::sin(t * 0.30) * 18.0;

  // Big sphere so it "hits" sides
  var r = 28.0;          // cm sphere radius (tweak 18..40)

  // Fire-red
  var hue = 0;
  var sat = 50+100*(math::sin(t)+1);
  var val = 220;

  // Strong presence + crisp-ish edge
  var alpha = 6;       // can go >1 in your firmware (clamped to 8)
  var fall  = 2.5;       // cm

  sdf_set_sphere(0, x, y, z, r, hue, sat, val, alpha, fall);


  sdf_render();
  leds_show();

  
}

pretty bling:


// ------------------------------------------------------------
// Wrench demo: multiple spheres orbiting around STRIP 0 geometry
// - Global SPHERES controls how many are active
// - setup() initializes colors/radii/phases
// - tick() moves spheres around the FIRST LED tube string (strip 0)
// ------------------------------------------------------------

// === GLOBALS ===
var SPHERES = 40;      // change this number
var t0 = 0;

// Per-sphere params (parallel arrays for speed/simplicity)
var rad[];    // radius (cm)
var hue[];    // 0..255
var sat[];    // 0..255
var val[];    // 0..255
var alp[];    // alpha
var fall[];   // falloff (cm)
var ph[];     // phase offset
var sp[];     // speed multiplier
var yOff[];   // small y offsets

function setup() {
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);

  leds_set_brightness(255);

  // tell firmware how many spheres we will drive
  sdf_set_count(SPHERES);

  // allocate/init arrays
  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};
  yOff = {};

  // pick a base center near strip 0 (matches your mapping: strip 0 is around x ~ -(NUM_STRIPS-1)*0.5*spacing)
  // We'll orbit around this point.
  // (These are in "cm" as your firmware expects.)
  var xBase = -30.0;
  var yBase = 0.0;
  var zBase = 0.0;

  var i = 0;
  while (i < SPHERES) {
    // radii and looks
    rad[i]  = 20 + i * 0.5;          // cm
    hue[i]  = (i * 35) & 255;          // different colors
    sat[i]  = 255;
    val[i]  = 255;
    alp[i]  = 0.6 + (i % 3) * 0.35;    // 0.6..1.3
    fall[i] = 0.6 + (i % 4) * 0.7;     // cm edge band thickness-ish

    // motion params
    ph[i]   = i * 0.85;
    sp[i]   = 0.55 + i * 0.10;
    yOff[i] = (i - (SPHERES - 1) * 0.5) * 0.7;

    // initialize each sphere somewhere on the ring (so you see them immediately)
    var a = ph[i];
    var ringR = 8.0 + i * 1.5;        // cm, orbit radius around the tube

    var x = xBase + math::cos(a) * ringR;
    var y = yBase + yOff[i];
    var z = zBase + math::sin(a) * ringR;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  t0 = millis();

  // kick LED task so tick() starts
  leds_show();
}

function tick() {
  var t = (millis() - t0) * 0.001;

  // Approx center for strip 0 in your current debug-separated layout.
  // Feel free to tweak xBase/zBase to align with your real tube.
  var xBase = -30.0;
  var yBase = 0.0;
  var zBase = 0.0;

  // Tube "ring" around the strip: we orbit in XZ around the tube center,
  // and also slide slowly along Z to mimic traveling along the tube length.
  var tubeHalfLen = 60.0; // cm-ish (just for motion; doesn't need to match exactly)

  var i = 0;
  while (i < SPHERES) {
    var a = t * sp[i] + ph[i];

    // orbit radius (bigger spheres orbit a bit wider)
    var ringR = 7.0 + rad[i] * 0.8;

    // orbit around tube in XZ
    var x = xBase + math::cos(a) * ringR;
    var z = zBase + math::sin(a) * ringR;

    // drift along tube (triangle wave along z), plus small per-sphere offset
    // tri goes 0..1..0..1
    var tri = 1.0 - math::abs(((t * 0.12 + i * 0.07) % 2.0) - 1.0);
    z = z + (tri * 2.0 - 1.0) * tubeHalfLen;

    // small y wobble so it doesn't look planar
    var y = yBase + yOff[i] + math::sin(a * 1.3) * 1.2;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  sdf_render();
  leds_show();
}

Sprakle:


// ------------------------------------------------------------
// Wrench demo: multiple spheres orbiting around STRIP 0 geometry
// - Global SPHERES controls how many are active
// - setup() initializes colors/radii/phases
// - tick() moves spheres around the FIRST LED tube string (strip 0)
// ------------------------------------------------------------

// === GLOBALS ===
var SPHERES = 20;      // change this number
var t0 = 0;

// Per-sphere params (parallel arrays for speed/simplicity)
var rad[];    // radius (cm)
var hue[];    // 0..255
var sat[];    // 0..255
var val[];    // 0..255
var alp[];    // alpha
var fall[];   // falloff (cm)
var ph[];     // phase offset
var sp[];     // speed multiplier
var yOff[];   // small y offsets

function setup() {
  var ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);

  leds_set_brightness(255);

  // tell firmware how many spheres we will drive
  sdf_set_count(SPHERES);

  // allocate/init arrays
  rad  = {};
  hue  = {};
  sat  = {};
  val  = {};
  alp  = {};
  fall = {};
  ph   = {};
  sp   = {};
  yOff = {};

  // pick a base center near strip 0 (matches your mapping: strip 0 is around x ~ -(NUM_STRIPS-1)*0.5*spacing)
  // We'll orbit around this point.
  // (These are in "cm" as your firmware expects.)
  var xBase = -30.0;
  var yBase = 0.0;
  var zBase = 0.0;

  var i = 0;
  while (i < SPHERES) {
    // radii and looks
    rad[i]  = 30 + i * 0.5;          // cm
    hue[i]  = (i * 35) & 255;          // different colors
    sat[i]  = 255;
    val[i]  = 255;
    alp[i]  = 0.1;
//0 + (i % 3) * 0.035;    // 0.6..1.3
    fall[i] = 1.2;//0.6 + (i % 4) * 3.7;     // cm edge band thickness-ish

    // motion params
    ph[i]   = i * 0.85;
    sp[i]   = 0.55 + i * 0.10;
    yOff[i] = (i - (SPHERES - 1) * 0.5) * 0.7;

    // initialize each sphere somewhere on the ring (so you see them immediately)
    var a = ph[i];
    var ringR = 8.0 + i * 1.5;        // cm, orbit radius around the tube

    var x = xBase + math::cos(a) * ringR;
    var y = yBase + yOff[i];
    var z = zBase + math::sin(a) * ringR;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  t0 = millis();

  // kick LED task so tick() starts
  leds_show();
}

function tick() {
  var t = (millis() - t0) * 0.0003;

  // Approx center for strip 0 in your current debug-separated layout.
  // Feel free to tweak xBase/zBase to align with your real tube.
  var xBase = -30.0;
  var yBase = 0.0;
  var zBase = 0.0;

  // Tube "ring" around the strip: we orbit in XZ around the tube center,
  // and also slide slowly along Z to mimic traveling along the tube length.
  var tubeHalfLen = 60.0; // cm-ish (just for motion; doesn't need to match exactly)

  var i = 0;
  while (i < SPHERES) {
    var a = t * sp[i] + ph[i];

    // orbit radius (bigger spheres orbit a bit wider)
    var ringR = 7.0 + rad[i] * 0.8;

    // orbit around tube in XZ
    var x = xBase + math::cos(a) * ringR;
    var z = zBase + math::sin(a) * ringR;

    // drift along tube (triangle wave along z), plus small per-sphere offset
    // tri goes 0..1..0..1
    var tri = 1.0 - math::abs(((t * 0.12 + i * 0.07) % 2.0) - 1.0);
    z = z + (tri * 2.0 - 1.0) * tubeHalfLen;

    // small y wobble so it doesn't look planar
    var y = yBase + yOff[i] + math::sin(a * 1.3) * 1.2;

    sdf_set_sphere(i, x, y, z, rad[i], hue[i], sat[i], val[i], alp[i], fall[i]);

    i = i + 1;
  }

  sdf_render();
  leds_show();
}


// ------------------------------------------------------------
// Wrench: GIANT RED SPHERE GEOMETRY TEST
// - 1 big red sphere moves through the pyramid volume
// - Slow + legible motion
// - No nested functions, no for, vars declared before use
// ------------------------------------------------------------

var t0 = 0;

function setup() {
  var ok;
  var x;
  var y;
  var z;

  ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);

  leds_set_brightness(255);

  sdf_set_count(1);

  // start position (will be overwritten in tick)
  x = 0.0;
  y = 0.0;
  z = 0.0;

  sdf_set_sphere(
    0,
    x, y, z,
    78.0,          // BIG radius (cm) -> adjust 20..45 depending on your pyramid scale
    0, 255, 255,   // red
    1.2, 6.0       // alpha, falloff (soft edge)
  );

  t0 = millis();
  leds_show();
}

function tick() {
  var t;
  var x;
  var y;
  var z;

  // movement bounds (cm) — tune to match your pyramid
  var xAmp;
  var yAmp;
  var zAmp;

  // speed multipliers
  var sx;
  var sy;
  var sz;

  t = (millis() - t0) * 0.005;

  xAmp = 55.0;
  yAmp = 38.0;
  zAmp = 55.0;

  sx = 0.22;
  sy = 0.17;
  sz = 0.19;

  // Smooth 3D lissajous-ish motion
  x = math::sin(t * sx) * xAmp;
  y = math::sin(t * sy + 1.2) * yAmp;
  z = math::cos(t * sz + 0.7) * zAmp;

  sdf_set_sphere(
    0,
    x, y, z,
    48.0,
    0, 255, 255,
    1.2, 6.0
  );

  sdf_render();
  leds_show();
}

debug test pattern

// ------------------------------------------------------------
// Wrench: STRIP MARKER TEST using leds_set_pixel()
// - Assumes strips are laid out sequentially in the LED index space:
//   strip0 = [0 .. STRIP_LEN-1]
//   strip1 = [STRIP_LEN .. 2*STRIP_LEN-1] ...
//
// Pattern:
//  strip 0 -> 1 dot
//  strip 1 -> 2 dots
//  strip 2 -> 3 dots
//  ...
//
// Each "dot" is a small cluster of pixels around a position.
// ------------------------------------------------------------

var NUM_STRIPS = 6;     // <-- set to your tube count
var STRIP_LEN  = 892;   // <-- set to your LEDs per tube

var DOT_SIZE = 3;       // pixels per dot (odd number looks best: 1,3,5)
var DOT_GAP  = 40;      // spacing between dots on a strip (pixels)

var frames = 0;
var lastMs = 0;

function setup(){
  var ok;
  ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);
  leds_set_brightness(255);

  leds_clear();
  leds_show();

  lastMs = millis();
}

function tick(){
  var total;
  var i;

  var strip;
  var base;
  var dots;
  var d;

  var center;
  var p;
  var half;
  var idx;

  total = TOTAL_LEDS;

  // clear all
  i = 0;
  while(i < total){
    leds_set_pixel(i, 0, 0, 0);
    i = i + 1;
  }

  half = (DOT_SIZE - 1) / 2;

  // per-strip markers
  strip = 0;
  while(strip < NUM_STRIPS){
    base = strip * STRIP_LEN;

    // 1 dot on strip0, 2 on strip1, 3 on strip2...
    dots = strip + 1;

    d = 0;
    while(d < dots){
      // place dots starting a bit in from the beginning
      center = 30 + d * DOT_GAP;

      // draw a small cluster around center
      p = -half;
      while(p <= half){
        idx = base + center + p;
        if(idx >= base && idx < base + STRIP_LEN){
          // RED marker
          leds_set_pixel(idx, 255, 0, 0);
        }
        p = p + 1;
      }

      d = d + 1;
    }

    strip = strip + 1;
  }

  leds_show();

  // FPS debug
  frames = frames + 1;
  var now;
  now = millis();
  if(now - lastMs >= 1000){
    println("fps=" + frames);
    frames = 0;
    lastMs = now;
  }
}

// ------------------------------------------------------------
// Wrench: GIANT RED SPHERE + SMALL BRIGHT "PERLIN-LIKE" ORB
// - Sphere 0: big red volume probe
// - Sphere 1: small bright orb with smooth wandering motion
// Notes:
// - No nested functions, no for, vars declared before use
// - The "perlin-like" motion is made by summing a few slow sin/cos layers
//   (smooth, non-repeating-ish, but cheaper/safer than real Perlin).
// ------------------------------------------------------------

var t0 = 0;

function setup() {
  var ok;
  var x;
  var y;
  var z;

  ok = leds_begin();
  println("ok=" + ok + " total=" + TOTAL_LEDS);

  leds_set_brightness(155);

  // TWO spheres now
  sdf_set_count(2);

  // --- Sphere 0 (big red) ---
  x = 0.0;
  y = 0.0;
  z = 0.0;

  sdf_set_sphere(
    0,
    x, y, z,
    58.0,
    0, 255, 255,   // red
    1.2, 6.0
  );

  // --- Sphere 1 (small bright orb) ---
  sdf_set_sphere(
    1,
    0.0, 0.0, 0.0,
    6.0,           // small radius
    200, 40, 255,  // bright white-ish (low sat, high val) with a cool tint
    2.0, 2.0       // strong alpha, tight falloff
  );

  t0 = millis();
  leds_show();
}

function tick() {
  var t;

  // big sphere pos
  var x0;
  var y0;
  var z0;

  // bounds
  var xAmp;
  var yAmp;
  var zAmp;

  // speeds
  var sx;
  var sy;
  var sz;

  // small orb pos
  var x1;
  var y1;
  var z1;

  // "perlin-like" layered motion terms
  var a1;
  var a2;
  var a3;

  t = (millis() - t0) * 0.001;

  // ---- BIG RED SPHERE (0) ----
  xAmp = 55.0;
  yAmp = 38.0;
  zAmp = 55.0;

  sx = 0.22;
  sy = 0.17;
  sz = 0.19;

  x0 = math::sin(t * sx) * xAmp;
  y0 = math::sin(t * sy + 1.2) * yAmp;
  z0 = math::cos(t * sz + 0.7) * zAmp;

  sdf_set_sphere(
    0,
    x0, y0, z0,
    58.0,
    0, 255, 255,
    1.2, 6.0
  );

  // ---- SMALL ORB (1): smooth wandering ("perlin-like") ----
  // amplitudes for the small orb (keep inside pyramid)
  // (slightly smaller than big sphere bounds so it stays visible)
  xAmp = 45.0;
  yAmp = 30.0;
  zAmp = 45.0;

  // build 3 slow phases (different rates)
  a1 = t * 0.13;
  a2 = t * 0.071 + 10.0;
  a3 = t * 0.043 + 25.0;

  // layered sin/cos => smooth, organic wandering
  x1 = (math::sin(a1) * 0.62 + math::sin(a2) * 0.28 + math::cos(a3) * 0.18) * xAmp;
  y1 = (math::cos(a1 * 0.9) * 0.55 + math::sin(a2 * 1.3) * 0.25 + math::sin(a3 * 1.7) * 0.20) * yAmp;
  z1 = (math::cos(a1 * 1.1) * 0.60 + math::cos(a2 * 0.8) * 0.22 + math::sin(a3 * 1.4) * 0.18) * zAmp;

  sdf_set_sphere(
    1,
    x1, y1, z1,
    30.0,
    200, 40, 255,   // bright, slightly bluish-white
    2.2, 2.0
  );

  sdf_render();
  leds_show();
}

*/