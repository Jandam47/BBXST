// ════════════════════════════════════════════════════════════════
//  Fashion show (akce druhu „fashion“)
//  přihláška s N beyi · design judge · molo + hodnocení · rozstřel · boss of fashion
//  · řízení · vyhlášení na TV (4.+ naráz, pak 3. → 2. → 1. po 5 s)
//  Stav show drží DB (tournaments.fashion, RPC fashion_*), body jsou tajné do vyhlášení.
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, q, errMsg, canManage, ensureSession, refreshMe, askNotify, isLoggedIn } from '../supa.js'
import { html, raw, mount, on, formData, toast, modal, busy, confirmBox, statusPill, fmtDate, fmtTime, plural } from '../ui.js'
import { icon } from '../icons.js'
import { loadParts, deckEditor, bindDeckEditor } from '../parts.js'
import { liveChannel, guestPrompt } from './tournament.js'

export const isFashion = (t) => !!t && t.kind === 'event' && t.event_type === 'fashion'

// hodnoticí kritéria: [klíč, popisek, maximum]
export const CRITERIA = [['design', 'Celkový design', 10], ['harmony', 'Sladěnost', 5], ['cosplay', 'Cosplay', 5], ['uniq', 'Unikátnost', 3]]
const MAX_TOTAL = 24   // 10 + 5 + 5 + 3 + 1
// vyhlášení: kolik sekund po reveal_at se ukáže dané místo
const REVEAL = (place) => place === 1 ? 15 : place === 2 ? 10 : place === 3 ? 5 : 0

export async function load(id) {
  const [t, b] = await Promise.all([
    q(sb.from('tournaments').select('*').eq('id', id).maybeSingle()),
    rpc('fashion_board', { p_tournament: id }),
  ])
  let myReg = null
  if (state.user && t) myReg = (await rpc('my_registration', { p_tournament: id }))?.[0] || null
  return derive({ t, b, myReg, skew: new Date(b.now).getTime() - Date.now() })
}

function derive(d) {
  const { b } = d
  const st = b.state || {}
  const players = b.players
  const active = players.filter(p => p.status === 'active')
  const cur = players.find(p => p.id === st.current) || null
  const nick = (id) => players.find(p => p.id === id)?.nick || '?'
  const judgeNick = (uid) => b.judges.find(j => j.user_id === uid)?.nick || '?'
  const me = state.user?.id
  const mine = d.myReg ? players.find(p => p.id === d.myReg.id) : null
  return { ...d, st, players, active, cur, nick, judgeNick, me, mine, judges: b.judges, isJudge: !!b.me_judge,
           tie: (st.tie || []).map(id => players.find(p => p.id === id)).filter(Boolean) }
}
// čas serveru (kvůli odpočtu vyhlášení na více zařízeních)
const serverNow = (d) => Date.now() + (d.skew || 0)
const revealAt = (d) => d.st.reveal_at ? new Date(d.st.reveal_at).getTime() : null
const revealDone = (d) => d.t.status === 'finished' && revealAt(d) && serverNow(d) >= revealAt(d) + 15000

function tabsFor(d) {
  const { t } = d
  const tabs = [['me', d.myReg ? 'Můj Status' : d.isJudge ? 'Design judge' : t.status === 'registration' ? 'Přihlásit se' : 'Info',
                 d.myReg ? 'ticket' : d.isJudge ? 'star' : 'pen']]
  if (t.status === 'registration') tabs.push(['players', `Hráči (${d.active.length})`, 'users'])
  if (t.status === 'show') tabs.push(['show', d.isJudge ? 'Hodnotit' : 'Molo', d.isJudge ? 'star' : 'hanger'])
  if (t.status === 'finished') tabs.push(['results', 'Výsledky', 'trophy'])
  if (canManage(t)) tabs.push(['manage', 'Řízení', 'gear'])
  return tabs
}

export async function render(main, [id, tabArg]) {
  let d = await load(id)
  const pickDefault = () => {
    if (d.t.status === 'show' && d.isJudge) return 'show'
    if (d.myReg || d.isJudge) return 'me'
    if (canManage(d.t) && d.t.status !== 'finished') return 'manage'
    if (d.t.status === 'finished') return 'results'
    if (d.t.status === 'show') return 'show'
    return 'me'
  }
  let tab = tabArg || pickDefault()
  let timers = []

  const draw = () => {
    const { t } = d
    timers.forEach(clearTimeout); timers = []
    const tabs = tabsFor(d)
    if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0]
    mount(main, html`
      <header class="t-head">
        <div class="row between wrap">${statusPill(t)}
          ${t.status !== 'registration' && t.status !== 'canceled' ? html`<a class="btn sm ghost btn-ico" href="#/t/${t.id}/tv">${raw(icon('tv'))}TV</a>` : ''}</div>
        <h1 style="margin-top:10px">${t.name}</h1>
        <div class="meta">
          ${t.starts_at ? html`<span>🗓 ${fmtDate(t.starts_at)}, ${fmtTime(t.starts_at)}${t.ends_at ? `–${fmtTime(t.ends_at)}` : ''}</span>` : ''}
          ${t.location ? html`<span>📍 ${t.location}</span>` : ''}
          <span class="fx-kind">Fashion · ${plural(t.fashion_beys, 'beyblade', 'beyblady', 'beybladů')} na hráče</span>
          <span>${plural(d.judges.length, 'design judge', 'design judge', 'design judge')}</span>
        </div>
        ${t.description ? html`<p class="desc">${t.description}</p>` : ''}
      </header>
      <nav class="tabs t-nav" role="tablist" aria-label="Fashion">${tabs.map(([k, l, ico]) => html`<a href="#/t/${t.id}/${k}" class="${k === tab ? 'on' : ''}" role="tab" aria-selected="${k === tab}"><span class="ico" aria-hidden="true">${raw(icon(ico))}</span><span class="lb">${l}</span></a>`)}</nav>
      <section id="tab"></section>`)
    const box = main.querySelector('#tab')
    const ctx = { d, reload, later: (ms, fn) => timers.push(setTimeout(fn, ms)) }
    ;({ me: tabMe, players: tabPlayers, show: tabShow, results: tabResults, manage: tabManage }[tab] || tabMe)(box, ctx)
  }

  let alive = true, busyReload = false, again = false
  async function reload() {
    if (!alive) return
    if (busyReload) { again = true; return }
    busyReload = true
    try { const nd = await load(id); if (alive) { d = nd; draw() } } catch (e) { console.error(e) }
    busyReload = false
    if (again) { again = false; reload() }
  }
  draw()
  const off = liveChannel(id, () => {
    if (document.querySelector('.modal [data-keep]')) return       // rozepsané hodnocení nepřekreslovat
    if (main.querySelector('form[data-keep]') && document.activeElement?.closest('form[data-keep]')) return
    reload()
  })
  document.body.classList.add('has-tnav')
  return () => { alive = false; off(); timers.forEach(clearTimeout); document.body.classList.remove('has-tnav') }
}

