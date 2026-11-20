/* ============================================================================
 * BALLET L BA7ER — hud.js   →   window.BLB_HUD
 *
 * The 2D overlay + all procedural audio. Plain script, no modules, no deps.
 * Visual language: Lebanese public-works signage and a tiler's worksite.
 * Stencilled condensed capitals, hazard yellow, municipal stamps, screen-print
 * misregistration, limestone paper gone slightly soft in the salt air.
 *
 * Contract: see SPEC.md section C.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ---------------------------------------------------------------- palette */
  // Authoritative hues from SPEC.md. Used as fallbacks when the game does not
  // pass a palette, and as the canonical source for the CSS custom properties.
  const P = {
    SEA_DEEP: '#0B3A4F', SEA_MID: '#16708C', SEA_SHALLOW: '#3FA8B4',
    FOAM: '#EDF6F3', SKY_TOP: '#6FC3DE', SKY_HAZE: '#D9EEF2',
    LIMESTONE: '#E4D7B3', STONE_DARK: '#A08F6A', STONE_WET: '#7D6E4F',
    TERRACOTTA: '#B9502F', CEMENT: '#9AA0A0', RUST: '#8C4A2F',
    PALM_GREEN: '#3F6B3A', PALM_LIGHT: '#5E8C3F', TRUNK: '#7A6245',
    SUN: '#F6C445', HAZARD: '#F2B733', NIGHT_TOP: '#0A1A33',
    SKIN: '#C98A5E', SHIRT: '#E8E2D4', DENIM: '#3B5C73'
  };

  // Mirrors the SPEC tier table. Only used when `tiers` is absent or partial.
  const TIER_FALLBACK = [
    { id: 'ramleh', name: 'Ramleh mix',    ar: 'رملة',  hp: 8,   mortar: 1, lira: 0,   color: '#CDBD92' },
    { id: 'beton',  name: 'Beton',         ar: 'باطون', hp: 22,  mortar: 1, lira: 40,  color: '#9AA0A0' },
    { id: 'qarmid', name: 'Qarmid azraq',  ar: 'قرميد', hp: 55,  mortar: 2, lira: 180, color: '#2E7FA8' },
    { id: 'marble', name: 'Rmeyleh marble', ar: 'رميلة', hp: 130, mortar: 3, lira: 600, color: '#EFE7DA' }
  ];

  // Default unlock / upgrade prices shown in the kiosk. The game owns the real
  // economy — these are display defaults, overridable via state.prices.
  const PRICE = {
    'unlock:beton': 150, 'unlock:qarmid': 700, 'unlock:marble': 2400,
    mortar: 60, barrow: 300, shabeb: 450, flood: 600
  };

  /* The maker, shown in the credits. Billboard space is sold by email. */
  const CONTACT = {
    github: 'https://github.com/Merhii',
    linkedin: 'https://www.linkedin.com/in/karimmerhi',
    email: 'mmerhikarim@gmail.com'
  };

  /* --------------------------------------------------------------- heckles */
  // The uncle on the railing. Deadpan, affectionate, never cruel.
  const HECKLES = [
    'shu 3am ta3mel ya 3ammi?',
    'khalas, rou2 3a 7alak.',
    'el ba7er kén hon 2abel bayyi.',
    'ibn khalte jarrab. halla2 bibi3 ka3ke.',
    'yi, 7aram el mouna.',
    'ya3ni el ba7er talab balat?',
    'ba3ref shater, bass el ba7er a3raf.',
    'rou7 3a el bét, immak 3emlet mjaddara.',
    'el baladiyye b3erfe b hal shaghle?',
    'hott wa7de 3anne, hon, 3and el zawiye.',
    'b el shite rah tebke ya m3allem.',
    '3a el a2all el fawasel mestawye. mabrouk.',
    'wallah ma w2eft. ya3tik el 3afye.',
    'tayyeb. tayyeb. sart tfout b 3a2le shwayy.',
    'jiblé 2ahwe w bemsek el mizan.',
    'el samak 3am yeshteke 3and el mokhtar.',
    'yalla, saff kamén w rayé7 ekol.'
  ];

  /* ---------------------------------------------------------------- helpers */
  let UID = 0;
  const uid = () => 'blb' + (++UID);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 1234567 -> "1,234,567"
  function fmt(n) {
    n = Math.round(num(n, 0));
    const neg = n < 0; n = Math.abs(n);
    let s = String(n), out = '';
    while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
    return (neg ? '-' : '') + s + out;
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // Keys the game is likely to name in prompts get drawn as little keycaps.
  // Bracketed spans ("[E]") are also accepted and unwrapped first.
  const KEYRX = /\b(WASD|SPACE|SHIFT|RIGHT-DRAG|RIGHT-CLICK|CLICK|ARROWS|SCROLL|ESC|TAB|ENTER|[EFBMQRGH]|[1-4])\b/gi;
  function promptMarkup(text) {
    const stripped = String(text).replace(/\[([^\]]{1,14})\]/g, '$1');
    return esc(stripped).replace(KEYRX, function (m) {
      return '<kbd class="blb-kbd">' + m.toUpperCase() + '</kbd>';
    });
  }

  /* ------------------------------------------------------- concrete grain */
  // A speckle tile baked once on a canvas and handed to CSS as a data URI.
  // No network, and it is what keeps the panels from looking like glass.
  let GRAIN = null;
  function grain() {
    if (GRAIN) return GRAIN;
    try {
      const s = 72, c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d'), img = g.createImageData(s, s), d = img.data;
      for (let i = 0; i < s * s; i++) {
        const r = Math.random();
        // mostly nothing, occasional dark fleck and a rarer light one
        let a = 0, v = 0;
        if (r > 0.86) { a = 18 + Math.random() * 42; v = 20; }
        else if (r > 0.80) { a = 10 + Math.random() * 26; v = 250; }
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
        d[i * 4 + 3] = a;
      }
      g.putImageData(img, 0, 0);
      GRAIN = c.toDataURL('image/png');
    } catch (e) { GRAIN = ''; }
    return GRAIN;
  }

  /* ----------------------------------------------------------- font + css */
  let FONTS_DONE = false;
  function injectFonts() {
    if (FONTS_DONE) return;
    FONTS_DONE = true;
    const pre = el('link'); pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com';
    pre.crossOrigin = '';
    const l = el('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&' +
             'family=Reem+Kufi:wght@400;500;600;700&display=swap';
    document.head.appendChild(pre);
    document.head.appendChild(l);
  }

  let CSS_DONE = false;
  function injectStyle() {
    if (CSS_DONE) return;
    CSS_DONE = true;
    const s = el('style');
    s.id = 'blb-hud-style';
    s.textContent = STYLE + '\n' + STYLE2 + '\n' + STYLE3 + '\n' + STYLE4;
    document.head.appendChild(s);
  }

  const STYLE = [
'.blb{position:absolute;top:0;left:0;right:0;bottom:0;inset:0;overflow:hidden;',
'  pointer-events:none;z-index:10;font-family:var(--blb-sans);color:var(--blb-ink);',
'  font-size:15px;line-height:1.25;-webkit-font-smoothing:antialiased;',
'  text-rendering:optimizeLegibility;user-select:none;-webkit-user-select:none;}',
'.blb *{box-sizing:border-box;margin:0;padding:0;}',
'.blb button{font:inherit;color:inherit;border:0;cursor:pointer;}',
'.blb button.blb-plaque{background-color:var(--blb-paper);',
'  background-image:var(--blb-grain);}',
'.blb :focus{outline:none;}',
'.blb :focus-visible{outline:3px solid var(--blb-haz);outline-offset:2px;',
'  box-shadow:0 0 0 5px rgba(11,58,79,.55);}',

/* --- shared print devices ------------------------------------------------ */
/* hazard chevrons: the yellow-and-ink diagonal on every public-works barrier */
'.blb-haz{background-image:repeating-linear-gradient(115deg,var(--blb-haz) 0 9px,',
'  var(--blb-ink) 9px 18px);}',
/* limestone plaque: paper + grain + a hard offset shadow, no blur, no radius */
'.blb-plaque{position:relative;background-color:var(--blb-paper);',
'  background-image:var(--blb-grain);background-repeat:repeat;',
'  border:2px solid var(--blb-ink);box-shadow:3px 3px 0 0 var(--blb-shadow);',
'  border-radius:1px;}',
/* the screen-print is slightly off-register: ink body, terracotta ghost */
'.blb-print{text-shadow:1.5px 1.3px 0 var(--blb-ghost);}',
'.blb-lbl{font-weight:600;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;',
'  color:var(--blb-ink);opacity:.72;}',
'.blb-ar{font-family:var(--blb-kufi);font-weight:500;direction:rtl;}',
'.blb-n{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;',
'  font-weight:700;letter-spacing:.005em;}',
'.blb-kbd{display:inline-block;min-width:1.5em;padding:1px 5px 2px;margin:0 .18em;',
'  font-family:var(--blb-sans);font-weight:700;font-size:.86em;letter-spacing:.06em;',
'  background:var(--blb-haz);color:var(--blb-ink);border:1.5px solid var(--blb-ink);',
'  border-bottom-width:3px;border-radius:2px;text-align:center;text-shadow:none;}',

/* --- phase warmth -------------------------------------------------------- */
/* one full-bleed wash so the overlay sits in the same light as the 3D scene */
'.blb-wash{position:absolute;inset:0;pointer-events:none;',
'  transition:background 2.4s linear,opacity 2.4s linear;opacity:0;}',
'.blb[data-phase="dusk"] .blb-wash{opacity:.52;background:',
'  radial-gradient(118% 96% at 50% 104%,rgba(246,196,69,.40),',
'  rgba(185,80,47,.26) 42%,rgba(185,80,47,0) 70%);}',
'.blb[data-phase="night"] .blb-wash{opacity:.6;background:',
'  radial-gradient(128% 108% at 50% -8%,rgba(10,26,51,.46),rgba(10,26,51,0) 62%);}',
'.blb[data-phase="dusk"]{--blb-paper:#DCCBA4;}',
'.blb[data-phase="night"]{--blb-paper:#CFC0A0;--blb-shadow:rgba(10,26,51,.85);}',

/* --- stats cluster ------------------------------------------------------- */
'.blb-stats{position:absolute;top:14px;left:14px;width:min(304px,44vw);min-width:0;',
'  display:grid;gap:7px;}',

/* hero: metres reclaimed. the only big number on the screen. */
'.blb-hero{padding:0 0 7px;}',
'.blb-hero .cap{height:7px;}',
'.blb-hero .in{padding:7px 11px 0;}',
'.blb-hero .fig{display:flex;align-items:baseline;gap:5px;}',
'.blb-hero .fig .v{font-size:clamp(32px,7vw,54px);line-height:.82;',
'  font-variant-numeric:tabular-nums;font-weight:700;letter-spacing:-.018em;',
'  text-shadow:2px 2px 0 var(--blb-ghost);}',
'.blb-hero .fig .u{font-size:15px;font-weight:600;opacity:.6;letter-spacing:.02em;}',
'.blb-hero .en{margin-top:5px;font-weight:700;font-size:11px;letter-spacing:.1em;',
'  text-transform:uppercase;line-height:1.1;}',
'.blb-hero .arl{font-size:13px;opacity:.68;margin-top:1px;}',
'.blb-hero .rule{height:3px;margin:6px 11px 0;background:var(--blb-ink);opacity:.25;}',

/* wheelbarrow: mortar as a thing that visibly empties */
'.blb-barrow{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:9px;',
'  padding:7px 11px 8px;}',
'.blb-barrow svg{display:block;width:76px;height:46px;overflow:visible;}',
'.blb-barrow .mline{display:flex;align-items:baseline;gap:4px;margin-top:2px;}',
'.blb-barrow .mv{font-size:21px;line-height:1;font-variant-numeric:tabular-nums;',
'  font-weight:700;}',
'.blb-barrow .mm{font-size:12px;opacity:.6;font-variant-numeric:tabular-nums;}',
'.blb-barrow.low .mv{color:var(--blb-terra);}',
'.blb-barrow.low svg .tray{stroke:var(--blb-terra);}',

/* three small readouts in a row: tiles, lira, shabeb */
'.blb-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;}',
'.blb-cell{padding:5px 7px 6px;min-width:0;}',
'.blb-cell .v{font-size:clamp(17px,4.2vw,22px);line-height:1.05;font-weight:700;',
'  font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;',
'  text-overflow:clip;}',
'.blb-cell .k{font-size:9.5px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;',
'  opacity:.7;white-space:nowrap;}',
'.blb-cell.lira .v{color:var(--blb-rust);}',

/* sea state: gets ominous on its own */
'.blb-sea{padding:6px 9px 7px;}',
'.blb-sea .hd{display:flex;align-items:baseline;justify-content:space-between;gap:6px;}',
'.blb-sea .nm{font-size:12.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;}',
'.blb-sea .ar{font-size:12px;opacity:.7;}',
'.blb-sea svg{display:block;width:100%;height:26px;margin-top:3px;}',
'.blb-sea .pips{display:flex;gap:3px;margin-top:4px;}',
'.blb-sea .pips i{flex:1;height:4px;background:var(--blb-ink);opacity:.16;}',
'.blb-sea .pips i.on{opacity:1;background:var(--blb-swell);}',
'.blb-sea.squall{border-color:var(--blb-rust);}',
'.blb-sea.squall .cap{height:6px;margin:-6px -9px 5px;}',
'.blb-sea.squall .nm{color:var(--blb-rust);}',

/* --- crosshair + prompt -------------------------------------------------- */
'.blb-cross{position:absolute;left:50%;top:50%;width:26px;height:26px;',
'  transform:translate(-50%,-50%);transition:opacity .2s;}',
'.blb-cross i{position:absolute;background:var(--blb-foam);',
'  box-shadow:0 0 0 1px rgba(11,58,79,.55);}',
'.blb-cross i:nth-child(1){left:50%;top:0;width:2px;height:8px;margin-left:-1px;}',
'.blb-cross i:nth-child(2){left:50%;bottom:0;width:2px;height:8px;margin-left:-1px;}',
'.blb-cross i:nth-child(3){top:50%;left:0;height:2px;width:8px;margin-top:-1px;}',
'.blb-cross i:nth-child(4){top:50%;right:0;height:2px;width:8px;margin-top:-1px;}',
'.blb-cross i:nth-child(5){left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;}',
'.blb-cross[data-r="ok"] i{background:var(--blb-haz);}',
'.blb-cross[data-r="bad"] i{background:var(--blb-terra);}',
'.blb-cross[data-r="ok"]{transform:translate(-50%,-50%) scale(1.14);}',
'.blb-cross[data-r="none"]{opacity:0;}',

'.blb-prompt{position:absolute;left:50%;top:50%;transform:translate(-50%,0);',
'  margin-top:30px;max-width:min(440px,88vw);display:flex;align-items:stretch;',
'  background:var(--blb-ink);color:var(--blb-foam);border:1.5px solid var(--blb-ink);',
'  box-shadow:2px 2px 0 rgba(10,26,51,.5);opacity:0;transition:opacity .14s;}',
'.blb-prompt.on{opacity:1;}',
'.blb-prompt .bar{width:6px;flex:0 0 6px;}',
'.blb-prompt .tx{padding:5px 11px 6px;font-size:13.5px;font-weight:600;',
'  letter-spacing:.055em;text-transform:uppercase;text-align:center;}',

/* --- toasts -------------------------------------------------------------- */
'.blb-toasts{position:absolute;top:58px;right:14px;width:min(290px,58vw);',
'  display:grid;gap:7px;justify-items:stretch;}',
'.blb-toast{display:flex;align-items:stretch;overflow:hidden;',
'  transform:translateX(0) rotate(-.4deg);}',
'.blb-toast .bar{width:7px;flex:0 0 7px;background:var(--blb-sm);}',
'.blb-toast .tx{padding:6px 9px 7px;font-size:13px;font-weight:600;letter-spacing:.02em;}',
'.blb-toast.good .bar{background:var(--blb-palm);}',
'.blb-toast.bad .bar{background:var(--blb-terra);}',
'.blb-toast.bad{border-color:var(--blb-rust);}',
'.blb-toast.in{animation:blb-slap .26s cubic-bezier(.2,1.5,.4,1) both;}',
'.blb-toast.out{opacity:0;transform:translateX(14px) rotate(-.4deg);',
'  transition:opacity .3s,transform .3s;}',
'@keyframes blb-slap{from{opacity:0;transform:translateX(15px) rotate(2.2deg) scale(.96);}',
'  to{opacity:1;transform:translateX(0) rotate(-.4deg) scale(1);}}',

/* --- heckler ------------------------------------------------------------- */
'.blb-heckle{position:absolute;left:14px;bottom:34%;width:min(320px,56vw);',
'  padding:9px 12px 11px;transform:rotate(-.8deg);opacity:0;}',
'.blb-heckle .who{display:flex;align-items:center;gap:6px;margin-bottom:3px;}',
'.blb-heckle .stamp{width:19px;height:19px;flex:0 0 19px;border:1.5px solid var(--blb-rust);',
'  border-radius:50%;color:var(--blb-rust);font-family:var(--blb-kufi);font-size:12px;',
'  line-height:16px;text-align:center;}',
'.blb-heckle .nm{font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;',
'  color:var(--blb-rust);}',
'.blb-heckle .tx{font-size:15.5px;line-height:1.28;font-weight:500;}',
'.blb-heckle .tail{position:absolute;left:22px;bottom:-9px;width:14px;height:14px;',
'  background-color:var(--blb-paper);background-image:var(--blb-grain);',
'  border-right:2px solid var(--blb-ink);border-bottom:2px solid var(--blb-ink);',
'  transform:rotate(52deg) skewX(-8deg);}',
'.blb-heckle.in{opacity:1;animation:blb-pop .28s cubic-bezier(.2,1.6,.4,1) both;}',
'.blb-heckle.out{opacity:0;transition:opacity .4s;}',
'@keyframes blb-pop{from{opacity:0;transform:rotate(-5deg) scale(.9) translateY(8px);}',
'  to{opacity:1;transform:rotate(-.8deg) scale(1) translateY(0);}}',

/* --- stamina ------------------------------------------------------------- */
'.blb-hp{padding:7px 9px 8px;}',
'.blb-hp .top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}',
'.blb-hp .k{font-size:9.5px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;',
'  color:var(--blb-ink);opacity:.72;}',
'.blb-hp .ar{font-family:var(--blb-kufi);font-size:11px;opacity:.6;}',
'.blb-hp .track{position:relative;height:13px;margin-top:5px;border:2px solid var(--blb-ink);',
'  background:rgba(11,58,79,.10);overflow:hidden;}',
'.blb-hp .fill{position:absolute;inset:0;width:100%;transform-origin:left center;',
'  background:var(--blb-ss);transition:transform .18s linear,background-color .3s;}',
'.blb-hp.low .fill{background:var(--blb-haz);}',
'.blb-hp.out .fill{background:var(--blb-rust);}',
'.blb-hp .pips{position:absolute;inset:0;display:flex;}',
'.blb-hp .pips i{flex:1 1 0;border-right:2px solid rgba(228,215,179,.55);}',
'.blb-hp .pips i:last-child{border-right:0;}',

/* --- NPC speech, anchored to a projected world position ------------------ */
'.blb-saylayer{position:absolute;inset:0;overflow:hidden;pointer-events:none;}',
'.blb-say{position:absolute;display:none;transform:translate(-50%,-100%);',
'  width:max-content;max-width:min(258px,52vw);padding:7px 11px 9px;',
'  background-color:var(--blb-paper);background-image:var(--blb-grain);',
'  border:2px solid var(--blb-ink);opacity:0;will-change:left,top;}',
'.blb-say .nm{font-size:9.5px;font-weight:700;letter-spacing:.15em;',
'  text-transform:uppercase;color:var(--blb-rust);margin-bottom:2px;}',
'.blb-say .tx{font-size:14.5px;line-height:1.26;font-weight:500;color:var(--blb-ink);}',
'.blb-say .ar{font-family:var(--blb-kufi);font-size:12.5px;color:var(--blb-ink);',
'  opacity:.6;margin-top:3px;direction:rtl;}',
'.blb-say .tail{position:absolute;left:50%;bottom:-8px;margin-left:-6px;width:12px;height:12px;',
'  background-color:var(--blb-paper);background-image:var(--blb-grain);',
'  border-right:2px solid var(--blb-ink);border-bottom:2px solid var(--blb-ink);',
'  transform:rotate(45deg);}',
'.blb-say.in{opacity:1;animation:blb-say-pop .24s cubic-bezier(.2,1.6,.4,1) both;}',
'@keyframes blb-say-pop{from{opacity:0;transform:translate(-50%,-100%) scale(.86);}',
'  to{opacity:1;transform:translate(-50%,-100%) scale(1);}}',
'@media (prefers-reduced-motion: reduce){.blb-say.in{animation:none;}}',
''].join('\n');

  const STYLE2 = [
/* --- top-right chrome ---------------------------------------------------- */
'.blb-tr{position:absolute;top:14px;right:14px;display:flex;align-items:flex-start;gap:7px;}',
'.blb-phase{padding:4px 8px 5px;font-size:10px;font-weight:700;letter-spacing:.15em;',
'  text-transform:uppercase;pointer-events:none;}',
'.blb-snd{pointer-events:auto;width:34px;height:30px;display:grid;place-items:center;}',
'.blb-snd:hover{background-color:var(--blb-haz);}',
'.blb-snd svg{width:18px;height:18px;display:block;}',
'.blb-snd .mute{display:none;}',
'.blb-snd[aria-pressed="true"] .mute{display:block;}',
'.blb-snd[aria-pressed="true"] .live{display:none;}',
'.blb-snd[aria-pressed="true"]{color:var(--blb-rust);}',

/* --- tier selector ------------------------------------------------------- */
'.blb-tiers{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);',
'  display:flex;gap:9px;justify-content:center;align-items:stretch;',
'  max-width:calc(100vw - 24px);}',
'.blb-tier{pointer-events:auto;position:relative;width:112px;padding:0 0 5px;',
'  text-align:left;overflow:hidden;transition:transform .12s,box-shadow .12s;}',
'.blb-tier .sw{height:17px;border-bottom:2px solid var(--blb-ink);',
'  box-shadow:inset 0 -3px 0 rgba(11,58,79,.14);}',
'.blb-tier .k{position:absolute;top:0;left:0;width:17px;height:17px;',
'  background:var(--blb-ink);color:var(--blb-haz);font-size:11px;font-weight:700;',
'  line-height:17px;text-align:center;border-right:2px solid var(--blb-ink);}',
'.blb-tier .nm{margin:5px 7px 0;font-size:12.5px;font-weight:700;letter-spacing:.055em;',
'  text-transform:uppercase;line-height:1.08;}',
'.blb-tier .arn{margin:0 7px;font-size:12px;opacity:.6;}',
'.blb-tier .mt{margin:3px 7px 0;display:flex;flex-wrap:wrap;gap:1px 7px;font-size:10px;',
'  font-weight:600;letter-spacing:.05em;opacity:.78;font-variant-numeric:tabular-nums;}',
'.blb-tier .mt span{white-space:nowrap;}',
'.blb-tier:hover{transform:translateY(-2px);}',
'.blb-tier[aria-pressed="true"]{box-shadow:3px 3px 0 0 var(--blb-shadow),',
'  inset 0 0 0 3px var(--blb-haz);transform:translateY(-4px) rotate(-.6deg);}',
'.blb-tier[aria-pressed="true"] .k{background:var(--blb-haz);color:var(--blb-ink);}',
/* locked: hatched over, but the glaze colour stays honest so it still tempts */
'.blb-tier.lk .nm,.blb-tier.lk .arn,.blb-tier.lk .mt{opacity:.42;}',
'.blb-tier.lk{border-color:var(--blb-cement);}',
'.blb-tier.lk:after{content:"";position:absolute;inset:17px 0 0;pointer-events:none;',
'  background-image:repeating-linear-gradient(135deg,transparent 0 6px,',
'  rgba(11,58,79,.14) 6px 7px);}',
'.blb-tier .px{margin:3px 7px 0;font-size:10px;font-weight:700;letter-spacing:.08em;',
'  text-transform:uppercase;color:var(--blb-rust);display:none;position:relative;z-index:1;',
'  font-variant-numeric:tabular-nums;}',
'.blb-tier.lk .px{display:block;}',

/* --- loading ------------------------------------------------------------- */
'.blb-load{position:absolute;left:0;right:0;bottom:0;height:9px;display:none;}',
'.blb-load.on{display:block;}',
'.blb-load .t{height:100%;background-image:repeating-linear-gradient(115deg,',
'  var(--blb-haz) 0 9px,var(--blb-ink) 9px 18px);width:0%;transition:width .25s linear;}',

/* --- shop: the muallim kiosk -------------------------------------------- */
'.blb-shop{position:absolute;inset:0;display:none;align-items:center;',
'  justify-content:center;padding:18px 12px;pointer-events:auto;',
'  background:radial-gradient(120% 90% at 50% 40%,rgba(22,112,140,.62),rgba(11,58,79,.88));}',
'.blb-shop.on{display:flex;}',
'.blb-kiosk{position:relative;width:min(720px,100%);max-height:calc(100vh - 36px);',
'  max-height:calc(100dvh - 36px);overflow-y:auto;overflow-x:hidden;',
'  box-shadow:6px 6px 0 0 rgba(10,26,51,.6);}',
/* two strips of tape holding the price list to the glass */
'.blb-kiosk:before,.blb-kiosk:after{content:"";position:absolute;top:-11px;width:76px;',
'  height:24px;background:rgba(237,246,243,.46);border-left:1px solid rgba(11,58,79,.18);',
'  border-right:1px solid rgba(11,58,79,.18);pointer-events:none;z-index:3;}',
'.blb-kiosk:before{left:12px;transform:rotate(-7deg);}',
'.blb-kiosk:after{right:12px;transform:rotate(5deg);}',
'.blb-kiosk .cap{height:9px;}',
'.blb-khd{padding:12px 16px 10px;border-bottom:2px solid var(--blb-ink);',
'  display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;}',
'.blb-khd h2{font-family:var(--blb-kufi);font-size:clamp(24px,5.4vw,34px);font-weight:600;',
'  line-height:1;text-shadow:2px 2px 0 var(--blb-ghost);}',
'.blb-khd .sub{font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;',
'  opacity:.7;margin-top:4px;}',
'.blb-khd .purse{text-align:right;}',
'.blb-khd .purse .v{font-size:clamp(20px,4.6vw,27px);font-weight:700;color:var(--blb-rust);',
'  font-variant-numeric:tabular-nums;line-height:1;}',
'.blb-close{pointer-events:auto;padding:5px 10px 6px;font-size:11px;font-weight:700;',
'  letter-spacing:.14em;text-transform:uppercase;border:2px solid var(--blb-ink);',
'  background:var(--blb-paper);}',
'.blb-close:hover{background:var(--blb-terra);color:var(--blb-foam);}',
'.blb-ksec{padding:11px 16px 4px;font-size:11px;font-weight:700;letter-spacing:.16em;',
'  text-transform:uppercase;opacity:.65;display:flex;align-items:center;gap:9px;}',
'.blb-ksec span:last-child{flex:1;height:2px;background:var(--blb-ink);opacity:.2;}',
'.blb-items{padding:0 16px 16px;display:grid;gap:3px;}',
/* a hand-lettered price list: name, dotted leader, price, buy */
'.blb-item{display:grid;grid-template-columns:26px minmax(0,1fr) auto auto;gap:10px;',
'  align-items:center;padding:8px 0;border-bottom:1px dashed rgba(11,58,79,.3);}',
'.blb-item .ic{width:26px;height:26px;border:2px solid var(--blb-ink);',
'  box-shadow:inset 0 -4px 0 rgba(11,58,79,.16);}',
'.blb-item .ic.round{border-radius:50%;}',
'.blb-item .nm{font-size:15px;font-weight:700;letter-spacing:.035em;line-height:1.1;}',
'.blb-item .no{font-size:12px;opacity:.68;margin-top:1px;line-height:1.2;}',
'.blb-item .pr{font-size:17px;font-weight:700;white-space:nowrap;color:var(--blb-rust);',
'  font-variant-numeric:tabular-nums;}',
'.blb-item .pr small{font-size:11px;font-weight:600;opacity:.7;}',
'.blb-buy{pointer-events:auto;padding:6px 13px 7px;font-size:12px;font-weight:700;',
'  letter-spacing:.11em;text-transform:uppercase;background:var(--blb-haz);',
'  border:2px solid var(--blb-ink);box-shadow:2px 2px 0 0 var(--blb-ink);',
'  transition:transform .08s,box-shadow .08s;white-space:nowrap;}',
'.blb-buy:hover{transform:translate(1px,1px);box-shadow:1px 1px 0 0 var(--blb-ink);}',
'.blb-buy:active{transform:translate(2px,2px);box-shadow:0 0 0 0 var(--blb-ink);}',
'.blb-buy[disabled]{background:var(--blb-cement);color:rgba(11,58,79,.5);',
'  box-shadow:none;cursor:not-allowed;border-color:rgba(11,58,79,.45);}',
'.blb-item.owned .pr{color:var(--blb-palm);}',
'.blb-kft{padding:0 16px 14px;font-size:11px;opacity:.6;letter-spacing:.03em;}',
''].join('\n');

  const STYLE3 = [
/* --- intro: a faded municipal poster for an absurd public project ------- */
'.blb-intro{position:absolute;inset:0;display:none;pointer-events:auto;overflow-y:auto;',
'  overflow-x:hidden;background-color:var(--blb-lime);background-image:var(--blb-grain),',
'  radial-gradient(44vmin 44vmin at 50% 33%,rgba(246,196,69,.52),rgba(246,196,69,0) 70%),',
'  radial-gradient(130% 100% at 50% 100%,rgba(11,58,79,.30),rgba(11,58,79,0) 62%);}',
'.blb-intro.on{display:block;}',
'.blb-ipaper{min-height:100%;display:flex;flex-direction:column;align-items:center;',
'  justify-content:center;padding:34px 18px 26px;text-align:center;position:relative;}',
'.blb-iband{width:min(640px,100%);height:11px;}',
'.blb-iband.b2{margin-top:4px;height:5px;opacity:.75;}',

/* the title block. the whole joke lives here. */
'.blb-ititle{margin:34px 0 0;width:min(680px,100%);}',
'.blb-ititle .ar{font-family:var(--blb-kufi);font-weight:700;direction:rtl;',
'  font-size:clamp(62px,17.5vw,148px);line-height:1.04;letter-spacing:.01em;',
'  color:var(--blb-ink);text-shadow:4px 4px 0 var(--blb-haz),7px 7px 0 var(--blb-ghost);}',
'.blb-ititle .lat{position:relative;margin-top:14px;font-weight:700;',
'  font-size:clamp(25px,7.1vw,58px);line-height:.92;letter-spacing:.055em;',
'  text-transform:uppercase;color:var(--blb-ink);}',
/* real stencil bridges: thin horizontal slots cut out of the letterforms */
'@supports ((-webkit-mask-image:linear-gradient(#000,#000)) or (mask-image:linear-gradient(#000,#000))){',
'.blb-ititle .lat{-webkit-mask-image:repeating-linear-gradient(0deg,#000 0 .2em,',
'  transparent .2em .245em);mask-image:repeating-linear-gradient(0deg,#000 0 .2em,',
'  transparent .2em .245em);}}',
'.blb-igloss{margin:16px auto 0;max-width:46ch;font-size:clamp(14.5px,2.5vw,17px);',
'  line-height:1.42;font-weight:500;}',
'.blb-igloss b{font-weight:700;background:var(--blb-haz);',
'  box-shadow:0 0 0 3px var(--blb-haz);}',
'.blb-ipitch{margin:10px auto 0;max-width:min(540px,94%);font-size:13.5px;',
'  opacity:.82;line-height:1.46;}',

/* controls, set like a permit schedule */
'.blb-ikeys{margin:22px 0 0;width:min(560px,100%);display:grid;',
'  grid-template-columns:repeat(2,minmax(0,1fr));gap:1px 0;text-align:left;',
'  border-top:2px solid var(--blb-ink);border-bottom:2px solid var(--blb-ink);',
'  padding:7px 0;}',
'.blb-ikeys div{display:flex;align-items:baseline;gap:7px;padding:3px 9px;',
'  font-size:12.5px;font-weight:600;letter-spacing:.04em;}',
'.blb-ikeys div span{opacity:.82;}',

'.blb-istart{margin:24px 0 0;pointer-events:auto;padding:13px 30px 15px;',
'  font-size:clamp(17px,3.4vw,22px);font-weight:700;letter-spacing:.13em;',
'  text-transform:uppercase;background:var(--blb-haz);color:var(--blb-ink);',
'  border:3px solid var(--blb-ink);box-shadow:5px 5px 0 0 var(--blb-ink);',
'  transition:transform .08s,box-shadow .08s;}',
'.blb-istart .ar{font-family:var(--blb-kufi);font-size:.86em;margin-left:.5em;',
'  letter-spacing:0;}',
'.blb-istart:hover{transform:translate(2px,2px);box-shadow:3px 3px 0 0 var(--blb-ink);}',
'.blb-istart:active{transform:translate(5px,5px);box-shadow:0 0 0 0 var(--blb-ink);}',
'.blb-istart[disabled]{background:var(--blb-cement);cursor:progress;',
'  box-shadow:5px 5px 0 0 rgba(11,58,79,.4);}',

/* municipal stamp, rotated and over-inked like every real one */
'.blb-stamp{position:absolute;right:max(14px,4vw);bottom:max(14px,4vw);width:124px;',
'  height:124px;border:2.5px solid var(--blb-rust);border-radius:50%;color:var(--blb-rust);',
'  display:grid;place-content:center;text-align:center;transform:rotate(-13deg);',
'  opacity:.72;pointer-events:none;}',
'.blb-stamp:before{content:"";position:absolute;inset:5px;border:1px solid var(--blb-rust);',
'  border-radius:50%;}',
'.blb-stamp .a{font-family:var(--blb-kufi);font-size:14px;line-height:1.15;direction:rtl;}',
'.blb-stamp .b{font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;',
'  margin-top:4px;line-height:1.3;}',
'.blb-stamp .c{font-size:11px;font-weight:700;letter-spacing:.05em;margin-top:3px;',
'  font-variant-numeric:tabular-nums;}',
'.blb-ifoot{margin:20px 0 0;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;',
'  opacity:.62;max-width:50ch;line-height:1.5;}',
'.blb-iload{margin:18px 0 0;width:min(340px,80%);}',
'.blb-iload .bar{height:11px;border:2px solid var(--blb-ink);background:rgba(11,58,79,.1);}',
'.blb-iload .fil{height:100%;width:0%;transition:width .3s linear;}',
'.blb-iload .tx{margin-top:5px;font-size:10.5px;font-weight:700;letter-spacing:.14em;',
'  text-transform:uppercase;opacity:.7;font-variant-numeric:tabular-nums;}',

/* --- responsive: shrink and stack, never overflow ----------------------- */
'@media (max-width:760px){',
'  .blb-stats{width:min(252px,52vw);}',
'  .blb-toasts{top:52px;width:min(240px,42vw);}',
'  .blb-tier{width:104px;}',
'  .blb-ikeys{grid-template-columns:1fr;}',
'  .blb-stamp{width:96px;height:96px;}',
'  .blb-stamp .a{font-size:11px;} .blb-stamp .b{font-size:7px;} .blb-stamp .c{font-size:9px;}',
'}',
'@media (max-width:560px){',
'  .blb{font-size:14px;}',
'  .blb-stats{width:min(214px,58vw);gap:5px;}',
'  .blb-hero .en{font-size:9.5px;letter-spacing:.07em;}',
'  .blb-barrow{grid-template-columns:1fr;gap:2px;padding:6px 8px 7px;}',
'  .blb-barrow svg{width:58px;height:34px;}',
'  .blb-row{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;}',
'  .blb-cell{padding:4px 5px 5px;}',
'  .blb-cell .k{font-size:8px;letter-spacing:.06em;}',
/* 2x2 grid of tiers so nothing runs off the edge */
'  .blb-tiers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));',
'    width:calc(100vw - 24px);gap:6px;bottom:10px;}',
'  .blb-tier{width:auto;min-width:0;}',
'  .blb-toasts{top:50px;right:10px;width:min(210px,46vw);}',
'  .blb-heckle{width:min(252px,66vw);left:10px;top:auto;bottom:200px;',
'    padding:7px 10px 9px;}',
'  .blb-heckle .tx{font-size:14px;}',
'  .blb-prompt{margin-top:24px;max-width:92vw;}',
'  .blb-prompt .tx{font-size:12px;padding:4px 8px 5px;}',
'  .blb-item{grid-template-columns:22px minmax(0,1fr) auto;gap:8px;}',
'  .blb-item .ic{width:22px;height:22px;}',
'  .blb-buy{grid-column:3;padding:5px 9px 6px;font-size:11px;}',
'  .blb-item .pr{grid-column:2;grid-row:2;font-size:15px;}',
'  .blb-ititle .ar{text-shadow:3px 3px 0 var(--blb-haz);}',
'  .blb-stamp{position:static;margin:18px auto 0;transform:rotate(-6deg);}',
'}',
'@media (max-width:420px){',
'  .blb-stats{width:min(188px,62vw);}',
'  .blb-cell .v{font-size:15px;}',
'  .blb-sea svg{height:20px;}',
'}',
/* short viewports: the intro must not trap content off-screen */
'@media (max-height:620px){',
'  .blb-ipaper{justify-content:flex-start;padding-top:20px;}',
'  .blb-ititle{margin-top:10px;} .blb-ikeys{margin-top:14px;} .blb-istart{margin-top:16px;}',
'}',

'@media (prefers-reduced-motion:reduce){',
'  .blb *,.blb *:before,.blb *:after{animation:none !important;',
'    transition-duration:.01ms !important;}',
'  .blb-toast.in{animation:none;} .blb-heckle.in{animation:none;}',
'}',
''].join('\n');

  const STYLE4 = [
/* --- health, buffs, hurt, faint ----------------------------------------- */
'.blb-hp.life .fill{background:var(--blb-terra);}',
'.blb-hp.life.low .fill{background:var(--blb-rust);animation:blb-throb 1s ease-in-out infinite;}',
'.blb-hp .num{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;opacity:.8;}',
'.blb-hp .heart{display:inline-block;width:10px;height:9px;margin-right:5px;vertical-align:-1px;',
'  background:var(--blb-terra);clip-path:polygon(50% 100%,0 38%,0 12%,22% 0,50% 18%,78% 0,100% 12%,100% 38%);}',
'@keyframes blb-throb{0%,100%{opacity:1}50%{opacity:.55}}',
'.blb-buffs{display:flex;flex-wrap:wrap;gap:5px;}',
'.blb-buff{padding:3px 7px 4px;font-size:10px;font-weight:700;letter-spacing:.1em;',
'  text-transform:uppercase;background:var(--blb-ink);color:var(--blb-foam);',
'  border:1.5px solid var(--blb-ink);font-variant-numeric:tabular-nums;}',
'.blb-buff b{color:var(--blb-haz);font-weight:700;margin-left:4px;}',
'.blb-hurt{position:absolute;inset:0;pointer-events:none;opacity:0;',
'  background:radial-gradient(120% 95% at 50% 50%,rgba(185,80,47,0) 52%,rgba(140,74,47,.75) 100%);}',
'.blb-faint{position:absolute;inset:0;display:none;place-content:center;text-align:center;',
'  gap:10px;padding:24px;pointer-events:auto;background:rgba(10,26,51,.82);color:var(--blb-foam);}',
'.blb-faint.on{display:grid;animation:blb-fade .6s ease-out both;}',
'.blb-faint .ar{font-family:var(--blb-kufi);font-size:clamp(40px,10vw,84px);line-height:1.05;',
'  color:var(--blb-haz);direction:rtl;}',
'.blb-faint .en{font-size:clamp(18px,3.4vw,26px);font-weight:700;letter-spacing:.12em;text-transform:uppercase;}',
'.blb-faint .tx{max-width:44ch;margin:0 auto;font-size:15px;line-height:1.45;opacity:.85;}',
'.blb-faint .bill{margin:6px auto 0;padding:8px 14px;border:2px dashed rgba(237,246,243,.5);',
'  font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-variant-numeric:tabular-nums;}',
'@keyframes blb-fade{from{opacity:0}to{opacity:1}}',
'.blb-menubtn{pointer-events:auto;width:34px;height:30px;display:grid;place-items:center;}',
'.blb-menubtn:hover{background-color:var(--blb-haz);}',
'.blb-menubtn i{display:block;width:14px;height:2.5px;background:var(--blb-ink);box-shadow:0 5px 0 var(--blb-ink),0 -5px 0 var(--blb-ink);}',

/* --- the menu: a municipal noticeboard over the live corniche ----------- */
'.blb-menu{position:absolute;inset:0;display:none;pointer-events:auto;overflow:hidden;',
'  background:linear-gradient(90deg,rgba(11,58,79,.78) 0,rgba(11,58,79,.5) 38%,rgba(11,58,79,.05) 70%);}',
'.blb-menu.on{display:block;}',
/* the in-game HUD steps aside while a menu is up */
'.blb.menu-open .blb-stats,.blb.menu-open .blb-tr,.blb.menu-open .blb-cross,',
'.blb.menu-open .blb-prompt,.blb.menu-open .blb-toasts,.blb.menu-open .blb-saylayer,',
'.blb.menu-open .blb-heckle{visibility:hidden;}',
'.blb-menu[data-mode="pause"]{background:rgba(10,26,51,.62);}',
'.blb-mwrap{position:absolute;inset:0;display:flex;align-items:stretch;gap:22px;',
'  padding:max(18px,3vh) max(18px,3vw);overflow-y:auto;}',
'.blb-mpanel{position:relative;width:min(430px,100%);flex:0 0 auto;display:flex;flex-direction:column;',
'  padding:0 0 16px;align-self:center;animation:blb-menu-in .42s cubic-bezier(.2,1.2,.4,1) both;}',
'@keyframes blb-menu-in{from{opacity:0;transform:translateX(-26px) rotate(-1deg)}to{opacity:1;transform:none}}',
'.blb-mpanel .cap{height:11px;}',
'.blb-mtitle{padding:14px 20px 0;}',
'.blb-mtitle .ar{font-family:var(--blb-kufi);font-weight:700;direction:rtl;text-align:right;',
'  font-size:clamp(46px,9vw,82px);line-height:1.02;color:var(--blb-ink);',
'  text-shadow:3px 3px 0 var(--blb-haz),5px 5px 0 var(--blb-ghost);}',
'.blb-mtitle .lat{margin-top:6px;font-weight:700;font-size:clamp(20px,3.6vw,30px);',
'  letter-spacing:.07em;text-transform:uppercase;line-height:1;}',
'.blb-mtitle .gl{margin-top:8px;font-size:13.5px;line-height:1.4;opacity:.82;}',
'.blb-mtitle .gl b{background:var(--blb-haz);box-shadow:0 0 0 2px var(--blb-haz);}',
'.blb-mpause{display:none;padding:14px 20px 0;}',
'.blb-mpause .ar{font-family:var(--blb-kufi);font-size:40px;line-height:1;direction:rtl;text-align:right;}',
'.blb-mpause .en{font-size:24px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;}',
'.blb-menu[data-mode="pause"] .blb-mtitle{display:none;}',
'.blb-menu[data-mode="pause"] .blb-mpause{display:block;}',
'.blb-mnav{display:grid;gap:7px;padding:16px 20px 4px;}',
'.blb-mbtn{pointer-events:auto;display:grid;grid-template-columns:30px 1fr auto;align-items:center;gap:10px;',
'  text-align:left;padding:9px 12px 10px;background:var(--blb-paper);border:2px solid var(--blb-ink);',
'  box-shadow:3px 3px 0 0 var(--blb-ink);transition:transform .08s,box-shadow .08s,background-color .12s;}',
'.blb-mbtn .n{font-size:12px;font-weight:700;opacity:.55;font-variant-numeric:tabular-nums;}',
'.blb-mbtn .l{font-size:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;line-height:1.05;}',
'.blb-mbtn .s{display:block;font-size:11.5px;font-weight:500;letter-spacing:.02em;text-transform:none;opacity:.7;margin-top:2px;}',
'.blb-mbtn .a{font-family:var(--blb-kufi);font-size:16px;direction:rtl;opacity:.75;}',
'.blb-mbtn:hover,.blb-mbtn:focus-visible{background:var(--blb-haz);transform:translate(1px,1px);',
'  box-shadow:2px 2px 0 0 var(--blb-ink);}',
'.blb-mbtn.primary{background:var(--blb-haz);}',
'.blb-mbtn.primary:hover{background:var(--blb-foam);}',
'.blb-mbtn.warn .l{color:var(--blb-rust);}',
'.blb-mbtn[hidden]{display:none;}',
'.blb-mbtn[disabled]{background:var(--blb-cement);cursor:progress;opacity:.7;}',
'.blb-msum{margin:12px 20px 0;padding:8px 0 0;border-top:2px solid var(--blb-ink);display:grid;',
'  grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;}',
'.blb-msum div{font-size:9.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;opacity:.75;}',
'.blb-msum b{display:block;font-size:20px;letter-spacing:0;opacity:1;font-variant-numeric:tabular-nums;color:var(--blb-ink);}',
'.blb-mfoot{margin:12px 20px 0;font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.55;line-height:1.5;}',
'.blb-menu .blb-iload{margin:12px 20px 0;width:auto;}',
'.blb-msheet{position:relative;flex:1 1 auto;max-width:560px;align-self:center;display:none;',
'  padding:0 0 16px;max-height:100%;overflow-y:auto;animation:blb-menu-in .3s ease-out both;}',
'.blb-msheet.on{display:block;}',
'.blb-msheet .cap{height:8px;}',
'.blb-msheet h3{display:flex;align-items:baseline;justify-content:space-between;gap:10px;',
'  padding:12px 18px 8px;border-bottom:2px solid var(--blb-ink);font-size:20px;letter-spacing:.1em;text-transform:uppercase;}',
'.blb-msheet h3 .ar{font-family:var(--blb-kufi);font-size:20px;letter-spacing:0;opacity:.7;}',
'.blb-msheet .bd{padding:12px 18px 0;font-size:14px;line-height:1.45;}',
'.blb-msheet .bd p{margin:0 0 10px;}',
'.blb-msheet .bd h4{margin:12px 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.7;}',
'.blb-msheet .keys{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 10px;}',
'.blb-msheet .keys div{font-size:12.5px;font-weight:600;padding:2px 0;}',
'.blb-msheet a{pointer-events:auto;color:var(--blb-ink);font-weight:700;',
'  text-decoration:underline;text-decoration-color:var(--blb-haz);text-decoration-thickness:3px;}',
'.blb-msheet a:hover{background:var(--blb-haz);}',
'.blb-links{display:flex;flex-wrap:wrap;gap:6px 18px;}',
'.blb-mback{pointer-events:auto;margin:14px 18px 0;padding:7px 14px 8px;font-size:12px;font-weight:700;',
'  letter-spacing:.14em;text-transform:uppercase;border:2px solid var(--blb-ink);background:var(--blb-paper);',
'  box-shadow:2px 2px 0 var(--blb-ink);}',
'.blb-mback:hover{background:var(--blb-haz);}',
'.blb-set{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 14px;',
'  padding:9px 0;border-bottom:1px dashed rgba(11,58,79,.3);}',
'.blb-set .k{font-size:14px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;}',
'.blb-set .k small{display:block;font-size:11.5px;font-weight:500;letter-spacing:.01em;text-transform:none;opacity:.65;}',
'.blb-set input[type=range]{pointer-events:auto;width:150px;accent-color:#0B3A4F;}',
'.blb-set .v{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;min-width:3.5em;text-align:right;}',
'.blb-seg{display:inline-flex;border:2px solid var(--blb-ink);}',
'.blb-seg button{pointer-events:auto;padding:5px 10px 6px;font-size:12px;font-weight:700;letter-spacing:.08em;',
'  text-transform:uppercase;background:var(--blb-paper);}',
'.blb-seg button+button{border-left:2px solid var(--blb-ink);}',
'.blb-seg button[aria-pressed="true"]{background:var(--blb-ink);color:var(--blb-haz);}',
'.blb-confirm{padding:12px 18px 0;}',
'.blb-confirm p{font-size:15px;line-height:1.45;margin:0 0 12px;}',
'.blb-confirm .row{display:flex;gap:10px;flex-wrap:wrap;}',
'.blb-menu .blb-stamp{right:max(18px,3vw);bottom:max(18px,3vw);}',
'.blb-menu[data-mode="pause"] .blb-stamp{display:none;}',
'@media (max-width:760px){',
'  .blb-mwrap{flex-direction:column;align-items:center;gap:12px;}',
'  .blb-mpanel,.blb-msheet{align-self:stretch;width:auto;max-width:none;}',
'  .blb-menu.sheet .blb-mpanel{display:none;}',
'  .blb-menu{background:rgba(11,58,79,.6);}',
'  .blb-menu .blb-stamp{display:none;}',
'  .blb-msheet .keys{grid-template-columns:1fr;}',
'}',
'@media (max-height:560px){',
'  .blb-mtitle .ar{font-size:40px;} .blb-mtitle .gl{display:none;} .blb-mnav{padding-top:10px;gap:5px;}',
'  .blb-mbtn{padding:6px 10px 7px;} .blb-mbtn .s{display:none;}',
'  .blb-mpanel,.blb-msheet{align-self:flex-start;}',
'}',
''].join('\n');

  /* ------------------------------------------------------------ normalizers */
  function normTiers(list) {
    const out = [];
    for (let i = 0; i < TIER_FALLBACK.length; i++) {
      const f = TIER_FALLBACK[i], t = (list && list[i]) || {};
      out.push({
        idx: i,
        id: t.id || f.id,
        name: t.name || f.name,
        ar: t.ar || f.ar,
        hp: num(t.hp, num(t.maxHp, f.hp)),
        mortar: num(t.mortar, num(t.mortarCost, num(t.cost, f.mortar))),
        lira: num(t.lira, num(t.liraCost, f.lira)),
        color: t.color || t.colour || f.color
      });
    }
    return out;
  }

  // `unlocked` is accepted as [bool], [id], {id:bool} or a plain count.
  function normUnlocked(u, n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = false;
    out[0] = true; // ramleh is always yours
    if (u == null) return out;
    if (typeof u === 'number') {
      for (let i = 0; i < n; i++) out[i] = i < u;
      out[0] = true; return out;
    }
    if (Array.isArray(u)) {
      if (u.length && typeof u[0] === 'string') {
        for (let i = 0; i < n; i++) out[i] = u.indexOf(TIER_FALLBACK[i].id) >= 0;
      } else {
        for (let i = 0; i < n; i++) out[i] = !!u[i];
      }
      out[0] = true; return out;
    }
    if (typeof u === 'object') {
      for (let i = 0; i < n; i++) out[i] = !!u[TIER_FALLBACK[i].id];
      out[0] = true; return out;
    }
    return out;
  }

  function setVars(node, pal) {
    const v = {
      '--blb-sd': pal.SEA_DEEP, '--blb-sm': pal.SEA_MID, '--blb-ss': pal.SEA_SHALLOW,
      '--blb-foam': pal.FOAM, '--blb-lime': pal.LIMESTONE, '--blb-stone': pal.STONE_DARK,
      '--blb-wet': pal.STONE_WET, '--blb-terra': pal.TERRACOTTA, '--blb-cement': pal.CEMENT,
      '--blb-rust': pal.RUST, '--blb-palm': pal.PALM_GREEN, '--blb-sun': pal.SUN,
      '--blb-haz': pal.HAZARD, '--blb-night': pal.NIGHT_TOP, '--blb-skin': pal.SKIN,
      '--blb-denim': pal.DENIM,
      '--blb-ink': pal.SEA_DEEP,
      '--blb-paper': pal.LIMESTONE,
      '--blb-shadow': 'rgba(11,58,79,.55)',
      '--blb-ghost': 'rgba(185,80,47,.30)',
      '--blb-swell': pal.SEA_SHALLOW,
      '--blb-sans': '"Barlow Condensed","Oswald","Arial Narrow",' +
                    '"Helvetica Neue Condensed",Impact,sans-serif',
      '--blb-kufi': '"Reem Kufi","Noto Naskh Arabic","Geeza Pro","Al Bayan",' +
                    'Tahoma,sans-serif',
      '--blb-grain': grain() ? 'url(' + grain() + ')' : 'none'
    };
    for (const k in v) node.style.setProperty(k, v[k]);
  }

  // sea-state bands, driven by waves.swell(t)
  const SEA_BANDS = [
    { to: 0.12, en: 'calm',    ar: 'ساكن',  c: '--blb-ss' },
    { to: 0.30, en: 'ruffled', ar: 'نسمة',  c: '--blb-ss' },
    { to: 0.50, en: 'chop',    ar: 'موج',   c: '--blb-sm' },
    { to: 0.72, en: 'swell',   ar: 'موج عالي', c: '--blb-haz' },
    { to: 1.01, en: 'squall',  ar: 'عاصفة', c: '--blb-rust' }
  ];
  function seaBand(s) {
    for (let i = 0; i < SEA_BANDS.length; i++) if (s < SEA_BANDS[i].to) return SEA_BANDS[i];
    return SEA_BANDS[SEA_BANDS.length - 1];
  }

  /* ========================================================== BLB_HUD.create */
  function create(opts) {
    opts = opts || {};
    const pal = Object.assign({}, P, opts.palette || {});
    const tiers = normTiers(opts.tiers);
    const host = opts.root || document.body;
    const onBuy = typeof opts.onBuy === 'function' ? opts.onBuy : function () {};
    // `simple` strips the economy chrome: one tile, one resource, no kiosk.
    const simple = opts.simple !== false;
    const onSelectTier = typeof opts.onSelectTier === 'function' ? opts.onSelectTier : function () {};
    const onStart = typeof opts.onStart === 'function' ? opts.onStart : function () {};
    const onToggleSound = typeof opts.onToggleSound === 'function' ? opts.onToggleSound : function () {};
    // menu actions: continue | new | resume | quit | pause | setting(key, value)
    const onMenu = typeof opts.onMenu === 'function' ? opts.onMenu : function (act) {
      if (act === 'continue' || act === 'new' || act === 'resume') onStart();
    };

    injectFonts();
    injectStyle();

    const r = el('div', 'blb');
    r.setAttribute('data-phase', 'day');
    setVars(r, pal);

    // live model the HUD renders from; setStats writes here, frame() eases it
    const S = {
      mortar: 0, mortarMax: 12, tiles: 0, metres: 0, lira: 0,
      tierIdx: 0, unlocked: normUnlocked(null, tiers.length), workers: 0, swell: 0
    };
    const shown = { metres: 0, lira: 0, tiles: 0, mortar: 0 }; // eased display values
    let muted = false, phase = 'day', clock = 0, lastFrame = 0, frames = 0;
    let shopOpen = false, introOpen = false, loadPct = null;
    S.health = S.health == null ? 100 : S.health;
    S.healthMax = S.healthMax == null ? 100 : S.healthMax;
    let shake = 0;

    const reduced = (function () {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch (e) { return false; }
    })();

    /* ---------------------------------------------------------- phase wash */
    const wash = el('div', 'blb-wash');
    r.appendChild(wash);

    /* -------------------------------------------------------- stats cluster */
    const stats = el('div', 'blb-stats');

    // hero: metres reclaimed from the sea
    const hero = el('div', 'blb-plaque blb-hero');
    hero.innerHTML =
      '<div class="cap blb-haz"></div>' +
      '<div class="in">' +
        '<div class="fig"><span class="v" data-metres>0</span><span class="u">m²</span></div>' +
        '<div class="en blb-print">Metres reclaimed from the sea</div>' +
        '<div class="arl blb-ar">متر مستعاد من البحر</div>' +
      '</div><div class="rule"></div>';
    const elMetres = hero.querySelector('[data-metres]');
    stats.appendChild(hero);

    // the wheelbarrow of mouna, as a gauge that actually empties
    const barrow = el('div', 'blb-plaque blb-barrow');
    const clipId = uid();
    barrow.innerHTML =
      '<svg viewBox="0 0 76 46" aria-hidden="true">' +
        '<defs><clipPath id="' + clipId + '">' +
          '<polygon points="6,8 58,8 50,28 14,28"/>' +
        '</clipPath></defs>' +
        '<g clip-path="url(#' + clipId + ')">' +
          '<rect data-fill x="2" y="8" width="62" height="20" fill="' + pal.STONE_DARK + '"/>' +
          '<rect data-skin x="2" y="8" width="62" height="2.5" fill="' + pal.LIMESTONE + '" opacity=".75"/>' +
        '</g>' +
        '<polygon class="tray" points="6,8 58,8 50,28 14,28" fill="none" ' +
          'stroke="' + pal.SEA_DEEP + '" stroke-width="2.4" stroke-linejoin="round"/>' +
        '<path d="M57 10 L73 17" stroke="' + pal.SEA_DEEP + '" stroke-width="2.4" ' +
          'stroke-linecap="round" fill="none"/>' +
        '<path d="M48 28 L50 41" stroke="' + pal.SEA_DEEP + '" stroke-width="2.4" ' +
          'stroke-linecap="round" fill="none"/>' +
        '<circle cx="18" cy="35" r="7.5" fill="' + pal.CEMENT + '" ' +
          'stroke="' + pal.SEA_DEEP + '" stroke-width="2.4"/>' +
        '<circle cx="18" cy="35" r="1.8" fill="' + pal.SEA_DEEP + '"/>' +
      '</svg>' +
      '<div><div class="blb-lbl">Mouna in the barrow</div>' +
      '<div class="mline"><span class="mv" data-mv>0</span>' +
      '<span class="mm" data-mm>/ 12</span></div></div>';
    const elBarrowFill = barrow.querySelector('[data-fill]');
    const elBarrowSkin = barrow.querySelector('[data-skin]');
    const elMv = barrow.querySelector('[data-mv]');
    const elMm = barrow.querySelector('[data-mm]');
    stats.appendChild(barrow);

    // health — the sea, a fall or an empty stomach take it; food gives it back
    const life = el('div', 'blb-plaque blb-hp life');
    life.innerHTML =
      '<div class="top"><span class="k"><i class="heart"></i>Health</span>' +
        '<span class="num" data-lifev>100</span>' +
        '<span class="ar blb-ar">الصحّة</span></div>' +
      '<div class="track"><div class="fill" data-lifefill></div>' +
        '<div class="pips"><i></i><i></i><i></i><i></i><i></i></div></div>';
    const elLifeFill = life.querySelector('[data-lifefill]');
    const elLifeV = life.querySelector('[data-lifev]');
    stats.appendChild(life);

    // stamina — the thing knefe buys back
    const hp = el('div', 'blb-plaque blb-hp');
    hp.innerHTML =
      '<div class="top"><span class="k">Stamina</span>' +
        '<span class="ar blb-ar">النفس</span></div>' +
      '<div class="track"><div class="fill" data-hpfill></div>' +
        '<div class="pips"><i></i><i></i><i></i><i></i></div></div>';
    const elHpFill = hp.querySelector('[data-hpfill]');
    stats.appendChild(hp);

    // tiles / lira / shabeb
    const row = el('div', 'blb-row');
    row.innerHTML =
      '<div class="blb-plaque blb-cell"><div class="v" data-tiles>0</div>' +
        '<div class="k">Balat</div></div>' +
      '<div class="blb-plaque blb-cell lira"><div class="v" data-lira>0</div>' +
        '<div class="k">Lira</div></div>' +
      '<div class="blb-plaque blb-cell"><div class="v" data-workers>0</div>' +
        '<div class="k">Shabeb</div></div>';
    const elTiles = row.querySelector('[data-tiles]');
    const elLira = row.querySelector('[data-lira]');
    const elWorkers = row.querySelector('[data-workers]');
    if (simple) elWorkers.parentNode.style.display = 'none';
    stats.appendChild(row);

    // what you ate recently and what it is still doing for you
    const buffs = el('div', 'blb-buffs');
    stats.appendChild(buffs);
    let buffKey = '';
    function setBuffs(list) {
      list = list || [];
      const key = list.map(function (b) { return b.id + ':' + Math.ceil(b.t); }).join('|');
      if (key === buffKey) return;
      buffKey = key;
      buffs.innerHTML = list.map(function (b) {
        return '<span class="blb-buff">' + esc(b.label) + '<b>' + Math.ceil(b.t) + 's</b></span>';
      }).join('');
    }

    // red edge when something hurts
    const hurtEl = el('div', 'blb-hurt');
    let hurtA = 0;
    function hurt(amount) {
      hurtA = clamp(hurtA + 0.25 + num(amount, 5) * 0.04, 0, 0.95);
    }

    // passing out: a full-screen card while the game moves you to safety
    const faint = el('div', 'blb-faint');
    faint.innerHTML = '<div class="ar">غمي عليك</div><div class="en">Ghme 3alék</div>' +
      '<div class="tx" data-ftx></div><div class="bill" data-fbill></div>';
    const elFaintTx = faint.querySelector('[data-ftx]');
    const elFaintBill = faint.querySelector('[data-fbill]');
    function showFaint(o) {
      o = o || {};
      elFaintTx.textContent = o.text || '';
      elFaintBill.textContent = o.bill || '';
      elFaintBill.style.display = o.bill ? 'block' : 'none';
      faint.classList.add('on');
    }
    function hideFaint() { faint.classList.remove('on'); }

    // sea state
    const sea = el('div', 'blb-plaque blb-sea');
    sea.innerHTML =
      '<div class="cap blb-haz" style="display:none"></div>' +
      '<div class="hd"><span class="nm" data-sn>Sea calm</span>' +
      '<span class="ar blb-ar" data-sa>ساكن</span></div>' +
      '<svg viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true">' +
        '<path data-wavefill fill="var(--blb-swell)" opacity=".22" d=""/>' +
        '<path data-wave fill="none" stroke="var(--blb-swell)" stroke-width="2" ' +
          'stroke-linejoin="round" stroke-linecap="round" d=""/>' +
      '</svg>' +
      '<div class="pips"><i></i><i></i><i></i><i></i><i></i></div>';
    const elSeaName = sea.querySelector('[data-sn]');
    const elSeaAr = sea.querySelector('[data-sa]');
    const elWave = sea.querySelector('[data-wave]');
    const elWaveFill = sea.querySelector('[data-wavefill]');
    const elSeaCap = sea.querySelector('.cap');
    const pips = sea.querySelectorAll('.pips i');
    stats.appendChild(sea);
    r.appendChild(stats);

    /* ------------------------------------------------- top-right: sound etc */
    const tr = el('div', 'blb-tr');
    const phaseTag = el('div', 'blb-plaque blb-phase', 'Day');
    const snd = el('button', 'blb-plaque blb-snd');
    snd.type = 'button';
    snd.setAttribute('aria-pressed', 'false');
    snd.setAttribute('aria-label', 'Mute sound');
    snd.title = 'Sound (M)';
    snd.innerHTML =
      '<svg class="live" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.1" stroke-linecap="round"><path d="M4 9h3l5-4v14l-5-4H4z" ' +
        'fill="currentColor" stroke="none"/><path d="M16 9c1.2 1.1 1.2 4.9 0 6"/>' +
        '<path d="M19 6.5c2.3 2.2 2.3 9 0 11"/></svg>' +
      '<svg class="mute" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.1" stroke-linecap="round"><path d="M4 9h3l5-4v14l-5-4H4z" ' +
        'fill="currentColor" stroke="none"/><path d="M16 9l6 6M22 9l-6 6"/></svg>';
    snd.addEventListener('click', function () { toggleSound(); });
    const menuBtn = el('button', 'blb-plaque blb-menubtn', '<i></i>');
    menuBtn.type = 'button';
    menuBtn.title = 'Menu (Esc)';
    menuBtn.setAttribute('aria-label', 'Pause menu');
    menuBtn.addEventListener('click', function () { onMenu('pause'); });
    tr.appendChild(phaseTag);
    tr.appendChild(snd);
    tr.appendChild(menuBtn);
    r.appendChild(tr);

    function toggleSound(force) {
      muted = typeof force === 'boolean' ? force : !muted;
      snd.setAttribute('aria-pressed', muted ? 'true' : 'false');
      snd.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
      if (typeof force !== 'boolean') onToggleSound(muted);
      return muted;
    }

    /* ---------------------------------------------------- crosshair + prompt */
    const cross = el('div', 'blb-cross', '<i></i><i></i><i></i><i></i><i></i>');
    cross.setAttribute('data-r', 'idle');
    r.appendChild(cross);

    const promptEl = el('div', 'blb-prompt',
      '<div class="bar blb-haz"></div><div class="tx"></div>');
    const elPromptTx = promptEl.querySelector('.tx');
    promptEl.setAttribute('aria-live', 'polite');
    r.appendChild(promptEl);

    /* ----------------------------------------------------------------- toasts */
    const toasts = el('div', 'blb-toasts');
    toasts.setAttribute('aria-live', 'polite');
    r.appendChild(toasts);
    const liveToasts = [];

    /* ---------------------------------------------------------------- heckler */
    const heckle = el('div', 'blb-plaque blb-heckle');
    heckle.innerHTML =
      '<div class="who"><span class="stamp blb-ar">ع</span>' +
      '<span class="nm">3ammo, on the railing</span></div>' +
      '<div class="tx"></div><div class="tail"></div>';
    const elHeckleTx = heckle.querySelector('.tx');
    heckle.style.display = 'none';
    r.appendChild(heckle);
    let heckleTtl = 0;

    /* --------------------------------------------------------- tier selector */
    const tierWrap = el('div', 'blb-tiers');
    tierWrap.setAttribute('role', 'group');
    tierWrap.setAttribute('aria-label', 'Tile stock, keys 1 to 4');
    if (simple) tierWrap.style.display = 'none';
    const tierBtns = tiers.map(function (t, i) {
      const b = el('button', 'blb-plaque blb-tier');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML =
        '<div class="sw" style="background:' + t.color + '"></div>' +
        '<div class="k">' + (i + 1) + '</div>' +
        '<div class="nm">' + esc(t.name) + '</div>' +
        '<div class="arn blb-ar">' + esc(t.ar) + '</div>' +
        '<div class="mt"><span>hp ' + t.hp + '</span>' +
          '<span>' + t.mortar + ' mouna</span>' +
          '<span>' + (t.lira > 0 ? fmt(t.lira) + ' l.l.' : 'balash') + '</span></div>' +
        '<div class="px">locked</div>';
      b.addEventListener('click', function () { pickTier(i, true); });
      tierWrap.appendChild(b);
      return b;
    });
    r.appendChild(tierWrap);

    function pickTier(i, fromUi) {
      i = clamp(i | 0, 0, tiers.length - 1);
      if (!S.unlocked[i]) {
        // still let the game decide; just explain why nothing happened
        if (fromUi) toast(tiers[i].name + ' is locked — ask the muallim', 'bad');
        onSelectTier(i);
        return;
      }
      S.tierIdx = i;
      paintTiers();
      onSelectTier(i);
    }

    function paintTiers() {
      for (let i = 0; i < tierBtns.length; i++) {
        const b = tierBtns[i], open = !!S.unlocked[i], on = i === S.tierIdx && open;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('lk', !open);
        b.setAttribute('aria-label', tiers[i].name + (open ? '' : ', locked') +
          ', hp ' + tiers[i].hp + ', ' + tiers[i].mortar + ' mortar');
        if (!open) {
          const p = priceOf('unlock:' + tiers[i].id, lastPrices);
          b.querySelector('.px').textContent = 'locked — ' + fmt(p) + ' l.l.';
        }
      }
    }

    /* --------------------------------------------------------- loading strip */
    const load = el('div', 'blb-load', '<div class="t"></div>');
    const elLoadT = load.querySelector('.t');
    r.appendChild(load);

    /* ============================================== shop — the muallim kiosk */
    let lastPrices = {};
    let lastShopState = {};

    const shop = el('div', 'blb-shop');
    const kiosk = el('div', 'blb-plaque blb-kiosk');
    kiosk.setAttribute('role', 'dialog');
    kiosk.setAttribute('aria-modal', 'true');
    kiosk.setAttribute('aria-label', 'The muallim kiosk');
    kiosk.innerHTML =
      '<div class="cap blb-haz"></div>' +
      '<div class="blb-khd">' +
        '<div><h2 class="blb-ar">عند المعلّم</h2>' +
        '<div class="sub blb-print">Price list. Hand-written, non-negotiable (mostly)</div></div>' +
        '<div class="purse"><div class="blb-lbl">In your pocket</div>' +
        '<div class="v" data-purse>0</div>' +
        '<button class="blb-close" type="button" data-close>Khalas</button></div>' +
      '</div>' +
      '<div data-body></div>' +
      '<div class="blb-kft">No refunds. The sea does not issue receipts.</div>';
    const elPurse = kiosk.querySelector('[data-purse]');
    const shopBody = kiosk.querySelector('[data-body]');
    const btnClose = kiosk.querySelector('[data-close]');
    btnClose.addEventListener('click', function () { closeShop(); });
    shop.appendChild(kiosk);
    shop.addEventListener('mousedown', function (e) { if (e.target === shop) closeShop(); });
    r.appendChild(shop);

    function priceOf(id, pr, fallback) {
      const v = pr && pr[id];
      return Math.max(0, Math.round(num(v, num(fallback, PRICE[id] || 0))));
    }

    function shopItem(o) {
      const n = el('div', 'blb-item' + (o.owned ? ' owned' : ''));
      const icon = '<div class="ic' + (o.round ? ' round' : '') + '" style="background:' +
        o.color + '"></div>';
      n.innerHTML = icon +
        '<div><div class="nm">' + esc(o.name) + '</div>' +
        '<div class="no">' + esc(o.note) + '</div></div>' +
        '<div class="pr">' + (o.owned ? '3andak' :
          fmt(o.price) + ' <small>l.l.</small>') + '</div>';
      const b = el('button', 'blb-buy', esc(o.cta || 'Buy'));
      b.type = 'button';
      if (o.owned || o.disabled) {
        b.disabled = true;
        b.textContent = o.owned ? 'Done' : 'No lira';
      }
      b.setAttribute('aria-label', (o.owned ? 'Already bought: ' : 'Buy ') + o.name +
        (o.owned ? '' : ' for ' + fmt(o.price) + ' lira'));
      b.addEventListener('click', function () { if (!b.disabled) onBuy(o.id); });
      n.appendChild(b);
      return n;
    }

    function shopSection(arTitle, enTitle) {
      const h = el('div', 'blb-ksec');
      h.innerHTML = '<span class="blb-ar" style="font-family:var(--blb-kufi);' +
        'font-size:14px;letter-spacing:0">' + esc(arTitle) + '</span>' +
        '<span>' + esc(enTitle) + '</span><span></span>';
      return h;
    }

    function renderShop(st) {
      st = st || {};
      const pr = lastPrices = st.prices || st.price || lastPrices || {};
      const lira = num(st.lira, S.lira);
      const mortar = num(st.mortar, S.mortar);
      const mortarMax = num(st.mortarMax, S.mortarMax);
      const workers = num(st.workers, S.workers);
      const maxWorkers = num(st.maxWorkers, 6);
      const lvl = num(st.barrowLevel, num(st.barrow, 0));
      const unl = st.unlocked != null ? normUnlocked(st.unlocked, tiers.length) : S.unlocked;

      elPurse.textContent = fmt(lira);
      shopBody.innerHTML = '';

      shopBody.appendChild(shopSection('البلاط', 'Tile stock'));
      const list1 = el('div', 'blb-items');
      for (let i = 1; i < tiers.length; i++) {
        const t = tiers[i], id = 'unlock:' + t.id, p = priceOf(id, pr);
        list1.appendChild(shopItem({
          id: id, color: t.color, price: p, owned: !!unl[i],
          disabled: lira < p,
          name: t.name + ' — ' + t.ar,
          cta: 'Unlock',
          note: 'hp ' + t.hp + ', ' + t.mortar + ' mouna and ' + fmt(t.lira) +
                ' l.l. per balata'
        }));
      }
      shopBody.appendChild(list1);

      shopBody.appendChild(shopSection('العدّة', 'The kit'));
      const list2 = el('div', 'blb-items');
      const pMortar = priceOf('mortar', pr);
      list2.appendChild(shopItem({
        id: 'mortar', color: pal.STONE_DARK, price: pMortar, disabled: lira < pMortar,
        name: 'Sack of mouna', cta: 'Fill up',
        note: 'fills the barrow to the brim. you are at ' + Math.round(mortar) +
              ' of ' + Math.round(mortarMax)
      }));
      const pBarrow = priceOf('barrow', pr, PRICE.barrow * (lvl + 1));
      list2.appendChild(shopItem({
        id: 'barrow', color: pal.CEMENT, price: pBarrow, disabled: lira < pBarrow,
        name: 'Bigger wheelbarrow', cta: 'Upgrade',
        note: 'carry more mouna before the long walk back. barrow mk' + (lvl + 1)
      }));
      shopBody.appendChild(list2);

      shopBody.appendChild(shopSection('الشغل بالليل', 'Night work'));
      const list3 = el('div', 'blb-items');
      const pFlood = priceOf('flood', pr, 600);
      const hasFlood = !!st.floodlights;
      list3.appendChild(shopItem({
        id: 'flood', color: pal.HAZARD, price: pFlood,
        owned: hasFlood, disabled: lira < pFlood,
        name: 'Floodlights + mazout generator', cta: 'Rig it',
        note: hasFlood
          ? 'the corniche is lit. the neighbours have opinions.'
          : 'work after maghreb. the generator is louder than the sea.'
      }));
      shopBody.appendChild(list3);

      shopBody.appendChild(shopSection('الشباب', 'The shabeb'));
      const list4 = el('div', 'blb-items');
      const pShabeb = priceOf('shabeb', pr, PRICE.shabeb * (workers + 1));
      list4.appendChild(shopItem({
        id: 'shabeb', color: pal.SKIN, round: true, price: pShabeb,
        disabled: lira < pShabeb || workers >= maxWorkers,
        owned: workers >= maxWorkers,
        name: 'Hire a shabeb', cta: 'Hire',
        note: workers >= maxWorkers
          ? 'that is the whole crew. the corniche is full.'
          : 'he lays balat while you shovel. you have ' + workers +
            (workers === 1 ? ' on site' : ' on site')
      }));
      shopBody.appendChild(list4);
    }

    /* ===================================================== intro title card */
    const intro = el('div', 'blb-intro');
    intro.setAttribute('role', 'dialog');
    intro.setAttribute('aria-modal', 'true');
    intro.setAttribute('aria-label', 'Ballet l Ba7er, start');
    const K = function (k) { return '<kbd class="blb-kbd">' + k + '</kbd>'; };
    /* The menu sits over the live scene (the game flies the camera along the
       corniche behind it), so it is a panel, not a full-bleed poster. Main
       mode: continue / new / how to play / settings / credits. Pause mode:
       resume / how to play / settings / save & quit. */
    intro.className = 'blb-menu';
    intro.setAttribute('data-mode', 'main');
    const MB = function (act, n, l, s, a, cls) {
      return '<button class="blb-mbtn' + (cls ? ' ' + cls : '') + '" type="button" data-act="' + act + '">' +
        '<span class="n">' + n + '</span><span class="l">' + l + '<span class="s">' + s + '</span></span>' +
        '<span class="a">' + a + '</span></button>';
    };
    intro.innerHTML =
      '<div class="blb-mwrap">' +
        '<div class="blb-plaque blb-mpanel">' +
          '<div class="cap blb-haz"></div>' +
          '<div class="blb-mtitle">' +
            '<div class="ar">بلّط البحر</div>' +
            '<div class="lat blb-print">Ballet l Ba7er</div>' +
            '<p class="gl">Lebanese, said to end an argument: <b>go tile the sea.</b> ' +
              'Fine. We brought mortar.</p>' +
          '</div>' +
          '<div class="blb-mpause"><div class="ar">استراحة</div><div class="en">Este2a7a — paused</div></div>' +
          '<nav class="blb-mnav">' +
            MB('continue', '01', 'Kammel', 'continue your stretch of sea', 'كمّل', 'primary') +
            MB('resume', '01', 'Resume', 'back to the balat', 'رجوع', 'primary') +
            MB('new', '02', 'Balle4 men jdid', 'new game — a fresh, untiled sea', 'جديد') +
            MB('howto', '03', 'Kif bteshtghel', 'how to play', 'كيف') +
            MB('settings', '04', 'E3dadat', 'settings', 'إعدادات') +
            MB('credits', '05', 'Credits', 'who is to blame', 'مين') +
            MB('quit', '05', 'Save & quit', 'back to the main menu', 'خروج', 'warn') +
          '</nav>' +
          '<div class="blb-msum" data-sum></div>' +
          '<div class="blb-iload" data-iload style="display:none">' +
            '<div class="bar"><div class="fil blb-haz"></div></div>' +
            '<div class="tx">Mixing the mouna 0%</div>' +
          '</div>' +
          '<p class="blb-mfoot">Directorate of Pointless Works, Saida sub-office. ' +
            'Permit 1991/B. Nothing in this project is load-bearing.</p>' +
        '</div>' +
        '<div class="blb-plaque blb-msheet" data-sheet></div>' +
      '</div>' +
      '<div class="blb-stamp" aria-hidden="true">' +
        '<div class="a">مجلس<br>بلاط البحر</div>' +
        '<div class="b">Pointless<br>works</div>' +
        '<div class="c">1991/B</div>' +
      '</div>';
    const btnStart = intro.querySelector('[data-act="continue"]');
    const introLoad = intro.querySelector('[data-iload]');
    const introLoadFil = introLoad.querySelector('.fil');
    const introLoadTx = introLoad.querySelector('.tx');
    const sheet = intro.querySelector('[data-sheet]');
    const elSum = intro.querySelector('[data-sum]');
    const menuBtns = {};
    ['continue', 'resume', 'new', 'howto', 'settings', 'credits', 'quit'].forEach(function (a) {
      menuBtns[a] = intro.querySelector('[data-act="' + a + '"]');
    });
    let menuState = { mode: 'main', hasSave: false, summary: null, settings: {} };
    let sheetName = '';

    function openSheet(name) {
      sheetName = name;
      intro.classList.toggle('sheet', !!name);
      if (!name) { sheet.classList.remove('on'); sheet.innerHTML = ''; return; }
      const back = '<button class="blb-mback" type="button" data-back>← Back</button>';
      let html = '<div class="cap blb-haz"></div>';
      if (name === 'howto') {
        html += '<h3>How to play <span class="ar">كيف بتشتغل</span></h3><div class="bd">' +
          '<p>Shovel <b>mouna</b> from a pile on the corniche, walk down the stairs, and lay ' +
          '<b>balat</b> out over the sea. Interior tiles are safe forever; the frontier is ' +
          'where the sea fights back. The municipality pays rent on every m² still standing.</p>' +
          '<h4>Health & stamina</h4>' +
          '<p><b>Stamina</b> drains as you work, run and swim. <b>Health</b> is what the sea, ' +
          'a bad fall or an empty stomach take: waves breaking over the frontier slap you, ' +
          'cold water chills you, and swimming with no stamina left is drowning. Hit zero ' +
          'and you pass out — someone drags you to the hospital, and the hospital sends a bill.</p>' +
          '<h4>Eating</h4>' +
          '<p>Two <b>food courts</b> on the corniche — Souk el Akel to the east, Sahet el Qal3a ' +
          'by the castle — plus Knefe Jardali. Walk up to a counter and press ' + K('E') + '. ' +
          'Cheap food is stamina, real food is health, and some of it keeps working for a while.</p>' +
          '<h4>Controls</h4><div class="keys">' +
          '<div>' + K('WASD') + ' walk</div><div>' + K('SHIFT') + ' run</div>' +
          '<div>' + K('SPACE') + ' jump</div><div>' + K('CLICK') + ' lay a balata</div>' +
          '<div>' + K('HOLD CLICK') + ' lay a row</div><div>' + K('HOLD E') + ' shovel mouna</div>' +
          '<div>' + K('E') + ' talk / buy food</div><div>' + K('V') + ' first / third person</div>' +
          '<div>' + K('[') + K(']') + ' mouse sensitivity</div><div>' + K('M') + ' sound</div>' +
          '<div>' + K('ESC') + ' pause menu</div><div>' + K('SCROLL') + ' zoom</div>' +
          '</div></div>' + back;
      } else if (name === 'settings') {
        const st = menuState.settings || {};
        const seg = function (key, opts2, cur) {
          return '<div class="blb-seg">' + opts2.map(function (o) {
            return '<button type="button" data-set="' + key + '" data-val="' + o[0] + '" aria-pressed="' +
              (String(cur) === String(o[0]) ? 'true' : 'false') + '">' + o[1] + '</button>';
          }).join('') + '</div>';
        };
        html += '<h3>Settings <span class="ar">إعدادات</span></h3><div class="bd">' +
          '<div class="blb-set"><div class="k">Sound<small>sea, gulls, voices</small></div>' +
            seg('sound', [['on', 'On'], ['off', 'Off']], st.sound === false ? 'off' : 'on') + '</div>' +
          '<div class="blb-set"><div class="k">Mouse sensitivity<small>also [ and ] in game</small></div>' +
            '<div><input type="range" min="0.3" max="3" step="0.05" data-range="sens" value="' +
            num(st.sens, 1) + '"> <span class="v" data-rv="sens">' + num(st.sens, 1).toFixed(2) + '×</span></div></div>' +
          '<div class="blb-set"><div class="k">Field of view<small>wider sees more sea</small></div>' +
            '<div><input type="range" min="45" max="80" step="1" data-range="fov" value="' +
            num(st.fov, 58) + '"> <span class="v" data-rv="fov">' + Math.round(num(st.fov, 58)) + '°</span></div></div>' +
          '<div class="blb-set"><div class="k">Camera<small>V switches in game</small></div>' +
            seg('view', [['first', 'First'], ['third', 'Third']], st.view || 'first') + '</div>' +
          '<div class="blb-set"><div class="k">Head bob<small>walking sway in first person</small></div>' +
            seg('bob', [['on', 'On'], ['off', 'Off']], st.bob === false ? 'off' : 'on') + '</div>' +
          '</div>' + back;
      } else if (name === 'credits') {
        html += '<h3>Credits <span class="ar">مين</span></h3><div class="bd">' +
          '<p>A game of the Lebanese saying <i>ballet l ba7er</i>. Set on the Saida corniche, ' +
          'with Qalaat al-Bahr on its causeway and Jazirat Ziri on the horizon.</p>' +
          '<p>Every mesh, texture and sound is generated at runtime. Three.js r128 (MIT).</p>' +
          '<h4>Made by</h4><p class="blb-links">' +
            '<a href="' + CONTACT.github + '" target="_blank" rel="noopener">GitHub · ' +
              esc(CONTACT.github.replace(/^https?:\/\//, '')) + '</a>' +
            (CONTACT.linkedin ? '<a href="' + CONTACT.linkedin + '" target="_blank" rel="noopener">LinkedIn · ' +
              esc(CONTACT.linkedin.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a>' : '') +
          '</p>' +
          '<h4>Your ad on the corniche</h4>' +
          '<p>Want your brand on the billboards along the corniche, the food-court roofs or the ' +
            'harbour mole? Email <a href="mailto:' + CONTACT.email + '?subject=' +
            encodeURIComponent('Billboard on Ballet l Ba7er') + '">' + CONTACT.email + '</a>.</p>' +
          '<p>The sponsors on the billboards right now are invented. ' +
          'The sea does not issue receipts.</p></div>' + back;
      } else if (name === 'confirm-new') {
        html += '<h3>Start over? <span class="ar">من جديد؟</span></h3><div class="blb-confirm">' +
          '<p>This throws away your saved sea — every balata, every lira. The sea will ' +
          'not notice. You might.</p><div class="row">' +
          '<button class="blb-mbtn primary" type="button" data-act2="new"><span class="n">!</span>' +
            '<span class="l">Yes, from scratch<span class="s">wipe the save</span></span><span class="a">إيه</span></button>' +
          '<button class="blb-mbtn" type="button" data-back><span class="n">←</span>' +
            '<span class="l">No, keep it<span class="s">back to the menu</span></span><span class="a">لأ</span></button>' +
          '</div></div>';
      }
      sheet.innerHTML = html;
      sheet.classList.add('on');
      const first = sheet.querySelector('button,input');
      try { if (first) first.focus(); } catch (e) {}
    }

    sheet.addEventListener('click', function (e) {
      const t = e.target.closest ? e.target.closest('button') : null;
      if (!t) return;
      if (t.hasAttribute('data-back')) { openSheet(''); focusFirst(); return; }
      if (t.getAttribute('data-act2') === 'new') { openSheet(''); onMenu('new'); return; }
      const key = t.getAttribute('data-set');
      if (key) {
        const val = t.getAttribute('data-val');
        Array.prototype.forEach.call(sheet.querySelectorAll('[data-set="' + key + '"]'), function (b) {
          b.setAttribute('aria-pressed', b === t ? 'true' : 'false');
        });
        const v = (val === 'on') ? true : (val === 'off' ? false : val);
        menuState.settings[key] = v;
        onMenu('setting', { key: key, value: v });
      }
    });
    sheet.addEventListener('input', function (e) {
      const key = e.target.getAttribute && e.target.getAttribute('data-range');
      if (!key) return;
      const v = parseFloat(e.target.value);
      menuState.settings[key] = v;
      const out = sheet.querySelector('[data-rv="' + key + '"]');
      if (out) out.textContent = key === 'fov' ? Math.round(v) + '°' : v.toFixed(2) + '×';
      onMenu('setting', { key: key, value: v });
    });

    intro.querySelector('.blb-mnav').addEventListener('click', function (e) {
      const b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b || b.disabled) return;
      const act = b.getAttribute('data-act');
      if (act === 'howto' || act === 'settings' || act === 'credits') {
        openSheet(sheetName === act ? '' : act);
        return;
      }
      if (act === 'new' && menuState.hasSave) { openSheet('confirm-new'); return; }
      openSheet('');
      onMenu(act);
    });

    function focusFirst() {
      const b = intro.querySelector('.blb-mnav .blb-mbtn:not([hidden])');
      try { if (b) b.focus(); } catch (e) {}
    }

    function paintMenu() {
      const m = menuState.mode === 'pause' ? 'pause' : 'main';
      intro.setAttribute('data-mode', m);
      menuBtns['continue'].hidden = m !== 'main';
      menuBtns.resume.hidden = m !== 'pause';
      menuBtns['new'].hidden = m !== 'main';
      menuBtns.credits.hidden = m !== 'main';
      menuBtns.quit.hidden = m !== 'pause';
      const cont = menuBtns['continue'];
      cont.querySelector('.l').firstChild.textContent = menuState.hasSave ? 'Kammel' : 'Yalla';
      cont.querySelector('.s').textContent = menuState.hasSave
        ? 'continue your stretch of sea' : 'start tiling the sea';
      cont.querySelector('.a').textContent = menuState.hasSave ? 'كمّل' : 'ابدأ';
      // "new game" is only worth showing when there is something to throw away
      if (!menuState.hasSave) menuBtns['new'].hidden = true;
      const s = menuState.summary;
      if (s && (s.tiles || s.lira || s.laid)) {
        elSum.style.display = '';
        elSum.innerHTML = '<div><b>' + fmt(s.metres || 0) + '</b>m² standing</div>' +
          '<div><b>' + fmt(s.laid || 0) + '</b>balat laid</div>' +
          '<div><b>' + fmt(s.lira || 0) + '</b>lira</div>';
      } else {
        elSum.style.display = 'none';
      }
    }

    function showMenu(o) {
      o = o || {};
      menuState = {
        mode: o.mode || menuState.mode || 'main',
        hasSave: o.hasSave != null ? !!o.hasSave : menuState.hasSave,
        summary: o.summary !== undefined ? o.summary : menuState.summary,
        settings: Object.assign({}, menuState.settings, o.settings || {})
      };
      openSheet('');
      paintMenu();
      intro.classList.add('on');
      r.classList.add('menu-open');
      introOpen = true;
      focusFirst();
    }
    paintMenu();
    r.appendChild(hurtEl);
    r.appendChild(faint);
    r.appendChild(intro);

    /* ================================================================== api */
    function setStats(s) {
      if (!s) return;
      if (s.mortar != null) S.mortar = num(s.mortar, S.mortar);
      if (s.mortarMax != null) S.mortarMax = Math.max(1, num(s.mortarMax, S.mortarMax));
      if (s.tiles != null) S.tiles = num(s.tiles, S.tiles);
      if (s.metres != null) S.metres = num(s.metres, S.metres);
      if (s.lira != null) S.lira = num(s.lira, S.lira);
      if (s.workers != null) S.workers = num(s.workers, S.workers);
      if (s.swell != null) S.swell = clamp(num(s.swell, S.swell), 0, 1);
      if (s.healthMax != null) S.healthMax = Math.max(1, num(s.healthMax, S.healthMax));
      if (s.health != null) {
        S.health = clamp(num(s.health, S.health), 0, S.healthMax);
        const frac = S.health / S.healthMax;
        elHpFill.style.transform = 'scaleX(' + frac.toFixed(3) + ')';
        hp.classList.toggle('low', frac <= 0.25 && frac > 0);
        hp.classList.toggle('out', frac <= 0);
      }
      if (s.hpMax != null) S.hpMax = Math.max(1, num(s.hpMax, S.hpMax));
      if (s.hp != null) {
        S.hp = clamp(num(s.hp, S.hp), 0, S.hpMax || 100);
        const lf = S.hp / (S.hpMax || 100);
        elLifeFill.style.transform = 'scaleX(' + lf.toFixed(3) + ')';
        elLifeV.textContent = Math.ceil(S.hp) + ' / ' + Math.round(S.hpMax || 100);
        life.classList.toggle('low', lf <= 0.3);
      }
      if (s.unlocked != null) S.unlocked = normUnlocked(s.unlocked, tiers.length);
      if (s.tierIdx != null) S.tierIdx = clamp(num(s.tierIdx, S.tierIdx) | 0, 0, tiers.length - 1);

      // if nobody is driving frame(), don't let the digits sit at zero
      const stale = frames === 0 || (now() - lastFrame) > 400;
      if (stale) {
        shown.metres = S.metres; shown.lira = S.lira;
        shown.tiles = S.tiles; shown.mortar = S.mortar;
      }
      paintTiers();
      paintNumbers();
      paintSea();
      if (shopOpen) renderShop(Object.assign({}, lastShopState, {
        lira: S.lira, mortar: S.mortar, mortarMax: S.mortarMax,
        workers: S.workers, unlocked: S.unlocked
      }));
    }

    function paintNumbers() {
      elMetres.textContent = fmt(shown.metres);
      elTiles.textContent = fmt(shown.tiles);
      elLira.textContent = fmt(shown.lira);
      elWorkers.textContent = fmt(S.workers);
      const m = Math.round(shown.mortar), mx = Math.round(S.mortarMax);
      elMv.textContent = fmt(m);
      elMm.textContent = '/ ' + fmt(mx);
      const f = clamp(S.mortarMax > 0 ? shown.mortar / S.mortarMax : 0, 0, 1);
      const top = 28 - f * 20;
      elBarrowFill.setAttribute('y', top.toFixed(2));
      elBarrowFill.setAttribute('height', (f * 20).toFixed(2));
      elBarrowSkin.setAttribute('y', top.toFixed(2));
      elBarrowSkin.setAttribute('opacity', f > 0.03 ? '0.75' : '0');
      barrow.classList.toggle('low', f < 0.2);
    }

    function paintSea() {
      const b = seaBand(S.swell);
      const squall = S.swell >= 0.72;
      elSeaName.textContent = 'Sea ' + b.en;
      elSeaAr.textContent = b.ar;
      sea.style.setProperty('--blb-swell', 'var(' + b.c + ')');
      sea.classList.toggle('squall', squall);
      elSeaCap.style.display = squall ? 'block' : 'none';
      const lit = Math.min(5, Math.max(1, Math.ceil(S.swell * 5)));
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < lit);
    }

    // the sea line: amplitude and nervousness both rise with swell
    function paintWave() {
      const s = S.swell, amp = 1.6 + s * 8.4, n = 26;
      let d = '', df = 'M0,26 ';
      for (let i = 0; i <= n; i++) {
        const x = (i / n) * 120;
        const k = x * 0.085 + clock * (0.9 + s * 2.6);
        let y = 13 + Math.sin(k) * amp * 0.62 + Math.sin(k * 2.17 + 1.3) * amp * 0.3;
        if (s > 0.5) y += Math.sin(k * 5.3 + clock * 7) * (s - 0.5) * 3.4;
        y = clamp(y, 2, 24);
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(2) + ' ';
        df += 'L' + x.toFixed(1) + ',' + y.toFixed(2) + ' ';
      }
      elWave.setAttribute('d', d.trim());
      elWaveFill.setAttribute('d', df + 'L120,26 Z');
    }

    function setPrompt(text) {
      if (text == null || text === '') {
        promptEl.classList.remove('on');
        elPromptTx.innerHTML = '';
        return;
      }
      elPromptTx.innerHTML = promptMarkup(text);
      promptEl.classList.add('on');
    }

    function toast(text, kind) {
      const k = kind === 'good' || kind === 'bad' ? kind : 'info';
      const n = el('div', 'blb-plaque blb-toast ' + k + ' in',
        '<div class="bar"></div><div class="tx">' + esc(text) + '</div>');
      toasts.appendChild(n);
      const rec = { node: n, ttl: 3.1 + Math.min(2.2, String(text).length * 0.035), out: false };
      liveToasts.push(rec);
      // cap the stack so a burst of placements can't fill the screen
      while (liveToasts.length > 5) {
        const old = liveToasts.shift();
        if (old.node.parentNode) old.node.parentNode.removeChild(old.node);
      }
      return rec;
    }

    function doHeckle(text) {
      elHeckleTx.textContent = String(text == null ? '' : text);
      heckle.style.display = 'block';
      heckle.classList.remove('out');
      heckle.classList.remove('in');
      void heckle.offsetWidth; // restart the pop
      heckle.classList.add('in');
      heckleTtl = 4.4 + Math.min(3.4, String(text || '').length * 0.055);
    }

    /* ---- NPC speech ------------------------------------------------------
       One bubble per speaker, parked offscreen until the game tells us where
       that NPC currently projects to. The game owns the 3D->2D projection; we
       only own the look, the lifetime and the fade. */
    const sayLayer = el('div', 'blb-saylayer');
    r.appendChild(sayLayer);
    const bubbles = {};

    function say(id, opts) {
      opts = opts || {};
      let b = bubbles[id];
      if (!b) {
        const node = el('div', 'blb-say');
        node.innerHTML = '<div class="nm"></div><div class="tx"></div>' +
                         '<div class="ar blb-ar"></div><div class="tail"></div>';
        sayLayer.appendChild(node);
        b = bubbles[id] = {
          node: node, nm: node.querySelector('.nm'), tx: node.querySelector('.tx'),
          ar: node.querySelector('.ar'), ttl: 0, x: -9999, y: -9999, vis: false
        };
      }
      b.nm.textContent = opts.name || '';
      b.tx.textContent = String(opts.text == null ? '' : opts.text);
      if (opts.ar) { b.ar.textContent = opts.ar; b.ar.style.display = 'block'; }
      else { b.ar.style.display = 'none'; }
      b.ttl = num(opts.hold, 0) || (2.7 + Math.min(3.8, String(opts.text || '').length * 0.055));
      b.node.classList.remove('in');
      void b.node.offsetWidth;          // restart the pop
      b.node.classList.add('in');
      return b.ttl;
    }
    function anchorSpeech(id, x, y, visible) {
      const b = bubbles[id];
      if (!b) return;
      b.x = x; b.y = y; b.vis = !!visible;
    }
    function clearSpeech(id) {
      const b = bubbles[id];
      if (b) b.ttl = 0;
    }
    function isSaying(id) {
      const b = bubbles[id];
      return !!(b && b.ttl > 0);
    }
    function tickSpeech(dt) {
      for (const id in bubbles) {
        if (!bubbles.hasOwnProperty(id)) continue;
        const b = bubbles[id];
        if (b.ttl > 0) b.ttl -= dt;
        const on = b.ttl > 0 && b.vis;
        if (on) {
          b.node.style.display = 'block';
          // keep the bubble on screen when the speaker is near an edge
          const bw = b.node.offsetWidth, bh = b.node.offsetHeight;
          const x = Math.min(Math.max(b.x, bw / 2 + 10), window.innerWidth - bw / 2 - 10);
          const y = Math.max(b.y, bh + 14);
          b.node.style.left = Math.round(x) + 'px';
          b.node.style.top = Math.round(y) + 'px';
        } else if (b.node.style.display !== 'none') {
          b.node.style.display = 'none';
          b.node.classList.remove('in');
        }
      }
    }

    function setPhase(name) {
      phase = name === 'dusk' || name === 'night' ? name : 'day';
      r.setAttribute('data-phase', phase);
      phaseTag.textContent = phase === 'day' ? 'Day' : phase === 'dusk' ? 'Dusk' : 'Night';
    }

    function openShop(state) {
      lastShopState = state || {};
      renderShop(lastShopState);
      shop.classList.add('on');
      shopOpen = true;
      try { btnClose.focus(); } catch (e) {}
    }
    function closeShop() {
      shop.classList.remove('on');
      shopOpen = false;
    }

    function showIntro() { showMenu({ mode: 'main' }); }
    function hideIntro() {
      intro.classList.remove('on');
      intro.classList.remove('sheet');
      r.classList.remove('menu-open');
      introOpen = false;
    }

    function setLoading(pct) {
      if (pct == null) {
        loadPct = null;
        load.classList.remove('on');
        introLoad.style.display = 'none';
        btnStart.disabled = false;
        return;
      }
      loadPct = clamp(num(pct, 0), 0, 100);
      const w = loadPct.toFixed(1) + '%';
      load.classList.add('on');
      elLoadT.style.width = w;
      introLoad.style.display = 'block';
      introLoadFil.style.width = w;
      introLoadTx.textContent = 'Mixing the mouna ' + Math.round(loadPct) + '%';
      const ready = loadPct >= 99.5;
      btnStart.disabled = !ready;
    }

    function setReticle(state) {
      cross.setAttribute('data-r',
        state === 'ok' || state === 'bad' || state === 'none' ? state : 'idle');
    }

    /* ---------------------------------------------------------- frame ticker */
    function frame(dt) {
      tickSpeech(dt);
      if (hurtA > 0.001) {
        hurtA = Math.max(0, hurtA - num(dt, 0.016) * 1.6);
        hurtEl.style.opacity = hurtA.toFixed(3);
      } else if (hurtA !== 0) { hurtA = 0; hurtEl.style.opacity = '0'; }
      dt = num(dt, 0.016);
      if (dt > 1) dt /= 1000;          // tolerate milliseconds
      dt = clamp(dt, 0, 0.1);
      lastFrame = now();
      frames++;
      if (!reduced) clock += dt;

      // digits roll toward their target so the hero figure feels earned
      const k = reduced ? 1 : clamp(dt * 9, 0, 1);
      let dirty = false;
      ['metres', 'lira', 'tiles', 'mortar'].forEach(function (key) {
        const t = S[key], c = shown[key];
        if (Math.abs(t - c) < 0.02) { if (c !== t) { shown[key] = t; dirty = true; } return; }
        shown[key] = lerp(c, t, k);
        dirty = true;
      });
      if (dirty) paintNumbers();

      paintWave();

      // squall jitter: the plaque itself gets nervous
      if (!reduced && S.swell > 0.74) {
        shake = (S.swell - 0.74) * 4;
        sea.style.transform = 'translate(' + (Math.random() - 0.5) * shake +
          'px,' + (Math.random() - 0.5) * shake + 'px)';
      } else if (shake !== 0) {
        shake = 0;
        sea.style.transform = '';
      }

      for (let i = liveToasts.length - 1; i >= 0; i--) {
        const t = liveToasts[i];
        t.ttl -= dt;
        if (t.ttl <= 0 && !t.out) { t.out = true; t.node.classList.add('out'); }
        if (t.ttl <= -0.45) {
          if (t.node.parentNode) t.node.parentNode.removeChild(t.node);
          liveToasts.splice(i, 1);
        }
      }

      if (heckleTtl > 0) {
        heckleTtl -= dt;
        if (heckleTtl <= 0) {
          heckle.classList.add('out');
          heckleTtl = -1;
          setTimeout(function () {
            if (heckleTtl < 0) heckle.style.display = 'none';
          }, 420);
        }
      }
    }

    /* -------------------------------------------------------------- keyboard */
    // 1-4 picks a tile, Esc shuts the kiosk. Pass keys:false to own these.
    const wantKeys = opts.keys !== false;
    function onKey(e) {
      if (!wantKeys || e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' ||
          tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
      if (e.key === 'Escape' && shopOpen) { closeShop(); e.preventDefault(); return; }
      if (introOpen) return;
      if (e.key >= '1' && e.key <= '4') {
        const i = parseInt(e.key, 10) - 1;
        if (i < tiers.length) { pickTier(i, true); e.preventDefault(); }
      }
    }
    window.addEventListener('keydown', onKey);

    /* ------------------------------------------------------------- mount it */
    // .blb is absolutely positioned; if the handed-in root is static the
    // overlay would escape to the nearest positioned ancestor instead.
    try {
      if (host !== document.body &&
          window.getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
      }
    } catch (e) {}
    host.appendChild(r);
    paintTiers();
    paintNumbers();
    paintSea();
    paintWave();

    const hud = {
      root: r,
      tiers: tiers,
      HECKLES: HECKLES,
      setStats: setStats,
      setPrompt: setPrompt,
      toast: toast,
      heckle: doHeckle,
      say: say,
      anchorSpeech: anchorSpeech,
      clearSpeech: clearSpeech,
      isSaying: isSaying,
      setPhase: setPhase,
      openShop: openShop,
      closeShop: closeShop,
      showIntro: showIntro,
      hideIntro: hideIntro,
      showMenu: showMenu,
      hideMenu: hideIntro,
      isMenuOpen: function () { return introOpen; },
      menuMode: function () { return introOpen ? menuState.mode : null; },
      closeSheet: function () { if (sheetName) { openSheet(''); focusFirst(); return true; } return false; },
      setBuffs: setBuffs,
      hurt: hurt,
      showFaint: showFaint,
      hideFaint: hideFaint,
      setLoading: setLoading,
      frame: frame,
      // extras, all optional for the orchestrator
      setReticle: setReticle,
      selectTier: function (i) { pickTier(i, false); },
      setMuted: function (m) { return toggleSound(!!m); },
      isMuted: function () { return muted; },
      isShopOpen: function () { return shopOpen; },
      isIntroOpen: function () { return introOpen; },
      randomHeckle: function () {
        return HECKLES[(Math.random() * HECKLES.length) | 0];
      },
      dispose: function () {
        window.removeEventListener('keydown', onKey);
        if (r.parentNode) r.parentNode.removeChild(r);
      }
    };
    hud.destroy = hud.dispose;
    return hud;
  }

  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  /* ===================================================== BLB_HUD.createAudio */
  /* Everything is synthesised. No files, no network, no decoding.
     One AudioContext, created lazily and resumed in unlock(). One white-noise
     buffer, reused by every noise voice. Every source is given a stop time and
     disconnects itself on 'ended', so nothing can leak. */
  function createAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null, master = null, noiseBuf = null;
    let surfSrc = null, surfLP = null, surfGain = null, hissBP = null, hissGain = null;
    let lfo = null, lfoGain = null, started = false;
    let muted = false, voices = 0;
    const MAX_VOICES = 48;

    function ensure() {
      if (ctx || !AC) return ctx;
      try { ctx = new AC(); } catch (e) { ctx = null; return null; }

      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(ctx.destination);

      noiseBuf = makeNoise(2);

      // --- surf bed: one looping noise source, split into body and hiss ----
      surfSrc = ctx.createBufferSource();
      surfSrc.buffer = noiseBuf;
      surfSrc.loop = true;

      surfLP = ctx.createBiquadFilter();
      surfLP.type = 'lowpass';
      surfLP.frequency.value = 500;
      surfLP.Q.value = 0.4;

      surfGain = ctx.createGain();
      surfGain.gain.value = 0.015;

      surfSrc.connect(surfLP);
      surfLP.connect(surfGain);
      surfGain.connect(master);

      hissBP = ctx.createBiquadFilter();
      hissBP.type = 'bandpass';
      hissBP.frequency.value = 3200;
      hissBP.Q.value = 0.7;

      hissGain = ctx.createGain();
      hissGain.gain.value = 0;

      surfSrc.connect(hissBP);
      hissBP.connect(hissGain);
      hissGain.connect(master);

      // slow breathing of the swell, summed into the surf gain param
      lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.085;
      lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.008;
      lfo.connect(lfoGain);
      lfoGain.connect(surfGain.gain);

      return ctx;
    }

    function makeNoise(sec) {
      const n = Math.floor(ctx.sampleRate * sec);
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      // white noise, de-DC'd and cross-faded at the seam so the loop is seamless
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const fade = Math.min(1200, (n / 4) | 0);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[i] = d[i] * k + d[n - fade + i] * (1 - k);
      }
      return b;
    }

    function start() {
      if (started || !ctx) return;
      started = true;
      try { surfSrc.start(0); lfo.start(0); } catch (e) {}
    }

    // every voice routes through here so a stuck node is impossible
    function track(node, stopAt) {
      voices++;
      node.onended = function () {
        voices--;
        try { node.disconnect(); } catch (e) {}
        node.onended = null;
      };
      try { node.stop(stopAt); } catch (e) {}
    }

    function busy() { return !ctx || voices > MAX_VOICES; }

    function pan(amount) {
      if (!ctx.createStereoPanner) return null;
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(amount, -1, 1);
      return p;
    }

    // dest helper: build a gain with an exponential pluck envelope
    function envGain(t, peak, atk, dec) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
      return g;
    }

    function noiseVoice(t, dur, filt, freq, q, peak, atk, dec, out) {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.playbackRate.value = 0.9 + Math.random() * 0.3;
      const off = Math.random() * (noiseBuf.duration - dur - 0.02);
      const f = ctx.createBiquadFilter();
      f.type = filt;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = envGain(t, peak, atk, dec);
      s.connect(f); f.connect(g); g.connect(out || master);
      try { s.start(t, Math.max(0, off), dur + 0.02); } catch (e) { s.start(t); }
      track(s, t + dur + 0.05);
      return f;
    }

    /* ------------------------------------------------------------- the clack */
    // The core feedback loop of the whole game: a glazed tile set into wet
    // mortar. Three inharmonic partials (ceramic, not bell), a grit transient,
    // and a low body knock. Pitch snaps to a pentatonic degree so a fast run of
    // tiles comes out as a phrase instead of a machine gun.
    const DEGREES = [0, 2, 4, 7, 9, 12, 14, 16];
    let lastDeg = -1;
    function clack() {
      const c = ensure(); if (busy()) return;
      const t = c.currentTime + 0.001;
      let di = (Math.random() * DEGREES.length) | 0;
      if (di === lastDeg) di = (di + 1) % DEGREES.length; // avoid flat repeats
      lastDeg = di;
      const base = 760 * Math.pow(2, DEGREES[di] / 12) * (1 + (Math.random() - 0.5) * 0.02);

      const out = ctx.createGain();
      out.gain.value = 0.9;
      const p = pan((Math.random() - 0.5) * 0.5);
      if (p) { out.connect(p); p.connect(master); } else { out.connect(master); }

      const RAT = [1, 2.71, 5.07], AMP = [0.26, 0.1, 0.045], DEC = [0.19, 0.11, 0.055];
      for (let i = 0; i < RAT.length; i++) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.value = base * RAT[i] * (1 + (Math.random() - 0.5) * 0.01);
        const g = envGain(t, AMP[i], 0.003, DEC[i]);
        o.connect(g); g.connect(out);
        o.start(t);
        track(o, t + DEC[i] + 0.06);
      }
      // the chink of grit between tile and mortar
      noiseVoice(t, 0.03, 'bandpass', base * 2.3, 2.2, 0.12, 0.001, 0.028, out);
      // the dull knock of the bed taking the weight
      const k = ctx.createOscillator();
      k.type = 'sine';
      k.frequency.setValueAtTime(190 + Math.random() * 40, t);
      k.frequency.exponentialRampToValueAtTime(96, t + 0.09);
      const kg = envGain(t, 0.16, 0.004, 0.085);
      k.connect(kg); kg.connect(out);
      k.start(t);
      track(k, t + 0.14);
    }

    /* ------------------------------------------------------------ pour / mix */
    function pour() {
      const c = ensure(); if (busy()) return;
      const t = c.currentTime + 0.001;
      const f = noiseVoice(t, 0.5, 'bandpass', 2400, 1.1, 0.2, 0.05, 0.42);
      if (f) {
        f.frequency.setValueAtTime(2400, t);
        f.frequency.exponentialRampToValueAtTime(620, t + 0.46);
      }
      // individual stones landing
      for (let i = 0; i < 5; i++) {
        const tt = t + 0.02 + Math.random() * 0.4;
        noiseVoice(tt, 0.03, 'highpass', 1800 + Math.random() * 2200, 0.8,
          0.05 + Math.random() * 0.04, 0.002, 0.026);
      }
    }

    /* --------------------------------------------------------- tile crumbling */
    function crumble() {
      const c = ensure(); if (busy()) return;
      const t = c.currentTime + 0.001;
      const f = noiseVoice(t, 0.55, 'lowpass', 1900, 1.4, 0.26, 0.006, 0.5);
      if (f) {
        f.frequency.setValueAtTime(1900, t);
        f.frequency.exponentialRampToValueAtTime(260, t + 0.5);
      }
      const n = 7;
      for (let i = 0; i < n; i++) {
        const tt = t + 0.01 + Math.random() * 0.34;
        noiseVoice(tt, 0.045, 'bandpass', 420 + Math.random() * 1500, 3.2,
          0.07 + Math.random() * 0.06, 0.002, 0.04);
      }
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(58, t + 0.3);
      const g = envGain(t, 0.17, 0.008, 0.3);
      o.connect(g); g.connect(master);
      o.start(t);
      track(o, t + 0.36);
    }

    /* ---------------------------------------------------------------- splash */
    function splash() {
      const c = ensure(); if (busy()) return;
      const t = c.currentTime + 0.001;
      const f = noiseVoice(t, 0.5, 'bandpass', 700, 0.8, 0.22, 0.012, 0.46);
      if (f) {
        f.frequency.setValueAtTime(700, t);
        f.frequency.exponentialRampToValueAtTime(3000, t + 0.13);
        f.frequency.exponentialRampToValueAtTime(900, t + 0.48);
      }
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(260, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.22);
      const g = envGain(t, 0.14, 0.006, 0.22);
      o.connect(g); g.connect(master);
      o.start(t);
      track(o, t + 0.3);
      for (let i = 0; i < 3; i++) {
        noiseVoice(t + 0.16 + Math.random() * 0.3, 0.035, 'bandpass',
          2600 + Math.random() * 2400, 4, 0.05, 0.002, 0.03);
      }
    }

    /* ------------------------------------------------------------------ gull */
    function gull() {
      const c = ensure(); if (busy()) return;
      let t = c.currentTime + 0.001;
      const cries = 2 + ((Math.random() * 2) | 0);
      const top = 1250 + Math.random() * 450;
      const bus = ctx.createGain();
      bus.gain.value = 1;
      const p = pan((Math.random() - 0.5) * 1.3);
      if (p) { bus.connect(p); p.connect(master); } else { bus.connect(master); }
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 2.4;
      bp.connect(bus);
      for (let i = 0; i < cries; i++) {
        const f0 = top * Math.pow(0.9, i), dur = 0.2 + Math.random() * 0.08;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f0 * 0.55, t);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.045);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + dur);
        // the ragged vibrato that makes it a gull and not a theremin
        const vib = ctx.createOscillator();
        vib.type = 'sine';
        vib.frequency.value = 26 + Math.random() * 10;
        const vg = ctx.createGain();
        vg.gain.value = f0 * 0.05;
        vib.connect(vg); vg.connect(o.frequency);
        const g = envGain(t, 0.075, 0.03, dur);
        o.connect(g); g.connect(bp);
        o.start(t); vib.start(t);
        track(o, t + dur + 0.08);
        track(vib, t + dur + 0.08);
        t += dur + 0.1 + Math.random() * 0.1;
      }
    }

    /* ----------------------------------------------------------- ui + chime */
    function ui() {
      const c = ensure(); if (busy()) return;
      const t = c.currentTime + 0.001;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(1180, t);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.05);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2600;
      const g = envGain(t, 0.05, 0.002, 0.048);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t);
      track(o, t + 0.09);
    }

    /* A muttered syllable or two, pitched per character — enough to read as
       "someone said something" without pretending to be speech. */
    function voiceBlip(voice) {
      const c = ensure(); if (busy()) return;
      const base = 190 + ((voice | 0) % 5) * 46;
      const t0 = c.currentTime + 0.001;
      const n = 2 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const t = t0 + i * (0.085 + Math.random() * 0.035);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        const f0 = base * (0.88 + Math.random() * 0.3);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.linearRampToValueAtTime(f0 * (0.82 + Math.random() * 0.4), t + 0.06);
        const fl = ctx.createBiquadFilter();
        fl.type = 'bandpass';
        fl.frequency.value = base * 3.1;
        fl.Q.value = 1.4;
        const g = envGain(t, 0.075, 0.006, 0.062);
        o.connect(fl); fl.connect(g); g.connect(master);
        o.start(t);
        track(o, t + 0.1);
      }
    }

    function purchase() {
      const c = ensure(); if (busy()) return;
      const t0 = c.currentTime + 0.001;
      const steps = [0, 4, 7, 12];
      for (let i = 0; i < steps.length; i++) {
        const t = t0 + i * 0.075;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 523.25 * Math.pow(2, steps[i] / 12);
        const g = envGain(t, 0.1, 0.004, 0.16);
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = 523.25 * Math.pow(2, steps[i] / 12) * 2.01;
        const g2 = envGain(t, 0.035, 0.004, 0.1);
        o.connect(g); g.connect(master);
        o2.connect(g2); g2.connect(master);
        o.start(t); o2.start(t);
        track(o, t + 0.22);
        track(o2, t + 0.16);
      }
    }

    // a dull thump with a falling pitch: the sea, or the ground, landing on you
    function hurt() {
      const c = ensure(); if (busy()) return;
      const t = c.currentTime + 0.001;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.22);
      const g = envGain(t, 0.32, 0.004, 0.26);
      o.connect(g); g.connect(master);
      o.start(t);
      track(o, t + 0.3);
    }

    /* --------------------------------------------------------------- the sea */
    function wash(level) {
      const c = ensure(); if (!c) return;
      const l = clamp(num(level, 0), 0, 1);
      const t = c.currentTime, tc = 0.7;
      surfGain.gain.setTargetAtTime(0.012 + l * 0.2, t, tc);
      surfLP.frequency.setTargetAtTime(420 + l * 3400, t, tc);
      hissGain.gain.setTargetAtTime(l * l * 0.06, t, tc);
      hissBP.frequency.setTargetAtTime(2600 + l * 2600, t, tc);
      lfoGain.gain.setTargetAtTime(0.006 + l * 0.055, t, tc);
      lfo.frequency.setTargetAtTime(0.07 + l * 0.17, t, 2);
    }

    const sfx = {
      clack: clack, pour: pour, crumble: crumble, splash: splash,
      gull: gull, ui: ui, purchase: purchase, hurt: hurt, wash: wash, say: voiceBlip,
      unlock: function () {
        const c = ensure();
        if (!c) return;
        if (c.state === 'suspended' && c.resume) { try { c.resume(); } catch (e) {} }
        start();
      },
      get muted() { return muted; },
      set muted(v) {
        muted = !!v;
        if (master && ctx) {
          master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.04);
        }
      },
      get context() { return ctx; },
      dispose: function () {
        if (!ctx) return;
        try { surfSrc.stop(0); lfo.stop(0); } catch (e) {}
        try { ctx.close(); } catch (e) {}
        ctx = null; started = false;
      }
    };
    return sfx;
  }

  window.BLB_HUD = {
    create: create,
    createAudio: createAudio,
    HECKLES: HECKLES,
    PALETTE: P,
    TIERS: TIER_FALLBACK,
    PRICES: PRICE
  };
})();
