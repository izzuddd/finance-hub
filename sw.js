// Offline-first shell cache. Bump VERSION when deploying new files.
const VERSION = 'hub-v1.0.4';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/config.js', 'js/db.js', 'js/model.js', 'js/sync.js', 'js/ui.js', 'js/util.js',
  'js/pages/add.js', 'js/pages/budget.js', 'js/pages/insight.js', 'js/pages/plan.js', 'js/pages/saving.js', 'js/pages/settings.js', 'js/pages/trip.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// App files: cache first (instant start), refreshed in the background. Google APIs: always network.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request.url, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