// ────────────────────────────────────────────────────────────────
//  MŮJ STATUS / PŘIHLÁŠKA / DESIGN JUDGE
// ────────────────────────────────────────────────────────────────
function tabMe(box, { d, reload }) {
  const { t, myReg, st, cur } = d

  if (d.isJudge && !myReg) return judgeCard(box, d, reload)

  if (!myReg) {
    if (t.status !== 'registration') {
      mount(box, html`<div class="notice">${t.status === 'show' ? html`Fashion show právě běží. <a href="#/t/${t.id}/show">Sleduj molo</a>.`
        : t.status === 'finished' ? html`Fashion show skončila. <a href="#/t/${t.id}/results">Výsledky</a>` : 'Akce byla zrušena.'}</div>`)
      return
    }
    const full = t.max_players && d.active.length >= t.max_players
    mount(box, html`
      ${full ? html`<div class="notice warn">Soutěž je plná.</div>` : html`<div id="reg-slot"></div>`}
      <div class="card stack fx-judge-cta">
        <h3>Chceš hodnotit?</h3>
        <p class="muted">Design judge hodnotí sestavy soutěžících na molu. Potřebuješ k tomu účet a sám pak nesoutěžíš.</p>
        <button class="btn" data-act="judge-join">${raw(icon('star'))} Chci být design judge</button>
      </div>`)
    on(box, 'click', '[data-act=judge-join]', (e, b) => joinAsJudge(b, d, reload))
    if (!full) regForm(box.querySelector('#reg-slot'), d, reload, null)
    return
  }

  const me = d.mine || {}
  const beys = me.beys || [myReg.bey1, myReg.bey2, myReg.bey3].filter(Boolean)
  const dropped = myReg.status === 'dropped'
  let block
  if (t.status === 'registration') {
    block = html`<div class="lbl">Pořadí na molu se náhodně vylosuje při startu show.</div>
      <div class="hint">${plural(d.active.length, 'soutěžící', 'soutěžící', 'soutěžících')} · ${plural(d.judges.length, 'design judge', 'design judge', 'design judge')}</div>`
  } else if (dropped) {
    block = html`<div class="lbl">Z fashion show jsi vyřazený.</div>`
  } else if (t.status === 'show' && st.phase === 'scoring' && cur) {
    if (cur.id === myReg.id) {
      block = html`<div class="fx-now"><b>Jsi na řadě!</b><span>Běž na molo – design judge tě teď hodnotí.</span>
        <small>Ohodnotilo ${judgeProgress(d, cur)}</small></div>`
    } else if (me.seed > cur.seed) {
      const before = d.active.filter(p => p.seed > cur.seed && p.seed < me.seed).length + 1
      block = html`<div class="lbl">Tvoje pořadí na molu</div><div class="big">${me.seed}.</div>
        <div class="vs">${before === 1 ? 'Jdeš hned po tom, kdo je teď na molu.' : `Před tebou je ještě ${plural(before, 'hráč', 'hráči', 'hráčů')}.`}</div>
        <div class="faint small">Na molu je ${cur.nick}</div>`
    } else {
      block = html`<div class="lbl">Máš to za sebou 👏</div><div class="hint">Ohodnotilo ${judgeProgress(d, me)}. Body se ukážou při vyhlášení.</div>`
    }
  } else if (t.status === 'show') {
    block = html`<div class="lbl">Design judge rozhodují o vítězi…</div><div class="hint">Výsledky se vyhlásí na TV.</div>`
  } else if (t.status === 'finished') {
    block = me.place ? html`<div class="lbl">Konečné umístění</div><div class="big">${me.place}.</div>${me.score ? html`<div class="vs">${me.score.total} bodů</div>` : ''}`
      : html`<div class="lbl">Vyhlášení právě běží na TV…</div>`
  } else block = html`<div class="lbl">Akce byla zrušena.</div>`

  mount(box, html`
    <div class="pass fx-pass ${cur && cur.id === myReg.id && st.phase === 'scoring' ? 'is-called' : ''}">
      <div class="pass-top">
        <div class="pass-label">Fashion show</div>
        <div class="pass-nick">${myReg.nick}</div>
        ${beys.length ? html`<div class="pass-beys">${beys.map(b => html`<span>${b}</span>`)}</div>` : ''}
      </div>
      <div class="pass-tear"></div>
      <div class="pass-bottom"><div class="pass-arena">${block}</div></div>
    </div>
    ${t.status === 'registration' ? html`<div class="row wrap" style="margin-top:12px">
      <button class="btn sm" data-act="edit">Upravit beyblady</button>
      <button class="btn sm danger" data-act="leave">Odhlásit se</button></div>` : ''}
    ${state.isAnon ? html`<div class="notice" style="margin-top:16px">Jsi tu jako host. <a href="#/login/signup">Založ si účet</a> a umístění se ti uloží do profilu jako achievement.</div>` : ''}`)

  on(box, 'click', '[data-act=edit]', () => regForm(box, d, reload, myReg))
  on(box, 'click', '[data-act=leave]', async () => {
    if (!await confirmBox('Opravdu se odhlásit z fashion show?', { ok: 'Odhlásit', danger: true })) return
    try { await q(sb.from('registrations').delete().eq('id', myReg.id)); await refreshMe(); toast('Odhlášeno.', 'ok'); reload() }
    catch (e) { toast(errMsg(e), 'err') }
  })
}

