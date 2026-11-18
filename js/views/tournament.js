// ════════════════════════════════════════════════════════════════
//  Detail turnaje / akce: vstupenka, hráči, swiss, pavouk, judge, TV
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, q, errMsg, canManage, ensureSession, refreshMe, askNotify } from '../supa.js'
import { html, mount, on, formData, toast, modal, busy, confirmBox, qrSvg, qrPng, statusPill, fmtDate, fmtTime } from '../ui.js'
import { computeStandings, matchLabel, qrPayload, nextPow2 } from '../core.js'
import { renderManage } from './manage.js'
import { loadParts, deckEditor, bindDeckEditor } from '../parts.js'

const cfg = window.BBX_CONFIG

export async function load(id) {
  const [t, players, matches, judges] = await Promise.all([
    q(sb.from('tournaments').select('*').eq('id', id).maybeSingle()),
    rpc('tournament_players', { p_tournament: id }),
    q(sb.from('matches').select('*').eq('tournament_id', id).order('stage').order('round').order('pos')),
    q(sb.from('arena_judges').select('*').eq('tournament_id', id)),
  ])
  let myReg = null
  if (state.user && t) myReg = (await rpc('my_registration', { p_tournament: id }))?.[0] || null
  const pmap = new Map(players.map(p => [p.id, p]))
  return { t, players, matches, judges, myReg, pmap }
}

export function liveChannel(id, onChange) {
  let timer = null
  const bump = () => { clearTimeout(timer); timer = setTimeout(onChange, 350) }
  const ch = sb.channel('t-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${id}` }, bump)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, bump)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_judges', filter: `tournament_id=eq.${id}` }, bump)
    .subscribe()
  return () => { clearTimeout(timer); sb.removeChannel(ch) }
}

const running = (t) => t.status === 'swiss' || t.status === 'topcut'
const nickOf = (d, reg) => d.pmap.get(reg)?.nick || '?'

function tabsFor(d) {
  const { t } = d
  const tabs = [['me', d.myReg ? 'Moje vstupenka' : t.kind === 'event' ? 'Přihlásit se' : 'Registrace']]
  tabs.push(['players', `Hráči (${d.players.filter(p => p.status === 'active').length})`])
  if (t.kind === 'tournament' && t.status !== 'registration' && d.matches.some(m => m.stage === 'swiss')) tabs.push(['swiss', 'Swiss'])
  if (d.matches.some(m => m.stage !== 'swiss')) tabs.push(['bracket', 'Top cut'])
  if (t.kind === 'tournament' && running(t) && (state.level >= 1 || canManage(t))) tabs.push(['judge', 'Judge'])
  if (canManage(t)) tabs.push(['manage', 'Řízení'])
  return tabs
}

export async function render(main, [id, tabArg]) {
  let d = await load(id)
  if (!d.t) { mount(main, html`<div class="empty"><h2>Turnaj nenalezen</h2><a class="btn" href="#/">Zpět</a></div>`); return }

  const pickDefault = () => {
    if (d.myReg) return 'me'
    if (canManage(d.t) && d.t.status !== 'finished') return 'manage'
    if (d.t.status === 'topcut' || (d.t.status === 'finished' && d.matches.some(m => m.stage !== 'swiss'))) return 'bracket'
    if (d.t.status === 'swiss' || d.t.status === 'finished') return d.t.kind === 'tournament' ? 'swiss' : 'players'
    return 'me'
  }
  let tab = tabArg || pickDefault()

  const draw = () => {
    const { t } = d
    const tabs = tabsFor(d)
    if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0]
    mount(main, html`
      <a class="small muted" href="#/">← Turnaje</a>
      <header class="t-head" style="margin-top:8px">
        <div class="row between wrap">${statusPill(t)}
          ${t.kind === 'tournament' && t.status !== 'registration' ? html`<a class="btn sm ghost" href="#/t/${t.id}/tv">📺 TV rozpis</a>` : ''}</div>
        <h1 style="margin-top:10px">${t.name}</h1>
        <div class="meta">
          ${t.starts_at ? html`<span>🗓 ${fmtDate(t.starts_at)}, ${fmtTime(t.starts_at)}${t.ends_at ? `–${fmtTime(t.ends_at)}` : ''}</span>` : ''}
          ${t.location ? html`<span>📍 ${t.location}</span>` : ''}
          ${t.kind === 'tournament' ? html`<span>⚔ ${t.swiss_rounds} kol swiss${t.top_cut ? `, top ${t.top_cut}` : ''}</span>` : html`<span>Akce</span>`}
          ${t.status === 'swiss' ? html`<span style="color:var(--bolt)">Kolo ${t.current_round} z ${t.swiss_rounds}</span>` : ''}
        </div>
        ${t.description ? html`<p class="desc">${t.description}</p>` : ''}
      </header>
      <nav class="tabs" role="tablist">${tabs.map(([k, l]) => html`<a href="#/t/${t.id}/${k}" class="${k === tab ? 'on' : ''}" role="tab">${l}</a>`)}</nav>
      <section id="tab"></section>`)
    const box = main.querySelector('#tab')
    const ctx = { d, reload, draw }
    ;({ me: tabMe, players: tabPlayers, swiss: tabSwiss, bracket: tabBracket, judge: tabJudge, manage: renderManage }[tab] || tabMe)(box, ctx)
  }

  let busyReload = false, again = false
  async function reload() {
    if (busyReload) { again = true; return }
    busyReload = true
    try { d = await load(id); draw() } catch (e) { console.error(e) }
    busyReload = false
    if (again) { again = false; reload() }
  }

  draw()
  const off = liveChannel(id, () => {
    // nepřekresluj, když má uživatel rozepsaný formulář
    if (main.querySelector('form[data-keep]') && document.activeElement?.closest('form[data-keep]')) return
    reload()
  })
  const onMine = () => reload()
  window.addEventListener('bbx:my-match', onMine)
  return () => { off(); window.removeEventListener('bbx:my-match', onMine) }
}

