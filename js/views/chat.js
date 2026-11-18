// ════════════════════════════════════════════════════════════════
//  Chat – místnosti s živými zprávami (Supabase Realtime)
// ════════════════════════════════════════════════════════════════
import { sb, state, q, errMsg, isLoggedIn } from '../supa.js'
import { html, mount, on, toast, timeAgo } from '../ui.js'

const SEEN_KEY = 'bbxu_chat_seen'
const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {} } catch { return {} } }
const markSeen = (room, id) => { try { const s = seen(); s[room] = Math.max(s[room] || 0, id); localStorage.setItem(SEEN_KEY, JSON.stringify(s)) } catch {} }

export async function render(main, [roomId], ctx) {
  const rooms = await q(sb.from('chat_rooms').select('*').order('sort'))
  if (!ctx.isCurrent()) return
  if (!roomId) return roomList(main, rooms)
  const room = rooms.find(r => r.id === roomId)
  if (!room) { location.hash = '#/chat'; return }
  return roomView(main, room)
}

async function roomList(main, rooms) {
  // poslední zpráva v každé místnosti (jedním dotazem pro všechny)
  const latest = await Promise.all(rooms.map(r =>
    q(sb.from('chat_messages').select('id,nick,body,created_at').eq('room_id', r.id).order('id', { ascending: false }).limit(1)).then(x => x[0]).catch(() => null)))
  const s = seen()
  mount(main, html`
    <h1>Chat</h1>
    <div class="list" style="margin-top:16px">${rooms.map((r, i) => {
      const m = latest[i]
      const unread = m && m.id > (s[r.id] || 0)
      return html`<a class="li" href="#/chat/${r.id}">
        <span class="av">${r.icon}</span>
        <div class="grow" style="min-width:0">
          <div class="row between"><b>${r.name}</b>${m ? html`<span class="small faint">${timeAgo(m.created_at)}</span>` : ''}</div>
          <div class="small ${unread ? '' : 'muted'} ellipsis" style="${unread ? 'font-weight:600' : ''}">${m ? `${m.nick}: ${m.body}` : 'Zatím ticho'}</div>
        </div>
        ${unread ? html`<span style="width:10px;height:10px;border-radius:50%;background:var(--bolt);flex:none" aria-label="Nové zprávy"></span>` : ''}
      </a>`
    })}</div>
    ${!isLoggedIn() ? html`<p class="hint" style="margin-top:14px">Číst může každý, psát jen hráči s účtem. <a href="#/login">Přihlásit</a></p>` : ''}`)
}

async function roomView(main, room) {
  let msgs = (await q(sb.from('chat_messages').select('*').eq('room_id', room.id).order('id', { ascending: false }).limit(150))).reverse()
  const canWrite = isLoggedIn() && !!state.profile?.nick
  const isAdmin = state.level >= 3

  mount(main, html`
    <div class="chat">
      <div class="row" style="margin-bottom:8px"><a class="btn sm ghost" href="#/chat">←</a><h2 style="margin:0">${room.icon} ${room.name}</h2></div>
      <div class="chat-log" id="log" aria-live="polite"></div>
      ${canWrite ? html`
        <form class="chat-form" id="f-chat">
          <textarea class="input" name="body" maxlength="1000" placeholder="Napiš zprávu…" rows="1" required aria-label="Zpráva"></textarea>
          <button class="btn primary">Poslat</button>
        </form>` : html`<div class="notice small">Psát můžou jen přihlášení hráči. <a href="#/login">Přihlásit se</a></div>`}
    </div>`)
  const log = main.querySelector('#log')

  const msgHtml = (m) => {
    const own = m.user_id === state.user?.id
    return html`<div class="msg ${own ? 'own' : ''}" data-id="${m.id}">
      <a class="av" href="#/p/${m.user_id}">${m.avatar || '👤'}</a>
      <div class="bubble">
        <div class="who"><span>${m.nick}</span><time datetime="${m.created_at}">${timeAgo(m.created_at)}</time>
          ${own || isAdmin ? html`<button class="del" data-del="${m.id}" aria-label="Smazat zprávu">✕</button>` : ''}</div>
        <div class="body">${m.body}</div>
      </div></div>`
  }
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120
  const draw = (stick = true) => {
    mount(log, msgs.length ? msgs.map(msgHtml) : html`<div class="empty">Buď první, kdo sem napíše.</div>`)
    if (stick) log.scrollTop = log.scrollHeight
    if (msgs.length) markSeen(room.id, msgs[msgs.length - 1].id)
  }
  draw()

  const ch = sb.channel('chat-' + room.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${room.id}` }, ({ new: m }) => {
      if (msgs.some(x => x.id === m.id)) return
      const stick = nearBottom()
      msgs.push(m); draw(stick)
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, ({ old }) => {
      if (old?.id && msgs.some(x => x.id === old.id)) { msgs = msgs.filter(x => x.id !== old.id); draw(false) }
    })
    .subscribe()

  on(main, 'keydown', '#f-chat textarea', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit() }
  })
  on(main, 'submit', '#f-chat', async (e, f) => {
    e.preventDefault()
    const ta = f.body, body = ta.value.trim()
    if (!body) return
    ta.value = ''
    try {
      const m = await q(sb.from('chat_messages').insert({ room_id: room.id, body }).select('*').single())
      if (!msgs.some(x => x.id === m.id)) { msgs.push(m); draw() }
    } catch (err) { ta.value = body; toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-del]', async (e, b) => {
    const id = Number(b.dataset.del)
    try { await q(sb.from('chat_messages').delete().eq('id', id)); msgs = msgs.filter(x => x.id !== id); draw(false) }
    catch (err) { toast(errMsg(err), 'err') }
  })
  return () => sb.removeChannel(ch)
}