const judgeProgress = (d, p) => `${(p.rated_by || []).filter(u => d.judges.some(j => j.user_id === u)).length} z ${d.judges.length} judge`

function judgeCard(box, d, reload) {
  const { t, st, cur } = d
  mount(box, html`
    <div class="card stack fx-judge">
      <div class="fx-judge-badge">${raw(icon('star'))}<span>Jsi design judge</span></div>
      ${t.status === 'registration' ? html`
        <p class="muted">Po startu show tě aplikace vyzve, koho jít hodnotit. Body nikdo neuvidí až do vyhlášení.</p>
        <button class="btn sm danger" data-act="judge-leave">Už nechci hodnotit</button>`
      : t.status === 'show' ? html`
        ${st.phase === 'scoring' && cur ? html`<p>Na molu je <b>${cur.nick}</b> (${cur.seed}. z ${d.active.length}).</p>` : ''}
        ${st.phase === 'tiebreak' ? html`<p><b>Rozstřel o 1. místo</b> – dej +1 jednomu z hráčů.</p>` : ''}
        ${st.phase === 'boss' ? html`<p>${st.boss === d.me ? html`<b>Jsi boss of fashion</b> – vyber vítěze.` : html`Vítěze vybírá boss of fashion <b>${d.judgeNick(st.boss)}</b>.`}</p>` : ''}
        <a class="btn primary" href="#/t/${t.id}/show">${raw(icon('star'))} Jít hodnotit</a>`
      : html`<p class="muted">Show skončila. <a href="#/t/${t.id}/results">Výsledky</a></p>`}
    </div>`)
  on(box, 'click', '[data-act=judge-leave]', async (e, b) => {
    await busy(b, async () => {
      try { await rpc('fashion_judge_leave', { p_tournament: t.id }); toast('Už nejsi design judge.', 'ok'); await refreshMe(); reload() }
      catch (err) { toast(errMsg(err), 'err') }
    })
  })
}

async function joinAsJudge(btn, d, reload) {
  if (!isLoggedIn()) {
    modal(html`
      <h2>Design judge potřebuje účet</h2>
      <p>Hodnotit můžou jen přihlášení hráči – ať je jasné, kdo jak hodnotil. Přihlas se nebo si založ účet, zabere to minutu.</p>
      <div class="stack" style="margin-top:18px">
        <button class="btn primary block" data-c="signup">Založit účet</button>
        <button class="btn block" data-c="login">Přihlásit se</button>
        <button class="btn ghost block" data-close>Zpět</button>
      </div>`, {
      onMount: (b, close) => on(b, 'click', '[data-c]', (e, el) => {
        close(); sessionStorage.setItem('bbx_after_login', location.hash)
        location.hash = el.dataset.c === 'signup' ? '#/login/signup' : '#/login'
      }),
    })
    return
  }
  await busy(btn, async () => {
    try { await rpc('fashion_judge_join', { p_tournament: d.t.id }); toast('Jsi design judge. Po startu tě vyzveme k hodnocení.', 'ok'); askNotify(); await refreshMe(); reload() }
    catch (err) { toast(errMsg(err), 'err') }
  })
}

async function regForm(box, d, reload, existing) {
  const { t } = d
  const nickLocked = isLoggedIn() && state.profile?.nick
  const v = existing || {}
  mount(box, html`<div class="spinner" aria-label="Načítám seznam dílů"></div>`)
  let cat
  try { cat = await loadParts() } catch (e) { mount(box, html`<div class="notice err">Seznam dílů se nepodařilo načíst: ${errMsg(e)}</div>`); return }
  mount(box, html`
    <form class="card stack" id="f-reg" data-keep>
      <h3>${existing ? 'Upravit beyblady' : 'Přihláška do soutěže'}</h3>
      <label class="f"><span>Nick</span>
        <input class="input" name="nick" minlength="2" maxlength="24" required value="${v.nick || state.profile?.nick || ''}" ${nickLocked ? 'readonly' : ''}>
        ${nickLocked ? html`<div class="hint">Nick z tvého účtu.</div>` : ''}</label>
      ${deckEditor(v.deck, t.fashion_beys)}
      <p class="hint">Vyplň ${plural(t.fashion_beys, 'beyblade', 'beyblady', 'beybladů')}, které ukážeš na molu. Do startu show je můžeš kdykoliv upravit.</p>
      <div class="row">
        ${existing ? html`<button type="button" class="btn grow" data-act="cancel">Zpět</button>` : ''}
        <button class="btn primary grow">${existing ? 'Uložit' : 'Potvrdit přihlášku'}</button>
      </div>
    </form>`)
  const getDeck = bindDeckEditor(box.querySelector('[data-deck]'), cat, { distinct: false })
  on(box, 'click', '[data-act=cancel]', () => reload())
  on(box, 'submit', '#f-reg', async (e, f) => {
    e.preventDefault()
    const row = { nick: formData(f).nick.trim() }
    try { row.deck = getDeck() } catch (err) { return toast(err.message, 'err') }
    if (!existing && !state.user) {
      const choice = await guestPrompt()
      if (choice === 'signup' || choice === 'login') { sessionStorage.setItem('bbx_after_login', location.hash); location.hash = choice === 'signup' ? '#/login/signup' : '#/login'; return }
      if (choice !== 'guest') return
    }
    await busy(f.querySelector('button.primary'), async () => {
      try {
        if (existing) { await q(sb.from('registrations').update(row).eq('id', existing.id)); toast('Uloženo.', 'ok') }
        else {
          await ensureSession()
          await q(sb.from('registrations').insert({ ...row, tournament_id: t.id }))
          await refreshMe()
          toast('Jsi přihlášený do fashion show!', 'ok')
          askNotify()
        }
        reload()
      } catch (err) { toast(errMsg(err), 'err') }
    })
  })
}