// ────────────────────────────────────────────────────────────────
//  MOJE VSTUPENKA / REGISTRACE
// ────────────────────────────────────────────────────────────────
function tabMe(box, { d, reload }) {
  const { t, myReg } = d
  const isEv = t.kind === 'event'

  if (!myReg) {
    if (t.status !== 'registration') {
      mount(box, html`<div class="notice">${t.status === 'finished' ? 'Turnaj je odehraný.' : t.status === 'canceled' ? 'Turnaj byl zrušen.' : 'Registrace je uzavřená – turnaj už běží.'}</div>`)
      return
    }
    const full = t.max_players && d.players.filter(p => p.status === 'active').length >= t.max_players
    if (full) { mount(box, html`<div class="notice warn">Turnaj je plný.</div>`); return }
    return regForm(box, d, reload, null)
  }

  const myMatches = d.matches.filter(m => m.p1_reg === myReg.id || m.p2_reg === myReg.id)
  const current = myMatches.find(m => m.status !== 'done' && m.p1_reg && m.p2_reg)
  const called = current && current.arena
  const opp = current ? nickOf(d, current.p1_reg === myReg.id ? current.p2_reg : current.p1_reg) : null
  const qrText = qrPayload(t.id, myReg.qr_token)
  const beys = [myReg.bey1, myReg.bey2, myReg.bey3].filter(Boolean)

  let arenaBlock
  if (called) {
    arenaBlock = html`<div class="lbl">${current.status === 'live' ? 'Hraješ teď na aréně' : 'Tvoje aréna'}</div>
      <div class="big">${current.arena}</div>
      <div class="vs">proti ${opp}</div>
      <div class="faint small">${matchLabel(current, t.top_cut)}${current.best_of > 1 ? ` · BO${current.best_of} (${current.p1_reg === myReg.id ? current.p1_wins : current.p2_wins}:${current.p1_reg === myReg.id ? current.p2_wins : current.p1_wins})` : ''}${current.wave > 1 ? ` · ${current.wave}. na řadě` : ''}</div>`
  } else if (myReg.status === 'dropped') {
    arenaBlock = html`<div class="lbl">Z turnaje jsi odstoupil.</div>`
  } else if (t.status === 'registration') {
    arenaBlock = html`<div class="lbl">Arénu se dozvíš po startu turnaje.</div><div class="hint">Ukaž tenhle QR kód rozhodčímu u stolu.</div>`
  } else if (t.status === 'finished') {
    arenaBlock = html`<div class="lbl">Konečné umístění</div><div class="big">${myReg.final_place ?? '–'}.</div>`
  } else {
    const alive = t.status === 'swiss' || d.matches.some(m => m.stage !== 'swiss' && m.status !== 'done' && (m.p1_reg === myReg.id || m.p2_reg === myReg.id || !m.p1_reg || !m.p2_reg))
    const inCut = t.status !== 'topcut' || myReg.seed
    arenaBlock = html`<div class="lbl">${!inCut ? 'Do top cutu jsi nepostoupil. Díky za hru!' : alive ? 'Čekej na další kolo – dáme ti vědět.' : 'Pro tebe turnaj skončil. Díky za hru!'}</div>`
  }

  mount(box, html`
    <div class="pass ${called ? 'is-called' : ''}">
      <div class="pass-top">
        <div class="pass-label">${isEv ? 'Přihláška na akci' : 'Vstupenka do turnaje'}</div>
        <div class="pass-nick">${myReg.nick}</div>
        ${beys.length ? html`<div class="pass-beys">${beys.map(b => html`<span>${b}</span>`)}</div>` : ''}
      </div>
      ${isEv ? '' : html`
      <div class="pass-tear"></div>
      <div class="pass-bottom">
        <div class="pass-qr" aria-label="QR kód pro rozhodčího">${qrSvg(qrText)}</div>
        <div class="pass-arena">${arenaBlock}</div>
      </div>`}
    </div>
    <div class="row wrap" style="margin-top:12px">
      ${!isEv ? html`<button class="btn sm" data-act="save-qr">Uložit QR do telefonu</button>` : ''}
      ${t.status === 'registration' ? html`
        ${!isEv ? html`<button class="btn sm" data-act="edit">Upravit beyblady</button>` : ''}
        <button class="btn sm danger" data-act="leave">Odhlásit se</button>` : ''}
    </div>
    ${state.isAnon ? html`<div class="notice" style="margin-top:16px">Jsi tu jako host. <a href="#/login/signup">Založ si účet</a> a tenhle turnaj i výsledky se ti uloží do profilu.</div>` : ''}
    ${myMatches.filter(m => m.status === 'done').length ? html`
      <h2>Moje zápasy</h2>
      <div class="list">${myMatches.filter(m => m.status === 'done').sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at)).map(m => matchRow(d, m, myReg.id))}</div>` : ''}`)

  on(box, 'click', '[data-act=save-qr]', () => {
    const a = document.createElement('a')
    a.href = qrPng(qrText, 10); a.download = `bbxu-${t.name}-${myReg.nick}.png`.replace(/[^\w.-]+/g, '_'); a.click()
  })
  on(box, 'click', '[data-act=edit]', () => regForm(box, d, reload, myReg))
  on(box, 'click', '[data-act=leave]', async () => {
    if (!await confirmBox('Opravdu se odhlásit z turnaje?', { ok: 'Odhlásit', danger: true })) return
    try { await q(sb.from('registrations').delete().eq('id', myReg.id)); await refreshMe(); toast('Odhlášeno.', 'ok'); reload() }
    catch (e) { toast(errMsg(e), 'err') }
  })
}

