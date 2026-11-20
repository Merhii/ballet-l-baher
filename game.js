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
  /* Health is stamina, not hit points: laying balat and swimming in November
     wear you down, and knefe at Jardali's is how you get it back. */
  var HEALTH_MAX = 100;
  var DRAIN_IDLE = 0.42;      // per second, just standing in the sun
  var DRAIN_RUN = 0.75;
  var DRAIN_DIG = 1.05;
  var DRAIN_WATER = 2.30;
  var SOAK_HIT = 7;           // one-off, the moment the sea gets you
  var KNEFE_PRICE = 25;
  var KNEFE_HEAL = 45;

  /* Health is separate from stamina: stamina is how much work is left in you,
     health is what the sea, a fall or an empty stomach take. At zero you pass
     out and wake on the corniche with a hospital bill. */
  var HP_MAX = 100;
  var HP_COLD = 0.35;          // per second in November water
  var HP_DROWN = 6.5;          // per second in water with no stamina left
  var HP_STARVE = 0.6;         // per second on land with no stamina left
  var HP_REGEN = 0.35;         // per second while well rested
  var FALL_SAFE = 11;          // landing speed (m/s) you walk away from
  var RESPAWN_HP = 60;

  /* What the food courts sell. `sta` is stamina, `hp` health, `buff` keeps
     working after you eat. Knefe stays at Jardali's. */
  var FOODS = {
    knefe:    { name: 'Knefe b jebne',   ar: 'كنافة',   price: KNEFE_PRICE, sta: KNEFE_HEAL, hp: 10 },
    // Souk el Akel
    samra:    { name: 'Bouza w helou',    ar: 'حلويات السمرا', price: 10, sta: 16, hp: 6,
                buff: { id: 'barid', label: 'Bouza · cool', t: 90 } },
    soubras:  { name: 'Soubras sandwich', ar: 'SOUBRAS',       price: 30, sta: 35, hp: 22,
                buff: { id: 'shab3an', label: 'Shab3an · heals', t: 60 } },
    akkawi:   { name: 'Falafel Akkawi',   ar: 'فلافل عكاوي',  price: 12, sta: 24, hp: 12 }
  };

  /* The people behind the Souk el Akel counters, keyed by what they sell.
     These are real Saida names, so the bubbles carry the shop's name and
     nobody is given invented facts or invented staff. */
  var VENDORS = {
    samra: { name: 'Helwayet el Samra', voice: 3, hat: 'cap', shirt: 0xe8e2d4, hatCol: 0xb9502f, lines: {
      greet: [{ t: 'Ahla! Bouza aw helou? Aw el tnein?', ar: 'بوظة أو حلو؟' }],
      idle: [{ t: 'Bouza 3arabiye, b festo2. Btberrdak.', ar: 'بوظة عربية' },
             { t: 'Ma fi shi byeli2 3al ba7er mitl el helou.', ar: 'مثل الحلو' }],
      sold: [{ t: 'Sa7tein! Hay btberrdak sa3a w nos.', ar: 'صحتين' },
             { t: 'Zedtellak festo2. Ma t2oul la 7ada.', ar: 'فستق زيادة' }],
      pricey: [{ t: '3ashra lira. Ballet shwayy w rja3.', ar: 'عشر ليرات' }],
      full: [{ t: 'Khalas, kelt helou kfeye. Rou7 shtghol.', ar: 'كلت كفاية' }] } },
    soubras: { name: 'Soubras', voice: 2, hat: 'cap', shirt: 0x0b3a4f, hatCol: 0xf2b733, lines: {
      greet: [{ t: 'Sandwich? 3al nar, halla2.', ar: 'ساندويش؟' }],
      idle: [{ t: 'Ma bta3ref tballet 3a ma3de faadye.', ar: 'معدة فاضية' },
             { t: 'Toum? Akid toum.', ar: 'توم؟' }],
      sold: [{ t: 'Hay. Btedfik sa3a.', ar: 'بتدفّيك' },
             { t: 'Sa7tein. W ba3dén ballet.', ar: 'صحتين' }],
      pricey: [{ t: 'Tlétin lira ya 3ammi. Mesh balash.', ar: 'تلاتين ليرة' }],
      full: [{ t: 'Wa2ef, wa2ef. Kelt ktir.', ar: 'كلت كتير' }] } },
    akkawi: { name: 'Falafel Akkawi', voice: 1, hat: 'none', shirt: 0x3f6b3a, hatCol: 0x2b2420, lines: {
      greet: [{ t: 'Falafel skhoun! Sandwich?', ar: 'فلافل سخنة' }],
      idle: [{ t: 'Tarator, kabis, ba2dounes. Bass hék.', ar: 'بس هيك' },
             { t: 'Ballet el ba7er 3a ma3de faadye? La2. Kol.', ar: 'كول' }],
      sold: [{ t: 'Sa7tein 3a 2albak.', ar: 'صحتين على قلبك' },
             { t: 'Zedtellak wa7de. Ma t2oul.', ar: 'زدتلّك وحدة' }],
      pricey: [{ t: 'Tna3sh lira. Ta3a ba3dén.', ar: 'تنعش ليرة' }],
      full: [{ t: 'Shab3an? Mnih. Rou7 shtghol.', ar: 'شبعان؟' }] } }
  };

  var PAY_PER_BALATA = 3;     // the more you tile, the more you make
  var PAY_PER_SURVIVING = 1;  // and the inspection pays rent on what holds

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
    // 144 -> 20.9k vertices displaced per frame; 90 -> 8.3k. Phones get 90.
    var SIZE = 720, SEG = IS_TOUCH ? 90 : 144, STEP = SIZE / SEG;
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
  // Phones: no pointer lock, a lighter render tier, and on-screen controls.
  var IS_TOUCH = (typeof window !== 'undefined') &&
    ((('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0) ||
     /[?&]touch\b/.test(window.location.search));   // ?touch forces the mobile tier

  function boot(saved) {
    var canvas = document.getElementById('webgl');
    var overlay = document.getElementById('overlay');

    // ---- renderer / scene / lights
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    // a phone GPU does not want a 2x buffer on a full-screen WebGL scene
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.2 : 1.75));
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

    // ---- settings, kept per browser
    var SET = { sound: true, sens: 1, fov: 58, view: 'first', bob: true };
    try {
      var rawSet = JSON.parse(localStorage.getItem('blb.settings') || 'null');
      if (rawSet) {
        for (var sk in SET) { if (rawSet.hasOwnProperty(sk)) SET[sk] = rawSet[sk]; }
      } else {
        var oldSens = parseFloat(localStorage.getItem('blb.sens'));
        if (oldSens > 0.0004 && oldSens < 0.02) SET.sens = oldSens / 0.0022;
      }
    } catch (e) { /* private window */ }
    function saveSettings() {
      try { localStorage.setItem('blb.settings', JSON.stringify(SET)); } catch (e) { /* ignore */ }
    }

    var hud = BLB_HUD.create({
      root: overlay, palette: PCSS, tiers: HUD_TIERS, simple: true,
      onSelectTier: function () {},
      onStart: function () { start(); },
      // the HUD's speaker button reports `muted`
      onToggleSound: function (muted) { sfx.muted = !!muted; SET.sound = !muted; saveSettings(); },
      onMenu: function (act, v) { onMenu(act, v); },
      keys: false
    });
    var sfx = BLB_HUD.createAudio();
    sfx.muted = !SET.sound;
    if (hud.setMuted) hud.setMuted(!SET.sound);

    // ---- player
    var mason = createMason(P.SHIRT, P.HAZARD);
    scene.add(mason.group);
    mason.group.visible = false;        // first person: you see the viewmodel instead
    var body = BLB_PHYSICS.createPlayerBody({ sim: sim, world: world });
    body.teleport(0, DECK_Y, -11);

    // ---- state
    var S = {
      mortar: 6, mortarMax: MORTAR_MAX,
      health: HEALTH_MAX, lira: 0, knefeEaten: 0,
      hp: HP_MAX, buffs: {}, fainted: 0, faintCause: '', faints: 0,
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
    var firstPerson = SET.view !== 'third';
    var paused = false;
    camera.fov = clamp(+SET.fov || 58, 45, 80);
    camera.updateProjectionMatrix();
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
    var fp = { locked: false, giveUp: false, failures: 0, dragX: 0, dragY: 0, dragging: false, expectUnlock: false };
    var look = { sens: 0.0022 * clamp(+SET.sens || 1, 0.3, 3), drag: 0.0042 };

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
      // the view follows the mouse anyway; the hint only offers the capture
      var show = !IS_TOUCH && !fp.giveUp && S.started && !paused && !S.fainted && firstPerson && !fp.locked;
      hint.textContent = 'click to capture the mouse';
      hint.classList.toggle('on', show);
      // the on-screen sticks sit above the HUD layer, so they must get out of the menu's way
      if (touchWrap) touchWrap.style.display = (S.started && !paused) ? '' : 'none';
      canvas.style.cursor = (firstPerson && fp.locked) ? 'none' : '';
    }

    // where the (uncaptured) mouse is, for free look's edge turning
    var ptr = { x: 0, y: 0, inside: false };
    document.addEventListener('mouseleave', function () { ptr.inside = false; });
    window.addEventListener('blur', function () { ptr.inside = false; });
    function freeLookOn() {
      return !IS_TOUCH && firstPerson && !fp.locked && S.started && !paused && !S.fainted &&
        !(hud.isMenuOpen && hud.isMenuOpen());
    }
    function edgeTurn(dt) {
      if (!freeLookOn() || !ptr.inside) return;
      // sideways only: pitch has a short range the mouse covers anyway, and the
      // top edge is where the HUD's buttons live
      var W = window.innerWidth, edge = Math.max(36, W * 0.05);
      var kx = ptr.x < edge ? (edge - ptr.x) / edge : (ptr.x > W - edge ? -(ptr.x - (W - edge)) / edge : 0);
      if (kx) cam.yaw += clamp(kx, -1, 1) * 2.2 * (look.sens / 0.0022) * dt;
    }

    function requestLook() {
      if (IS_TOUCH) { fp.giveUp = true; return; }   // nothing to capture on a phone
      if (!firstPerson || fp.locked) return;
      if (!canvas.requestPointerLock) { fp.giveUp = true; updateHint(); return; }
      try {
        // newer browsers return a promise and reject it instead of throwing
        var lockReq = canvas.requestPointerLock();
        if (lockReq && typeof lockReq.catch === 'function') lockReq.catch(function () { /* counted below */ });
      } catch (err) { fp.failures++; }
      setTimeout(function () {
        if (fp.locked) return;
        fp.failures++;
        if (fp.failures >= 2 && !fp.giveUp) {
          fp.giveUp = true;
          hud.toast('Mouse capture blocked here — the view still follows the mouse; hold it at a screen edge to keep turning.', 'info');
        }
        updateHint();
      }, 500);
    }
    document.addEventListener('pointerlockchange', function () {
      var was = fp.locked;
      fp.locked = (document.pointerLockElement === canvas);
      if (fp.locked) { fp.failures = 0; fp.giveUp = false; }
      // Esc while the mouse is captured never reaches us as a key: the browser
      // just drops the lock. Losing it unasked is how the player pauses.
      if (was && !fp.locked && !fp.expectUnlock && S.started && !paused && !S.fainted) pause();
      fp.expectUnlock = false;
      updateHint();
    });
    function releaseLook() {
      if (fp.locked && document.exitPointerLock) { fp.expectUnlock = true; document.exitPointerLock(); }
    }
    document.addEventListener('pointerlockerror', function () {
      fp.failures++;
      if (fp.failures >= 2) fp.giveUp = true;
      updateHint();
    });

    function setSens(v, quiet) {
      look.sens = clamp(v, 0.0006, 0.0066);
      SET.sens = +(look.sens / 0.0022).toFixed(2);
      saveSettings();
      if (!quiet) hud.toast('Mouse sensitivity ' + SET.sens.toFixed(2) + '×', 'info');
    }

    function setView(first, quiet) {
      firstPerson = !!first;
      SET.view = firstPerson ? 'first' : 'third';
      saveSettings();
      mason.group.visible = !firstPerson;
      viewModel.visible = firstPerson;
      if (!firstPerson) releaseLook();
      if (!quiet) hud.toast(firstPerson ? 'First person' : 'Third person', 'info');
      updateHint();
    }

    function setSound(on) {
      SET.sound = !!on;
      sfx.muted = !SET.sound;
      if (hud.setMuted) hud.setMuted(!SET.sound);
      saveSettings();
    }

    function onKey(e, down) {
      var c = e.code;
      var was = keys[c];
      if (down && (c === 'Escape' || c === 'KeyP')) {
        if (!was) {
          if (hud.isMenuOpen && hud.isMenuOpen()) {
            if (hud.closeSheet && hud.closeSheet()) { /* stepped back out of a sub-page */ }
            else if (paused) resume();
          } else if (S.started && !S.fainted) {
            pause();
          }
        }
        keys[c] = down;
        return;
      }
      if (hud.isMenuOpen && hud.isMenuOpen()) { keys[c] = false; return; }
      keys[c] = down;
      if (!down) return;
      if (S.fainted) return;
      if (c === 'KeyE' && !was && S.started) {
        var near = nearestNPC();
        if (near) { talkTo(near.npc); return; }   // E is talk when someone is beside you
      }
      if (c === 'KeyV') setView(!firstPerson);
      if (c === 'BracketLeft') { setSens(look.sens * 0.84); return; }
      if (c === 'BracketRight') { setSens(look.sens * 1.19); return; }
      if (c === 'KeyM') { setSound(!SET.sound); hud.toast(SET.sound ? 'Sound on' : 'Sound off', 'info'); }
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
      if (firstPerson && !fp.locked && e.pointerType !== 'mouse') {
        // touch: a finger on the scene drags the view; a tap still lays
        requestLook();
        orbiting = true; lastPX = e.clientX; lastPY = e.clientY;
        placing = false;
        return;
      }
      if (firstPerson && !fp.locked) {
        /* Mouse: the view already follows the mouse (free look), so a click is
           always a click — it lays a balata — and it also asks for the capture,
           which only removes the cursor and the screen-edge limit. */
        requestLook();
      }
      placing = true;
      tryPlace(true);
    });
    window.addEventListener('pointerup', function (e) {
      if (e.button === 2 || e.button === 1) { orbiting = false; return; }
      if (firstPerson && !fp.locked && e.pointerType !== 'mouse') {
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
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true;
      if (freeLookOn() && e.pointerType === 'mouse' && !orbiting) {
        /* Free look without the capture: the view follows the mouse, no button
           held. Holding the pointer against an edge keeps turning (see tick). */
        var fx = e.movementX || 0, fy = e.movementY || 0;
        if (fx > 140) fx = 140; else if (fx < -140) fx = -140;
        if (fy > 140) fy = 140; else if (fy < -140) fy = -140;
        cam.yaw -= fx * look.sens;
        cam.pitch = clamp(cam.pitch - fy * look.sens, -1.35, 1.35);
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
    var tTalk = null, touchWrap = null;
    if (IS_TOUCH) buildTouchControls();
    function buildTouchControls() {
      var wrap = document.createElement('div');
      touchWrap = wrap;
      wrap.id = 'touchlayer';
      wrap.innerHTML =
        '<div id="tstick"><div id="tnub"></div></div>' +
        '<div id="tbtns"><button id="ttalk" type="button">TALK</button>' +
        '<button id="tlay" type="button">بلّط</button>' +
        '<button id="tdig" type="button">SHOVEL</button>' +
        '<button id="tjump" type="button">JUMP</button></div>' +
        '<div id="trotate"><b>turn your phone</b><span>this one wants landscape</span></div>';
      var st = document.createElement('style');
      st.textContent =
        '#touchlayer{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:"Barlow Condensed",system-ui,sans-serif}' +
        '#tstick{position:absolute;left:calc(18px + env(safe-area-inset-left,0px));bottom:calc(26px + env(safe-area-inset-bottom,0px));width:132px;height:132px;border-radius:50%;border:3px solid rgba(237,246,243,.55);background:rgba(11,58,79,.28);pointer-events:auto;touch-action:none}' +
        '#tnub{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(242,179,51,.85)}' +
        '#tbtns{position:absolute;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(26px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:10px;pointer-events:auto}' +
        '#tbtns button{font:700 19px/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#0b3a4f;background:#f2b733;border:3px solid #0b3a4f;border-radius:4px;padding:15px 20px;touch-action:none}' +
        '#tlay{font-family:"Reem Kufi",system-ui,sans-serif!important;font-size:23px!important;background:#edf6f3!important}' +
        '#ttalk{display:none;background:#3fa8b4!important;color:#0b3a4f!important}' +
        '#tbtns button:active{transform:translateY(2px)}' +
        // a phone held upright gets almost no horizon; ask once, politely
        '#trotate{position:fixed;inset:0;z-index:60;display:none;pointer-events:auto;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:8px;' +
        'background:#0b3a4f;color:#edf6f3;text-align:center;padding:24px}' +
        '#trotate b{font:700 22px/1.1 "Reem Kufi",system-ui,sans-serif;letter-spacing:.04em}' +
        '#trotate span{font-size:14px;letter-spacing:.14em;text-transform:uppercase;opacity:.75}' +
        '@media (orientation:portrait){#trotate{display:flex}}';
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
      /* Looking is handled by the canvas pointer events, which already cover
         touch. The old touchmove listener here doubled every drag. */
      tTalk = wrap.querySelector('#ttalk');
      tTalk.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var near = nearestNPC();
        if (near) talkTo(near.npc);
      });
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
      if (S.health <= 0) return 'too weak — knefe at Jardali';
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
      S.lira += PAY_PER_BALATA;
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
    var digTimer = 0, digging = false;
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
      digging = false;
      var pile = nearestPile();
      var who = nearestNPC();
      // whoever is closer wins the E key
      if (tTalk) tTalk.style.display = who ? 'block' : 'none';
      if (who && (!pile || who.dist < 2.6)) {
        var food = who.npc.def.sells && FOODS[who.npc.def.sells];
        var label = food
          ? food.name.toLowerCase() + ' · ' + food.price + ' l.l.'
          : 'talk to ' + who.npc.def.name;
        hud.setPrompt(IS_TOUCH ? label : 'E — ' + label);
      } else if (pile && keys.KeyE) {
        if (S.mortar >= S.mortarMax) {
          hud.setPrompt('barrow full — go tile the sea');
        } else {
          S.mortar = Math.min(S.mortarMax, S.mortar + dt * 7.5);
          digging = true;
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
        hud.setPrompt(IS_TOUCH ? 'hold SHOVEL for mouna' : 'hold E — shovel mouna');
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
          { t: 'Rje3t? Ya3ni ma fi shi a7san ta3melo?', ar: 'رجعت؟' },
          { t: 'Ana 2a3ed 3a hal darabzin min 2abel ma tkhla2.', ar: 'قبل ما تخلق' },
          { t: 'Bayyi 7aka hal 7aki la wa7ad b 3arabaye. Sent 74.', ar: 'سنة ٧٤' },
          { t: 'Tayyeb. Khatt mestawi. Ma 2elet shi.', ar: 'ما قلت شي' },
          { t: 'Iza badak tente 3arabaye, ba3ref wa7ad.', ar: 'بعرف واحد' }
        ],
        lines: {
          greet: [{ t: 'Ahla. Rje3t.', ar: 'أهلا' }, { t: 'Yi. El mhandes.', ar: 'يي، المهندس' }],
          idle: [
            { t: 'Shu 3am ta3mel ya 3ammi?', ar: 'شو عم تعمل يا عمي؟' },
            { t: 'Khalas. Rou2 3a 7alak.', ar: 'خلص، روق ع حالك' },
            { t: 'El ba7er kén hon 2abel bayyi.', ar: 'البحر كان هون قبل بيي' },
            { t: 'Ya3ni el ba7er talab balat?', ar: 'البحر طلب بلاط؟' },
            { t: 'Dabber 7alak b wazife.', ar: 'دبّر حالك بوظيفة' },
            { t: 'Kell moje betkoul: la2.', ar: 'كل موجة بتقول لأ' }
          ],
          firstTile: [{ t: 'Balata wa7de. Mabrouk. Badyé el ba7er kello.', ar: 'بلاطة وحدة' }],
          lost: [
            { t: '2eltellak. El ba7er ma bya3ti wusoulat.', ar: 'ما بيعطي وصولات' },
            { t: 'Ya 7aram el mouna.', ar: 'يا حرام المونة' }
          ],
          milestone: [{ t: '{n} balata. Tayyeb. Ma shefet shi.', ar: 'ما شفت شي' }],
          night: [{ t: 'Rou7 3a el bét. 7atta el ba7er bineym.', ar: 'روح ع البيت' }],
          swim: [{ t: 'Ha. Halla2 3am tesba7 ma3o.', ar: 'عم تسبح معه' }],
          spent: [{ t: 'Shefet? El ba7er ma bite3ab. Inta bti3ab.', ar: 'البحر ما بيتعب' }]
        }
      },
      {
        id: 'imkamel', name: 'Im Kamel', voice: 3, hat: 'scarf', scale: 0.96,
        shirt: 0x9c5f7a, hatCol: 0xb9502f, yaw: Math.PI * 0.85,
        at: function (w) {
          var c = w.cart && w.cart.position;
          return c ? { x: c.x - 1.6, y: DECK_Y, z: c.z + 1.1 } : { x: 20, y: DECK_Y, z: -8 };
        },
        talk: [
          { t: 'Khod, kol. Ma btballet w inta ja3an.', ar: 'خود كول' },
          { t: '3mol mneeh w kob bl ba7er. Immi kénet et2oula kell yom.', ar: 'إعمل منيح وكبّ بالبحر' },
          { t: 'W kénet et2oul kamén: w ma terja3 mballal.', ar: 'ما ترجع مبلّل' },
          { t: 'Khod mouna. Ma b2oul lal m3allem.', ar: 'ما بقول للمعلّم' },
          { t: 'Bet zakkerni b ibni. Huwwe kamén bi3mol shaghlat bala ma3na.', ar: 'بتذكّرني بابني' }
        ],
        givesAt: [0, 3],
        lines: {
          greet: [{ t: 'Ahla w sahla ya 3ammi.', ar: 'أهلا وسهلا' }],
          idle: [
            { t: 'Kell shi b wa2to 7elo.', ar: 'كل شي بوقته حلو' },
            { t: 'Alla ya3tik el 3afye.', ar: 'الله يعطيك العافية' },
            { t: 'Shrab shay, ba3dén ballet.', ar: 'اشرب شاي' },
            { t: 'Tekram 3énak, bass kol shi.', ar: 'تكرم عينك' }
          ],
          firstTile: [{ t: 'Mabrouk. Halla2 sar mashrou3.', ar: 'مبروك' }],
          lost: [{ t: 'Ma t2khod 3a 2albak. Bokra fi ba7er kamén.', ar: 'ما تاخد ع قلبك' }],
          night: [{ t: 'Rou7 nam ya 3ammi. El ba7er mish rayé7.', ar: 'روح نام' }],
          swim: [{ t: 'Yalla, tla3! El mayy barde.', ar: 'المي باردة' }],
          spent: [{ t: 'Shouf 7alak. Rou7 kol knefe 3and Jardali.', ar: 'روح كول كنافة' }]
        }
      },
      {
        id: 'ousama', name: 'Abou Ousama', voice: 1, hat: 'none', scale: 1.02,
        shirt: 0x7d8da0, hatCol: 0x2b2420, yaw: Math.PI * 0.12,
        at: function () { return { x: 8.5, y: DECK_Y, z: -4.2 }; },
        talk: [
          { t: 'Obbe ya Sayda.', ar: 'يا صيدا' },
          { t: 'Hal 2al3a? El Franj banouwa. El ba7er a2dam menna w mennon.', ar: 'القلعة' },
          { t: 'Dayya3et tlet shabak 3and el mole. Byekolon.', ar: 'ضيّعت تلت شباك' },
          { t: 'Lamma el mayy tseer malsa mitl el zét — hayda wa2t el kizb.', ar: 'مثل الزيت' },
          { t: 'Hott wa7de 3anne. 3and el daraj. B2ellak 3aléha.', ar: 'حط وحدة عنّي' }
        ],
        lines: {
          greet: [{ t: 'Obbe ya Sayda.', ar: 'يا صيدا' }],
          idle: [
            { t: 'Sidet hon khamsin sene. El ba7er ma tghayyar.', ar: 'خمسين سنة' },
            { t: 'El 2al3a lessa wa2fe. Fik inta kamén.', ar: 'لسا واقفة' },
            { t: 'B ayyémna kenna nermi shabak, mish balat.', ar: 'شباك مش بلاط' },
            { t: 'Dir balak. Badda aktar men balat.', ar: 'دير بالك' }
          ],
          firstTile: [{ t: 'Sahtein. Halla2 el ba7er bya3ref ismak.', ar: 'صحتين' }],
          lost: [{ t: 'Byesh7a2 w byezfor. Nafs el ba7er.', ar: 'نفس البحر' }],
          squall: [{ t: 'Tal3it 3asfe. Ib3ed 3an el taraf ya 3ammi.', ar: 'طلعت عاصفة' }],
          night: [{ t: 'Adwiyet Sayda. Ma fi mitla.', ar: 'أضوية صيدا' }],
          spent: [{ t: 'El ba7er byekhod men el zalame shwayy shwayy.', ar: 'شوي شوي' }]
        }
      },
      {
        id: 'jardali', name: 'Jardali', voice: 2, hat: 'cap', scale: 1.0,
        shirt: 0xf0ece0, hatCol: 0xedf6f3, yaw: 0, sells: 'knefe',
        at: function (w) {
          var k = w.knefe || { x: -24, y: DECK_Y, z: -9.4 };
          return { x: k.x, y: DECK_Y, z: k.z - 3.2 };
        },
        lines: {
          greet: [{ t: 'Knefe? Sakhne. Lessa tal3a.', ar: 'كنافة سخنة' }],
          idle: [
            { t: 'Knefe b jebne, mish b 2ashta. Hon Sayda.', ar: 'بجبنة مش بقشطة' },
            { t: 'Jeddi fata7 hal mahall sent 48.', ar: 'سنة ٤٨' },
            { t: 'Ballet, ballet. Bass fite2 kol.', ar: 'بس فطّر' }
          ],
          sold: [
            { t: 'Sahtein. Hay sakhne.', ar: 'صحتين' },
            { t: 'Kol, w ba3dén ballet.', ar: 'كول وبعدين بلّط' },
            { t: 'Hay ma3 sha3rayyet ziyéde.', ar: 'مع شعيرية زيادة' }
          ],
          broke: [
            { t: 'Ma ma3ak masari? Khod wa7de 3a 7sabe. Bass hal marra.', ar: 'ع حسابي' }
          ],
          pricey: [
            { t: 'Khamse w 3eshrin. Mish ghali.', ar: 'خمسة وعشرين' },
            { t: 'Ballet shwayy, w ta3a.', ar: 'بلّط شوي وتعا' }
          ],
          full: [
            { t: 'Inta shab3an. Rou7 shtghol.', ar: 'انت شبعان' }
          ],
          spent: [{ t: 'Ta3a, ta3a. 2a3ed. Hay knefe.', ar: 'تعا قعود' }],
          night: [{ t: 'Sakkerna. Bokra men el sob7.', ar: 'سكّرنا' }]
        }
      },
      {
        id: 'jad', name: 'Jad', voice: 4, hat: 'none', scale: 0.74,
        shirt: 0xf2b733, hatCol: 0x2b2420, yaw: Math.PI,
        pace: 2.2,
        at: function () { return { x: -4.5, y: DECK_Y, z: -8.5 }; },
        talk: [
          { t: '3am tballet el ba7er?! SAH?!', ar: 'عم تبلّط البحر؟' },
          { t: 'Kam sar? Ana 3am 3edd kamén. 2elet {n}.', ar: 'كم صار؟' },
          { t: 'El m3allme 2alet mesta7il. 2eltella 3annak.', ar: 'قالت مستحيل' },
          { t: 'Fine emsek el masta7? Marra! Marra wa7de!', ar: 'مرة وحدة!' },
          { t: 'Lamma tkhalles ana mashe la 2ebros.', ar: 'لقبرص' }
        ],
        lines: {
          greet: [{ t: '3am tballet el ba7er?! SAH?!', ar: 'عم تبلّط البحر؟' }],
          idle: [
            { t: 'Fine se3dak? Ana 2awe.', ar: 'أنا قوي' },
            { t: 'Iza khallasto, fine emshe 3aléha?', ar: 'فيني إمشي عليها؟' },
            { t: '3eddét. Sirt 3and {n}.', ar: 'عدّيت' }
          ],
          firstTile: [{ t: 'DALLET! Shefet?!', ar: 'ضلّت!' }],
          lost: [{ t: 'El ba7er akala! AKALA!', ar: 'أكلها!' }],
          milestone: [{ t: '{m} metr! 3am 2oul la kell el 3alam!', ar: 'لكل العالم' }],
          squall: [{ t: 'Moj! Kbir! Yalla!', ar: 'موج كبير!' }],
          swim: [{ t: 'WE2E3! WE2E3 BEL BA7ER!', ar: 'وقع بالبحر!' }],
          spent: [{ t: 'Ta3ebt? Ana ma bet3ab abadan.', ar: 'ما بتعب أبدا' }]
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
          { t: 'Mouna b el 3arabaye, balata b el ba7er. Hayda kell el shughl.', ar: 'هيدا كل الشغل' },
          { t: 'Hotton mazbout. El ba7er bilé2i kell faragh.', ar: 'بيلاقي كل فراغ' },
          { t: 'El taraf huwwe wén btekhsar. Wassi3, ma tba33ed.', ar: 'وسّع، ما تبعّد' },
          { t: 'Ana banét sour el kornish sent 88. Lessa wa2ef. Ta2riban.', ar: 'سنة ٨٨' },
          { t: 'El nasi7a balash. Kell shi tene bi kallef.', ar: 'النصيحة بلاش' }
        ],
        lines: {
          greet: [{ t: 'Inta elli 3am tballet el ba7er. Tayyeb.', ar: 'طيّب' }],
          idle: [
            { t: 'El ba7er zboun 3atel. Ma bidfa3.', ar: 'ما بيدفع' },
            { t: 'Sfouf mestawye. Fawasel day2a. Bass hék.', ar: 'بس هيك' },
            { t: 'Balata mesta3jale sar melk el ba7er.', ar: 'ملك البحر' }
          ],
          lost: [{ t: 'Shefet el taraf? Men hon bye2ta3.', ar: 'من هون بيقطع' }],
          milestone: [{ t: '{n} balata. Ya zalame. Inta jidde.', ar: 'يا زلمة' }],
          spent: [{ t: 'Esta2id. El shughl ma bikhlas, w inta btekhlas.', ar: 'استقيد' }]
        }
      }
    ];

    // the food-court vendors, one behind each counter the world built
    (world.foodCourts || []).forEach(function (court) {
      (court.stalls || []).forEach(function (stall) {
        var v = VENDORS[stall.id];
        if (!v || !FOODS[stall.id]) return;
        NPC_DEFS.push({
          id: 'vendor-' + stall.id, name: v.name, voice: v.voice, hat: v.hat, scale: 1.0,
          shirt: v.shirt, hatCol: v.hatCol, yaw: 0, sells: stall.id, court: court.name,
          at: function () { return { x: stall.x, y: DECK_Y, z: stall.z - 3.1 }; },
          lines: v.lines
        });
      });
    });

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
       Im Kamel hands you mouna on the lines where she offers it. */
    /* Jardali has no conversation of his own: pressing E at his counter buys
       the knefe, and which line he gives you depends on how it went. */
    /* Everyone who sells food works the same way: E at the counter buys one.
       Jardali alone will feed you for free when you are about to fold. */
    function eat(food) {
      S.health = clamp(S.health + food.sta, 0, HEALTH_MAX);
      S.hp = clamp(S.hp + food.hp, 0, HP_MAX);
      if (food.buff) S.buffs[food.buff.id] = food.buff.t;
      S.knefeEaten++;
      sfx.purchase();
      pushStats();
    }
    function foodToast(food, paid) {
      var bits = [food.name + '.'];
      if (food.sta) bits.push('+' + food.sta + ' stamina');
      if (food.hp) bits.push('+' + food.hp + ' health');
      if (food.buff) bits.push(food.buff.label.split('·')[1].trim() + ' ' + food.buff.t + 's');
      bits.push(paid ? '−' + food.price + ' l.l.' : 'on the house');
      return bits.join(' · ');
    }
    function buyFood(npc) {
      var food = FOODS[npc.def.sells], kind;
      var stuffed = S.health >= HEALTH_MAX - 0.5 && S.hp >= HP_MAX - 0.5 && !food.buff;
      if (stuffed) {
        kind = 'full';
      } else if (S.lira >= food.price) {
        S.lira -= food.price;
        eat(food);
        kind = 'sold';
        hud.toast(foodToast(food, true), 'good');
      } else if (npc.def.sells === 'knefe' && (S.health <= 25 || S.hp <= 25)) {
        // he is not going to watch you fold over 25 lira
        eat(food);
        kind = 'broke';
        hud.toast('3a 7sabe — ' + foodToast(food, false), 'good');
      } else {
        kind = 'pricey';
        sfx.ui();
      }
      if (!npcSay(npc, kind)) npcSay(npc, 'idle');
      npc.facing = 1.4;
      return true;
    }

    function talkTo(npc) {
      if (npc.def.sells) return buyFood(npc);
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

    // ----------------------------------------------------------- billboards
    /* The world says where the boards stand; we hang them and paint them from
       the ad list the CMS publishes (ads.json, or a preview it pushed into
       this browser). Each board turns over every ~25 s with a flip, and an
       impression is counted once per showing, when the board is on screen. */
    var ADS = window.BLB_ADS;
    var adList = ADS ? ADS.normalize(ADS.DEFAULTS) : [];
    var adSource = 'defaults';
    // an unbooked board advertises itself: "coming soon, inquire in Credits"
    var HOUSE_AD = ADS ? ADS.VACANT : null;
    var boards = [];
    (function buildBoards() {
      var slots = world.adSlots || [];
      if (!slots.length || !ADS) return;
      var postMat = new THREE.MeshPhongMaterial({ color: P.CEMENT, flatShading: true, shininess: 4, specular: 0x111111 });
      var frameMat = new THREE.MeshPhongMaterial({ color: P.SEA_DEEP, flatShading: true, shininess: 10, specular: 0x222222 });
      var lampMat = new THREE.MeshBasicMaterial({ color: P.SUN });
      for (var n = 0; n < slots.length; n++) {
        var s = slots[n];
        var g = new THREE.Group();
        g.position.set(s.x, 0, s.z);
        g.rotation.y = s.ry || 0;
        if (s.plinth) {
          // a cast block on the mole: reads as "standing on something" from far off
          var pl = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.9, s.base + 1.6, 2.6), postMat);
          pl.position.set(0, (s.base - 1.6) / 2, -0.2);
          g.add(pl);
        }
        var legH = s.y - s.base + s.h * 0.5, legW = s.w > 10 ? 0.6 : 0.42;
        for (var side = -1; side <= 1; side += 2) {
          var leg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), postMat);
          leg.position.set(side * s.w * 0.32, s.base + legH / 2, -0.24);
          g.add(leg);
          // a poured footing where the leg meets whatever it stands on
          var foot = new THREE.Mesh(new THREE.BoxGeometry(legW * 2.4, 0.3, legW * 2.4), postMat);
          foot.position.set(side * s.w * 0.32, s.base + 0.15, -0.24);
          g.add(foot);
        }
        var frame = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.42, s.h + 0.42, 0.24), frameMat);
        frame.position.set(0, s.y + s.h / 2, -0.06);
        g.add(frame);
        var lamp = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.8, 0.12, 0.3), lampMat);
        lamp.position.set(0, s.y + s.h + 0.3, 0.2);
        g.add(lamp);
        var cv = document.createElement('canvas');
        cv.width = 1024; cv.height = 512;
        var tx = new THREE.CanvasTexture(cv);
        tx.encoding = THREE.sRGBEncoding;
        tx.anisotropy = 4;
        var face = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h),
          new THREE.MeshBasicMaterial({ map: tx, toneMapped: false }));
        face.position.set(0, s.y + s.h / 2, 0.08);
        g.add(face);
        scene.add(g);
        // the deck legs are solid; roof and mole boards are out of reach anyway
        if (s.base <= DECK_Y + 0.01 && world.landColliders) {
          for (var sd = -1; sd <= 1; sd += 2) {
            var lx = s.x + Math.cos(s.ry || 0) * sd * s.w * 0.32, lz = s.z;
            world.landColliders.push({ x1: lx - 0.55, z1: lz - 0.8, x2: lx + 0.55, z2: lz + 0.3, top: DECK_Y + legH + 2 });
          }
        }
        boards.push({
          slot: s, group: g, face: face, canvas: cv, ctx: cv.getContext('2d'), tex: tx,
          ad: null, next: 2 + n * 4.5, flip: 0, painted: false, counted: false, seen: 0
        });
      }
    })();

    function paintBoard(b) {
      try { ADS.draw(b.ctx, 1024, 512, b.ad || HOUSE_AD); } catch (e) { /* bad copy never kills the game */ }
      b.tex.needsUpdate = true;
      b.counted = false; b.seen = 0;
    }
    function nextAd(b) {
      b.ad = ADS.pick(adList, b.slot.placement, b.ad && b.ad.id) || null;
      paintBoard(b);
    }
    function setAds(list, source) {
      adList = list || [];
      adSource = source || 'ads.json';
      for (var i = 0; i < boards.length; i++) nextAd(boards[i]);
    }
    if (ADS && boards.length) {
      setAds(adList, 'defaults');
      ADS.load(function (list, source) {
        setAds(list, source);
        if (source === 'preview') hud.toast('Billboards: showing the CMS preview.', 'info');
      });
      // fonts arrive after the first paint; repaint so Arabic is real Arabic
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { boards.forEach(paintBoard); }).catch(function () {});
      }
      // the CMS in another tab can push a new preview while we are running
      window.addEventListener('storage', function (e) {
        if (e.key !== ADS.PREVIEW_KEY) return;
        ADS.load(function (list, source) { setAds(list, source); hud.toast('Billboards updated from the CMS.', 'info'); });
      });
    }
    var boardV = new THREE.Vector3();
    function updateBoards(dt) {
      if (!boards.length) return;
      for (var i = 0; i < boards.length; i++) {
        var b = boards[i];
        b.next -= dt;
        if (b.next <= 0 && b.flip === 0) b.flip = 1;
        if (b.flip > 0) {
          // fold the face shut, swap the poster at the halfway point, open it
          var before = b.flip;
          b.flip = Math.max(0, b.flip - dt * 2.2);
          if (before > 0.5 && b.flip <= 0.5) nextAd(b);
          b.face.scale.y = Math.max(0.02, Math.abs(b.flip - 0.5) * 2);
          if (b.flip === 0) { b.face.scale.y = 1; b.next = 24 + Math.random() * 8; }
        }
        // impression: on screen, near enough to read, for over a second
        if (!b.counted && b.ad) {
          boardV.set(b.slot.x, b.slot.y + b.slot.h / 2, b.slot.z);
          var dist = boardV.distanceTo(camera.position);
          boardV.project(camera);
          var vis = boardV.z < 1 && Math.abs(boardV.x) < 0.95 && Math.abs(boardV.y) < 0.95 &&
            dist < 34 * Math.max(b.slot.w / 8, 1);
          b.seen = vis ? b.seen + dt : 0;
          if (b.seen > 1.2 && S.started) { b.counted = true; ADS.bump(b.ad.id); }
        }
      }
    }

    // ------------------------------------------------------------- health
    var hurtBucket = 0, hurtCool = 0, slamCool = 0;
    function damage(amount, cause) {
      if (!S.started || S.fainted || amount <= 0) return;
      S.hp = Math.max(0, S.hp - amount);
      S.faintCause = cause || S.faintCause;
      hurtBucket += amount;
      if (hurtBucket >= 2.5 && hurtCool <= 0) {
        hud.hurt(hurtBucket);
        if (sfx.hurt) sfx.hurt();
        hurtBucket = 0; hurtCool = 0.5;
      }
      pushStats();
      if (S.hp <= 0) faint();
    }

    var FAINT_LINES = {
      drown: 'Abou Hassan\'s nephew pulled you out by the fanella.',
      fall: 'You found the ground faster than you planned.',
      sea: 'The sea came over the edge and won that round.',
      starve: 'You worked until you folded, on an empty stomach.',
      cold: 'November water. You stayed in too long.'
    };
    function faint() {
      if (S.fainted) return;
      S.fainted = 4.2;
      S.faints++;
      placing = false; keys = {};
      var bill = Math.min(Math.floor(S.lira), 20 + Math.round(S.lira * 0.15));
      S.lira -= bill;
      var spilt = Math.floor(S.mortar / 2);
      S.mortar -= spilt;
      releaseLook();
      hud.setPrompt(null);
      hud.showFaint({
        text: (FAINT_LINES[S.faintCause] || FAINT_LINES.starve) +
          (spilt > 0 ? ' Half the barrow went with you.' : ''),
        bill: bill > 0 ? 'Hospital bill · ' + bill + ' l.l.' : 'Hospital bill · waived. You had nothing.'
      });
      npcEvent('spent');
      pushStats();
    }
    function wakeUp() {
      S.fainted = 0;
      S.hp = RESPAWN_HP;
      S.health = Math.max(S.health, 55);
      S.faintCause = '';
      body.teleport(0, DECK_Y, -11);
      body.vel.set(0, 0, 0);
      cam.yaw = Math.PI; cam.pitch = -0.06;
      hud.hideFaint();
      hud.toast('Back on the corniche. Eat something.', 'info');
      updateHint();
      pushStats();
    }

    var cellUnder = { i: 0, j: 0 };
    function updateHealth(dt, t, input) {
      hurtCool -= dt; slamCool -= dt;
      for (var id in S.buffs) {
        if (!S.buffs.hasOwnProperty(id)) continue;
        S.buffs[id] -= dt;
        if (S.buffs[id] <= 0) delete S.buffs[id];
      }
      if (hud.setBuffs) {
        var bl = [];
        for (var bid in S.buffs) {
          if (!S.buffs.hasOwnProperty(bid)) continue;
          var src = null;
          for (var fk in FOODS) if (FOODS[fk].buff && FOODS[fk].buff.id === bid) src = FOODS[fk].buff;
          bl.push({ id: bid, label: src ? src.label : bid, t: S.buffs[bid] });
        }
        hud.setBuffs(bl);
      }

      // a hard landing
      if (body.landedThisStep && !body.inWater && body.landImpact > FALL_SAFE) {
        damage((body.landImpact - FALL_SAFE) * 5, 'fall');
        hud.toast('Ouch. That was a long way down.', 'bad');
      }

      if (body.inWater) {
        if (S.health <= 0) {
          damage(HP_DROWN * dt, 'drown');
          if (slamCool <= 0) { hud.toast('No strength left to swim — get OUT.', 'bad'); slamCool = 4; }
        } else {
          damage(HP_COLD * dt, 'cold');
        }
      } else if (body.grounded && Math.abs(body.pos.y - TILE_TOP) < 0.12) {
        // standing on the frontier while the waves come over it
        worldToCell(body.pos.x, body.pos.z, cellUnder);
        if (sim.get(cellUnder.i, cellUnder.j) && sim.exposure(cellUnder.i, cellUnder.j) > 0) {
          var over = waves.height(body.pos.x, body.pos.z, t) - (TILE_TOP + 0.12);
          if (over > 0) {
            damage(over * 16 * dt, 'sea');
            if (slamCool <= 0 && over > 0.12) {
              hud.toast('The waves are breaking over the edge. Step back.', 'bad');
              fx.burst(body.pos.x, TILE_TOP + 0.3, body.pos.z, 0.8);
              slamCool = 5;
            }
          }
        }
      }
      if (!body.inWater && S.health <= 0) damage(HP_STARVE * dt, 'starve');

      // healing: rested, dry and fed
      var regen = 0;
      if (!body.inWater && S.health > 40) regen = HP_REGEN;
      if (S.buffs.shab3an && !body.inWater) regen = Math.max(regen, 1.4);
      if (regen && S.hp < HP_MAX) {
        var hb = S.hp;
        S.hp = Math.min(HP_MAX, S.hp + regen * dt);
        if (Math.floor(hb) !== Math.floor(S.hp)) pushStats();
      }
      void input;
    }

    // ---------------------------------------------------------------- menu
    function menuSummary() {
      return { metres: sim.count * 4, tiles: sim.count, laid: S.laid, lira: Math.floor(S.lira) };
    }
    var hasSave = false;
    function showMainMenu() {
      hud.showMenu({ mode: 'main', hasSave: hasSave, summary: hasSave ? menuSummary() : null, settings: SET });
    }
    function pause() {
      if (!S.started || paused) return;
      paused = true;
      keys = {}; placing = false; orbiting = false;
      save();
      releaseLook();
      hud.setPrompt(null);
      hud.showMenu({ mode: 'pause', summary: menuSummary(), settings: SET });
      updateHint();
    }
    function resume() {
      if (!paused) return;
      paused = false;
      hud.hideMenu();
      clock.getDelta();          // do not bill the pause to the next frame
      if (firstPerson) requestLook();
      updateHint();
    }
    function quitToMenu() {
      save();
      hasSave = true;
      paused = false;
      S.started = false;
      ghost.visible = false;
      if (hud.setReticle) hud.setReticle('none');
      hud.setPrompt(null);
      showMainMenu();
      updateHint();
    }
    function resetGame() {
      var all = [];
      sim.forEach(function (tl) { all.push(tl); });
      for (var n = 0; n < all.length; n++) sim.remove(all[n].i, all[n].j);
      tiles.clear();
      S.health = HEALTH_MAX; S.hp = HP_MAX; S.lira = 0; S.knefeEaten = 0;
      S.laid = 0; S.lost = 0; S.buffs = {}; S.faints = 0; S.fainted = 0;
      freshStart();
      body.teleport(0, DECK_Y, -11);
      cam.yaw = Math.PI; cam.pitch = -0.06;
      npcs.forEach(function (n2) { n2.talkIdx = 0; n2.greeted = false; });
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
      hasSave = false;
      pushStats();
    }
    function onMenu(act, v) {
      sfx.unlock();
      if (act === 'continue') { hud.hideMenu(); start(); if (firstPerson) requestLook(); }
      else if (act === 'new') { resetGame(); hud.hideMenu(); start(); if (firstPerson) requestLook(); }
      else if (act === 'resume') resume();
      else if (act === 'pause') pause();
      else if (act === 'quit') quitToMenu();
      else if (act === 'setting' && v) {
        if (v.key === 'sound') setSound(v.value);
        else if (v.key === 'sens') setSens(0.0022 * v.value, true);
        else if (v.key === 'fov') {
          SET.fov = clamp(+v.value, 45, 80); saveSettings();
          camera.fov = SET.fov; camera.updateProjectionMatrix();
        } else if (v.key === 'view') setView(v.value === 'first', true);
        else if (v.key === 'bob') { SET.bob = !!v.value; saveSettings(); }
      }
    }

    var statsDirty = true;
    function pushStats() { statsDirty = true; }
    function flushStats() {
      if (!statsDirty) return;
      statsDirty = false;
      hud.setStats({
        mortar: Math.floor(S.mortar), mortarMax: S.mortarMax,
        tiles: sim.count, metres: sim.count * 4, lira: Math.floor(S.lira),
        health: S.health, healthMax: HEALTH_MAX, hp: S.hp, hpMax: HP_MAX,
        tierIdx: 0, swell: waves.swell(S.elapsed),
        laid: S.laid, lost: S.lost
      });
    }

    // ---------------------------------------------------------- save / load
    function serialize() {
      return {
        v: 4, sim: sim.serialize(), mortar: S.mortar,
        health: S.health, lira: S.lira, knefeEaten: S.knefeEaten,
        hp: S.hp, buffs: S.buffs, faints: S.faints,
        elapsed: S.elapsed, laid: S.laid, lost: S.lost,
        px: body.pos.x, py: body.pos.y, pz: body.pos.z
      };
    }
    function save() {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); } catch (e) { /* private window */ }
    }
    function applySave(d) {
      if (!d || d.v !== 4) return false;
      try {
        if (d.sim) sim.load(d.sim);
        S.mortar = d.mortar || 0;
        S.health = typeof d.health === 'number' ? d.health : HEALTH_MAX;
        S.lira = d.lira || 0;
        S.knefeEaten = d.knefeEaten || 0;
        // older saves predate health: they start whole
        S.hp = typeof d.hp === 'number' && d.hp > 0 ? clamp(d.hp, 1, HP_MAX) : HP_MAX;
        S.buffs = (d.buffs && typeof d.buffs === 'object') ? d.buffs : {};
        S.faints = d.faints || 0;
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
    hasSave = restored && (S.laid > 0 || sim.count > 5 || S.lira > 0);
    pushStats();
    setView(firstPerson, true);
    showMainMenu();

    var startedOnce = false;
    function start() {
      if (S.started) return;
      S.started = true;
      paused = false;
      sfx.unlock();
      hud.hideIntro();
      clock.getDelta();
      if (!startedOnce) {
        startedOnce = true;
        hud.toast(IS_TOUCH
          ? 'Drag to look. Hold SHOVEL at a pile, then tap بلّط.'
          : 'Click to capture the mouse. Hold E at a pile for mouna. Esc pauses.', 'info');
        setTimeout(heckle, 6500);
      }
      updateHint();
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
      if (paused) {
        // the world holds still behind the pause menu; only the HUD animates
        hud.frame(dt);
        renderer.render(scene, camera);
        return;
      }
      tick(dt);
    }

    function tick(dt) {
      S.elapsed += dt;
      var t = S.elapsed;

      edgeTurn(dt);

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

      // under a quarter health you slow down; empty, you can barely walk
      var legs = S.health <= 0 ? 0.45 : (S.health < 25 ? 0.7 : 1);
      if (S.hp < 25) legs *= 0.8;           // hurt, you limp
      var canMove = S.started && !S.fainted;
      var input = {
        moveX: canMove ? moveVec.x * legs : 0,
        moveZ: canMove ? moveVec.z * legs : 0,
        jump: canMove && !!keys.Space && S.health > 0,
        run: canMove && !!(keys.ShiftLeft || keys.ShiftRight) && S.health > 25
      };
      body.step(dt, t, input, waves);
      if (S.started) {
        if (S.fainted) {
          S.fainted -= dt;
          if (S.fainted <= 0) wakeUp();
        } else {
          updateHealth(dt, t, input);
        }
      }
      updateBoards(dt);

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

      if (placing && !S.fainted) tryPlace(false);
      if (S.started && !S.fainted) updateGathering(dt);
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
          var pay = sim.count * PAY_PER_SURVIVING;
          S.lira += pay;
          hud.toast('Inspection: ' + sim.count * 4 + ' m² standing. +' + pay + ' l.l.', 'good');
          pushStats();
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
      if (body.inWater && !S.wasInWater) {
        npcEvent('swim');
        S.health = Math.max(0, S.health - SOAK_HIT);
        pushStats();
      }
      S.wasInWater = body.inWater;

      // stamina drains by what you are actually doing
      if (S.started && !S.fainted) {
        var drain = DRAIN_IDLE;
        if (body.inWater) drain = DRAIN_WATER;
        else if (digging) drain = DRAIN_DIG;
        else if (input.run && spd > 0.5) drain = DRAIN_RUN;
        if (S.buffs.barid) drain *= 0.5;      // a jallab in you
        var before = S.health;
        S.health = clamp(S.health - drain * dt, 0, HEALTH_MAX);
        if (Math.floor(before) !== Math.floor(S.health)) pushStats();
        if (before > 25 && S.health <= 25) hud.toast('You are running out of steam. Knefe.', 'bad');
        if (before > 0 && S.health <= 0) {
          hud.toast('Khalas — you cannot lift another balata. Jardali is up the corniche.', 'bad');
          npcEvent('spent');
        }
      }
      if (body.inWater && Math.random() < dt * 3) {
        fx.burst(body.pos.x, 0.1, body.pos.z, 0.45);
      }

      // --- camera
      if (!S.started) {
        /* Behind the main menu: a slow drift along the corniche and out over
           the tiles, the castle and the mole swinging through the right side
           of the screen while the menu holds the left. */
        var ca = t * 0.028;
        viewModel.visible = false;
        camera.position.set(-18 + Math.sin(ca) * 30, 9 + Math.sin(ca * 0.7) * 2.5, 30 + Math.cos(ca) * 16);
        camera.rotation.set(0, 0, 0);
        camTarget.set(-28 + Math.sin(ca * 0.6) * 22, 2.5, -6);
        camera.lookAt(camTarget);
      } else if (firstPerson) {
        viewModel.visible = !S.fainted;
        // head bob keyed to actual ground speed, killed while swimming
        var bobAmt = clamp(spd / 6, 0, 1) * (body.inWater ? 0 : 1) * (SET.bob === false ? 0 : 1);
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
      if (S.started && !S.fainted) {
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
      } else if (ghost.visible) {
        ghost.visible = false;
        if (hud.setReticle) hud.setReticle('none');
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
      tick: tick, npcSay: npcSay, npcEvent: npcEvent, sfx: sfx,
      damage: damage, pause: pause, resume: resume, onMenu: onMenu, boards: boards,
      settings: SET, foods: FOODS, adSource: function () { return adSource; }
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
    if (hot && hot.ready) hot.ready(function (data) { window.__blb = boot((data && data.v === 4) ? data : loadSaved()); });
    else window.__blb = boot(loadSaved());
  }

  window.BLB_GAME = { boot: boot, go: go, TIERS: TIERS, PALETTE: P, PALETTE_CSS: PCSS };
})();