// ────────────────────────────────────────────────────────────────
//  HRÁČI (před startem)
// ────────────────────────────────────────────────────────────────
function tabPlayers(box, { d }) {
  mount(box, html`
    <h2 style="margin-top:4px">Soutěžící</h2>
    ${d.active.length ? html`<div class="list">${d.active.map(p => html`
      <div class="li"><span class="av">${p.avatar || '👤'}</span>
        <div class="grow"><div class="ellipsis" style="font-weight:600">${p.has_account ? html`<a href="#/p/${p.user_id}">${p.nick}</a>` : p.nick}</div>
          ${p.beys ? html`<div class="small muted ellipsis">${p.beys.join(' · ')}</div>` : html`<div class="small faint">${p.has_account ? '' : 'host'}</div>`}</div>
      </div>`)}</div>` : html`<div class="empty">Zatím se nikdo nepřihlásil.</div>`}
    <h2>Design judge</h2>
    ${d.judges.length ? html`<div class="fx-chips">${d.judges.map(j => html`<a class="fx-chip" href="#/p/${j.user_id}"><span>${j.avatar || '👤'}</span>${j.nick}</a>`)}</div>`
      : html`<div class="empty">Zatím žádný design judge.</div>`}
    <p class="hint">Beyblady soutěžících se ukážou po startu show.</p>`)
}

// ────────────────────────────────────────────────────────────────
//  MOLO / HODNOTIT
// ────────────────────────────────────────────────────────────────
function tabShow(box, { d, reload }) {
  const { t, st, cur } = d
  if (t.status !== 'show') { mount(box, html`<div class="notice">Show neběží.</div>`); return }

  let top = ''
  if (st.phase === 'scoring' && cur) {
    const mineDone = d.isJudge && cur.my_score
    top = html`<div class="fx-stage">
      <div class="fx-stage-lbl">Na molu · ${cur.seed}. z ${d.active.length}</div>
      <div class="fx-stage-nick">${cur.nick}</div>
      ${cur.beys ? html`<div class="pass-beys">${cur.beys.map(b => html`<span>${b}</span>`)}</div>` : ''}
      ${judgeChips(d, cur.rated_by)}
      ${d.isJudge ? html`<button class="btn ${mineDone ? '' : 'primary'} block" data-rate="${cur.id}">${mineDone ? 'Upravit moje hodnocení' : `Hodnotit ${cur.nick}`}</button>` : ''}
    </div>`
  } else if (st.phase === 'tiebreak') {
    top = html`<div class="fx-stage tie">
      <div class="fx-stage-lbl">Rozstřel o 1. místo</div>
      <p>${d.tie.map(p => p.nick).join(' a ')} mají stejně bodů.${d.isJudge ? ' Dej +1 jednomu z nich:' : ' Design judge hlasují.'}</p>
      ${d.isJudge ? html`<div class="fx-vote">${d.tie.map(p => html`<button class="btn ${d.b.my_vote === p.id ? 'primary' : ''}" data-vote="${p.id}">+1 ${p.nick}</button>`)}</div>` : ''}
      ${judgeChips(d, d.b.voted || [])}
    </div>`
  } else if (st.phase === 'boss') {
    const iAmBoss = st.boss === d.me
    top = html`<div class="fx-stage boss">
      <div class="fx-stage-lbl">Boss of fashion</div>
      <div class="fx-stage-nick">${d.judgeNick(st.boss)}</div>
      <p>${iAmBoss ? 'I po hlasování je shoda. Jsi boss of fashion – vyber vítěze:' : `I po hlasování je shoda – vítěze vybírá ${d.judgeNick(st.boss)}.`}</p>
      ${iAmBoss ? html`<div class="fx-vote">${d.tie.map(p => html`<button class="btn primary" data-boss="${p.id}">👑 ${p.nick}</button>`)}</div>` : ''}
    </div>`
  }

  mount(box, html`
    ${top}
    <h2>Pořadí na molu</h2>
    <div class="list fx-order">${d.players.filter(p => p.seed).map(p => {
      const called = cur && p.seed <= cur.seed, now = cur && p.id === cur.id
      const done = d.isJudge && p.my_score
      return html`<button type="button" class="li fx-row ${now ? 'now' : ''} ${called ? '' : 'wait'} ${p.status === 'dropped' ? 'dropped' : ''}" data-open="${p.id}">
        <span class="fx-seed num">${p.seed}.</span>
        <div class="grow" style="min-width:0;text-align:left"><div class="ellipsis" style="font-weight:600">${p.nick}</div>
          <div class="small faint">${p.status === 'dropped' ? 'vyřazený' : now ? 'na molu' : called ? `ohodnotilo ${judgeProgress(d, p)}` : 'čeká'}</div></div>
        ${d.isJudge && called && p.status === 'active' ? html`<span class="pill ${done ? 'ok' : 'live'}">${done ? '✓ hodnoceno' : 'hodnotit'}</span>` : ''}
      </button>`
    })}</div>
    <p class="hint">${d.isJudge ? 'Hodnotit můžeš vyvolané hráče. Svoje hodnocení můžeš upravit až do vyhlášení. Body ostatních judge neuvidíš.' : 'Body se ukážou až při vyhlášení.'}</p>`)

  on(box, 'click', '[data-rate]', (e, b) => playerModal(d, d.players.find(p => p.id === b.dataset.rate), reload))
  on(box, 'click', '[data-open]', (e, b) => playerModal(d, d.players.find(p => p.id === b.dataset.open), reload))
  on(box, 'click', '[data-vote]', (e, b) => busy(b, async () => {
    try { await rpc('fashion_vote', { p_tournament: t.id, p_reg: b.dataset.vote }); toast('Hlas uložen.', 'ok'); reload() } catch (err) { toast(errMsg(err), 'err') }
  }))
  on(box, 'click', '[data-boss]', async (e, b) => {
    const p = d.players.find(x => x.id === b.dataset.boss)
    if (!await confirmBox(html`Vítězem fashion show bude <b>${p.nick}</b>. Potvrdit?`, { ok: 'Vybrat vítěze' })) return
    try { await rpc('fashion_boss_pick', { p_tournament: t.id, p_reg: p.id }); toast('Vítěz vybrán. Vyhlášení běží na TV.', 'ok'); reload() } catch (err) { toast(errMsg(err), 'err') }
  })
}

