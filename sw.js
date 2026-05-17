/* 915 Race Control — Service Worker
   Goal: app works fully offline once installed.
   Strategy: cache-first for own-origin assets, network-first for cross-origin (probe, fonts, etc.)
   Bump CACHE_VERSION whenever index.html changes to force a refresh. */

const CACHE_VERSION = 'v1.6.6';
const CACHE_NAME = '915rc-' + CACHE_VERSION;

// Everything we want guaranteed offline. Keep this list minimal — all app logic lives in index.html.
// (The combined-logo image is inlined as a data URI, so no separate logo file is required here.)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './playstore-icon.png'
];

// INSTALL — pre-cache the shell so first launch from home screen works offline.
// Important: cache each asset individually so one missing/broken URL can't reject the
// entire install (which would keep the OLD service worker active and block the update).
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(
      APP_SHELL.map(async url => {
        try {
          const resp = await fetch(url, { cache: 'no-cache' });
          if (resp && resp.ok) await cache.put(url, resp);
          else throw new Error('bad response ' + (resp && resp.status));
        } catch (e) {
          console.warn('[SW] failed to pre-cache', url, e && e.message);
          throw e;
        }
      })
    );
    const fails = results.filter(r => r.status === 'rejected').length;
    if (fails) console.warn('[SW] pre-cache completed with', fails, 'failures out of', APP_SHELL.length);
    await self.skipWaiting();
  })());
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
