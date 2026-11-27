// ════════════════════════════════════════════════════════════════
//  ŽIVĚ – přenos z arén pro diváky doma (#/t/<id>/live)
//  Arény: kdo hraje, skóre, deck obou hráčů (zahrané v sadě šedě + body / −, zbylé svítí),
//  endy každé strany, historie bodů. Sledovaní hráči (localStorage, s účtem i push – 27),
//  živý feed, poslední výsledky, pořadí, pavouk (skrýt dohrané), statistiky, režie (výběr arény).
//  Bez přihlášení; decky přes live_decks (až po startu turnaje).
//  Video z arény (46): kameraman (judge+ nebo přidělená funkce) vysílá z aplikace Twitch v telefonu
//  a v Živě přes 🎥 Vysílat přiřadí kanál k aréně (live_video_start). Divák vidí přehrávač Twitche /
//  YouTube nahoře v kartě arény. Přehrávač (iframe) se při přesunu v DOM znovu načte, proto žije
//  ve vrstvě mimo <main> (.lv-vlayer) a jen se umisťuje nad místo v kartě (.lv-vbox). Polling 10 s.
// ════════════════════════════════════════════════════════════════
import { html, raw, mount, on, modal, fmtLeft, toast, busy, confirmBox } from '../ui.js'
import { rpc, state, isLoggedIn, errMsg } from '../supa.js'
import { enablePush, pushSupport } from '../push.js'
import { load, queueOf, liveChannel, standingsFor, paused, ptHist, liveBattles, ptLabel, bracketHtml } from './tournament.js'
import { matchLabel, phaseName } from '../core.js'
import { icon } from '../icons.js'

const FIN = { xtreme: ['X', 'Xtreme'], burst: ['B', 'Burst'], over: ['O', 'Over'], spin: ['S', 'Spin'] }
const finOf = (b) => b.finish || (b.pts === 3 ? 'xtreme' : b.pts === 1 ? 'spin' : null)
const followKey = (id) => `bbxu_follow:${id}`
const readFollow = (id) => { try { return new Set(JSON.parse(localStorage.getItem(followKey(id))) || []) } catch { return new Set() } }
const saveFollow = (id, set) => { try { localStorage.setItem(followKey(id), JSON.stringify([...set])) } catch {} }
const pref = (k, def) => { try { const v = localStorage.getItem('bbxu_live_' + k); return v === null ? def : JSON.parse(v) } catch { return def } }
const setPref = (k, v) => { try { localStorage.setItem('bbxu_live_' + k, JSON.stringify(v)) } catch {} }
const hhmm = (d = new Date()) => d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })

// souboje hry, která je teď na řadě (rozehraná z live_state, jinak poslední dohraná)
function curGame(d, m) {
  const live = liveBattles(m)
  if (live) return { battles: live, live: true }
  const games = d.points?.get(m.id) || []
  return { battles: games[games.length - 1] || [], live: false }
}
// aktuální sada = poslední (až 3 souboje); po dohrané sadě zůstane vidět, dokud nepadne další souboj
function curSet(battles) {
  const n = battles.length
  const start = n === 0 ? 0 : n - ((n - 1) % 3) - 1
  return { set: battles.slice(start), no: Math.floor(start / 3) + 1 }
}