function judgeChips(d, ratedBy = []) {
  return html`<div class="fx-chips">${d.judges.map(j => {
    const ok = ratedBy.includes(j.user_id)
    return html`<span class="fx-chip ${ok ? 'ok' : ''}" title="${ok ? 'hotovo' : 'čeká'}"><span>${ok ? '✓' : '…'}</span>${j.nick}</span>`
  })}</div>`
}

function playerModal(d, p, reload) {
  if (!p) return
  const { t, st, cur } = d
  const canRate = d.isJudge && st.phase === 'scoring' && cur && p.seed <= cur.seed && p.status === 'active'
  const sc = { design: 0, harmony: 0, cosplay: 0, uniq: 0, extra: 0, ...(p.my_score || {}) }
  const total = () => sc.design + sc.harmony + sc.cosplay + sc.uniq + sc.extra
  modal(html`
    <div class="fx-modal">
      <div class="faint small">${p.seed ? `${p.seed}. na molu` : ''}${p.id === cur?.id ? ' · teď na molu' : ''}</div>
      <h2 style="margin:2px 0 8px">${p.nick}</h2>
      ${p.beys ? html`<div class="pass-beys">${p.beys.map(b => html`<span>${b}</span>`)}</div>` : ''}
      ${canRate ? html`
      <form class="stack fx-rate" id="f-rate" data-keep>
        ${CRITERIA.map(([k, label, max]) => html`
          <div class="fx-crit"><div class="row between"><span>${label}</span><b class="num" data-val="${k}">${sc[k]}</b></div>
            <div class="fx-pick" style="--n:${max + 1}" role="radiogroup" aria-label="${label}">
              ${Array.from({ length: max + 1 }, (_, v) => html`<button type="button" data-k="${k}" data-v="${v}" class="${sc[k] === v ? 'on' : ''}" aria-pressed="${sc[k] === v}">${v}</button>`)}
            </div></div>`)}
        <label class="check fx-extra"><input type="checkbox" name="extra" ${sc.extra ? 'checked' : ''}> +1 bod za celkový dojem</label>
        <div class="fx-total">Celkem <b class="num" data-total>${total()}</b> / ${MAX_TOTAL}</div>
        <button class="btn primary block">${p.my_score ? 'Uložit změnu' : 'Uložit hodnocení'}</button>
      </form>` : d.isJudge && st.phase === 'scoring' && p.status === 'active' ? html`<p class="muted" style="margin-top:12px">Na tohohle hráče ještě nedošlo.</p>` : ''}
      <h3 style="margin-top:18px">Design judge</h3>
      <div class="list">${d.judges.map(j => {
        const ok = (p.rated_by || []).includes(j.user_id)
        return html`<div class="li"><span class="av">${j.avatar || '👤'}</span><div class="grow">${j.nick}</div>
          <span class="pill ${ok ? 'ok' : ''}">${ok ? '✓ ohodnotil' : 'čeká'}</span></div>`
      })}</div>
      <button class="btn ghost block" data-close style="margin-top:14px">Zavřít</button>
    </div>`, {
    onMount: (b, close) => {
      on(b, 'click', '[data-k]', (e, el) => {
        const k = el.dataset.k
        sc[k] = Number(el.dataset.v)
        b.querySelectorAll(`[data-k="${k}"]`).forEach(x => { x.classList.toggle('on', x === el); x.setAttribute('aria-pressed', x === el) })
        b.querySelector(`[data-val="${k}"]`).textContent = sc[k]
        b.querySelector('[data-total]').textContent = total()
      })
      on(b, 'change', '[name=extra]', (e, el) => { sc.extra = el.checked ? 1 : 0; b.querySelector('[data-total]').textContent = total() })
      on(b, 'submit', '#f-rate', async (e, f) => {
        e.preventDefault()
        await busy(f.querySelector('button.primary'), async () => {
          try {
            await rpc('fashion_rate', { p_tournament: t.id, p_reg: p.id, p_design: sc.design, p_harmony: sc.harmony,
                                        p_cosplay: sc.cosplay, p_uniq: sc.uniq, p_extra: sc.extra })
            toast(`Hodnocení ${p.nick}: ${total()} bodů uloženo.`, 'ok')
            close(); reload()
          } catch (err) { toast(errMsg(err), 'err') }
        })
      })
    },
  })
}

// ────────────────────────────────────────────────────────────────
//  VÝSLEDKY (postupně podle vyhlášení na TV)
// ────────────────────────────────────────────────────────────────
function tabResults(box, { d, reload, later }) {
  const ra = revealAt(d)
  const shown = d.players.filter(p => p.place).sort((a, b) => a.place - b.place || a.nick.localeCompare(b.nick))
  const done = revealDone(d)
  if (ra && !done) {
    // znovu načíst, až se odkryje další místo
    const next = [5, 10, 15, 15.5].map(s => ra + s * 1000 - serverNow(d)).find(ms => ms > 0)
    if (next) later(next + 300, reload)
  }
  mount(box, html`
    ${!done ? html`<div class="notice fx-live">${raw(icon('tv'))} Vyhlášení právě běží na TV – místa se odkrývají postupně.</div>` : ''}
    ${shown.length ? html`<div class="list fx-results">${shown.map(p => html`
      <div class="li fx-res p${Math.min(p.place, 4)}">
        <span class="place ${p.place <= 3 ? 'p' + p.place : ''}">${p.place}.</span>
        <div class="grow" style="min-width:0">
          <div class="ellipsis" style="font-weight:600">${p.has_account ? html`<a href="#/p/${p.user_id}">${p.nick}</a>` : p.nick}
            ${p.place === 1 && Object.keys(d.b.votes || {}).length ? html`<span class="faint small"> · rozhodl rozstřel</span>` : ''}</div>
          ${p.score ? html`<div class="small muted">${CRITERIA.map(([k, l]) => `${l} ${p.score[k]}`).join(' · ')}${p.score.extra ? ` · dojem +${p.score.extra}` : ''}</div>` : ''}
        </div>
        ${p.score ? html`<b class="num fx-pts">${p.score.total}</b>` : ''}
      </div>`)}</div>` : html`<div class="empty">Výsledky se ještě vyhlašují…</div>`}
    ${done ? html`<p class="hint">Body = součet od všech design judge (max. ${MAX_TOTAL} od každého). Shoda bodů = dělené místo, o 1. místě rozhoduje rozstřel.</p>` : ''}`)
}