async function regForm(box, d, reload, existing) {
  const { t } = d
  const isEv = t.kind === 'event'
  const account = state.user && !state.isAnon
  const nickLocked = account && state.profile?.nick
  const v = existing || {}
  let cat = null
  if (!isEv) {
    mount(box, html`<div class="spinner" aria-label="Načítám seznam dílů"></div>`)
    try { cat = await loadParts() } catch (e) { mount(box, html`<div class="notice err">Seznam dílů se nepodařilo načíst: ${errMsg(e)}</div>`); return }
  }

  mount(box, html`
    <form class="card stack" id="f-reg" data-keep>
      <h3>${existing ? 'Upravit registraci' : isEv ? 'Přihláška na akci' : 'Registrace do turnaje'}</h3>
      <label class="f"><span>Nick</span>
        <input class="input" name="nick" minlength="2" maxlength="24" required value="${v.nick || state.profile?.nick || ''}" ${nickLocked ? 'readonly' : ''}>
        ${nickLocked ? html`<div class="hint">Nick z tvého účtu.</div>` : ''}</label>
      ${isEv ? '' : html`
        ${deckEditor(v.deck)}
        <p class="hint">Piš a vyber díl z nabídky – jde to i zkratkou (GF, HN…). Každý beyblade musí být jiný. Do startu turnaje můžeš registraci kdykoliv upravit.</p>`}
      <div class="row">
        ${existing ? html`<button type="button" class="btn grow" data-act="cancel">Zpět</button>` : ''}
        <button class="btn primary grow">${existing ? 'Uložit' : isEv ? 'Přihlásit se' : 'Zaregistrovat se'}</button>
      </div>
    </form>`)

  const getDeck = isEv ? null : bindDeckEditor(box.querySelector('[data-deck]'), cat)
  on(box, 'click', '[data-act=cancel]', () => reload())
  on(box, 'submit', '#f-reg', async (e, f) => {
    e.preventDefault()
    const data = formData(f)
    const row = { nick: data.nick.trim() }
    if (!isEv) {
      try { row.deck = getDeck() } catch (err) { return toast(err.message, 'err') }
    }

    if (!existing && !state.user) {
      // bez účtu → nabídni registraci, jinak pokračuj jako host
      const choice = await guestPrompt()
      if (choice === 'signup') { sessionStorage.setItem('bbx_after_login', location.hash); location.hash = '#/login/signup'; return }
      if (choice === 'login') { sessionStorage.setItem('bbx_after_login', location.hash); location.hash = '#/login'; return }
      if (choice !== 'guest') return
    }
    await busy(f.querySelector('button.primary'), async () => {
      try {
        if (existing) {
          await q(sb.from('registrations').update(row).eq('id', existing.id))
          toast('Registrace upravena.', 'ok')
        } else {
          await ensureSession()
          await q(sb.from('registrations').insert({ ...row, tournament_id: t.id }))
          await refreshMe()
          toast(isEv ? 'Jsi přihlášený na akci.' : 'Jsi zaregistrovaný! Tady je tvůj QR kód.', 'ok')
          askNotify()
        }
        reload()
      } catch (err) { toast(errMsg(err), 'err') }
    })
  })
}

