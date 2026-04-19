/* 915 Race Control — Service Worker
   Goal: app works fully offline once installed.
   Strategy: cache-first for own-origin assets, network-first for cross-origin (probe, fonts, etc.)
   Bump CACHE_VERSION whenever index.html changes to force a refresh. */

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = '915rc-' + CACHE_VERSION;

// Everything we want guaranteed offline. Keep this list minimal — all app logic lives in index.html.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './playstore-icon.png'
];

// INSTALL — pre-cache the shell so first launch from home screen works offline.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] install pre-cache failed:', err))
  );
});

// ACTIVATE — drop any old versions so we don't leak storage across deploys.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('915rc-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// FETCH — only intercept same-origin GETs. Everything else (Cloudflare probe,
// cross-origin calls) passes straight through so we never break real network logic.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // don't touch cross-origin

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache-first: instant launch even on zero cell.
    const cached = await cache.match(req);
    if (cached) {
      // Fire-and-forget background refresh so next launch has latest.
      fetch(req).then(resp => {
        if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
      }).catch(() => {});
      return cached;
    }
    // Not cached yet — go to network, cache the result, return it.
    try {
      const resp = await fetch(req);
      if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
      return resp;
    } catch (err) {
      // Total offline AND never cached. Return a stub so the browser doesn't scream.
      return new Response('offline', { status: 503, statusText: 'Offline' });
    }
  })());
});

// MESSAGE — manual update trigger (optional, lets the app ask for a cache refresh).
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
