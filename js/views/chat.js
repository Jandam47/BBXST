// ════════════════════════════════════════════════════════════════
//  Chat – Zkušební chat, Info k turnaji (Obecné informace + místnost ke každému turnaji),
//  Komunitní chat (členové + hosté na čas). Živé zprávy přes Supabase Realtime, přístup hlídá RLS.
// ════════════════════════════════════════════════════════════════
import { sb, state, q, rpc, errMsg, isLoggedIn } from '../supa.js'
import { html, mount, on, toast, timeAgo, modal, busy, confirmBox, fmtTime, fmtDateTime } from '../ui.js'
import { reportModal } from '../report.js'
import { commTabs } from './komunikace.js'

const STATE_LABEL = { closed: 'Uzavřený', hidden: 'Schovaný' }

const SEEN_KEY = 'bbxu_chat_seen'
const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {} } catch { return {} } }
const markSeen = (room, id) => { try { const s = seen(); s[room] = Math.max(s[room] || 0, id); localStorage.setItem(SEEN_KEY, JSON.stringify(s)) } catch {} ; window.dispatchEvent(new Event('bbx:seen')) }

// přepínač částí Komunikace (Chat | Ankety | Dotazy | Nápověda)
const chatTabs = commTabs

export async function render(main, [roomId], ctx) {
  if (!roomId) return roomList(main, ctx)
  return roomView(main, roomId, ctx)
}

const OLD_SHOWN = 5
async function roomList(main, ctx) {
  const rooms = await rpc('chat_room_list')
  if (!ctx.isCurrent()) return
  const s = seen()
  const logged = isLoggedIn()
  const test = rooms.filter(r => r.kind === 'test')
  const info = rooms.filter(r => r.kind === 'info')
  const tours = rooms.filter(r => r.kind === 'info_t')
  const live = tours.filter(r => r.tournament_status !== 'finished').sort((a, b) => new Date(a.at) - new Date(b.at))
  const past = tours.filter(r => r.tournament_status === 'finished')   // od nejnovějšího (řadí DB)
  const comm = rooms.filter(r => r.kind === 'community')
  let showOld = false

  const row = (r) => {
    const m = r.last
    const unread = m && m.id > (s[r.id] || 0)
    return html`<a class="li chat-room ${r.kind}" href="#/chat/${r.id}">
      <span class="av">${r.icon}</span>
      <div class="grow" style="min-width:0">
        <div class="row between" style="gap:8px"><b class="ellipsis">${r.name}${r.state && r.state !== 'active' ? html` <span class="chat-state ${r.state}">${STATE_LABEL[r.state]}</span>` : ''}</b>${m ? html`<span class="small faint" style="flex:none">${timeAgo(m.created_at)}</span>` : ''}</div>
        <div class="small ${unread ? '' : 'muted'} ellipsis" style="${unread ? 'font-weight:600' : ''}">${m ? `${m.nick}: ${m.body}` : 'Zatím ticho'}</div>
        ${r.guest_until ? html`<div class="small chat-guest-tag">Host do ${fmtTime(r.guest_until)}</div>` : ''}
      </div>
      ${unread ? html`<span class="chat-dot" aria-label="Nové zprávy"></span>` : ''}
    </a>`
  }
  const draw = () => mount(main, html`
    ${chatTabs('chat')}
    ${logged ? html`<h2 class="chat-sec">Zkušební chat</h2>
      <div class="list">${test.map(row)}</div>` : ''}

    <h2 class="chat-sec">Info k turnaji</h2>
    <p class="small muted chat-sec-note">Čte každý, píšou organizátoři a admini.</p>
    <div class="list">${info.map(row)}${live.map(row)}</div>
    ${past.length ? html`<h3 class="chat-sub">Proběhlé turnaje</h3>
      <div class="list">${(showOld ? past : past.slice(0, OLD_SHOWN)).map(row)}</div>
      ${past.length > OLD_SHOWN && !showOld ? html`<button class="btn sm ghost" style="margin-top:8px" data-old>Zobrazit starší (${past.length - OLD_SHOWN})</button>` : ''}` : ''}

    ${logged ? html`<h2 class="chat-sec">Komunitní chat</h2>
      ${comm.length ? html`<div class="list">${comm.map(row)}</div>`
        : html`<div class="empty small">Nejsi v žádné komunitě. <a href="#/communities">Komunity</a></div>`}`
      : html`<div class="notice small" style="margin-top:18px">Zkušební a komunitní chat vidí jen přihlášení hráči s účtem. <a href="#/login">Přihlásit se</a></div>`}`)
  draw()
  on(main, 'click', '[data-old]', () => { showOld = true; draw() })
}