function guestPrompt() {
  return new Promise(res => {
    modal(html`
      <h2>Nechceš si založit účet?</h2>
      <p>S účtem se ti budou ukládat odehrané turnaje, výsledky a statistiky beybladů. Zabere to minutu.</p>
      <div class="stack" style="margin-top:18px">
        <button class="btn primary block" data-c="signup">Založit účet</button>
        <button class="btn block" data-c="login">Už účet mám</button>
        <button class="btn ghost block" data-c="guest">Pokračovat bez účtu</button>
      </div>`, {
      onMount: (b, close) => on(b, 'click', '[data-c]', (e, el) => { close(); res(el.dataset.c) }),
    })
  })
}

export function matchRow(d, m, meReg) {
  const p1 = m.p1_reg ? nickOf(d, m.p1_reg) : (m.p1_bye ? 'volno' : '…')
  const p2 = m.p2_reg ? nickOf(d, m.p2_reg) : (m.p2_bye || m.is_bye ? 'volný los' : '…')
  const done = m.status === 'done'
  const w1 = done && m.winner_reg && m.winner_reg === m.p1_reg, w2 = done && m.winner_reg && m.winner_reg === m.p2_reg
  const started = m.p1_wins + m.p2_wins + m.p1_score + m.p2_score > 0
  const score = m.is_bye ? 'bye' : !done && !started ? 'vs'
    : m.best_of > 1 ? `${m.p1_wins} : ${m.p2_wins}` : `${m.p1_score} : ${m.p2_score}`
  const mine = meReg && (m.p1_reg === meReg || m.p2_reg === meReg)
  return html`
    <div class="match ${mine ? 'mine' : ''}">
      <div class="side l ${w1 ? 'win' : done && !m.is_bye ? 'lose' : ''}"><div class="nick">${p1}</div></div>
      <div class="score">${score}</div>
      <div class="side r ${w2 ? 'win' : done && !m.is_bye ? 'lose' : ''}"><div class="nick">${p2}</div></div>
      <div class="info"><span>${matchLabel(m, d.t.top_cut)}${m.best_of > 1 ? ` · BO${m.best_of}` : ''}</span>
        <span>${m.status === 'live' ? html`<span class="pill live" style="font-size:11px;padding:1px 8px">hraje se</span>` : ''}
        ${m.arena && !done ? `aréna ${m.arena}${m.wave > 1 ? ` (${m.wave}. na řadě)` : ''}` : ''}</span></div>
    </div>`
}

