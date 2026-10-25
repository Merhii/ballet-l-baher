/* Headless contract check. Cannot test WebGL, but it loads every module the way
 * the page does and exercises each contracted entry point, which catches
 * load-time errors, missing exports and r128 APIs that don't exist. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const THREE_PATH = process.argv[2] || path.join(__dirname, 'vendor', 'three.min.js');

// ---------------------------------------------------------------- DOM shims
function autoMock(name) {
  const store = {};
  const target = function () {};
  return new Proxy(target, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => '[mock ' + name + ']';
      if (prop === 'then') return undefined;
      if (prop in store) return store[prop];
      if (prop === 'length') return 0;
      if (prop === 'width' || prop === 'height') return 128;
      if (prop === 'style' || prop === 'dataset' || prop === 'classList' ||
          prop === 'parentNode' || prop === 'firstChild' || prop === 'parentElement') return autoMock(name + '.' + String(prop));
      if (prop === 'data') return new Uint8ClampedArray(4 * 128 * 128);
      return (...args) => {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return { addColorStop() {} };
        }
        if (prop === 'getImageData') return { data: new Uint8ClampedArray(4 * 128 * 128), width: 128, height: 128 };
        if (prop === 'measureText') return { width: 24 };
        if (prop === 'getBoundingClientRect') return { left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 };
        if (prop === 'querySelector' || prop === 'querySelectorAll' || prop === 'appendChild' ||
            prop === 'insertBefore' || prop === 'cloneNode' || prop === 'createElement') return autoMock(name + '.' + String(prop));
        void args;
        return undefined;
      };
    },
    set(_, prop, value) { store[prop] = value; return true; },
    has() { return true; }
  });
}

function makeCanvas() {
  const ctx = autoMock('ctx2d');
  return {
    width: 256, height: 256,
    style: {},
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,',
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
  };
}

const created = [];
const document = {
  readyState: 'complete',
  createElement(tag) {
    if (tag === 'canvas') { const c = makeCanvas(); created.push(c); return c; }
    const el = autoMock('el<' + tag + '>');
    created.push(el);
    return el;
  },
  createElementNS() { return document.createElement('div'); },
  getElementById() { return autoMock('byId'); },
  querySelector() { return autoMock('qs'); },
  querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {},
  head: autoMock('head'),
  body: autoMock('body'),
  documentElement: autoMock('docEl'),
  fonts: { add() {}, load: () => Promise.resolve() }
};

function AudioParamMock() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }; }
function nodeMock(extra) {
  return Object.assign({
    connect() { return nodeMock(); }, disconnect() {}, start() {}, stop() {},
    gain: AudioParamMock(), frequency: AudioParamMock(), detune: AudioParamMock(),
    Q: AudioParamMock(), playbackRate: AudioParamMock(), type: 'sine',
    buffer: null, loop: false, onended: null
  }, extra || {});
}
class AudioContextMock {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = nodeMock(); }
  createGain() { return nodeMock(); }
  createOscillator() { return nodeMock(); }
  createBufferSource() { return nodeMock(); }
  createBiquadFilter() { return nodeMock(); }
  createDynamicsCompressor() { return nodeMock(); }
  createStereoPanner() { return nodeMock({ pan: AudioParamMock() }); }
  createWaveShaper() { return nodeMock({ curve: null, oversample: 'none' }); }
  createConvolver() { return nodeMock(); }
  createBuffer(ch, len, rate) {
    const data = new Float32Array(len);
    return { length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: () => data, duration: len / rate };
  }
  createPeriodicWave() { return {}; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

const storage = {};
const sandbox = {
  console,
  document,
  navigator: { userAgent: 'node', maxTouchPoints: 0, platform: 'node' },
  location: { href: 'https://example.invalid/', protocol: 'https:' },
  devicePixelRatio: 2,
  innerWidth: 1280, innerHeight: 760,
  requestAnimationFrame() { return 1; },
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  },
  AudioContext: AudioContextMock,
  webkitAudioContext: AudioContextMock,
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  getComputedStyle: () => autoMock('computedStyle'),
  Image: function () { return {}; },
  Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Uint8ClampedArray, ArrayBuffer, Math, Date, JSON,
  Proxy, Reflect, Promise, Map, Set, WeakMap, Symbol, Error, TypeError, RangeError, isNaN, isFinite, parseFloat, parseInt
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
const ctxVm = vm.createContext(sandbox);

function run(file, label) {
  const code = fs.readFileSync(file, 'utf8');
  try {
    vm.runInContext(code, ctxVm, { filename: label || file });
    return null;
  } catch (e) {
    return e;
  }
}

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (e) {
    results.push({ name, ok: false, detail: (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)) });
  }
}

// ---------------------------------------------------------------- load order
let err = run(THREE_PATH, 'three.min.js');
if (err) { console.error('FATAL loading three:', err.message); process.exit(2); }
const THREE = sandbox.THREE;
check('three loaded r128', () => { if (THREE.REVISION !== '128') throw new Error('rev ' + THREE.REVISION); return 'r' + THREE.REVISION; });

for (const f of ['physics.js', 'world.js', 'hud.js', 'game.js']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { results.push({ name: 'load ' + f, ok: false, detail: 'FILE MISSING' }); continue; }
  const e = run(p, f);
  results.push({ name: 'load ' + f, ok: !e, detail: e ? (e.stack || '').split('\n').slice(0, 5).join(' | ') : '' });
}

// ---------------------------------------------------------------- contracts
const PAL_NUM = { SEA_DEEP: 0x0b3a4f, SEA_MID: 0x16708c, SEA_SHALLOW: 0x3fa8b4, FOAM: 0xedf6f3,
  SKY_TOP: 0x6fc3de, SKY_HAZE: 0xd9eef2, LIMESTONE: 0xe4d7b3, STONE_DARK: 0xa08f6a,
  STONE_WET: 0x7d6e4f, TERRACOTTA: 0xb9502f, CEMENT: 0x9aa0a0, RUST: 0x8c4a2f,
  PALM_GREEN: 0x3f6b3a, PALM_LIGHT: 0x5e8c3f, TRUNK: 0x7a6245, SUN: 0xf6c445,
  HAZARD: 0xf2b733, NIGHT_TOP: 0x0a1a33, SKIN: 0xc98a5e, SHIRT: 0xe8e2d4, DENIM: 0x3b5c73 };
// the game hands world.js CSS strings, so the harness must too
const PAL = {};
for (const k in PAL_NUM) PAL[k] = '#' + ('000000' + PAL_NUM[k].toString(16)).slice(-6);

const TIERS = (sandbox.BLB_GAME && sandbox.BLB_GAME.TIERS) || [
  { id: 'ramleh', hp: 8, mortar: 1, lira: 0, color: 0xcdbd92 },
  { id: 'beton', hp: 22, mortar: 1, lira: 40, color: 0x9aa0a0 },
  { id: 'qarmid', hp: 55, mortar: 2, lira: 180, color: 0x2e7fa8 },
  { id: 'marble', hp: 130, mortar: 3, lira: 600, color: 0xefe7da }
];

let waves, sim, world, hud, sfx, fxp, body;
const PH = sandbox.BLB_PHYSICS, WD = sandbox.BLB_WORLD, HD = sandbox.BLB_HUD;

check('BLB_PHYSICS exports', () => {
  ['createWaveField', 'createTileSim', 'createPlayerBody', 'createSplashes']
    .forEach(k => { if (typeof PH[k] !== 'function') throw new Error('missing ' + k); });
  return Object.keys(PH).join(',');
});
check('wave field', () => {
  waves = PH.createWaveField({ seed: 7 });
  const h = waves.height(12, 40, 3.5);
  if (!isFinite(h)) throw new Error('height not finite: ' + h);
  const v = new THREE.Vector3();
  waves.normal(12, 40, 3.5, v);
  if (!isFinite(v.x)) throw new Error('normal not finite');
  const s = waves.swell(10);
  if (!(s >= 0 && s <= 1)) throw new Error('swell out of range: ' + s);
  if (typeof waves.breakerAmount !== 'function') throw new Error('no breakerAmount');
  // amplitude sanity across a patch of sea
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < 4000; i++) {
    const hh = waves.height((i % 97) * 3.1, 10 + (i % 53) * 4.7, i * 0.05);
    lo = Math.min(lo, hh); hi = Math.max(hi, hh);
  }
  return 'h range ' + lo.toFixed(2) + '..' + hi.toFixed(2);
});
/* NOTE: modules run inside a vm context here, which costs roughly 5x on global
   lookups versus a browser. Measured in the real global scope this same call is
   ~45-55ns. So this check is a loose regression guard, not a real budget. */