async function roomView(main, roomId, ctx) {
  let info
  try { info = await rpc('chat_room_info', { p_room: roomId }) }
  catch (e) {
    if (!ctx.isCurrent()) return
    return mount(main, html`${chatTabs('chat')}<div class="empty"><h2>Do téhle místnosti nemáš přístup</h2>
      <p class="muted">${isLoggedIn() ? 'Možná ti skončil přístup hosta.' : 'Přihlas se.'}</p><a class="btn" href="#/chat">Zpět na chat</a></div>`)
  }
  let msgs = (await q(sb.from('chat_messages').select('*').eq('room_id', roomId).order('id', { ascending: false }).limit(150))).reverse()
  if (!ctx.isCurrent()) return
  const room = info.room
  const canWrite = info.can_write
  const timers = []

  const note = room.state === 'hidden' ? 'Chat je schovaný – vidí ho jen organizátor akce a admini. Psát se sem nedá.'
    : room.state === 'closed' ? 'Chat je uzavřený – jde jen číst.'
    : room.kind === 'info' || room.kind === 'info_t'
    ? (canWrite ? 'Píšou sem organizátoři a admini – čte každý.' : 'Sem píšou jen organizátoři a admini.')
    : room.kind === 'community' ? (info.guest ? `Jsi tu jako host do ${fmtDateTime(info.guest.until)}.${info.guest.see_history ? '' : ' Vidíš zprávy od pozvání.'}` : 'Vidí jen členové komunity a pozvaní hosté.')
    : 'Volný chat pro všechny s účtem.'

  mount(main, html`
    <div class="chat">
      <div class="row" style="margin-bottom:6px;gap:8px">
        <a class="btn sm ghost" href="#/chat" aria-label="Zpět na chat">←</a>
        <h2 class="ellipsis" style="margin:0;flex:1;min-width:0">${room.icon} ${room.name}</h2>
        ${room.tournament_id ? html`<a class="btn sm ghost" href="#/t/${room.tournament_id}">Turnaj</a>` : ''}
        ${info.is_lead ? html`<button class="btn sm" data-guests>Hosté${info.guests?.length ? ` (${info.guests.length})` : ''}</button>` : ''}
      </div>
      <p class="small muted chat-note ${info.guest ? 'guest' : ''} ${room.state !== 'active' ? 'state' : ''}">${note}</p>
      ${info.can_manage ? html`<div class="chat-manage row wrap" role="group" aria-label="Správa chatu k turnaji">
        ${room.state !== 'active' ? html`<button class="btn sm" data-state="active">Znovu otevřít</button>` : ''}
        ${room.state !== 'closed' ? html`<button class="btn sm" data-state="closed">${room.state === 'hidden' ? 'Ukázat uzavřený' : 'Uzavřít'}</button>` : ''}
        ${room.state !== 'hidden' ? html`<button class="btn sm" data-state="hidden">Schovat</button>` : ''}
        <button class="btn sm danger" data-state="delete">Smazat</button></div>` : ''}
      <div class="chat-log" id="log" aria-live="polite"></div>
      ${canWrite ? html`
        <form class="chat-form" id="f-chat">
          <textarea class="input" name="body" maxlength="1000" placeholder="${room.kind === 'info_t' || room.kind === 'info' ? 'Napiš info pro hráče…' : 'Napiš zprávu…'}" rows="1" required aria-label="Zpráva"></textarea>
          <button class="btn primary">Poslat</button>
        </form>` : !isLoggedIn() ? html`<div class="notice small">Přihlas se, ať vidíš i ostatní chaty. <a href="#/login">Přihlásit se</a></div>` : ''}
    </div>`)
  const log = main.querySelector('#log')

  const msgHtml = (m) => {
    const own = m.user_id === state.user?.id
    return html`<div class="msg ${own ? 'own' : ''}" data-id="${m.id}">
      <a class="av" href="#/p/${m.user_id}">${m.avatar || '👤'}</a>
      <div class="bubble">
        <div class="who"><span>${m.nick}</span><time datetime="${m.created_at}">${timeAgo(m.created_at)}</time>
          ${own || info.can_moderate ? html`<button class="del" data-del="${m.id}" aria-label="Smazat zprávu">✕</button>` : ''}
          ${!own && state.profile?.nick ? html`<button class="del flag" data-report="${m.id}" aria-label="Nahlásit zprávu" title="Nahlásit">⚑</button>` : ''}</div>
        <div class="body">${m.body}</div>
      </div></div>`
  }
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120
  const draw = (stick = true) => {
    mount(log, msgs.length ? msgs.map(msgHtml) : html`<div class="empty">${canWrite ? 'Buď první, kdo sem napíše.' : 'Zatím tu nic není.'}</div>`)
    if (stick) log.scrollTop = log.scrollHeight
    if (msgs.length) markSeen(roomId, msgs[msgs.length - 1].id)
  }
  draw()

  // hostovi po vypršení přístup zmizí
  if (info.guest) {
    const ms = new Date(info.guest.until) - Date.now()
    timers.push(setTimeout(() => { toast('Přístup hosta do chatu skončil.', '', 6000); location.hash = '#/chat' }, Math.max(0, Math.min(ms, 2 ** 31 - 1))))
  }

  const ch = sb.channel('chat-' + roomId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, ({ new: m }) => {
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
      const m = await q(sb.from('chat_messages').insert({ room_id: roomId, body }).select('*').single())
      if (!msgs.some(x => x.id === m.id)) { msgs.push(m); draw() }
    } catch (err) { ta.value = body; toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-del]', async (e, b) => {
    const id = Number(b.dataset.del)
    try { await q(sb.from('chat_messages').delete().eq('id', id)); msgs = msgs.filter(x => x.id !== id); draw(false) }
    catch (err) { toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-guests]', () => guestsModal(roomId))
  on(main, 'click', '[data-report]', (e, b) => reportModal('chat_message', b.dataset.report))
  on(main, 'click', '[data-state]', async (e, b) => {
    const st = b.dataset.state
    if (st === 'delete' && !await confirmBox('Smazat chat k turnaji i se všemi zprávami? Nejde to vrátit.', { ok: 'Smazat', danger: true })) return
    busy(b, async () => {
      try {
        await rpc('chat_room_state', { p_room: roomId, p_state: st })
        toast({ active: 'Chat je znovu otevřený.', closed: 'Chat je uzavřený – jen ke čtení.', hidden: 'Chat je schovaný.', delete: 'Chat je smazaný.' }[st], 'ok')
        if (st === 'delete') location.hash = '#/chat'
        else window.dispatchEvent(new HashChangeEvent('hashchange'))   // překreslit přes router (čisté <main>)
      } catch (err) { toast(errMsg(err), 'err') }
    })
  })
  return () => { sb.removeChannel(ch); timers.forEach(clearTimeout) }
}

// ── hosté komunitního chatu (leader / zástupce) ─────────────────
const MINUTES = [[15, '15 min'], [30, '30 min'], [60, '1 hod'], [120, '2 hod'], [240, '4 hod'], [1440, '1 den']]
async function guestsModal(roomId) {
  let players = [], info = null, pick = null, mins = 60
  const { box, close } = modal(html`<div class="spinner" aria-label="Načítám"></div>`)
  const load = async () => {
    [info, players] = await Promise.all([rpc('chat_room_info', { p_room: roomId }), players.length ? players : rpc('players_list')])
  }
  const draw = () => {
    const guests = info.guests || []
    mount(box, html`
      <h2>Pozvat hosta</h2>
      <p class="small muted">Host chat uvidí jen na nastavenou dobu. Pak mu přístup sám skončí.</p>
      <form id="f-guest" class="stack" style="margin-top:10px">
        <label class="f"><span>Hráč</span>
          <input class="input" name="who" list="guest-dl" autocomplete="off" placeholder="Nick hráče" required value="${pick?.nick || ''}">
          <datalist id="guest-dl">${players.filter(p => p.nick).map(p => html`<option value="${p.nick}">`)}</datalist></label>
        <div class="f"><span>Na kolik minut má přístup</span>
          <div class="chips">${MINUTES.map(([m, l]) => html`<button type="button" class="chip ${mins === m ? 'on' : ''}" data-min="${m}">${l}</button>`)}</div>
          <input class="input" type="number" name="mins" min="1" max="10080" value="${mins}" inputmode="numeric" aria-label="Počet minut" style="margin-top:6px"></div>
        <label class="check"><input type="checkbox" name="hist"> <span>Vidí i staré zprávy (jinak jen zprávy od pozvání)</span></label>
        <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn ghost" data-close>Zavřít</button>
          <button class="btn primary">Pozvat</button></div>
      </form>
      ${guests.length ? html`<h3 style="margin-top:18px">Hosté teď</h3>
        <div class="list">${guests.map(g => html`<div class="li"><div class="grow"><b>${g.nick}</b>
          <div class="small muted">do ${fmtDateTime(g.until)}${g.see_history ? ' · vidí staré zprávy' : ''}</div></div>
          <button class="btn sm danger" data-unguest="${g.user_id}">Odebrat</button></div>`)}</div>` : ''}`)
  }
  try { await load() } catch (e) { close(); return toast(errMsg(e), 'err') }
  draw()
  on(box, 'click', '[data-min]', (e, b) => { mins = Number(b.dataset.min); const f = box.querySelector('#f-guest'); pick = { nick: f.who.value }; draw() })
  on(box, 'submit', '#f-guest', async (e, f) => {
    e.preventDefault()
    const nick = f.who.value.trim().toLowerCase()
    const p = players.find(x => (x.nick || '').toLowerCase() === nick)
    if (!p) return toast('Takového hráče neznám – vyber nick ze seznamu.', 'err')
    const m = Number(f.mins.value)
    busy(f.querySelector('button.primary'), async () => {
      try {
        await rpc('chat_guest_invite', { p_room: roomId, p_user: p.id, p_minutes: m, p_history: f.hist.checked })
        toast(`${p.nick} má přístup do chatu.`, 'ok'); pick = null; mins = 60
        await load(); draw()
      } catch (err) { toast(errMsg(err), 'err') }
    })
  })
  on(box, 'click', '[data-unguest]', async (e, b) => {
    busy(b, async () => { try { await rpc('chat_guest_remove', { p_room: roomId, p_user: b.dataset.unguest }); await load(); draw() } catch (err) { toast(errMsg(err), 'err') } })
  })
}

// po ukončení turnaje: nechat chat k turnaji aktivní, nebo ho uzavřít (jen ke čtení)?
export function askTournamentChat(tournamentId) {
  const room = 't-' + tournamentId
  modal(html`
    <h2>Chat k turnaji</h2>
    <p class="muted">Turnaj je ukončený. Má jeho chat v Info k turnaji zůstat aktivní, nebo ho uzavřít? Uzavřený jde jen číst.
      Později ho můžeš v chatu i schovat nebo smazat.</p>
    <div class="row" style="margin-top:16px;gap:8px"><button class="btn grow" data-chat="active">Nechat aktivní</button>
      <button class="btn primary grow" data-chat="closed">Uzavřít</button></div>`, {
    dismissable: false,
    onMount: (box, close) => on(box, 'click', '[data-chat]', async (e, b) => {
      busy(b, async () => {
        try {
          if (b.dataset.chat !== 'active') await rpc('chat_room_state', { p_room: room, p_state: b.dataset.chat })
          close(); toast(b.dataset.chat === 'active' ? 'Chat zůstává aktivní.' : 'Chat je uzavřený.', 'ok')
        } catch (err) { close(); toast(errMsg(err), 'err') }
      })
    }),
  })
}
