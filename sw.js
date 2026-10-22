/* The Pocket service worker. Asset list + version are generated: node tools/build-sw.js */
const VERSION = 'pocket-d40fc4a8b6';
const ASSETS = [
  "./",
  "app.js",
  "content.js",
  "fonts/fraunces-latin.woff2",
  "fonts/karla-latin.woff2",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "index.html",
  "manifest.webmanifest",
  "plan-data.js",
  "style.css"
];
self.addEventListener('install', e => {
  // cache:'reload' bypasses the HTTP cache so a new version never precaches stale files.
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('pocket-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const idx = await cache.match('index.html'); if (idx) return idx; }
      throw err;
    }
  }));
});
