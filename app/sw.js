/* ================================================================
   PBX HUB – Service Worker
   Verze: 1.0
================================================================ */
const CACHE = 'pbx-hub-v1';
const OFFLINE_FILES = [
  './bbxu.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

/* Instalace – předkešuj klíčové soubory */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_FILES))
  );
  self.skipWaiting();
});

/* Aktivace – smaž staré cache */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  clients.claim();
});

/* Fetch – network first, fallback na cache */
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
