/* BALLET L BA7ER — ads.js   →   window.BLB_ADS
 *
 * The in-game advertising: billboards standing in the 3D world (on the
 * corniche, on the food-court roofs, out on the harbour mole). One schema, one
 * renderer, shared by the game and by the CMS page that edits them. Ads are TEXT + COLOUR, painted onto a canvas at
 * runtime — no image URLs, so the no-external-assets rule still holds.
 *
 * Where the live list comes from, in order:
 *   1. a preview the CMS pushed into this browser (localStorage)
 *   2. ads.json next to the page (what the CMS publishes)
 *   3. DEFAULTS below, so file:// and offline still have something to show
 * Plain script, ES2017, attaches one global. */
(function (root) {
  'use strict';

  var PREVIEW_KEY = 'blb.ads.preview';
  var STATS_KEY = 'blb.ads.stats';
  /* Billboard locations in the world. An ad lists the ones it is booked on. */
  var PLACEMENTS = ['corniche-w', 'corniche-e', 'souk', 'qalaa', 'harbour'];
  var PLACEMENT_NAMES = {
    'corniche-w': 'Corniche west hoarding (by the stairs)',
    'corniche-e': 'Corniche east hoarding (by Souk el Akel)',
    souk: 'Souk el Akel roof (east food court)',
    qalaa: 'Sahet el Qal3a roof (west food court)',
    harbour: 'Harbour mole (seen from the water)'
  };
  var LAYOUTS = ['poster', 'split', 'stamp'];

  /* What runs when ads.json cannot be reached (offline, file://). Keep it in
     step with ads.json. */
  var DEFAULTS = [
    {
      id: 'puzzlebooth', active: true, sponsor: 'PuzzleBooth',
      headline: 'Photobooths for weddings & events across Lebanon', ar: '',
      tagline: 'Mirror · 360 · Mosaic  —  puzzleslb.com/puzzlebooth', layout: 'poster',
      bg: '#000000', fg: '#FFFFFF', accent: '#34AD54',
      placements: ['corniche-w'], weight: 1, start: '', end: ''
    }
  ];

  /* What a board shows when no ad is booked on it: the space is for sale. */
  var VACANT = {
    id: 'vacant', active: true, sponsor: 'Ad space coming soon',
    headline: 'Your brand on the Saida corniche.', ar: 'إعلانك هون قريبًا',
    tagline: 'Inquire in Credits  ·  mmerhikarim@gmail.com', layout: 'poster',
    bg: '#E4D7B3', fg: '#0B3A4F', accent: '#F2B733',
    placements: [], weight: 0, start: '', end: ''
  };

  // ---------------------------------------------------------------- helpers
  function str(v, max) {
    var s = v == null ? '' : String(v);
    return max && s.length > max ? s.slice(0, max) : s;
  }
  function colour(v, d) {
    return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : d;
  }
  function slug(s) {
    return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  /* Normalise anything that claims to be an ad list: a bare array, or the
     { ads: [...] } envelope ads.json uses. Bad fields fall back, never throw. */
  function normalize(input) {
    var list = Array.isArray(input) ? input : (input && Array.isArray(input.ads) ? input.ads : []);
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {};
      var id = slug(a.id || a.sponsor || ('ad-' + (i + 1))) || ('ad-' + (i + 1));
      while (seen[id]) id += '-x';
      seen[id] = true;
      // older lists booked one 'corniche' location for both hoardings
      var raw = Array.isArray(a.placements) ? a.placements.reduce(function (acc, p) {
        return acc.concat(p === 'corniche' ? ['corniche-w', 'corniche-e'] : [p]);
      }, []) : PLACEMENTS.slice();
      var pl = PLACEMENTS.filter(function (p) { return raw.indexOf(p) >= 0; });
      out.push({
        id: id,
        active: a.active !== false,
        sponsor: str(a.sponsor, 48) || 'Sponsor',
        headline: str(a.headline, 90),
        ar: str(a.ar, 48),
        tagline: str(a.tagline, 80),
        layout: LAYOUTS.indexOf(a.layout) >= 0 ? a.layout : 'poster',
        bg: colour(a.bg, '#0B3A4F'),
        fg: colour(a.fg, '#EDF6F3'),
        accent: colour(a.accent, '#F2B733'),
        placements: pl,
        weight: Math.max(0, Math.min(10, Number(a.weight) || 1)),
        start: str(a.start, 10),
        end: str(a.end, 10)
      });
    }
    return out;
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /* Active, scheduled for today, and booked into this placement. */
  function eligible(list, placement, day) {
    day = day || today();
    return (list || []).filter(function (a) {
      if (!a.active || a.weight <= 0) return false;
      if (placement && a.placements.indexOf(placement) < 0) return false;
      if (a.start && day < a.start) return false;
      if (a.end && day > a.end) return false;
      return true;
    });
  }

  /* Weighted pick that avoids repeating `notId` when there is any choice. */
  function pick(list, placement, notId, rnd) {
    var pool = eligible(list, placement);
    if (pool.length > 1 && notId) pool = pool.filter(function (a) { return a.id !== notId; });
    if (!pool.length) return null;
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += pool[i].weight;
    var r = (rnd || Math.random)() * total;
    for (i = 0; i < pool.length; i++) { r -= pool[i].weight; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  // ---------------------------------------------------------------- render
  var AR_FONT = '"Reem Kufi","Noto Naskh Arabic","Geeza Pro","Al Bayan","Segoe UI",sans-serif';
  var LAT_FONT = '"Barlow Condensed",system-ui,-apple-system,"Segoe UI",sans-serif';

  /* Shrink a font until the line fits, so long CMS copy never runs off. */
  function fit(g, text, weight, size, family, maxW) {
    var s = size;
    g.font = weight + ' ' + s + 'px ' + family;
    while (s > 10 && g.measureText(text).width > maxW) {
      s -= 2;
      g.font = weight + ' ' + s + 'px ' + family;
    }
    return s;
  }

  function chevrons(g, x, y, w, h, a, b) {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = b; g.fillRect(x, y, w, h);
    g.fillStyle = a;
    var step = h * 1.4;
    for (var k = -h * 2; k < w + h * 2; k += step) {
      g.beginPath();
      g.moveTo(x + k, y + h); g.lineTo(x + k + step / 2, y + h);
      g.lineTo(x + k + step / 2 + h * 0.6, y); g.lineTo(x + k + h * 0.6, y);
      g.closePath(); g.fill();
    }
    g.restore();
  }

  /* Paint one ad into a w×h canvas context. Aspect is assumed ~2:1. */
  function draw(g, w, h, ad) {
    ad = ad || normalize([{}])[0];
    var pad = Math.round(h * 0.07);
    g.save();
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = ad.bg; g.fillRect(0, 0, w, h);

    if (ad.layout === 'split') {
      // accent block carrying the Arabic name, copy on the right
      var bw = Math.round(w * 0.42);
      g.fillStyle = ad.accent; g.fillRect(0, 0, bw, h);
      g.fillStyle = ad.bg;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      fit(g, ad.ar || ad.sponsor, '700', Math.round(h * 0.26), AR_FONT, bw - pad * 2);
      g.fillText(ad.ar || ad.sponsor, bw / 2, h * 0.46);
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      var cx = bw + pad, cw = w - bw - pad * 2;
      g.fillStyle = ad.fg;
      fit(g, ad.sponsor.toUpperCase(), '700', Math.round(h * 0.075), LAT_FONT, cw);
      g.globalAlpha = 0.75; g.fillText(ad.sponsor.toUpperCase(), cx, pad + h * 0.08); g.globalAlpha = 1;
      wrap(g, ad.headline, cx, h * 0.36, cw, Math.round(h * 0.13), ad.fg, 3);
      g.fillStyle = ad.accent;
      fit(g, ad.tagline, '600', Math.round(h * 0.07), LAT_FONT, cw);
      g.fillText(ad.tagline, cx, h - pad * 1.2);
    } else if (ad.layout === 'stamp') {
      // a round municipal-looking stamp beside the copy
      var r = h * 0.34, sx = w - pad - r, sy = h / 2;
      g.strokeStyle = ad.accent; g.lineWidth = h * 0.025;
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.stroke();
      g.lineWidth = h * 0.008;
      g.beginPath(); g.arc(sx, sy, r * 0.86, 0, Math.PI * 2); g.stroke();
      g.save(); g.translate(sx, sy); g.rotate(-0.22);
      g.fillStyle = ad.accent; g.textAlign = 'center'; g.textBaseline = 'middle';
      fit(g, ad.ar || ad.sponsor, '700', Math.round(h * 0.15), AR_FONT, r * 1.6);
      g.fillText(ad.ar || ad.sponsor, 0, 0);
      g.restore();
      var tw = w - r * 2 - pad * 3.5;
      g.fillStyle = ad.fg;
      fit(g, ad.sponsor.toUpperCase(), '700', Math.round(h * 0.14), LAT_FONT, tw);
      g.fillText(ad.sponsor.toUpperCase(), pad, h * 0.3);
      wrap(g, ad.headline, pad, h * 0.5, tw, Math.round(h * 0.1), ad.fg, 2);
      g.fillStyle = ad.accent;
      fit(g, ad.tagline, '600', Math.round(h * 0.065), LAT_FONT, tw);
      g.fillText(ad.tagline, pad, h - pad * 1.3);
    } else {
      // poster: hazard band, big Arabic, headline, tagline footer
      chevrons(g, 0, 0, w, Math.round(h * 0.07), ad.accent, ad.bg);
      g.fillStyle = ad.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      // the big line: the Arabic name, or — for a brand without one — its
      // name as a Latin wordmark, which then is not repeated in the footer
      var big = ad.ar || ad.sponsor.toUpperCase();
      fit(g, big, '700', Math.round(h * 0.25), ad.ar ? AR_FONT : LAT_FONT, w - pad * 2);
      g.fillText(big, w / 2, h * 0.32);
      g.textBaseline = 'alphabetic';
      fit(g, ad.headline, '700', Math.round(h * 0.11), LAT_FONT, w - pad * 2);
      g.fillText(ad.headline, w / 2, h * 0.66);
      g.fillStyle = ad.accent;
      g.fillRect(0, h - h * 0.17, w, h * 0.17);
      g.fillStyle = ad.bg;
      var foot = ad.ar ? ad.sponsor.toUpperCase() + (ad.tagline ? '  ·  ' + ad.tagline : '') : ad.tagline;
      fit(g, foot, '700', Math.round(h * 0.07), LAT_FONT, w - pad * 2);
      g.textBaseline = 'middle';
      g.fillText(foot, w / 2, h - h * 0.085);
    }

    // the little disclosure tag every ad carries
    g.textAlign = 'right'; g.textBaseline = 'top';
    g.font = '700 ' + Math.round(h * 0.045) + 'px ' + LAT_FONT;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(w - h * 0.16 - pad * 0.3, pad * 0.25 + h * 0.07, h * 0.16, h * 0.065);
    g.fillStyle = '#EDF6F3';
    g.fillText('AD', w - pad * 0.3 - h * 0.05, pad * 0.25 + h * 0.08);
    g.restore();
  }

  function wrap(g, text, x, y, maxW, size, col, maxLines) {
    var words = str(text).split(/\s+/), line = '', lines = [];
    g.font = '700 ' + size + 'px ' + LAT_FONT;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] += '…';
    }
    g.fillStyle = col;
    for (var k = 0; k < lines.length; k++) g.fillText(lines[k], x, y + k * size * 1.08);
  }

  // ---------------------------------------------------------------- storage
  function readPreview() {
    try {
      var raw = localStorage.getItem(PREVIEW_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      return d && Array.isArray(d.ads) ? normalize(d.ads) : null;
    } catch (e) { return null; }
  }
  function writePreview(list) {
    try { localStorage.setItem(PREVIEW_KEY, JSON.stringify({ at: Date.now(), ads: list })); return true; }
    catch (e) { return false; }
  }
  function clearPreview() {
    try { localStorage.removeItem(PREVIEW_KEY); } catch (e) { /* ignore */ }
  }

  /* Impressions — an ad that was actually on screen on a billboard — counted
     in THIS browser only; the game has no server. */
  function readStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function bump(id) {
    try {
      var s = readStats();
      var r = s[id] || (s[id] = { imp: 0 });
      r.imp = (r.imp || 0) + 1;
      localStorage.setItem(STATS_KEY, JSON.stringify(s));
    } catch (e) { /* private window */ }
  }
  function resetStats() {
    try { localStorage.removeItem(STATS_KEY); } catch (e) { /* ignore */ }
  }

  /* Resolve the live list: preview → ads.json → defaults. Always calls back. */
  function load(cb, url) {
    var prev = readPreview();
    if (prev) { cb(prev, 'preview'); return; }
    var done = false;
    function fallback() { if (!done) { done = true; cb(normalize(DEFAULTS), 'defaults'); } }
    if (typeof fetch !== 'function' || (root.location && root.location.protocol === 'file:')) {
      fallback(); return;
    }
    try {
      fetch(url || 'ads.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) {
          if (done) return;
          var list = normalize(j);
          done = true;
          cb(list.length ? list : normalize(DEFAULTS), list.length ? 'ads.json' : 'defaults');
        })
        .catch(fallback);
      setTimeout(fallback, 4000);
    } catch (e) { fallback(); }
  }

  root.BLB_ADS = {
    DEFAULTS: DEFAULTS, VACANT: VACANT, PLACEMENTS: PLACEMENTS, PLACEMENT_NAMES: PLACEMENT_NAMES, LAYOUTS: LAYOUTS,
    PREVIEW_KEY: PREVIEW_KEY, STATS_KEY: STATS_KEY,
    normalize: normalize, eligible: eligible, pick: pick, draw: draw, load: load,
    readPreview: readPreview, writePreview: writePreview, clearPreview: clearPreview,
    readStats: readStats, bump: bump, resetStats: resetStats, slug: slug, today: today
  };
})(typeof window !== 'undefined' ? window : this);