// ────────────────────────────────────────────────────────────────
//  HRÁČI
// ────────────────────────────────────────────────────────────────
function tabPlayers(box, { d, reload }) {
  const { t } = d
  const mgr = canManage(t)
  const list = d.players.slice().sort((a, b) =>
    (a.status === 'dropped') - (b.status === 'dropped') ||
    (t.status === 'finished' ? (a.final_place ?? 999) - (b.final_place ?? 999) : 0) ||
    (a.seed ?? 999) - (b.seed ?? 999))

  mount(box, list.length ? html`
    <div class="list">${list.map(p => html`
      <div class="li" style="${p.status === 'dropped' ? 'opacity:.5' : ''}">
        ${t.status === 'finished' && p.final_place ? html`<span class="place p${p.final_place}">${p.final_place}.</span>` : ''}
        <span class="av">${p.avatar || '👤'}</span>
        <div class="grow">
          <div class="ellipsis" style="font-weight:600">${p.has_account ? html`<a href="#/p/${p.user_id}">${p.nick}</a>` : p.nick}
            ${p.seed ? html`<span class="faint small"> · seed ${p.seed}</span>` : ''}
            ${p.status === 'dropped' ? html`<span class="faint small"> · odstoupil</span>` : ''}</div>
          ${p.bey1 ? html`<div class="small muted ellipsis">${[p.bey1, p.bey2, p.bey3].filter(Boolean).join(' · ')}</div>`
                   : html`<div class="small faint">${p.region || (p.has_account ? '' : 'host')}</div>`}
        </div>
        ${mgr ? html`<button class="btn sm ghost" data-menu="${p.id}" aria-label="Akce s hráčem">⋯</button>` : ''}
      </div>`)}</div>
    ${t.kind === 'tournament' && t.status === 'registration' ? html`<p class="hint">Beyblady ostatních hráčů se zveřejní po skončení turnaje.</p>` : ''}`
    : html`<div class="empty">Zatím se nikdo nepřihlásil.</div>`)

  on(box, 'click', '[data-menu]', (e, el) => {
    const p = d.pmap.get(el.dataset.menu)
    modal(html`
      <h2>${p.nick}</h2>
      <div class="stack">
        ${t.kind === 'tournament' && !p.has_account ? html`<button class="btn block" data-a="qr">Zobrazit QR kód hráče</button>` : ''}
        ${running(t) ? html`<button class="btn block" data-a="drop">${p.status === 'dropped' ? 'Vrátit do turnaje' : 'Odstoupil z turnaje'}</button>` : ''}
        ${t.status === 'registration' ? html`<button class="btn danger block" data-a="del">Smazat registraci</button>` : ''}
        <button class="btn ghost block" data-close>Zavřít</button>
      </div>`, {
      onMount: (mb, close) => on(mb, 'click', '[data-a]', async (ev, b) => {
        try {
          if (b.dataset.a === 'qr') {
            const tok = await rpc('manager_registration_qr', { p_reg: p.id })
            mount(mb, html`<h2>${p.nick}</h2><div class="pass-qr" style="width:240px;height:240px;margin:10px auto">${qrSvg(qrPayload(t.id, tok))}</div>
              <button class="btn block" data-close>Zavřít</button>`)
            return
          }
          if (b.dataset.a === 'drop') {
            await q(sb.from('registrations').update({ status: p.status === 'dropped' ? 'active' : 'dropped' }).eq('id', p.id))
            toast(p.status === 'dropped' ? 'Hráč je zpět v turnaji.' : 'Hráč nebude v dalších kolech nasazen.', 'ok')
          }
          if (b.dataset.a === 'del') {
            if (!await confirmBox(`Smazat registraci hráče ${p.nick}?`, { ok: 'Smazat', danger: true })) return
            await q(sb.from('registrations').delete().eq('id', p.id))
            toast('Registrace smazána.', 'ok')
          }
          close(); reload()
        } catch (err) { toast(errMsg(err), 'err') }
      }),
    })
  })
}

// ────────────────────────────────────────────────────────────────
//  SWISS – pořadí a kola
// ────────────────────────────────────────────────────────────────
export function standingsFor(d) {
  return computeStandings(d.players, d.matches, { winScore: d.t.win_score, salt: d.t.id })
}

