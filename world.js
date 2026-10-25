/* =============================================================================
   BALLET L BA7ER (بلّط البحر) — world.js
   Environment / scenery module.  Plain script, THREE r128 UMD global.
   Attaches exactly one global: window.BLB_WORLD = { createWorld }.

   Everything here is chunky, flat-shaded, low-poly and sun-bleached:
   Saida corniche + Qalaat al-Bahr, the harbour mole and Jazirat Ziri, the city
   behind, Mount Lebanon behind that, and enough living detail (gulls, palms,
   boats, a fishing uncle, a sleeping cat, cart smoke) to feel inhabited.

   Draw calls are kept low by MERGING: almost every family of props is baked
   into one vertex-coloured BufferGeometry via the little Mesher below, and the
   few truly repeated things (balusters, benches, bollards, lamp heads, gulls)
   are InstancedMesh.  All textures are generated on an offscreen canvas.
   ============================================================================= */
(function (root) {
  'use strict';

  let T = null;                       // the THREE namespace, set in createWorld
  const TAU = Math.PI * 2;

  /* ------------------------------- palette --------------------------------- */
  const PALETTE = {
    SEA_DEEP: '#0B3A4F', SEA_MID: '#16708C', SEA_SHALLOW: '#3FA8B4',
    FOAM: '#EDF6F3', SKY_TOP: '#6FC3DE', SKY_HAZE: '#D9EEF2',
    LIMESTONE: '#E4D7B3', STONE_DARK: '#A08F6A', STONE_WET: '#7D6E4F',
    TERRACOTTA: '#B9502F', CEMENT: '#9AA0A0', RUST: '#8C4A2F',
    PALM_GREEN: '#3F6B3A', PALM_LIGHT: '#5E8C3F', TRUNK: '#7A6245',
    SUN: '#F6C445', HAZARD: '#F2B733', NIGHT_TOP: '#0A1A33',
    SKIN: '#C98A5E', SHIRT: '#E8E2D4', DENIM: '#3B5C73'
  };
  const TIER_COLS = ['#CDBD92', '#9AA0A0', '#2E7FA8', '#EFE7DA'];

  /* ----------------------------- tiny helpers ------------------------------ */
  const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  const lerp = function (a, b, t) { return a + (b - a) * t; };
  const smooth = function (e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t);
  };
  // deterministic rng (mulberry32) — same world every load
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // cheap smooth 1-D "noise" out of three incommensurate sines (gull paths)
  function wig(x) {
    return 0.56 * Math.sin(x) + 0.3 * Math.sin(x * 2.173 + 1.7) + 0.14 * Math.sin(x * 4.41 + 0.4);
  }

  const _hsl = { h: 0, s: 0, l: 0 };
  function C(hex) { return new T.Color(hex); }
  function mixc(a, b, t, out) { return (out || new T.Color()).copy(a).lerp(b, t); }
  /* HSL jitter — the "hand-painted toy" variation, used instead of detail maps */
  function vary(base, rng, amt, out) {
    out = out || new T.Color();
    out.copy(base).getHSL(_hsl);
    return out.setHSL(
      (_hsl.h + (rng() - 0.5) * amt * 0.10 + 1) % 1,
      clamp(_hsl.s + (rng() - 0.5) * amt * 0.45, 0, 1),
      clamp(_hsl.l + (rng() - 0.5) * amt, 0.03, 0.97)
    );
  }
  function shade(base, k, out) {   // k<0 darker, k>0 lighter
    out = out || new T.Color();
    out.copy(base).getHSL(_hsl);         // getHSL returns the TARGET, not the colour
    return out.setHSL(_hsl.h, _hsl.s, clamp(_hsl.l + k, 0.02, 0.98));
  }

  /* =========================================================================
     CANVAS TEXTURE HELPERS  (four reusable generators + one dot sprite)
     ========================================================================= */
  let TEXS = [];
  function cv(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function finish(canvas) {
    const t = new T.CanvasTexture(canvas);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 4;
    TEXS.push(t);
    return t;
  }

  /* 1. grain: flat base + soft blotches + speckle. plaster / cement / sand   */
  function texGrain(o) {
    const S = o.size || 128, c = cv(S, S), g = c.getContext('2d'), rng = mulberry(o.seed || 7);
    g.fillStyle = o.base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < (o.blotches === undefined ? 16 : o.blotches); i++) {
      const x = rng() * S, y = rng() * S, r = S * (0.05 + rng() * 0.16);
      g.globalAlpha = 0.05 + rng() * 0.12;
      g.fillStyle = rng() < 0.5 ? o.dark || '#000000' : o.light || '#ffffff';
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      // wrap blotches so the tile is seamless
      g.beginPath(); g.arc(x - S, y, r, 0, TAU); g.fill();
      g.beginPath(); g.arc(x, y - S, r, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    const n = o.specks === undefined ? S * S * 0.10 : o.specks;
    for (let i = 0; i < n; i++) {
      const d = rng();
      g.fillStyle = d < 0.5 ? (o.dark || 'rgba(0,0,0,0.25)') : (o.light || 'rgba(255,255,255,0.25)');
      g.globalAlpha = 0.07 + rng() * (o.speckA || 0.18);
      const s = 1 + (rng() < 0.12 ? 1 : 0);
      g.fillRect((rng() * S) | 0, (rng() * S) | 0, s, s);
    }
    g.globalAlpha = 1;
    return finish(c);
  }

  /* 2. blocks: mortar grid + per-block colour jitter + mismatched repair
        patches.  paving slabs, rubble masonry, causeway stone              */
  function texBlocks(o) {
    const S = o.size || 256, c = cv(S, S), g = c.getContext('2d'), rng = mulberry(o.seed || 11);
    const cols = o.cols || 4, rows = o.rows || 4;
    const bw = S / cols, bh = S / rows, mw = o.mortarW || 3;
    g.fillStyle = o.mortar || '#8e856c'; g.fillRect(0, 0, S, S);
    const base = C(o.base), tmp = new T.Color();
    for (let r = 0; r < rows; r++) {
      const off = o.stagger ? (r % 2) * bw * 0.5 : 0;
      for (let k = -1; k < cols; k++) {
        const x = k * bw + off + mw * 0.5, y = r * bh + mw * 0.5;
        const w = bw - mw, h = bh - mw;
        vary(base, rng, o.jitter === undefined ? 0.12 : o.jitter, tmp);
        g.fillStyle = '#' + tmp.getHexString();
        g.fillRect(x, y, w, h);
        // chipped corner + a little grime at the bottom of the block
        g.globalAlpha = 0.14 + rng() * 0.16;
        g.fillStyle = '#4a4232';
        g.fillRect(x, y + h * 0.78, w, h * 0.22);
        if (rng() < 0.35) g.fillRect(x + w * (rng() * 0.7), y, w * 0.18, h * 0.16);
        g.globalAlpha = 1;
      }
    }
    // mismatched repair concrete — the real public-works texture
    const patches = o.repair === undefined ? 3 : o.repair;
    for (let i = 0; i < patches; i++) {
      g.globalAlpha = 0.72 + rng() * 0.2;
      g.fillStyle = rng() < 0.5 ? '#9AA0A0' : '#b0a894';
      const x = rng() * S, y = rng() * S, w = S * (0.12 + rng() * 0.26), h = S * (0.1 + rng() * 0.2);
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + w, y + h * 0.12); g.lineTo(x + w * 0.88, y + h);
      g.lineTo(x - w * 0.08, y + h * 0.86); g.closePath(); g.fill();
      g.globalAlpha = 1;
    }
    // speckle pass over everything
    for (let i = 0; i < S * S * 0.05; i++) {
      g.globalAlpha = 0.05 + rng() * 0.12;
      g.fillStyle = rng() < 0.5 ? '#000' : '#fff';
      g.fillRect((rng() * S) | 0, (rng() * S) | 0, 1, 1);
    }
    g.globalAlpha = 1;
    return finish(c);
  }

  /* 3. bands: horizontal strata with wavy edges. Saida's pale shore limestone.
        Tiles vertically (flat join at 0/S) and horizontally (sine period S). */
  function texBands(o) {
    const S = o.size || 256, c = cv(S, S), g = c.getContext('2d'), rng = mulberry(o.seed || 3);
    const base = C(o.base), tmp = new T.Color();
    g.fillStyle = o.base; g.fillRect(0, 0, S, S);
    let y = 0;
    while (y < S) {
      const h = S * (0.045 + rng() * 0.1);
      vary(base, rng, 0.17, tmp);
      if (rng() < 0.22) shade(tmp, -0.1, tmp);           // occasional dark seam
      g.fillStyle = '#' + tmp.getHexString();
      const amp = 2 + rng() * 5, ph = rng() * TAU, f = 1 + ((rng() * 3) | 0);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= S; x += 8) g.lineTo(x, y + Math.sin((x / S) * TAU * f + ph) * amp);
      g.lineTo(S, Math.min(S, y + h)); g.lineTo(0, Math.min(S, y + h));
      g.closePath(); g.fill();
      // thin bright bedding line on top of the band
      g.globalAlpha = 0.3; g.fillStyle = '#fff8e2';
      g.fillRect(0, Math.max(0, y - 1), S, 1.5); g.globalAlpha = 1;
      y += h;
    }
    for (let i = 0; i < S * S * 0.07; i++) {   // weathering speckle / pitting
      g.globalAlpha = 0.06 + rng() * 0.16;
      g.fillStyle = rng() < 0.55 ? '#5e5540' : '#fffbef';
      g.fillRect((rng() * S) | 0, (rng() * S) | 0, 1, rng() < 0.2 ? 2 : 1);
    }
    g.globalAlpha = 1;
    return finish(c);
  }

  /* 4. stripes: awnings, the Lebanese flag (cedar drawn with paths — no fonts) */
  function texStripes(a, b, n, vertical) {
    const S = 64, c = cv(S, S), g = c.getContext('2d');
    g.fillStyle = a; g.fillRect(0, 0, S, S);
    g.fillStyle = b;
    const w = S / n;
    for (let i = 0; i < n; i += 2) {
      if (vertical) g.fillRect(i * w, 0, w, S); else g.fillRect(0, i * w, S, w);
    }
    return finish(c);
  }
  function texFlag() {
    const W = 96, H = 64, c = cv(W, H), g = c.getContext('2d');
    g.fillStyle = '#D22B2B'; g.fillRect(0, 0, W, H * 0.25);
    g.fillRect(0, H * 0.75, W, H * 0.25);
    g.fillStyle = '#F4F1E8'; g.fillRect(0, H * 0.25, W, H * 0.5);
    g.fillStyle = '#1F6B2E';                                  // the cedar
    g.fillRect(W * 0.485, H * 0.56, W * 0.03, H * 0.1);
    for (let i = 0; i < 4; i++) {
      const t = i / 3, yTop = H * (0.30 + t * 0.18), hw = W * (0.055 + t * 0.085);
      g.beginPath();
      g.moveTo(W * 0.5, yTop);
      g.lineTo(W * 0.5 + hw, yTop + H * 0.1);
      g.lineTo(W * 0.5 - hw, yTop + H * 0.1);
      g.closePath(); g.fill();
    }
    return finish(c);
  }
  function texDot() {                                        // smoke sprite
    const S = 32, c = cv(S, S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return finish(c);
  }
  /* blocky faux-lettering for the municipal sign (glyph bars, never real text) */
  function texSign() {
    const W = 256, H = 128, c = cv(W, H), g = c.getContext('2d'), rng = mulberry(42);
    g.fillStyle = '#2b5e8c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#EDF6F3'; g.lineWidth = 5; g.strokeRect(7, 7, W - 14, H - 14);
    g.fillStyle = '#EDF6F3';
    for (let row = 0; row < 2; row++) {                 // two lines of "writing"
      let x = 26;
      const y = 32 + row * 44, h = row ? 14 : 20;
      while (x < W - 34) {
        const w = 6 + ((rng() * 16) | 0);
        g.fillRect(x, y, w, h);
        if (rng() < 0.3) g.fillRect(x, y - 7, w * 0.6, 4);
        x += w + 5 + ((rng() * 7) | 0);
      }
    }
    g.globalAlpha = 0.25; g.fillStyle = '#000';
    for (let i = 0; i < 400; i++) g.fillRect((rng() * W) | 0, (rng() * H) | 0, 2, 2);
    g.globalAlpha = 1;
    return finish(c);
  }

  /* =========================================================================
     MESHER — accumulate transformed primitives into one flat-shaded,
     vertex-coloured BufferGeometry.  (r128 has no BufferGeometryUtils global.)
     uvScale > 0 => triplanar world-space UVs, so strata / paving / masonry
     line up continuously across every block in the merged mesh.
     ========================================================================= */
  function Mesher() { this.p = []; this.n = []; this.c = []; this.u = []; }
  const _v = { a: null, b: null, c: null, d: null, n: null };
  let _nm = null, _o3 = null, _m4 = null;

  Mesher.prototype.push = function (geo, mat, color, uvScale) {
    const pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv;
    _nm.getNormalMatrix(mat);
    const v = _v.a, nn = _v.n;
    const r = color.r, g = color.g, b = color.b;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(mat);
      this.p.push(v.x, v.y, v.z);
      if (na) { nn.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize(); }
      else nn.set(0, 1, 0);
      this.n.push(nn.x, nn.y, nn.z);
      this.c.push(r, g, b);
      if (uvScale) {                       // triplanar: pick axis by face normal
        const ax = Math.abs(nn.x), ay = Math.abs(nn.y), az = Math.abs(nn.z);
        if (ay > ax && ay > az) this.u.push(v.x * uvScale, v.z * uvScale);
        else if (ax >= az) this.u.push(v.z * uvScale, v.y * uvScale);
        else this.u.push(v.x * uvScale, v.y * uvScale);
      } else if (ua) this.u.push(ua.getX(i), ua.getY(i));
      else this.u.push(0, 0);
    }
    return this;
  };

  /* box(colour, centre, size, [euler]) — the workhorse */
  Mesher.prototype.box = function (color, x, y, z, w, h, d, rx, ry, rz, uv) {
    _o3.position.set(x, y, z);
    _o3.rotation.set(rx || 0, ry || 0, rz || 0);
    _o3.scale.set(w, h, d);
    _o3.updateMatrix();
    return this.push(PRIM.box, _o3.matrix, color, uv);
  };
  Mesher.prototype.prim = function (geo, color, x, y, z, sx, sy, sz, rx, ry, rz, uv) {
    _o3.position.set(x, y, z);
    _o3.rotation.set(rx || 0, ry || 0, rz || 0);
    _o3.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
    _o3.updateMatrix();
    return this.push(geo, _o3.matrix, color, uv);
  };
  /* a cylinder from point A to point B (columns, rails, cables, rods) */
  Mesher.prototype.rod = function (color, x1, y1, z1, x2, y2, z2, r, geo) {
    const a = _v.a.set(x1, y1, z1), b = _v.b.set(x2, y2, z2);
    const d = _v.c.copy(b).sub(a), len = d.length() || 0.0001;
    _o3.position.copy(a).addScaledVector(d, 0.5);
    _o3.scale.set(r, len, r);
    _o3.up.set(0, 1, 0);
    _o3.quaternion.setFromUnitVectors(_v.d.set(0, 1, 0), d.normalize());
    _o3.rotation.setFromQuaternion(_o3.quaternion);
    _o3.updateMatrix();
    return this.push(geo || PRIM.cyl8, _o3.matrix, color);
  };
  Mesher.prototype.quad = function (color, a, b, c, d) {
    const n = _v.n.copy(b).sub(a).cross(_v.d.copy(d).sub(a)).normalize();
    const pts = [a, b, c, a, c, d];
    for (let i = 0; i < 6; i++) {
      this.p.push(pts[i].x, pts[i].y, pts[i].z);
      this.n.push(n.x, n.y, n.z);
      this.c.push(color.r, color.g, color.b);
      this.u.push(i === 0 || i === 3 ? 0 : 1, i < 2 ? 0 : 1);
    }
    return this;
  };
  Mesher.prototype.tri = function (color, a, b, c) {
    const n = _v.n.copy(b).sub(a).cross(_v.d.copy(c).sub(a)).normalize();
    const pts = [a, b, c];
    for (let i = 0; i < 3; i++) {
      this.p.push(pts[i].x, pts[i].y, pts[i].z);
      this.n.push(n.x, n.y, n.z);
      this.c.push(color.r, color.g, color.b);
      this.u.push(i === 0 ? 0 : 1, i < 2 ? 0 : 1);
    }
    return this;
  };
  Mesher.prototype.empty = function () { return this.p.length === 0; };
  Mesher.prototype.geo = function () {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere();
    this.p = this.n = this.c = this.u = null;        // let the arrays go
    return g;
  };

  /* shared unit primitives, pre-converted to non-indexed (flat shading) */
  let PRIM = null;
  function initPrims() {
    const ni = function (g) {              // Polyhedron/Icosahedron is already non-indexed
      if (!g.index) return g;
      const x = g.toNonIndexed(); g.dispose(); return x;
    };
    PRIM = {
      box: ni(new T.BoxGeometry(1, 1, 1)),
      cyl6: ni(new T.CylinderGeometry(0.5, 0.5, 1, 6)),
      cyl8: ni(new T.CylinderGeometry(0.5, 0.5, 1, 8)),
      cyl12: ni(new T.CylinderGeometry(0.5, 0.5, 1, 12)),
      cone6: ni(new T.ConeGeometry(0.5, 1, 6)),
      cone8: ni(new T.ConeGeometry(0.5, 1, 8)),
      pyr4: ni(new T.ConeGeometry(0.72, 1, 4)),
      ico: ni(new T.IcosahedronGeometry(0.5, 0)),
      sph: ni(new T.SphereGeometry(0.5, 10, 6)),
      dome: ni(new T.SphereGeometry(0.5, 12, 6, 0, TAU, 0, Math.PI * 0.5)),
      torus: ni(new T.TorusGeometry(0.4, 0.14, 6, 10)),
      disc: ni(new T.CircleGeometry(0.5, 10))
    };
  }

  /* =========================================================================
     BUILD CONTEXT — one live world at a time.  Builders below read W.* so the
     code stays flat instead of nesting 2000 lines inside createWorld().
     ========================================================================= */
  let W = null;

  function addMesh(geo, mat, name) {
    const m = new T.Mesh(geo, mat);
    m.name = name || 'blb';
    m.castShadow = true; m.receiveShadow = true;   // honoured only if the game
    W.geos.push(geo);                              // enables shadow maps
    W.group.add(m);
    return m;
  }
  function bake(mesher, mat, name) {               // merge -> single draw call
    if (mesher.empty()) return null;
    return addMesh(mesher.geo(), mat, name);
  }
  function coll(x1, z1, x2, z2, top) {
    W.coll.push({
      x1: Math.min(x1, x2), z1: Math.min(z1, z2),
      x2: Math.max(x1, x2), z2: Math.max(z1, z2), top: top
    });
  }
  /* an InstancedMesh with per-instance colour jitter (kills the cloned look) */
  function instanced(geo, mat, xforms, tintBase, jitterAmt, name) {
    const im = new T.InstancedMesh(geo, mat, xforms.length);
    const c = new T.Color(), rng = mulberry(xforms.length * 977 + 13);
    for (let i = 0; i < xforms.length; i++) {
      im.setMatrixAt(i, xforms[i]);
      if (im.setColorAt) {
        c.setRGB(1, 1, 1);
        if (tintBase) vary(tintBase, rng, jitterAmt || 0.08, c);
        else {
          const k = 1 + (rng() - 0.5) * (jitterAmt || 0.16);
          c.setRGB(clamp(k, 0.6, 1.25), clamp(k * 0.995, 0.6, 1.25), clamp(k * 0.985, 0.6, 1.25));
        }
        im.setColorAt(i, c);
      }
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    im.name = name || 'inst';
    W.geos.push(geo);
    W.group.add(im);
    return im;
  }
  function xf(x, y, z, sx, sy, sz, rx, ry, rz) {
    _o3.position.set(x, y, z);
    _o3.rotation.set(rx || 0, ry || 0, rz || 0);
    _o3.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    _o3.updateMatrix();
    return _o3.matrix.clone();
  }

  /* =========================================================================
     MATERIALS — one small shared set, reused by every builder.
     ========================================================================= */
  function buildMaterials() {
    const C0 = W.COL, mats = W.mats;
    // NB r128 MeshLambertMaterial is vertex-lit and has NO flatShading property.
    // We get the faceted look from non-indexed geometry with hard face normals.
    const L = function (o) { const m = new T.MeshLambertMaterial(o); mats.push(m); return m; };
    const B = function (o) { const m = new T.MeshBasicMaterial(o); mats.push(m); return m; };
    const M = {};
    // stratified pale limestone — the island, the castle islet, the inland cliff
    M.rock = L({ map: texBands({ base: '#E4D7B3', size: 256, seed: 5 }), vertexColors: true });
    // rubble-and-sandstone masonry — castle, causeway, sea wall, benches
    M.mason = L({
      map: texBlocks({ base: '#D9C9A2', cols: 5, rows: 8, stagger: true, mortar: '#9B8F70', jitter: 0.14, repair: 2, seed: 17 }),
      vertexColors: true
    });
    // worn paving slabs with mismatched repair concrete — the promenade deck
    M.pave = L({
      map: texBlocks({ base: '#DED2B0', cols: 4, rows: 4, mortar: '#9C9279', jitter: 0.1, repair: 5, seed: 23 }),
      vertexColors: true
    });
    // sun-bleached plaster — the city backdrop, kiosk, parapets
    M.plaster = L({ map: texGrain({ base: '#EADFC6', size: 128, specks: 900, seed: 31 }), vertexColors: true });
    // loose aggregate — sand piles, gravel, cement sacks
    M.rough = L({ map: texGrain({ base: '#CDBD92', size: 64, specks: 1400, speckA: 0.3, seed: 37 }), vertexColors: true });
    // untextured chunky stuff: palms, boats, people, clutter, metal
    M.flat = L({ vertexColors: true });
    M.leaf = L({ vertexColors: true, side: T.DoubleSide });
    M.flag = L({ map: texFlag(), side: T.DoubleSide });
    M.awning = L({ map: texStripes('#D22B2B', '#F4F1E8', 10, true), side: T.DoubleSide });
    M.sign = L({ map: texSign() });
    // lamp heads / windows: vertex colour holds the WARM lit tint.
    M.glowOff = L({ vertexColors: true, color: 0x33383c });  // multiplied down by day
    M.glowOn = B({ vertexColors: true, color: 0xffffff, fog: true });
    M.sky = B({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false });
    M.ridge = B({ vertexColors: true, fog: false });
    M.smoke = (function () {
      const m = new T.PointsMaterial({
        map: texDot(), size: 1.5, sizeAttenuation: true, transparent: true,
        depthWrite: false, opacity: 0.42, color: 0xd7dcd8
      });
      mats.push(m); return m;
    })();
    void C0;
    return M;
  }

  /* =========================================================================
     SKY DOME  — vertex-coloured so setTimeOfDay can repaint the gradient AND
     smear a warm sun glow near the horizon, with no shaders.
     ========================================================================= */
  function buildSky() {
    const R = 900;
    const g = new T.SphereGeometry(R, 24, 14).toNonIndexed();
    const n = g.attributes.position.count;
    g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(n * 3), 3));
    const sky = new T.Mesh(g, W.MAT.sky);
    sky.name = 'sky';
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    W.geos.push(g);
    W.group.add(sky);
    return sky;
  }
  function paintSky(top, haze, sunDir, glowCol, glowAmt) {
    const g = W.sky.geometry, pa = g.attributes.position, ca = g.attributes.color;
    const v = _v.a, c = _v.col1, c2 = _v.col2;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).normalize();
      mixc(haze, top, smooth(-0.04, 0.55, v.y), c);
      // low warm smear toward the sun azimuth (dawn / dusk glory)
      const d = clamp(v.dot(sunDir), 0, 1);
      const horiz = 1 - smooth(0, 0.42, Math.abs(v.y));
      const amt = glowAmt * Math.pow(d, 3) * (0.35 + 0.65 * horiz);
      if (amt > 0.001) mixc(c, glowCol, clamp(amt, 0, 0.9), c);
      // a touch of sea bounce below the horizon
      if (v.y < 0) mixc(c, c2.copy(W.COL.SEA_DEEP), smooth(0, -0.6, v.y) * 0.5, c);
      ca.setXYZ(i, c.r, c.g, c.b);
    }
    ca.needsUpdate = true;
  }

  /* =========================================================================
     MOUNT LEBANON — four layered ridgelines receding into haze, snow on top.
     Unlit (MeshBasicMaterial, fog off) so setTimeOfDay owns their colour.
     ========================================================================= */
  function buildMountains() {
    const layers = [];
    const cfg = [
      { z: -330, h: 58, amp: 20, base: 10, seg: 46, span: 900, snow: 0.0, haze: 0.42, seed: 101 },
      { z: -420, h: 86, amp: 30, base: 6, seg: 40, span: 1050, snow: 0.72, haze: 0.56, seed: 211 },
      // spans stay inside the 900 m sky-dome radius so nothing can clip outside it
      { z: -520, h: 118, amp: 38, base: 2, seg: 34, span: 1100, snow: 0.58, haze: 0.70, seed: 307 },
      { z: -640, h: 142, amp: 42, base: -4, seg: 28, span: 1150, snow: 0.46, haze: 0.84, seed: 401 }
    ];
    for (let li = 0; li < cfg.length; li++) {
      const o = cfg[li], rng = mulberry(o.seed);
      const pos = [], idx = [], ridge = [];
      // jagged ridgeline: two octaves of hashed noise, lerped between samples
      const h0 = [], h1 = [];
      for (let i = 0; i <= o.seg; i++) { h0.push(rng()); h1.push(rng()); }
      for (let i = 0; i <= o.seg; i++) {
        const t = i / o.seg;
        const a = h0[i], b = h1[(i * 3) % (o.seg + 1)], c2 = h1[(i * 7 + 2) % (o.seg + 1)];
        const peak = o.h + (a * 0.62 + b * 0.26 + c2 * 0.12 - 0.5) * o.amp * 2;
        ridge.push({ x: (t - 0.5) * o.span, y: Math.max(o.base + 4, peak) });
      }
      const snowLine = o.h + o.amp * (0.30 - o.snow * 0.55);
      for (let i = 0; i <= o.seg; i++) {
        pos.push(ridge[i].x, o.base - 90, o.z);      // skirt, well below horizon
        pos.push(ridge[i].x, ridge[i].y, o.z);
      }
      for (let i = 0; i < o.seg; i++) {
        const a = i * 2, b = i * 2 + 1, c3 = i * 2 + 2, d = i * 2 + 3;
        idx.push(a, c3, b, b, c3, d);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(pos.length), 3));
      const m = new T.Mesh(g, W.MAT.ridge);
      m.name = 'ridge' + li;
      m.frustumCulled = false;
      m.renderOrder = -900 + li;
      W.geos.push(g);
      W.group.add(m);
      layers.push({ mesh: m, haze: o.haze, snowLine: snowLine, ridge: ridge, base: o.base, snow: o.snow });
    }
    return layers;
  }
  function paintMountains(rockCol, snowCol, hazeCol) {
    const c = _v.col1;
    for (let li = 0; li < W.ridges.length; li++) {
      const L2 = W.ridges[li], g = L2.mesh.geometry;
      const pa = g.attributes.position, ca = g.attributes.color;
      for (let i = 0; i < pa.count; i++) {
        const y = pa.getY(i), ri = (i >> 1);
        const peak = L2.ridge[Math.min(ri, L2.ridge.length - 1)].y;
        // snow only on the upper flanks of the highest tops
        const sn = L2.snow * smooth(L2.snowLine, L2.snowLine + 16, peak) * smooth(L2.snowLine - 6, L2.snowLine + 10, y);
        mixc(rockCol, snowCol, clamp(sn, 0, 1), c);
        // darker in the valleys, hazier the farther back the ridge sits
        mixc(c, hazeCol, clamp(L2.haze + (1 - smooth(L2.base, peak, y)) * -0.08, 0, 1), c);
        ca.setXYZ(i, c.r, c.g, c.b);
      }
      ca.needsUpdate = true;
    }
  }

  /* =========================================================================
     THE CORNICHE — deck y=1.5, x[-130,130], z[-34,-2]; sea wall at z=-2;
     public stair flight down to the water at x[-5,5]; riprap at its foot.
     ========================================================================= */
  const STAIR = [                       // top, zFrom, zTo   (lead's geometry)
    { top: 1.26, z1: -2.00, z2: -1.08 },
    { top: 1.02, z1: -1.08, z2: -0.16 },
    { top: 0.78, z1: -0.16, z2: 0.76 },
    { top: 0.54, z1: 0.76, z2: 1.68 },
    { top: 0.30, z1: 1.68, z2: 2.60 }
  ];

  function buildCorniche() {
    const C0 = W.COL, rng = mulberry(7001);
    const mPave = new Mesher(), mMas = new Mesher(), mFlat = new Mesher();
    const c = new T.Color();
    const limestone = C0.LIMESTONE, cement = C0.CEMENT;

    /* ---- deck mass + seaward wall (masonry) ---- */
    // single big block: top hidden at 1.4 under the paving course, foot at -1.2
    mMas.box(shade(limestone, -0.1, c), 0, 0.1, -18, 260, 2.6, 32, 0, 0, 0, 1 / 6);
    // contact darkening along the waterline of the sea wall (no shadow maps)
    for (let x = -130; x < 130; x += 6.5) {
      mMas.box(mixc(C0.STONE_WET, C0.SEA_DEEP, 0.35, c), x + 3.25, -0.95, -2.02,
        6.5, 0.9, 0.1, 0, 0, 0, 1 / 6);
    }
    // end returns so the deck does not look like a cut slab
    mMas.box(shade(limestone, -0.14, c), -130.6, 0.1, -18, 1.4, 2.6, 32, 0, 0, 0, 1 / 6);
    mMas.box(shade(limestone, -0.14, c), 130.6, 0.1, -18, 1.4, 2.6, 32, 0, 0, 0, 1 / 6);

    /* ---- paving: a patchwork of slightly mismatched, slightly settled bays - */
    for (let x = -130; x < 130; x += 10) {
      for (let z = -34; z < -2; z += 8) {
        if (x > -6 && x < 6 && z > -4) continue;          // stair head stays clear
        const h = 0.2 + rng() * 0.03;
        vary(limestone, rng, 0.085, c);
        if (rng() < 0.12) mixc(c, cement, 0.45 + rng() * 0.3, c);   // repair bay
        mPave.box(c, x + 5, 1.5 - h * 0.5, z + 4, 10.02, h, 8.02, 0, 0, 0, 1 / 8);
      }
    }
    // poured repair patches sitting proud of the slabs
    for (let i = 0; i < 16; i++) {
      const x = -126 + rng() * 252, z = -33 + rng() * 29;
      if (x > -8 && x < 8 && z > -5) continue;
      vary(cement, rng, 0.14, c);
      mPave.box(c, x, 1.512, z, 2.2 + rng() * 4, 0.03, 1.6 + rng() * 3,
        0, (rng() - 0.5) * 0.3, 0, 1 / 8);
    }
    coll(-130, -34, 130, -2, 1.5);
    coll(-132, -36, 132, -34.2, 9.6);          // inland cliff: a wall, not a floor
    coll(-131.6, -34, -130, -2, 3.0);
    coll(130, -34, 131.6, -2, 3.0);

    /* ---- the stairs down to the water ---- */
    for (let s = 0; s < STAIR.length; s++) {
      const st = STAIR[s], h = st.top + 1.4, cy = st.top - h * 0.5;
      const wet = s >= 3 ? 1 : (s === 2 ? 0.35 : 0);
      // tread + riser as one solid block, so the flight reads as cut stone
      vary(limestone, rng, 0.06, c);
      if (wet > 0) mixc(c, C0.STONE_WET, wet * 0.55, c);
      mPave.box(c, 0, cy, (st.z1 + st.z2) * 0.5, 10, h, st.z2 - st.z1, 0, 0, 0, 1 / 8);
      // worn bright nosing on the step edge
      mPave.box(shade(limestone, 0.07, c), 0, st.top - 0.015, st.z2 - 0.07, 9.9, 0.04, 0.16, 0, 0, 0, 1 / 8);
      // black waterline staining + green algae on the lowest two
      if (s >= 3) {
        mFlat.box(mixc(C0.STONE_WET, C0.NIGHT_TOP, 0.5, c), 0, st.top + 0.003, (st.z1 + st.z2) * 0.5,
          9.8, 0.01, (st.z2 - st.z1) * 0.9);
        for (let k = 0; k < 7; k++) {
          mFlat.box(mixc(C0.PALM_GREEN, C0.SEA_DEEP, 0.3, c),
            -4.4 + rng() * 8.8, st.top + 0.008, st.z1 + 0.2 + rng() * (st.z2 - st.z1 - 0.4),
            0.5 + rng() * 1.1, 0.012, 0.3 + rng() * 0.5, 0, (rng() - 0.5) * 0.6, 0);
        }
      }
      coll(-5, st.z1, 5, st.z2, st.top);
    }
    // poured concrete apron at the bottom — exactly tile height, first balata here
    mPave.box(mixc(cement, limestone, 0.35, c), 0, 0.3 - 0.75, 2.25, 10, 1.5, 1.3, 0, 0, 0, 1 / 8);
    mFlat.box(mixc(C0.STONE_WET, C0.PALM_GREEN, 0.28, c), 0, 0.306, 2.45, 9.6, 0.012, 0.8);
    coll(-5, 1.6, 5, 2.9, 0.30);

    // stair cheek walls (outside the walkable corridor) + rusted iron handrail
    for (let side = -1; side <= 1; side += 2) {
      const x = side * 5.35;
      for (let s = 0; s < STAIR.length; s++) {
        const st = STAIR[s];
        mMas.box(shade(limestone, -0.05, c), x, (st.top + 0.26) * 0.5 - 0.2, (st.z1 + st.z2) * 0.5,
          0.7, st.top + 1.6, st.z2 - st.z1, 0, 0, 0, 1 / 6);
      }
      coll(side * 5.0, -2, side * 5.7, 2.9, 1.5);
    }
    // handrail: posts on the right-hand cheek, rail following the flight
    const hx = 5.05, rust = C0.RUST;
    let prev = null;
    for (let s = 0; s <= STAIR.length; s++) {
      const z = s < STAIR.length ? STAIR[s].z1 : STAIR[STAIR.length - 1].z2;
      const top = s < STAIR.length ? STAIR[s].top : STAIR[STAIR.length - 1].top;
      const ry = top + 0.95;
      mFlat.rod(vary(rust, rng, 0.2, c), hx, top, z + 0.1, hx, ry, z + 0.1, 0.06, PRIM.cyl6);
      if (prev) mFlat.rod(mixc(rust, C0.CEMENT, 0.25, c), prev.x, prev.y, prev.z, hx, ry, z + 0.1, 0.055, PRIM.cyl6);
      prev = { x: hx, y: ry, z: z + 0.1 };
    }
    // mooring ring + a coil of blue rope on the apron
    mFlat.prim(PRIM.torus, mixc(rust, C0.NIGHT_TOP, 0.3, c), -3.6, 0.42, 2.0, 0.6, 0.6, 0.6, 0, 0, Math.PI * 0.5);
    mFlat.box(shade(rust, -0.18, c), -3.6, 0.36, 2.0, 0.28, 0.24, 0.3);
    for (let k = 0; k < 4; k++) {
      mFlat.prim(PRIM.torus, vary(C0.DENIM, rng, 0.25, c), 3.1, 0.33 + k * 0.055, 2.1,
        1.5 - k * 0.18, 1.5 - k * 0.18, 1.5 - k * 0.18, Math.PI * 0.5, rng() * 3, 0);
    }

    /* ---- riprap rubble at the foot of the sea wall (z < 3, outside the stairs) */
    const mRock = new Mesher();
    for (let i = 0; i < 150; i++) {
      const x = -130 + rng() * 260;
      if (Math.abs(x) < 7.2 || (x > 9.4 && x < 15.4)) continue;   // stairs + jet-ski berth
      // kept inshore of z = 2.5 even at worst-case rotation: nothing may poke
      // above y = 0.30 once z >= 3.0, where the tile grid begins
      const z = -1.9 + rng() * 2.1;
      const s = 0.8 + rng() * 1.8;
      const y = -1.6 + rng() * 1.9;
      vary(y < 0.1 ? C0.STONE_WET : C0.STONE_DARK, rng, 0.17, c);
      mRock.box(c, x, y, z, s, s * (0.6 + rng() * 0.5), s * (0.8 + rng() * 0.5),
        (rng() - 0.5) * 0.5, rng() * TAU, (rng() - 0.5) * 0.5, 1 / 10);
    }

    /* ---- the inland cliff: stratified limestone holding up the city --------- */
    for (let x = -176; x < 176; x += 5.5) {
      const hTop = 9.5 + wig(x * 0.07) * 1.3;
      for (let y = -0.5; y < hTop; y += 1.5) {
        const t = y / hTop;
        const d = 9 + (1 - t) * 3 + wig(x * 0.13 + y) * 1.2;
        vary(y < 2.2 ? C0.STONE_DARK : C0.LIMESTONE, rng, 0.13, c);
        if (y < 2.0) mixc(c, C0.STONE_WET, 0.3, c);    // contact darkening at grade
        mRock.box(c, x + wig(y * 0.9 + x) * 0.5, y + 0.75, -38.5 - d * 0.5 + wig(x * 0.2) * 0.8,
          5.9 + rng() * 0.8, 1.6, d,
          (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.14, (rng() - 0.5) * 0.05, 1 / 10);
      }
      // scrubby growth on the cliff top
      if (rng() < 0.5) {
        mFlat.prim(PRIM.ico, vary(C0.PALM_GREEN, rng, 0.3, c), x + rng() * 4, hTop + 0.9, -35.4,
          1.1 + rng(), 0.7, 1.0 + rng(), 0, rng() * 3, 0);
      }
    }

    bake(mPave, W.MAT.pave, 'deckPaving');
    bake(mMas, W.MAT.mason, 'deckMasonry');
    bake(mRock, W.MAT.rock, 'cliffAndRiprap');
    bake(mFlat, W.MAT.flat, 'cornicheBits');
  }

  /* =========================================================================
     BALUSTRADE — instanced chunky balusters + merged iron handrail, with
     honest gaps where the railing is simply missing.
     ========================================================================= */
  function buildBalustrade() {
    const C0 = W.COL, rng = mulberry(8123), c = new T.Color();
    const RZ = -2.72;
    // gaps: the stair head, plus four stretches where the rail never came back
    const gaps = [[-6.2, 6.2], [-27, -21.4], [39.2, 45.6], [-73.5, -67.2], [88, 93.6], [112, 115.4]];
    const inGap = function (x) {
      for (let i = 0; i < gaps.length; i++) if (x > gaps[i][0] && x < gaps[i][1]) return true;
      return false;
    };
    const bal = new T.BoxGeometry(0.3, 0.95, 0.3).toNonIndexed();
    bal.setAttribute('color', new T.Float32BufferAttribute(
      (function () { const a = []; for (let i = 0; i < bal.attributes.position.count; i++) a.push(1, 1, 1); return a; })(), 3));
    const xs = [];
    for (let x = -129.4; x <= 129.4; x += 1.05) {
      if (inGap(x)) continue;
      xs.push(xf(x, 1.97, RZ + (rng() - 0.5) * 0.05, 1, 1, 1, 0, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.03));
    }
    instanced(bal, W.MAT.mason, xs, shade(C0.LIMESTONE, 0.03, new T.Color()), 0.1, 'balusters');

    const m = new Mesher();
    // continuous kerb under the balusters + coping over them, broken at the gaps
    let run = null;
    const flush = function (x2) {
      if (!run) return;
      const w = x2 - run;
      if (w > 0.4) {
        m.box(vary(C0.LIMESTONE, rng, 0.07, c), (run + x2) * 0.5, 1.56, RZ, w, 0.13, 0.52, 0, 0, 0, 1 / 6);
        m.box(vary(C0.LIMESTONE, rng, 0.07, c), (run + x2) * 0.5, 2.5, RZ, w, 0.14, 0.48, 0, 0, 0, 1 / 6);
      }
      run = null;
    };
    for (let x = -130; x <= 130; x += 0.5) {
      if (inGap(x)) flush(x); else if (run === null) run = x;
    }
    flush(130);
    // weathered iron handrail above the coping, in 3 m lengths with wonky joints
    for (let x = -130; x < 130; x += 3) {
      if (inGap(x + 1.5)) continue;
      const sag = Math.sin(x * 0.31) * 0.012;
      m.rod(vary(C0.RUST, rng, 0.26, c), x, 2.69 + sag, RZ, x + 3, 2.69 - sag, RZ, 0.055, PRIM.cyl6);
      if (rng() < 0.3) {   // a stanchion welded on, slightly out of plumb
        m.rod(mixc(C0.RUST, C0.CEMENT, 0.3, c), x + 1.5, 2.5, RZ, x + 1.5 + (rng() - 0.5) * 0.1, 2.72, RZ, 0.045, PRIM.cyl6);
      }
    }
    bake(m, W.MAT.mason, 'railing');
    return gaps;
  }

  /* ---------- arch helpers: rings of voussoir blocks, hand-laid ------------ */
  function archXY(m, color, cx, cy, cz, r, th, depth, n, rng, jitter) {
    const rm = r + th * 0.5, tan = (Math.PI * rm / n) * 1.12;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (i + 0.5) / n;
      const j = jitter && rng ? (rng() - 0.5) * jitter : 0;
      m.box(color, cx + Math.cos(a) * rm, cy + Math.sin(a) * rm, cz,
        tan, th * (1 + j), depth, 0, 0, a - Math.PI * 0.5, 1 / 6);
    }
  }
  function archZY(m, color, cx, cy, cz, r, th, depth, n, rng, jitter) {
    const rm = r + th * 0.5, tan = (Math.PI * rm / n) * 1.12;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (i + 0.5) / n;
      const j = jitter && rng ? (rng() - 0.5) * jitter : 0;
      m.box(color, cx, cy + Math.sin(a) * rm, cz + Math.cos(a) * rm,
        depth, th * (1 + j), tan, Math.PI * 0.5 - a, 0, 0, 1 / 6);
    }
  }
  /* crenellations along a straight run */
  function merlons(m, color, x1, z1, x2, z2, y, w, h, thick, rng) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / (w * 1.85)));
    const ry = Math.atan2(dx, dz);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      vary(color, rng, 0.12, _v.col3);
      m.box(_v.col3, x1 + dx * t, y + h * 0.5, z1 + dz * t, thick, h, w,
        0, ry + (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.03, 1 / 6);
    }
  }

  /* =========================================================================
     OFF SAIDA.  Saida has no sea stacks — that is Beirut. Its seaward
     silhouette is the castle, the harbour mole with its little beacon, and
     Jazirat Ziri lying low and flat on the horizon. strataStack and
     rockColour below are shared by the island, the mole and the castle islet.
     ========================================================================= */
  function rockColour(y, rng, C0, out) {
    if (y < -0.3) return mixc(C0.STONE_WET, C0.SEA_DEEP, 0.45, out);
    if (y < 1.1) return vary(mixc(C0.STONE_WET, C0.STONE_DARK, 0.35, out), rng, 0.1, out);
    if (y < 2.6) return vary(mixc(C0.STONE_DARK, C0.LIMESTONE, 0.5, out), rng, 0.12, out);
    return vary(C0.LIMESTONE, rng, 0.11, out);
  }

  /* stacks slightly-rotated, slightly-varied strata blocks; gapFn carves the
     arch by splitting each course into two legs                              */
  function strataStack(m, o) {
    const rng = o.rng, C0 = W.COL, c = new T.Color();
    for (let y = o.baseY; y < o.topY; y += o.layerH) {
      const h = Math.min(o.layerH, o.topY - y) * (0.92 + rng() * 0.16);
      const t = clamp((y - o.baseY) / (o.topY - o.baseY), 0, 1);
      let hx = o.hx(t), hz = o.hz(t);
      // wave-cut notch at the waterline — the stacks are undercut by the sea
      const notch = smooth(-0.4, 0.5, y) * (1 - smooth(1.5, 2.6, y));
      hx -= notch * o.notch; hz -= notch * o.notch;
      const cy = y + h * 0.5;
      const ry = o.rot + (rng() - 0.5) * 0.2;
      const ox = o.ox + (rng() - 0.5) * 0.45, oz = o.oz + (rng() - 0.5) * 0.45;
      const g = o.gap ? o.gap(cy) : 0;
      rockColour(cy, rng, C0, c);
      if (g > 0.5 && g < hx - 1.1) {
        const w = hx - g;
        m.box(c, ox - (g + w * 0.5), cy, oz, w * 2, h, hz * 2, 0, ry, (rng() - 0.5) * 0.035, 1 / 10);
        rockColour(cy, rng, C0, c);
        m.box(c, ox + (g + w * 0.5), cy, oz, w * 2, h, hz * 2, 0, ry, (rng() - 0.5) * 0.035, 1 / 10);
      } else {
        m.box(c, ox, cy, oz, hx * 2, h, hz * 2, (rng() - 0.5) * 0.02, ry, (rng() - 0.5) * 0.03, 1 / 10);
      }
      // a few spalled blocks clinging to the flanks, so the sides are not slabs
      if (rng() < 0.5) {
        const sgn = rng() < 0.5 ? -1 : 1, s = 0.6 + rng() * 1.5;
        rockColour(cy, rng, C0, c);
        m.box(c, ox + sgn * (hx - 0.2), cy + (rng() - 0.5) * h, oz + (rng() - 0.5) * hz * 1.2,
          s, s * 0.7, s, rng(), rng() * TAU, rng() * 0.4, 1 / 10);
      }
    }
  }

  function buildSaidaOffshore() {
    const C0 = W.COL, rng = mulberry(9100), c = new T.Color();
    const g = new T.Group();
    const m = new Mesher();     // rock / rubble
    const mf = new Mesher();    // concrete, timber, paint
    const mg = new Mesher();    // the beacon lamp (swapped at night)

    /* ---- Jazirat Ziri: low, flat, scrubby. Reads as a line, not a tower. -- */
    const ISL = { x: 74, z: 98 };
    strataStack(m, {
      rng: rng, baseY: -2.6, topY: 5.6, layerH: 0.8, notch: 0.55,
      ox: ISL.x, oz: ISL.z, rot: 0.32,
      hx: function (t) { return 16.5 - t * 6.5; },
      hz: function (t) { return 11.5 - t * 4.6; }
    });
    // dry scrub and gull mess on the cap
    for (let i = 0; i < 16; i++) {
      const a = rng() * TAU, rr = rng() * 8.5;
      const sx = ISL.x + Math.cos(a) * rr, sz = ISL.z + Math.sin(a) * rr * 0.72;
      mf.box(vary(mixc(C0.PALM_GREEN, C0.LIMESTONE, 0.55, c), rng, 0.18, c),
        sx, 5.72 + rng() * 0.2, sz, 0.8 + rng() * 1.5, 0.22, 0.7 + rng() * 1.2,
        0, rng() * TAU, 0);
    }
    coll(ISL.x - 16, ISL.z - 11, ISL.x + 16, ISL.z + 11, 5.7);

    /* ---- the harbour mole: tumbled blocks out from the castle side, the
            way every Lebanese fishing port is held together. ---------------- */
    const moleAt = function (t) {
      return { x: -76 + t * 44, z: 32 + Math.sin(t * 1.35) * 21 + t * 6 };
    };
    const N = 30;
    for (let i = 0; i <= N; i++) {
      const t = i / N, pnt = moleAt(t);
      const top = 2.5 - t * 0.5;
      // the mole proper: big cast blocks, stacked badly
      for (let k = 0; k < 2; k++) {
        const w = 3.6 + rng() * 2.4, h = 1.5 + rng() * 1.3, d = 3.2 + rng() * 2.0;
        const yy = -1.2 + k * 1.9 + rng() * 0.3;
        const col = yy < 0.35
          ? mixc(C0.STONE_WET, C0.SEA_DEEP, 0.4, c)
          : vary(mixc(C0.CEMENT, C0.STONE_DARK, 0.35, c), rng, 0.14, c);
        m.box(col, pnt.x + (rng() - 0.5) * 2.6, yy, pnt.z + (rng() - 0.5) * 2.4,
          w, h, d, (rng() - 0.5) * 0.12, rng() * TAU, (rng() - 0.5) * 0.12, 1 / 8);
      }
      // tetrapods on the seaward flank
      if (i % 3 === 0) {
        const tx = pnt.x + 3.4 + rng() * 2, tz = pnt.z + 3.0 + rng() * 2;
        const tcol = vary(mixc(C0.CEMENT, C0.FOAM, 0.2, c), rng, 0.1, c);
        for (let a = 0; a < 3; a++) {
          mf.box(tcol, tx, 0.5 + rng() * 0.4, tz, 2.6, 0.7, 0.7,
            rng() * 1.2, a * 1.05 + rng() * 0.3, rng() * 1.2);
        }
      }
      if (i % 5 === 0) {
        coll(pnt.x - 4.5, pnt.z - 4.0, pnt.x + 4.5, pnt.z + 4.0, top);
      }
    }

    /* ---- the beacon at the head of the mole ------------------------------ */
    const tip = moleAt(1);
    const bx = tip.x, bz = tip.z;
    mf.box(vary(C0.CEMENT, rng, 0.08, c), bx, 1.6, bz, 4.2, 1.6, 4.2, 0, 0.2, 0);
    for (let k = 0; k < 4; k++) {
      const w = 2.5 - k * 0.42;
      mf.box(k % 2 ? mixc(C0.FOAM, C0.CEMENT, 0.25, c) : mixc(C0.RUST, C0.TERRACOTTA, 0.4, c),
        bx, 2.7 + k * 1.15, bz, w, 1.15, w, 0, 0.2, 0);
    }
    mf.box(mixc(C0.STONE_DARK, C0.NIGHT_TOP, 0.5, c), bx, 7.6, bz, 1.5, 0.22, 1.5, 0, 0.2, 0);
    // the lamp itself: its own mesh, so night can swap the material
    mg.box(mixc(C0.SUN, C0.FOAM, 0.35, c), bx, 8.05, bz, 1.0, 0.75, 1.0, 0, 0.2, 0);
    mf.box(mixc(C0.STONE_DARK, C0.NIGHT_TOP, 0.4, c), bx, 8.55, bz, 1.3, 0.2, 1.3, 0, 0.2, 0);
    coll(bx - 2.2, bz - 2.2, bx + 2.2, bz + 2.2, 7.6);

    /* ---- loose rocks breaking the surface inshore of the mole ------------- */
    for (let i = 0; i < 14; i++) {
      const rx = -70 + rng() * 54, rz = 12 + rng() * 34;
      const sy = 0.5 + rng() * 1.5;
      m.box(rockColour(sy * 0.5, rng, C0, c), rx, sy * 0.5 - 0.5, rz,
        1.4 + rng() * 3.0, sy, 1.3 + rng() * 2.6,
        (rng() - 0.5) * 0.3, rng() * TAU, (rng() - 0.5) * 0.3, 1 / 8);
    }

    g.add(bake(m, W.MAT.rock, 'saidaOffshoreRock'));
    g.add(bake(mf, W.MAT.flat, 'saidaOffshoreBits'));
    const glow = bake(mg, W.MAT.glowOff, 'moleBeacon');
    g.add(glow);
    W.night.push(glow);

    /* ---- gull perches: the island cap, the mole blocks, the beacon ------- */
    W.perches = [];
    for (let i = 0; i < 4; i++) {
      const a = rng() * TAU, rr = 3 + rng() * 7;
      W.perches.push({
        x: ISL.x + Math.cos(a) * rr, y: 5.9,
        z: ISL.z + Math.sin(a) * rr * 0.72, ry: rng() * TAU
      });
    }
    for (let i = 0; i < 3; i++) {
      const pnt = moleAt(0.2 + rng() * 0.6);
      W.perches.push({ x: pnt.x, y: 2.5, z: pnt.z, ry: rng() * TAU });
    }
    W.perches.push({ x: bx, y: 8.75, z: bz, ry: rng() * TAU });

    return g;
  }

  /* =========================================================================
     SAIDA SEA CASTLE — Qalaat al-Bahr.  Squat Crusader towers, rubble curtain
     wall with ROMAN COLUMN BUTTS used as bonding courses (the signature
     detail), crenellations, arrow slits, an Ottoman domed cell, and a flag.
     ========================================================================= */
  function buildCastle() {
    const C0 = W.COL, rng = mulberry(5150), c = new T.Color();
    const cg = new T.Group();
    cg.position.set(-86, 0, 30);
    cg.rotation.y = -0.22;

    /* --- rock islet --------------------------------------------------------- */
    const mr = new Mesher();
    strataStack(mr, {
      rng: rng, ox: 0, oz: 0, rot: 0, baseY: -7, topY: 3.4, layerH: 1.15, notch: 1.6, gap: null,
      hx: function (t) { return 20.5 - t * 4.5 + wig(t * 8) * 1.1; },
      hz: function (t) { return 15.5 - t * 3.2 + wig(t * 6 + 3) * 1.0; }
    });
    for (let i = 0; i < 70; i++) {   // boulder skirt at the waterline
      const a = rng() * TAU, r = 13 + rng() * 7;
      const x = Math.cos(a) * r * 1.25, z = Math.sin(a) * r * 0.95, s = 0.9 + rng() * 2.4;
      mr.box(rockColour(0.3, rng, C0, c), x, -0.6 + rng() * 1.4, z, s, s * 0.7, s * 0.9,
        rng(), rng() * TAU, rng(), 1 / 10);
    }
    cg.add(bake(mr, W.MAT.rock, 'castleIslet'));
    coll(-104, 12, -68, 48, 3.4);

    /* --- masonry: plinth, curtain wall, towers ------------------------------ */
    const mm = new Mesher(), mg = new Mesher(), mf = new Mesher();
    const stoneA = mixc(C0.LIMESTONE, C0.STONE_DARK, 0.3, new T.Color());
    const WALL_TOP = 11.4, PL = 3.4;
    mm.box(vary(stoneA, rng, 0.07, c), 0, PL + 0.5, 0, 27, 1.6, 20.5, 0, 0, 0, 1 / 6);  // plinth
    // courtyard floor
    mm.box(mixc(C0.LIMESTONE, C0.CEMENT, 0.3, c), 0, PL + 1.35, 0, 22, 0.3, 15.5, 0, 0, 0, 1 / 6);

    const WX = 12.2, WZ = 9.2, TH = 2.2;
    const runs = [
      { x1: -WX, z1: -WZ, x2: WX, z2: -WZ, n: new T.Vector3(0, 0, -1) },   // inshore (gate)
      { x1: -WX, z1: WZ, x2: WX, z2: WZ, n: new T.Vector3(0, 0, 1) },      // seaward
      { x1: -WX, z1: -WZ, x2: -WX, z2: WZ, n: new T.Vector3(-1, 0, 0) },
      { x1: WX, z1: -WZ, x2: WX, z2: WZ, n: new T.Vector3(1, 0, 0) }
    ];
    // curtain walls, laid as coarse courses so the rubble reads
    for (let ri = 0; ri < runs.length; ri++) {
      const r = runs[ri], horiz = Math.abs(r.n.z) > 0.5;
      const len = horiz ? WX * 2 : WZ * 2;
      for (let y = PL + 1.3; y < WALL_TOP; y += 1.1) {
        const h = Math.min(1.1, WALL_TOP - y);
        const seg = horiz ? 3.1 : 2.6, n = Math.ceil(len / seg);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const x = horiz ? -WX + t * len : r.x1;
          const z = horiz ? r.z1 : -WZ + t * len;
          // leave the gate void on the inshore face
          if (ri === 0 && Math.abs(x) < 2.6 && y < PL + 6.0) continue;
          vary(stoneA, rng, 0.1, c);
          if (y < PL + 2.6) mixc(c, C0.STONE_WET, 0.18, c);   // damp base, baked-in
          mm.box(c, x, y + h * 0.5, z,
            horiz ? len / n * 1.02 : TH, h * 1.02, horiz ? TH : len / n * 1.02,
            0, (rng() - 0.5) * 0.02, (rng() - 0.5) * 0.015, 1 / 6);
        }
      }
      merlons(mm, stoneA, r.x1, r.z1, r.x2, r.z2, WALL_TOP, 1.15, 1.25, TH * 0.72, rng);
      // arrow slits
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.5) / 5;
        const x = horiz ? -WX + t * WX * 2 : r.x1 + r.n.x * TH * 0.49;
        const z = horiz ? r.z1 + r.n.z * TH * 0.49 : -WZ + t * WZ * 2;
        if (ri === 0 && Math.abs(x) < 3) continue;
        mf.box(mixc(C0.NIGHT_TOP, C0.STONE_DARK, 0.25, c), x, PL + 5.6, z,
          horiz ? 0.22 : 0.12, 1.5, horiz ? 0.12 : 0.22);
      }
      /* ROMAN COLUMNS laid horizontally through the masonry as bonding
         courses — butts poking proud of the wall face.  The castle's tell. */
      for (let course = 0; course < 3; course++) {
        const y = PL + 2.0 + course * 2.7;
        const n = horiz ? 6 : 4;
        for (let i = 0; i < n; i++) {
          if (rng() < 0.22) continue;
          const t = (i + 0.6) / n;
          const x = horiz ? -WX + t * WX * 2 : r.x1;
          const z = horiz ? r.z1 : -WZ + t * WZ * 2;
          if (ri === 0 && Math.abs(x) < 3.4) continue;
          const stick = 0.45 + rng() * 0.5;
          const colc = vary(mixc(C0.LIMESTONE, C0.FOAM, 0.35, c), rng, 0.1, c);
          const ax = r.n.x * (TH * 0.5 + stick * 0.5), az = r.n.z * (TH * 0.5 + stick * 0.5);
          mm.prim(PRIM.cyl12, colc, x + ax, y + (rng() - 0.5) * 0.2, z + az,
            0.42 + rng() * 0.1, TH + stick, 0.42 + rng() * 0.1,
            horiz ? Math.PI * 0.5 : 0, 0, horiz ? 0 : Math.PI * 0.5, 1 / 6);
        }
      }
    }
    // the gate: round arch + heavy timber door, where the causeway lands
    archXY(mm, vary(stoneA, rng, 0.08, c), 0, PL + 4.2, -WZ, 2.5, 0.8, TH * 1.15, 9, rng, 0.2);
    mf.box(mixc(C0.TRUNK, C0.RUST, 0.3, c), 0, PL + 2.6, -WZ - 0.1, 4.4, 5.0, 0.3);
    for (let i = 0; i < 5; i++) {
      mf.box(shade(C0.TRUNK, -0.16, c), -1.7 + i * 0.85, PL + 2.6, -WZ - 0.28, 0.7, 4.9, 0.14);
    }

    /* --- the two squat towers ---------------------------------------------- */
    const towers = [
      { x: -8.6, z: -0.8, w: 10.0, d: 10.0, top: 17.2, dome: true },
      { x: 8.6, z: 2.4, w: 8.0, d: 8.0, top: 14.0, dome: false }
    ];
    for (let ti = 0; ti < towers.length; ti++) {
      const tw = towers[ti];
      for (let y = PL + 0.8; y < tw.top; y += 1.15) {
        const h = Math.min(1.15, tw.top - y);
        const taper = 1 + (1 - (y - PL) / (tw.top - PL)) * 0.05;
        vary(stoneA, rng, 0.1, c);
        if (y < PL + 2.4) mixc(c, C0.STONE_WET, 0.16, c);
        mm.box(c, tw.x, y + h * 0.5, tw.z, tw.w * taper, h * 1.02, tw.d * taper,
          0, (rng() - 0.5) * 0.02, 0, 1 / 6);
      }
      const hw = tw.w * 0.5, hd = tw.d * 0.5;
      merlons(mm, stoneA, tw.x - hw, tw.z - hd, tw.x + hw, tw.z - hd, tw.top, 1.1, 1.3, 1.5, rng);
      merlons(mm, stoneA, tw.x - hw, tw.z + hd, tw.x + hw, tw.z + hd, tw.top, 1.1, 1.3, 1.5, rng);
      merlons(mm, stoneA, tw.x - hw, tw.z - hd, tw.x - hw, tw.z + hd, tw.top, 1.1, 1.3, 1.5, rng);
      merlons(mm, stoneA, tw.x + hw, tw.z - hd, tw.x + hw, tw.z + hd, tw.top, 1.1, 1.3, 1.5, rng);
      // string course of column butts around the tower too
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU, sx = Math.cos(a), sz = Math.sin(a);
        const horiz = Math.abs(sx) > Math.abs(sz);
        mm.prim(PRIM.cyl8, mixc(C0.LIMESTONE, C0.FOAM, 0.3, c),
          tw.x + sx * (hw + 0.2), PL + 6.4, tw.z + sz * (hd + 0.2), 0.38, 1.4, 0.38,
          horiz ? Math.PI * 0.5 : 0, 0, horiz ? 0 : Math.PI * 0.5, 1 / 6);
      }
      // windows that glow at night
      for (let i = 0; i < 3; i++) {
        mg.box(mixc(C0.SUN, C0.FOAM, 0.25, c), tw.x - 2.6 + i * 2.6, PL + 8.2, tw.z - hd - 0.06, 0.8, 1.3, 0.12);
      }
      mg.box(mixc(C0.SUN, C0.FOAM, 0.25, c), tw.x + hw + 0.06, PL + 5.4, tw.z, 0.12, 1.2, 0.75);
      coll(-86 + tw.x - hw, 30 + tw.z - hd, -86 + tw.x + hw, 30 + tw.z + hd, tw.top);

      if (tw.dome) {
        // small Ottoman-era domed cell on the roof
        const by = tw.top + 1.3;
        mm.box(vary(mixc(C0.LIMESTONE, C0.FOAM, 0.2, c), rng, 0.05, c), tw.x, by, tw.z, 5.4, 2.6, 5.4, 0, 0.06, 0, 1 / 6);
        mm.prim(PRIM.dome, mixc(C0.LIMESTONE, C0.CEMENT, 0.3, c), tw.x, by + 1.3, tw.z, 5.6, 3.4, 5.6, 0, 0.06, 0, 1 / 6);
        mf.prim(PRIM.cone6, C0.RUST, tw.x, by + 4.9, tw.z, 0.4, 0.8, 0.4);
        mg.box(mixc(C0.SUN, C0.TERRACOTTA, 0.2, c), tw.x, by + 0.2, tw.z - 2.75, 0.7, 1.0, 0.1);
      }
    }
    // a lean-to shed and some clutter in the courtyard
    mm.box(vary(stoneA, rng, 0.1, c), -2, PL + 2.6, 5.2, 5.0, 2.4, 3.4, 0, 0.1, 0, 1 / 6);
    mf.box(mixc(C0.RUST, C0.CEMENT, 0.4, c), -2, PL + 3.95, 5.2, 5.6, 0.14, 3.9, 0, 0.1, 0.03);

    cg.add(bake(mm, W.MAT.mason, 'castleMasonry'));
    cg.add(bake(mf, W.MAT.flat, 'castleBits'));
    const glow = bake(mg, W.MAT.glowOff, 'castleWindows');
    cg.add(glow);
    W.night.push(glow);

    /* --- the flag ----------------------------------------------------------- */
    const fg = new T.Group();
    fg.position.set(towers[0].x + 3.4, towers[0].top + 0.9, towers[0].z + 3.4);
    const mp = new Mesher();
    mp.rod(C0.CEMENT, 0, 0, 0, 0, 6.6, 0, 0.13, PRIM.cyl8);
    mp.prim(PRIM.sph, C0.SUN, 0, 6.8, 0, 0.34);
    fg.add(bake(mp, W.MAT.flat, 'flagPole'));
    const flagGeo = new T.PlaneGeometry(3.3, 2.2, 7, 3);
    flagGeo.translate(1.65, 0, 0);
    const flag = new T.Mesh(flagGeo, W.MAT.flag);
    flag.name = 'flag';
    flag.position.set(0.12, 5.3, 0);
    W.geos.push(flagGeo);
    fg.add(flag);
    cg.add(fg);
    W.group.add(cg);
    W.flag = flag;
    W.flagBase = flagGeo.attributes.position.array.slice();
    return cg;
  }

  /* =========================================================================
     THE CAUSEWAY — long stone deck on round arches, from the islet to the
     corniche.  Deck top y=2.4 (above tile level); piers only in i[-48,-33].
     ========================================================================= */
  function buildCauseway() {
    const C0 = W.COL, rng = mulberry(4040), c = new T.Color();
    const g = new T.Group();
    g.position.set(-86, 0, 10);
    g.rotation.y = Math.atan2(0.8, -0.6);   // local +Z runs toward the shore
    const m = new Mesher(), mf = new Mesher();
    const stone = mixc(C0.LIMESTONE, C0.STONE_DARK, 0.22, new T.Color());
    const LEN = 20.2, WID = 5.0, DECK = 2.4;

    // deck, laid as separate slabs with a slight settle
    for (let z = -2; z < LEN + 0.2; z += 2.0) {
      vary(stone, rng, 0.08, c);
      m.box(c, 0, DECK - 0.42 - rng() * 0.015, z + 1.0, WID, 0.85, 2.02, 0, 0, (rng() - 0.5) * 0.012, 1 / 6);
    }
    // short run-out onto the corniche deck, stepping 2.4 -> 1.5
    for (let i = 0; i < 4; i++) {
      m.box(vary(stone, rng, 0.07, c), 0, DECK - 0.22 - i * 0.225, LEN + 1.1 + i * 1.0,
        WID - i * 0.1, 0.9, 1.05, 0, 0, 0, 1 / 6);
    }
    // piers + round arches
    const piers = [1.8, 6.2, 10.6, 15.0, 19.4];
    for (let i = 0; i < piers.length; i++) {
      const z = piers[i];
      for (let y = -4.5; y < 0.3; y += 1.1) {
        const h = Math.min(1.1, 0.3 - y);
        vary(stone, rng, 0.09, c);
        if (y < 1.0) mixc(c, C0.STONE_WET, clamp(1 - (y + 1) * 0.5, 0.15, 0.7), c);
        m.box(c, 0, y + h * 0.5, z, 4.3 - (y + 4.5) * 0.06, h * 1.02, 1.75, 0, 0, 0, 1 / 6);
      }
      // cutwater on the seaward side of each pier
      m.prim(PRIM.pyr4, mixc(stone, C0.STONE_WET, 0.35, c), 0, -1.6, z - 1.3, 2.6, 2.4, 2.6, 0, Math.PI * 0.25, 0, 1 / 6);
      if (i < piers.length - 1) {
        archZY(m, vary(stone, rng, 0.08, c), 0, 0.25, (piers[i] + piers[i + 1]) * 0.5,
          1.35, 0.55, 4.1, 9, rng, 0.25);
        // spandrel fill between arch and deck
        m.box(vary(stone, rng, 0.08, c), 0, 1.35, (piers[i] + piers[i + 1]) * 0.5, 4.0, 0.5, 4.4, 0, 0, 0, 1 / 6);
      }
      coll(-86 + 0.8 * z - 2.2, 10 - 0.6 * z - 2.2, -86 + 0.8 * z + 2.2, 10 - 0.6 * z + 2.2, DECK);
    }
    // low parapets with chunks missing
    for (let side = -1; side <= 1; side += 2) {
      for (let z = -1.5; z < LEN; z += 1.4) {
        if (rng() < 0.13) continue;                       // a block knocked out
        vary(stone, rng, 0.1, c);
        m.box(c, side * 2.28, 2.4 + 0.42, z + 0.7, 0.45, 0.84, 1.42,
          0, 0, side * (rng() - 0.5) * 0.04, 1 / 6);
      }
    }
    // algae and black staining at the waterline of each pier
    for (let i = 0; i < piers.length; i++) {
      mf.box(mixc(C0.PALM_GREEN, C0.NIGHT_TOP, 0.4, c), 0, 0.1, piers[i], 4.4, 1.0, 1.85);
    }
    g.add(bake(m, W.MAT.mason, 'causeway'));
    const bits = bake(mf, W.MAT.flat, 'causewayStain');
    if (bits) g.add(bits);
    W.group.add(g);
    // walkable deck along the diagonal, approximated by four AABBs
    for (let i = 0; i < 4; i++) {
      const t0 = i * 5.2, t1 = t0 + 5.6;
      const x0 = -86 + 0.8 * t0, z0 = 10 - 0.6 * t0;
      const x1 = -86 + 0.8 * t1, z1 = 10 - 0.6 * t1;
      coll(Math.min(x0, x1) - 2.2, Math.min(z0, z1) - 2.2, Math.max(x0, x1) + 2.2, Math.max(z0, z1) + 2.2, DECK);
    }
  }

  /* =========================================================================
     PALMS & FICUS.  All trunks merge into one mesh; each crown is its own
     (shared-geometry) mesh so it can sway independently in update().
     ========================================================================= */
  function buildPalmCrownGeo(seed) {
    const C0 = W.COL, rng = mulberry(seed), m = new Mesher(), c = new T.Color();
    const N = 11;
    const pt = function (a, len, droop, t, out) {
      const r = t * len;
      out.set(Math.cos(a) * r, 0.35 + t * 1.25 - droop * t * t * 3.1, Math.sin(a) * r);
      return out;
    };
    const p0 = new T.Vector3(), p1 = new T.Vector3();
    const A = new T.Vector3(), B = new T.Vector3(), D = new T.Vector3(), E = new T.Vector3();
    for (let f = 0; f < N; f++) {
      const a = (f / N) * TAU + (rng() - 0.5) * 0.25;
      const len = 3.3 + rng() * 1.5, droop = 0.5 + rng() * 0.55;
      const px = -Math.sin(a), pz = Math.cos(a);
      const base = vary(f % 3 === 0 ? C0.PALM_LIGHT : C0.PALM_GREEN, rng, 0.2, new T.Color());
      const segs = 5;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        pt(a, len, droop, t0, p0); pt(a, len, droop, t1, p1);
        const w0 = 0.46 * (1 - t0 * 0.7) + 0.04, w1 = 0.46 * (1 - t1 * 0.7) + 0.04;
        const lift0 = 0.1 * (1 - t0), lift1 = 0.1 * (1 - t1);
        vary(base, rng, 0.1, c);
        // V-sectioned blade: two half-quads with a dihedral, cheap but reads
        for (let sg = -1; sg <= 1; sg += 2) {
          A.set(p0.x, p0.y, p0.z);
          B.set(p1.x, p1.y, p1.z);
          D.set(p1.x + px * w1 * sg, p1.y + lift1, p1.z + pz * w1 * sg);
          E.set(p0.x + px * w0 * sg, p0.y + lift0, p0.z + pz * w0 * sg);
          if (sg > 0) m.quad(c, A, B, D, E); else m.quad(c, E, D, B, A);
        }
      }
      // midrib, so the frond has a bit of body
      pt(a, len, droop, 1, p1);
      m.rod(shade(base, -0.08, c), 0, 0.35, 0, p1.x, p1.y, p1.z, 0.075, PRIM.cyl6);
    }
    // dates / coconut cluster hanging under the crown
    for (let i = 0; i < 9; i++) {
      const a = rng() * TAU, r = 0.5 + rng() * 0.7;
      m.prim(PRIM.ico, vary(mixc(C0.TERRACOTTA, C0.SUN, 0.45, c), rng, 0.25, c),
        Math.cos(a) * r, -0.35 - rng() * 0.5, Math.sin(a) * r, 0.45 + rng() * 0.3);
    }
    const g = m.geo();
    W.geos.push(g);
    return g;
  }

  function buildTrees() {
    const C0 = W.COL, rng = mulberry(3300), c = new T.Color();
    const trunks = new Mesher();
    const crownGeos = [buildPalmCrownGeo(71), buildPalmCrownGeo(72), buildPalmCrownGeo(73)];
    const xs = [-124, -108, -92, -60, -44, -30, -18, 20, 34, 50, 66, 84, 100, 118];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] + (rng() - 0.5) * 2.4, z = -10.5 + (rng() - 0.5) * 3.5;
      const h = 7.4 + rng() * 4.2;
      const lean = (rng() - 0.5) * 0.17, leanZ = (rng() - 0.5) * 0.12;
      // planter kerb + a ring of dry soil (contact darkening, no shadow maps)
      trunks.prim(PRIM.cyl8, vary(C0.CEMENT, rng, 0.1, c), x, 1.58, z, 2.6, 0.22, 2.6, 0, 0, 0, 1 / 6);
      trunks.prim(PRIM.cyl8, mixc(C0.TRUNK, C0.NIGHT_TOP, 0.3, c), x, 1.66, z, 2.2, 0.1, 2.2);
      // ribbed trunk: short stacked drums, alternating radius
      const segs = Math.round(h / 0.62);
      for (let s = 0; s < segs; s++) {
        const t = s / segs;
        const r = (0.46 - t * 0.14) * (s % 2 === 0 ? 1.0 : 0.88);
        const bend = Math.sin(t * 1.5) * 1.0;
        trunks.prim(PRIM.cyl8, vary(C0.TRUNK, rng, 0.14, c),
          x + lean * bend * h, 1.6 + t * h + 0.31, z + leanZ * bend * h,
          r * 2, 0.66, r * 2, leanZ * 0.6, (s * 0.7) % TAU, -lean * 0.6, 1 / 3);
      }
      // dead frond skirt just under the crown
      const cx = x + lean * Math.sin(1.5) * h, cz = z + leanZ * Math.sin(1.5) * h, cy = 1.6 + h;
      for (let k = 0; k < 5; k++) {
        const a = rng() * TAU;
        trunks.box(vary(mixc(C0.TRUNK, C0.SUN, 0.3, c), rng, 0.2, c),
          cx + Math.cos(a) * 0.5, cy - 0.5, cz + Math.sin(a) * 0.5, 0.3, 1.4, 0.3,
          Math.cos(a) * 0.7, a, Math.sin(a) * 0.7);
      }
      const crown = new T.Mesh(crownGeos[i % 3], W.MAT.leaf);
      crown.position.set(cx, cy, cz);
      crown.castShadow = true;
      crown.name = 'palmCrown';
      W.group.add(crown);
      W.palms.push({ mesh: crown, phase: rng() * TAU, amp: 0.035 + rng() * 0.035, rate: 0.5 + rng() * 0.4 });
      coll(x - 1.3, z - 1.3, x + 1.3, z + 1.3, 1.8);
    }
    // two ficus trees: chunky blobs, very municipal
    const fic = [[-72, -16], [44, -18]];
    for (let i = 0; i < fic.length; i++) {
      const x = fic[i][0], z = fic[i][1];
      trunks.prim(PRIM.cyl8, vary(C0.CEMENT, rng, 0.1, c), x, 1.58, z, 3.0, 0.24, 3.0, 0, 0, 0, 1 / 6);
      trunks.prim(PRIM.cyl8, vary(C0.TRUNK, rng, 0.1, c), x, 3.0, z, 0.78, 3.0, 0.78, 0, 0, 0.04, 1 / 3);
      for (let b = 0; b < 3; b++) {
        const a = b * 2.1 + 0.4;
        trunks.rod(shade(C0.TRUNK, -0.05, c), x, 4.1, z,
          x + Math.cos(a) * 1.5, 5.2, z + Math.sin(a) * 1.5, 0.3, PRIM.cyl6);
      }
      for (let k = 0; k < 7; k++) {
        const a = rng() * TAU, r = rng() * 2.1;
        trunks.prim(PRIM.ico, vary(mixc(C0.PALM_GREEN, C0.NIGHT_TOP, 0.12, c), rng, 0.22, c),
          x + Math.cos(a) * r, 5.4 + rng() * 1.8, z + Math.sin(a) * r,
          2.4 + rng() * 1.6, 1.9 + rng() * 1.2, 2.4 + rng() * 1.6, rng(), rng() * 3, rng());
      }
      coll(x - 1.5, z - 1.5, x + 1.5, z + 1.5, 1.8);
    }
    bake(trunks, W.MAT.flat, 'trunksAndFicus');
  }

  /* =========================================================================
     STREET FURNITURE — lamp posts (merged) + instanced heads (nightLights),
     concrete benches, bollards, municipal sign.
     ========================================================================= */
  function buildStreetFurniture() {
    const C0 = W.COL, rng = mulberry(6600), c = new T.Color();
    const m = new Mesher();

    /* ---- lamp posts ---- */
    const lampXs = [-120, -96, -78, -52, -36, -14, 12, 28, 46, 70, 94, 112];
    const headXf = [];
    for (let i = 0; i < lampXs.length; i++) {
      const x = lampXs[i], z = -5.0 + (rng() - 0.5) * 0.3, lean = (rng() - 0.5) * 0.03;
      m.box(vary(C0.CEMENT, rng, 0.1, c), x, 1.68, z, 0.8, 0.36, 0.8, 0, rng() * 0.3, 0, 1 / 6);
      m.prim(PRIM.cyl8, vary(C0.CEMENT, rng, 0.07, c), x, 1.95, z, 0.46, 0.3, 0.46, 0, 0, 0, 1 / 6);
      const H = 4.9;
      m.prim(PRIM.cyl8, vary(mixc(C0.CEMENT, C0.FOAM, 0.3, c), rng, 0.06, c),
        x + lean * H * 0.5, 2.1 + H * 0.5, z, 0.2, H, 0.2, 0, 0, lean);
      // gooseneck arm reaching over the railing
      const ty = 2.1 + H, tx = x + lean * H;
      m.rod(mixc(C0.CEMENT, C0.FOAM, 0.25, c), tx, ty, z, tx, ty + 0.5, z - 0.1, 0.17, PRIM.cyl6);
      m.rod(mixc(C0.CEMENT, C0.FOAM, 0.25, c), tx, ty + 0.5, z - 0.1, tx, ty + 0.72, z + 0.9, 0.16, PRIM.cyl6);
      m.box(shade(C0.CEMENT, -0.05, c), tx, ty + 0.66, z + 1.25, 0.52, 0.18, 0.9, 0.12, 0, 0);
      headXf.push(xf(tx, ty + 0.5, z + 1.3, 1, 1, 1, 0.12, (rng() - 0.5) * 0.06, 0));
      // a hand-lettered banner cable-tied to a few posts
      if (i % 4 === 1) {
        m.box(vary(C0.TERRACOTTA, rng, 0.12, c), x, 3.2, z + 0.12, 1.9, 0.9, 0.05, 0, 0, 0.02);
      }
      coll(x - 0.5, z - 0.5, x + 0.5, z + 0.5, 2.2);
    }
    const headGeo = new Mesher();
    headGeo.box(mixc(C0.SUN, C0.FOAM, 0.3, c), 0, 0, 0, 0.42, 0.2, 0.68);
    headGeo.box(mixc(C0.SUN, C0.FOAM, 0.15, c), 0, -0.1, 0, 0.3, 0.06, 0.5);
    const hg = headGeo.geo();
    const heads = instanced(hg, W.MAT.glowOff, headXf, null, 0.05, 'lampHeads');
    W.night.push(heads);

    /* ---- concrete benches (one merged geometry, instanced) ---- */
    const bm = new Mesher();
    bm.box(mixc(C0.CEMENT, C0.LIMESTONE, 0.4, c), 0, 0.42, 0, 1.9, 0.14, 0.52, 0, 0, 0, 1 / 4);
    bm.box(C0.CEMENT, -0.75, 0.21, 0, 0.3, 0.42, 0.48, 0, 0, 0, 1 / 4);
    bm.box(C0.CEMENT, 0.75, 0.21, 0, 0.3, 0.42, 0.48, 0, 0, 0, 1 / 4);
    bm.box(mixc(C0.CEMENT, C0.LIMESTONE, 0.3, c), 0, 0.68, -0.22, 1.9, 0.44, 0.12, 0.14, 0, 0, 1 / 4);
    const benchGeo = bm.geo();
    const bxf = [];
    for (let i = 0; i < 16; i++) {
      const x = -124 + i * 16.2 + (rng() - 0.5) * 3;
      if (Math.abs(x) < 9) continue;
      const z = -6.6 + (rng() - 0.5) * 1.2;
      bxf.push(xf(x, 1.5, z, 1, 1, 1, 0, (rng() - 0.5) * 0.12, 0));
      coll(x - 1.0, z - 0.4, x + 1.0, z + 0.4, 1.92);
    }
    instanced(benchGeo, W.MAT.pave, bxf, mixc(C0.CEMENT, C0.LIMESTONE, 0.35, new T.Color()), 0.12, 'benches');

    /* ---- bollards ---- */
    const dm = new Mesher();
    dm.prim(PRIM.cyl8, mixc(C0.LIMESTONE, C0.CEMENT, 0.3, c), 0, 0.33, 0, 0.42, 0.66, 0.42, 0, 0, 0, 1 / 3);
    dm.prim(PRIM.cyl8, C0.CEMENT, 0, 0.7, 0, 0.3, 0.1, 0.3, 0, 0, 0, 1 / 3);
    dm.box(mixc(C0.HAZARD, C0.LIMESTONE, 0.15, c), 0, 0.5, 0, 0.44, 0.16, 0.44, 0, 0, 0, 1 / 3);
    const bolGeo = dm.geo();
    const dxf = [];
    W.catPost = null;
    for (let i = 0; i < 22; i++) {
      const x = -126 + i * 11.6 + (rng() - 0.5) * 1.5;
      if (Math.abs(x) < 8) continue;
      const z = -3.9;
      dxf.push(xf(x, 1.5, z, 1, 1, 1, 0, rng() * 0.3, (rng() - 0.5) * 0.04));
      if (!W.catPost && x > 24) W.catPost = { x: x, y: 2.16, z: z };
    }
    instanced(bolGeo, W.MAT.pave, dxf, mixc(C0.LIMESTONE, C0.CEMENT, 0.3, new T.Color()), 0.14, 'bollards');

    /* ---- municipal sign + a smaller plate, bolted crooked ---- */
    const sx = 8.4, sz = -8.0;
    m.prim(PRIM.cyl8, C0.CEMENT, sx - 0.9, 2.5, sz, 0.14, 2.0, 0.14);
    m.prim(PRIM.cyl8, C0.CEMENT, sx + 0.9, 2.5, sz, 0.14, 2.0, 0.14);
    m.box(mixc(C0.RUST, C0.CEMENT, 0.4, c), sx, 3.44, sz + 0.06, 2.4, 0.1, 0.12);
    bake(m, W.MAT.flat, 'lampPostsAndSign');
    const signGeo = new T.PlaneGeometry(2.3, 1.15);
    W.geos.push(signGeo);
    const sign = new T.Mesh(signGeo, W.MAT.sign);
    sign.position.set(sx, 2.95, sz + 0.1);
    sign.rotation.z = 0.025;
    sign.name = 'sign';
    W.group.add(sign);
    coll(sx - 1.2, sz - 0.3, sx + 1.2, sz + 0.3, 2.0);
  }

  /* =========================================================================
     THE MUALLIM'S KIOSK (upgrade shop), the manakish/coffee cart, and the
     honest municipal clutter: chairs, dumpster, bollard litter, sandbags,
     rebar stubs out of unfinished concrete.
     ========================================================================= */
  function buildKioskAndCart() {
    const C0 = W.COL, rng = mulberry(7700), c = new T.Color();
    const m = new Mesher(), mg = new Mesher();

    /* ---- kiosk: a breeze-block shack with a corrugated roof ---- */
    const KX = 13.5, KZ = -13.0;
    const kiosk = { x: KX, y: 1.5, z: KZ + 2.6 };
    m.box(vary(C0.CEMENT, rng, 0.08, c), KX, 1.56, KZ, 5.6, 0.12, 4.6, 0, 0, 0, 1 / 6);
    for (let y = 1.62; y < 4.3; y += 0.45) {   // walls, laid in blocks
      const h = Math.min(0.45, 4.3 - y);
      for (let s = 0; s < 3; s++) {
        const bx = [[0, -2.1, 5.2, 0.4], [-2.4, 0, 0.4, 4.2], [2.4, 0, 0.4, 4.2]][s];
        vary(mixc(C0.LIMESTONE, C0.CEMENT, 0.35, c), rng, 0.1, c);
        if (y < 2.1) mixc(c, C0.STONE_WET, 0.18, c);
        m.box(c, KX + bx[0], y + h * 0.5, KZ + bx[1], bx[2], h * 1.02, bx[3], 0, 0, 0, 1 / 5);
      }
    }
    // counter opening toward the deck, with a stone shelf
    m.box(mixc(C0.LIMESTONE, C0.CEMENT, 0.2, c), KX, 2.42, KZ + 2.2, 5.2, 0.16, 0.7, 0, 0, 0, 1 / 5);
    m.box(vary(C0.LIMESTONE, rng, 0.08, c), KX, 3.9, KZ + 2.2, 5.2, 0.8, 0.5, 0, 0, 0, 1 / 5);
    // corrugated roof: ribs, slightly out of true
    for (let i = 0; i < 14; i++) {
      m.box(vary(mixc(C0.RUST, C0.CEMENT, 0.45, c), rng, 0.13, c),
        KX - 2.9 + i * 0.45, 4.42 + i * 0.012, KZ + 0.4, 0.3, 0.12, 6.0, 0.03, 0, 0.01);
    }
    // the muallim's stock: stacks of balata in the four tier colours
    for (let s = 0; s < 4; s++) {
      const tc = C(TIER_COLS[s]);
      for (let k = 0; k < 3 + ((rng() * 4) | 0); k++) {
        m.box(vary(tc, rng, 0.1, c), KX - 1.9 + s * 1.25, 2.6 + k * 0.17, KZ + 2.3,
          0.95, 0.16, 0.95, 0, (rng() - 0.5) * 0.25, 0);
      }
    }
    // cement sacks and a wheelbarrow leaning on the shack
    for (let k = 0; k < 5; k++) {
      m.box(vary(C0.CEMENT, rng, 0.1, c), KX + 3.5 + (k % 2) * 0.2, 1.65 + k * 0.28, KZ - 1.2 + (k % 3) * 0.4,
        1.05, 0.3, 0.68, 0, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.08, 1 / 2);
    }
    m.box(mixc(C0.HAZARD, C0.RUST, 0.3, c), KX - 3.7, 2.0, KZ + 0.6, 1.3, 0.5, 0.9, 0.25, 0.3, 0);
    m.prim(PRIM.torus, C0.NIGHT_TOP, KX - 3.7, 1.72, KZ + 1.3, 1.1, 1.1, 1.1, 0, 0.3, Math.PI * 0.5);
    mg.box(mixc(C0.SUN, C0.FOAM, 0.2, c), KX, 4.05, KZ + 1.9, 0.5, 0.26, 0.5);   // bare bulb
    coll(KX - 2.9, KZ - 2.4, KX + 2.9, KZ + 2.4, 4.4);

    /* ---- the coffee / manakish cart with a striped awning ---- */
    const CX = -30.5, CZ = -8.0;
    m.box(vary(mixc(C0.FOAM, C0.CEMENT, 0.25, c), rng, 0.07, c), CX, 2.12, CZ, 3.4, 1.1, 1.6, 0, 0.06, 0);
    m.box(mixc(C0.DENIM, C0.NIGHT_TOP, 0.25, c), CX, 2.72, CZ, 3.5, 0.12, 1.7, 0, 0.06, 0);
    m.box(shade(C0.RUST, -0.1, c), CX, 1.72, CZ, 3.2, 0.14, 1.4, 0, 0.06, 0);
    for (let s = -1; s <= 1; s += 2) {
      m.prim(PRIM.cyl8, C0.NIGHT_TOP, CX + s * 1.2, 1.78, CZ + 0.85, 0.58, 0.2, 0.58, 0, 0, Math.PI * 0.5);
      m.prim(PRIM.cyl8, C0.CEMENT, CX + s * 1.2, 1.78, CZ + 0.85, 0.26, 0.22, 0.26, 0, 0, Math.PI * 0.5);
    }
    // urn, cups, gas bottle, a stool
    m.prim(PRIM.cyl12, mixc(C0.SUN, C0.RUST, 0.35, c), CX - 1.1, 3.05, CZ, 0.56, 0.78, 0.56);
    m.prim(PRIM.cyl8, C0.CEMENT, CX - 1.1, 3.5, CZ, 0.2, 0.18, 0.2);
    for (let k = 0; k < 6; k++) {
      m.prim(PRIM.cyl6, C0.FOAM, CX + 0.2 + (k % 3) * 0.22, 2.84 + ((k / 3) | 0) * 0.12, CZ - 0.35, 0.16, 0.12, 0.16);
    }
    m.prim(PRIM.cyl8, mixc(C0.DENIM, C0.FOAM, 0.2, c), CX + 1.3, 2.15, CZ - 0.5, 0.52, 1.2, 0.52);
    m.box(mixc(C0.TERRACOTTA, C0.RUST, 0.4, c), CX + 2.3, 1.78, CZ + 0.4, 0.6, 0.56, 0.6, 0, 0.4, 0);
    // chimney (smoke spawns at its lip) + awning frame
    const chx = CX + 1.5, chy = 3.9, chz = CZ + 0.1;
    m.prim(PRIM.cyl6, mixc(C0.CEMENT, C0.NIGHT_TOP, 0.5, c), chx, 3.3, chz, 0.26, 1.2, 0.26, 0, 0, 0.05);
    for (let s = -1; s <= 1; s += 2) {
      for (let t = -1; t <= 1; t += 2) {
        m.prim(PRIM.cyl6, C0.CEMENT, CX + s * 1.7, 3.25, CZ + t * 1.1, 0.1, 3.5, 0.1, 0, 0, s * 0.015);
      }
    }
    coll(CX - 1.9, CZ - 1.2, CX + 1.9, CZ + 1.2, 2.7);
    W.cart = { x: CX, y: 1.5, z: CZ };

    const awnGeo = new T.PlaneGeometry(4.2, 2.6, 1, 1);
    W.geos.push(awnGeo);
    const awn = new T.Mesh(awnGeo, W.MAT.awning);
    awn.position.set(CX, 4.9, CZ + 0.05);
    awn.rotation.set(-Math.PI * 0.5 + 0.18, 0, 0.015);
    awn.name = 'awning';
    W.group.add(awn);
    // scalloped valance hanging off the seaward edge
    const vm = new Mesher();
    for (let i = 0; i < 10; i++) {
      vm.box(i % 2 ? C(TIER_COLS[2]) : C0.FOAM, CX - 1.9 + i * 0.42, 4.42, CZ + 1.32, 0.4, 0.4, 0.04);
    }
    bake(vm, W.MAT.flat, 'valance');

    /* ---- smoke drifting off the chimney ---- */
    const N = 24, pos = new Float32Array(N * 3);
    const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.BufferAttribute(pos, 3));
    sg.boundingSphere = new T.Sphere(new T.Vector3(chx, chy + 4, chz), 10);
    W.geos.push(sg);
    const pts = new T.Points(sg, W.MAT.smoke);
    pts.name = 'cartSmoke';
    pts.frustumCulled = false;
    W.group.add(pts);
    W.smoke = { pts: pts, arr: pos, n: N, x: chx, y: chy, z: chz, life: [] };
    for (let i = 0; i < N; i++) {
      W.smoke.life.push(rng());
      pos[i * 3] = chx; pos[i * 3 + 1] = chy; pos[i * 3 + 2] = chz;
    }

    bake(m, W.MAT.flat, 'kioskAndCart');
    const glow = bake(mg, W.MAT.glowOff, 'kioskBulb');
    if (glow) W.night.push(glow);
    return kiosk;
  }

  /* ---- a single chunky plastic chair, as a reusable merged geometry ------- */
  function chairMesher(m, col, x, y, z, ry, tilt) {
    const c = new T.Color();
    m.box(shade(col, 0.04, c), x, y + 0.44, z, 0.52, 0.06, 0.52, tilt || 0, ry, 0);
    m.box(col, x, y + 0.72, z - 0.24, 0.52, 0.56, 0.06, 0.1 + (tilt || 0), ry, 0);
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        m.box(shade(col, -0.07, c), x + sx * 0.21, y + 0.22, z + sz * 0.21, 0.06, 0.44, 0.06, 0, ry, 0);
      }
    }
  }

  function buildClutter() {
    const C0 = W.COL, rng = mulberry(8800), c = new T.Color();
    const m = new Mesher(), mr = new Mesher();
    const PLASTIC = [C(TIER_COLS[2]), C0.FOAM, C(TIER_COLS[0]), mixc(C0.TERRACOTTA, C0.SUN, 0.3, new T.Color())];

    /* ---- chairs wedged into the gaps where the railing is missing ---- */
    const gapChairs = [[-24.6, -2.9], [42.3, -3.0], [-70.4, -2.85], [90.5, -3.05], [113.6, -2.95]];
    for (let i = 0; i < gapChairs.length; i++) {
      if (i === 0) continue;                       // that gap is the uncle's spot
      chairMesher(m, PLASTIC[i % PLASTIC.length], gapChairs[i][0], 1.5, gapChairs[i][1],
        Math.PI + (rng() - 0.5) * 0.7, 0);
      coll(gapChairs[i][0] - 0.3, gapChairs[i][1] - 0.3, gapChairs[i][0] + 0.3, gapChairs[i][1] + 0.3, 1.95);
    }
    /* ---- stacked chairs by the cart ---- */
    for (let s = 0; s < 3; s++) {
      const bx = -34.5 - s * 0.9, bz = -11.0 + s * 0.5, col = PLASTIC[s % 4];
      for (let k = 0; k < 6; k++) {
        chairMesher(m, col, bx + k * 0.03, 1.5 + k * 0.13, bz + k * 0.02, 0.4 + s + k * 0.03, 0);
      }
      coll(bx - 0.4, bz - 0.4, bx + 0.4, bz + 0.4, 2.4);
    }

    /* ---- dumpster, dented, one lid up ---- */
    const DX = 58, DZ = -14.5;
    m.box(vary(mixc(C0.PALM_GREEN, C0.CEMENT, 0.35, c), rng, 0.08, c), DX, 2.25, DZ, 3.2, 1.5, 1.7, 0, 0.09, 0);
    m.box(shade(mixc(C0.PALM_GREEN, C0.CEMENT, 0.35, c), -0.1, c), DX, 3.04, DZ - 0.45, 3.2, 0.1, 0.8, 0, 0.09, 0);
    m.box(shade(mixc(C0.PALM_GREEN, C0.CEMENT, 0.35, c), -0.05, c), DX + 0.1, 3.5, DZ + 0.75, 3.1, 0.1, 0.8, -1.05, 0.09, 0);
    for (let s = -1; s <= 1; s += 2) {
      m.prim(PRIM.cyl8, C0.NIGHT_TOP, DX + s * 1.3, 1.68, DZ + 0.6, 0.36, 0.18, 0.36, 0, 0, Math.PI * 0.5);
    }
    for (let k = 0; k < 7; k++) {   // overflow
      m.box(vary(PLASTIC[k % 4], rng, 0.3, c), DX + (rng() - 0.5) * 3, 3.1 + rng() * 0.5, DZ + (rng() - 0.5) * 1.4,
        0.3 + rng() * 0.4, 0.25, 0.3 + rng() * 0.4, rng(), rng() * 3, rng());
    }
    coll(DX - 1.7, DZ - 0.9, DX + 1.7, DZ + 0.9, 3.0);

    /* ---- sandbags holding down something that no longer exists ---- */
    const bags = [[-56, -6.5], [72, -9.0]];
    for (let b = 0; b < bags.length; b++) {
      for (let k = 0; k < 7; k++) {
        const r = 0.5 + rng() * 0.55, a = rng() * TAU;
        mr.box(vary(mixc(C0.CEMENT, C0.LIMESTONE, 0.45, c), rng, 0.12, c),
          bags[b][0] + Math.cos(a) * r, 1.62 + ((k / 3) | 0) * 0.22, bags[b][1] + Math.sin(a) * r * 0.7,
          0.78, 0.24, 0.5, 0, rng() * TAU, (rng() - 0.5) * 0.1, 1 / 2);
      }
      coll(bags[b][0] - 0.9, bags[b][1] - 0.7, bags[b][0] + 0.9, bags[b][1] + 0.7, 1.95);
    }

    /* ---- unfinished concrete with rebar stubs: eternal, everywhere ---- */
    const rebar = [[-48, -26], [26, -28], [96, -24]];
    for (let r = 0; r < rebar.length; r++) {
      const x = rebar[r][0], z = rebar[r][1];
      mr.box(vary(C0.CEMENT, rng, 0.1, c), x, 1.68, z, 4.4, 0.36, 3.2, 0, (rng() - 0.5) * 0.2, 0, 1 / 3);
      mr.box(vary(C0.CEMENT, rng, 0.12, c), x + 1.0, 2.0, z - 0.6, 2.2, 0.3, 1.8, 0, 0.1, 0.02, 1 / 3);
      for (let k = 0; k < 9; k++) {
        const bx = x - 1.9 + rng() * 3.8, bz = z - 1.4 + rng() * 2.8;
        const h = 0.5 + rng() * 1.1;
        m.rod(vary(C0.RUST, rng, 0.2, c), bx, 1.85, bz,
          bx + (rng() - 0.5) * 0.4, 1.85 + h, bz + (rng() - 0.5) * 0.4, 0.035, PRIM.cyl6);
      }
      coll(x - 2.2, z - 1.6, x + 2.2, z + 1.6, 2.05);
    }

    /* ---- litter: bags, bottles, a lost slipper, cigarette ends ---- */
    for (let i = 0; i < 90; i++) {
      const x = -128 + rng() * 256, z = -33 + rng() * 29.5;
      if (Math.abs(x) < 7 && z > -5) continue;
      const k = rng();
      if (k < 0.3) {       // crumpled bag
        m.box(vary(k < 0.15 ? C0.FOAM : PLASTIC[2], rng, 0.25, c), x, 1.57, z,
          0.3 + rng() * 0.35, 0.12, 0.3 + rng() * 0.3, rng() * 0.4, rng() * TAU, rng() * 0.4);
      } else if (k < 0.55) {  // bottle on its side
        m.prim(PRIM.cyl6, vary(mixc(C0.SEA_SHALLOW, C0.FOAM, 0.4, c), rng, 0.2, c),
          x, 1.56, z, 0.14, 0.42, 0.14, Math.PI * 0.5, rng() * TAU, 0);
      } else if (k < 0.72) {  // cola can, sun-bleached
        m.prim(PRIM.cyl6, vary(C0.TERRACOTTA, rng, 0.2, c), x, 1.56, z, 0.12, 0.26, 0.12,
          rng() < 0.5 ? Math.PI * 0.5 : 0, rng() * TAU, 0);
      } else if (k < 0.8) {   // a single slipper
        m.box(vary(C(TIER_COLS[2]), rng, 0.2, c), x, 1.53, z, 0.3, 0.06, 0.13, 0, rng() * TAU, 0);
      } else {                // sunflower seeds and cigarette ends
        for (let q = 0; q < 6; q++) {
          m.box(vary(C0.FOAM, rng, 0.2, c), x + (rng() - 0.5) * 0.7, 1.515, z + (rng() - 0.5) * 0.7,
            0.07, 0.03, 0.03, 0, rng() * TAU, 0);
        }
      }
    }
    // worn, swept patch of ground where the uncle always stands
    m.box(mixc(C0.CEMENT, C0.STONE_DARK, 0.4, c), -11, 1.506, -3.6, 2.4, 0.01, 1.6, 0, 0.08, 0);

    bake(m, W.MAT.flat, 'clutter');
    bake(mr, W.MAT.rough, 'concreteAndBags');
  }

  /* =========================================================================
     RESOURCE PILES — sand, gravel, stacked cement sacks.  A short walk from
     the stair head so the first balata is quick to get to.
     ========================================================================= */
  function buildSandPiles() {
    const C0 = W.COL, rng = mulberry(9900), c = new T.Color();
    const m = new Mesher();
    const piles = [
      { x: -10.5, y: 1.5, z: -9.0, kind: 'sand' },
      { x: 11.5, y: 1.5, z: -9.5, kind: 'gravel' },
      { x: -17.0, y: 1.5, z: -15.5, kind: 'cement' },
      { x: 18.5, y: 1.5, z: -17.0, kind: 'sand' },
      { x: -22.5, y: 1.5, z: -7.5, kind: 'gravel' }
    ];
    for (let i = 0; i < piles.length; i++) {
      const p = piles[i];
      const base = p.kind === 'sand' ? C(TIER_COLS[0])
        : p.kind === 'gravel' ? mixc(C0.CEMENT, C0.STONE_DARK, 0.4, new T.Color())
          : C0.CEMENT;
      if (p.kind === 'cement') {
        // stacked sacks, one burst and spilling
        for (let k = 0; k < 11; k++) {
          const row = (k / 4) | 0, idx = k % 4;
          m.box(vary(base, rng, 0.1, c), p.x - 0.75 + idx * 0.52 + row * 0.1, p.y + 0.17 + row * 0.33,
            p.z + (rng() - 0.5) * 0.25, 1.1, 0.34, 0.66,
            0, (rng() - 0.5) * 0.35, (rng() - 0.5) * 0.07, 1 / 2);
        }
        m.box(vary(base, rng, 0.08, c), p.x + 1.1, p.y + 0.14, p.z + 0.7, 1.05, 0.28, 0.64, 0.1, 0.8, 0.3, 1 / 2);
        for (let k = 0; k < 14; k++) {   // spilled powder
          m.box(vary(shade(base, 0.08, c), rng, 0.08, c), p.x + 1.1 + (rng() - 0.5) * 2.2, p.y + 0.02,
            p.z + 0.9 + (rng() - 0.5) * 1.6, 0.3 + rng() * 0.5, 0.04, 0.3 + rng() * 0.5, 0, rng() * 3, 0, 1 / 2);
        }
        coll(p.x - 1.2, p.z - 0.6, p.x + 1.8, p.z + 1.1, 2.6);
      } else {
        // a chunky cone of aggregate: stacked shrinking slabs + a capping cone
        const R = p.kind === 'sand' ? 2.1 : 1.8;
        const H = p.kind === 'sand' ? 1.5 : 1.2;
        const layers = 5;
        for (let k = 0; k < layers; k++) {
          const t = k / layers, r = R * (1 - t * 0.78);
          vary(base, rng, 0.1, c);
          m.prim(PRIM.cyl8, c, p.x, p.y + t * H + 0.08, p.z, r * 2, H / layers + 0.1, r * 2,
            0, rng() * TAU, 0, 1 / 2);
        }
        m.prim(PRIM.cone8, vary(base, rng, 0.08, c), p.x, p.y + H + 0.18, p.z, R * 0.52, 0.5, R * 0.52,
          0, rng() * TAU, 0, 1 / 2);
        // scatter at the toe of the pile
        for (let k = 0; k < 16; k++) {
          const a = rng() * TAU, r = R * (1 + rng() * 0.5);
          m.box(vary(base, rng, 0.14, c), p.x + Math.cos(a) * r, p.y + 0.05, p.z + Math.sin(a) * r * 0.9,
            0.2 + rng() * 0.4, 0.1, 0.2 + rng() * 0.4, 0, rng() * TAU, 0, 1 / 2);
        }
        coll(p.x - R, p.z - R, p.x + R, p.z + R, p.y + H * 0.6);
      }
    }
    bake(m, W.MAT.rough, 'sandPiles');
    // a shovel left standing in the first pile, and a bucket
    const mf = new Mesher();
    mf.rod(C0.TRUNK, -9.6, 1.6, -8.4, -10.3, 3.5, -9.1, 0.07, PRIM.cyl6);
    mf.box(mixc(C0.CEMENT, C0.FOAM, 0.3, c), -9.45, 1.72, -8.25, 0.4, 0.5, 0.1, 0.35, 0.6, 0.2);
    mf.prim(PRIM.cyl8, C(TIER_COLS[2]), 13.2, 1.68, -10.4, 0.62, 0.42, 0.62, 0, 0, 0.06);
    mf.prim(PRIM.torus, shade(C(TIER_COLS[2]), -0.1, c), 13.2, 1.92, -10.4, 1.3, 1.3, 1.0, 0.2, 0, 0);
    bake(mf, W.MAT.flat, 'tools');
    return piles;
  }

  /* =========================================================================
     THE FISHING UNCLE (plastic chair, rod over the missing railing) and
     a cat asleep on a bollard.
     ========================================================================= */
  function buildFisherman() {
    const C0 = W.COL, rng = mulberry(1212), c = new T.Color();
    const g = new T.Group();
    g.position.set(-24.6, 1.5, -3.15);
    const m = new Mesher();
    chairMesher(m, C(TIER_COLS[2]), 0, 0, 0, Math.PI + 0.12, 0.05);
    // him: legs out, belly, short-sleeve shirt, flat cap, slippers
    m.box(C0.DENIM, -0.12, 0.48, 0.34, 0.2, 0.2, 0.78, 0.22, 0, 0);
    m.box(C0.DENIM, 0.14, 0.48, 0.34, 0.2, 0.2, 0.78, 0.22, 0, 0);
    m.box(shade(C0.DENIM, -0.12, c), -0.12, 0.3, 0.72, 0.19, 0.4, 0.19, 0, 0, 0);
    m.box(shade(C0.DENIM, -0.12, c), 0.14, 0.3, 0.72, 0.19, 0.4, 0.19, 0, 0, 0);
    m.box(mixc(C0.TERRACOTTA, C0.NIGHT_TOP, 0.3, c), -0.12, 0.09, 0.78, 0.22, 0.08, 0.3);
    m.box(mixc(C0.TERRACOTTA, C0.NIGHT_TOP, 0.3, c), 0.14, 0.09, 0.78, 0.22, 0.08, 0.3);
    m.box(C0.SHIRT, 0, 0.82, 0.12, 0.56, 0.62, 0.42, -0.1, 0, 0);
    m.box(vary(C0.SHIRT, rng, 0.07, c), 0, 0.72, 0.3, 0.5, 0.4, 0.2, -0.1, 0, 0);  // the belly
    m.box(C0.SKIN, 0, 1.22, 0.07, 0.3, 0.3, 0.3, 0, 0.1, 0);
    m.box(shade(C0.SKIN, -0.05, c), 0, 1.07, 0.07, 0.22, 0.14, 0.22);
    m.box(mixc(C0.CEMENT, C0.FOAM, 0.4, c), 0, 1.4, 0.05, 0.36, 0.12, 0.36, 0.04, 0.1, 0);
    m.box(mixc(C0.CEMENT, C0.FOAM, 0.4, c), 0, 1.36, -0.12, 0.3, 0.06, 0.18, 0.1, 0.1, 0);
    m.box(C0.SKIN, 0.3, 0.95, 0.26, 0.15, 0.15, 0.52, 0.5, 0, 0);     // casting arm
    m.box(C0.SKIN, -0.3, 0.88, 0.2, 0.15, 0.15, 0.4, 0.25, 0, 0);
    // bait bucket and a thermos of coffee
    m.prim(PRIM.cyl8, C(TIER_COLS[0]), 0.72, 0.18, 0.5, 0.56, 0.36, 0.56);
    m.prim(PRIM.cyl6, mixc(C0.RUST, C0.CEMENT, 0.3, c), -0.7, 0.14, 0.45, 0.22, 0.28, 0.22);
    g.add(bake(m, W.MAT.flat, 'uncleBody'));

    // the rod is its own child so it can twitch
    const rm = new Mesher();
    rm.rod(mixc(C0.TRUNK, C0.NIGHT_TOP, 0.2, c), 0, 0, 0, 0, 0.5, 3.6, 0.035, PRIM.cyl6);
    rm.rod(C0.FOAM, 0, 0.5, 3.6, 0, -1.9, 4.3, 0.012, PRIM.cyl6);      // line to the water
    rm.prim(PRIM.cyl8, mixc(C0.RUST, C0.CEMENT, 0.4, c), 0, 0.06, 0.45, 0.22, 0.14, 0.22, 0, 0, Math.PI * 0.5);
    const rod = bake(rm, W.MAT.flat, 'rod');
    rod.position.set(0.34, 0.95, 0.3);
    g.add(rod);
    W.group.add(g);
    W.uncle = { group: g, rod: rod, phase: rng() * TAU };
    coll(-25.2, -3.7, -24.0, -2.6, 1.95);

    /* ---- the cat ---- */
    if (W.catPost) {
      const cm = new Mesher();
      const fur = mixc(C0.LIMESTONE, C0.TRUNK, 0.35, new T.Color());
      cm.box(fur, 0, 0.14, 0, 0.58, 0.26, 0.3, 0, 0, 0);
      cm.box(vary(fur, rng, 0.12, c), -0.1, 0.2, 0.02, 0.3, 0.2, 0.26, 0, 0, 0);
      cm.box(shade(fur, 0.05, c), 0.33, 0.17, 0, 0.22, 0.2, 0.22, 0, 0.2, 0);  // head, tucked
      cm.box(shade(fur, -0.1, c), 0.33, 0.29, -0.07, 0.07, 0.1, 0.07, 0, 0, -0.3);
      cm.box(shade(fur, -0.1, c), 0.33, 0.29, 0.07, 0.07, 0.1, 0.07, 0, 0, 0.3);
      // tail curled around itself
      for (let k = 0; k < 5; k++) {
        const a = -0.4 + k * 0.8;
        cm.box(vary(fur, rng, 0.1, c), -0.3 - Math.cos(a) * 0.14, 0.1, Math.sin(a) * 0.22,
          0.14, 0.1, 0.14, 0, a, 0);
      }
      const cat = bake(cm, W.MAT.flat, 'cat');
      cat.position.set(W.catPost.x, W.catPost.y, W.catPost.z);
      cat.rotation.y = -0.6;
      W.cat = cat;
    }
  }

  /* =========================================================================
     BOATS — chunky toy hulls.  One geometry per flavour, reused.
     ========================================================================= */
  function boatGeo(seed, len, beam, hullHex, trimHex, cabin) {
    const C0 = W.COL, rng = mulberry(seed), m = new Mesher(), c = new T.Color();
    const hull = C(hullHex), trim = C(trimHex);
    const segs = 9;
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1), z = (t - 0.5) * len;
      const w = beam * (0.4 + 0.6 * Math.sin(Math.PI * Math.pow(t, 0.72)));
      const rise = Math.pow(Math.abs(t - 0.4) * 2, 2.3) * 0.5;
      vary(hull, rng, 0.07, c);
      m.box(c, 0, -0.16 + rise * 0.45, z, w, 0.92 + rise, (len / segs) * 1.06, 0, 0, 0);
      // gunwale / rubbing strake in the trim colour
      m.box(trim, 0, 0.26 + rise * 0.9, z, w + 0.1, 0.14, (len / segs) * 1.06);
      if (i > 1 && i < segs - 2) {
        m.box(shade(hull, -0.22, c), 0, 0.18, z, w - 0.26, 0.1, (len / segs) * 1.02);  // sole
      }
    }
    // waterline stripe + a bit of weed
    m.box(mixc(C0.STONE_WET, C0.PALM_GREEN, 0.3, c), 0, -0.58, 0, beam * 0.96, 0.18, len * 0.82);
    if (cabin) {
      m.box(vary(C0.FOAM, rng, 0.06, c), 0, 0.72, -len * 0.22, beam * 0.72, 0.86, len * 0.22);
      m.box(mixc(C0.SEA_DEEP, C0.NIGHT_TOP, 0.3, c), 0, 0.86, -len * 0.11, beam * 0.6, 0.38, 0.06);
      m.box(trim, 0, 1.17, -len * 0.22, beam * 0.8, 0.1, len * 0.26);
      m.rod(C0.CEMENT, 0, 1.2, -len * 0.22, 0, 3.0, -len * 0.26, 0.055, PRIM.cyl6);
      m.prim(PRIM.sph, mixc(C0.SUN, C0.TERRACOTTA, 0.3, c), 0, 3.1, -len * 0.26, 0.22);
      m.box(mixc(C0.RUST, C0.NIGHT_TOP, 0.3, c), 0, 0.1, -len * 0.47, 0.42, 0.6, 0.5);  // outboard
    }
    // tyre fenders over the side
    for (let s = -1; s <= 1; s += 2) {
      for (let k = 0; k < 2; k++) {
        m.prim(PRIM.torus, mixc(C0.NIGHT_TOP, C0.CEMENT, 0.18, c),
          s * beam * 0.5, 0.05, (k - 0.5) * len * 0.3, 0.8, 0.8, 0.8, 0, s > 0 ? 0 : Math.PI, Math.PI * 0.5);
      }
    }
    // nets and crates in the stern
    for (let k = 0; k < 4; k++) {
      m.box(vary(mixc(C0.PALM_GREEN, C0.SUN, 0.3, c), rng, 0.25, c),
        (rng() - 0.5) * beam * 0.5, 0.32 + rng() * 0.2, len * (0.18 + rng() * 0.2),
        0.5, 0.22, 0.5, rng() * 0.4, rng() * 3, rng() * 0.3);
    }
    m.box(C(TIER_COLS[2]), beam * 0.2, 0.36, len * 0.3, 0.52, 0.3, 0.42, 0, 0.3, 0);
    const g = m.geo();
    W.geos.push(g);
    return g;
  }

  function buildBoats() {
    const C0 = W.COL, c = new T.Color();
    // moored in the castle's lee, hugging the islet (inside the islet exception)
    const g1 = boatGeo(2101, 6.4, 2.2, '#EDF6F3', '#2E7FA8', true);
    const g2 = boatGeo(2102, 5.2, 1.9, '#CDBD92', '#B9502F', false);
    const spots = [
      { geo: g1, x: -73.5, z: 17.0, ry: 0.5, amp: 1.0 },
      { geo: g2, x: -99.0, z: 22.0, ry: -1.1, amp: 1.0 },
      { geo: g2, x: -95.0, z: 33.5, ry: 2.3, amp: 0.9 },
      { geo: g1, x: -78.0, z: 41.0, ry: -2.6, amp: 1.0 }
    ];
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const mesh = new T.Mesh(s.geo, W.MAT.flat);
      mesh.position.set(s.x, 0, s.z);
      mesh.rotation.y = s.ry;
      mesh.name = 'boat' + i;
      mesh.castShadow = true;
      W.group.add(mesh);
      W.floaters.push({ mesh: mesh, x: s.x, z: s.z, ry: s.ry, amp: s.amp, span: 2.6, phase: i * 1.7 });
    }
    // the banana-yellow jet ski, tied up at the foot of the stairs
    const jm = new Mesher();
    const yellow = mixc(C0.SUN, C0.HAZARD, 0.4, new T.Color());
    jm.box(yellow, 0, -0.05, 0, 1.0, 0.5, 2.5);
    jm.box(shade(yellow, 0.06, c), 0, 0.2, 0.2, 0.9, 0.3, 2.0, 0.04, 0, 0);
    jm.box(yellow, 0, 0.1, 1.42, 0.55, 0.35, 0.7, 0.22, 0, 0);
    jm.box(mixc(C0.NIGHT_TOP, C0.DENIM, 0.3, c), 0, 0.37, -0.35, 0.62, 0.22, 1.1, -0.04, 0, 0);
    jm.box(C0.TERRACOTTA, 0, 0.32, 0.65, 0.5, 0.26, 0.6, 0.1, 0, 0);
    jm.box(mixc(C0.FOAM, C0.CEMENT, 0.2, c), 0, 0.52, 0.95, 0.72, 0.1, 0.16, 0.1, 0, 0);
    jm.box(shade(yellow, -0.2, c), 0, -0.3, -1.0, 0.5, 0.3, 0.5);
    jm.box(mixc(C0.NIGHT_TOP, C0.SEA_DEEP, 0.3, c), 0, -0.02, 1.05, 1.02, 0.12, 0.9, 0.05, 0, 0);
    const jg = jm.geo();
    W.geos.push(jg);
    const jet = new T.Mesh(jg, W.MAT.flat);
    jet.position.set(12.2, 0, 1.1);
    jet.rotation.y = 1.25;
    jet.name = 'jetski';
    W.group.add(jet);
    W.floaters.push({ mesh: jet, x: 12.2, z: 1.1, ry: 1.25, amp: 1.5, span: 1.2, phase: 4.1 });
  }

  /* =========================================================================
     SEAGULLS — one InstancedMesh.  Fliers follow lazy noise-driven loops;
     wingspan scale fakes the flap.  A few are perched on the mole and rail.
     ========================================================================= */
  function buildGulls() {
    const C0 = W.COL, rng = mulberry(4747), m = new Mesher(), c = new T.Color();
    const white = mixc(C0.FOAM, C0.CEMENT, 0.12, new T.Color());
    m.box(white, 0, 0, 0, 0.3, 0.28, 1.0);                       // body, +Z forward
    m.box(white, 0, 0.1, 0.52, 0.22, 0.22, 0.26);                // head
    m.box(mixc(C0.SUN, C0.TERRACOTTA, 0.25, c), 0, 0.08, 0.72, 0.08, 0.08, 0.22);
    m.box(mixc(C0.CEMENT, C0.NIGHT_TOP, 0.35, c), 0, 0.12, -0.42, 0.26, 0.06, 0.4);  // tail
    const A = new T.Vector3(), B = new T.Vector3(), D = new T.Vector3(), E = new T.Vector3();
    for (let s = -1; s <= 1; s += 2) {
      A.set(s * 0.12, 0.08, 0.2); B.set(s * 0.95, 0.2, 0.0);
      D.set(s * 1.05, 0.18, -0.4); E.set(s * 0.12, 0.08, -0.26);
      if (s > 0) m.quad(white, A, B, D, E); else m.quad(white, E, D, B, A);
      A.set(s * 0.95, 0.2, 0.0); B.set(s * 1.42, 0.16, -0.18);
      D.set(s * 1.4, 0.15, -0.46); E.set(s * 1.05, 0.18, -0.4);
      const tip = mixc(C0.CEMENT, C0.NIGHT_TOP, 0.45, c);
      if (s > 0) m.quad(tip, A, B, D, E); else m.quad(tip, E, D, B, A);
    }
    const geo = m.geo();
    const N = 22, xs = [];
    W.gulls = [];
    for (let i = 0; i < N; i++) xs.push(xf(0, -500, 0));   // parked until update()
    const im = instanced(geo, W.MAT.flat, xs, white, 0.07, 'gulls');
    im.frustumCulled = false;
    for (let i = 0; i < N; i++) {
      if (i < W.perches.length) {
        const p = W.perches[i];
        W.gulls.push({ perched: true, x: p.x, y: p.y, z: p.z, ry: p.ry, phase: rng() * TAU });
      } else if (i < W.perches.length + 3) {
        // one on the railing, one on a lamp, one on the dumpster lid
        const spots = [[-52, 2.82, -2.72, 0.2], [28.4, 7.5, -3.7, 2.4], [58, 3.6, -14.5, -1.0]];
        const s = spots[i - W.perches.length];
        W.gulls.push({ perched: true, x: s[0], y: s[1], z: s[2], ry: s[3], phase: rng() * TAU });
      } else {
        W.gulls.push({
          perched: false,
          cx: (rng() - 0.5) * 150, cz: 20 + rng() * 90,
          rx: 14 + rng() * 34, rz: 10 + rng() * 26,
          y: 9 + rng() * 22, sp: (0.07 + rng() * 0.1) * (rng() < 0.5 ? -1 : 1),
          ph: rng() * TAU, flap: 2.2 + rng() * 2.4, drift: rng() * 10
        });
      }
    }
    W.gullMesh = im;
  }

  /* =========================================================================
     CITY BACKDROP (z < -34, decorative).  Stacked flat-roofed blocks in
     bleached ochre and white, red-tiled older houses with the triple-arch
     window motif, balconies, tanks, dishes, a minaret and a bell tower,
     laundry, cranes.  Two merged meshes + one glow mesh.
     ========================================================================= */
  function buildCity() {
    const C0 = W.COL, rng = mulberry(3131), c = new T.Color();
    const m = new Mesher(), mw = new Mesher(), mf = new Mesher();
    const mk = new Mesher();          // the two stone landmarks, in masonry
    const GROUND = 9.4;
    const wallCols = [
      mixc(C0.LIMESTONE, C0.FOAM, 0.45, new T.Color()),
      mixc(C0.LIMESTONE, C0.SUN, 0.14, new T.Color()),
      mixc(C0.FOAM, C0.CEMENT, 0.25, new T.Color()),
      mixc(C0.LIMESTONE, C0.TERRACOTTA, 0.1, new T.Color())
    ];
    const winCol = mixc(C0.SUN, C0.FOAM, 0.2, new T.Color());

    // the plateau the city stands on
    m.box(mixc(C0.LIMESTONE, C0.STONE_DARK, 0.3, c), 0, GROUND - 1.5, -78, 400, 3, 92, 0, 0, 0, 1 / 8);

    const rows = [
      { z: -45, n: 13, h: [9, 17], det: 2 },
      { z: -60, n: 12, h: [12, 23], det: 2 },
      { z: -76, n: 11, h: [14, 27], det: 1 },
      { z: -94, n: 10, h: [16, 30], det: 0 },
      { z: -112, n: 9, h: [18, 34], det: 0 }
    ];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.n; i++) {
        const x = -165 + (i + rng() * 0.5) * (330 / row.n);
        const z = row.z + (rng() - 0.5) * 7;
        const w = 11 + rng() * 11, d = 10 + rng() * 9;
        const H = row.h[0] + rng() * (row.h[1] - row.h[0]);
        const old = rng() < 0.26;                      // older terracotta house
        const base = wallCols[(rng() * wallCols.length) | 0];
        const floors = Math.max(2, Math.round((old ? H * 0.7 : H) / 3.1));
        let y = GROUND;
        // stacked storeys, each slightly inset / offset — the real skyline
        for (let f = 0; f < floors; f++) {
          const fh = (old ? H * 0.7 : H) / floors;
          const inset = f === 0 ? 0 : rng() * 0.5;
          vary(base, rng, 0.1, c);
          // contact darkening on the lowest storey
          if (f === 0) mixc(c, C0.STONE_DARK, 0.14, c);
          m.box(c, x + (rng() - 0.5) * 0.6, y + fh * 0.5, z, w - inset, fh * 1.02, d - inset,
            0, (rng() - 0.5) * 0.04, 0, 1 / 8);
          // windows on the seaward face
          const cols = Math.max(2, Math.round(w / 3.4));
          for (let q = 0; q < cols; q++) {
            if (rng() < 0.12) continue;
            const wx = x - w * 0.42 + (q + 0.5) * (w * 0.84 / cols);
            mw.box(winCol, wx, y + fh * 0.55, z + d * 0.5 + 0.08, 1.05, 1.5, 0.12);
          }
          // balconies with chunky balusters
          if (row.det >= 1 && f > 0 && rng() < 0.72) {
            const bw = w * (0.4 + rng() * 0.45);
            vary(mixc(base, C0.CEMENT, 0.3, c), rng, 0.08, c);
            m.box(c, x + (rng() - 0.5) * 2, y + 0.18, z + d * 0.5 + 0.7, bw, 0.22, 1.5, 0, 0, 0, 1 / 6);
            const nb = Math.max(3, Math.round(bw / 0.7));
            for (let q = 0; q < nb; q++) {
              mf.box(mixc(C0.FOAM, C0.CEMENT, 0.3, c),
                x + (rng() - 0.5) * 2 - bw * 0.5 + (q + 0.5) * (bw / nb), y + 0.62, z + d * 0.5 + 1.38,
                0.14, 0.66, 0.14);
            }
            mf.box(mixc(C0.RUST, C0.CEMENT, 0.4, c), x, y + 0.98, z + d * 0.5 + 1.38, bw, 0.1, 0.16);
          }
          y += fh;
        }
        if (old) {
          // the classic Lebanese triple-arched central window
          const ty = GROUND + H * 0.7 * 0.55, fz = z + d * 0.5 + 0.1;
          for (let q = -1; q <= 1; q++) {
            const aw = q === 0 ? 1.5 : 1.2, ah = q === 0 ? 3.0 : 2.4;
            mw.box(winCol, x + q * 1.9, ty, fz, aw, ah, 0.14);
            mw.prim(PRIM.cyl8, winCol, x + q * 1.9, ty + ah * 0.5, fz, aw, 0.14, aw,
              Math.PI * 0.5, 0, 0);
            mf.box(mixc(C0.FOAM, C0.LIMESTONE, 0.3, c), x + q * 1.9, ty, fz + 0.06, aw + 0.3, ah, 0.1);
            mf.prim(PRIM.cyl8, mixc(C0.FOAM, C0.LIMESTONE, 0.3, c), x + q * 1.9, ty + ah * 0.5, fz + 0.06,
              aw + 0.3, 0.1, aw + 0.3, Math.PI * 0.5, 0, 0);
          }
          // hipped terracotta roof
          const rh = 2.6 + rng() * 1.6;
          m.prim(PRIM.pyr4, vary(C0.TERRACOTTA, rng, 0.11, c), x, GROUND + H * 0.7 + rh * 0.5, z,
            Math.max(w, d) * 1.08, rh, Math.max(w, d) * 1.08, 0, Math.PI * 0.25, 0, 1 / 4);
        } else {
          // flat roof: parapet, water tanks, dishes, a forest of antennas
          const top = GROUND + H;
          m.box(vary(shade(base, 0.04, c), rng, 0.06, c), x, top + 0.3, z, w + 0.2, 0.6, d + 0.2, 0, 0, 0, 1 / 8);
          m.box(mixc(base, C0.CEMENT, 0.4, c), x, top + 0.05, z, w - 0.6, 0.2, d - 0.6, 0, 0, 0, 1 / 8);
          const nt = 1 + ((rng() * 3) | 0);
          for (let q = 0; q < nt; q++) {
            const tx = x + (rng() - 0.5) * (w - 3), tz = z + (rng() - 0.5) * (d - 3);
            mf.prim(PRIM.cyl8, rng() < 0.6 ? mixc(C0.NIGHT_TOP, C0.DENIM, 0.3, c) : C0.FOAM,
              tx, top + 1.1, tz, 1.5, 1.5, 1.5, 0, rng() * 3, 0);
            mf.box(mixc(C0.CEMENT, C0.RUST, 0.3, c), tx, top + 0.42, tz, 1.7, 0.2, 1.7);
          }
          if (rng() < 0.8) {   // satellite dishes, all pointing the same way
            for (let q = 0; q < 1 + ((rng() * 3) | 0); q++) {
              const dx2 = x + (rng() - 0.5) * (w - 2), dz2 = z + (rng() - 0.5) * (d - 2);
              mf.prim(PRIM.disc, mixc(C0.FOAM, C0.CEMENT, 0.2, c), dx2, top + 1.3, dz2,
                1.5, 1.5, 1.5, -0.9, 0.15, 0);
              mf.rod(C0.CEMENT, dx2, top + 0.6, dz2, dx2, top + 1.3, dz2, 0.08, PRIM.cyl6);
            }
          }
          for (let q = 0; q < 2; q++) {
            mf.rod(mixc(C0.CEMENT, C0.RUST, 0.35, c), x + (rng() - 0.5) * w, top + 0.6, z + (rng() - 0.5) * d,
              x + (rng() - 0.5) * w, top + 2.6 + rng() * 2.5, z + (rng() - 0.5) * d, 0.05, PRIM.cyl6);
          }
          // laundry strung across the roof
          if (row.det >= 1 && rng() < 0.65) {
            const lx1 = x - w * 0.35, lx2 = x + w * 0.35, ly = top + 1.5, lz = z + (rng() - 0.5) * 3;
            mf.rod(C0.CEMENT, lx1, ly, lz, lx2, ly, lz, 0.025, PRIM.cyl6);
            const nl = 4 + ((rng() * 4) | 0);
            for (let q = 0; q < nl; q++) {
              const t = (q + 0.5) / nl;
              const cl = [C0.FOAM, C(TIER_COLS[2]), C0.TERRACOTTA, C0.DENIM, C0.SUN][(rng() * 5) | 0];
              mf.box(vary(cl, rng, 0.18, c), lerp(lx1, lx2, t), ly - 0.55, lz,
                0.75, 1.0, 0.04, 0, 0, (rng() - 0.5) * 0.1);
            }
          }
        }
      }
    }

    /* --- minaret and church bell tower, side by side as they really are ---- */
    const MX = -58, MZ = -56;
    m.box(mixc(C0.LIMESTONE, C0.FOAM, 0.3, c), MX, GROUND + 7, MZ, 7, 14, 7, 0, 0, 0, 1 / 6);
    m.prim(PRIM.cyl8, mixc(C0.LIMESTONE, C0.FOAM, 0.35, c), MX, GROUND + 26, MZ, 4.4, 24, 4.4, 0, 0, 0, 1 / 6);
    m.prim(PRIM.cyl8, mixc(C0.LIMESTONE, C0.CEMENT, 0.2, c), MX, GROUND + 38, MZ, 6.4, 1.0, 6.4, 0, 0, 0, 1 / 6);
    for (let q = 0; q < 8; q++) {
      const a = (q / 8) * TAU;
      mf.box(mixc(C0.FOAM, C0.CEMENT, 0.2, c), MX + Math.cos(a) * 2.8, GROUND + 39.4, MZ + Math.sin(a) * 2.8,
        0.9, 1.6, 0.3, 0, -a, 0);
      mw.box(winCol, MX + Math.cos(a) * 2.1, GROUND + 33, MZ + Math.sin(a) * 2.1, 0.7, 2.2, 0.2, 0, -a, 0);
    }
    m.prim(PRIM.cyl8, mixc(C0.LIMESTONE, C0.FOAM, 0.35, c), MX, GROUND + 44, MZ, 3.6, 8, 3.6, 0, 0, 0, 1 / 6);
    m.prim(PRIM.cone8, mixc(C0.PALM_GREEN, C0.SEA_DEEP, 0.25, c), MX, GROUND + 51, MZ, 4.6, 6, 4.6);
    mf.prim(PRIM.torus, C0.SUN, MX, GROUND + 55.5, MZ, 1.6, 1.6, 1.0, 0, 0, 0.3);
    const CHX = -44, CHZ = -58;
    m.box(mixc(C0.LIMESTONE, C0.FOAM, 0.25, c), CHX, GROUND + 7, CHZ, 16, 14, 11, 0, 0, 0, 1 / 6);
    m.prim(PRIM.pyr4, vary(C0.TERRACOTTA, rng, 0.08, c), CHX, GROUND + 16.5, CHZ, 18, 5, 13, 0, Math.PI * 0.25, 0, 1 / 4);
    m.box(mixc(C0.LIMESTONE, C0.FOAM, 0.3, c), CHX + 9, GROUND + 13, CHZ + 1, 6.5, 26, 6.5, 0, 0, 0, 1 / 6);
    for (let s = 0; s < 4; s++) {
      const a = (s / 4) * TAU + 0.78;
      mf.box(mixc(C0.FOAM, C0.LIMESTONE, 0.2, c), CHX + 9 + Math.cos(a) * 2.6, GROUND + 28, CHZ + 1 + Math.sin(a) * 2.6,
        0.8, 4, 0.8);
    }
    mw.box(winCol, CHX + 9, GROUND + 27.5, CHZ + 1, 3.4, 3.4, 3.4);
    m.prim(PRIM.pyr4, vary(C0.TERRACOTTA, rng, 0.08, c), CHX + 9, GROUND + 32, CHZ + 1, 8, 4.5, 8, 0, Math.PI * 0.25, 0, 1 / 4);
    mf.box(mixc(C0.FOAM, C0.CEMENT, 0.2, c), CHX + 9, GROUND + 36.5, CHZ + 1, 0.3, 3.4, 0.3);
    mf.box(mixc(C0.FOAM, C0.CEMENT, 0.2, c), CHX + 9, GROUND + 36.8, CHZ + 1, 1.6, 0.3, 0.3);
    mw.box(winCol, CHX, GROUND + 9, CHZ + 5.6, 2.4, 5, 0.2);

    /* --- KHAN EL-FRANJ — خان الإفرنج ---------------------------------------
       Fakhreddine's 17th-c. caravanserai: a two-storey rectangle of honey
       limestone wrapped round an arcaded courtyard, under terracotta hips.
       Sits in the old town, low and wide, so it reads as a lid on the souks. */
    (function () {
      const KX = -58, KZ = -52;
      const stone = mixc(C0.LIMESTONE, C0.SUN, 0.1, new T.Color());
      const shade = mixc(C0.STONE_DARK, C0.LIMESTONE, 0.45, new T.Color());
      const dark = mixc(C0.STONE_WET, C0.NIGHT_TOP, 0.35, new T.Color());
      const F1 = 6.4, F2 = 5.8;                     // storey heights
      // four ranges round a 20 x 12 courtyard
      const ranges = [
        { x: KX, z: KZ + 10, w: 36, d: 8, face: 'n' },
        { x: KX, z: KZ - 10, w: 36, d: 8, face: 's' },
        { x: KX - 14, z: KZ, w: 8, d: 12, face: 'e' },
        { x: KX + 14, z: KZ, w: 8, d: 12, face: 'w' }
      ];
      for (let i = 0; i < ranges.length; i++) {
        const R = ranges[i];
        mk.box(vary(stone, rng, 0.07, c), R.x, GROUND + F1 * 0.5, R.z, R.w, F1, R.d, 0, 0, 0, 1 / 6);
        mk.box(vary(stone, rng, 0.07, c), R.x, GROUND + F1 + F2 * 0.5, R.z, R.w - 0.5, F2, R.d - 0.5, 0, 0, 0, 1 / 6);
        // hipped terracotta roof
        mf.prim(PRIM.pyr4, vary(C0.TERRACOTTA, rng, 0.09, c), R.x, GROUND + F1 + F2 + 1.5, R.z,
          R.w + 1.4, 3.0, R.d + 1.4, 0, Math.PI * 0.25, 0, 1 / 4);
        // the arcade: piers with shadowed openings, courtyard side only
        const along = (R.face === 'n' || R.face === 's');
        const span = along ? R.w : R.d;
        const n = Math.max(3, Math.round(span / 3.2));
        const inward = R.face === 'n' ? -1 : R.face === 's' ? 1 : 0;
        const inwardX = R.face === 'e' ? 1 : R.face === 'w' ? -1 : 0;
        for (let q = 0; q < n; q++) {
          const t = (q + 0.5) / n - 0.5;
          const px = along ? R.x + t * span : R.x + inwardX * (R.d * 0.5 - 0.3);
          const pz = along ? R.z + inward * (R.d * 0.5 - 0.3) : R.z + t * span;
          mk.box(shade, px, GROUND + F1 * 0.5, pz, along ? 1.0 : 0.5, F1, along ? 0.5 : 1.0, 0, 0, 0, 1 / 6);
          // the dark of the gallery behind each arch
          if (q < n - 1) {
            const t2 = (q + 1) / n - 0.5;
            const mx = along ? R.x + t2 * span : px;
            const mz = along ? pz : R.z + t2 * span;
            mf.box(dark, mx, GROUND + F1 * 0.62, mz, along ? span / n - 1.0 : 0.3,
              F1 * 0.6, along ? 0.3 : span / n - 1.0);
            mw.box(winCol, mx, GROUND + F1 + F2 * 0.55, mz, along ? span / n - 1.4 : 0.25,
              F2 * 0.45, along ? 0.25 : span / n - 1.4);
          }
        }
      }
      // courtyard floor, fountain, two bitter-orange trees
      mf.box(mixc(C0.LIMESTONE, C0.CEMENT, 0.3, c), KX, GROUND + 0.15, KZ, 21, 0.3, 13, 0, 0, 0, 1 / 5);
      mf.prim(PRIM.cyl12, shade, KX, GROUND + 0.6, KZ, 3.4, 1.2, 3.4);
      mf.prim(PRIM.cyl8, mixc(C0.FOAM, C0.CEMENT, 0.2, c), KX, GROUND + 1.6, KZ, 0.7, 2.0, 0.7);
      for (let q = 0; q < 2; q++) {
        const tx = KX + (q ? 7 : -7), tz = KZ + (q ? 3.5 : -3.5);
        mf.prim(PRIM.cyl6, C0.TRUNK, tx, GROUND + 1.6, tz, 0.5, 3.2, 0.5);
        mf.prim(PRIM.ico, vary(C0.PALM_GREEN, rng, 0.14, c), tx, GROUND + 4.4, tz, 4.4, 3.6, 4.4);
      }
      // the great gate on the seaward face
      mk.box(shade, KX, GROUND + F1 * 0.55, KZ + 14.1, 6.0, F1 * 1.1, 1.2, 0, 0, 0, 1 / 6);
      mf.box(dark, KX, GROUND + F1 * 0.45, KZ + 14.5, 3.6, F1 * 0.8, 0.5);
    })();

    /* --- QALAAT AL-MUIZZ / ST LOUIS CASTLE — قلعة المعز ---------------------
       The land castle: a Crusader ruin on the mound above the old city. Built
       gap-toothed on purpose — half-fallen curtain, one broken drum tower,
       rubble and scrub down the slope. It is a ruin, not a castle. */
    (function () {
      const QX = 54, QZ = -98, BASE = GROUND + 15;
      const stone = mixc(C0.LIMESTONE, C0.STONE_DARK, 0.42, new T.Color());
      // the mound
      m.prim(PRIM.cone8, mixc(C0.PALM_GREEN, C0.STONE_DARK, 0.62, c),
        QX, GROUND + 8.0, QZ, 62, 16.5, 52, 0, 0.4, 0, 1 / 8);
      m.prim(PRIM.cone8, mixc(C0.STONE_DARK, C0.LIMESTONE, 0.35, c),
        QX, GROUND + 12.5, QZ, 34, 8.0, 30, 0, 0.9, 0, 1 / 8);
      // curtain wall, with whole sections simply gone
      const segs = [
        { x: -13, z: -10, w: 26, d: 2.2, h: 9.5, gap: 0.0 },
        { x: 13, z: 0, w: 2.2, d: 20, h: 7.0, gap: 0.35 },
        { x: -13, z: 0, w: 2.2, d: 20, h: 10.5, gap: 0.0 },
        { x: 4, z: 10, w: 16, d: 2.2, h: 5.0, gap: 0.5 }
      ];
      for (let i = 0; i < segs.length; i++) {
        const S2 = segs[i];
        const along = S2.w > S2.d;
        const span = along ? S2.w : S2.d;
        const n = Math.round(span / 2.2);
        for (let q = 0; q < n; q++) {
          if (rng() < S2.gap) continue;                 // collapsed length
          const t = (q + 0.5) / n - 0.5;
          const bx = QX + S2.x + (along ? t * span : 0);
          const bz = QZ + S2.z + (along ? 0 : t * span);
          // the top of a ruin is never level
          const hh = S2.h * (0.55 + rng() * 0.5);
          mk.box(vary(stone, rng, 0.12, c), bx, BASE + hh * 0.5, bz,
            along ? span / n + 0.1 : S2.w, hh, along ? S2.d : span / n + 0.1,
            0, (rng() - 0.5) * 0.03, 0, 1 / 6);
          if (rng() < 0.4) {
            mk.box(vary(stone, rng, 0.14, c), bx + (rng() - 0.5) * 0.6, BASE + hh + 0.5, bz,
              1.3, 1.0, 1.3, 0, rng() * TAU, (rng() - 0.5) * 0.12, 1 / 6);
          }
        }
      }
      // the broken drum tower on the seaward corner
      for (let k = 0; k < 5; k++) {
        const r2 = 9.2 - k * 0.35;
        mk.prim(PRIM.cyl12, vary(stone, rng, 0.1, c), QX - 13, BASE + 1.6 + k * 2.8, QZ - 10,
          r2, 2.8, r2, 0, 0, 0, 1 / 6);
      }
      for (let q = 0; q < 7; q++) {                     // ragged crown
        const a = (q / 7) * TAU + 0.3;
        if (rng() < 0.3) continue;
        mk.box(vary(stone, rng, 0.12, c), QX - 13 + Math.cos(a) * 3.6,
          BASE + 15.5 + rng() * 1.6, QZ - 10 + Math.sin(a) * 3.6,
          2.0, 1.6 + rng() * 2.2, 2.0, 0, a, 0, 1 / 6);
      }
      // rubble and scrub spilling down the slope
      for (let q = 0; q < 26; q++) {
        const a = rng() * TAU, rr = 12 + rng() * 17;
        const sx = QX + Math.cos(a) * rr, sz = QZ + Math.sin(a) * rr * 0.85;
        const sy = GROUND + 15.5 - (rr - 12) * 0.62;
        if (rng() < 0.45) {
          mf.prim(PRIM.ico, vary(mixc(C0.PALM_GREEN, C0.STONE_DARK, 0.4, c), rng, 0.16, c),
            sx, sy, sz, 2.2 + rng() * 2.4, 1.3 + rng(), 2.2 + rng() * 2.4, 0, rng() * TAU, 0);
        } else {
          mk.box(vary(stone, rng, 0.13, c), sx, sy, sz,
            0.9 + rng() * 2.0, 0.7 + rng() * 1.3, 0.9 + rng() * 1.8,
            rng() * 0.4, rng() * TAU, rng() * 0.4, 1 / 6);
        }
      }
    })();

    /* --- construction cranes: the national bird of the skyline ------------- */
    const cranes = [[-104, -70, 40], [22, -84, 52], [128, -62, 34]];
    for (let q = 0; q < cranes.length; q++) {
      const cx = cranes[q][0], cz = cranes[q][1], ch = cranes[q][2];
      const col = mixc(C0.HAZARD, C0.FOAM, 0.1, new T.Color());
      for (let s = 0; s < 4; s++) {
        const sx = (s & 1 ? 1 : -1) * 0.8, sz = (s & 2 ? 1 : -1) * 0.8;
        mf.box(col, cx + sx, GROUND + ch * 0.5, cz + sz, 0.3, ch, 0.3);
      }
      for (let y = 0; y < ch; y += 3.4) {
        mf.box(col, cx, GROUND + y, cz, 1.9, 0.18, 1.9);
      }
      const jy = GROUND + ch, ja = 0.6 + q;
      const jx = Math.cos(ja), jz = Math.sin(ja);
      mf.box(col, cx + jx * 13, jy + 1.6, cz + jz * 13, 26, 0.7, 0.7, 0, -ja, 0);
      mf.box(col, cx - jx * 5, jy + 1.6, cz - jz * 5, 10, 0.9, 0.9, 0, -ja, 0);
      mf.box(mixc(C0.CEMENT, C0.NIGHT_TOP, 0.3, c), cx - jx * 8.5, jy + 1.4, cz - jz * 8.5, 2.4, 1.6, 1.6, 0, -ja, 0);
      mf.rod(C0.CEMENT, cx + jx * 18, jy + 1.3, cz + jz * 18, cx + jx * 18, jy - 10, cz + jz * 18, 0.07, PRIM.cyl6);
      mf.box(mixc(C0.RUST, C0.NIGHT_TOP, 0.2, c), cx + jx * 18, jy - 11, cz + jz * 18, 0.9, 1.2, 0.9);
      mw.box(mixc(C0.TERRACOTTA, C0.SUN, 0.2, c), cx, jy + 3.2, cz, 0.5, 0.5, 0.5);  // aircraft light
    }

    bake(m, W.MAT.plaster, 'cityMass');
    bake(mk, W.MAT.mason, 'cityLandmarks');
    bake(mf, W.MAT.flat, 'cityDetail');
    const glow = bake(mw, W.MAT.glowOff, 'cityWindows');
    if (glow) W.night.push(glow);
  }

  /* =========================================================================
     TIME OF DAY — four keyframes (dawn / noon / dusk / night), every colour
     mixed out of the shared palette so no new hues enter the world.
     ========================================================================= */
  function buildTOD() {
    const P = W.COL, nc = function () { return new T.Color(); };
    const mk = function (o) { return o; };
    return [
      mk({   // 0.00 — dawn haze
        top: mixc(P.NIGHT_TOP, P.SKY_TOP, 0.58, nc()),
        haze: mixc(P.SKY_HAZE, P.SUN, 0.34, nc()),
        fog: mixc(P.SKY_HAZE, P.SUN, 0.24, nc()),
        sun: mixc(P.SUN, P.FOAM, 0.28, nc()),
        amb: mixc(P.SEA_DEEP, P.SKY_HAZE, 0.55, nc()),
        gnd: mixc(P.STONE_WET, P.SEA_DEEP, 0.3, nc()),
        rock: mixc(P.STONE_DARK, P.NIGHT_TOP, 0.3, nc()),
        snow: mixc(P.FOAM, P.SUN, 0.3, nc()),
        glow: mixc(P.SUN, P.TERRACOTTA, 0.3, nc()),
        glowAmt: 0.55, sunI: 0.62, ambI: 0.5, hemI: 0.38, lamp: 0.55, el: 0.09, az: -1.15
      }),
      mk({   // 0.25 — hard noon glare
        top: nc().copy(P.SKY_TOP),
        haze: nc().copy(P.SKY_HAZE),
        fog: mixc(P.SKY_HAZE, P.FOAM, 0.3, nc()),
        sun: mixc(P.FOAM, P.SUN, 0.22, nc()),
        amb: mixc(P.SKY_HAZE, P.SKY_TOP, 0.35, nc()),
        gnd: mixc(P.LIMESTONE, P.SEA_SHALLOW, 0.25, nc()),
        rock: mixc(P.STONE_DARK, P.SEA_MID, 0.22, nc()),
        snow: nc().copy(P.FOAM),
        glow: mixc(P.FOAM, P.SUN, 0.35, nc()),
        glowAmt: 0.22, sunI: 1.12, ambI: 0.52, hemI: 0.5, lamp: 0.0, el: 0.95, az: 0.25
      }),
      mk({   // 0.50 — a proper Mediterranean dusk
        top: mixc(P.SKY_TOP, P.NIGHT_TOP, 0.42, nc()),
        haze: mixc(P.SUN, P.TERRACOTTA, 0.5, nc()),
        fog: mixc(P.TERRACOTTA, P.SKY_HAZE, 0.42, nc()),
        sun: mixc(P.SUN, P.TERRACOTTA, 0.55, nc()),
        amb: mixc(P.NIGHT_TOP, P.TERRACOTTA, 0.42, nc()),
        gnd: mixc(P.TERRACOTTA, P.SEA_DEEP, 0.45, nc()),
        rock: mixc(P.TERRACOTTA, P.NIGHT_TOP, 0.45, nc()),
        snow: mixc(P.FOAM, P.TERRACOTTA, 0.4, nc()),
        glow: mixc(P.SUN, P.TERRACOTTA, 0.45, nc()),
        glowAmt: 0.8, sunI: 0.62, ambI: 0.45, hemI: 0.34, lamp: 0.75, el: 0.06, az: 1.35
      }),
      mk({   // 0.75 — night
        top: nc().copy(P.NIGHT_TOP),
        haze: mixc(P.NIGHT_TOP, P.SEA_DEEP, 0.55, nc()),
        fog: mixc(P.NIGHT_TOP, P.SEA_DEEP, 0.4, nc()),
        sun: mixc(P.SEA_DEEP, P.FOAM, 0.3, nc()),             // moonlight
        amb: mixc(P.NIGHT_TOP, P.SEA_MID, 0.28, nc()),
        gnd: nc().copy(P.NIGHT_TOP),
        rock: mixc(P.NIGHT_TOP, P.SEA_MID, 0.18, nc()),
        snow: mixc(P.FOAM, P.NIGHT_TOP, 0.5, nc()),
        glow: mixc(P.SEA_MID, P.FOAM, 0.35, nc()),
        glowAmt: 0.25, sunI: 0.2, ambI: 0.34, hemI: 0.26, lamp: 1.0, el: 0.55, az: -0.4
      })
    ];
  }

  /* =========================================================================
     createWorld
     ========================================================================= */
  function createWorld(THREE, opts) {
    T = THREE;
    opts = opts || {};
    const pal = Object.assign({}, PALETTE, opts.palette || {});

    // scratch objects (shared, never retained)
    _v.a = new T.Vector3(); _v.b = new T.Vector3(); _v.c = new T.Vector3();
    _v.d = new T.Vector3(); _v.n = new T.Vector3();
    _v.col1 = new T.Color(); _v.col2 = new T.Color(); _v.col3 = new T.Color();
    _nm = new T.Matrix3(); _o3 = new T.Object3D(); _m4 = new T.Matrix4();
    initPrims();
    TEXS = [];

    const COL = {};
    for (const k in pal) if (typeof pal[k] === 'string') COL[k] = new T.Color(pal[k]);

    const group = new T.Group();
    group.name = 'world';
    W = {
      COL: COL, group: group, mats: [], geos: [], coll: [], night: [],
      palms: [], floaters: [], perches: [], gulls: [], ridges: [],
      sky: null, flag: null, flagBase: null, uncle: null, cat: null,
      catPost: null, smoke: null, gullMesh: null, cart: null
    };
    W.MAT = buildMaterials();

    /* ---- build order matters: the offshore build fills W.perches, the bollards fill
            W.catPost, both of which later builders consume ---- */
    W.sky = buildSky();
    W.ridges = buildMountains();
    buildCorniche();
    buildBalustrade();
    buildSaidaOffshore();
    buildCastle();
    buildCauseway();
    buildTrees();
    buildStreetFurniture();
    const kiosk = buildKioskAndCart();
    buildClutter();
    const sandPiles = buildSandPiles();
    buildFisherman();
    buildBoats();
    buildGulls();
    buildCity();

    /* ---- lights.  They live inside world.group so the scene is correct the
            moment the group is added; the game can kill them with
            world.setLightsEnabled(false) if it would rather own lighting. --- */
    const lights = new T.Group();
    lights.name = 'worldLights';
    const sun = new T.DirectionalLight(0xffffff, 1.0);
    sun.position.set(90, 160, -120);
    sun.castShadow = true;
    if (sun.shadow) {
      sun.shadow.mapSize.width = sun.shadow.mapSize.height = 1024;
      const cam = sun.shadow.camera;
      cam.left = -90; cam.right = 90; cam.top = 90; cam.bottom = -90;
      cam.near = 1; cam.far = 420;
    }
    const ambient = new T.AmbientLight(0xffffff, 0.5);
    const hemi = new T.HemisphereLight(0xffffff, 0x888888, 0.4);
    hemi.position.set(0, 60, 0);
    lights.add(sun); lights.add(sun.target); lights.add(ambient); lights.add(hemi);
    group.add(lights);

    const fog = new T.Fog(0xD9EEF2, 120, 760);
    if (opts.scene) { opts.scene.fog = fog; opts.scene.add(group); }

    const TOD = buildTOD();
    const state = {
      k: -99,
      top: new T.Color(), haze: new T.Color(), fog: new T.Color(),
      sun: new T.Color(), amb: new T.Color(), gnd: new T.Color(),
      rock: new T.Color(), snow: new T.Color(), glow: new T.Color()
    };
    const sunDir = new T.Vector3(0, 1, 0);
    let lampOn = false;

    function setTimeOfDay(k) {
      k = ((k % 1) + 1) % 1;
      if (Math.abs(k - state.k) < 0.0007 && state.k > -1) return;
      state.k = k;
      const f = k * 4, i0 = Math.floor(f) % 4, i1 = (i0 + 1) % 4, t = f - Math.floor(f);
      const A = TOD[i0], B = TOD[i1];
      mixc(A.top, B.top, t, state.top);
      mixc(A.haze, B.haze, t, state.haze);
      mixc(A.fog, B.fog, t, state.fog);
      mixc(A.sun, B.sun, t, state.sun);
      mixc(A.amb, B.amb, t, state.amb);
      mixc(A.gnd, B.gnd, t, state.gnd);
      mixc(A.rock, B.rock, t, state.rock);
      mixc(A.snow, B.snow, t, state.snow);
      mixc(A.glow, B.glow, t, state.glow);
      const glowAmt = lerp(A.glowAmt, B.glowAmt, t);
      const sunI = lerp(A.sunI, B.sunI, t);
      const ambI = lerp(A.ambI, B.ambI, t);
      const hemI = lerp(A.hemI, B.hemI, t);
      const lamp = lerp(A.lamp, B.lamp, t);
      const el = lerp(A.el, B.el, t), az = lerp(A.az, B.az, t);

      sunDir.set(Math.sin(az) * Math.cos(el * 1.5), Math.max(0.04, Math.sin(el * 1.5)),
        -Math.cos(az) * Math.cos(el * 1.5)).normalize();
      sun.position.copy(sunDir).multiplyScalar(240);
      sun.color.copy(state.sun);
      sun.intensity = sunI;
      ambient.color.copy(state.amb);
      ambient.intensity = ambI;
      hemi.color.copy(state.haze);
      hemi.groundColor.copy(state.gnd);
      hemi.intensity = hemI;
      fog.color.copy(state.fog);
      fog.near = lerp(90, 180, 1 - glowAmt);
      fog.far = lerp(520, 820, clamp(sunI, 0, 1));

      paintSky(state.top, state.haze, sunDir, state.glow, glowAmt);
      paintMountains(state.rock, state.snow, state.fog);
      W.MAT.ridge.needsUpdate = true;
      // sea-level bounce light tints the big unlit things a touch
      W.MAT.glowOn.color.copy(state.glow).lerp(new T.Color(1, 1, 1), 0.45);

      // lamp heads / windows get an emissive look once the sun is down
      const want = lamp > 0.5;
      if (want !== lampOn) {
        lampOn = want;
        for (let i = 0; i < W.night.length; i++) {
          W.night[i].material = want ? W.MAT.glowOn : W.MAT.glowOff;
        }
      }
      world.timeOfDay = k;
      world.isNight = want;
    }

    /* ----------------------------- per-frame ------------------------------- */
    const tmpV = new T.Vector3();
    function update(t, dt, ctx) {
      dt = clamp(dt || 0.016, 0, 0.1);
      const waves = ctx && ctx.waves ? ctx.waves : null;

      /* gulls */
      const im = W.gullMesh;
      if (im) {
        for (let i = 0; i < W.gulls.length; i++) {
          const g = W.gulls[i];
          if (g.perched) {
            _o3.position.set(g.x, g.y + Math.sin(t * 1.4 + g.phase) * 0.035, g.z);
            _o3.rotation.set(0, g.ry + Math.sin(t * 0.45 + g.phase) * 0.3, 0);
            const pk = 1 + Math.sin(t * 2.2 + g.phase) * 0.03;
            _o3.scale.set(0.42, 0.62 * pk, 0.62);      // wings folded in
          } else {
            const a = t * g.sp + g.ph;
            const x = g.cx + Math.cos(a) * g.rx + wig(t * 0.063 + g.drift) * 11;
            const z = g.cz + Math.sin(a) * g.rz + wig(t * 0.051 + g.drift + 3) * 11;
            const y = g.y + wig(t * 0.2 + g.drift * 0.7) * 2.6;
            const hx = -Math.sin(a) * g.rx * g.sp, hz = Math.cos(a) * g.rz * g.sp;
            _o3.position.set(x, y, z);
            _o3.rotation.set(0, Math.atan2(hx, hz),
              (g.sp > 0 ? -0.34 : 0.34) + Math.sin(t * 0.33 + g.ph) * 0.14);
            const flap = 1 + Math.sin(t * g.flap + g.ph) * 0.3;
            _o3.scale.set(flap, 1 - (flap - 1) * 0.35, 1);
          }
          _o3.updateMatrix();
          im.setMatrixAt(i, _o3.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
      }

      /* palm crowns + ficus-adjacent sway */
      for (let i = 0; i < W.palms.length; i++) {
        const p = W.palms[i];
        p.mesh.rotation.z = Math.sin(t * p.rate + p.phase) * p.amp;
        p.mesh.rotation.x = Math.cos(t * p.rate * 0.81 + p.phase * 1.7) * p.amp * 0.85;
        p.mesh.rotation.y = Math.sin(t * p.rate * 0.37 + p.phase) * 0.05;
      }

      /* the flag */
      if (W.flag) {
        const pa = W.flag.geometry.attributes.position, base = W.flagBase;
        for (let i = 0; i < pa.count; i++) {
          const bx = base[i * 3], by = base[i * 3 + 1];
          const kx = clamp(bx / 3.3, 0, 1);
          pa.setZ(i, Math.sin(t * 3.1 - bx * 1.9 + by * 0.7) * 0.36 * kx * kx);
          pa.setY(i, by + Math.sin(t * 2.2 - bx * 1.2) * 0.09 * kx);
        }
        pa.needsUpdate = true;
      }

      /* boats + jet ski riding the wave field */
      for (let i = 0; i < W.floaters.length; i++) {
        const f = W.floaters[i];
        let h = 0, hf = 0, hs = 0;
        if (waves) {
          const fx = Math.sin(f.ry) * f.span, fz = Math.cos(f.ry) * f.span;
          h = waves.height(f.x, f.z, t);
          hf = waves.height(f.x + fx, f.z + fz, t);
          hs = waves.height(f.x + fz * 0.45, f.z - fx * 0.45, t);
        } else {
          h = Math.sin(t * 0.9 + f.phase) * 0.12;
          hf = Math.sin(t * 0.9 + f.phase + 0.5) * 0.12;
          hs = Math.sin(t * 1.3 + f.phase) * 0.1;
        }
        const mesh = f.mesh;
        mesh.rotation.order = 'YXZ';          // yaw in world, pitch/roll in the hull
        mesh.position.y = (h + 0.12) * f.amp;
        mesh.rotation.y = f.ry + Math.sin(t * 0.21 + f.phase) * 0.05;
        mesh.rotation.x = clamp(-(hf - h) / f.span, -0.4, 0.4) * 0.9;
        mesh.rotation.z = clamp((hs - h) / (f.span * 0.45), -0.4, 0.4) * 0.7;
      }

      /* the uncle: a slow lean, and every so often a hopeful twitch */
      if (W.uncle) {
        const ph = W.uncle.phase;
        W.uncle.group.rotation.x = Math.sin(t * 0.42 + ph) * 0.025;
        const bite = Math.max(0, wig(t * 0.37 + ph) - 0.72) * 3.0;
        W.uncle.rod.rotation.x = -0.12 + Math.sin(t * 1.5 + ph) * 0.05 - bite * 0.3;
        W.uncle.rod.rotation.y = Math.sin(t * 0.5 + ph) * 0.07;
      }

      /* the cat, breathing */
      if (W.cat) {
        const b = 1 + Math.sin(t * 1.7) * 0.055;
        W.cat.scale.set(1, b, 1 / Math.sqrt(b));
        W.cat.rotation.z = Math.sin(t * 0.3) * 0.02;
      }

      /* coffee-cart smoke */
      const sm = W.smoke;
      if (sm) {
        for (let i = 0; i < sm.n; i++) {
          sm.life[i] += dt * (0.2 + (i % 5) * 0.012);
          if (sm.life[i] > 1) sm.life[i] -= 1;
          const L = sm.life[i], i3 = i * 3;
          sm.arr[i3] = sm.x + L * 1.1 + wig(L * 5.5 + i) * 1.0 * L;
          sm.arr[i3 + 1] = sm.y + L * 3.6;
          sm.arr[i3 + 2] = sm.z + wig(L * 4.7 + i * 2.3) * 0.9 * L + L * 0.3;
        }
        sm.pts.geometry.attributes.position.needsUpdate = true;
      }
      void tmpV;
    }

    function dispose() {
      if (group.parent) group.parent.remove(group);
      const seen = [];
      group.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.dispose && o.isInstancedMesh) o.dispose();
      });
      for (let i = 0; i < W.geos.length; i++) { try { W.geos[i].dispose(); } catch (e) { void e; } }
      for (let i = 0; i < W.mats.length; i++) { try { W.mats[i].dispose(); } catch (e) { void e; } }
      for (let i = 0; i < TEXS.length; i++) { try { TEXS[i].dispose(); } catch (e) { void e; } }
      for (const kk in PRIM) { try { PRIM[kk].dispose(); } catch (e) { void e; } }
      group.clear ? group.clear() : (group.children.length = 0);
      void seen;
      W = null;
    }

    const world = {
      /* ---- contracted API (SPEC section A) ---- */
      group: group,
      sky: W.sky,
      setTimeOfDay: setTimeOfDay,
      update: update,
      landColliders: W.coll,
      sandPiles: sandPiles,
      kiosk: kiosk,
      heckler: { x: -11.0, y: 1.5, z: -3.6 },     // worn patch by the missing railing
      dispose: dispose,
      /* ---- extras the game may use ---- */
      nightLights: W.night,                       // meshes whose material can be swapped
      nightMaterials: { on: W.MAT.glowOn, off: W.MAT.glowOff },
      fog: fog,                                   // assign to scene.fog
      lights: lights, sun: sun, ambient: ambient, hemi: hemi,
      sunColor: state.sun, ambientColor: state.amb, fogColor: state.fog,
      skyTopColor: state.top, skyHazeColor: state.haze,
      sunDir: sunDir,
      timeOfDay: 0, isNight: false,
      materials: W.MAT,
      cart: W.cart,                               // the manakish/coffee cart
      stairs: STAIR.map(function (s) { return { top: s.top, z1: s.z1, z2: s.z2, x1: -5, x2: 5 }; }),
      setLightsEnabled: function (on) { lights.visible = !!on; }
    };
    setTimeOfDay(0.18);
    return world;
  }

  root.BLB_WORLD = { createWorld: createWorld };
})(typeof window !== 'undefined' ? window : this);
