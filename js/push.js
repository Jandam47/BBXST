// ════════════════════════════════════════════════════════════════
//  Push notifikace i při zavřené aplikaci (Web Push). Odběr zařízení se uloží v DB (push_subscribe),
//  zprávy posílá Edge Function `push`. Veřejný VAPID klíč je tady, soukromý jen v secrets funkce.
// ════════════════════════════════════════════════════════════════
import { rpc, isLoggedIn, state } from './supa.js'

export const VAPID_PUBLIC = 'BFZ2X3vzL_Vwy5dkUY8tv1bVlTmUFIcG4EsrQt9t2wYpFklM7yJtteETJTUzcPgml9AN07_riS8gM0uqKaVctjc'

const b64 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)) }
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

export function pushSupport() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS() && !standalone() ? 'ios-install' : 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  return 'ok'
}

// service worker může chybět (zakázaný, první načtení) – nečekej na něj věčně
const swReady = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('Aplikace se ještě načítá – zkus to za chvíli znovu.')), 4000))])
async function currentSub() {
  const reg = await swReady()
  return reg.pushManager.getSubscription()
}

export async function pushStatus() {
  const s = pushSupport()
  if (s !== 'ok') return { support: s, on: false }
  const sub = await currentSub().catch(() => null)
  if (!sub) return { support: s, on: false }
  const st = await rpc('push_status', { p_endpoint: sub.endpoint }).catch(() => null)
  return { support: s, on: !!st?.this_device, devices: st?.devices || 0 }
}

async function save(sub) {
  const j = sub.toJSON()
  await rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 200) })
}

export async function enablePush() {
  if (pushSupport() !== 'ok') throw new Error('Tenhle prohlížeč upozornění neumí.')
  if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') {
    throw new Error('Upozornění nejsou povolená – povol je v nastavení prohlížeče.')
  }
  const reg = await swReady()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) })
  await save(sub)
}

export async function disablePush() {
  const sub = await currentSub().catch(() => null)
  if (!sub) return
  await rpc('push_unsubscribe', { p_endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

// po přihlášení: zařízení, které už má povolená upozornění, se tiše přihlásí k odběru pro tenhle účet
export async function syncPush() {
  try {
    if (!isLoggedIn() || !state.profile?.nick || pushSupport() !== 'ok' || Notification.permission !== 'granted') return
    if (localStorage.getItem('bbxu_push_off')) return
    const sub = await currentSub()
    if (sub) await save(sub)
    else await enablePush()
  } catch { /* bez sítě / bez podpory nevadí */ }
}
