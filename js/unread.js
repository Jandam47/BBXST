// ════════════════════════════════════════════════════════════════
//  Odznak na záložce Komunikace: místnosti chatu s novou zprávou + otevřené ankety, kde jsem nehlasoval
//  + dotazy (hlavní admin: nevyřízené; ostatní: nová odpověď). „Přečteno“ = localStorage (chat.js,
//  feedback.js), přepočet po události bbx:seen, živě přes realtime (chat) a polling.
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, isLoggedIn } from './supa.js'

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {} } catch { return {} } }
let rooms = [], polls = 0, fb = { open: 0, last_reply: null }, channel = null, timer = null, poll = null

function paint() {
  const cs = read('bbxu_chat_seen')
  let fbSeen = ''
  try { fbSeen = localStorage.getItem('bbxu_fb_seen') || '' } catch {}
  const n = rooms.filter(r => r.last && r.last.id > (cs[r.id] || 0)).length
          + polls
          + (fb.open || 0) + (fb.last_reply && fb.last_reply > fbSeen ? 1 : 0)
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
