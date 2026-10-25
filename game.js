/* BALLET L BA7ER — core engine / integration layer.
 * Owns: renderer, scene, lights, the sea mesh, the tile instancing, the mason,
 * camera + controls, the economy, the shabeb (workers), day/night, save/load,
 * and the main loop. Scenery comes from BLB_WORLD, simulation from BLB_PHYSICS,
 * the 2D overlay and all sound from BLB_HUD.
 * Three.js r128 globals only. No modules, no network assets. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- palette
  var P = {
    SEA_DEEP: 0x0b3a4f, SEA_MID: 0x16708c, SEA_SHALLOW: 0x3fa8b4,
    FOAM: 0xedf6f3, SKY_TOP: 0x6fc3de, SKY_HAZE: 0xd9eef2,
    LIMESTONE: 0xe4d7b3, STONE_DARK: 0xa08f6a, STONE_WET: 0x7d6e4f,
    TERRACOTTA: 0xb9502f, CEMENT: 0x9aa0a0, RUST: 0x8c4a2f,
    PALM_GREEN: 0x3f6b3a, PALM_LIGHT: 0x5e8c3f, TRUNK: 0x7a6245,
    SUN: 0xf6c445, HAZARD: 0xf2b733, NIGHT_TOP: 0x0a1a33,
    SKIN: 0xc98a5e, SHIRT: 0xe8e2d4, DENIM: 0x3b5c73
  };
  // Same values as CSS strings for the HUD, so 2D and 3D never drift apart.
  var PCSS = {};
  for (var k in P) if (P.hasOwnProperty(k)) PCSS[k] = '#' + ('000000' + P[k].toString(16)).slice(-6);

  /* One tile. One material. One thing to collect. The whole game is the
     balata and the sea. */
  var TIERS = [
    { id: 'balat', name: 'Balat', ar: 'بلاط', hp: 14, mortar: 1, lira: 0, color: 0x2e7fa8 }
  ];
  var HUD_TIERS = TIERS.map(function (t) {
    return { id: t.id, name: t.name, ar: t.ar, hp: t.hp, mortar: t.mortar, lira: t.lira,
             color: '#' + ('000000' + t.color.toString(16)).slice(-6) };
  });
  var MORTAR_MAX = 20;

  var CELL = 2.0, TILE_TOP = 0.30, DECK_Y = 1.5;
  var REACH = 11.5;            // how far the muallim can lean out to lay a balata
  var DAY_LENGTH = 300;        // seconds for a full dawn→night cycle
  var INSPECTION_EVERY = 30;   // municipality pays by the surviving square metre
  var SAVE_KEY = 'blb.save.v2';

  // -------------------------------------------------------------- utilities
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function cellCentreX(i) { return i * CELL; }
  function cellCentreZ(j) { return 4 + j * CELL; }
  function worldToCell(x, z, out) {
    out.i = Math.round(x / CELL);
    out.j = Math.round((z - 4) / CELL);
    return out;
  }

  /* Tiny seeded value noise — used for gull drift, worker wobble, camera sway.
     (THREE.ImprovedNoise is not in the core r128 build.) */
  function noise1(x) {
    var i = Math.floor(x), f = x - i;
    function h(n) { n = (n << 13) ^ n; return 1.0 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0; }
    var u = f * f * (3 - 2 * f);
    return lerp(h(i), h(i + 1), u);
  }

  // --------------------------------------------------- procedural materials
  function canvas2d(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    return { c: c, g: c.getContext('2d') };
  }
  function tex(canvas, repeat) {
    var t = new THREE.CanvasTexture(canvas);
    t.encoding = THREE.sRGBEncoding;   // must match renderer.outputEncoding
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    return t;
  }
  function hex(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }

  /* One 2m slab reads as four laid balatat, so the grout grid does the work.
     Each tier gets its own surface: raw sand-mix, poured beton, the azure
     qarmid with its little star motif, and veined Rmeyleh marble. */
  function tileTexture(tier) {
    var S = 128, o = canvas2d(S), g = o.g, i;
    g.fillStyle = hex(tier.color);
    g.fillRect(0, 0, S, S);
    if (tier.id === 'ramleh') {
      for (i = 0; i < 2600; i++) {
        g.fillStyle = 'rgba(' + (110 + Math.random() * 90 | 0) + ',' + (95 + Math.random() * 70 | 0) + ',60,0.30)';
        g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
    } else if (tier.id === 'beton') {
      for (i = 0; i < 1800; i++) {
        var v = Math.random() < 0.5 ? 255 : 40;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.10)';
        g.fillRect(Math.random() * S, Math.random() * S, 3, 3);
      }
      g.strokeStyle = 'rgba(60,70,70,0.35)';          // a trowelled-over crack
      g.lineWidth = 2; g.beginPath();
      g.moveTo(10, 40); g.bezierCurveTo(50, 60, 70, 20, 118, 52); g.stroke();
    } else if (tier.id === 'qarmid') {
      // four azure balatat, each with a white eight-point star — Levantine kitchen tile
      for (var qx = 0; qx < 2; qx++) for (var qy = 0; qy < 2; qy++) {
        var cx = qx * 64 + 32, cy = qy * 64 + 32;
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.fillRect(qx * 64 + 6, qy * 64 + 6, 52, 52);
        g.save(); g.translate(cx, cy);
        for (var r = 0; r < 2; r++) {
          g.rotate(Math.PI / 4);
          g.fillStyle = r ? hex(P.FOAM) : 'rgba(237,246,243,0.55)';
          g.fillRect(-17, -5, 34, 10); g.fillRect(-5, -17, 10, 34);
        }
        g.fillStyle = hex(P.HAZARD); g.beginPath(); g.arc(0, 0, 4.5, 0, 6.3); g.fill();
        g.restore();
      }
    } else {
      for (i = 0; i < 26; i++) {                       // marble veining
        g.strokeStyle = 'rgba(150,140,120,' + (0.10 + Math.random() * 0.22).toFixed(2) + ')';
        g.lineWidth = 0.6 + Math.random() * 1.8;
        g.beginPath();
        var x0 = Math.random() * S, y0 = Math.random() * S;
        g.moveTo(x0, y0);
        g.bezierCurveTo(x0 + 30, y0 + 20, x0 - 20, y0 + 50, x0 + 40, y0 + 90);
        g.stroke();
      }
    }
    // grout: the cross and the border, darkened where mortar squeezed out
    g.strokeStyle = 'rgba(55,50,40,0.55)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(64, 0); g.lineTo(64, S); g.moveTo(0, 64); g.lineTo(S, 64); g.stroke();
    g.lineWidth = 7; g.strokeRect(0, 0, S, S);
    var grd = g.createLinearGradient(0, 0, 0, S);      // contact shade, no shadow maps
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.13)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    return tex(o.c);
  }

  function particleSpriteUnused() { /* splash sprites live in BLB_PHYSICS */ }

  // ------------------------------------------------------------ tile render
  /* One InstancedMesh per tier; removal swaps the hole with the last instance.
     Per-instance colour carries wear, so a frontier tile visibly goes grey and
     tired before the sea finally takes it. */
  function createTileRenderer(scene) {
    var MAX = 5000;
    var banks = TIERS.map(function (tier) {
      var geo = new THREE.BoxGeometry(1.94, TILE_TOP, 1.94);
      var mat = new THREE.MeshPhongMaterial({ map: tileTexture(tier), flatShading: true, shininess: 8, specular: 0x2a2a28 });
      var mesh = new THREE.InstancedMesh(geo, mat, MAX);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      /* Allocate instanceColor ourselves. r128's setColorAt() sizes the buffer
         from mesh.count, and we have just set that to 0 — so priming through
         setColorAt would allocate a ZERO-LENGTH colour buffer while the shader
         still compiles with USE_INSTANCING_COLOR. Every instanced draw then
         fails with GL_INVALID_OPERATION and the tiles silently never appear. */
      var carr = new Float32Array(MAX * 3);
      var tc = new THREE.Color(tier.color);
      for (var n = 0; n < MAX; n++) {
        carr[n * 3] = tc.r; carr[n * 3 + 1] = tc.g; carr[n * 3 + 2] = tc.b;
      }
      mesh.instanceColor = new THREE.BufferAttribute(carr, 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      return { mesh: mesh, occupants: new Array(MAX), tier: tier };
    });
    var slotOf = {};                 // "i,j" -> {tierIdx, idx}
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    var pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1), col = new THREE.Color();

    function key(i, j) { return i + ',' + j; }

    function add(i, j, tierIdx) {
      var bank = banks[tierIdx], idx = bank.mesh.count++;
      // hand-laid, not machine-laid: a degree of yaw and a hair of lift
      e.set(0, (Math.random() - 0.5) * 0.055, 0);
      q.setFromEuler(e);
      pos.set(cellCentreX(i), TILE_TOP / 2 + (Math.random() - 0.5) * 0.012, cellCentreZ(j));
      m.compose(pos, q, scl);
      bank.mesh.setMatrixAt(idx, m);
      // instanceColor carries the tier hue; the material stays white so wear
      // is a plain multiply later on.
      var vary = 0.93 + Math.random() * 0.14;
      col.setHex(bank.tier.color).multiplyScalar(vary);
      bank.mesh.setColorAt(idx, col);
      bank.occupants[idx] = key(i, j);
      slotOf[key(i, j)] = { t: tierIdx, i: idx };
      bank.mesh.instanceMatrix.needsUpdate = true;
      if (bank.mesh.instanceColor) bank.mesh.instanceColor.needsUpdate = true;
    }

    function remove(i, j) {
      var kk = key(i, j), slot = slotOf[kk];
      if (!slot) return;
      var bank = banks[slot.t], last = bank.mesh.count - 1;
      if (slot.i !== last) {                      // move the tail into the hole
        bank.mesh.getMatrixAt(last, m);
        bank.mesh.setMatrixAt(slot.i, m);
        if (bank.mesh.instanceColor) {
          var ic = bank.mesh.instanceColor.array;
          ic[slot.i * 3] = ic[last * 3];
          ic[slot.i * 3 + 1] = ic[last * 3 + 1];
          ic[slot.i * 3 + 2] = ic[last * 3 + 2];
          bank.mesh.instanceColor.needsUpdate = true;
        }
        var movedKey = bank.occupants[last];
        bank.occupants[slot.i] = movedKey;
        if (slotOf[movedKey]) slotOf[movedKey].i = slot.i;
      }
      bank.mesh.count = last;
      bank.occupants[last] = undefined;
      bank.mesh.instanceMatrix.needsUpdate = true;
      delete slotOf[kk];
    }

    /* Wear pass: only the frontier can be damaged, so only the frontier is
       re-coloured, and only a few times a second. */
    function wear(tile) {
      var slot = slotOf[key(tile.i, tile.j)];
      if (!slot) return;
      var bank = banks[slot.t], ratio = clamp(tile.hp / tile.maxHp, 0, 1);
      // Losing tiles go dark, desaturated and slightly green-grey: waterlogged
      // mortar letting go. Full-health tiles sit at their own tier colour.
      col.setHex(bank.tier.color);
      var dull = 0.40 + 0.60 * ratio;
      var grey = (col.r + col.g + col.b) / 3;
      col.setRGB(
        lerp(grey * 0.72, col.r, 0.35 + 0.65 * ratio) * dull,
        lerp(grey * 0.78, col.g, 0.35 + 0.65 * ratio) * dull,
        lerp(grey * 0.74, col.b, 0.35 + 0.65 * ratio) * dull
      );
      bank.mesh.setColorAt(slot.i, col);
      if (bank.mesh.instanceColor) bank.mesh.instanceColor.needsUpdate = true;
    }

    function clear() {
      banks.forEach(function (b) { b.mesh.count = 0; b.occupants.length = 0; b.occupants.length = MAX; });
      slotOf = {};
    }

    return { add: add, remove: remove, wear: wear, clear: clear, banks: banks, MAX: MAX };
  }

  // ------------------------------------------------------------------- sea
  /* A flat-shaded plane that follows the player and is displaced on the CPU
     from the very same wave field the simulation uses, so a splash, a bobbing
     boat and the tile that just drowned all agree with what you can see.
     flatShading derives normals in the fragment shader, so there is no
     per-frame computeVertexNormals — that is what makes this affordable. */
  function createSea(scene, waves) {
    var SIZE = 720, SEG = 144, STEP = SIZE / SEG;   // 5m snap, integer
    var geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position, N = pos.count;
    var parr = pos.array;
    var bx = new Float32Array(N), bz = new Float32Array(N);
    for (var n = 0; n < N; n++) { bx[n] = parr[n * 3]; bz[n] = parr[n * 3 + 2]; }
    var carr = new Float32Array(N * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(carr, 3));
    /* Phong, not Lambert: r128's MeshLambertMaterial lights per-vertex and
       silently ignores flatShading. We never recompute the wave normals, so
       without real flat shading the sea would render as an unlit flat sheet.
       The low specular doubles as sun glint on the water. */
    var mat = new THREE.MeshPhongMaterial({
      vertexColors: true, flatShading: true, side: THREE.DoubleSide,
      shininess: 26, specular: 0x5f8fa0
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    scene.add(mesh);

    // unpack palette once — no Color objects in the hot loop
    var sr = (P.SEA_SHALLOW >> 16 & 255) / 255, sg = (P.SEA_SHALLOW >> 8 & 255) / 255, sb = (P.SEA_SHALLOW & 255) / 255;
    var dr = (P.SEA_DEEP >> 16 & 255) / 255, dg = (P.SEA_DEEP >> 8 & 255) / 255, db = (P.SEA_DEEP & 255) / 255;
    var fr = (P.FOAM >> 16 & 255) / 255, fg = (P.FOAM >> 8 & 255) / 255, fb = (P.FOAM & 255) / 255;

    function update(t, px, pz) {
      var cx = Math.round(px / STEP) * STEP, cz = Math.round(pz / STEP) * STEP;
      mesh.position.x = cx; mesh.position.z = cz;
      for (var n = 0; n < N; n++) {
        var wx = bx[n] + cx, wz = bz[n] + cz;
        var h = waves.height(wx, wz, t);
        parr[n * 3 + 1] = h;
        // depth: the shelf shoals toward the corniche, so inshore water is bright
        var d = wz < 4 ? 0 : (wz - 4) / 300;
        if (d > 1) d = 1;
        var rr = sr + (dr - sr) * d, gg = sg + (dg - sg) * d, bb2 = sb + (db - sb) * d;
        // whitecaps: only the top of a crest goes to foam
        var f = (h - 0.26) * 1.9;
        if (f > 0) { if (f > 0.85) f = 0.85; rr += (fr - rr) * f; gg += (fg - gg) * f; bb2 += (fb - bb2) * f; }
        carr[n * 3] = rr; carr[n * 3 + 1] = gg; carr[n * 3 + 2] = bb2;
      }
      pos.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }
    return { mesh: mesh, update: update };
  }

  // ----------------------------------------------------------- the mason
  /* Chunky box-built characters with real joint pivots so the walk cycle,
     the laying crouch and the humiliating swim all animate properly.
     `shirt` lets the shabeb wear different colours from the player. */
  function createMason(shirtColor, hatColor, hatStyle) {
    var g = new THREE.Group();
    // Phong for the same reason as the sea: Lambert drops flatShading in r128.
    function matte(col) {
      return new THREE.MeshPhongMaterial({ color: col, flatShading: true, shininess: 2, specular: 0x111111 });
    }
    var M = {
      skin: matte(P.SKIN), shirt: matte(shirtColor), denim: matte(P.DENIM),
      hat: matte(hatColor), dark: matte(0x2b2420),
      steel: new THREE.MeshPhongMaterial({ color: 0xb9bec2, flatShading: true, shininess: 60, specular: 0x888888 })
    };
    function box(w, h, d, mat, x, y, z, parent) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      (parent || g).add(m);
      return m;
    }
    // pivot groups sit at the joint; the limb hangs below its own origin
    function limb(px, py, pz, w, h, d, mat, parent) {
      var pivot = new THREE.Group();
      pivot.position.set(px, py, pz);
      (parent || g).add(pivot);
      box(w, h, d, mat, 0, -h / 2, 0, pivot);
      return pivot;
    }

    var hips = new THREE.Group(); hips.position.y = 0.82; g.add(hips);
    box(0.52, 0.26, 0.30, M.denim, 0, 0, 0, hips);                 // waist
    var torso = box(0.56, 0.58, 0.32, M.shirt, 0, 0.42, 0, hips);  // fanella
    box(0.10, 0.44, 0.04, M.denim, -0.16, 0.50, -0.15, hips);      // straps
    box(0.10, 0.44, 0.04, M.denim, 0.16, 0.50, -0.15, hips);
    var head = new THREE.Group(); head.position.set(0, 0.86, 0); hips.add(head);
    box(0.36, 0.34, 0.32, M.skin, 0, 0.17, 0, head);
    box(0.17, 0.05, 0.03, M.dark, 0, 0.11, 0.17, head);            // the moustache
    box(0.05, 0.05, 0.02, M.dark, -0.08, 0.22, 0.17, head);
    box(0.05, 0.05, 0.02, M.dark, 0.08, 0.22, 0.17, head);
    hatStyle = hatStyle || 'hard';
    if (hatStyle === 'hard') {
      box(0.42, 0.10, 0.40, M.hat, 0, 0.38, 0, head);              // hard hat
      box(0.30, 0.09, 0.30, M.hat, 0, 0.45, 0, head);
      box(0.40, 0.04, 0.13, M.hat, 0, 0.345, 0.21, head);          // brim
    } else if (hatStyle === 'cap') {
      box(0.39, 0.09, 0.37, M.hat, 0, 0.37, -0.01, head);          // flat cap
      box(0.34, 0.035, 0.16, M.hat, 0, 0.345, 0.22, head);
    } else if (hatStyle === 'scarf') {
      box(0.44, 0.34, 0.42, M.hat, 0, 0.20, -0.02, head);          // headscarf
      box(0.30, 0.22, 0.12, M.hat, 0, 0.02, -0.19, head);
    } else {
      box(0.37, 0.09, 0.35, M.dark, 0, 0.345, -0.02, head);        // grey hair
    }

    var armL = limb(-0.34, 0.70, 0, 0.15, 0.56, 0.17, M.skin, hips);
    var armR = limb(0.34, 0.70, 0, 0.15, 0.56, 0.17, M.skin, hips);
    box(0.04, 0.22, 0.14, M.steel, 0, -0.60, 0.06, armR);          // trowel
    var legL = limb(-0.15, 0, 0, 0.20, 0.76, 0.24, M.denim, hips);
    var legR = limb(0.15, 0, 0, 0.20, 0.76, 0.24, M.denim, hips);
    box(0.22, 0.06, 0.30, M.dark, -0.15, -0.79, 0.03, hips);       // slippers
    box(0.22, 0.06, 0.30, M.dark, 0.15, -0.79, 0.03, hips);

    var state = { phase: 0, lay: 0, swim: 0 };
    function animate(dt, speed, inWater, laying) {
      state.phase += dt * (3.2 + speed * 1.15);
      state.lay = clamp(state.lay + (laying ? dt * 7 : -dt * 5), 0, 1);
      state.swim = clamp(state.swim + (inWater ? dt * 4 : -dt * 4), 0, 1);
      var sw = state.swim, sp = clamp(speed / 6, 0, 1.4);
      var s = Math.sin(state.phase), c = Math.cos(state.phase * 2);
      legL.rotation.x = s * 0.85 * sp * (1 - sw);
      legR.rotation.x = -s * 0.85 * sp * (1 - sw);
      armL.rotation.x = (-s * 0.62 * sp) * (1 - sw) + sw * (Math.sin(state.phase * 1.6) * 1.5 - 1.4);
      armR.rotation.x = (s * 0.62 * sp) * (1 - sw) + sw * (Math.cos(state.phase * 1.6) * 1.5 - 1.4);
      // laying a balata: crouch, lean in, sweep the trowel
      var L = state.lay;
      hips.position.y = 0.82 - L * 0.30 - sw * 0.55 + Math.abs(c) * 0.02 * sp * (1 - sw);
      hips.rotation.x = L * 0.55 + sw * 1.30;
      armR.rotation.x += -L * 1.25 + Math.sin(state.phase * 6) * 0.30 * L;
      armL.rotation.x += -L * 0.45;
      head.rotation.x = -L * 0.35 - sw * 0.9;
      torso.rotation.z = Math.sin(state.phase) * 0.04 * sp * (1 - sw);
      legL.rotation.x += sw * (Math.sin(state.phase * 1.9) * 0.55 + 0.9);
      legR.rotation.x += sw * (Math.cos(state.phase * 1.9) * 0.55 + 0.9);
    }
    return { group: g, animate: animate, state: state, materials: M };
  }

  // ================================================================ boot
  function boot(saved) {
    var canvas = document.getElementById('webgl');
    var overlay = document.getElementById('overlay');

    // ---- renderer / scene / lights
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    /* The scenery's light rig peaks near 2.0 combined intensity, which rails
       the sea and the pale stonework to pure white under sRGB output. Filmic
       tone mapping keeps the highlights instead of clipping them. */
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(P.SKY_HAZE);

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(P.SKY_HAZE, 180, 820);

    var camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 2600);

    // Lighting, sky and fog all belong to world.js: it drives them from
    // setTimeOfDay and keeps the lamp heads in sync. We add none of our own.

    // ---- simulation + scenery + hud
    var waves = BLB_PHYSICS.createWaveField({ seed: 7 });
    var sim = BLB_PHYSICS.createTileSim({ waves: waves, tiers: TIERS });
    // world.js builds THREE.Colors from CSS strings, so it gets PCSS, not the
    // numeric table our own materials use.
    // passing `scene` lets world.js install its fog and add its own group
    var world = BLB_WORLD.createWorld(THREE, { palette: PCSS, scene: scene });
    if (world.group.parent !== scene) scene.add(world.group);
    if (world.fog) scene.fog = world.fog;
    scene.add(camera);        // so the first-person viewmodel renders
    var sea = createSea(scene, waves);
    var tiles = createTileRenderer(scene);
    var fx = BLB_PHYSICS.createSplashes(THREE, { palette: P });
    scene.add(fx.object);

    var hud = BLB_HUD.create({
      root: overlay, palette: PCSS, tiers: HUD_TIERS, simple: true,
      onSelectTier: function () {},
      onStart: function () { start(); },
      onToggleSound: function (on) { sfx.muted = !on; },
      keys: false
    });
    var sfx = BLB_HUD.createAudio();

    // ---- player
    var mason = createMason(P.SHIRT, P.HAZARD);
    scene.add(mason.group);
    mason.group.visible = false;        // first person: you see the viewmodel instead
    var body = BLB_PHYSICS.createPlayerBody({ sim: sim, world: world });
    body.teleport(0, DECK_Y, -11);

    // ---- state
    var S = {
      mortar: 6, mortarMax: MORTAR_MAX,
      elapsed: 0, started: false, laid: 0, lost: 0,
      nextInspection: INSPECTION_EVERY, nextHeckle: 24, squall: false, phase: '',
      wasInWater: false
    };

    // ---- reticle: the ghost balata under the cursor
    var ghostGeo = new THREE.BoxGeometry(1.94, TILE_TOP, 1.94);
    var ghostMat = new THREE.MeshBasicMaterial({ color: 0x8ff0a8, transparent: true, opacity: 0.34, depthWrite: false });
    var ghost = new THREE.Mesh(ghostGeo, ghostMat);
    var ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(ghostGeo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
    );
    ghost.add(ghostEdges);
    ghost.visible = false;
    scene.add(ghost);

    /* ---- camera: first person by default. `pitch` is look angle (+ is up);
       `tpPitch`/`dist` only matter in the optional third-person view on V. */
    var EYE = 1.62;
    var cam = { yaw: Math.PI, pitch: -0.06, tpPitch: 0.52, dist: 15 };
    var firstPerson = true;
    var bobT = 0, bobY = 0, bobRoll = 0;
    var camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();
    camera.rotation.order = 'YXZ';

    /* The viewmodel: a forearm and the trowel, carried by the camera. In first
       person this is the only part of the mason you see. */
    var viewModel = new THREE.Group();
    (function () {
      var skin = new THREE.MeshPhongMaterial({ color: P.SKIN, flatShading: true, shininess: 2, specular: 0x111111 });
      var steel = new THREE.MeshPhongMaterial({ color: 0xb9bec2, flatShading: true, shininess: 60, specular: 0x888888 });
      var wood = new THREE.MeshPhongMaterial({ color: 0x7a5a3a, flatShading: true, shininess: 4, specular: 0x111111 });
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.52), skin);
      arm.position.set(0, -0.055, 0.17);
      var grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.17), wood);
      grip.position.set(0, 0.01, -0.12);
      var blade = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.016, 0.30), steel);
      blade.position.set(0, -0.02, -0.34);
      viewModel.add(arm); viewModel.add(grip); viewModel.add(blade);
      viewModel.position.set(0.30, -0.26, -0.52);
      viewModel.rotation.set(-0.22, 0.22, 0.10);
      camera.add(viewModel);
    })();
    var vmSwing = 0;

    // ---- input
    var keys = {};
    var mouseNDC = new THREE.Vector2(0, 0);
    var placing = false, orbiting = false, lastPX = 0, lastPY = 0;
    var raycaster = new THREE.Raycaster();
    var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_TOP);
    var hitPoint = new THREE.Vector3();
    var cellTmp = { i: 0, j: 0 };

    /* Mouse look. Pointer lock is the good path (the artifact iframe's sandbox
       does allow it); drag-to-look is only the fallback. Crucially we do NOT
       give up on the lock after one refusal — a single mistimed gesture used to
       demote the whole session to dragging. */
    var fp = { locked: false, giveUp: false, failures: 0, dragX: 0, dragY: 0, dragging: false };
    var look = { sens: 0.0022, drag: 0.0042 };
    try {
      var savedSens = parseFloat(localStorage.getItem('blb.sens'));
      if (savedSens > 0.0004 && savedSens < 0.02) look.sens = savedSens;
    } catch (e) { /* private window */ }

    function aimNDC() { return firstPerson ? CENTRE : mouseNDC; }
    var CENTRE = new THREE.Vector2(0, 0);

    // a quiet centre hint, shown only while the mouse is not captured
    var hint = document.createElement('div');
    hint.id = 'lookhint';
    hint.textContent = 'click to look around';
    (function () {
      var st = document.createElement('style');
      st.textContent = '#lookhint{position:fixed;left:50%;top:62%;transform:translateX(-50%);' +
        'z-index:30;pointer-events:none;font:600 13px/1 "Barlow Condensed",system-ui,sans-serif;' +
        'letter-spacing:.14em;text-transform:uppercase;color:#0b3a4f;background:#e4d7b3;' +
        'border:2px solid #0b3a4f;padding:7px 13px;opacity:0;transition:opacity .2s;}' +
        '#lookhint.on{opacity:.92;}';
      document.head.appendChild(st);
      document.body.appendChild(hint);
    })();
    function updateHint() {
      var show = S.started && firstPerson && !fp.locked;
      hint.textContent = fp.giveUp ? 'drag to look around' : 'click to look around';
      hint.classList.toggle('on', show);
      canvas.style.cursor = (firstPerson && fp.locked) ? 'none' : '';
    }

    function requestLook() {
      if (!firstPerson || fp.locked) return;
      if (!canvas.requestPointerLock) { fp.giveUp = true; updateHint(); return; }
      try { canvas.requestPointerLock(); } catch (err) { fp.failures++; }
      setTimeout(function () {
        if (fp.locked) return;
        fp.failures++;
        if (fp.failures >= 2 && !fp.giveUp) {
          fp.giveUp = true;
          hud.toast('Mouse capture blocked here — drag to look instead.', 'info');
        }
        updateHint();
      }, 500);
    }
    document.addEventListener('pointerlockchange', function () {
      fp.locked = (document.pointerLockElement === canvas);
      if (fp.locked) { fp.failures = 0; fp.giveUp = false; }
      updateHint();
    });
    document.addEventListener('pointerlockerror', function () {
      fp.failures++;
      if (fp.failures >= 2) fp.giveUp = true;
      updateHint();
    });

    function setSens(v) {
      look.sens = clamp(v, 0.0006, 0.0090);
      try { localStorage.setItem('blb.sens', String(look.sens)); } catch (e) { /* ignore */ }
      hud.toast('Mouse sensitivity ' + (look.sens / 0.0022).toFixed(2) + '×', 'info');
    }

    function onKey(e, down) {
      var c = e.code;
      var was = keys[c];
      keys[c] = down;
      if (!down) return;
      if (c === 'KeyE' && !was && S.started) {
        var near = nearestNPC();
        if (near) { talkTo(near.npc); return; }   // E is talk when someone is beside you
      }
      if (c === 'KeyV') {
        firstPerson = !firstPerson;
        mason.group.visible = !firstPerson;
        viewModel.visible = firstPerson;
        if (!firstPerson && document.exitPointerLock) document.exitPointerLock();
        hud.toast(firstPerson ? 'First person' : 'Third person', 'info');
        updateHint();
      }
      if (c === 'BracketLeft') { setSens(look.sens * 0.84); return; }
      if (c === 'BracketRight') { setSens(look.sens * 1.19); return; }
      if (c === 'KeyM') { sfx.muted = !sfx.muted; hud.toast(sfx.muted ? 'Sound off' : 'Sound on', 'info'); }
      else if (c === 'Escape') hud.closeShop();
      if (c === 'Space') e.preventDefault();
    }
    window.addEventListener('keydown', function (e) { onKey(e, true); });
    window.addEventListener('keyup', function (e) { onKey(e, false); });
    window.addEventListener('blur', function () { keys = {}; placing = false; orbiting = false; });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      sfx.unlock();
      // reset the gesture BEFORE anything that can throw, or a failed capture
      // leaves `dragging` set and silently eats the next click
      fp.dragX = 0; fp.dragY = 0; fp.dragging = false;
      try {
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      } catch (err) { /* stale or synthetic pointer id — not fatal */ }
      if (e.button === 2 || e.button === 1) {
        orbiting = true; lastPX = e.clientX; lastPY = e.clientY;
        return;
      }
      if (firstPerson && !fp.locked) {
        /* Ask for the mouse AND start drag-looking in the same gesture. If the
           lock is granted the drag never matters; if it is refused the player
           is already looking around instead of clicking into a dead screen. */
        requestLook();
        orbiting = true; lastPX = e.clientX; lastPY = e.clientY;
        placing = false;
        return;
      }
      placing = true;
      tryPlace(true);
    });
    window.addEventListener('pointerup', function (e) {
      if (e.button === 2 || e.button === 1) { orbiting = false; return; }
      if (firstPerson && !fp.locked) {
        orbiting = false;
        // a click that did not travel still lays a balata
        if (!fp.dragging) tryPlace(true);
      }
      placing = false;
    });
    window.addEventListener('pointermove', function (e) {
      mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
      if (fp.locked) {
        // clamp per-event deltas: some systems emit huge spikes that snap the view
        var mx = e.movementX || 0, my = e.movementY || 0;
        if (mx > 140) mx = 140; else if (mx < -140) mx = -140;
        if (my > 140) my = 140; else if (my < -140) my = -140;
        cam.yaw -= mx * look.sens;
        cam.pitch = clamp(cam.pitch - my * look.sens, -1.35, 1.35);
        return;
      }
      if (orbiting) {
        var dx = e.clientX - lastPX, dy = e.clientY - lastPY;
        fp.dragX += dx; fp.dragY += dy;
        if (!fp.dragging && Math.abs(fp.dragX) + Math.abs(fp.dragY) > 6) fp.dragging = true;
        cam.yaw -= dx * look.drag;
        if (firstPerson) cam.pitch = clamp(cam.pitch - dy * look.drag, -1.35, 1.35);
        else cam.tpPitch = clamp(cam.tpPitch + dy * look.drag, 0.07, 1.22);
        lastPX = e.clientX; lastPY = e.clientY;
      }
    });
    canvas.addEventListener('wheel', function (e) {
      if (firstPerson) {
        // leaning in to judge a far cell, rather than a useless third-person zoom
        camera.fov = clamp(camera.fov + e.deltaY * 0.022, 42, 72);
        camera.updateProjectionMatrix();
      } else {
        cam.dist = clamp(cam.dist + e.deltaY * 0.014, 6, 46);
      }
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ---- touch: left thumb walks, right thumb looks, buttons do the work
    var touch = { moveX: 0, moveZ: 0, lookId: -1, moveId: -1, ox: 0, oy: 0 };
    if ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) buildTouchControls();
    function buildTouchControls() {
      var wrap = document.createElement('div');
      wrap.id = 'touchlayer';
      wrap.innerHTML =
        '<div id="tstick"><div id="tnub"></div></div>' +
        '<div id="tbtns"><button id="tlay" type="button">بلّط</button>' +
        '<button id="tdig" type="button">SHOVEL</button>' +
        '<button id="tjump" type="button">JUMP</button></div>';
      var st = document.createElement('style');
      st.textContent =
        '#touchlayer{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:"Barlow Condensed",system-ui,sans-serif}' +
        '#tstick{position:absolute;left:calc(18px + env(safe-area-inset-left,0px));bottom:calc(26px + env(safe-area-inset-bottom,0px));width:132px;height:132px;border-radius:50%;border:3px solid rgba(237,246,243,.55);background:rgba(11,58,79,.28);pointer-events:auto;touch-action:none}' +
        '#tnub{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(242,179,51,.85)}' +
        '#tbtns{position:absolute;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(26px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:10px;pointer-events:auto}' +
        '#tbtns button{font:700 19px/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#0b3a4f;background:#f2b733;border:3px solid #0b3a4f;border-radius:4px;padding:15px 20px;touch-action:none}' +
        '#tlay{font-family:"Reem Kufi",system-ui,sans-serif!important;font-size:23px!important;background:#edf6f3!important}';
      document.head.appendChild(st);
      document.body.appendChild(wrap);
      var stick = wrap.querySelector('#tstick'), nub = wrap.querySelector('#tnub');
      stick.addEventListener('pointerdown', function (e) {
        touch.moveId = e.pointerId; var r = stick.getBoundingClientRect();
        touch.ox = r.left + r.width / 2; touch.oy = r.top + r.height / 2;
        stick.setPointerCapture(e.pointerId); sfx.unlock();
      });
      stick.addEventListener('pointermove', function (e) {
        if (e.pointerId !== touch.moveId) return;
        var dx = clamp((e.clientX - touch.ox) / 46, -1, 1), dy = clamp((e.clientY - touch.oy) / 46, -1, 1);
        touch.moveX = dx; touch.moveZ = -dy;
        nub.style.transform = 'translate(' + (dx * 34) + 'px,' + (-touch.moveZ * 34) + 'px)';
      });
      function endStick(e) {
        if (e.pointerId !== touch.moveId) return;
        touch.moveId = -1; touch.moveX = touch.moveZ = 0; nub.style.transform = '';
      }
      stick.addEventListener('pointerup', endStick);
      stick.addEventListener('pointercancel', endStick);
      // right half of the screen drags the camera
      canvas.addEventListener('touchmove', function (e) {
        var t0 = e.touches[0];
        if (!t0 || t0.clientX < window.innerWidth * 0.42) return;
        if (touch.lookId === -1) { touch.lookId = t0.identifier; lastPX = t0.clientX; lastPY = t0.clientY; return; }
        cam.yaw -= (t0.clientX - lastPX) * 0.007;
        cam.pitch = clamp(cam.pitch + (t0.clientY - lastPY) * 0.005, 0.07, 1.22);
        lastPX = t0.clientX; lastPY = t0.clientY;
      }, { passive: true });
      canvas.addEventListener('touchend', function () { touch.lookId = -1; }, { passive: true });
      var lay = wrap.querySelector('#tlay'), dig = wrap.querySelector('#tdig');
      lay.addEventListener('pointerdown', function () { sfx.unlock(); placing = true; });
      lay.addEventListener('pointerup', function () { placing = false; });
      dig.addEventListener('pointerdown', function () { keys.KeyE = true; });
      dig.addEventListener('pointerup', function () { keys.KeyE = false; });
      var jmp = wrap.querySelector('#tjump');
      jmp.addEventListener('pointerdown', function () { keys.Space = true; });
      jmp.addEventListener('pointerup', function () { keys.Space = false; });
    }

    // ------------------------------------------------------------- economy
    // ----------------------------------------------------------- placement
    var lastPlace = 0;
    function cellValidity(i, j, tierIdx, checkReach) {
      if (i < -64 || i > 64 || j < 0 || j > 400) return 'out of the works';
      if (sim.get(i, j)) return 'already tiled';
      if (!sim.isSupported(i, j)) return 'nothing to rest it on';
      if (S.mortar < TIERS[tierIdx].mortar) return 'no mouna left';
      if (checkReach) {
        var dx = cellCentreX(i) - body.pos.x, dz = cellCentreZ(j) - body.pos.z;
        if (dx * dx + dz * dz > REACH * REACH) return 'too far — walk out';
      }
      return null;
    }

    function tryPlace(immediate) {
      if (!S.started) return;
      var now = S.elapsed;
      if (!immediate && now - lastPlace < 0.115) return;   // ~8 balatat a second, max
      raycaster.setFromCamera(aimNDC(), camera);
      if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return;
      worldToCell(hitPoint.x, hitPoint.z, cellTmp);
      var bad = cellValidity(cellTmp.i, cellTmp.j, 0, true);
      if (bad) {
        if (immediate) { hud.toast(bad, 'bad'); sfx.ui(); }
        return;
      }
      if (!sim.place(cellTmp.i, cellTmp.j, 0, now)) return;
      lastPlace = now;
      S.mortar -= TIERS[0].mortar;
      S.laid++;
      tiles.add(cellTmp.i, cellTmp.j, 0);
      sfx.clack();
      fx.burst(cellCentreX(cellTmp.i), TILE_TOP, cellCentreZ(cellTmp.j), 0.55);
      mason.state.lay = 1;
      pushStats();
      if (S.laid === 1) {
        hud.toast('First balata. The sea has been warned.', 'good');
        npcEvent('firstTile');
      }
      if (S.laid === 25 || S.laid === 100 || S.laid === 250 || S.laid === 600) {
        npcEvent('milestone');
      }
    }

    // ---------------------------------------------------------- gathering
    var digTimer = 0;
    function nearestPile() {
      var best = null, bd = 9;
      var piles = world.sandPiles || [];
      for (var n = 0; n < piles.length; n++) {
        var p = piles[n];
        var dx = p.x - body.pos.x, dz = p.z - body.pos.z, dy = (p.y || DECK_Y) - body.pos.y;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < 3.2 && Math.abs(dy) < 2.2 && d < bd) { bd = d; best = p; }
      }
      return best;
    }
    function updateGathering(dt) {
      var pile = nearestPile();
      var who = nearestNPC();
      // whoever is closer wins the E key
      if (who && (!pile || who.dist < 2.6)) {
        hud.setPrompt('E — talk to ' + who.npc.def.name);
      } else if (pile && keys.KeyE) {
        if (S.mortar >= S.mortarMax) {
          hud.setPrompt('barrow full — go tile the sea');
        } else {
          S.mortar = Math.min(S.mortarMax, S.mortar + dt * 7.5);
          digTimer -= dt;
          if (digTimer <= 0) {
            digTimer = 0.34;
            sfx.pour();
            fx.burst(pile.x + (Math.random() - 0.5), (pile.y || DECK_Y) + 0.5, pile.z + (Math.random() - 0.5), 0.3);
          }
          hud.setPrompt('shovelling mouna…');
          pushStats();
        }
      } else if (pile) {
        hud.setPrompt('hold E — shovel mouna');
      } else if (S.mortar < 1) {
        hud.setPrompt('out of mouna — back to the piles on the corniche');
      } else {
        hud.setPrompt(null);
      }
    }

    // -------------------------------------------------------------- the NPCs
    /* The corniche talks back. Each character has a pool of lines per event,
       a voice pitch, and a bubble anchored to wherever their head projects on
       screen — so in first person the words come from the person saying them. */
    var NPC_DEFS = [
      {
        id: 'abou', name: 'Abou Nabil', voice: 0, hat: 'cap', scale: 1.0,
        shirt: 0xe8e2d4, hatCol: 0x6b7278, yaw: 0,
        at: function (w) { return w.heckler || { x: -11, y: DECK_Y, z: -3.6 }; },
        talk: [
          'You again. Shu, the sea said yes?',
          'I have sat on this railing since before you were born.',
          'My father said this exact thing to a man with a wheelbarrow. 1974.',
          'Fine. It is a straight line. I said nothing.',
          'Ya3ni… if you ever need a second barrow, I know a guy.'
        ],
        lines: {
          greet: ['Ahla. You came back.', 'Yi. El muhandis.'],
          idle: [
            'Shu oshbak ya 3mi?',
            'Khalas, rou2 3a 7alak.',
            'The sea was here before me. Before my father.',
            'Ya3ni the sea asked for tiles?',
            'Go get a government job.',
            'Every wave is a letter. It says: no.'
          ],
          firstTile: ['One balata. Congratulations. Only the whole sea left.'],
          lost: [
            'I told you. The sea does not give receipts.',
            'Ya haram. All that mouna.'
          ],
          milestone: ['{n} balata. Ok. I saw nothing.', 'Hm. You are still here.'],
          night: ['Go home. Even the sea sleeps.'],
          swim: ['Ya3ni. Now you are swimming with it.']
        }
      },
      {
        id: 'imkhalil', name: 'Im Khalil', voice: 3, hat: 'scarf', scale: 0.96,
        shirt: 0x9c5f7a, hatCol: 0xb9502f, yaw: Math.PI * 0.85,
        at: function (w) {
          var c = w.cart && w.cart.position;
          return c ? { x: c.x - 1.6, y: DECK_Y, z: c.z + 1.1 } : { x: 20, y: DECK_Y, z: -8 };
        },
        talk: [
          'Khod, kol. You cannot tile on an empty stomach.',
          { t: '3mol mneeh w kob bl ba7er. My mother said it every morning.', ar: 'إعمل منيح وكبّ بالبحر' },
          'She also said: and do not come home wet.',
          'Take some mouna. I will not tell the muallim.',
          'You remind me of my son. He also does useless things beautifully.'
        ],
        givesAt: [0, 3],
        lines: {
          greet: ['Khod kaake. 3a 7sabe.', 'Ahla w sahla, ya 3ammi.'],
          idle: [
            { t: '3mol mneeh w kob bl ba7er.', ar: 'إعمل منيح وكبّ بالبحر' },
            'Kol shi bi waqto 7elo.',
            'My husband also built something pointless. Me.',
            'Shrab shay, ba3dein ballet.'
          ],
          firstTile: ['Mabrouk. Now it is a project.'],
          lost: ['Ma t2akhed 3a albak. Bokra ba3d fi ba7er.'],
          night: ['Rou7 nam, ya 3ammi. El ba7er mish rayeh.'],
          swim: ['Yalla, tla3! The water is cold.']
        }
      },
      {
        id: 'samir', name: 'Abou Samir', voice: 1, hat: 'none', scale: 1.02,
        shirt: 0x7d8da0, hatCol: 0x2b2420, yaw: Math.PI * 0.12,
        at: function () { return { x: 8.5, y: DECK_Y, z: -4.2 }; },
        talk: [
          { t: 'Obbe ya Sayda.', ar: 'يا صيدا' },
          'That castle? Crusaders built it. The sea is older than both of us.',
          'I lost three nets out by the mole. It eats them.',
          'When the water goes flat like oil — that is when it is lying to you.',
          'Lay one for me. By the stairs. I will keep an eye on it.'
        ],
        lines: {
          greet: [{ t: 'Obbe ya Sayda.', ar: 'يا صيدا' }],
          idle: [
            { t: 'Obbe ya Sayda.', ar: 'يا صيدا' },
            'I fished here fifty years. The sea never changed.',
            'The castle is still standing. So can you.',
            'In my day we threw nets, not tiles.',
            'Careful. It takes more than balat.'
          ],
          firstTile: ['Sahtein. Now the sea knows your name.'],
          lost: ['It breathes in, it breathes out. Same sea.'],
          squall: ['Tali3 3asfe. Get off the edge, ya 3ammi.'],
          night: ['The lights of Sayda. Nothing like it.']
        }
      },
      {
        id: 'jad', name: 'Jad', voice: 4, hat: 'none', scale: 0.74,
        shirt: 0xf2b733, hatCol: 0x2b2420, yaw: Math.PI,
        pace: 2.2,
        at: function () { return { x: -4.5, y: DECK_Y, z: -8.5 }; },
        talk: [
          'Are you REALLY tiling the sea?!',
          'How many is it now? I am counting too. I said {n}.',
          'My teacher said impossible. I told her about you.',
          'Can I hold the trowel? One time. One!',
          'When it is finished I am walking all the way to Cyprus.'
        ],
        lines: {
          greet: ['3am tballet el ba7er?! SAH?!', 'Are you really doing it?'],
          idle: [
            'Can I help? I am strong.',
            'My teacher said it is impossible.',
            'If you finish, can I walk on it?',
            'I counted. You are at {n}.'
          ],
          firstTile: ['IT STAYED! Did you see?!'],
          lost: ['The sea ate it! It ATE it!'],
          milestone: ['{m} metres! I am telling everyone!'],
          squall: ['Waves! Big ones! Yalla!'],
          swim: ['HE FELL IN! HE FELL IN!']
        }
      },
      {
        id: 'muallim', name: 'El Muallim', voice: 2, hat: 'hard', scale: 1.04,
        shirt: 0xcfc6b2, hatCol: 0xf2b733, yaw: Math.PI * 1.1,
        at: function (w) {
          var k = w.kiosk || { x: 13.5, y: DECK_Y, z: -10.4 };
          return { x: k.x - 1.5, y: DECK_Y, z: k.z + 1.3 };
        },
        talk: [
          'Mouna in the barrow, balata in the sea. That is the whole trade.',
          'Lay them tight. The sea finds every gap you leave.',
          'The edge is where you lose. Build wide, not far.',
          'I built the corniche wall in 88. It is still there. Mostly.',
          'No charge for advice. Everything else would be extra.'
        ],
        lines: {
          greet: ['You are the one tiling the sea. Ok.'],
          idle: [
            'The sea is a terrible customer. Never pays.',
            'Straight courses. Tight joints. That is all there is.',
            'A balata laid in a hurry belongs to the sea already.'
          ],
          lost: ['Cheap balat, cheap results. I said this.'],
          milestone: ['{n} balata. Ya zalame. You are serious.']
        }
      }
    ];

    function angleTo(a, b, k) {
      var d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      return a + d * k;
    }

    var npcs = NPC_DEFS.map(function (def) {
      var rig = createMason(def.shirt, def.hatCol, def.hat);
      rig.group.scale.setScalar(def.scale || 1);
      scene.add(rig.group);
      var at = def.at(world) || { x: 0, y: DECK_Y, z: -8 };
      var npc = {
        def: def, rig: rig, pos: new THREE.Vector3(at.x, at.y == null ? DECK_Y : at.y, at.z),
        yaw: def.yaw || 0, cool: 4 + Math.random() * 10, greeted: false,
        phase: Math.random() * 6, talkIdx: 0, facing: 0
      };
      rig.group.position.copy(npc.pos);
      rig.group.rotation.y = npc.yaw;
      return npc;
    });

    function npcSay(npc, kind) {
      var pool = npc.def.lines[kind];
      if (!pool || !pool.length) return false;
      var line = pick(pool);
      var text = typeof line === 'string' ? line : line.t;
      var ar = typeof line === 'string' ? null : line.ar;
      text = String(text)
        .replace('{n}', sim.count)
        .replace('{m}', sim.count * 4);
      hud.say(npc.def.id, { name: npc.def.name, text: text, ar: ar });
      sfx.say(npc.def.voice);
      npc.cool = 14 + Math.random() * 14;
      return true;
    }

    /* Give a line to whoever is closest, has something to say about it, and is
       not already talking. If nobody is in earshot the uncle heckles from the
       HUD instead, so an event is never silently swallowed. */
    function npcEvent(kind, fallbackToHeckle) {
      if (!S.started) return false;
      var best = null, bestD = 1e9;
      for (var i = 0; i < npcs.length; i++) {
        var npc = npcs[i];
        if (!npc.def.lines[kind] || !npc.def.lines[kind].length) continue;
        if (hud.isSaying && hud.isSaying(npc.def.id)) continue;
        var dx = npc.pos.x - body.pos.x, dz = npc.pos.z - body.pos.z;
        var d = dx * dx + dz * dz;
        if (d < 2600 && d < bestD) { bestD = d; best = npc; }
      }
      if (best) return npcSay(best, kind);
      if (fallbackToHeckle) heckle();
      return false;
    }

    function nearestNPC() {
      var best = null, bd = 4.0;
      for (var i = 0; i < npcs.length; i++) {
        var n = npcs[i];
        var dx = n.pos.x - body.pos.x, dz = n.pos.z - body.pos.z;
        var dy = n.pos.y - body.pos.y;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < 4.0 && Math.abs(dy) < 2.4 && d < bd) { bd = d; best = n; }
      }
      return best ? { npc: best, dist: bd } : null;
    }

    /* Talking walks through a character's conversation in order and wraps, so
       pressing E repeatedly is a back-and-forth rather than a slot machine.
       Im Khalil hands you mouna on the lines where she offers it. */
    function talkTo(npc) {
      var pool = npc.def.talk;
      if (!pool || !pool.length) return;
      var at = npc.talkIdx % pool.length;
      var line = pool[at];
      npc.talkIdx++;
      var text = typeof line === 'string' ? line : line.t;
      var ar = typeof line === 'string' ? null : line.ar;
      text = String(text).replace('{n}', sim.count).replace('{m}', sim.count * 4);
      hud.say(npc.def.id, { name: npc.def.name, text: text, ar: ar });
      sfx.say(npc.def.voice);
      npc.cool = 14 + Math.random() * 10;      // no idle chatter straight after
      npc.facing = 1.2;
      if (npc.def.givesAt && npc.def.givesAt.indexOf(at) >= 0) {
        var add = Math.min(6, S.mortarMax - S.mortar);
        if (add > 0.25) {
          S.mortar += add;
          hud.toast('+' + Math.round(add) + ' mouna', 'good');
          sfx.pour();
          pushStats();
        }
      }
    }

    var npcHead = new THREE.Vector3();
    function updateNPCs(dt) {
      var W = window.innerWidth, H = window.innerHeight;
      for (var i = 0; i < npcs.length; i++) {
        var npc = npcs[i], def = npc.def;
        npc.phase += dt;
        // the kid cannot stand still
        if (def.pace) {
          npc.pos.x = (def.at(world).x || 0) + Math.sin(npc.phase * 0.7) * def.pace;
          npc.rig.group.position.copy(npc.pos);
        }
        var dx = npc.pos.x - body.pos.x, dz = npc.pos.z - body.pos.z;
        var d2 = dx * dx + dz * dz;
        // turn to face you when you are close enough to talk to
        // after you talk to them they keep looking at you for a moment
        if (npc.facing > 0) npc.facing -= dt;
        var want = (d2 < 420 || npc.facing > 0)
          ? Math.atan2(body.pos.x - npc.pos.x, body.pos.z - npc.pos.z)
          : (def.yaw || 0);
        npc.yaw = angleTo(npc.yaw, want, clamp(dt * 2.4, 0, 1));
        npc.rig.group.rotation.y = npc.yaw;
        npc.rig.animate(dt, 0, false, false);

        npc.cool -= dt;
        if (S.started && d2 < 115 && npc.cool <= 0 && !(hud.isSaying && hud.isSaying(def.id))) {
          npcSay(npc, npc.greeted ? 'idle' : 'greet');
          npc.greeted = true;
        }

        // park the bubble over their head, in screen space
        npcHead.set(npc.pos.x, npc.pos.y + 2.12 * (def.scale || 1), npc.pos.z);
        npcHead.project(camera);
        var onScreen = npcHead.z < 1 && d2 < 1600 &&
          npcHead.x > -1.3 && npcHead.x < 1.3 && npcHead.y > -1.3 && npcHead.y < 1.35;
        if (hud.anchorSpeech) {
          hud.anchorSpeech(def.id, (npcHead.x * 0.5 + 0.5) * W,
            (-npcHead.y * 0.5 + 0.5) * H - 8, onScreen);
        }
      }
    }

    // ---------------------------------------------------------- day / night
    var floodlight = new THREE.PointLight(0xfff0c4, 0, 54, 1.6);
    scene.add(floodlight);

    function updateSky() {
      var k = (S.elapsed / DAY_LENGTH + 0.08) % 1;
      if (world.setTimeOfDay) world.setTimeOfDay(k);
      if (scene.fog) renderer.setClearColor(scene.fog.color);

      var phase = (k >= 0.125 && k < 0.44) ? 'day'
                : ((k < 0.125 || k < 0.66) ? 'dusk' : 'night');
      if (phase !== S.phase) {
        S.phase = phase;
        hud.setPhase(phase);
        if (phase === 'night' && S.started) {
          hud.toast('Night. The lamp on the barrow is all you get.', 'info');
        }
        if (phase === 'dusk' && S.started) hud.toast('Maghreb. The sea goes gold.', 'info');
        if (phase === 'night' && S.started) npcEvent('night');
      }
      // the mazout generator
      var want = (phase !== 'day') ? 1.9 : 0;   // the barrow lamp, always with you
      floodlight.intensity = lerp(floodlight.intensity, want, 0.04);
      floodlight.position.set(body.pos.x, body.pos.y + 2.6, body.pos.z);
    }

    // ------------------------------------------------------------- flavour
    var FALLBACK_HECKLES = [
      'Shu 3am ta3mel ya 3ammi?',
      'Khalas. Rou2 3a 7alak.',
      'The sea was here before you.',
      'My father tiled the sea. Look at him now.',
      'Go get a government job.'
    ];
    function heckle() {
      var list = (BLB_HUD.HECKLES && BLB_HUD.HECKLES.length) ? BLB_HUD.HECKLES : FALLBACK_HECKLES;
      hud.heckle(pick(list));
    }

    var statsDirty = true;
    function pushStats() { statsDirty = true; }
    function flushStats() {
      if (!statsDirty) return;
      statsDirty = false;
      hud.setStats({
        mortar: Math.floor(S.mortar), mortarMax: S.mortarMax,
        tiles: sim.count, metres: sim.count * 4,
        tierIdx: 0, swell: waves.swell(S.elapsed),
        laid: S.laid, lost: S.lost
      });
    }

    // ---------------------------------------------------------- save / load
    function serialize() {
      return {
        v: 3, sim: sim.serialize(), mortar: S.mortar,
        elapsed: S.elapsed, laid: S.laid, lost: S.lost,
        px: body.pos.x, py: body.pos.y, pz: body.pos.z
      };
    }
    function save() {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); } catch (e) { /* private window */ }
    }
    function applySave(d) {
      if (!d || d.v !== 3) return false;
      try {
        if (d.sim) sim.load(d.sim);
        S.mortar = d.mortar || 0;
        S.elapsed = d.elapsed || 0; S.laid = d.laid || 0; S.lost = d.lost || 0;
        tiles.clear();
        sim.forEach(function (t) { tiles.add(t.i, t.j, t.tier); });
        body.teleport(d.px || 0, d.py || DECK_Y, d.pz || -11);
        S.nextInspection = S.elapsed + INSPECTION_EVERY;
        S.nextHeckle = S.elapsed + 30;
        return true;
      } catch (e) { return false; }
    }

    // ------------------------------------------------------------ new game
    function freshStart() {
      // The municipality laid five balatat years ago and then lost interest.
      for (var i = -2; i <= 2; i++) {
        if (sim.place(i, 0, 0, 0)) tiles.add(i, 0, 0);
      }
      S.mortar = 6;
    }

    var restored = applySave(saved);
    if (!restored) freshStart();
    pushStats();
    hud.showIntro();

    function start() {
      if (S.started) return;
      S.started = true;
      sfx.unlock();
      hud.hideIntro();
      hud.toast('Click to capture the mouse. Hold E at a pile for mouna.', 'info');
      updateHint();
      setTimeout(heckle, 6500);
    }

    // ------------------------------------------------------------ the loop
    var clock = new THREE.Clock();
    var wearTimer = 0, crumbleSfxTimer = 0, washLevel = -1, saveTimer = 0;
    var fpsAcc = 0, fpsN = 0, degraded = false;
    var moveVec = new THREE.Vector3();
    var facing = Math.PI;

    /* The loop is split so one frame can be advanced deterministically:
       requestAnimationFrame is suspended whenever the tab is backgrounded, so
       tick(dt) is what makes the game testable from the console. */
    function frame() {
      requestAnimationFrame(frame);
      var dt = Math.min(clock.getDelta(), 0.05);
      if (!dt) return;
      tick(dt);
    }

    function tick(dt) {
      S.elapsed += dt;
      var t = S.elapsed;

      // --- camera keys
      if (keys.ArrowLeft) cam.yaw += dt * 1.7;
      if (keys.ArrowRight) cam.yaw -= dt * 1.7;
      if (keys.ArrowUp) {
        if (firstPerson) cam.pitch = clamp(cam.pitch + dt * 1.1, -1.35, 1.35);
        else cam.tpPitch = clamp(cam.tpPitch - dt * 1.1, 0.07, 1.22);
      }
      if (keys.ArrowDown) {
        if (firstPerson) cam.pitch = clamp(cam.pitch - dt * 1.1, -1.35, 1.35);
        else cam.tpPitch = clamp(cam.tpPitch + dt * 1.1, 0.07, 1.22);
      }

      // --- player input rotated into world axes
      var mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + touch.moveZ;
      var mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touch.moveX;
      var fx2 = -Math.sin(cam.yaw), fz2 = -Math.cos(cam.yaw);
      moveVec.set(fx2 * mz + (-fz2) * mx, 0, fz2 * mz + fx2 * mx);
      if (moveVec.lengthSq() > 1) moveVec.normalize();
      if (S.started && (mx || mz)) facing = Math.atan2(moveVec.x, moveVec.z);

      var input = {
        moveX: S.started ? moveVec.x : 0,
        moveZ: S.started ? moveVec.z : 0,
        jump: !!keys.Space,
        run: !!(keys.ShiftLeft || keys.ShiftRight)
      };
      body.step(dt, t, input, waves);

      // --- simulation
      var destroyed = sim.update(dt, t);
      if (destroyed && destroyed.length) {
        for (var n = 0; n < destroyed.length; n++) {
          var d = destroyed[n];
          tiles.remove(d.i, d.j);
          fx.crumble(cellCentreX(d.i), TILE_TOP, cellCentreZ(d.j));
          S.lost++;
        }
        if (crumbleSfxTimer <= 0) { sfx.crumble(); crumbleSfxTimer = 0.4; }
        if (destroyed.length >= 4) hud.toast('The sea took ' + destroyed.length + ' balatat.', 'bad');
        if (destroyed.length >= 3) npcEvent('lost');
        pushStats();
      }
      crumbleSfxTimer -= dt;

      // --- wear colours, a few times a second, frontier only
      wearTimer -= dt;
      if (wearTimer <= 0) {
        wearTimer = 0.22;
        sim.forEach(function (tile) { if (tile.hp < tile.maxHp) tiles.wear(tile); });
      }

      if (placing) tryPlace(false);
      if (S.started) updateGathering(dt);
      updateNPCs(dt);
      updateSky();

      // --- the uncle by the railing
      if (S.started && t > S.nextHeckle) {
        S.nextHeckle = t + 30 + Math.random() * 26;
        npcEvent('idle', true);     // nobody nearby -> the uncle heckles from the HUD
      }

      // --- the municipality pays by the surviving square metre
      if (S.started && t > S.nextInspection) {
        S.nextInspection = t + INSPECTION_EVERY;
        if (sim.count > 0) {
          hud.toast('Inspection: ' + sim.count * 4 + ' m² still standing.', 'good');
        }
      }

      // --- squall warning
      var swell = waves.swell(t);
      if (swell > 0.66 && !S.squall) {
        S.squall = true;
        if (S.started) {
          hud.toast('3asfe jayye — the sea is getting angry.', 'bad');
          npcEvent('squall');
        }
      } else if (swell < 0.5 && S.squall) {
        S.squall = false;
        if (S.started) hud.toast('The sea has calmed. For now.', 'info');
      }
      var wl = clamp(0.25 + swell * 0.75, 0, 1);
      if (Math.abs(wl - washLevel) > 0.04) { washLevel = wl; sfx.wash(wl); }

      // --- mason
      mason.group.position.copy(body.pos);
      mason.group.rotation.y = lerp(mason.group.rotation.y, facing, clamp(dt * 11, 0, 1));
      var spd = Math.sqrt(body.vel.x * body.vel.x + body.vel.z * body.vel.z);
      mason.animate(dt, spd, body.inWater, mason.state.lay > 0.05);
      if (body.inWater && !S.wasInWater) npcEvent('swim');
      S.wasInWater = body.inWater;
      if (body.inWater && Math.random() < dt * 3) {
        fx.burst(body.pos.x, 0.1, body.pos.z, 0.45);
      }

      // --- camera
      if (firstPerson) {
        // head bob keyed to actual ground speed, killed while swimming
        var bobAmt = clamp(spd / 6, 0, 1) * (body.inWater ? 0 : 1);
        bobT += dt * (5.5 + spd * 1.5);
        bobY = lerp(bobY, Math.sin(bobT) * 0.045 * bobAmt, clamp(dt * 12, 0, 1));
        bobRoll = lerp(bobRoll, Math.cos(bobT * 0.5) * 0.013 * bobAmt, clamp(dt * 10, 0, 1));
        camera.position.set(body.pos.x, body.pos.y + EYE + bobY, body.pos.z);
        if (body.inWater) {
          var wl2 = waves.height(camera.position.x, camera.position.z, t) + 0.30;
          if (camera.position.y < wl2) camera.position.y = wl2;
        }
        camera.rotation.set(cam.pitch, cam.yaw, bobRoll);
        // the trowel comes up as you lay
        vmSwing = lerp(vmSwing, mason.state.lay > 0.05 ? 1 : 0, clamp(dt * 10, 0, 1));
        viewModel.position.set(0.30, -0.26 + Math.sin(bobT) * 0.014 * bobAmt - vmSwing * 0.09,
                               -0.52 + vmSwing * 0.11);
        viewModel.rotation.set(-0.22 - vmSwing * 0.55, 0.22, 0.10);
      } else {
        camTarget.set(body.pos.x, body.pos.y + 1.25, body.pos.z);
        var cp = Math.cos(cam.tpPitch);
        camPos.set(
          camTarget.x + Math.sin(cam.yaw) * cp * cam.dist,
          camTarget.y + Math.sin(cam.tpPitch) * cam.dist,
          camTarget.z + Math.cos(cam.yaw) * cp * cam.dist
        );
        var minY = waves.height(camPos.x, camPos.z, t) + 1.1;
        if (camPos.y < minY) camPos.y = minY;
        camera.position.lerp(camPos, clamp(dt * 7.5, 0, 1));
        camera.rotation.set(0, 0, 0);
        camera.lookAt(camTarget);
      }

      // --- ghost balata under the cursor
      if (S.started) {
        raycaster.setFromCamera(aimNDC(), camera);
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          worldToCell(hitPoint.x, hitPoint.z, cellTmp);
          var bad = cellValidity(cellTmp.i, cellTmp.j, 0, true);
          var show = cellTmp.j >= 0 && cellTmp.j <= 400 && Math.abs(cellTmp.i) <= 64 && !sim.get(cellTmp.i, cellTmp.j);
          ghost.visible = show;
          if (hud.setReticle) hud.setReticle(show ? (bad ? 'bad' : 'ok') : 'none');
          if (show) {
            ghost.position.set(cellCentreX(cellTmp.i), TILE_TOP / 2 + 0.03, cellCentreZ(cellTmp.j));
            ghostMat.color.setHex(bad ? 0xe8623c : 0x8ff0a8);
            ghostMat.opacity = bad ? 0.22 : 0.30 + Math.sin(t * 6) * 0.06;
          }
        } else { ghost.visible = false; if (hud.setReticle) hud.setReticle('none'); }
      }

      sea.update(t, body.pos.x, body.pos.z);
      fx.update(dt);
      if (world.update) world.update(t, dt, { waves: waves, camera: camera, playerPos: body.pos });
      hud.frame(dt);
      flushStats();

      // --- autosave
      saveTimer -= dt;
      if (saveTimer <= 0) { saveTimer = 10; if (S.started) save(); }

      // --- one step of graceful degradation on weak GPUs
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 4) {
        var fps = fpsN / fpsAcc;
        fpsAcc = 0; fpsN = 0;
        if (!degraded && fps < 42) {
          degraded = true;
          renderer.setPixelRatio(1);
          renderer.setSize(window.innerWidth, window.innerHeight);
        }
      }

      renderer.render(scene, camera);
    }

    hud.setLoading(null);
    frame();

    // published-page hot reload: keep the player's sea when the page updates
    if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
      try { window.claude.hot.snapshot(function () { return serialize(); }); } catch (e) { /* ignore */ }
    }
    window.addEventListener('pagehide', function () { if (S.started) save(); });

    // handle for debugging from the console: __blb.body.pos, __blb.state, ...
    return {
      state: S, sim: sim, save: save, serialize: serialize,
      body: body, world: world, camera: camera, npcs: npcs, tiles: tiles,
      waves: waves, cam: cam, hud: hud, renderer: renderer, scene: scene,
      tick: tick, npcSay: npcSay, npcEvent: npcEvent, sfx: sfx
    };
  }

  // ------------------------------------------------------------------ init
  function loadSaved() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function go() {
    if (!window.THREE) { document.getElementById('fatal').hidden = false; return; }
    var hot = window.claude && window.claude.hot;
    if (hot && hot.ready) hot.ready(function (data) { window.__blb = boot((data && data.v === 3) ? data : loadSaved()); });
    else window.__blb = boot(loadSaved());
  }

  window.BLB_GAME = { boot: boot, go: go, TIERS: TIERS, PALETTE: P, PALETTE_CSS: PCSS };
})();