// ────────────────────────────────────────────────────────────────
//  ŘÍZENÍ
// ────────────────────────────────────────────────────────────────
function tabManage(box, { d, reload }) {
  const { t, st, cur } = d
  const sections = []
  const missing = (p) => d.judges.filter(j => !(p.rated_by || []).includes(j.user_id))

  if (t.status === 'registration') {
    const ready = d.active.length >= 2 && d.judges.length >= 1
    sections.push(html`<div class="card stack">
      <h3>Před startem</h3>
      <p class="muted">${plural(d.active.length, 'soutěžící', 'soutěžící', 'soutěžících')} · ${plural(d.judges.length, 'design judge', 'design judge', 'design judge')} · ${plural(t.fashion_beys, 'beyblade', 'beyblady', 'beybladů')} na hráče</p>
      <div class="row wrap"><a class="btn" href="#/t/${t.id}/edit">Upravit</a>
        <button class="btn primary" data-act="start" ${ready ? '' : 'disabled'}>Spustit fashion show</button></div>
      <p class="hint">${ready ? 'Po spuštění se pořadí na molu náhodně zamíchá a vyvolá se první hráč. Pak už nejde nic vrátit – přihlášky ani judge.' : 'Potřebuješ aspoň 2 soutěžící a 1 design judge.'}</p>
    </div>
    <div class="card stack">
      <h3>Design judge</h3>
      ${d.judges.length ? html`<div class="list">${d.judges.map(j => html`<div class="li"><span class="av">${j.avatar || '👤'}</span><div class="grow">${j.nick}</div>
        <button class="btn sm ghost" data-unjudge="${j.user_id}" aria-label="Odebrat ${j.nick}">Odebrat</button></div>`)}</div>`
        : html`<p class="muted">Zatím nikdo. Design judge se přihlásí sami v záložce Přihlásit se (potřebují účet).</p>`}
    </div>
    <div class="card stack">
      <h3>Přidat soutěžícího bez telefonu</h3>
      <button class="btn" data-act="walkin">Přidat soutěžícího</button>
    </div>`)
  }

  if (t.status === 'show' && st.phase === 'scoring' && cur) {
    const miss = missing(cur)
    const notRated = d.active.filter(p => p.seed <= cur.seed && missing(p).length)
    sections.push(html`<div class="card stack fx-ctl">
      <h3>Na molu: ${cur.nick} <span class="faint">(${cur.seed}. z ${d.players.filter(p => p.seed).length})</span></h3>
      ${judgeChips(d, cur.rated_by)}
      ${st.last
        ? html`<p class="muted">${miss.length ? `Poslední hráč – čeká se na ${miss.map(j => j.nick).join(', ')}.` : 'Všichni jsou ohodnocení.'}</p>
          <button class="btn primary" data-act="finish">Ukončit a vyhlásit výsledky</button>
          ${notRated.length ? html`<p class="hint warn-t">Neúplné hodnocení: ${notRated.map(p => p.nick).join(', ')}. Chybějící judge se počítají jako 0 bodů.</p>` : ''}`
        : html`<p class="muted">${miss.length ? `Čeká se na: ${miss.map(j => j.nick).join(', ')}. Když ohodnotí všichni, vyvolá se další hráč sám.` : 'Hotovo.'}</p>
          <button class="btn" data-act="next">Vyvolat dalšího hned</button>`}
    </div>
    <details class="card"><summary style="cursor:pointer;font-weight:600">Soutěžící, který se nedostavil</summary>
      <div class="list" style="margin-top:12px">${d.players.filter(p => p.seed && (p.seed >= cur.seed || p.status === 'dropped')).map(p => html`
        <div class="li"><span class="fx-seed num">${p.seed}.</span><div class="grow">${p.nick}${p.status === 'dropped' ? html` <span class="faint small">· vyřazený</span>` : ''}</div>
          <button class="btn sm ${p.status === 'dropped' ? '' : 'danger'}" data-drop="${p.id}" data-v="${p.status === 'dropped' ? 0 : 1}">${p.status === 'dropped' ? 'Vrátit' : 'Vyřadit'}</button></div>`)}</div>
      <p class="hint">Vyřazený hráč se přeskočí a nedostane umístění.</p></details>`)
  }

  if (t.status === 'show' && st.phase === 'tiebreak') {
    const voted = d.b.voted || []
    sections.push(html`<div class="card stack">
      <h3>Rozstřel o 1. místo</h3>
      <p class="muted">${d.tie.map(p => p.nick).join(' × ')} · hlasovalo ${voted.length} z ${d.judges.length} judge.</p>
      ${judgeChips(d, voted)}
      <button class="btn" data-act="close-vote">Uzavřít hlasování</button>
      <p class="hint">Když hlasují všichni, uzavře se samo. Při shodě vybere vítěze náhodně zvolený boss of fashion.</p>
    </div>`)
  }

  if (t.status === 'show' && st.phase === 'boss') {
    sections.push(html`<div class="card stack">
      <h3>Boss of fashion: ${d.judgeNick(st.boss)}</h3>
      <p class="muted">Vybírá vítěze z: ${d.tie.map(p => p.nick).join(', ')}.</p>
      <details><summary class="small muted" style="cursor:pointer">Boss tu není? Vyber za něj</summary>
        <div class="fx-vote" style="margin-top:10px">${d.tie.map(p => html`<button class="btn" data-boss="${p.id}">👑 ${p.nick}</button>`)}</div></details>
    </div>`)
  }

  if (t.status === 'finished') sections.push(html`<div class="notice">Fashion show je ukončená. <a href="#/t/${t.id}/results">Výsledky</a> · <a href="#/t/${t.id}/tv">TV vyhlášení</a></div>`)
  if (!['finished', 'canceled'].includes(t.status)) {
    sections.push(html`<details class="card" style="margin-top:24px"><summary style="cursor:pointer;font-weight:600">Zrušení</summary>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn danger" data-act="cancel">Zrušit akci</button>
        ${t.status === 'registration' ? html`<button class="btn danger" data-act="delete">Smazat úplně</button>` : ''}
      </div></details>`)
  }
  if (t.status === 'canceled') sections.push(html`<div class="notice">Zrušeno.</div>`)
  mount(box, html`<div class="stack">${sections}</div>`)

  const act = (b, fn, okMsg) => busy(b, async () => { try { await fn(); if (okMsg) toast(okMsg, 'ok'); reload() } catch (e) { toast(errMsg(e), 'err') } })
  on(box, 'click', '[data-act=start]', async (e, b) => {
    if (!await confirmBox(`Spustit fashion show? ${d.active.length} soutěžících se náhodně seřadí a vyvolá se první. Pak už to nejde vrátit.`, { ok: 'Spustit show' })) return
    act(b, () => rpc('fashion_start', { p_tournament: t.id }), 'Fashion show běží!')
  })
  on(box, 'click', '[data-act=next]', async (e, b) => {
    const miss = missing(cur)
    if (miss.length && !await confirmBox(`${cur.nick} ještě neohodnotili: ${miss.map(j => j.nick).join(', ')}. Vyvolat dalšího? Ohodnotit ho můžou i potom.`, { ok: 'Vyvolat dalšího' })) return
    act(b, () => rpc('fashion_next', { p_tournament: t.id }))
  })
  on(box, 'click', '[data-act=finish]', async (e, b) => {
    if (!await confirmBox('Ukončit hodnocení a vyhlásit výsledky? Otevři si TV – místa se odkryjí od 4. dolů, pak 3., 2. a 1. po 5 sekundách.', { ok: 'Vyhlásit' })) return
    act(b, () => rpc('fashion_finish', { p_tournament: t.id }))
  })
  on(box, 'click', '[data-act=close-vote]', async (e, b) => {
    if (!await confirmBox('Uzavřít hlasování? Kdo nehlasoval, nepočítá se.', { ok: 'Uzavřít' })) return
    act(b, () => rpc('fashion_close_vote', { p_tournament: t.id }))
  })
  on(box, 'click', '[data-boss]', async (e, b) => {
    const p = d.players.find(x => x.id === b.dataset.boss)
    if (!await confirmBox(html`Vybrat za bosse vítěze <b>${p.nick}</b>?`, { ok: 'Vybrat', danger: true })) return
    act(b, () => rpc('fashion_boss_pick', { p_tournament: t.id, p_reg: p.id }))
  })
  on(box, 'click', '[data-drop]', (e, b) => act(b, () => rpc('fashion_drop', { p_tournament: t.id, p_reg: b.dataset.drop, p_drop: b.dataset.v === '1' })))
  on(box, 'click', '[data-unjudge]', async (e, b) => {
    if (!await confirmBox('Odebrat design judge?', { ok: 'Odebrat', danger: true })) return
    act(b, () => rpc('fashion_judge_leave', { p_tournament: t.id, p_user: b.dataset.unjudge }), 'Odebráno.')
  })
  on(box, 'click', '[data-act=walkin]', (e, b) => busy(b, () => walkinModal(d, reload)))
  on(box, 'click', '[data-act=cancel]', async () => {
    if (!await confirmBox('Opravdu zrušit? Hráči uvidí, že se nekoná.', { ok: 'Zrušit', danger: true })) return
    try { await rpc('cancel_tournament', { p_tournament: t.id }); toast('Zrušeno.', 'ok'); reload() } catch (e) { toast(errMsg(e), 'err') }
  })
  on(box, 'click', '[data-act=delete]', async () => {
    if (!await confirmBox('Smazat včetně všech přihlášek? Nejde to vrátit.', { ok: 'Smazat', danger: true })) return
    try { await q(sb.from('tournaments').delete().eq('id', t.id)); toast('Smazáno.', 'ok'); location.hash = '#/' } catch (e) { toast(errMsg(e), 'err') }
  })
}