export async function render(main, [id]) {
  document.body.classList.add('tv')
  let d = await load(id)
  let follow = readFollow(id)
  let decks = new Map()             // reg → [bey1, bey2, bey3] (live_decks, až po startu)
  const loadDecks = async () => {
    if (decks.size || d.t.status === 'registration') return
    try { decks = new Map((await rpc('live_decks', { p_tournament: id })).map(x => [x.reg, x.beys])) } catch {}
  }
  await loadDecks()
  const pushKey = 'follow_push:' + id
  let pushOn = pref(pushKey, false) && isLoggedIn() && !state.isAnon
  if (pushOn) {                     // sledované ze serveru (i z jiného zařízení) se přidají k místním
    try { for (const r of await rpc('live_follow_list', { p_tournament: id })) follow.add(r); saveFollow(id, follow) } catch {}
  }
  let dir = pref('dir:' + id, null)              // režie: null = vypnuto, 'auto' nebo číslo arény
  let dirShown = null, dirAt = 0
  let hideDone = pref('hide_done', true)
  let statsOpen = pref('stats_open', false)
  // Dění: arény, které se v seznamu (a ve vyskakovacích hláškách) neukazují; sledovaní hráči vždy
  let feedOff = new Set(pref('feed_off:' + id, []))
  const inFeed = (e) => e.fol || !e.arena || !feedOff.has(e.arena)
  const feed = []                  // živé dění od otevření stránky
  let prev = null                  // minulý stav kvůli rozpoznání nových bodů a výsledků
  const nick = (reg) => d.pmap.get(reg)?.nick || '?'

  // ── video z arén (46) ──
  let streams = new Map()             // aréna → { provider, channel, nick, mine, can_stop }
  let videoOn = pref('video', true)   // divák si může video vypnout (mobilní data)
  let canCam = false                  // smím vysílat (kameraman)
  const players = new Map()           // aréna → { key, el } – iframe ve vrstvě nad kartou
  const layer = document.createElement('div')
  layer.className = 'lv-vlayer'
  document.body.append(layer)
  const skey = (s) => s.provider + ':' + s.channel
  const streamsKey = () => [...streams.values()].map(s => s.arena + '=' + skey(s)).join(',')
  const myCast = () => [...streams.values()].find(s => s.mine)
  const loadStreams = async () => {
    try { streams = new Map((await rpc('live_video_list', { p_tournament: id })).map(s => [s.arena, s])) } catch {}
  }
  if (isLoggedIn() && !state.isAnon) rpc('live_video_me').then(v => { canCam = !!v; draw() }).catch(() => {})
  await loadStreams()

  // ── rozdíl proti minulému stavu → události do feedu a vyskakovací hlášky ──
  const snapshot = () => new Map(d.matches.map(m => [m.id, {
    status: m.status, n: liveBattles(m)?.length ?? 0, games: m.p1_wins + m.p2_wins, arena: m.arena }]))
  function diff() {
    const now = snapshot()
    if (!prev) { prev = now; return }
    const events = []
    for (const m of d.matches) {
      const a = prev.get(m.id), b = now.get(m.id)
      if (!a || !b || !m.p1_reg || !m.p2_reg) continue
      const fol = follow.has(m.p1_reg) || follow.has(m.p2_reg)
      if (b.status === 'done' && a.status !== 'done') {
        const w = m.winner_reg, l = w === m.p1_reg ? m.p2_reg : m.p1_reg
        const sc = m.best_of > 1 ? `${Math.max(m.p1_wins, m.p2_wins)}:${Math.min(m.p1_wins, m.p2_wins)}` : `${Math.max(m.p1_score, m.p2_score)}:${Math.min(m.p1_score, m.p2_score)}`
        if (w) events.push({ kind: 'result', fol, big: fol, text: html`<b>${nick(w)}</b> porazil ${nick(l)} <span class="num">${sc}</span>`, arena: a.arena })
        continue
      }
      if (b.status === 'live' && a.status !== 'live') {
        events.push({ kind: 'start', fol, big: fol, text: html`Začíná <b class="p1c">${nick(m.p1_reg)}</b> vs <b class="p2c">${nick(m.p2_reg)}</b>`, arena: m.arena })
      }
      // nové souboje v rozehrané hře (stejná hra, víc soubojů)
      if (b.games === a.games && b.n > a.n) {
        const bat = liveBattles(m).slice(a.n)
        for (const x of bat) {
          if (!x.slot) { events.push({ kind: 'draw', fol, text: html`Remíza · ${nick(m.p1_reg)} vs ${nick(m.p2_reg)}`, arena: m.arena }); continue }
          const who = x.slot === 1 ? m.p1_reg : m.p2_reg, f = finOf(x)
          const bey = x[`p${x.slot}_bey`]
          events.push({ kind: 'point', fin: f, fol, big: f === 'xtreme' || (fol && x.pts >= 2),
            text: html`<b class="${x.slot === 1 ? 'p1c' : 'p2c'}">${nick(who)}</b> <span class="lv-pt lv-${f || 'pt'}">${ptLabel(x)}</span>${f && f !== 'spin' ? html` ${FIN[f][1]} finish` : ''}${bey ? html` <span class="faint">· ${bey}</span>` : ''}`, arena: m.arena })
        }
      }
    }
    // sledovaný hráč dostal zápas na aréně
    for (const reg of follow) {
      const nxt = d.matches.find(m => m.status === 'pending' && (m.p1_reg === reg || m.p2_reg === reg) && m.arena && m.p1_reg && m.p2_reg)
      const was = nxt && prev.get(nxt.id)
      if (nxt && (!was || !was.arena)) events.push({ kind: 'call', fol: true, big: true, text: html`<b>${nick(reg)}</b> hraje na aréně ${nxt.arena} proti ${nick(nxt.p1_reg === reg ? nxt.p2_reg : nxt.p1_reg)}`, arena: nxt.arena })
    }
    prev = now
    for (const e of events) { e.at = hhmm(); feed.unshift(e) }
    feed.splice(60)
    const big = events.filter(e => e.big && inFeed(e)).slice(-1)[0]
    if (big) flash(big)
  }

  let flashT = null
  function flash(e) {
    let el = document.querySelector('.lv-flash')
    if (!el) { el = document.createElement('div'); el.className = 'lv-flash'; el.setAttribute('role', 'status'); document.body.append(el) }
    el.className = `lv-flash on k-${e.kind} ${e.fin ? 'f-' + e.fin : ''}`
    mount(el, html`${e.arena ? html`<span class="lv-fa">Aréna ${e.arena}</span>` : ''}<span>${e.text}</span>`)
    clearTimeout(flashT); flashT = setTimeout(() => el.classList.remove('on'), 4500)
  }

  // ── jedna strana arény: zahrané beye aktuální sady v řádcích (obrys zelený = výhra, červený = prohra,
  //    šedý = remíza), pod nimi „pool“ = beye z decku, které v sadě ještě nehrály (pořadí se neurčuje dopředu)
  function sideBeys(set, s, reg) {
    const deck = (decks.get(reg) || []).filter(Boolean)
    const played = set.map(b => b[`p${s}_bey`])
    const rows = set.map(b => {
      const won = b.slot === s, draw = !b.slot
      const res = draw ? html`<span class="lv-r d">R</span>` : won ? html`<span class="lv-r w">${ptLabel(b)}</span>` : html`<span class="lv-r l">−</span>`
      return html`<li class="${draw ? 'd' : won ? 'w' : 'l'}"><span class="lv-bn">${b[`p${s}_bey`] || '—'}</span>${res}</li>`
    })
    const pool = deck.filter(x => !played.includes(x))
    return html`${rows.length ? html`<ol class="lv-beys">${rows}</ol>` : ''}
      ${pool.length ? html`<div class="lv-pool"><span class="lv-pool-h">pool</span><div class="lv-pool-b">${pool.map(x => html`<span>${x}</span>`)}</div></div>` : ''}`
  }
  // endy strany v aktuální hře
  function sideFin(battles, s) {
    const c = { xtreme: 0, burst: 0, over: 0, spin: 0 }
    for (const b of battles) if (b.slot === s) { const f = finOf(b); if (f) c[f]++ }
    const parts = Object.entries(c).filter(([, n]) => n)
    return parts.length ? html`<div class="lv-fin">${parts.map(([f, n]) => html`<span class="lv-${f}" title="${FIN[f][1]} finish">${FIN[f][0]}<b>${n}</b></span>`)}</div>` : ''
  }

  function arenaCard(a, qa) {
    const [cur, ...rest] = qa
    const fol = cur && (follow.has(cur.p1_reg) || follow.has(cur.p2_reg))
    const vs = streams.get(a)
    const slot = !vs ? '' : html`<div class="lv-vslot" data-vslot="${a}">
      ${videoOn ? html`<div class="lv-vbox"></div>` : html`<button type="button" class="lv-voff" data-video>📹 Aréna se vysílá · zapnout video</button>`}
      <div class="lv-vcap"><span class="lv-vlive"><i aria-hidden="true"></i>LIVE</span>
        <span class="grow">${vs.provider === 'youtube' ? 'YouTube' : 'Twitch'} · 🎥 ${vs.nick}</span>
        <a href="${streamUrl(vs)}" target="_blank" rel="noopener">Otevřít ↗</a>
        ${vs.can_stop ? html`<button type="button" class="lv-vstop" data-vstop="${a}" aria-label="Ukončit vysílání arény ${a}" title="Ukončit vysílání">✕</button>` : ''}</div></div>`
    if (!cur) return html`<section class="lv-arena idle ${vs ? 'has-video' : ''}" data-arena="${a}"><div class="lv-ah"><span class="lv-ano">${a}</span><span class="faint">Volná aréna</span></div>${slot}</section>`
    const live = cur.status === 'live'
    const g = live ? curGame(d, cur) : { battles: [] }
    const { set, no } = curSet(g.battles)
    const s1 = cur.live_p1 ?? 0, s2 = cur.live_p2 ?? 0
    return html`<section class="lv-arena ${live ? 'live' : 'wait'} ${fol ? 'fol' : ''} ${vs ? 'has-video' : ''}" data-arena="${a}">
      <div class="lv-ah"><span class="lv-ano">${a}</span>
        <span class="lv-lab">${matchLabel(cur, d.t.top_cut, d.t.format)}${cur.best_of > 1 ? ` · BO${cur.best_of} · hra ${Math.min(cur.p1_wins + cur.p2_wins + 1, cur.best_of)} (${cur.p1_wins}:${cur.p2_wins})` : ''}</span>
        ${live ? html`<span class="lv-on">● hraje se</span>` : html`<span class="lv-next">na řadě</span>`}</div>
      ${slot}
      <div class="lv-vs">
        <div class="lv-p l"><span class="lv-nick p1c">${follow.has(cur.p1_reg) ? html`<i class="lv-star">★ </i>` : ''}${nick(cur.p1_reg)}</span>${live ? sideFin(g.battles, 1) : ''}</div>
        <div class="lv-sc num">${live ? html`<b>${s1}</b><i>:</i><b>${s2}</b>` : html`<span class="faint">vs</span>`}</div>
        <div class="lv-p r"><span class="lv-nick p2c">${nick(cur.p2_reg)}${follow.has(cur.p2_reg) ? html`<i class="lv-star"> ★</i>` : ''}</span>${live ? sideFin(g.battles, 2) : ''}</div>
      </div>
      ${live || decks.size ? html`<div class="lv-set"><div>${sideBeys(set, 1, cur.p1_reg)}</div><span class="lv-setno">${!live ? 'decky' : g.battles.length ? `sada ${no}` : 'první sada'}</span><div>${sideBeys(set, 2, cur.p2_reg)}</div></div>` : ''}
      ${live ? ptHist(g.battles) : ''}
      ${rest.length ? html`<div class="lv-queue">Na řadě: ${rest.slice(0, 2).map((m, i) => html`${i ? ' · ' : ''}<span>${nick(m.p1_reg)} vs ${nick(m.p2_reg)}</span>`)}${rest.length > 2 ? ` · +${rest.length - 2}` : ''}</div>` : ''}
    </section>`
  }

  // ── sledovaný hráč ──
  function followCard(reg, st) {
    const p = d.pmap.get(reg); if (!p) return ''
    const s = st.find(x => x.id === reg)
    const mine = d.matches.filter(m => m.p1_reg === reg || m.p2_reg === reg)
    const now = mine.find(m => m.status === 'live')
    const next = !now && mine.filter(m => m.status === 'pending' && m.p1_reg && m.p2_reg).sort((a, b) => a.wave - b.wave)[0]
    const opp = (m) => nick(m.p1_reg === reg ? m.p2_reg : m.p1_reg)
    let status
    if (p.status === 'dropped') status = html`<span class="faint">Odstoupil</span>`
    else if (d.t.status === 'finished') status = html`${p.final_place ? html`<b>${p.final_place}. místo</b>` : 'Turnaj skončil'}`
    else if (now) {
      const me1 = now.p1_reg === reg
      status = html`<span class="lv-on">● Hraje</span> · aréna ${now.arena} · vs ${opp(now)}${now.live_p1 != null ? html` · <b class="num">${me1 ? now.live_p1 : now.live_p2}:${me1 ? now.live_p2 : now.live_p1}</b>` : ''}`
    } else if (next) {
      const pos = next.arena ? queueOf(d, next.arena).findIndex(m => m.id === next.id) + 1 : 0
      status = html`Na řadě${next.arena ? html` · aréna ${next.arena}${pos > 1 ? ` (${pos}. v pořadí)` : ''}` : ''} · vs ${opp(next)}`
    } else status = html`<span class="faint">Čeká na další kolo</span>`
    const done = mine.filter(m => m.status === 'done' && !m.is_bye && m.p1_reg && m.p2_reg)
      .sort((a, b) => new Date(b.finished_at || 0) - new Date(a.finished_at || 0)).slice(0, 4)
    return html`<div class="lv-fc ${now ? 'live' : ''}" data-goto="${now?.arena || next?.arena || ''}">
      <div class="lv-fh"><b>★ ${p.nick}</b>${s && d.t.status !== 'finished' ? html`<span class="faint num">#${s.rank} · ${s.wins}–${s.losses}</span>` : ''}</div>
      <div class="lv-fs">${status}</div>
      ${done.length ? html`<div class="lv-fr">${done.map(m => {
        const won = m.winner_reg === reg, me1 = m.p1_reg === reg
        const sc = m.best_of > 1 ? `${me1 ? m.p1_wins : m.p2_wins}:${me1 ? m.p2_wins : m.p1_wins}` : `${me1 ? m.p1_score : m.p2_score}:${me1 ? m.p2_score : m.p1_score}`
        return html`<span class="${won ? 'w' : 'l'}" title="vs ${opp(m)}">${won ? 'V' : 'P'} <span class="num">${sc}</span> <small>${opp(m)}</small></span>`
      })}</div>` : ''}
    </div>`
  }

  // ── statistiky turnaje (dohrané hry + rozehrané) ──
  function stats() {
    const fin = { xtreme: 0, burst: 0, over: 0, spin: 0 }
    const beys = new Map(), players = new Map()
    let n = 0, draws = 0
    const add = (map, k, f) => { if (!k) return; const v = map.get(k) || { name: k, w: 0, l: 0, pts: 0, x: 0 }; f(v); map.set(k, v) }
    for (const m of d.matches) {
      if (!m.p1_reg || !m.p2_reg) continue
      const games = [...(d.points?.get(m.id) || [])]
      const lv = liveBattles(m); if (lv) games.push(lv)
      for (const g of games) for (const b of g) {
        n++
        if (!b.slot) { draws++; continue }
        const f = finOf(b); if (f) fin[f]++
        const wb = b[`p${b.slot}_bey`], lb = b[`p${3 - b.slot}_bey`]
        add(beys, wb, v => { v.w++; v.pts += b.pts })
        add(beys, lb, v => { v.l++ })
        const wr = b.slot === 1 ? m.p1_reg : m.p2_reg
        add(players, nick(wr), v => { v.pts += b.pts; if (f === 'xtreme') v.x++ })
      }
    }
    const total = Object.values(fin).reduce((a, b) => a + b, 0)
    const topBeys = [...beys.values()].filter(v => v.w + v.l >= 2).sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l) || b.w - a.w).slice(0, 5)
    const topX = [...players.values()].filter(v => v.x).sort((a, b) => b.x - a.x).slice(0, 3)
    const topPts = [...players.values()].sort((a, b) => b.pts - a.pts).slice(0, 3)
    if (!n) return html`<p class="faint small">Statistiky se ukážou po prvních soubojích.</p>`
    return html`<div class="lv-stats">
      <div class="lv-sn"><b class="num">${n}</b> soubojů${draws ? html` · <span class="num">${draws}</span> remíz` : ''}</div>
      <div class="lv-bars">${Object.entries(fin).map(([f, c]) => html`<div class="lv-bar lv-${f}"><span>${FIN[f][1]}</span>
        <i style="--p:${total ? Math.round(c / total * 100) : 0}%"></i><b class="num">${c}</b></div>`)}</div>
      ${topBeys.length ? html`<h4>Nejúspěšnější beye</h4><ol class="lv-top">${topBeys.map(v => html`<li><span class="grow">${v.name}</span><span class="num">${v.w}–${v.l}</span><b class="num">${Math.round(v.w / (v.w + v.l) * 100)} %</b></li>`)}</ol>` : ''}
      ${topX.length ? html`<h4>Nejvíc Xtreme</h4><ol class="lv-top">${topX.map(v => html`<li><span class="grow">${v.name}</span><b class="num">${v.x}×</b></li>`)}</ol>` : ''}
      ${topPts.length ? html`<h4>Nejvíc bodů</h4><ol class="lv-top">${topPts.map(v => html`<li><span class="grow">${v.name}</span><b class="num">${v.pts}</b></li>`)}</ol>` : ''}
    </div>`
  }

  // ── režie: jedna aréna přes celou plochu; auto = kde se naposledy něco stalo ──
  function directorArena(arenas) {
    const live = arenas.filter(x => x.q[0]?.status === 'live').map(x => x.a)
    if (dir !== 'auto') return arenas.some(x => x.a === dir) ? dir : arenas[0]?.a
    const hot = feed.find(e => e.arena && live.includes(e.arena))?.arena
    const now = Date.now()
    if (dirShown && live.includes(dirShown) && (hot === dirShown || now - dirAt < 12000)) return dirShown
    const pick = hot || (live.includes(dirShown) ? dirShown : live[0]) || arenas[0]?.a
    if (pick !== dirShown) { dirShown = pick; dirAt = now }
    return pick
  }

  const draw = () => {
    const { t } = d
    const st = t.kind === 'tournament' && t.status !== 'registration' ? standingsFor(d) : []
    const arenas = Array.from({ length: t.arena_count }, (_, i) => i + 1).map(a => ({ a, q: queueOf(d, a) }))
      .filter(x => t.status !== 'topcut' || x.q.length)
    const running = t.status === 'swiss' || t.status === 'topcut'
    const phase = t.status === 'swiss' ? `${phaseName(t)} · kolo ${t.current_round}/${t.swiss_rounds}` : t.status === 'topcut' ? (t.top_cut === 2 ? 'Finále' : `Top ${t.top_cut}`) : t.status === 'finished' ? 'Konec turnaje' : 'Registrace'
    const results = d.matches.filter(m => m.status === 'done' && !m.is_bye && m.p1_reg && m.p2_reg && m.winner_reg)
      .sort((a, b) => new Date(b.finished_at || 0) - new Date(a.finished_at || 0)).slice(0, 6)
    const anyLive = arenas.some(x => x.q.length)
    const fol = [...follow].filter(r => d.pmap.has(r))
    const arenaNos = Array.from({ length: t.arena_count }, (_, i) => i + 1)
    const shownFeed = feed.filter(inFeed)
    const hasBracket = d.matches.some(m => m.stage !== 'swiss')
    const showDir = dir != null && running && anyLive
    const dirA = showDir ? directorArena(arenas) : null
    const shown = showDir ? arenas.filter(x => x.a === dirA) : arenas
    const cols = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : 3
    const mini = (x) => {
      const m = x.q[0]
      return html`<button type="button" class="lv-mini ${x.a === dirA ? 'on' : ''} ${m?.status === 'live' ? 'live' : ''}" data-dir="${x.a}" aria-pressed="${dir === x.a}">
        <b>${x.a}</b>${m ? html`<span>${nick(m.p1_reg)}</span><span class="num">${m.status === 'live' && m.live_p1 != null ? `${m.live_p1}:${m.live_p2}` : 'vs'}</span><span>${nick(m.p2_reg)}</span>` : html`<span class="faint">volno</span>`}</button>`
    }

    main.classList.toggle('lv-dirmode', showDir)
    mount(main, html`
      <div class="lv">
        <header class="lv-head">
          <div><h1>${t.name}</h1><div class="lv-sub">${running ? html`<span class="lv-dot" aria-hidden="true"></span><b>ŽIVĚ</b> · ` : ''}${phase} · <span data-clock>${hhmm()}</span></div></div>
          <div class="row wrap" style="gap:8px">
            ${running && canCam ? html`<button class="btn sm ${myCast() ? 'primary' : ''}" data-cast>🎥 ${myCast() ? `Vysíláš arénu ${myCast().arena}` : 'Vysílat'}</button>` : ''}
            ${running && streams.size ? html`<button class="btn sm ${videoOn ? '' : 'ghost'}" data-video aria-pressed="${videoOn}">${videoOn ? '📹 Video zap' : '📹 Video vyp'}</button>` : ''}
            ${running && anyLive ? html`<button class="btn sm ${dir != null ? 'primary' : ''}" data-dirmode aria-pressed="${dir != null}">🎬 Režie${dir != null ? ': zap' : ''}</button>` : ''}
            <button class="btn sm" data-follow>★ Sledovat hráče${fol.length ? ` (${fol.length})` : ''}</button>
            <a class="btn sm ghost btn-ico" href="#/t/${t.id}/tv">${raw(icon('tv'))}TV rozpis</a></div>
        </header>
        ${paused(t) ? html`<div class="tv-pause" data-countdown-box><b>PAUZA</b><span class="num" data-countdown="${t.pause_until}">${fmtLeft(t.pause_until)}</span></div>` : ''}
        ${showDir ? html`<nav class="lv-dirbar" aria-label="Výběr arény">
          <button type="button" class="lv-mini auto ${dir === 'auto' ? 'on' : ''}" data-dir="auto" aria-pressed="${dir === 'auto'}"><b>AUTO</b><span>kde se něco děje</span></button>
          ${arenas.map(mini)}</nav>` : ''}
        <div class="lv-body">
          <div class="lv-main">
            ${t.status === 'registration' ? html`<div class="card lv-empty"><h2>Turnaj ještě nezačal</h2><p class="muted">Přihlášeno ${d.players.filter(p => p.status === 'active').length} hráčů. Jakmile začne, uvidíš tu arény živě.</p></div>`
              : t.status === 'finished' ? html`<div class="card lv-empty"><h2>Konečné pořadí</h2><ol class="lv-podium">${d.players.filter(p => p.final_place).sort((a, b) => a.final_place - b.final_place).slice(0, 8)
                  .map(p => html`<li class="p${p.final_place}"><span class="num">${p.final_place}.</span> ${p.nick}</li>`)}</ol></div>`
              : anyLive ? html`<div class="lv-arenas ${showDir ? 'lv-dir' : ''}" style="--cols:${cols}">${shown.map(x => arenaCard(x.a, x.q))}</div>`
              : html`<div class="card lv-empty"><h2>${t.status === 'topcut' ? 'Čekáme na další zápasy pavouka' : 'Čekáme na další kolo'}</h2><p class="muted">Rozehrané zápasy tu hned uvidíš.</p></div>`}
            ${hasBracket && !showDir ? html`<section class="lv-bracket">
              <div class="row between"><h3>${t.top_cut === 2 ? 'Finále' : `Pavouk – top ${t.top_cut}`}</h3>
                <label class="lv-tog"><input type="checkbox" data-hide-done ${hideDone ? 'checked' : ''}> Skrýt odehrané</label></div>
              ${bracketHtml(d, { hideDone, follow })}</section>` : ''}
          </div>
          <aside class="lv-side">
            <section class="lv-folsec">
              <div class="row between"><h3>Sledovaní</h3>
                ${fol.length ? html`<button type="button" class="btn sm ${pushOn ? 'primary' : 'ghost'}" data-push aria-pressed="${pushOn}">${pushOn ? '🔔 Upozornění zap' : '🔕 Upozornit na telefon'}</button>` : ''}</div>
              ${fol.length ? fol.map(r => followCard(r, st))
                : html`<p class="lv-hint">Klepni na <b>★ Sledovat hráče</b> a uvidíš, kde a jak hrají tví hráči. Vyskočí ti, až půjdou na arénu.</p>`}
            </section>
            ${running ? html`<section class="lv-feedsec"><h3>Dění</h3>
              ${arenaNos.length > 1 ? html`<div class="lv-afilter" role="group" aria-label="Arény v Dění">${arenaNos.map(a => html`<label class="lv-achk ${feedOff.has(a) ? '' : 'on'}"><input type="checkbox" data-feed-arena="${a}" ${feedOff.has(a) ? '' : 'checked'}>A${a}</label>`)}</div>` : ''}
              ${shownFeed.length ? html`<ul class="lv-feed">${shownFeed.slice(0, 8).map(e => html`<li class="k-${e.kind} ${e.fol ? 'fol' : ''}"><span class="faint num">${e.at}</span>${e.arena ? html`<span class="lv-fa">A${e.arena}</span>` : ''}<span>${e.text}</span></li>`)}</ul>`
              : html`<p class="faint small">${feed.length ? 'Z vybraných arén zatím nic.' : 'Tady se objeví každý bod a výsledek, jak padají.'}</p>`}</section>` : ''}
            ${t.status !== 'registration' ? html`<section class="lv-statsec"><details ${statsOpen ? 'open' : ''} data-stats>
              <summary><h3>Statistiky turnaje</h3></summary>${statsOpen ? stats() : ''}</details></section>` : ''}
            ${results.length ? html`<section><h3>Poslední výsledky</h3><ul class="lv-res">${results.map(m => {
              const w1 = m.winner_reg === m.p1_reg
              return html`<li><span class="${w1 ? 'w' : ''}">${nick(m.p1_reg)}</span><b class="num">${m.best_of > 1 ? `${m.p1_wins}:${m.p2_wins}` : `${m.p1_score}:${m.p2_score}`}</b><span class="${w1 ? '' : 'w'}">${nick(m.p2_reg)}</span></li>`
            })}</ul></section>` : ''}
            ${st.length && t.status === 'swiss' ? html`<section><h3>Pořadí</h3><ol class="lv-st">${st.slice(0, 8).map(s => html`<li class="${follow.has(s.id) ? 'fol' : ''}"><span class="num">${s.rank}.</span><span class="grow">${s.nick}</span><span class="num faint">${s.wins}–${s.losses}</span><b class="num">${s.main}</b></li>`)}</ol></section>` : ''}
          </aside>
        </div>
        <a class="btn sm tv-exit" href="#/t/${t.id}">Zavřít</a>
      </div>`)
    syncVideos()
  }

  // ── divák: přehrávač Twitche / YouTube ve vrstvě nad místem v kartě (iframe se při přesunu v DOM načte znovu) ──
  function streamUrl(s) {
    return s.provider === 'youtube' ? `https://www.youtube.com/watch?v=${encodeURIComponent(s.channel)}` : `https://www.twitch.tv/${encodeURIComponent(s.channel)}`
  }
  function embedSrc(s) {
    if (s.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(s.channel)}?autoplay=1&mute=1&playsinline=1&rel=0`
    return `https://player.twitch.tv/?channel=${encodeURIComponent(s.channel)}&parent=${encodeURIComponent(location.hostname)}&muted=true&autoplay=true`
  }
  function syncVideos() {
    const want = new Set()
    if (videoOn) for (const box of main.querySelectorAll('[data-vslot] .lv-vbox')) {
      const a = Number(box.closest('[data-vslot]').dataset.vslot), s = streams.get(a)
      if (!s) continue
      want.add(a)
      let p = players.get(a)
      if (p && p.key !== skey(s)) { p.el.remove(); p = null }
      if (!p) {
        const el = document.createElement('div')
        el.className = 'lv-vfloat'
        const f = document.createElement('iframe')
        f.src = embedSrc(s)
        f.title = `Vysílání arény ${a}`
        f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'
        f.allowFullscreen = true
        el.append(f); layer.append(el)
        p = { key: skey(s), el }
        players.set(a, p)
      }
      const r = box.getBoundingClientRect()
      Object.assign(p.el.style, { left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px` })
      p.el.hidden = !r.width
    }
    for (const [a, p] of players) if (!want.has(a)) { p.el.remove(); players.delete(a) }
  }
  const ro = new ResizeObserver(() => syncVideos())
  ro.observe(main)
  addEventListener('resize', syncVideos)

  // ── kameraman: přiřadit svůj kanál na Twitchi k aréně ──
  function castPicker() {
    const n = d.t.arena_count
    modal(html`<h2>🎥 Vysílat arénu</h2>
      <ol class="lv-caststeps small">
        <li>V telefonu otevři aplikaci <b>Twitch</b> a spusť vysílání (<i>Go Live</i>). Telefon dej na stativ nebo ho opři.</li>
        <li>Tady napiš svůj kanál a vyber arénu – divákům se v Živě ukáže u ní.</li></ol>
      <label class="f"><span>Kanál na Twitchi</span>
        <input class="input" id="cast-url" name="url" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="jméno kanálu nebo twitch.tv/…" value="${pref('cast_url', '')}"></label>
      <p class="faint small" style="margin-top:4px">Jde i odkaz na živé vysílání na YouTube.</p>
      <div class="lv-castgrid">${Array.from({ length: n }, (_, i) => i + 1).map(a => {
        const s = streams.get(a), m = queueOf(d, a)[0]
        return html`<button type="button" class="lv-castbtn ${s ? 'busy' : ''}" data-cast-arena="${a}">
          <b>Aréna ${a}</b><span>${m ? `${nick(m.p1_reg)} vs ${nick(m.p2_reg)}` : 'volno'}</span>
          ${s ? html`<small>vysílá ${s.nick}${s.mine ? ' (ty)' : ' – převezmeš'}</small>` : ''}</button>`
      })}</div>
      <button class="btn block" data-close style="margin-top:12px">Zpět</button>`, {
      onMount: (box, close) => on(box, 'click', '[data-cast-arena]', async (e, b) => {
        const url = box.querySelector('#cast-url').value.trim()
        if (!url) { toast('Napiš svůj kanál na Twitchi.', 'err'); return box.querySelector('#cast-url').focus() }
        try {
          await busy(b, () => rpc('live_video_start', { p_tournament: id, p_arena: Number(b.dataset.castArena), p_url: url }))
          setPref('cast_url', url); close()
          toast(`Aréna ${b.dataset.castArena} se vysílá.`, 'ok')
          await loadStreams(); draw()
        } catch (err) { toast(errMsg(err), 'err', 6000) }
      }),
    })
  }

  // ── sledování: místně vždy, s účtem a zapnutým upozorněním i na serveru (push) ──
  const syncFollow = (reg, on) => pushOn ? rpc('live_follow_set', { p_reg: reg, p_on: on }).catch(e => toast(errMsg(e), 'err')) : null
  function followModal() {
    const list = d.players.filter(p => p.status === 'active' || follow.has(p.id)).sort((a, b) => a.nick.localeCompare(b.nick, 'cs'))
    const row = (p) => html`<button type="button" class="li lv-fpick ${follow.has(p.id) ? 'on' : ''}" data-reg="${p.id}" aria-pressed="${follow.has(p.id)}"><span class="grow">${p.nick}</span><span class="lv-star">${follow.has(p.id) ? '★' : '☆'}</span></button>`
    modal(html`<h2>Sledovat hráče</h2>
      <p class="muted small">Sledovaní jsou nahoře v přehledu a vyskočí ti, když jdou na arénu nebo dohrají. Ukládá se v tomhle zařízení; s účtem si můžeš zapnout i upozornění na telefon.</p>
      <input class="input" placeholder="Hledat hráče" data-q style="margin:10px 0">
      <div class="list" data-list>${list.map(row)}</div>
      <button class="btn primary block" data-close style="margin-top:14px">Hotovo</button>`, {
      onMount: (box) => {
        on(box, 'click', '[data-reg]', (e, b) => {
          const r = b.dataset.reg, now = !follow.has(r)
          now ? follow.add(r) : follow.delete(r)
          saveFollow(id, follow); syncFollow(r, now)
          b.classList.toggle('on', now); b.setAttribute('aria-pressed', now)
          b.querySelector('.lv-star').textContent = now ? '★' : '☆'
          draw()
        })
        box.querySelector('[data-q]').addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase()
          box.querySelectorAll('[data-reg]').forEach(b => { b.hidden = q && !b.textContent.toLowerCase().includes(q) })
        })
      },
    })
  }
  async function togglePush(btn) {
    if (!pushOn) {
      if (!isLoggedIn() || state.isAnon) return toast(html`Upozornění na telefon jdou jen s účtem. <a href="#/login">Přihlásit se</a>`, 'err', 6000)
      const sup = pushSupport()
      if (sup === 'ios-install') return toast('Na iPhonu nejdřív přidej BBXU na plochu (Sdílet → Přidat na plochu), pak upozornění zapni tam.', 'err', 7000)
      if (sup !== 'ok') return toast(sup === 'denied' ? 'Upozornění máš v prohlížeči zakázaná – povol je v nastavení.' : 'Tenhle prohlížeč upozornění neumí.', 'err', 6000)
      await busy(btn, async () => {
        try {
          await enablePush()
          for (const r of follow) await rpc('live_follow_set', { p_reg: r, p_on: true })
          pushOn = true; setPref(pushKey, true)
          toast('Upozornění zapnutá – přijde ti, když sledovaný hráč jde na arénu a jak dohrál.', 'ok', 5000)
        } catch (e) { toast(errMsg(e), 'err') }
      })
    } else {
      await busy(btn, async () => {
        try { for (const r of follow) await rpc('live_follow_set', { p_reg: r, p_on: false }) } catch {}
        pushOn = false; setPref(pushKey, false)
        toast('Upozornění na sledované hráče vypnutá.', 'ok')
      })
    }
    draw()
  }

  on(main, 'click', '[data-follow]', followModal)
  on(main, 'click', '[data-cast]', async () => {
    const mc = myCast()
    if (!mc) return castPicker()
    modal(html`<h2>🎥 Vysíláš arénu ${mc.arena}</h2>
      <p class="muted">Ukončením zmizí video z Živě. Vysílání na Twitchi pak ukonči i v aplikaci.</p>
      <div class="row wrap" style="margin-top:16px;gap:8px">
        <button class="btn grow" data-close>Zpět</button>
        <button class="btn grow" data-other>Jiná aréna</button>
        <button class="btn grow danger" data-stop>Ukončit</button></div>`, {
      onMount: (box, close) => {
        box.querySelector('[data-other]').onclick = () => { close(); castPicker() }
        box.querySelector('[data-stop]').onclick = async () => {
          close()
          try { await rpc('live_video_stop', { p_tournament: id, p_arena: mc.arena }); await loadStreams(); draw() } catch (e) { toast(errMsg(e), 'err') }
        }
      },
    })
  })
  on(main, 'click', '[data-vstop]', async (e, b) => {
    const a = Number(b.dataset.vstop)
    if (!await confirmBox(`Ukončit vysílání arény ${a} v Živě?`, { ok: 'Ukončit', danger: true })) return
    try { await rpc('live_video_stop', { p_tournament: id, p_arena: a }); await loadStreams(); draw() } catch (err) { toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-video]', () => { videoOn = !videoOn; setPref('video', videoOn); draw() })
  on(main, 'click', '[data-push]', (e, b) => togglePush(b))
  on(main, 'click', '[data-dirmode]', () => { dir = dir == null ? 'auto' : null; dirShown = null; setPref('dir:' + id, dir); draw() })
  on(main, 'click', '[data-dir]', (e, b) => { dir = b.dataset.dir === 'auto' ? 'auto' : Number(b.dataset.dir); dirShown = null; setPref('dir:' + id, dir); draw() })
  on(main, 'change', '[data-feed-arena]', (e, el) => {
    const a = Number(el.dataset.feedArena)
    el.checked ? feedOff.delete(a) : feedOff.add(a)
    setPref('feed_off:' + id, [...feedOff]); draw()
  })
  on(main, 'change', '[data-hide-done]', (e, el) => { hideDone = el.checked; setPref('hide_done', hideDone); draw() })
  main.addEventListener('toggle', (e) => {
    if (!e.target.matches?.('[data-stats]')) return
    if (statsOpen === e.target.open) return
    statsOpen = e.target.open; setPref('stats_open', statsOpen); draw()
  }, true)
  on(main, 'click', '[data-goto]', (e, el) => {
    if (dir != null && el.dataset.goto) { dir = Number(el.dataset.goto); setPref('dir:' + id, dir); draw(); return }
    const card = el.dataset.goto && main.querySelector(`.lv-arena[data-arena="${el.dataset.goto}"]`)
    if (!card) return
    card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
    card.classList.remove('ping'); void card.offsetWidth; card.classList.add('ping')
  })

  diff(); draw()
  let busyLoad = false, again = false
  const refresh = async () => {
    if (busyLoad) { again = true; return }
    busyLoad = true
    try { d = await load(id); await loadDecks(); await loadStreams(); diff(); draw() } catch {}
    busyLoad = false
    if (again) { again = false; refresh() }
  }
  const off = liveChannel(id, refresh)
  const poll = setInterval(refresh, 15000)           // pojistka, kdyby realtime vypadl (TV bez přihlášení)
  const vpoll = setInterval(async () => {            // nová / skončená vysílání (malý dotaz)
    const before = streamsKey(); await loadStreams()
    if (streamsKey() !== before) draw()
  }, 10000)
  const tick = setInterval(() => {
    const c = main.querySelector('[data-clock]'); if (c) c.textContent = hhmm()
    if (dir === 'auto') draw()                         // auto režie přepíná i bez nových dat
  }, 15000)
  window.addEventListener('bbx:countdown-over', draw)
  return () => { off(); clearInterval(poll); clearInterval(vpoll); clearInterval(tick)
    ro.disconnect(); removeEventListener('resize', syncVideos); layer.remove()
    clearTimeout(flashT); window.removeEventListener('bbx:countdown-over', draw)
    document.querySelector('.lv-flash')?.remove(); document.body.classList.remove('tv') }
}
