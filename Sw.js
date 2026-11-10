// Keeps a copy of the app on the device so it opens without internet.
// Your P&L data is never cached here: it comes live from Google Sheets,
// and the page itself keeps the last synced copy for offline viewing.

const CACHE = 'mf-pnl-v3';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(async url => {
      try {
        const req = new Request(url, url.startsWith('http') ? { mode: 'no-cors' } : {});
        const res = await fetch(req);
        await cache.put(req, res);
      } catch (e) { /* skip anything unreachable; it is cached later when used */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Live data from Apps Script: never touched here
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Exchange-rate lookups: always live, never saved
  if (url.hostname === 'open.er-api.com' || url.hostname === 'api.frankfurter.dev') return;

  // The app's own files: try the network first so updates arrive, fall back to the saved copy
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Chart library and fonts: saved copy first
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' && (await cache.match('./index.html')))
        || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}
