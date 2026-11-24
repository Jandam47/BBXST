// ════════════════════════════════════════════════════════════════
//  Odznak na záložce Komunikace: místnosti chatu s novou zprávou + otevřené ankety, kde jsem nehlasoval
//  + dotazy (hlavní admin: nevyřízené; ostatní: nová odpověď). „Přečteno“ = localStorage (chat.js,
//  feedback.js), přepočet po události bbx:seen, živě přes realtime (chat) a polling.
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, isLoggedIn } from './supa.js'

const read = (k) => { try { return JSON.parse(localStorage.getItem(seenKey(k))) || {} } catch { return {} } }
let rooms = [], polls = 0, fb = { open: 0, last_reply: null }, channel = null, timer = null, poll = null

// klíč „přečteno“ v localStorage pro přihlášeného uživatele (staré společné hodnoty se převezmou)
export function seenKey(base) {
  const k = base + ':' + (state.user?.id || '')
  try { if (localStorage.getItem(k) == null && localStorage.getItem(base) != null) localStorage.setItem(k, localStorage.getItem(base)) } catch {}
  return k
}

// „přečteno“ i na serveru (30), aby platilo na všech zařízeních; zápis jen dopředu, s krátkým odkladem
const pending = new Map()
let flushT = null
export function syncSeen(key, val) {
  if (!isLoggedIn() || val == null) return
  const old = pending.get(key)
  pending.set(key, old == null || val > old ? val : old)
  clearTimeout(flushT)
  flushT = setTimeout(() => {
    for (const [k, v] of pending) rpc('seen_set', k === 'fb' ? { p_key: k, p_at: v } : { p_key: k, p_id: v }).catch(() => {})
    pending.clear()
  }, 700)
}
// stav ze serveru přepíše lokální, když je novější (přečteno jinde)
function mergeServer() {
  try {
    const cs = read('bbxu_chat_seen'); let ch = false
    for (const r of rooms) if (r.seen && r.seen > (cs[r.id] || 0)) { cs[r.id] = r.seen; ch = true }
    if (ch) localStorage.setItem(seenKey('bbxu_chat_seen'), JSON.stringify(cs))
    if (fb.seen && fb.seen > (localStorage.getItem(seenKey('bbxu_fb_seen')) || '')) localStorage.setItem(seenKey('bbxu_fb_seen'), fb.seen)
  } catch {}
}

// počty po částech Komunikace (kolečko je ukazuje na výsečích)
export function unreadCounts() {
  const cs = read('bbxu_chat_seen')
  let fbSeen = ''
  try { fbSeen = localStorage.getItem(seenKey('bbxu_fb_seen')) || '' } catch {}
  return {
    chat: rooms.filter(r => r.last && r.last.id > (cs[r.id] || 0)).length,
    polls,
    fb: (fb.open || 0) + (fb.last_reply && fb.last_reply > fbSeen ? 1 : 0),
  }
}

function paint() {
  const c = unreadCounts(), n = c.chat + c.polls + c.fb
  const tab = document.querySelector('.tabbar a[data-tab="chat"] .ico')
  if (tab) {
    let b = tab.querySelector('.nbadge')
    if (n && !b) { b = document.createElement('span'); b.className = 'nbadge'; tab.append(b) }
    if (b) { if (n) { b.textContent = n > 9 ? '9+' : String(n); b.setAttribute('aria-label', `${n} nových`) } else b.remove() }
  }
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.() } catch {}
}

async function refresh() {
  if (!isLoggedIn() || !state.profile?.nick) { rooms = []; polls = 0; fb = { open: 0, last_reply: null }; return paint() }
  try {
    const [r, p, f] = await Promise.all([rpc('chat_room_list'), rpc('poll_pending').catch(() => 0), rpc('feedback_count').catch(() => null)])
    rooms = r || []; polls = p || 0; fb = f || { open: 0, last_reply: null }
    mergeServer()
  } catch { /* bez sítě nech poslední stav */ }
  paint()
}
const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 1200) }

export function watchUnread() {
  if (channel) { sb.removeChannel(channel); channel = null }
  clearInterval(poll)
  refresh()
  if (!isLoggedIn() || !state.profile?.nick) return
  channel = sb.channel('unread')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, soon)
    .subscribe()
  poll = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 90000)
}

// po hlasování / odpovědi se čísla změní na serveru – přepočítat; „přečteno“ v chatu stačí jen překreslit
window.addEventListener('bbx:seen', () => { paint(); soon() })
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon() })
