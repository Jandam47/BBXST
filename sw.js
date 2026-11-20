// BBXU service worker – aplikace se načte i při slabém signálu v hale.
// Data (turnaje, výsledky) jdou vždy živě ze Supabase, cachuje se jen „obal“ aplikace.
const VERSION = 'bbxu-v28'
const SHELL = [
  './', './index.html', './bbxst.html', './manifest.json', './css/bbxu.css',
  './js/config.js', './js/app.js', './js/core.js', './js/supa.js', './js/ui.js',
  './js/parts.js', './js/icons.js', './js/views/fashion.js', './js/views/communities.js', './js/views/training.js', './js/views/home.js', './js/views/tournament.js', './js/views/manage.js', './js/views/players.js',
  './js/views/profile.js', './js/views/chat.js', './js/views/auth.js', './js/views/meta.js',
  './vendor/supabase.js', './vendor/qrcode.js', './vendor/html5-qrcode.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png',
  './icons/bbxunity.webp', './icons/bbxunity-wordmark.webp', './icons/bbxu-192.png', './icons/bbxu-32.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

// vlastní soubory: síť první (ať se hned projeví nová verze), cache jako záloha
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  )
})

// klik na notifikaci „hraješ na aréně…“ otevře aplikaci
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    const c = list.find(x => x.url.includes(self.registration.scope))
    return c ? c.focus() : self.clients.openWindow('./index.html#/')
  }))
})