function tabSwiss(box, { d }) {
  const { t, myReg } = d
  const st = standingsFor(d)
  const rounds = [...new Set(d.matches.filter(m => m.stage === 'swiss').map(m => m.round))].sort((a, b) => b - a)
  const cut = t.top_cut && t.status !== 'registration' ? Math.min(t.top_cut, st.length) : 0

  mount(box, html`
    <h2 style="margin-top:0">Pořadí</h2>
    <div class="card" style="padding:4px 10px;overflow-x:auto">
      <table class="standings">
        <thead><tr><th>#</th><th>Hráč</th><th title="Hlavní body (výhry)">HB</th><th title="Pomocné body – součet vlastních bodů">PB</th><th title="Druhé pomocné – HB poražených soupeřů">PB2</th><th>V–P</th></tr></thead>
        <tbody>${st.map((s, i) => html`
          <tr class="${i + 1 === cut ? 'cut' : ''} ${myReg && s.id === myReg.id ? 'me' : ''} ${s.status === 'dropped' ? 'dropped' : ''}">
            <td>${s.rank}</td><td>${s.nick}</td><td><b>${s.main}</b></td><td>${s.aux1}</td><td>${s.aux2}</td><td>${s.wins}–${s.losses}</td></tr>`)}</tbody>
      </table>
    </div>
    <p class="hint">Pořadí: hlavní body → pomocné body → druhé pomocné → vzájemný zápas → los.${cut ? ` Žlutá čára = hranice top ${cut}.` : ''}</p>
    ${rounds.map(r => html`
      <h2>Kolo ${r}</h2>
      <div class="list">${d.matches.filter(m => m.stage === 'swiss' && m.round === r)
        .sort((a, b) => (a.is_bye - b.is_bye) || (a.status === 'done') - (b.status === 'done') || a.pos - b.pos)
        .map(m => matchRow(d, m, myReg?.id))}</div>`)}`)
}

// ────────────────────────────────────────────────────────────────
//  TOP CUT – pavouk
// ────────────────────────────────────────────────────────────────
function tabBracket(box, { d }) {
  const { t, myReg } = d
  const br = d.matches.filter(m => m.stage !== 'swiss')
  const N = nextPow2(Math.max(2, t.top_cut || 2))
  const seedOf = (reg) => d.pmap.get(reg)?.seed
  const slot = (m, n) => {
    const reg = m[`p${n}_reg`], bye = m[`p${n}_bye`]
    const win = m.status === 'done' && reg && m.winner_reg === reg
    const score = m.best_of > 1 ? m[`p${n}_wins`] : m[`p${n}_score`]
    return html`<div class="b-p ${win ? 'win' : ''} ${bye && !reg ? 'bye' : ''}">
      <span class="ellipsis">${reg ? html`${seedOf(reg) ? html`<span class="faint">${seedOf(reg)} </span>` : ''}${nickOf(d, reg)}` : bye ? 'bye' : '—'}</span>
      <span class="s num">${m.status !== 'pending' && reg && !m.is_bye ? score : ''}</span></div>`
  }
  const bm = (m) => html`
    <div class="b-match ${m.status === 'live' ? 'live' : ''} ${myReg && (m.p1_reg === myReg.id || m.p2_reg === myReg.id) ? 'mine' : ''}">
      ${slot(m, 1)}${slot(m, 2)}
      <div class="b-meta"><span>${m.best_of > 1 ? `BO${m.best_of}` : ''}</span>
        <span>${m.status === 'live' ? 'hraje se' : m.status === 'pending' && m.arena ? `aréna ${m.arena}` : m.is_bye && m.status === 'done' ? 'postup bez boje' : ''}</span></div>
    </div>`
  const col = (title, ms) => ms.length ? html`<div class="b-col"><h4>${title}</h4>${ms.sort((a, b) => a.pos - b.pos).map(bm)}</div>` : ''
  const wbR = [...new Set(br.filter(m => m.stage === 'wb').map(m => m.round))].sort((a, b) => a - b)
  const lbR = [...new Set(br.filter(m => m.stage === 'lb').map(m => m.round))].sort((a, b) => a - b)

  const podium = t.status === 'finished'
    ? d.players.filter(p => p.final_place && p.final_place <= 4).sort((a, b) => a.final_place - b.final_place) : []

  mount(box, html`
    ${podium.length ? html`<div class="list" style="margin-bottom:18px">${podium.map(p => html`
      <div class="li"><span class="place p${p.final_place}">${p.final_place}.</span><span class="av">${p.avatar || '👤'}</span>
        <b class="grow">${p.nick}</b></div>`)}</div>` : ''}
    <h2 style="margin-top:0">Winners</h2>
    <div class="bracket-wrap"><div class="bracket">
      ${wbR.map(r => col(matchLabel({ stage: 'wb', round: r }, N), br.filter(m => m.stage === 'wb' && m.round === r)))}
      ${col('Grand finále', br.filter(m => m.stage === 'gf'))}
    </div></div>
    ${lbR.length ? html`<h2>Losers</h2>
    <div class="bracket-wrap"><div class="bracket">
      ${lbR.map(r => col(matchLabel({ stage: 'lb', round: r }, N), br.filter(m => m.stage === 'lb' && m.round === r)))}
    </div></div>` : ''}`)
}