async function walkinModal(d, reload) {
  const cat = await loadParts()
  modal(html`
    <h2>Soutěžící bez telefonu</h2>
    <form class="stack" id="f-walk">
      <label class="f"><span>Nick</span><input class="input" name="nick" minlength="2" maxlength="24" required></label>
      ${deckEditor(null, d.t.fashion_beys)}
      <div class="row"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn primary grow">Přidat</button></div>
    </form>`, {
    onMount: (b, close) => {
      const getDeck = bindDeckEditor(b.querySelector('[data-deck]'), cat, { distinct: false })
      on(b, 'submit', '#f-walk', async (e, f) => {
        e.preventDefault()
        let deck
        try { deck = getDeck() } catch (err) { return toast(err.message, 'err') }
        await busy(f.querySelector('button.primary'), async () => {
          try { await rpc('add_walkin', { p_tournament: d.t.id, p_nick: formData(f).nick.trim(), p_deck: deck }); toast('Přidáno.', 'ok'); close(); reload() }
          catch (err) { toast(errMsg(err), 'err') }
        })
      })
    },
  })
}

// ────────────────────────────────────────────────────────────────
//  TV: molo, rozstřel, boss, vyhlášení
// ────────────────────────────────────────────────────────────────
export async function renderTV(main, [id]) {
  document.body.classList.add('tv')
  let d = await load(id)
  let timers = [], tick = null
  const clock = () => new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })

  const draw = () => {
    const { t, st, cur } = d
    timers.forEach(clearTimeout); timers = []; clearInterval(tick)
    let body, phase = 'Fashion show'
    if (t.status === 'registration') {
      phase = 'Přihlašování'
      body = html`<div class="fx-tv-wait"><div class="fx-tv-hanger">${raw(icon('hanger'))}</div>
        <h2>Fashion show brzy začne</h2>
        <p>${plural(d.active.length, 'soutěžící', 'soutěžící', 'soutěžících')} · ${plural(d.judges.length, 'design judge', 'design judge', 'design judge')}</p></div>`
    } else if (t.status === 'show' && st.phase === 'scoring' && cur) {
      const next = d.active.find(p => p.seed > cur.seed)
      phase = `Molo · ${cur.seed}. z ${d.players.filter(p => p.seed).length}`
      body = html`<div class="fx-tv-stage">
        <div class="fx-tv-lbl">Na molu</div>
        <div class="fx-tv-nick">${cur.nick}</div>
        ${cur.beys ? html`<div class="fx-tv-beys">${cur.beys.map(b => html`<span>${b}</span>`)}</div>` : ''}
        <div class="fx-tv-judges">${d.judges.map(j => html`<span class="${(cur.rated_by || []).includes(j.user_id) ? 'ok' : ''}"><i>${(cur.rated_by || []).includes(j.user_id) ? '✓' : '…'}</i>${j.nick}</span>`)}</div>
        ${next ? html`<div class="fx-tv-next">Další na řadě: <b>${next.nick}</b></div>` : html`<div class="fx-tv-next">Poslední na molu</div>`}
      </div>`
    } else if (t.status === 'show' && st.phase === 'tiebreak') {
      phase = 'Rozstřel'
      body = html`<div class="fx-tv-stage tie">
        <div class="fx-tv-lbl">Rozstřel o 1. místo</div>
        <div class="fx-tv-duel">${d.tie.map((p, i) => html`${i ? html`<i>×</i>` : ''}<span>${p.nick}</span>`)}</div>
        <div class="fx-tv-judges">${d.judges.map(j => html`<span class="${(d.b.voted || []).includes(j.user_id) ? 'ok' : ''}"><i>${(d.b.voted || []).includes(j.user_id) ? '✓' : '…'}</i>${j.nick}</span>`)}</div>
        <div class="fx-tv-next">Design judge hlasují</div></div>`
    } else if (t.status === 'show' && st.phase === 'boss') {
      phase = 'Boss of fashion'
      body = html`<div class="fx-tv-stage boss">
        <div class="fx-tv-lbl">Boss of fashion</div>
        <div class="fx-tv-nick">${d.judgeNick(st.boss)}</div>
        <div class="fx-tv-next">vybírá vítěze</div>
        <div class="fx-tv-duel">${d.tie.map((p, i) => html`${i ? html`<i>×</i>` : ''}<span>${p.nick}</span>`)}</div></div>`
    } else if (t.status === 'finished') {
      phase = 'Vyhlášení'
      body = revealView(d)
      const ra = revealAt(d)
      if (ra) {
        const next = [5, 10, 15].map(s => ra + s * 1000 - serverNow(d)).find(ms => ms > 0)
        if (next) timers.push(setTimeout(reload, next + 250))
        tick = setInterval(() => {
          const el = main.querySelector('[data-fx-count]')
          if (!el) return
          const left = Math.ceil((ra + Number(el.dataset.fxCount) * 1000 - serverNow(d)) / 1000)
          el.textContent = Math.max(0, left)
        }, 200)
      }
    } else body = html`<div class="fx-tv-wait"><h2>Akce byla zrušena</h2></div>`

    mount(main, html`
      <div class="tv-head"><h1>${t.name}</h1><div class="r">${phase} · ${clock()}</div></div>
      ${body}
      <a class="btn sm tv-exit" href="#/t/${t.id}">Zavřít TV</a>`)
  }

  let alive = true
  async function reload() { if (!alive) return; try { const nd = await load(id); if (alive) { d = nd; draw() } } catch (e) { console.error(e) } }
  draw()
  const off = liveChannel(id, reload)
  const clockTimer = setInterval(() => { const r = main.querySelector('.tv-head .r'); if (r) r.textContent = r.textContent.replace(/\d{1,2}:\d{2}$/, clock()) }, 15000)
  return () => { alive = false; off(); timers.forEach(clearTimeout); clearInterval(tick); clearInterval(clockTimer); document.body.classList.remove('tv') }
}

