/* ============================================================================
 * BALLET L BA7ER — physics.js   →   window.BLB_PHYSICS
 *
 * Simulation + physics module. Plain script, no modules, THREE r128 APIs only.
 *
 * THREE is touched in exactly two places:
 *   - createSplashes()  (Points / BufferGeometry / ShaderMaterial / CanvasTexture)
 *   - createPlayerBody() for body.pos / body.vel, because SPEC says they are
 *     THREE.Vector3 (falls back to a tiny shim so it still runs under node).
 * createWaveField() and createTileSim() are pure numbers — no THREE at all, so
 * they unit-test headless and the wave sum can be mirrored in GLSL.
 *
 * Coordinates (SPEC.md, authoritative):
 *   Y up, metres, sea rest height y = 0. +Z = open sea, -Z = inland.
 *   Tile cell (i,j) centre = (i*2, 0.3, 4 + j*2),  i in [-64,64], j in [0,400].
 *   Tile top surface y = 0.30.
 * ==========================================================================*/
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Grid constants (must match SPEC.md exactly)
  // ---------------------------------------------------------------------------
  const CELL = 2.0;              // cell size, metres
  const INV_CELL = 1 / CELL;
  const Z0 = 4.0;                // world z of row j = 0
  const TILE_TOP = 0.30;         // top surface of a placed slab
  const SLAB = 1.94;             // slab footprint (SPEC: 1.94 x 0.3 x 1.94)
  const I_MIN = -64, I_MAX = 64;
  const J_MIN = 0, J_MAX = 400;
  const GRID_W = I_MAX - I_MIN + 1;   // 129
  const GRID_H = J_MAX - J_MIN + 1;   // 401
  const CELLS = GRID_W * GRID_H;      // 51729

  // Shore access is a STAIR FLIGHT (5 treads + a concrete apron), authored by
  // world.js as AABB colliders. Physics only needs its footprint, to keep tiles
  // out of it. Note the apron ends at z = 2.9 and row j = 0 spans z 3.03..4.97,
  // so nothing in the tile grid actually collides with the stairs — row j = 0
  // stays buildable on purpose, so stepping from the apron (y = 0.30) onto the
  // first balata (y = 0.30) is seamless.
  const NO_BUILD = { x1: -5, x2: 5, z1: -2, z2: 3.0 };

  // ---------------------------------------------------------------------------
  // Tier defaults (SPEC.md table). The game may pass its own `tiers`; anything
  // missing falls back to these.
  // ---------------------------------------------------------------------------
  const TIER_DEFAULTS = [
    { id: 'ramleh', name: 'Ramleh mix',   hp: 8,   mortar: 1, lira: 0,   color: '#CDBD92' },
    { id: 'beton',  name: 'Beton',        hp: 22,  mortar: 1, lira: 40,  color: '#9AA0A0' },
    { id: 'qarmid', name: 'Qarmid azraq', hp: 55,  mortar: 2, lira: 180, color: '#2E7FA8' },
    { id: 'marble', name: 'Rmeyleh marble', hp: 130, mortar: 3, lira: 600, color: '#EFE7DA' }
  ];

  // ===========================================================================
  // WAVE_COMPONENTS — the published wave table.
  //
  // height() is a direct sum over THIS array and nothing else. Every number the
  // sum needs lives here or in TUNING.waves, so the identical surface can be
  // reproduced in a GLSL vertex shader. The exact per-component expression is:
  //
  //   theta = (dirX*x + dirZ*z) * (2*PI/len) * shorten  -  (2*PI/len)*speed*t  +  phase
  //   s     = sin(theta)
  //   term  = amp * (s + q*steep*(s*s - 0.5))
  //
  // (the CPU evaluates sin() with a ~0.0012-accurate polynomial for speed; a
  // GLSL port should just call sin() — the difference is sub-millimetre)
  //
  // and the whole field is
  //
   //  ba      = breakerAmount(z) = (z <= 0) ? 1 : 1/(1 + (z/breakRange)^2)
  //   shorten = 1 + breakShorten*ba
  //   q       = skewBase + skewBreak*ba
  //   gain    = (ampBase + ampSwell*swell(t)) * (1 + breakShoal*ba) / (1 + 0.5*q*steepAvg)
  //   height  = gain * sum(term)
  //
  // where steepAvg = sum(steep*amp)/sum(amp) = 0.8084 for this table. The
  // (s*s - 0.5) term is the cheap Gerstner stand-in: it sharpens crests and
  // flattens troughs with no extra trig, and it is mean-zero so the rest height
  // stays exactly y = 0.
  //
  // Directions are already unit length and all point shoreward (+Z -> -Z, so
  // dirZ < 0). `speed` is absolute phase speed in m/s, taken from deep-water
  // dispersion sqrt(g*len/(2*PI)) and then detuned a few percent per component
  // so the periods (3.84 / 3.06 / 2.08 / 1.47 s) share no common multiple and
  // the surface never visibly repeats.
  // ===========================================================================
  const WAVE_COMPONENTS = [
    // main Mediterranean swell, almost dead-on shoreward
    { dirX:  0.0797, dirZ: -0.9968, amp: 0.160, len: 23.0, speed: 5.992, steep: 1.00, phase: 0.00 },
    // secondary swell, crossing from the south-west
    { dirX: -0.3401, dirZ: -0.9404, amp: 0.105, len: 13.5, speed: 4.407, steep: 0.85, phase: 2.31 },
    // local wind wave
    { dirX:  0.5218, dirZ: -0.8530, amp: 0.062, len:  7.7, speed: 3.710, steep: 0.55, phase: 4.77 },
    // surface chop / texture
    { dirX: -0.7227, dirZ: -0.6926, amp: 0.034, len:  4.3, speed: 2.928, steep: 0.25, phase: 1.04 }
  ];

  // ===========================================================================
  // TUNING — this object IS the difficulty curve. Exported on the module so the
  // lead can dial feel without surgery.
  //
  // Wave *component* geometry is baked into closures at createWaveField() time,
  // so editing WAVE_COMPONENTS after creation does nothing (make a new field).
  // Everything else (swell, damage, player, fx) is read per call and is live.
  // ===========================================================================
  const TUNING = {
    waves: {
      components: WAVE_COMPONENTS,   // same array object — one source of truth
      // Sum of amps is 0.361 m. With ampBase+ampSwell*swell at a typical calm
      // swell (~0.26) the gain lands near 1.07, giving 0.2-0.5 m of chop near
      // shore: Mediterranean, not North Atlantic.
      ampBase: 0.55,      // amplitude scale at swell = 0 (glassy)
      ampSwell: 1.75,     // + this x swell. swell 0.26 -> 1.005x, swell 1.0 -> 2.30x
      breakRange: 26.0,   // breakerAmount falls to 0.5 at this z
      breakShorten: 0.55, // wavelengths compress by up to 55% in the break zone
      breakShoal: 0.45,   // and gain up to 45% height as they feel the bottom
      skewBase: 0.18,     // crest sharpening out at sea
      skewBreak: 0.70,    // extra sharpening in the break: waves pitch forward
      normalEps: 0.35,    // finite-difference step for normal()
      swell: {
        base: 0.26,
        driftA: 0.14, freqA: 0.01370,   // ~7.6 min period
        driftB: 0.07, freqB: 0.00430,   // ~24 min period (incommensurate)
        phaseA: 0.37, phaseB: 2.84,     // fixed, so the weather is portable
        squallPeriod: 110,  // s: one roll of the dice per window
        squallChance: 0.45, // -> a squall roughly every ~4 minutes
        squallSpan: 0.22,   // ~24 s of genuinely bad weather
        squallMin: 0.45, squallMax: 0.78,
        min: 0.04, max: 1.0
      }
    },

    tiles: {
      hpJitter: 0.14,     // +/-14% max-hp spread so a frontier row frays instead
                          // of failing as one visually synchronised block
      // exposure(i,j) = (missing/4)^expCurve * (expShoreW + (1-expShoreW)*depthF)
      //
      // missing === 0  =>  exposure EXACTLY 0  =>  an interior tile takes no
      // damage at any j in any swell. The depth term only ever SCALES what
      // missing neighbours already created, it never adds a floor.
      //
      // expCurve > 1 is what separates "a lone spur" from "the edge of a solid
      // front". At 2.0 a tile with one open side is 9x safer than a 3-sided
      // spur (0.0625 vs 0.5625 before the depth term), so the frontier recedes
      // slowly and tile-by-tile instead of unzipping a whole block inward.
      expCurve: 2.0,
      expShoreW: 0.62,
      depthFullJ: 90,     // j at which the "deep water" penalty is fully applied
      noBuild: NO_BUILD   // tiles may not overlap the stair flight
    },

    // Damage model. hp lost per second = baseDamage * exposure * energy
    //   energy = (base + swell*s) * (1 + breaker*ba + deep*(1-ba)) * (calm + wave*r)
    //   ba = waves.breakerAmount(z),  r = min(2, |localWaveHeight| / 0.45)
    // The `deep` term is what makes open water meaner than the shore break even
    // though the break itself is strongest near z = 0 — further out is always
    // worse, which is the whole difficulty curve of the game.
    //
    // Measured (calm = swell 0.26, squall = swell 0.90), hp / mean damage rate:
    //   exposure  calm    squall
    //   ramleh spur, 3 open, j=0     0.349    32 s    13 s
    //   ramleh spur, 3 open, j=90    0.563    15 s     6 s
    //   beton solid front edge       0.039  13.2 m   5.4 m
    //   beton front corner, 2 open   0.155   3.3 m    80 s
    //   qarmid solid front edge      0.039  33.1 m  13.4 m
    //   marble solid front edge      0.039  78.2 m  31.7 m
    //   marble spur, 3 open, j=90    0.563   4.1 m   1.7 m
    //   any interior tile            0.000     inf     inf
    // A wide Beton front with ~40 exposed edge tiles therefore sheds roughly
    // one tile every 20 s of calm sea — present, survivable, annoying.
    damage: {
      baseDamage: 0.58,
      base: 0.30, swell: 1.70,
      breaker: 0.80, deep: 1.55,
      calm: 0.65, wave: 0.70,
      hrefInv: 1 / 0.45
    },

    player: {
      radius: 0.32,
      height: 1.70,
      eyeHeight: 1.58,
      gravity: 22.0,
      walkSpeed: 4.2,
      runSpeed: 7.2,
      accel: 38.0,        // ground acceleration — enough weight to feel like a body
      airAccel: 10.0,     // you can steer in the air, but not much
      friction: 12.0,     // ground damping when there is no input
      jumpVel: 7.2,       // ~1.18 m apex
      // Step-up must clear the 0.24 m stair risers and the 0.30 m tile lip, and
      // stay far below any wall. Step-down is what keeps a descent of the stair
      // flight reading as walking rather than a series of little falls.
      stepUp: 0.38,
      stepDown: 0.52,
      stepRate: 8.0,      // m/s the feet are moved over a lip — smooth, not a pop
      maxDt: 0.05,        // clamp so an alt-tab cannot tunnel the body
      // Ledge guard: while grounded ABOVE ledgeGuardMinY, refuse a horizontal
      // move that would step off a drop bigger than stepDown. That is what stops
      // the player strolling off the corniche deck (y = 1.5) straight into the
      // sea over its seaward wall — the stairs are the way down, or a deliberate
      // jump. At sea level the guard is off, so you absolutely CAN walk off the
      // tile frontier and fall in.
      ledgeGuard: true,
      ledgeGuardMinY: 1.0,
      // water
      floatDepth: 0.95,   // feet this far under the surface -> head and shoulders out
      buoyK: 18.0,        // spring toward float depth: the body bobs on the waves
      buoyDamp: 6.0,
      swimSpeed: 1.55,    // deliberately pathetic
      swimAccel: 6.0,
      swimDrag: 3.2,
      wadeDepth: 0.55,    // standing on a tile with the wash over you != swimming
      enterDepth: 0.35,   // feet this far under before we call it "in the water"
      climbReach: 0.55,
      climbMaxRise: 1.20, // tiles (0.3) and the stair apron: yes. Deck (1.5): no.
      climbTime: 0.55,    // sluggish haul-out; `jump` skips the wait
      boundsX: 150, boundsZmin: -40, boundsZmax: 830
    },

    fx: {
      waterMax: 620,
      debrisMax: 420,
      pointScale: 420,      // gl_PointSize scale; fx.setViewportScale() makes it exact
      waterGravity: 11.0,
      debrisGravity: 16.0,
      waterLifeMin: 0.45, waterLifeMax: 1.05,
      debrisLifeMin: 0.90, debrisLifeMax: 1.80,
      waterSizeMin: 0.14, waterSizeMax: 0.42,
      debrisSizeMin: 0.10, debrisSizeMax: 0.26,
      drag: 0.9             // air drag per second on particle horizontal motion
    }
  };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function hashSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed)) return (seed * 2654435761) >>> 0;
    const s = String(seed == null ? 'ba7er' : seed);
    let h = 2166136261 >>> 0;
    for (let n = 0; n < s.length; n++) {
      h ^= s.charCodeAt(n);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32 — tiny, deterministic, good enough for hp jitter and particles
  function mulberry32(a) {
    let s = a >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // integer -> [0,1). Used for the squall calendar, so weather is reproducible.
  function hash1(n) {
    n = n | 0;
    n = (n ^ 61) ^ (n >>> 16);
    n = (n + (n << 3)) | 0;
    n ^= n >>> 4;
    n = Math.imul(n, 0x27d4eb2d);
    n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
  }

  function hexToRgb(hex, out) {
    let h = typeof hex === 'string' ? hex : '#ffffff';
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    const v = parseInt(h, 16);
    const n = isFinite(v) ? v : 0xffffff;
    out[0] = ((n >> 16) & 255) / 255;
    out[1] = ((n >> 8) & 255) / 255;
    out[2] = (n & 255) / 255;
    return out;
  }

  // Minimal Vector3 shim so the player body can run headless in a tuning script.
  // When THREE exists we use the real thing, because SPEC says body.pos is a
  // THREE.Vector3 and game.js copies it straight onto a mesh.
  function Vec3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  Vec3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
  Vec3.prototype.copy = function (v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; };
  Vec3.prototype.clone = function () { return new Vec3(this.x, this.y, this.z); };
  Vec3.prototype.length = function () { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); };

  function makeVec3(x, y, z) {
    const T = global.THREE;
    return (T && T.Vector3) ? new T.Vector3(x, y, z) : new Vec3(x, y, z);
  }

  function normalizeTiers(src) {
    const n = Math.max(TIER_DEFAULTS.length, (src && src.length) || 0);
    const out = [];
    for (let k = 0; k < n; k++) {
      const d = TIER_DEFAULTS[k] || TIER_DEFAULTS[TIER_DEFAULTS.length - 1];
      const s = (src && src[k]) || null;
      out.push({
        idx: k,
        id: (s && s.id) || d.id,
        name: (s && s.name) || d.name,
        hp: (s && typeof s.hp === 'number' && s.hp > 0) ? s.hp : d.hp,
        mortar: (s && typeof s.mortar === 'number') ? s.mortar : d.mortar,
        lira: (s && typeof s.lira === 'number') ? s.lira : d.lira,
        color: (s && s.color) || d.color
      });
    }
    return out;
  }

  // ===========================================================================
  // 1. WAVE FIELD   (no THREE)
  // ===========================================================================
  function createWaveField(opts) {
    opts = opts || {};
    const W = TUNING.waves;
    const S = W.swell;
    const src = (opts.components && opts.components.length) ? opts.components : W.components;
    const seedInt = hashSeed(opts.seed);

    // --- bake the published table into plain scalars ONCE. height() below
    // touches nothing but local numbers: no property lookups, no array reads,
    // no allocation, no sqrt/exp/pow/hypot.
    // Everything is pre-scaled into TURNS (1 turn = 2*PI rad) because the fast
    // sine below reduces its argument with a single Math.floor.
    const N = src.length;
    const kxT = new Float64Array(N), kzT = new Float64Array(N);
    const omT = new Float64Array(N), phT = new Float64Array(N);
    const amp = new Float64Array(N), aSt = new Float64Array(N);
    const INV_TWO_PI = 1 / (2 * Math.PI);
    let ampSum = 0, stpSum = 0;
    for (let n = 0; n < N; n++) {
      const c = src[n];
      const dl = Math.sqrt(c.dirX * c.dirX + c.dirZ * c.dirZ) || 1;  // table is already unit
      const invLen = 1 / c.len;                 // k/(2*PI) == 1/len
      kxT[n] = invLen * (c.dirX / dl);
      kzT[n] = invLen * (c.dirZ / dl);
      omT[n] = invLen * c.speed;                // omega/(2*PI) == speed/len
      phT[n] = (c.phase || 0) * INV_TWO_PI;
      amp[n] = c.amp;
      aSt[n] = c.amp * c.steep;                 // amp * steep, pre-multiplied
      ampSum += c.amp;
      stpSum += c.steep * c.amp;
    }
    // amplitude-weighted mean steepness: renormalises the skew so the crest
    // sharpening does not inflate the overall wave height.
    const steepAvg = ampSum > 0 ? (stpSum / ampSum) : 0;

    const ampBase = W.ampBase, ampSwell = W.ampSwell;
    const breakInv = 1 / W.breakRange;
    const breakShorten = W.breakShorten, breakShoal = W.breakShoal;
    const skewBase = W.skewBase, skewBreak = W.skewBreak;
    // 1 + 0.5*q*steepAvg, with q = skewBase + skewBreak*ba, expanded so the
    // per-call form is a plain (nrmA + nrmB*ba) — no exponentials anywhere.
    const nrmA = 1 + 0.5 * steepAvg * skewBase;
    const nrmB = 0.5 * steepAvg * skewBreak;

    // --- swell: slow storminess drift + a hashed squall calendar.
    // The three window hashes only change once per squallPeriod, so they are
    // cached; the envelope is a parabola rather than pow(sin,0.75) so there is
    // no Math.pow on any path.
    let winC = NaN, winAmp = 0, winStart = 0, winEnd = 0;
    function syncWindow(win) {
      winC = win;
      const span = S.squallSpan;
      if (hash1((win * 374761393) ^ seedInt) < S.squallChance) {
        winAmp = S.squallMin + (S.squallMax - S.squallMin) * hash1((win * 668265263) ^ (seedInt + 0x9e37));
        winStart = (1 - span) * hash1((win * 2246822519) ^ (seedInt + 0x51ed));
        winEnd = winStart + span;
      } else {
        winAmp = 0; winStart = 2; winEnd = 2;    // no squall in this window
      }
    }
    // Storminess is quantised to 1/32 s. It drifts over minutes, so this is
    // invisible, and it keeps the two drift sines off the per-call path even
    // when a caller sweeps t (boats, particles, tuning scripts).
    const SW_Q = 32, SW_IQ = 1 / 32;
    let swellT = NaN, swellV = S.base;
    function computeSwell(t) {
      let s = S.base
        + S.driftA * Math.sin(t * S.freqA + S.phaseA)
        + S.driftB * Math.sin(t * S.freqB + S.phaseB);
      // One dice roll per squallPeriod window, keyed off the seed, so the
      // weather is identical across reloads of the same save.
      const u = t / S.squallPeriod;
      const win = Math.floor(u);
      if (win !== winC) syncWindow(win);
      if (winAmp > 0) {
        const f = u - win;
        if (f >= winStart && f < winEnd) {
          // 1 - (2p-1)^2 : smooth rise, a plateau of real misery, smooth fade
          const p = 2 * ((f - winStart) / S.squallSpan) - 1;
          s += winAmp * (1 - p * p);
        }
      }
      return s < S.min ? S.min : (s > S.max ? S.max : s);
    }
    function swell(t) {
      const tq = Math.floor(t * SW_Q) * SW_IQ;
      if (tq === swellT) return swellV;
      swellT = tq;
      swellV = computeSwell(tq);
      return swellV;
    }

    // --- shore break. 1 at the waterline, 0.5 at z = breakRange, ->0 offshore.
    // Steepens and shortens the waves so they pile up over the near rows of
    // tiles instead of marching past uniformly. Pure rational arithmetic.
    function breakerAmount(z) {
      if (z <= 0) return 1;
      const u = z * breakInv;
      return 1 / (1 + u * u);
    }

    // --- per-time constants. Every one of the ~21k height() calls in a frame
    // shares the same t, so this collapses to one branch per call.
    let tC = NaN, gainT = 1;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
    const bN = new Float64Array(N);
    function syncT(t) {
      tC = t;
      gainT = ampBase + ampSwell * swell(t);
      if (N === 4) {
        b0 = phT[0] - omT[0] * t; b1 = phT[1] - omT[1] * t;
        b2 = phT[2] - omT[2] * t; b3 = phT[3] - omT[3] * t;
      } else {
        for (let n = 0; n < N; n++) bN[n] = phT[n] - omT[n] * t;
      }
    }

    // Component scalars, hoisted completely out of the hot path.
    const kx0 = kxT[0], kz0 = kzT[0], a0 = amp[0], q0 = aSt[0];
    const kx1 = N > 1 ? kxT[1] : 0, kz1 = N > 1 ? kzT[1] : 0, a1 = N > 1 ? amp[1] : 0, q1 = N > 1 ? aSt[1] : 0;
    const kx2 = N > 2 ? kxT[2] : 0, kz2 = N > 2 ? kzT[2] : 0, a2 = N > 2 ? amp[2] : 0, q2 = N > 2 ? aSt[2] : 0;
    const kx3 = N > 3 ? kxT[3] : 0, kz3 = N > 3 ? kzT[3] : 0, a3 = N > 3 ? amp[3] : 0, q3 = N > 3 ? aSt[3] : 0;

    // Fast sine of an argument given in TURNS. Range reduction is one
    // Math.floor; the curve is the classic parabola pair
    //   y = 4h(1-|h|)        (h in half-turns)
    //   y = y*(0.775 + 0.225*|y|)
    // whose worst-case error is ~0.0012 — about 0.4 mm on a 0.36 m wave, i.e.
    // visually identical to Math.sin at a fraction of the cost. A GLSL port
    // should just use sin(2*PI*arg); the difference is below a pixel.
    function fsin(turns) {
      const r = turns - Math.floor(turns + 0.5);   // -> [-0.5, 0.5]
      const h = r + r;                             // -> [-1, 1]
      const y = h * (4 - 4 * (h < 0 ? -h : h));
      return y * (0.775 + 0.225 * (y < 0 ? -y : y));
    }

    // --- THE hot one: straight-line sum over the four baked components.
    function height4(x, z, t) {
      if (t !== tC) syncT(t);
      const u = z * breakInv;
      const ba = z > 0 ? 1 / (1 + u * u) : 1;
      const sh = 1 + breakShorten * ba;             // wavelength compression
      const q = skewBase + skewBreak * ba;          // crest sharpening
      const gain = gainT * (1 + breakShoal * ba) / (nrmA + nrmB * ba);

      let p = (kx0 * x + kz0 * z) * sh + b0;
      p -= Math.floor(p + 0.5);
      let h = p + p;
      let s0 = h * (4 - 4 * (h < 0 ? -h : h));
      s0 *= (0.775 + 0.225 * (s0 < 0 ? -s0 : s0));

      p = (kx1 * x + kz1 * z) * sh + b1;
      p -= Math.floor(p + 0.5);
      h = p + p;
      let s1 = h * (4 - 4 * (h < 0 ? -h : h));
      s1 *= (0.775 + 0.225 * (s1 < 0 ? -s1 : s1));

      p = (kx2 * x + kz2 * z) * sh + b2;
      p -= Math.floor(p + 0.5);
      h = p + p;
      let s2 = h * (4 - 4 * (h < 0 ? -h : h));
      s2 *= (0.775 + 0.225 * (s2 < 0 ? -s2 : s2));

      p = (kx3 * x + kz3 * z) * sh + b3;
      p -= Math.floor(p + 0.5);
      h = p + p;
      let s3 = h * (4 - 4 * (h < 0 ? -h : h));
      s3 *= (0.775 + 0.225 * (s3 < 0 ? -s3 : s3));

      // linear part + the mean-zero skew part (sharp crests, flat troughs)
      const lin = a0 * s0 + a1 * s1 + a2 * s2 + a3 * s3;
      const skw = q0 * (s0 * s0 - 0.5) + q1 * (s1 * s1 - 0.5)
        + q2 * (s2 * s2 - 0.5) + q3 * (s3 * s3 - 0.5);
      return (lin + q * skw) * gain;
    }

    // Generic fallback if someone hands us a table that is not 4 components.
    function heightN(x, z, t) {
      if (t !== tC) syncT(t);
      const u = z * breakInv;
      const ba = z > 0 ? 1 / (1 + u * u) : 1;
      const sh = 1 + breakShorten * ba;
      const q = skewBase + skewBreak * ba;
      const gain = gainT * (1 + breakShoal * ba) / (nrmA + nrmB * ba);
      let lin = 0, skw = 0;
      for (let n = 0; n < N; n++) {
        const s = fsin((kxT[n] * x + kzT[n] * z) * sh + bN[n]);
        lin += amp[n] * s;
        skw += aSt[n] * (s * s - 0.5);
      }
      return (lin + q * skw) * gain;
    }

    const height = (N === 4) ? height4 : heightN;

    const eps = W.normalEps, invEps = 1 / W.normalEps;
    function normal(x, z, t, out) {
      const h0 = height(x, z, t);
      const nx = -(height(x + eps, z, t) - h0) * invEps;
      const nz = -(height(x, z + eps, t) - h0) * invEps;
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);   // no Math.hypot
      const o = out || { x: 0, y: 0, z: 0 };              // never constructs a THREE type
      if (o.set) o.set(nx * inv, inv, nz * inv);
      else { o.x = nx * inv; o.y = inv; o.z = nz * inv; }
      return o;
    }

    // Convenience: the same wave-energy scalar the tile sim uses for damage.
    // Handy for foam intensity, the surf audio bed, boat rocking, camera shake.
    const D = TUNING.damage;
    function energy(x, z, t) {
      const sw = swell(t);
      const ba = breakerAmount(z);
      const h = height(x, z, t);
      const ah = h < 0 ? -h : h;
      let r = ah * D.hrefInv;
      if (r > 2) r = 2;
      return (D.base + D.swell * sw) * (1 + D.breaker * ba + D.deep * (1 - ba)) * (D.calm + D.wave * r);
    }

    return {
      height: height,
      normal: normal,
      swell: swell,
      breakerAmount: breakerAmount,
      energy: energy,
      components: src,     // the exact table this field was built from
      steepAvg: steepAvg,  // the derived renormaliser, for the GLSL port
      seed: seedInt
    };
  }

  // ===========================================================================
  // 2. TILE SIM — authoritative game state   (no THREE)
  //
  // Flat typed arrays over the whole 129 x 401 grid (~0.8 MB) keyed by packed
  // index, plus two swap-removal lists:
  //   liveKeys — every placed tile (for forEach / serialize)
  //   expKeys  — only tiles with a missing neighbour, i.e. the frontier.
  // update() walks expKeys ONLY, so per-frame cost is proportional to the
  // perimeter, not the area. Interior tiles cost nothing and take no damage.
  // ===========================================================================
  function createTileSim(opts) {
    opts = opts || {};
    const waves = opts.waves;
    const tiers = normalizeTiers(opts.tiers);
    const rnd = mulberry32(hashSeed(opts.seed == null ? 'balat' : opts.seed));

    const tier = new Int8Array(CELLS).fill(-1);
    const hp = new Float32Array(CELLS);
    const maxHp = new Float32Array(CELLS);
    const bornAt = new Float32Array(CELLS);

    const liveSlot = new Int32Array(CELLS).fill(-1);
    const liveKeys = [];
    const expSlot = new Int32Array(CELLS).fill(-1);
    const expKeys = [];

    const destroyed = [];        // reused: cleared, not reallocated, each update
    const scratch = { i: 0, j: 0, tier: 0, hp: 0, maxHp: 0, placedAt: 0 };
    let maxJ = -1;

    function keyOf(i, j) { return j * GRID_W + (i - I_MIN); }
    function inRange(i, j) { return i >= I_MIN && i <= I_MAX && j >= J_MIN && j <= J_MAX; }

    // --- membership bookkeeping (O(1) swap removal) ---------------------------
    function listAdd(keys, slot, key) {
      if (slot[key] >= 0) return;
      slot[key] = keys.length;
      keys.push(key);
    }
    function listDel(keys, slot, key) {
      const s = slot[key];
      if (s < 0) return;
      const last = keys.pop();
      if (last !== key) { keys[s] = last; slot[last] = s; }
      slot[key] = -1;
    }

    // Missing orthogonal neighbours, 0..4. The shoreward side of row j = 0 is
    // the shore itself, which never washes away — that is what makes j = 0
    // placeable and the first row comparatively tough. The i edges of the grid
    // count as open sea.
    function missingCount(key, j) {
      const i = key - j * GRID_W + I_MIN;
      let m = 0;
      if (i <= I_MIN || tier[key - 1] < 0) m++;                 // west
      if (i >= I_MAX || tier[key + 1] < 0) m++;                 // east
      if (j > 0 && tier[key - GRID_W] < 0) m++;                 // shoreward
      if (j >= J_MAX || tier[key + GRID_W] < 0) m++;            // seaward
      return m;
    }

    // Keep `key` in expKeys iff it is a live tile with at least one open side.
    function refreshExp(key, j) {
      if (tier[key] >= 0 && missingCount(key, j) > 0) listAdd(expKeys, expSlot, key);
      else listDel(expKeys, expSlot, key);
    }
    function refreshNeighbourhood(i, j) {
      const key = keyOf(i, j);
      refreshExp(key, j);
      if (i > I_MIN) refreshExp(key - 1, j);
      if (i < I_MAX) refreshExp(key + 1, j);
      if (j > J_MIN) refreshExp(key - GRID_W, j - 1);
      if (j < J_MAX) refreshExp(key + GRID_W, j + 1);
    }

    // --- queries -------------------------------------------------------------
    function isSupported(i, j) {
      if (!inRange(i, j)) return false;
      if (j === J_MIN) return true;                              // against the shore
      const key = keyOf(i, j);
      if (i > I_MIN && tier[key - 1] >= 0) return true;
      if (i < I_MAX && tier[key + 1] >= 0) return true;
      if (tier[key - GRID_W] >= 0) return true;
      if (j < J_MAX && tier[key + GRID_W] >= 0) return true;
      return false;
    }

    // Geometric, so it also answers "how dangerous is this cell?" for a
    // placement preview, whether or not the cell is currently occupied.
    function exposure(i, j) {
      if (!inRange(i, j)) return 1;
      const T = TUNING.tiles;
      const miss = missingCount(keyOf(i, j), j);
      if (miss === 0) return 0;                                  // interior: untouchable
      const frac = miss * 0.25;
      // expCurve is 2 by default, so this is a multiply, not a Math.pow
      const bite = T.expCurve === 2 ? frac * frac : Math.pow(frac, T.expCurve);
      const depthF = j >= T.depthFullJ ? 1 : j / T.depthFullJ;
      return clamp(bite * (T.expShoreW + (1 - T.expShoreW) * depthF), 0, 1);
    }

    // The slab footprint must clear the stair flight.
    function blockedByNoBuild(i, j) {
      const nb = TUNING.tiles.noBuild;
      if (!nb) return false;
      const hx = SLAB * 0.5;
      const cx = i * CELL, cz = Z0 + j * CELL;
      return (cx + hx > nb.x1) && (cx - hx < nb.x2) && (cz + hx > nb.z1) && (cz - hx < nb.z2);
    }

    function canPlace(i, j) {
      return inRange(i, j) && tier[keyOf(i, j)] < 0 && !blockedByNoBuild(i, j) && isSupported(i, j);
    }

    // --- mutation ------------------------------------------------------------
    function place(i, j, tierIdx, t) {
      i = i | 0; j = j | 0;
      tierIdx = tierIdx | 0;
      if (tierIdx < 0 || tierIdx >= tiers.length) return false;
      if (!canPlace(i, j)) return false;
      // +/- hpJitter on max hp: a frontier row must not fail as one synchronised
      // block, it has to fray.
      const m = tiers[tierIdx].hp * (1 + (rnd() * 2 - 1) * TUNING.tiles.hpJitter);
      const key = keyOf(i, j);
      tier[key] = tierIdx;
      maxHp[key] = m;
      hp[key] = m;
      bornAt[key] = t || 0;
      listAdd(liveKeys, liveSlot, key);
      if (j > maxJ) maxJ = j;
      refreshNeighbourhood(i, j);
      return true;
    }

    function removeKey(key, i, j) {
      tier[key] = -1;
      hp[key] = 0; maxHp[key] = 0; bornAt[key] = 0;
      listDel(liveKeys, liveSlot, key);
      listDel(expKeys, expSlot, key);
      refreshNeighbourhood(i, j);
    }

    function remove(i, j) {
      i = i | 0; j = j | 0;
      if (!inRange(i, j)) return false;
      const key = keyOf(i, j);
      if (tier[key] < 0) return false;
      removeKey(key, i, j);
      return true;
    }

    function get(i, j) {
      if (!inRange(i, j)) return null;
      const key = keyOf(i, j);
      if (tier[key] < 0) return null;
      // Fresh object: this is a UI/inspection path, not a hot path.
      return { i: i, j: j, tier: tier[key], hp: hp[key], maxHp: maxHp[key], placedAt: bornAt[key] };
    }

    // --- damage --------------------------------------------------------------
    function update(dt, t) {
      destroyed.length = 0;
      if (!(dt > 0) || !waves) return destroyed;
      const D = TUNING.damage;
      const T = TUNING.tiles;
      const rate = D.baseDamage * dt;
      // swell is global and cached in the wave field: hoist it out of the loop.
      const swellTerm = D.base + D.swell * waves.swell(t);
      const depthFullJ = T.depthFullJ, shoreW = T.expShoreW, deepW = 1 - T.expShoreW;
      const curve = T.expCurve, sqCurve = (curve === 2);
      const href = D.hrefInv, kBreak = D.breaker, kDeep = D.deep, kCalm = D.calm, kWave = D.wave;

      // Walk backwards: destroying a tile swap-removes at `s` (pulling in an
      // already-visited element) and may append newly-exposed neighbours at the
      // end. Both are safe for a descending walk — a tile that only just became
      // frontier simply starts eroding on the next step.
      for (let s = expKeys.length - 1; s >= 0; s--) {
        const key = expKeys[s];
        const j = (key / GRID_W) | 0;
        const i = key - j * GRID_W + I_MIN;

        // A fully surrounded tile is taken off the frontier list and takes zero
        // damage. This is the one invariant the whole design rests on.
        const miss = missingCount(key, j);
        if (miss === 0) { listDel(expKeys, expSlot, key); continue; }
        const frac = miss * 0.25;
        const bite = sqCurve ? frac * frac : Math.pow(frac, curve);
        const depthF = j >= depthFullJ ? 1 : j / depthFullJ;
        let ex = bite * (shoreW + deepW * depthF);
        if (ex > 1) ex = 1;

        const x = i * CELL, z = Z0 + j * CELL;
        const ba = waves.breakerAmount(z);
        const h = waves.height(x, z, t);
        const ah = h < 0 ? -h : h;
        let r = ah * href;
        if (r > 2) r = 2;
        const energy = swellTerm * (1 + kBreak * ba + kDeep * (1 - ba)) * (kCalm + kWave * r);

        const nh = hp[key] - rate * ex * energy;
        if (nh <= 0) {
          destroyed.push({ i: i, j: j, tier: tier[key] });
          removeKey(key, i, j);
        } else {
          hp[key] = nh;
        }
      }
      return destroyed;
    }

    // --- world-space lookup, called every frame by the player body ----------
    function solidAt(x, z) {
      const i = Math.round(x * INV_CELL);
      const j = Math.round((z - Z0) * INV_CELL);
      if (i < I_MIN || i > I_MAX || j < J_MIN || j > J_MAX) return null;
      return tier[j * GRID_W + (i - I_MIN)] >= 0 ? TILE_TOP : null;
    }

    // NOTE: `cb` receives a REUSED scratch object (this gets called per frame to
    // rebuild the tile InstancedMesh). Copy the fields if you keep them.
    function forEach(cb) {
      for (let s = 0; s < liveKeys.length; s++) {
        const key = liveKeys[s];
        const j = (key / GRID_W) | 0;
        scratch.i = key - j * GRID_W + I_MIN;
        scratch.j = j;
        scratch.tier = tier[key];
        scratch.hp = hp[key];
        scratch.maxHp = maxHp[key];
        scratch.placedAt = bornAt[key];
        cb(scratch);
      }
    }

    function clear() {
      for (let s = 0; s < liveKeys.length; s++) {
        const key = liveKeys[s];
        tier[key] = -1; hp[key] = 0; maxHp[key] = 0; bornAt[key] = 0;
        liveSlot[key] = -1; expSlot[key] = -1;
      }
      liveKeys.length = 0;
      expKeys.length = 0;
      maxJ = -1;
    }

    // Flat plain array: [i, j, tier, hp, maxHp] x n. Cheap to JSON, cheap to load.
    function serialize() {
      const d = new Array(liveKeys.length * 5);
      let w = 0;
      for (let s = 0; s < liveKeys.length; s++) {
        const key = liveKeys[s];
        const j = (key / GRID_W) | 0;
        d[w++] = key - j * GRID_W + I_MIN;
        d[w++] = j;
        d[w++] = tier[key];
        d[w++] = Math.round(hp[key] * 100) / 100;
        d[w++] = Math.round(maxHp[key] * 100) / 100;
      }
      return { v: 1, n: liveKeys.length, d: d };
    }

    function load(data) {
      clear();
      if (!data) return 0;
      const d = data.d || data;
      if (!d || !d.length) return 0;
      // Placement order in a save need not satisfy support incrementally, so we
      // write cells directly and fix up exposure in one pass afterwards.
      let n = 0;
      for (let p = 0; p + 4 < d.length; p += 5) {
        const i = d[p] | 0, j = d[p + 1] | 0, tx = d[p + 2] | 0;
        if (!inRange(i, j) || tx < 0 || tx >= tiers.length) continue;
        const key = keyOf(i, j);
        if (tier[key] >= 0) continue;
        const mv = (typeof d[p + 4] === 'number' && d[p + 4] > 0) ? d[p + 4] : tiers[tx].hp;
        const hv = (typeof d[p + 3] === 'number' && d[p + 3] > 0) ? Math.min(d[p + 3], mv) : mv;
        tier[key] = tx; maxHp[key] = mv; hp[key] = hv; bornAt[key] = 0;
        listAdd(liveKeys, liveSlot, key);
        if (j > maxJ) maxJ = j;
        n++;
      }
      for (let s = 0; s < liveKeys.length; s++) {
        const key = liveKeys[s];
        refreshExp(key, (key / GRID_W) | 0);
      }
      return n;
    }

    const sim = {
      place: place,
      remove: remove,
      get: get,
      isSupported: isSupported,
      canPlace: canPlace,
      exposure: exposure,
      update: update,
      solidAt: solidAt,
      forEach: forEach,
      clear: clear,
      serialize: serialize,
      load: load,
      tiers: tiers,
      // grid metadata so game.js never hardcodes these again
      CELL: CELL, Z0: Z0, TILE_TOP: TILE_TOP,
      I_MIN: I_MIN, I_MAX: I_MAX, J_MIN: J_MIN, J_MAX: J_MAX,
      cellToWorld: function (i, j, out) {
        const o = out || { x: 0, y: 0, z: 0 };
        o.x = i * CELL; o.y = TILE_TOP; o.z = Z0 + j * CELL;
        return o;
      },
      worldToCell: function (x, z, out) {
        const o = out || { i: 0, j: 0 };
        o.i = Math.round(x * INV_CELL);
        o.j = Math.round((z - Z0) * INV_CELL);
        return o;
      }
    };
    Object.defineProperty(sim, 'count', { get: function () { return liveKeys.length; } });
    Object.defineProperty(sim, 'frontierCount', { get: function () { return expKeys.length; } });
    Object.defineProperty(sim, 'maxJ', { get: function () { return maxJ; } });
    // metres of sea conquered, for the HUD
    Object.defineProperty(sim, 'metresOut', { get: function () { return maxJ < 0 ? 0 : Z0 + maxJ * CELL; } });
    return sim;
  }

  // ===========================================================================
  // 3. PLAYER BODY — kinematic capsule, feet at pos.
  //
  // world.landColliders is the authoritative solid set: the deck, the stair
  // treads, the apron, the causeway, kerbs, railings. Collisions resolve
  // axis-by-axis so the body slides along the deck's sea wall instead of
  // sticking to it.
  // ===========================================================================
  function createPlayerBody(opts) {
    opts = opts || {};
    const sim = opts.sim || null;
    const world = opts.world || {};

    // Flatten the collider list once: normalised bounds in typed arrays so the
    // per-frame sweep is a tight numeric loop. `bottom` is optional — if
    // world.js ever authors real walls with a base, we respect it.
    const src = world.landColliders || [];
    const nCol = src.length;
    const cx1 = new Float64Array(nCol), cx2 = new Float64Array(nCol);
    const cz1 = new Float64Array(nCol), cz2 = new Float64Array(nCol);
    const ctop = new Float64Array(nCol), cbot = new Float64Array(nCol);
    for (let n = 0; n < nCol; n++) {
      const c = src[n];
      cx1[n] = Math.min(c.x1, c.x2); cx2[n] = Math.max(c.x1, c.x2);
      cz1[n] = Math.min(c.z1, c.z2); cz2[n] = Math.max(c.z1, c.z2);
      ctop[n] = c.top;
      cbot[n] = (typeof c.bottom === 'number') ? c.bottom
        : (typeof c.y1 === 'number' ? c.y1 : -Infinity);
    }

    const pos = makeVec3(0, 1.5, -14);     // start on the corniche deck
    const vel = makeVec3(0, 0, 0);
    const body = {
      pos: pos,
      vel: vel,
      inWater: false,
      grounded: false,
      // the cell the player is standing on, or null. A NEW object is allocated
      // only when the cell changes, so `prev !== body.onTile` is a valid test
      // for "I moved to another balata / the sea took the one under me".
      onTile: null,
      // extras game.js will want
      radius: TUNING.player.radius,
      height: TUNING.player.height,
      eyeHeight: TUNING.player.eyeHeight,
      speed: 0,                 // horizontal speed, for footstep cadence / anim
      enteredWaterThisStep: false,
      leftWaterThisStep: false,
      landedThisStep: false,
      landImpact: 0,            // |vy| at touchdown, for splash/dust strength
      climbProgress: 0
    };

    let climbT = 0;

    // Highest surface under (x,z), ignoring reachability. Used for haul-out and
    // for the ledge guard.
    function ledgeTop(x, z) {
      let best = -Infinity;
      if (sim) {
        const ts = sim.solidAt(x, z);
        if (ts !== null && ts > best) best = ts;
      }
      for (let n = 0; n < nCol; n++) {
        if (x >= cx1[n] && x <= cx2[n] && z >= cz1[n] && z <= cz2[n] && ctop[n] > best) best = ctop[n];
      }
      return best === -Infinity ? null : best;
    }

    // Highest surface under (x,z) that the feet could stand on, i.e. no more
    // than stepUp above them. This is what walks the body up the 0.24 m stair
    // risers and the 0.30 m tile lip without a jump, while leaving the 1.5 m
    // corniche wall unclimbable. Surfaces BELOW the feet are returned too — the
    // caller decides whether that is a step down or a fall.
    function groundAt(x, z, feetY) {
      const lim = feetY + TUNING.player.stepUp;
      let best = -Infinity;
      if (sim) {
        const ts = sim.solidAt(x, z);
        if (ts !== null && ts <= lim) best = ts;
      }
      for (let n = 0; n < nCol; n++) {
        if (x >= cx1[n] && x <= cx2[n] && z >= cz1[n] && z <= cz2[n]) {
          const tp = ctop[n];
          if (tp <= lim && tp > best) best = tp;
        }
      }
      return best === -Infinity ? null : best;
    }

    // The single-point probe above drops the body through hairline seams between
    // neighbouring surfaces — the stair apron ends at z = 2.9 while tile row
    // j = 0 starts at z = 3.0, so a 0.1 m crack sits right where the player
    // walks out onto their first balata. That reads as a stutter and flickers
    // `grounded`.
    //
    // So: if the centre finds nothing, bridge the gap ONLY when both sides of
    // the same axis are supported, which is what distinguishes a seam from a
    // ledge. A real edge (the deck's seaward lip, the tile frontier) has
    // nothing on the far side, so it still drops you exactly at the edge.
    // Costs nothing while the centre is supported, which is almost always.
    function supportAt(x, z, feetY) {
      const g = groundAt(x, z, feetY);
      if (g !== null) return g;
      const r = TUNING.player.radius * 0.75;
      let best = -Infinity;
      const xp = groundAt(x + r, z, feetY), xm = groundAt(x - r, z, feetY);
      if (xp !== null && xm !== null) best = xp > xm ? xp : xm;
      const zp = groundAt(x, z + r, feetY), zm = groundAt(x, z - r, feetY);
      if (zp !== null && zm !== null) {
        const b = zp > zm ? zp : zm;
        if (b > best) best = b;
      }
      return best === -Infinity ? null : best;
    }

    // A box blocks horizontally only if its top is more than stepUp above the
    // feet (so treads are walked over, not bumped into) and its body actually
    // spans the player's vertical extent.
    function blocks(n, feetY) {
      const P = TUNING.player;
      if (ctop[n] - feetY <= P.stepUp) return false;
      return cbot[n] < feetY + P.height;
    }

    function resolveX(prevX) {
      const rad = TUNING.player.radius;
      for (let n = 0; n < nCol; n++) {
        if (!blocks(n, pos.y)) continue;
        if (pos.z + rad <= cz1[n] || pos.z - rad >= cz2[n]) continue;
        if (pos.x + rad <= cx1[n] || pos.x - rad >= cx2[n]) continue;
        if (prevX <= cx1[n]) pos.x = cx1[n] - rad;
        else if (prevX >= cx2[n]) pos.x = cx2[n] + rad;
        else pos.x = prevX;                       // already inside: do not tunnel
        vel.x = 0;
      }
    }
    function resolveZ(prevZ) {
      const rad = TUNING.player.radius;
      for (let n = 0; n < nCol; n++) {
        if (!blocks(n, pos.y)) continue;
        if (pos.x + rad <= cx1[n] || pos.x - rad >= cx2[n]) continue;
        if (pos.z + rad <= cz1[n] || pos.z - rad >= cz2[n]) continue;
        if (prevZ <= cz1[n]) pos.z = cz1[n] - rad;
        else if (prevZ >= cz2[n]) pos.z = cz2[n] + rad;
        else pos.z = prevZ;
        vel.z = 0;
      }
    }

    // Would stepping to (x,z) walk us off a drop we should not be allowed to
    // take? Only ever true up on the deck / causeway, never at sea level.
    function ledgeBlocked(x, z, feetY) {
      const P = TUNING.player;
      if (!P.ledgeGuard || feetY < P.ledgeGuardMinY) return false;
      const g = supportAt(x, z, feetY);
      return g === null || (feetY - g) > P.stepDown;
    }

    function clampBounds() {
      const P = TUNING.player;
      if (pos.x < -P.boundsX) pos.x = -P.boundsX;
      if (pos.x > P.boundsX) pos.x = P.boundsX;
      if (pos.z < P.boundsZmin) pos.z = P.boundsZmin;
      if (pos.z > P.boundsZmax) pos.z = P.boundsZmax;
    }

    const cellTmp = { i: 0, j: 0 };
    function updateOnTile() {
      if (!sim || body.inWater || !body.grounded || Math.abs(pos.y - TILE_TOP) > 0.03
        || sim.solidAt(pos.x, pos.z) === null) {
        body.onTile = null;
        return;
      }
      sim.worldToCell(pos.x, pos.z, cellTmp);
      const cur = body.onTile;
      if (!cur || cur.i !== cellTmp.i || cur.j !== cellTmp.j) {
        body.onTile = { i: cellTmp.i, j: cellTmp.j };   // only on change
      }
    }

    function step(dt, t, input, waves) {
      const P = TUNING.player;
      if (!(dt > 0)) return body;
      if (dt > P.maxDt) dt = P.maxDt;
      input = input || {};
      body.enteredWaterThisStep = false;
      body.leftWaterThisStep = false;
      body.landedThisStep = false;

      // input already arrives rotated into world axes — just consume it
      let mx = input.moveX || 0, mz = input.moveZ || 0;
      const mlen = Math.sqrt(mx * mx + mz * mz);
      if (mlen > 1) { mx /= mlen; mz /= mlen; }

      const surf = waves ? waves.height(pos.x, pos.z, t) : 0;

      if (body.inWater) stepWater(dt, mx, mz, mlen, input, surf);
      else stepLand(dt, mx, mz, input, surf);

      clampBounds();
      body.speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      body.climbProgress = climbT / P.climbTime;
      updateOnTile();
      return body;
    }

    function stepLand(dt, mx, mz, input, surf) {
      const P = TUNING.player;
      const wasGrounded = body.grounded;
      const target = (input.run ? P.runSpeed : P.walkSpeed);
      const acc = (wasGrounded ? P.accel : P.airAccel) * dt;

      // accelerate toward the desired velocity; friction only on the ground and
      // only with no input, so stopping has a little slide to it
      const dvx = mx * target - vel.x, dvz = mz * target - vel.z;
      const dl = Math.sqrt(dvx * dvx + dvz * dvz);
      if (dl > 1e-5) {
        const s = dl > acc ? acc / dl : 1;
        vel.x += dvx * s; vel.z += dvz * s;
      }
      if (wasGrounded && mx === 0 && mz === 0) {
        const f = 1 - P.friction * dt;
        const k = f < 0 ? 0 : f;
        vel.x *= k; vel.z *= k;
      }

      let jumped = false;
      if (wasGrounded && input.jump) {
        vel.y = P.jumpVel;
        body.grounded = false;
        jumped = true;
      }
      vel.y -= P.gravity * dt;

      const feetBefore = pos.y;

      // --- horizontal, axis by axis, so we slide along walls ----------------
      const prevX = pos.x, prevZ = pos.z;
      pos.x += vel.x * dt;
      resolveX(prevX);
      if (wasGrounded && !jumped && pos.x !== prevX && ledgeBlocked(pos.x, pos.z, feetBefore)) {
        pos.x = prevX; vel.x = 0;
      }
      pos.z += vel.z * dt;
      resolveZ(prevZ);
      if (wasGrounded && !jumped && pos.z !== prevZ && ledgeBlocked(pos.x, pos.z, feetBefore)) {
        pos.z = prevZ; vel.z = 0;
      }

      // --- vertical ---------------------------------------------------------
      const g = supportAt(pos.x, pos.z, feetBefore);
      const stickDown = wasGrounded && !jumped && vel.y <= 0;

      if (g !== null && g > feetBefore) {
        // stepping UP a lip (stair riser, tile edge, kerb): lift the feet at a
        // bounded rate so it reads as a stride, not a teleport
        pos.y = feetBefore + Math.min(g - feetBefore, P.stepRate * dt);
        if (pos.y >= g) pos.y = g;
        vel.y = 0;
        body.grounded = true;
      } else if (stickDown && g !== null && (feetBefore - g) <= P.stepDown) {
        // stepping DOWN a lip: snap (rate-limited) and stay grounded, so walking
        // a flight of stairs is not five little falls
        pos.y = feetBefore - Math.min(feetBefore - g, Math.max(P.stepRate * dt, 0.02));
        if (pos.y <= g) pos.y = g;
        vel.y = 0;
        body.grounded = true;
      } else {
        // ballistic
        pos.y += vel.y * dt;
        if (g !== null && pos.y <= g && vel.y <= 0) {
          if (!wasGrounded) { body.landedThisStep = true; body.landImpact = Math.abs(vel.y); }
          pos.y = g;
          vel.y = 0;
          body.grounded = true;
        } else {
          body.grounded = false;
          if (g === null && pos.y < surf - P.enterDepth) {
            body.inWater = true;
            body.enteredWaterThisStep = true;
            body.landImpact = Math.abs(vel.y);
            climbT = 0;
            // keep some horizontal momentum, kill most of the plunge
            vel.y *= 0.25; vel.x *= 0.45; vel.z *= 0.45;
          }
        }
      }
    }

    function stepWater(dt, mx, mz, mlen, input, surf) {
      const P = TUNING.player;

      // Standing on a tile with the wash going over you is not swimming. This
      // is also how a tile placed under a swimmer rescues them.
      const under = ledgeTop(pos.x, pos.z);
      if (under !== null && under > surf - P.wadeDepth && under < surf + P.climbMaxRise) {
        pos.y = under;
        vel.y = 0;
        body.inWater = false;
        body.leftWaterThisStep = true;
        body.grounded = true;
        climbT = 0;
        return;
      }

      // Buoyancy spring: the body bobs on the wave field with its head out.
      const targetY = surf - P.floatDepth;
      vel.y += ((targetY - pos.y) * P.buoyK - vel.y * P.buoyDamp) * dt;

      // Swimming: slow, mushy, embarrassing. Punishment, not death.
      const k = Math.min(1, P.swimAccel * dt);
      vel.x += (mx * P.swimSpeed - vel.x) * k;
      vel.z += (mz * P.swimSpeed - vel.z) * k;
      const d = 1 - P.swimDrag * dt;
      const dk = d < 0 ? 0 : d;
      vel.x *= dk; vel.z *= dk;

      const prevX = pos.x, prevZ = pos.z;
      pos.x += vel.x * dt; resolveX(prevX);
      pos.z += vel.z * dt; resolveZ(prevZ);
      pos.y += vel.y * dt;

      // Haul-out: push into an adjacent ledge (a tile at 0.3, or the stair
      // apron) for climbTime seconds, or hit jump to skip the wait. The deck at
      // y = 1.5 is out of reach on purpose — the stairs are the way back up.
      if (mlen > 0.1) {
        const inv = 1 / Math.max(1e-4, Math.sqrt(mx * mx + mz * mz));
        const px = pos.x + mx * inv * P.climbReach;
        const pz = pos.z + mz * inv * P.climbReach;
        const ledge = ledgeTop(px, pz);
        if (ledge !== null && ledge - surf < P.climbMaxRise && ledge - surf > -0.6) {
          climbT += dt;
          if (climbT >= P.climbTime || input.jump) {
            pos.x = px; pos.z = pz; pos.y = ledge;
            vel.set(0, 0, 0);
            body.inWater = false;
            body.leftWaterThisStep = true;
            body.grounded = true;
            climbT = 0;
          }
        } else {
          climbT = 0;
        }
      } else {
        climbT = 0;
      }
    }

    body.step = step;
    body.teleport = function (x, y, z) {
      pos.set(x, y, z);
      vel.set(0, 0, 0);
      body.inWater = false;
      body.grounded = false;
      body.onTile = null;
      climbT = 0;
      return body;
    };
    body.groundAt = groundAt;      // useful for the game's placement validation
    body.ledgeTop = ledgeTop;
    return body;
  }

  // ===========================================================================
  // 4. SPLASHES / DEBRIS — one pooled THREE.Points (+ a debris Points parented
  // to it, so water can be additive and grey rubble can be plain while
  // `fx.object` stays the single THREE.Points you add to the scene).
  // r128-safe: BufferGeometry + BufferAttribute + ShaderMaterial + CanvasTexture.
  // ===========================================================================
  const PARTICLE_VS = [
    'attribute float aSize;',
    'attribute float aAlpha;',
    'attribute vec3 aColor;',
    'uniform float uScale;',
    'varying float vA;',
    'varying vec3 vC;',
    'void main() {',
    '  vA = aAlpha; vC = aColor;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = max(1.0, aSize * (uScale / max(0.001, -mv.z)));',
    '}'
  ].join('\n');

  const PARTICLE_FS = [
    'uniform sampler2D uMap;',
    'uniform float uBright;',
    'varying float vA;',
    'varying vec3 vC;',
    'void main() {',
    '  vec4 s = texture2D(uMap, gl_PointCoord);',
    '  float a = s.a * vA;',
    '  if (a < 0.01) discard;',
    '  gl_FragColor = vec4(vC * uBright, a);',
    '}'
  ].join('\n');

  // Soft round sprite, generated once on an offscreen canvas. No network assets.
  function makeSpriteTexture(THREE) {
    const S = 64;
    const cv = (typeof document !== 'undefined' && document.createElement)
      ? document.createElement('canvas') : null;
    if (!cv) return null;
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    // bright core, fast but smooth falloff: reads as a droplet when small and
    // as a puff of spray when scaled up
    grd.addColorStop(0.00, 'rgba(255,255,255,1.00)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.78)');
    grd.addColorStop(0.68, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  function createSplashes(THREEin, opts) {
    const THREE = THREEin || global.THREE;
    opts = opts || {};
    const palette = opts.palette || {};
    let waves = opts.waves || null;   // optional: droplets then die on the real surface
    const F = TUNING.fx;
    const tex = makeSpriteTexture(THREE);

    const FOAM = hexToRgb(palette.FOAM || '#EDF6F3', [0, 0, 0]);
    const SHALLOW = hexToRgb(palette.SEA_SHALLOW || '#3FA8B4', [0, 0, 0]);
    const MID = hexToRgb(palette.SEA_MID || '#16708C', [0, 0, 0]);
    const CEMENT = hexToRgb(palette.CEMENT || '#9AA0A0', [0, 0, 0]);
    const STONE = hexToRgb(palette.STONE_DARK || '#A08F6A', [0, 0, 0]);
    const TERRA = hexToRgb(palette.TERRACOTTA || '#B9502F', [0, 0, 0]);
    const LIME = hexToRgb(palette.LIMESTONE || '#E4D7B3', [0, 0, 0]);

    const rnd = mulberry32(0x5eaf0a);
    let clock = 0;

    // --- pool factory. Everything is preallocated; spawn() drops on overflow
    // rather than growing, and update() never allocates.
    function makePool(max, blending, bright) {
      const position = new Float32Array(max * 3);
      const aColor = new Float32Array(max * 3);
      const aSize = new Float32Array(max);
      const aAlpha = new Float32Array(max);
      const vx = new Float32Array(max), vy = new Float32Array(max), vz = new Float32Array(max);
      const life = new Float32Array(max), ttl = new Float32Array(max);
      const size0 = new Float32Array(max), grav = new Float32Array(max);
      let n = 0;

      const geo = new THREE.BufferGeometry();
      const pAttr = new THREE.BufferAttribute(position, 3);
      const cAttr = new THREE.BufferAttribute(aColor, 3);
      const sAttr = new THREE.BufferAttribute(aSize, 1);
      const aAttr = new THREE.BufferAttribute(aAlpha, 1);
      geo.setAttribute('position', pAttr);
      geo.setAttribute('aColor', cAttr);
      geo.setAttribute('aSize', sAttr);
      geo.setAttribute('aAlpha', aAttr);
      geo.setDrawRange(0, 0);

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uScale: { value: F.pointScale },
          uBright: { value: bright }
        },
        vertexShader: PARTICLE_VS,
        fragmentShader: PARTICLE_FS,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: blending
      });

      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;      // positions churn; culling would be wrong
      points.renderOrder = 4;

      // swap-with-last compaction keeps live particles contiguous, so one
      // setDrawRange is all the GPU needs
      function swap(a, b) {
        if (a === b) return;
        const a3 = a * 3, b3 = b * 3;
        let tmp;
        tmp = position[a3]; position[a3] = position[b3]; position[b3] = tmp;
        tmp = position[a3 + 1]; position[a3 + 1] = position[b3 + 1]; position[b3 + 1] = tmp;
        tmp = position[a3 + 2]; position[a3 + 2] = position[b3 + 2]; position[b3 + 2] = tmp;
        tmp = aColor[a3]; aColor[a3] = aColor[b3]; aColor[b3] = tmp;
        tmp = aColor[a3 + 1]; aColor[a3 + 1] = aColor[b3 + 1]; aColor[b3 + 1] = tmp;
        tmp = aColor[a3 + 2]; aColor[a3 + 2] = aColor[b3 + 2]; aColor[b3 + 2] = tmp;
        tmp = aSize[a]; aSize[a] = aSize[b]; aSize[b] = tmp;
        tmp = aAlpha[a]; aAlpha[a] = aAlpha[b]; aAlpha[b] = tmp;
        tmp = vx[a]; vx[a] = vx[b]; vx[b] = tmp;
        tmp = vy[a]; vy[a] = vy[b]; vy[b] = tmp;
        tmp = vz[a]; vz[a] = vz[b]; vz[b] = tmp;
        tmp = life[a]; life[a] = life[b]; life[b] = tmp;
        tmp = ttl[a]; ttl[a] = ttl[b]; ttl[b] = tmp;
        tmp = size0[a]; size0[a] = size0[b]; size0[b] = tmp;
        tmp = grav[a]; grav[a] = grav[b]; grav[b] = tmp;
      }

      function spawn(x, y, z, sx, sy, sz, col, sz0, lifeS, gravity) {
        if (n >= max) return false;
        const k = n++, k3 = k * 3;
        position[k3] = x; position[k3 + 1] = y; position[k3 + 2] = z;
        vx[k] = sx; vy[k] = sy; vz[k] = sz;
        aColor[k3] = col[0]; aColor[k3 + 1] = col[1]; aColor[k3 + 2] = col[2];
        size0[k] = sz0; aSize[k] = sz0; aAlpha[k] = 0;
        life[k] = 0; ttl[k] = lifeS; grav[k] = gravity;
        return true;
      }

      function advance(dt, seaY, onDie) {
        const dragK = Math.max(0, 1 - F.drag * dt);
        for (let k = n - 1; k >= 0; k--) {
          life[k] += dt;
          const u = life[k] / ttl[k];
          if (u >= 1) { swap(k, n - 1); n--; continue; }
          const k3 = k * 3;
          vy[k] -= grav[k] * dt;
          vx[k] *= dragK; vz[k] *= dragK;
          position[k3] += vx[k] * dt;
          position[k3 + 1] += vy[k] * dt;
          position[k3 + 2] += vz[k] * dt;
          // die on the water surface
          if (position[k3 + 1] < seaY(position[k3], position[k3 + 2])) {
            if (onDie) onDie(position[k3], position[k3 + 1], position[k3 + 2]);
            swap(k, n - 1); n--; continue;
          }
          // puff out a little, then shrink; quick fade in, long fade out
          aSize[k] = size0[k] * (1 + 0.55 * u) * (u > 0.7 ? Math.max(0.05, 1 - (u - 0.7) * 2.2) : 1);
          if (u < 0.12) {
            aAlpha[k] = u / 0.12;
          } else {
            const f = 1 - (u - 0.12) / 0.88;
            aAlpha[k] = f * f;
          }
        }
        geo.setDrawRange(0, n);
        if (n > 0) {
          pAttr.needsUpdate = true; cAttr.needsUpdate = true;
          sAttr.needsUpdate = true; aAttr.needsUpdate = true;
        }
      }

      return {
        points: points, geo: geo, mat: mat, spawn: spawn, advance: advance,
        get live() { return n; },
        reset: function () { n = 0; geo.setDrawRange(0, 0); }
      };
    }

    // water: additive, so foam over the dark sea reads as bright spray
    const water = makePool(F.waterMax, THREE.AdditiveBlending, 1.0);
    // debris: plain alpha, so grey rubble stays grey and does not glow
    const debris = makePool(F.debrisMax, THREE.NormalBlending, 1.0);
    water.points.add(debris.points);     // one object to add to the scene

    const tmpCol = [0, 0, 0];
    function mixInto(a, b, k, out) {
      out[0] = a[0] + (b[0] - a[0]) * k;
      out[1] = a[1] + (b[1] - a[1]) * k;
      out[2] = a[2] + (b[2] - a[2]) * k;
      return out;
    }

    function seaYAt(x, z) { return waves ? waves.height(x, z, clock) : 0; }

    // ---- public API ---------------------------------------------------------

    // strength ~0..2.5. kind: 'water' (default) | 'dust'
    function burst(x, y, z, strength, kind) {
      const s = clamp(strength == null ? 1 : strength, 0.15, 2.5);
      const dust = kind === 'dust';
      const count = Math.min(30, 4 + Math.round(s * 12));
      for (let k = 0; k < count; k++) {
        const ang = rnd() * 6.283185;
        const spd = (dust ? 0.6 : 1.4) * s * (0.35 + rnd() * 0.9);
        const up = (dust ? 0.8 : 2.6) * s * (0.45 + rnd() * 0.8);
        const col = dust
          ? mixInto(LIME, CEMENT, rnd(), tmpCol)
          : mixInto(FOAM, rnd() < 0.3 ? SHALLOW : FOAM, rnd() * 0.5, tmpCol);
        const sz = F.waterSizeMin + rnd() * (F.waterSizeMax - F.waterSizeMin);
        water.spawn(
          x + (rnd() - 0.5) * 0.4, y + rnd() * 0.18, z + (rnd() - 0.5) * 0.4,
          Math.cos(ang) * spd, up, Math.sin(ang) * spd,
          col, sz * (dust ? 1.6 : 1) * (0.7 + s * 0.4),
          (dust ? 0.8 : F.waterLifeMin) + rnd() * (F.waterLifeMax - F.waterLifeMin),
          dust ? F.waterGravity * 0.35 : F.waterGravity
        );
      }
    }

    // a tile losing the fight: grey rubble that arcs and splashes on landing
    function crumble(x, y, z) {
      for (let k = 0; k < 16; k++) {
        const ang = rnd() * 6.283185;
        const spd = 0.8 + rnd() * 2.0;
        const r = rnd();
        const col = r < 0.55 ? mixInto(CEMENT, STONE, rnd(), tmpCol)
          : (r < 0.8 ? mixInto(STONE, TERRA, rnd() * 0.6, tmpCol)
            : mixInto(LIME, CEMENT, rnd(), tmpCol));
        debris.spawn(
          x + (rnd() - 0.5) * 1.6, y + 0.1 + rnd() * 0.3, z + (rnd() - 0.5) * 1.6,
          Math.cos(ang) * spd, 1.6 + rnd() * 2.6, Math.sin(ang) * spd,
          col,
          F.debrisSizeMin + rnd() * (F.debrisSizeMax - F.debrisSizeMin),
          F.debrisLifeMin + rnd() * (F.debrisLifeMax - F.debrisLifeMin),
          F.debrisGravity
        );
      }
      burst(x, y + 0.05, z, 1.35);     // the sea taking the slab back
    }

    // rubble hitting the water throws a small foam puff
    function debrisDied(x, y, z) {
      const col = mixInto(FOAM, MID, 0.25, tmpCol);
      for (let k = 0; k < 2; k++) {
        water.spawn(x, y + 0.05, z,
          (rnd() - 0.5) * 0.7, 0.9 + rnd() * 0.8, (rnd() - 0.5) * 0.7,
          col, 0.16 + rnd() * 0.14, 0.3 + rnd() * 0.3, F.waterGravity);
      }
    }

    function update(dt) {
      if (!(dt > 0)) return;
      if (dt > 0.05) dt = 0.05;
      clock += dt;
      water.advance(dt, seaYAt, null);
      debris.advance(dt, seaYAt, debrisDied);
    }

    return {
      object: water.points,
      burst: burst,
      crumble: crumble,
      update: update,
      // call once the camera exists so point sizes are physically correct:
      // scale = canvasHeight / (2 * tan(fov/2))
      setViewportScale: function (pixelHeight, fovDeg) {
        const s = pixelHeight / (2 * Math.tan((fovDeg || 70) * Math.PI / 360));
        water.mat.uniforms.uScale.value = s;
        debris.mat.uniforms.uScale.value = s;
      },
      setWaves: function (w) { waves = w || null; },
      reset: function () { water.reset(); debris.reset(); },
      get liveCount() { return water.live + debris.live; },
      dispose: function () {
        water.geo.dispose(); water.mat.dispose();
        debris.geo.dispose(); debris.mat.dispose();
        if (tex && tex.dispose) tex.dispose();
      }
    };
  }

  // ===========================================================================
  global.BLB_PHYSICS = {
    createWaveField: createWaveField,
    createTileSim: createTileSim,
    createPlayerBody: createPlayerBody,
    createSplashes: createSplashes,
    TUNING: TUNING,
    TIERS: TIER_DEFAULTS,
    WAVE_COMPONENTS: WAVE_COMPONENTS,
    GRID: {
      CELL: CELL, Z0: Z0, TILE_TOP: TILE_TOP, SLAB: SLAB,
      I_MIN: I_MIN, I_MAX: I_MAX, J_MIN: J_MIN, J_MAX: J_MAX,
      GRID_W: GRID_W, GRID_H: GRID_H, NO_BUILD: NO_BUILD
    }
  };
})(typeof window !== 'undefined' ? window : this);
