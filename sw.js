// BBXU service worker – aplikace se načte i při slabém signálu v hale.
// Data (turnaje, výsledky) jdou vždy živě ze Supabase, cachuje se jen „obal“ aplikace.
const VERSION = 'bbxu-v101'
const SHELL = [
  './', './index.html', './bbxst.html', './bp.html', './manifest.json', './css/bbxu.css',
  './js/config.js', './js/app.js', './js/core.js', './js/supa.js', './js/ui.js', './js/challenge.js', './js/tvlayout.js',
  './js/parts.js', './js/icons.js', './js/theme.js', './js/favorites.js', './js/views/favorites.js', './js/stats.js', './js/views/stats.js', './js/views/fashion.js', './js/views/communities.js', './js/views/training.js', './js/views/home.js', './js/views/tournament.js', './js/views/manage.js', './js/views/players.js',
  './js/views/profile.js', './js/views/chat.js', './js/views/komunikace.js', './js/views/polls.js', './js/views/feedback.js', './js/unread.js', './js/report.js', './js/share.js', './js/push.js', './js/errlog.js', './js/admin.js', './js/views/help.js', './js/views/leagues.js', './js/views/live.js', './js/install.js', './js/create-wheel.js', './js/regcheck.js', './js/views/auth.js', './js/views/meta.js',
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

// push i při zavřené aplikaci (Edge Function `push`): { title, body, url, tag }
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'BBX Unity', body: e.data?.text() || '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'BBX Unity', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: d.url || '#/', accept_url: d.accept_url, decline: d.decline, api: d.api },
    actions: Array.isArray(d.actions) ? d.actions.slice(0, 2) : undefined,     // výzva: Přijmout / Odmítnout
    icon: 'icons/bbxu-192.png', badge: 'icons/bbxu-192.png', vibrate: [200, 100, 200],
  }))
})

// adresa a veřejný klíč API pro akci na pozadí – z js/config.js (fallback: z notifikace)
async function apiCfg(fallback) {
  try {
    const t = await (await fetch('./js/config.js', { cache: 'no-store' })).text()
    const url = t.match(/supabaseUrl:\s*'([^']+)'/)?.[1], key = t.match(/supabaseAnonKey:\s*'([^']+)'/)?.[1]
    if (url && key) return { url, key }
  } catch {}
  return fallback
}
async function declineInBackground(d) {
  const api = await apiCfg(d.api)
  if (!api?.url || !d.decline) return false
  const r = await fetch(api.url + '/rest/v1/rpc/training_decline_token', {
    method: 'POST', headers: { apikey: api.key, Authorization: 'Bearer ' + api.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_match: d.decline.match, p_token: d.decline.token }),
  })
  return r.ok
}
function openUrl(raw) {
  const target = new URL(raw.startsWith('#') ? './index.html' + raw : raw, self.registration.scope).href
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const same = list.find(x => x.url.split('#')[0] === target.split('#')[0])
    if (same) return same.navigate(target).then(c => (c || same).focus()).catch(() => same.focus())
    return self.clients.openWindow(target)
  })
}

// klik na notifikaci otevře aplikaci na správném místě (#/… = BBXU, bbxst.html… = scoreboard)
// tlačítka výzvy: Přijmout = otevře BBXST a výzvu přijme, Odmítnout = na pozadí (když selže, otevře okno výzvy)
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const d = e.notification.data || {}
  if (e.action === 'accept' && d.accept_url) return e.waitUntil(openUrl(d.accept_url))
  if (e.action === 'decline' && d.decline) {
    return e.waitUntil(declineInBackground(d).catch(() => false).then(ok => ok ? null : openUrl(d.url || '#/')))
  }
  e.waitUntil(openUrl(d.url || '#/'))
})