// vyhlášení: vlevo 4. místo a dál, vpravo pódium 2 · 1 · 3 (odkrývá se 3 → 2 → 1)
function revealView(d) {
  const ra = revealAt(d)
  const rest = d.players.filter(p => p.place >= 4).sort((a, b) => a.place - b.place)
  const at = (pl) => d.players.filter(p => p.place === pl)
  const nextPlace = [3, 2, 1].find(pl => !at(pl).length && ra && serverNow(d) < ra + REVEAL(pl) * 1000)
  const slot = (pl) => {
    const who = at(pl)
    const counting = pl === nextPlace
    const gone = !who.length && ra && serverNow(d) >= ra + (REVEAL(pl) + 1) * 1000   // dělené místo nad ním
    return html`<div class="fx-pod p${pl} ${who.length ? 'on' : ''}">
      <div class="fx-pod-who">${who.length ? who.map(p => html`<span>${p.nick}</span>`)
        : counting ? html`<span class="fx-count num" data-fx-count="${REVEAL(pl)}">${Math.max(0, Math.ceil((ra + REVEAL(pl) * 1000 - serverNow(d)) / 1000))}</span>`
        : html`<span class="q">${gone ? '–' : '?'}</span>`}</div>
      ${who.length && who[0].score ? html`<div class="fx-pod-pts num">${who[0].score.total} b.</div>` : ''}
      <div class="fx-pod-step"><b>${pl}</b>${pl === 1 ? html`<small>Vítěz fashion</small>` : ''}</div>
    </div>`
  }
  return html`<div class="fx-reveal ${rest.length ? '' : 'solo'}">
    ${rest.length ? html`<ol class="fx-rest">${rest.map(p => html`<li><b class="num">${p.place}.</b><span>${p.nick}</span>${p.score ? html`<em class="num">${p.score.total}</em>` : ''}</li>`)}</ol>` : ''}
    <div class="fx-podium">${slot(2)}${slot(1)}${d.active.length >= 3 ? slot(3) : ''}</div>
  </div>`
}
