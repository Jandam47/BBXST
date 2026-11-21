// ════════════════════════════════════════════════════════════════
//  ŽIVĚ – přenos z arén pro diváky doma (#/t/<id>/live)
//  Arény: kdo hraje, skóre, beye aktuální sady (zahrané šedě + body / −),
//  endy každé strany, historie bodů. Sledovaní hráči (localStorage), živý feed
//  bodů a výsledků, poslední výsledky, průběžné pořadí. Bez přihlášení.
//  Beye se ukazují až po zahrání (nezahrané v sadě = „?“), ať se neprozradí deck.
// ════════════════════════════════════════════════════════════════
import { html, raw, mount, on, modal, fmtLeft } from '../ui.js'
import { load, queueOf, liveChannel, standingsFor, paused, ptHist, liveBattles, ptLabel } from './tournament.js'
import { matchLabel, phaseName } from '../core.js'
import { icon } from '../icons.js'

const FIN = { xtreme: ['X', 'Xtreme'], burst: ['B', 'Burst'], over: ['O', 'Over'], spin: ['S', 'Spin'] }
const finOf = (b) => b.finish || (b.pts === 3 ? 'xtreme' : b.pts === 1 ? 'spin' : null)
const followKey = (id) => `bbxu_follow:${id}`
const readFollow = (id) => { try { return new Set(JSON.parse(localStorage.getItem(followKey(id))) || []) } catch { return new Set() } }
const saveFollow = (id, set) => { try { localStorage.setItem(followKey(id), JSON.stringify([...set])) } catch {} }
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
  const feed = []                  // živé dění od otevření stránky
  let prev = null                  // minulý stav kvůli rozpoznání nových bodů a výsledků
  const nick = (reg) => d.pmap.get(reg)?.nick || '?'

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
    feed.splice(30)
    const big = events.filter(e => e.big).slice(-1)[0]
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

  // ── jedna strana arény: beye aktuální sady ──
  function sideBeys(set, s) {
    const slots = set.map((b, i) => {
      const bey = b[`p${s}_bey`] || '—', last = i === set.length - 1
      const res = !b.slot ? html`<span class="lv-r d">R</span>`
        : b.slot === s ? html`<span class="lv-r w">${ptLabel(b)}</span>` : html`<span class="lv-r l">−</span>`
      return html`<li class="${last ? 'last' : 'done'}"><span class="lv-bn">${bey}</span>${res}</li>`
    })
    for (let i = set.length; i < 3; i++) slots.push(html`<li class="hid"><span class="lv-bn">?</span></li>`)
    return html`<ol class="lv-beys">${slots}</ol>`
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
    if (!cur) return html`<section class="lv-arena idle" data-arena="${a}"><div class="lv-ah"><span class="lv-ano">${a}</span><span class="faint">Volná aréna</span></div></section>`
    const live = cur.status === 'live'
    const g = live ? curGame(d, cur) : { battles: [] }
    const { set, no } = curSet(g.battles)
    const s1 = cur.live_p1 ?? 0, s2 = cur.live_p2 ?? 0
    return html`<section class="lv-arena ${live ? 'live' : 'wait'} ${fol ? 'fol' : ''}" data-arena="${a}">
      <div class="lv-ah"><span class="lv-ano">${a}</span>
        <span class="lv-lab">${matchLabel(cur, d.t.top_cut, d.t.format)}${cur.best_of > 1 ? ` · BO${cur.best_of} · hra ${Math.min(cur.p1_wins + cur.p2_wins + 1, cur.best_of)} (${cur.p1_wins}:${cur.p2_wins})` : ''}</span>
        ${live ? html`<span class="lv-on">● hraje se</span>` : html`<span class="lv-next">na řadě</span>`}</div>
      <div class="lv-vs">
        <div class="lv-p l"><span class="lv-nick p1c">${follow.has(cur.p1_reg) ? html`<i class="lv-star">★ </i>` : ''}${nick(cur.p1_reg)}</span>${live ? sideFin(g.battles, 1) : ''}</div>
        <div class="lv-sc num">${live ? html`<b>${s1}</b><i>:</i><b>${s2}</b>` : html`<span class="faint">vs</span>`}</div>
        <div class="lv-p r"><span class="lv-nick p2c">${nick(cur.p2_reg)}${follow.has(cur.p2_reg) ? html`<i class="lv-star"> ★</i>` : ''}</span>${live ? sideFin(g.battles, 2) : ''}</div>
      </div>
      ${live ? html`<div class="lv-set"><div>${sideBeys(set, 1)}</div><span class="lv-setno">${g.battles.length ? `sada ${no}` : 'čeká se na první souboj'}</span><div>${sideBeys(set, 2)}</div></div>
        ${ptHist(g.battles)}` : ''}
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
    const cols = arenas.length <= 1 ? 1 : arenas.length <= 4 ? 2 : 3
    const fol = [...follow].filter(r => d.pmap.has(r))

    mount(main, html`
      <div class="lv">
        <header class="lv-head">
          <div><h1>${t.name}</h1><div class="lv-sub">${running ? html`<span class="lv-dot" aria-hidden="true"></span><b>ŽIVĚ</b> · ` : ''}${phase} · <span data-clock>${hhmm()}</span></div></div>
          <div class="row" style="gap:8px"><button class="btn sm" data-follow>★ Sledovat hráče${fol.length ? ` (${fol.length})` : ''}</button>
            <a class="btn sm ghost btn-ico" href="#/t/${t.id}/tv">${raw(icon('tv'))}TV rozpis</a></div>
        </header>
        ${paused(t) ? html`<div class="tv-pause" data-countdown-box><b>PAUZA</b><span class="num" data-countdown="${t.pause_until}">${fmtLeft(t.pause_until)}</span></div>` : ''}
        <div class="lv-body">
          <div class="lv-main">
            ${t.status === 'registration' ? html`<div class="card lv-empty"><h2>Turnaj ještě nezačal</h2><p class="muted">Přihlášeno ${d.players.filter(p => p.status === 'active').length} hráčů. Jakmile začne, uvidíš tu arény živě.</p></div>`
              : t.status === 'finished' ? html`<div class="card lv-empty"><h2>Konečné pořadí</h2><ol class="lv-podium">${d.players.filter(p => p.final_place).sort((a, b) => a.final_place - b.final_place).slice(0, 8)
                  .map(p => html`<li class="p${p.final_place}"><span class="num">${p.final_place}.</span> ${p.nick}</li>`)}</ol></div>`
              : anyLive ? html`<div class="lv-arenas" style="--cols:${cols}">${arenas.map(x => arenaCard(x.a, x.q))}</div>`
              : html`<div class="card lv-empty"><h2>Čekáme na další kolo</h2><p class="muted">Všechny zápasy kola jsou dohrané.</p></div>`}
          </div>
          <aside class="lv-side">
            ${fol.length ? html`<section><h3>Sledovaní</h3>${fol.map(r => followCard(r, st))}</section>`
              : html`<section class="lv-hint"><p>Klepni na <b>★ Sledovat hráče</b> a uvidíš, kde a jak hrají tví hráči. Vyskočí ti, až půjdou na arénu.</p></section>`}
            ${running ? html`<section><h3>Dění</h3>${feed.length ? html`<ul class="lv-feed">${feed.slice(0, 8).map(e => html`<li class="k-${e.kind} ${e.fol ? 'fol' : ''}"><span class="faint num">${e.at}</span>${e.arena ? html`<span class="lv-fa">A${e.arena}</span>` : ''}<span>${e.text}</span></li>`)}</ul>`
              : html`<p class="faint small">Tady se objeví každý bod a výsledek, jak padají.</p>`}</section>` : ''}
            ${results.length ? html`<section><h3>Poslední výsledky</h3><ul class="lv-res">${results.map(m => {
              const w1 = m.winner_reg === m.p1_reg
              return html`<li><span class="${w1 ? 'w' : ''}">${nick(m.p1_reg)}</span><b class="num">${m.best_of > 1 ? `${m.p1_wins}:${m.p2_wins}` : `${m.p1_score}:${m.p2_score}`}</b><span class="${w1 ? '' : 'w'}">${nick(m.p2_reg)}</span></li>`
            })}</ul></section>` : ''}
            ${st.length && t.status === 'swiss' ? html`<section><h3>Pořadí</h3><ol class="lv-st">${st.slice(0, 8).map(s => html`<li class="${follow.has(s.id) ? 'fol' : ''}"><span class="num">${s.rank}.</span><span class="grow">${s.nick}</span><span class="num faint">${s.wins}–${s.losses}</span><b class="num">${s.main}</b></li>`)}</ol></section>` : ''}
          </aside>
        </div>
        <a class="btn sm tv-exit" href="#/t/${t.id}">Zavřít</a>
      </div>`)
  }

  function followModal() {
    const list = d.players.filter(p => p.status === 'active' || follow.has(p.id)).sort((a, b) => a.nick.localeCompare(b.nick, 'cs'))
    const row = (p) => html`<button type="button" class="li lv-fpick ${follow.has(p.id) ? 'on' : ''}" data-reg="${p.id}" aria-pressed="${follow.has(p.id)}"><span class="grow">${p.nick}</span><span class="lv-star">${follow.has(p.id) ? '★' : '☆'}</span></button>`
    modal(html`<h2>Sledovat hráče</h2>
      <p class="muted small">Sledovaní jsou nahoře v přehledu a vyskočí ti, když jdou na arénu nebo dohrají. Ukládá se jen v tomhle zařízení.</p>
      <input class="input" placeholder="Hledat hráče" data-q style="margin:10px 0">
      <div class="list" data-list>${list.map(row)}</div>
      <button class="btn primary block" data-close style="margin-top:14px">Hotovo</button>`, {
      onMount: (box) => {
        on(box, 'click', '[data-reg]', (e, b) => {
          const r = b.dataset.reg
          follow.has(r) ? follow.delete(r) : follow.add(r)
          saveFollow(id, follow)
          b.classList.toggle('on', follow.has(r)); b.setAttribute('aria-pressed', follow.has(r))
          b.querySelector('.lv-star').textContent = follow.has(r) ? '★' : '☆'
          draw()
        })
        box.querySelector('[data-q]').addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase()
          box.querySelectorAll('[data-reg]').forEach(b => { b.hidden = q && !b.textContent.toLowerCase().includes(q) })
        })
      },
    })
  }

  on(main, 'click', '[data-follow]', followModal)
  on(main, 'click', '[data-goto]', (e, el) => {
    const card = el.dataset.goto && main.querySelector(`.lv-arena[data-arena="${el.dataset.goto}"]`)
    if (!card) return
    card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
    card.classList.remove('ping'); void card.offsetWidth; card.classList.add('ping')
  })

  diff(); draw()
  let busy = false, again = false
  const refresh = async () => {
    if (busy) { again = true; return }
    busy = true
    try { d = await load(id); diff(); draw() } catch {}
    busy = false
    if (again) { again = false; refresh() }
  }
  const off = liveChannel(id, refresh)
  const poll = setInterval(refresh, 15000)           // pojistka, kdyby realtime vypadl (TV bez přihlášení)
  const tick = setInterval(() => { const c = main.querySelector('[data-clock]'); if (c) c.textContent = hhmm() }, 15000)
  window.addEventListener('bbx:countdown-over', draw)
  return () => { off(); clearInterval(poll); clearInterval(tick); clearTimeout(flashT); window.removeEventListener('bbx:countdown-over', draw)
    document.querySelector('.lv-flash')?.remove(); document.body.classList.remove('tv') }
}