// ────────────────────────────────────────────────────────────────
//  JUDGE – výběr arény a fronta zápasů
// ────────────────────────────────────────────────────────────────
async function tabJudge(box, { d, reload }) {
  const { t } = d
  const me = state.user?.id
  const ids = [...new Set(d.judges.map(j => j.judge_id))]
  const nicks = ids.length ? await q(sb.from('profiles').select('id,nick').in('id', ids)) : []
  const nickMap = new Map(nicks.map(n => [n.id, n.nick]))
  const arenas = Array.from({ length: t.arena_count }, (_, i) => i + 1)
  const queue = (a) => d.matches.filter(m => m.arena === a && m.status !== 'done' && m.p1_reg && m.p2_reg)
    .sort((x, y) => (y.status === 'live') - (x.status === 'live') || (x.wave || 0) - (y.wave || 0))
  const bbxst = (m) => `${cfg.bbxstUrl}?match=${m.id}&t=${t.id}`
  // moje arény první
  const order = arenas.slice().sort((a, b) =>
    (d.judges.some(j => j.arena === b && j.judge_id === me)) - (d.judges.some(j => j.arena === a && j.judge_id === me)) || a - b)

  mount(box, html`
    <p class="muted">Klepni na arénu, u které rozhoduješ. BBXST se otevře v judge módu s načtenými hráči.</p>
    <div class="stack" style="margin-top:12px">
      ${order.map(a => {
        const j = d.judges.find(x => x.arena === a)
        const mineA = j && j.judge_id === me
        const qa = queue(a), cur = qa[0]
        return html`<div class="card arena-card ${mineA ? 'mine' : ''} ${cur?.status === 'live' ? 'live' : ''}">
          <div class="arena-no num">${a}</div>
          <div class="grow" style="min-width:0">
            <div class="small muted">${j ? (mineA ? 'Tvoje aréna' : `Judge: ${nickMap.get(j.judge_id) || '?'}`) : 'Volná aréna'}${qa.length > 1 ? ` · další ${qa.length - 1}` : ''}</div>
            ${cur ? html`
              <div class="ellipsis" style="font-weight:600;font-size:17px"><span style="color:#b9d4ff">${nickOf(d, cur.p1_reg)}</span> <span class="faint">vs</span> <span style="color:#ffc2cd">${nickOf(d, cur.p2_reg)}</span></div>
              <div class="small faint ellipsis">${matchLabel(cur, t.top_cut)}${cur.best_of > 1 ? ` · BO${cur.best_of} (${cur.p1_wins}:${cur.p2_wins})` : ''}${cur.status === 'live' ? ' · hraje se' : ' · na řadě'}</div>`
              : html`<div class="faint">Teď tu nic nečeká</div>`}
          </div>
          <div class="arena-actions">
            ${cur ? html`<button class="btn primary sm" data-go="${a}">Rozhodovat</button>` : !j ? html`<button class="btn sm" data-claim="${a}">Zabrat</button>` : ''}
            ${mineA ? html`<button class="btn ghost sm" data-release="${a}">Uvolnit</button>` : ''}
          </div>
        </div>`
      })}
    </div>`)

  const claim = async (a) => {
    if (d.judges.some(j => j.arena === a)) return
    try { await q(sb.from('arena_judges').insert({ tournament_id: t.id, arena: a })) }
    catch (err) { if (!/duplicate|arena_judges_pkey/.test(err.message)) throw err }
  }
  on(box, 'click', '[data-go]', async (e, b) => {
    const a = Number(b.dataset.go)
    const cur = queue(a)[0]
    if (!cur) return
    await busy(b, async () => {
      try { await claim(a) } catch (err) { toast(errMsg(err), 'err') }
      location.href = bbxst(cur)
    })
  })
  on(box, 'click', '[data-claim]', async (e, b) => {
    try { await claim(Number(b.dataset.claim)); reload() }
    catch (err) { toast(errMsg(err), 'err'); reload() }
  })
  on(box, 'click', '[data-release]', async (e, b) => {
    try { await q(sb.from('arena_judges').delete().eq('tournament_id', t.id).eq('arena', Number(b.dataset.release))); reload() }
    catch (err) { toast(errMsg(err), 'err') }
  })
}

