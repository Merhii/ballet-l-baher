/* Records the promo's gameplay clips from the real game.
   Runs the local build (http://localhost:8765, the "game" preview server) in
   headless Chrome on the Mac's GPU, plays each shot from a script below and
   saves it to public/clips/<format>/<shot>.mp4.

     node capture/record.mjs            all shots, both formats
     node capture/record.mjs lay whish  only these shots
   FORMAT=story|feed limits the formats.

   Capture is frame by frame: while a shot records, the page's clock
   (performance.now, Date.now, requestAnimationFrame, timers) is ours, and it
   moves exactly one frame between screenshots. However slow a screenshot is,
   the video plays at a steady 30 fps and at full resolution. */
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.GAME_URL || 'http://localhost:8765/';
const FPS = 30;
const FORMATS = {
  // CSS size at 2x: the video is 1080 wide and the HUD reads like on a phone
  story: { width: 540, height: 960 },     // Instagram story, 9:16 -> 1080x1920
  feed: { width: 540, height: 675 },      // LinkedIn feed, 4:5 -> 1080x1350
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- the page's clock ------------------------------------------------------
   Installed before the game loads. Native until __vt.start(); after that,
   time moves only in __vt.step(ms). */
function clockShim() {
  const realNow = performance.now.bind(performance);
  const realDate = Date.now;
  const realRAF = window.requestAnimationFrame.bind(window);
  const realST = window.setTimeout.bind(window);
  const realCT = window.clearTimeout.bind(window);
  const realSI = window.setInterval.bind(window);
  const realCI = window.clearInterval.bind(window);
  const vt = { on: false, now: 0, dateBase: 0, raf: [], timers: new Map(), id: 1e6 };
  window.__vt = vt;
  performance.now = () => (vt.on ? vt.now : realNow());
  Date.now = () => (vt.on ? vt.dateBase + vt.now : realDate());
  window.requestAnimationFrame = (cb) => {
    if (!vt.on) return realRAF(cb);
    vt.raf.push(cb);
    return 0;
  };
  window.setTimeout = (fn, ms, ...a) => {
    if (!vt.on) return realST(fn, ms, ...a);
    const id = ++vt.id;
    vt.timers.set(id, { at: vt.now + (+ms || 0), fn, a });
    return id;
  };
  window.clearTimeout = (id) => { vt.timers.delete(id); realCT(id); };
  window.setInterval = (fn, ms, ...a) => {
    if (!vt.on) return realSI(fn, ms, ...a);
    const id = ++vt.id;
    vt.timers.set(id, { at: vt.now + (+ms || 0), fn, a, every: Math.max(1, +ms || 0) });
    return id;
  };
  window.clearInterval = (id) => { vt.timers.delete(id); realCI(id); };
  vt.start = () => {
    vt.now = realNow(); vt.dateBase = realDate() - vt.now; vt.on = true;
    // the game's loop is already waiting on a real frame: it re-queues into ours
  };
  vt.step = (ms) => {
    vt.now += ms;
    for (;;) {                                // due timers, in order
      let next = null;
      for (const [id, t] of vt.timers) if (t.at <= vt.now && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      if (t.every) t.at += t.every; else vt.timers.delete(id);
      try { t.fn(...t.a); } catch (e) { console.error(e); }
    }
    const q = vt.raf; vt.raf = [];
    for (const cb of q) { try { cb(vt.now); } catch (e) { console.error(e); } }
  };
}

/* ---- in-page helpers, installed once the game is up ----------------------- */
function install() {
  const g = window.__blb;
  const css = document.createElement('style');
  css.id = 'promo-css';
  document.head.appendChild(css);
  window.__promo = {
    // 'clean': the scene, speech and any overlay; 'stats': plus the stats
    hud(mode) {
      css.textContent =
        '#lookhint,.blb-toasts,.blb-cross,.blb-plaque{display:none!important}' +
        (mode === 'clean' ? '.blb-stats,.blb-tr,.blb-prompt,.blb-hurt{display:none!important}' : '') +
        (mode === 'stats' ? '.blb-tr,.blb-prompt{display:none!important}' : '');
    },
    cine: null,                              // a scripted camera, see cine()
  };
  // every sound the game plays, with its time, so it can be re-rendered offline
  const sfx = g.sfx;
  // a shot can set `wash` (the surf level, for drone shots over the sea where
  // the player stands far from it) and `extra` sounds, e.g. gulls, at times
  window.__audio = { t0: null, log: [], lastWash: 0, wash: null, extra: [] };
  for (const k of Object.keys(sfx)) {
    const d = Object.getOwnPropertyDescriptor(sfx, k);
    if (!d || typeof d.value !== 'function' || k === 'unlock' || k === 'dispose') continue;
    const f = d.value;
    sfx[k] = function (...a) {
      if (k === 'wash') __audio.lastWash = a[0];
      if (__audio.t0 != null && !(k === 'wash' && __audio.wash != null)) {
        __audio.log.push({ k, a, t: (performance.now() - __audio.t0) / 1000 });
      }
      return f.apply(this, a);
    };
  }
  // full 2x, not the game's 1.75 cap, so the video is sharp
  g.renderer.setPixelRatio(2);
  g.renderer.setSize(window.innerWidth, window.innerHeight);
  const render = g.renderer.render.bind(g.renderer);
  g.renderer.render = (scene, camera) => {
    const c = window.__promo.cine;
    if (c) {
      if (c.t0 == null) c.t0 = performance.now();
      const k = Math.min(1, (performance.now() - c.t0) / 1000 / c.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // ease in-out
      const L = (a, b) => a.map((v, i) => v + (b[i] - v) * e);
      const p = L(c.from, c.to), q = L(c.lookFrom, c.lookTo);
      camera.position.set(p[0], p[1], p[2]);
      camera.rotation.set(0, 0, 0);
      camera.lookAt(q[0], q[1], q[2]);
    }
    render(scene, camera);
  };
  // lay a straight path of tiles from row j0 to j1, `half` cells either side
  window.path = (j0, j1, half) => {
    for (let j = j0; j <= j1; j++) for (let i = -half; i <= half; i++) {
      if (g.sim.place(i, j, 0, g.state.elapsed)) g.tiles.add(i, j, 0);
    }
  };
  // stand somewhere facing yaw, looking pitch
  window.at = (x, z, yaw, pitch) => {
    g.body.pos.x = x; g.body.pos.z = z; g.body.pos.y = 3;
    if (g.body.vel) { g.body.vel.x = 0; g.body.vel.y = 0; g.body.vel.z = 0; }
    g.cam.yaw = yaw; g.cam.pitch = pitch;
  };
  // move the camera from -> to (looking lookFrom -> lookTo) over dur seconds
  window.cine = (dur, from, to, lookFrom, lookTo) => {
    __promo.cine = { dur, from, to, lookFrom, lookTo };
  };
}

async function startGame(page) {
  await page.evaluate(async () => {
    [...document.querySelectorAll('button')].find((b) => b.offsetParent && /Yalla/.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 600));
    if (window.__blb.resume) window.__blb.resume();
  });
}

/* ---- the shots ------------------------------------------------------------
   setup(page) runs before recording; play(page, wait) while it records, where
   `await wait(seconds)` records that much video. Game time S.elapsed sets the
   light: ~60 day, ~125 golden hour, ~212 night. */
const SHOTS = {
  // a slow drone move from the sea toward the corniche at golden hour
  establish: {
    async setup(page) {
      await page.evaluate(() => {
        window.__blb.state.elapsed = 122;
        path(0, 13, 1);
        __promo.hud('clean');
        __audio.wash = 0.55;
        __audio.extra = [{ k: 'gull', a: [], t: 0.7 }, { k: 'gull', a: [], t: 3.4 }];
      });
    },
    async play(page, wait) {
      await page.evaluate(() => cine(6.5, [22, 15, 58], [9, 9, 36], [0, 1, 16], [-3, 2, 4]));
      await wait(6.5);
    },
  },

  // third person: the mason walks out, laying the row in front of him
  lay: {
    async setup(page) {
      await page.evaluate(() => {
        const g = window.__blb, S = g.state;
        S.elapsed = 100;
        path(0, 3, 1);
        S.mortarMax = 90; S.mortar = 90;
        at(0, 8, Math.PI, -0.1);
        g.cam.dist = 9; g.cam.tpPitch = 0.5; g.cam.yaw = Math.PI;
        __promo.hud('clean');
      });
      await page.keyboard.press('KeyV');
      await sleep(900);
    },
    async play(page, wait) {
      // hold the mouse where the ground ~1.5 cells ahead of him is on screen;
      // the camera follows him, so that spot stays ahead as he walks
      const p = await page.evaluate(() => {
        const g = window.__blb, v = g.camera.position.clone();
        v.set(g.body.pos.x, 0.3, g.body.pos.z + 3.0).project(g.camera);
        return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
      });
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.keyboard.down('KeyW');
      await wait(5.5);
      await page.keyboard.up('KeyW');
      await page.mouse.up();
      await wait(0.5);
    },
  },

  // first person: walk out onto the sea, laying a row as you go
  fplay: {
    async setup(page) {
      await page.evaluate(() => {
        const S = window.__blb.state;
        S.elapsed = 55;
        path(0, 4, 1);
        S.mortarMax = 90; S.mortar = 90;
        at(0, 9, Math.PI, -0.42);
        __promo.hud('stats');
      });
    },
    async play(page, wait) {
      const { width, height } = page.viewport();
      await page.mouse.move(width / 2, height / 2);
      await page.mouse.down();
      await page.keyboard.down('KeyW');
      await wait(5.2);
      await page.keyboard.up('KeyW');
      await page.mouse.up();
      await wait(0.6);
    },
  },

  // the mason with his barrow at the end of the path, the camera circling
  mason: {
    async setup(page) {
      await page.evaluate(() => {
        window.__blb.state.elapsed = 128;
        path(0, 10, 1);
        at(0, 23, Math.PI, -0.1);
        __promo.hud('clean');
      });
      await page.keyboard.press('KeyV');           // third person: the mason shows
    },
    async play(page, wait) {
      await page.evaluate(() => cine(6, [-9, 4.5, 31], [8, 5, 30], [0, 1.4, 23], [0, 1.4, 23]));
      await wait(6);
    },
  },

  // the Whish kiosk: open the app, pay for a bigger barrow, the receipt
  whish: {
    async setup(page) {
      await page.evaluate(() => {
        const g = window.__blb;
        g.state.elapsed = 60;
        g.state.lira = 860;
        const m = g.npcs.find((n) => n.def.shop);
        at(m.pos.x, m.pos.z + 1.7, 0, -0.08);
        __promo.hud('clean');
      });
    },
    async play(page, wait) {
      await wait(0.7);
      await page.keyboard.press('KeyE');
      await wait(1.9);
      await page.click('.wh-pay');
      await wait(2.6);
    },
  },

  // hit Abou Nabil; he hits back, and you wake up in hospital
  hit: {
    async setup(page) {
      await page.evaluate(() => {
        const g = window.__blb;
        g.state.elapsed = 70;
        g.state.hp = 6;
        // stand in front of him, the way he faces, looking at him
        const n = g.npcs.find((x) => x.def.name === 'Abou Nabil');
        const r = n.rig.group.rotation.y;
        at(n.pos.x + Math.sin(r) * 1.35, n.pos.z + Math.cos(r) * 1.35, r, -0.1);
        __promo.hud('clean');
      });
    },
    async play(page, wait) {
      const { width, height } = page.viewport();
      await wait(0.6);
      await page.mouse.click(width / 2, height / 2);
      await wait(6.2);
    },
  },

  // ask Abou Ali for the boat, then a drone shot of Jazirat Ziri
  ziri: {
    async setup(page) {
      await page.evaluate(() => {
        const g = window.__blb;
        g.state.elapsed = 112;
        g.state.lira = 200;
        const n = g.npcs.find((x) => x.def.ferryTo === 'ziri');
        const r = n.rig.group.rotation.y;
        at(n.pos.x + Math.sin(r) * 1.6, n.pos.z + Math.cos(r) * 1.6, r, -0.04);
        __promo.hud('clean');
      });
    },
    async play(page, wait) {
      await wait(0.5);
      await page.keyboard.press('KeyE');          // the boat: a fade, then the island
      await wait(0.75);
      await page.keyboard.press('KeyV');          // third person: the mason on the island
      await page.evaluate(() => {
        const t = (performance.now() - __audio.t0) / 1000;
        __audio.log.push({ k: 'wash', a: [0.5], t }, { k: 'gull', a: [], t: t + 1.4 });
        __audio.wash = 0.5;
        const z = window.__blb.world.ziri;
        cine(5, [z.x - 34, 15, z.z - 30], [z.x - 22, 11, z.z - 22], [z.x, 2, z.z - 4], [z.x - 2, 2.5, z.z - 8]);
      });
      await wait(4.6);
    },
  },

  // the Souk el Akel stalls: the mason buys a Soubras, then a falafel next door
  food: {
    async setup(page) {
      await page.evaluate(() => {
        const g = window.__blb, S = g.state;
        S.elapsed = 104;
        S.lira = 200; S.health = 30; S.hp = 60;
        const n = g.npcs.find((x) => x.def.sells === 'soubras');
        if (n.def.catchphrase) n.def.catchphrase.p = 1;   // his line, every time, for the video
        const r = n.rig.group.rotation.y;
        at(n.pos.x + Math.sin(r) * 2.2, n.pos.z + Math.cos(r) * 2.2, r + Math.PI, 0);
        g.cam.yaw = r;     // so D walks him along the counter
        __promo.hud('clean');
        // low and a little to the side, along the counter
        // the "your ad here" board over the stalls carries contact details: not in a promo
        for (const k in g.boards) if (g.boards[k].slot.id === 'souk') g.boards[k].group.visible = false;
        cine(7.5, [n.pos.x - 6.5, 2.6, n.pos.z + 9.5], [n.pos.x - 3, 2.4, n.pos.z + 8],
             [n.pos.x + 1.5, 2.0, n.pos.z], [n.pos.x + 4, 2.0, n.pos.z]);
      });
      await page.keyboard.press('KeyV');
    },
    async play(page, wait) {
      await page.evaluate(() => { __promo.cine.t0 = null; });
      await wait(0.5);
      await page.keyboard.press('KeyE');
      await wait(2.6);
      await page.keyboard.down('KeyD');
      await wait(1.25);
      await page.keyboard.up('KeyD');
      await wait(0.3);
      await page.keyboard.press('KeyE');
      await wait(2.6);
    },
  },

  // the closing shot: high over the corniche, a long path out to sea at sunset
  outro: {
    async setup(page) {
      await page.evaluate(() => {
        window.__blb.state.elapsed = 134;
        path(0, 34, 1);
        at(0, 60, Math.PI, -0.1);
        __promo.hud('clean');
        __audio.wash = 0.45;
        __audio.extra = [{ k: 'gull', a: [], t: 1.6 }, { k: 'gull', a: [], t: 4.8 }];
      });
      await page.keyboard.press('KeyV');
    },
    async play(page, wait) {
      await page.evaluate(() => cine(7, [-6, 16, -14], [-2, 12, -4], [2, 0, 40], [2, 0, 60]));
      await wait(7);
    },
  },
};

/* ---- sound ------------------------------------------------------------------
   Replays the logged calls through the game's own audio code (BLB_HUD's
   createAudio) into an OfflineAudioContext, each at its frame's time, and
   returns a 16-bit stereo WAV as base64. */
async function renderAudio(dur) {
  __vt.on = false;                             // the audio code's own timers run for real
  const SR = 48000;
  const off = new OfflineAudioContext(2, Math.ceil((dur + 0.05) * SR), SR);
  const RealAC = window.AudioContext;
  window.AudioContext = function () { return off; };
  const a = BLB_HUD.createAudio();
  window.AudioContext = RealAC;
  a.muted = false;
  a.unlock();
  // OfflineAudioContext can pause at a render quantum (128 frames): group calls by quantum
  const groups = new Map();
  for (const e of __audio.log) {
    const q = Math.max(0, Math.round(e.t * SR / 128));
    if (!groups.has(q)) groups.set(q, []);
    groups.get(q).push(e);
  }
  const fire = (list) => { for (const e of list) { try { a[e.k](...e.a); } catch (err) { /* ignore */ } } };
  for (const [q, list] of groups) {
    if (q === 0) { fire(list); continue; }
    const t = q * 128 / SR;
    if (t >= dur) continue;
    off.suspend(t).then(() => { fire(list); off.resume(); });
  }
  const buf = await off.startRendering();
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = buf.length, bytes = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); bytes.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 2, true);
  bytes.setUint32(24, SR, true); bytes.setUint32(28, SR * 4, true); bytes.setUint16(32, 4, true);
  bytes.setUint16(34, 16, true); str(36, 'data'); bytes.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    bytes.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    bytes.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  const u8 = new Uint8Array(bytes.buffer);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* ---- recording ------------------------------------------------------------ */
async function record(page, shot, out) {
  const cdp = await page.createCDPSession();
  const dir = mkdtempSync(join(tmpdir(), 'blb-frames-'));
  let n = 0;
  await page.evaluate(() => {
    __vt.start();
    __audio.t0 = performance.now();
    __audio.log = [{ k: 'wash', a: [__audio.wash != null ? __audio.wash : __audio.lastWash], t: 0 }]
      .concat(__audio.extra);
  });
  // the game samples its own frame rate and drops to 1x pixels below 42 fps,
  // so the clock runs at 60 fps and every second frame is kept
  const wait = async (seconds) => {
    const frames = Math.round(seconds * FPS);
    for (let f = 0; f < frames; f++) {
      await page.evaluate(() => { __vt.step(1000 / 60); __vt.step(1000 / 60); });
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
      writeFileSync(join(dir, String(n++).padStart(5, '0') + '.jpg'), Buffer.from(data, 'base64'));
    }
  };
  await shot.play(page, wait);
  await cdp.detach();
  const wav = await page.evaluate(renderAudio, n / FPS);
  writeFileSync(out.replace(/\.mp4$/, '.wav'), Buffer.from(wav, 'base64'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%05d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'medium', '-an', out]);
  rmSync(dir, { recursive: true, force: true });
  return n;
}

/* ---- runner --------------------------------------------------------------- */
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SHOTS);
const formats = process.env.FORMAT ? [process.env.FORMAT] : Object.keys(FORMATS);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--force-device-scale-factor=2'],
});
try {
  for (const fmt of formats) {
    const dir = `public/clips/${fmt}`;
    mkdirSync(dir, { recursive: true });
    for (const name of names) {
      const shot = SHOTS[name];
      if (!shot) { console.log('no such shot:', name); continue; }
      // a fresh profile each shot: no save, no settings, a clean start
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ ...FORMATS[fmt], deviceScaleFactor: 2 });
      page.on('pageerror', (e) => console.log('  pageerror', e.message));
      await page.evaluateOnNewDocument(clockShim);
      await page.goto(URL + '?promo', { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(install);
      await startGame(page);
      await shot.setup(page);
      await sleep(1200);                       // let the scene settle
      const t = Date.now();
      const frames = await record(page, shot, `${dir}/${name}.mp4`);
      await ctx.close();
      console.log(`${fmt}/${name}.mp4  ${(frames / FPS).toFixed(1)}s  (${((Date.now() - t) / 1000).toFixed(0)}s to capture)`);
    }
  }
} finally {
  await browser.close();
}
