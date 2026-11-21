// ════════════════════════════════════════════════════════════════
//  Odznak nepřečtených na záložce Chat: místnosti s novou zprávou + inzeráty s novým komentářem.
//  „Přečteno“ = localStorage (chat.js / bazar.js), přepočet po události bbx:seen, živě přes realtime.
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, isLoggedIn } from './supa.js'

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {} } catch { return {} } }
let rooms = [], ads = [], channel = null, timer = null, poll = null

function paint() {
  const cs = read('bbxu_chat_seen'), bs = read('bbxu_bazar_seen')
  const n = rooms.filter(r => r.last && r.last.id > (cs[r.id] || 0)).length
          + ads.filter(a => a.last_comment && a.last_comment > (bs[a.id] || 0)).length
  const tab = document.querySelector('.tabbar a[data-tab="chat"] .ico')
  if (tab) {
    let b = tab.querySelector('.nbadge')
    if (n && !b) { b = document.createElement('span'); b.className = 'nbadge'; tab.append(b) }
    if (b) { if (n) { b.textContent = n > 9 ? '9+' : String(n); b.setAttribute('aria-label', `${n} nepřečtených`) } else b.remove() }
  }
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.() } catch {}
}

async function refresh() {
  if (!isLoggedIn() || !state.profile?.nick) { rooms = []; ads = []; return paint() }
  try {
    const [r, a] = await Promise.all([rpc('chat_room_list'), rpc('bazar_list').catch(() => [])])
    rooms = r || []; ads = a || []
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
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bazar_comments' }, soon)
    .subscribe()
  poll = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 90000)
}

window.addEventListener('bbx:seen', paint)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon() })