check('wave height perf (20k calls, vm-penalised)', () => {
  const t0 = process.hrtime.bigint();
  let acc = 0;
  for (let i = 0; i < 20000; i++) acc += waves.height(i * 0.7, 20 + (i % 300), 12.5);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (ms > 14) throw new Error('too slow even allowing for vm overhead: ' + ms.toFixed(2) + 'ms for 20k');
  return ms.toFixed(2) + 'ms / 20k calls (sum ' + acc.toFixed(1) + ')';
});
check('tile sim place/support/solid', () => {
  sim = PH.createTileSim({ waves, tiers: TIERS });
  if (sim.place(0, 3, 0, 0)) throw new Error('placed unsupported tile at j=3');
  if (!sim.place(0, 0, 0, 0)) throw new Error('could not place at shore j=0');
  if (sim.place(0, 0, 0, 0)) throw new Error('double-placed same cell');
  if (!sim.place(0, 1, 0, 0)) throw new Error('could not extend from a neighbour');
  if (sim.count !== 2) throw new Error('count=' + sim.count);
  const top = sim.solidAt(0, 4);
  if (Math.abs(top - 0.3) > 1e-6) throw new Error('solidAt(0,4)=' + top + ' expected 0.3');
  if (sim.solidAt(200, 300) !== null) throw new Error('solidAt open water should be null');
  const t = sim.get(0, 0);
  ['i', 'j', 'tier', 'hp', 'maxHp'].forEach(k => { if (!(k in t)) throw new Error('tile missing ' + k); });
  let seen = 0; sim.forEach(() => seen++);
  if (seen !== 2) throw new Error('forEach saw ' + seen);
  return 'ok, count=' + sim.count;
});
check('tile sim serialize round-trip', () => {
  const data = sim.serialize();
  const s2 = PH.createTileSim({ waves, tiers: TIERS });
  s2.load(JSON.parse(JSON.stringify(data)));
  if (s2.count !== sim.count) throw new Error('count ' + s2.count + ' != ' + sim.count);
  if (!s2.get(0, 1)) throw new Error('lost tile (0,1)');
  return 'count ' + s2.count;
});
check('erosion: frontier dies, interior lives', () => {
  const s = PH.createTileSim({ waves, tiers: TIERS });
  for (let i = -3; i <= 3; i++) for (let j = 0; j <= 3; j++) s.place(i, j, 0, 0);
  const interior = { i: 0, j: 1 };
  let t = 0, spurGone = -1;
  s.place(0, 4, 0, 0); // a lone spur out front
  for (let step = 0; step < 6000; step++) {
    t += 0.05;
    const dead = s.update(0.05, t) || [];
    if (spurGone < 0 && !s.get(0, 4)) spurGone = t;
    void dead;
    if (t > 240) break;
  }
  const inner = s.get(interior.i, interior.j);
  if (!inner) throw new Error('interior tile (0,1) was destroyed — erosion rules wrong');
  if (spurGone < 0) return 'WARNING: exposed spur survived 240s';
  return 'spur died at ' + spurGone.toFixed(1) + 's; interior hp ' + inner.hp.toFixed(1) + '/' + inner.maxHp;
});
check('BLB_WORLD.createWorld', () => {
  if (typeof WD.createWorld !== 'function') throw new Error('no createWorld');
  world = WD.createWorld(THREE, { palette: PAL });
  if (!world.group || !world.group.isObject3D) throw new Error('group is not an Object3D');
  ['setTimeOfDay', 'update'].forEach(k => { if (typeof world[k] !== 'function') throw new Error('missing ' + k); });
  if (!Array.isArray(world.landColliders) || !world.landColliders.length) throw new Error('no landColliders');
  if (!Array.isArray(world.sandPiles) || !world.sandPiles.length) throw new Error('no sandPiles');
  if (!world.kiosk || !world.heckler) throw new Error('missing kiosk/heckler anchors');
  let meshes = 0;
  world.group.traverse(o => { if (o.isMesh || o.isLineSegments || o.isPoints) meshes++; });
  world.setTimeOfDay(0.3); world.setTimeOfDay(0.8);
  world.update(1.5, 0.016, { waves, camera: new THREE.PerspectiveCamera(), playerPos: new THREE.Vector3(0, 1.5, -10) });
  return meshes + ' drawable nodes, ' + world.landColliders.length + ' colliders, ' + world.sandPiles.length + ' piles';
});
check('world keeps the stairs corridor clear', () => {
  if (!world) throw new Error('no world');
  const box = new THREE.Box3();
  const bad = [];
  world.group.updateMatrixWorld(true);
  world.group.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    box.setFromObject(o);
    if (!isFinite(box.min.x)) return;
    // tile grid footprint: z >= 3.0, |x| <= 128, anything poking above tile top
    if (box.max.z > 3.0 && box.min.z < 700 && box.max.y > 0.45 && box.min.y < 30 &&
        box.min.x > -130 && box.max.x < 130 && box.min.z < 60 && Math.abs(box.min.x) < 20) {
      bad.push((o.name || 'mesh') + ' z[' + box.min.z.toFixed(1) + ',' + box.max.z.toFixed(1) + '] y[' + box.min.y.toFixed(1) + ',' + box.max.y.toFixed(1) + ']');
    }
  });
  if (bad.length) return 'WARNING: ' + bad.length + ' mesh(es) intrude on the near tile grid: ' + bad.slice(0, 3).join(' ; ');
  return 'clear';
});
/* The player-body check must not depend on world.js loading, so fall back to a
   minimal stand-in corniche: deck, the five steps, the apron. */