// ────────────────────────────────────────────────────────────────
//  TV ROZPIS (nahrazuje BBX_watchTV)
// ────────────────────────────────────────────────────────────────
export async function renderTV(main, [id]) {
  document.body.classList.add('tv')
  let d = await load(id)
  let scrollTimer = null
  const clock = () => new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })

  const draw = () => {
    const { t } = d
    const active = d.matches.filter(m => m.status !== 'done' && m.p1_reg && m.p2_reg && m.arena)
      .sort((a, b) => a.arena - b.arena || (b.status === 'live') - (a.status === 'live') || (a.wave || 0) - (b.wave || 0))
    const firstPerArena = new Set()
    const phase = t.status === 'swiss' ? `Swiss · kolo ${t.current_round}/${t.swiss_rounds}` : t.status === 'topcut' ? `Top ${t.top_cut}` : t.status === 'finished' ? 'Konec turnaje' : 'Registrace'
    let body
    if (active.length) {
      body = html`<div class="tv-grid">${active.map(m => {
        const next = firstPerArena.has(m.arena); firstPerArena.add(m.arena)
        return html`<div class="tv-card ${m.status === 'live' ? 'live' : ''} ${next ? 'next' : ''}">
          <div class="ar"><small>aréna</small>${m.arena}</div>
          <div class="n l">${nickOf(d, m.p1_reg)}</div>
          <div class="vs">${m.status === 'live' && m.best_of > 1 ? `${m.p1_wins}:${m.p2_wins}` : 'vs'}</div>
          <div class="n r">${nickOf(d, m.p2_reg)}</div>
        </div>`
      })}</div>`
    } else {
      const st = standingsFor(d).slice(0, 8)
      body = html`<div class="card" style="max-width:900px;margin:0 auto;font-size:clamp(16px,1.6vw,24px)">
        <h2 style="margin-top:0">${t.status === 'finished' ? 'Konečné pořadí' : 'Čekáme na další kolo – průběžné pořadí'}</h2>
        <table class="standings"><tbody>${(t.status === 'finished'
          ? d.players.filter(p => p.final_place).sort((a, b) => a.final_place - b.final_place).slice(0, 8).map(p => html`<tr><td>${p.final_place}.</td><td>${p.nick}</td><td></td></tr>`)
          : st.map(s => html`<tr><td>${s.rank}</td><td>${s.nick}</td><td><b>${s.main}</b> HB · ${s.aux1} PB</td></tr>`))}</tbody></table></div>`
    }
    mount(main, html`
      <div class="tv-head"><h1>${t.name}</h1><div class="r">${phase} · ${clock()}</div></div>
      ${body}
      <a class="btn sm tv-exit" href="#/t/${t.id}">Zavřít TV</a>`)
    startScroll()
  }

  // pomalé rolování, když se zápasy nevejdou na obrazovku
  function startScroll() {
    clearInterval(scrollTimer)
    if (document.documentElement.scrollHeight <= innerHeight + 10) return
    let dir = 1, pause = 60
    scrollTimer = setInterval(() => {
      if (pause > 0) { pause--; return }
      scrollBy(0, dir)
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) { pause = 60; dir = 0; setTimeout(() => { scrollTo(0, 0); dir = 1; pause = 60 }, 2000) }
    }, 30)
  }

  draw()
  const off = liveChannel(id, async () => { d = await load(id); draw() })
  const tick = setInterval(() => { const r = main.querySelector('.tv-head .r'); if (r) r.textContent = r.textContent.replace(/\d{1,2}:\d{2}$/, clock()) }, 15000)
  // pojistka, kdyby realtime vypadl
  const poll = setInterval(async () => { try { d = await load(id); draw() } catch {} }, 60000)
  return () => { off(); clearInterval(tick); clearInterval(poll); clearInterval(scrollTimer); document.body.classList.remove('tv') }
}

export { nickOf, running }
