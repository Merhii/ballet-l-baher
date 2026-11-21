/* Offline support for the installed game. Everything the game needs is one
   page (three.js and the modules are inlined), plus the billboard list, the
   icons and the Google Fonts.
   - the page and ads.json: network first, so an update shows up on the next
     launch, and the saved copy when there is no signal
   - icons and images: from the cache, filled on first use
   - fonts: the saved copy straight away, refreshed in the background */
var CACHE = 'blb-v1';
var CORE = ['./', 'ads.json', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
      return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, key) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(key || req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(key || req).then(function (hit) { return hit || Response.error(); });
  });
}

function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
        return res;
      }).catch(function () { return hit || Response.error(); });
      return hit || net;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // the game page itself, however it was opened (?v=..., #...)
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith(networkFirst(req, './'));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.origin !== location.origin) return;
  if (/\/ads\.json$/.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
  if (/\.(png|jpg|svg|webmanifest)$/.test(url.pathname)) e.respondWith(cacheFirst(req));
});