function stubWorld() {
  const steps = [];
  let z = -2;
  [1.26, 1.02, 0.78, 0.54, 0.30].forEach(top => {
    steps.push({ x1: -5, x2: 5, z1: z, z2: z + 0.92, top });
    z += 0.92;
  });
  return {
    group: new THREE.Group(),
    landColliders: [
      { x1: -130, x2: 130, z1: -34, z2: -2, top: 1.5 },
      ...steps,
      { x1: -5, x2: 5, z1: 1.6, z2: 2.9, top: 0.30 }
    ],
    sandPiles: [{ x: -9, y: 1.5, z: -12, kind: 'sand' }],
    kiosk: { x: 12, y: 1.5, z: -12 },
    heckler: { x: -3, y: 1.5, z: -4 },
    setTimeOfDay() {}, update() {}, dispose() {}
  };
}

check('player body', () => {
  const w = world || stubWorld();
  if (!world) results.push({ name: 'player body (using stub world)', ok: true, detail: 'world.js unavailable' });
  body = PH.createPlayerBody({ sim, world: w });
  ['pos', 'vel'].forEach(k => { if (!body[k]) throw new Error('missing ' + k); });
  if (typeof body.step !== 'function' || typeof body.teleport !== 'function') throw new Error('missing step/teleport');
  body.teleport(0, 1.5, -11);
  for (let i = 0; i < 240; i++) body.step(1 / 60, i / 60, { moveX: 0, moveZ: 1, jump: false, run: false }, waves);
  if (!isFinite(body.pos.x) || !isFinite(body.pos.y)) throw new Error('position went non-finite');
  const walkedTo = body.pos.clone();
  body.teleport(0, 1.5, -11);
  for (let i = 0; i < 600; i++) body.step(1 / 60, i / 60, { moveX: 0, moveZ: 0, jump: false, run: false }, waves);
  if (Math.abs(body.pos.y - 1.5) > 0.6) throw new Error('resting on deck drifted to y=' + body.pos.y.toFixed(2));
  return 'walked to z=' + walkedTo.z.toFixed(1) + ' y=' + walkedTo.y.toFixed(2) + '; rests at y=' + body.pos.y.toFixed(2);
});
check('splashes', () => {
  fxp = PH.createSplashes(THREE, { palette: PAL });
  if (!fxp.object || !fxp.object.isObject3D) throw new Error('no object');
  fxp.burst(3, 0.3, 12, 0.6); fxp.crumble(3, 0.3, 12);
  for (let i = 0; i < 120; i++) fxp.update(0.016);
  return 'ok';
});
check('BLB_HUD.create', () => {
  if (typeof HD.create !== 'function') throw new Error('no create');
  const root = document.createElement('div');
  hud = HD.create({ root, palette: PAL, tiers: TIERS, keys: false,
    onBuy() {}, onSelectTier() {}, onStart() {}, onToggleSound() {} });
  ['setStats', 'setPrompt', 'toast', 'heckle', 'setPhase', 'openShop', 'closeShop', 'showIntro', 'hideIntro', 'setLoading', 'frame']
    .forEach(k => { if (typeof hud[k] !== 'function') throw new Error('missing hud.' + k); });
  hud.setStats({ mortar: 3, mortarMax: 12, tiles: 2, metres: 8, lira: 10, tierIdx: 0, unlocked: [true, false, false, false], workers: 0, swell: 0.3 });
  hud.setPrompt('hold E'); hud.setPrompt(null);
  hud.toast('hello', 'good'); hud.heckle('shu 3am ta3mel'); hud.setPhase('dusk');
  hud.showIntro(); hud.hideIntro(); hud.setLoading(50); hud.setLoading(null);
  hud.openShop({ lira: 500, unlocked: [true, false, false, false], tiers: TIERS, mortarMax: 12,
    barrowNext: { size: 20, cost: 60 }, workers: 0, workerNext: { cost: 250 }, floodlights: false, floodlightCost: 400 });
  hud.closeShop();
  hud.frame(0.016);
  return (HD.HECKLES ? HD.HECKLES.length + ' heckles' : 'no HECKLES export');
});
check('HUD speech layer (NPC bubbles)', () => {
  ['say', 'anchorSpeech', 'clearSpeech', 'isSaying']
    .forEach(k => { if (typeof hud[k] !== 'function') throw new Error('missing hud.' + k); });
  const ttl = hud.say('abou', { name: 'Abou Nabil', text: 'Shu oshbak ya 3mi?' });
  if (!(ttl > 0)) throw new Error('say() returned no lifetime: ' + ttl);
  if (!hud.isSaying('abou')) throw new Error('isSaying false right after say()');
  hud.anchorSpeech('abou', 640, 300, true);
  hud.say('imkhalil', { name: 'Im Khalil', text: '3mol mneeh w kob bl ba7er.', ar: 'إعمل منيح وكبّ بالبحر' });
  if (!hud.isSaying('imkhalil')) throw new Error('second speaker not tracked');
  // the bubble must expire on its own
  for (let i = 0; i < 1200; i++) hud.frame(0.016);
  if (hud.isSaying('abou')) throw new Error('bubble never expired');
  hud.say('jad', { name: 'Jad', text: 'HE FELL IN!' });
  hud.clearSpeech('jad');
  if (hud.isSaying('jad')) throw new Error('clearSpeech did not clear');
  return 'say/anchor/expire/clear all ok';
});
check('sfx.say voice blips', () => {
  const a = HD.createAudio();
  if (typeof a.say !== 'function') throw new Error('missing sfx.say');
  a.unlock();
  for (let v = 0; v < 5; v++) a.say(v);
  return '5 voices';
});
check('BLB_HUD.createAudio', () => {
  sfx = HD.createAudio();
  ['unlock', 'clack', 'pour', 'crumble', 'splash', 'gull', 'ui', 'purchase', 'wash']
    .forEach(k => { if (typeof sfx[k] !== 'function') throw new Error('missing sfx.' + k); });
  sfx.unlock();
  sfx.clack(); sfx.clack(); sfx.pour(); sfx.crumble(); sfx.splash(); sfx.gull(); sfx.ui(); sfx.purchase();
  sfx.wash(0.5); sfx.muted = true; sfx.muted = false;
  return 'ok';
});
check('BLB_GAME exports go/boot', () => {
  const G = sandbox.BLB_GAME;
  if (!G || typeof G.boot !== 'function' || typeof G.go !== 'function') throw new Error('missing BLB_GAME.boot/go');
  return 'ok';
});

// ---------------------------------------------------------------- report
let fail = 0, warn = 0;
console.log('');
for (const r of results) {
  const isWarn = r.ok && /^WARNING/.test(r.detail);
  if (!r.ok) fail++;
  if (isWarn) warn++;
  const tag = r.ok ? (isWarn ? 'WARN' : ' ok ') : 'FAIL';
  console.log('[' + tag + '] ' + r.name + (r.detail ? ' — ' + r.detail : ''));
}
console.log('\n' + results.length + ' checks, ' + fail + ' failed, ' + warn + ' warnings');
process.exit(fail ? 1 : 0);
