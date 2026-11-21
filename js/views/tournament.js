// ════════════════════════════════════════════════════════════════
//  Detail turnaje / akce: můj status, hráči, swiss, pavouk, judge menu, TV
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, q, errMsg, canManage, ensureSession, refreshMe, askNotify } from '../supa.js'
import { html, raw, mount, on, formData, toast, modal, busy, confirmBox, qrSvg, qrPng, statusPill, fmtDate, fmtTime, pauseLeft, fmtLeft, finishLine, kindLabel } from '../ui.js'
import { regCheckPanel, regState, checkModal, scanModal } from '../regcheck.js'
import { computeStandings, matchLabel, qrPayload, nextPow2, phaseName, arenaQueue, busyRegs } from '../core.js'
import { renderManage } from './manage.js'
import { icon } from '../icons.js'
import * as Fashion from './fashion.js'
import * as Training from './training.js'
import { loadParts, deckEditor, bindDeckEditor } from '../parts.js'

const cfg = window.BBX_CONFIG

export async function load(id, { hist = true } = {}) {  // hist = historie bodů dohraných her (d.points)
  const [t, players, matches] = await Promise.all([
    q(sb.from('tournaments').select('*').eq('id', id).maybeSingle()),
    rpc('tournament_players', { p_tournament: id }),
    q(sb.from('matches').select('*').eq('tournament_id', id).order('stage').order('round').order('pos')),
  ])
  let myReg = null
  if (state.user && t) myReg = (await rpc('my_registration', { p_tournament: id }))?.[0] || null
  const pmap = new Map(players.map(p => [p.id, p]))
  const league = t?.league_id ? await q(sb.from('leagues').select('id,name').eq('id', t.league_id).maybeSingle()).catch(() => null) : null
  // prezence (jen pro judge / organizátora, ostatním RPC vrátí prázdno)
  let checkin = null
  if (t && t.kind === 'tournament' && t.status === 'registration' && state.user && !state.isAnon) {
    checkin = new Map((await rpc('checkin_list', { p_tournament: id }).catch(() => [])).map(x => [x.reg, x.checked_in_at]))
  }
  const points = hist && t?.kind === 'tournament' && t.status !== 'registration' ? await loadPoints(id, matches).catch(() => null) : null
  return { t, players, matches, myReg, pmap, checkin, league, points, busy: busyRegs(matches, players) }
}

// historie bodů dohraných her: match_id → [[souboje 1. hry], [2. hry], …]; znovu se stahuje jen po nové hře
let ptCache = { id: null, key: null, map: null }
async function loadPoints(id, matches) {
  const key = matches.map(m => m.p1_wins + m.p2_wins + (m.status === 'done' ? 'd' : '')).join()
  if (ptCache.id === id && ptCache.key === key) return ptCache.map
  const rows = await q(sb.from('games').select('match_id,game_no,points(seq,scorer_slot,pts,finish,p1_bey,p2_bey),matches!inner(tournament_id)')
    .eq('matches.tournament_id', id))
  const map = new Map()
  for (const g of rows.sort((a, b) => a.game_no - b.game_no)) {
    const list = (g.points || []).sort((a, b) => a.seq - b.seq).map(p => ({ slot: p.scorer_slot, pts: p.pts, finish: p.finish, p1_bey: p.p1_bey, p2_bey: p.p2_bey }))
    if (!map.has(g.match_id)) map.set(g.match_id, [])
    map.get(g.match_id).push(list)
  }
  ptCache = { id, key, map }
  return map
}

// souboje rozehrané hry (BBXST posílá matches.live_state v orientaci p1/p2)
export const liveBattles = (m) => m.status !== 'done' && m.live_state?.game === m.p1_wins + m.p2_wins
  ? (m.live_state.battles || []).map(b => ({ slot: b.slot, pts: b.pts, finish: b.finish, p1_bey: b.p1_bey, p2_bey: b.p2_bey })) : null
export const ptLabel = (b) => b.pts === 2 && b.finish === 'over' ? '+2 O' : b.pts === 2 && b.finish === 'burst' ? '+2 B' : `+${b.pts}`
const ptTitle = { spin: 'Spin finish', over: 'Over finish', burst: 'Burst finish', xtreme: 'Xtreme finish' }
// řádek žetonů: body hráče vlevo (u středu) a vpravo, v pořadí, jak padaly; remíza = „R“ u obou (posun beyů)
export function ptHist(battles, label = '') {
  if (!battles?.length) return ''
  const side = (n) => battles.filter(b => b.slot === n || !b.slot)
    .map(b => b.slot ? html`<span class="pt pt${b.pts}" title="${ptTitle[b.finish] || ''}">${ptLabel(b)}</span>`
      : html`<span class="pt ptr" title="Remíza">R</span>`)
  return html`<div class="pt-hist">${label ? html`<span class="pt-g">${label}</span>` : ''}<div class="l">${side(1)}</div><div class="r">${side(2)}</div></div>`
}
// všechny hry zápasu: dohrané z DB + rozehraná (u BO3 s číslem hry)
function matchHist(d, m) {
  const games = [...(d.points?.get(m.id) || [])]
  const live = liveBattles(m)
  if (live) games.push(live)
  const multi = m.best_of > 1 && games.length > 1
  return games.map((g, i) => ptHist(g, multi ? `${i + 1}.` : ''))
}

// fronta zápasů na aréně (rozehraný první, hráč, který judguje, o místo níž)
export const queueOf = (d, arena) => arenaQueue(d.matches, arena, d.busy)

export function liveChannel(id, onChange) {
  let timer = null
  const bump = () => { clearTimeout(timer); timer = setTimeout(onChange, 350) }
  const ch = sb.channel('t-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${id}` }, bump)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, bump)
    .subscribe()
  return () => { clearTimeout(timer); sb.removeChannel(ch) }
}

const running = (t) => t.status === 'swiss' || t.status === 'topcut'
export const paused = (t) => pauseLeft(t?.pause_until) > 0
// pruh „pauza“ s odpočtem (Můj Status, Swiss i ostatní záložky turnaje)
export const pauseBanner = (t) => paused(t) ? html`<div class="pause-banner" data-countdown-box role="status">
  <span class="pb-ico" aria-hidden="true">⏸</span>
  <span class="pb-txt"><b>Pořadatel vyhlásil pauzu</b><small>Pokračujeme za</small></span>
  <span class="pb-time num" data-countdown="${t.pause_until}">${fmtLeft(t.pause_until)}</span>
</div>` : ''
const nickOf = (d, reg) => d.pmap.get(reg)?.nick || '?'

function tabsFor(d) {
  const { t } = d
  // [klíč, popisek, ikona]
  const tabs = [['me', d.myReg ? 'Můj Status' : t.kind === 'event' ? 'Přihlásit se' : 'Registrace', d.myReg ? 'ticket' : 'pen']]
  // po startu je seznam hráčů v tabulce swissu / deathmatche, záložka Hráči se už neukazuje
  const hasTable = t.kind === 'tournament' && t.status !== 'registration' && d.matches.some(m => m.stage === 'swiss')
  if (!hasTable) tabs.push(['players', `Hráči (${d.players.filter(p => p.status === 'active').length})`, 'users'])
  if (hasTable) tabs.push(['swiss', phaseName(t), 'board'])
  if (d.matches.some(m => m.stage !== 'swiss')) tabs.push(['bracket', t.top_cut === 2 ? 'Finále' : 'Top cut', 'bracket'])
  if (t.kind === 'tournament' && (t.status === 'finished' || (canManage(t) && running(t)))) tabs.push(['report', 'Vyhodnocení', 'bars'])
  if (t.kind === 'tournament' && running(t) && (state.level >= 1 || canManage(t))) tabs.push(['judge', 'Judge menu', 'scale'])
  if (canManage(t)) tabs.push(['manage', 'Řízení', 'gear'])
  return tabs
}

// fashion show má vlastní pohled
const kindOf = (id) => q(sb.from('tournaments').select('kind,event_type').eq('id', id).maybeSingle())
const fashionKind = async (id) => Fashion.isFashion(await kindOf(id))

export async function render(main, [id, tabArg]) {
  const k = await kindOf(id)
  if (Fashion.isFashion(k)) return Fashion.render(main, [id, tabArg])
  if (Training.isTraining(k)) return Training.render(main, [id, tabArg])
  let d = await load(id)
  if (!d.t) { mount(main, html`<div class="empty"><h2>Turnaj nenalezen</h2><a class="btn" href="#/">Zpět</a></div>`); return }

  const pickDefault = () => {
    if (d.myReg) return 'me'
    if (canManage(d.t) && d.t.status !== 'finished') return 'manage'
    if (d.t.status === 'finished' && d.t.kind === 'tournament') return 'report'
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
      <header class="t-head">
        <div class="row between wrap">${statusPill(t)}
          <span class="row" style="gap:8px">
          ${t.kind === 'tournament' && t.status === 'finished' ? html`<button class="btn sm primary" data-share>Sdílet výsledky</button>` : ''}
          ${t.kind === 'tournament' && t.status !== 'registration' ? html`<a class="btn sm ghost btn-ico" href="#/t/${t.id}/tv">${raw(icon('tv'))}TV rozpis</a>` : ''}
          ${t.kind === 'tournament' && t.status !== 'registration' ? html`<a class="btn sm btn-ico btn-live" href="#/t/${t.id}/live">${raw(icon('live'))}Živě</a>` : ''}</span></div>
        <h1 style="margin-top:10px">${t.name}</h1>
        <div class="meta">
          ${t.starts_at ? html`<span>🗓 ${fmtDate(t.starts_at)}, ${fmtTime(t.starts_at)}${t.ends_at ? `–${fmtTime(t.ends_at)}` : ''}</span>` : ''}
          ${t.event_type === 'meeting' && t.meeting_mode === 'online'
            ? html`<span>🌐 Online${/^https?:\/\//i.test(t.location || '') ? html` · <a class="meet-link" href="${t.location}" target="_blank" rel="noopener noreferrer">Připojit se</a>` : ''}</span>`
            : t.location ? html`<span>📍 ${t.location}</span>` : ''}
          ${t.visibility === 'staff' ? html`<span class="vis-tag" style="color:var(--warn)">🔒 Jen pro organizátory</span>` : ''}
          ${t.kind === 'tournament' ? html`<span>⚔ ${t.format === 'deathmatch' ? `Deathmatch${t.status !== 'registration' ? ` (${t.swiss_rounds} kol)` : ''}` : `${t.swiss_rounds} kol swiss`}${t.top_cut ? (t.top_cut === 2 ? ', finále' : `, top ${t.top_cut}`) : ''}${t.unique_parts ? ' · díly se neopakují' : ''}${t.rated === false ? ' · bez ratingu' : ''}</span>` : html`<span>${kindLabel(t)}</span>`}
          ${d.league ? html`<a class="lg-tag" href="#/l/${d.league.id}">🏆 ${d.league.name}</a>` : ''}
          ${t.status === 'swiss' ? html`<span style="color:var(--bolt)">Kolo ${t.current_round} z ${t.swiss_rounds}</span>` : ''}
        </div>
        ${t.description ? html`<p class="desc">${t.description}</p>` : ''}
      </header>
      ${pauseBanner(t)}
      <nav class="tabs t-nav" role="tablist" aria-label="Turnaj">${tabs.map(([k, l, ico]) => html`<a href="#/t/${t.id}/${k}" class="${k === tab ? 'on' : ''}" role="tab" aria-selected="${k === tab}"><span class="ico" aria-hidden="true">${raw(icon(ico))}</span><span class="lb">${l}</span></a>`)}</nav>
      <section id="tab"></section>`)
    const box = main.querySelector('#tab')
    const ctx = { d, reload, draw }
    ;({ me: tabMe, players: tabPlayers, swiss: tabSwiss, bracket: tabBracket, judge: tabJudge, manage: renderManage, report: tabReport }[tab] || tabMe)(box, ctx)
  }

  // po odchodu z pohledu (jiná záložka / stránka) už nic nepřekreslovat
  let alive = true
  let busyReload = false, again = false
  async function reload() {
    if (!alive) return
    if (busyReload) { again = true; return }
    busyReload = true
    try { const nd = await load(id); if (alive) { d = nd; draw() } } catch (e) { console.error(e) }
    busyReload = false
    if (again) { again = false; reload() }
  }

  draw()
  on(main, 'click', '[data-share]', () => import('../share.js').then(m => m.shareResultsModal(d)))
  const off = liveChannel(id, () => {
    // nepřekresluj, když má uživatel rozepsaný formulář
    if (main.querySelector('form[data-keep]') && document.activeElement?.closest('form[data-keep]')) return
    reload()
  })
  const onMine = () => reload()
  window.addEventListener('bbx:my-match', onMine)
  document.body.classList.add('has-tnav')
  const onPauseOver = () => { if (alive) draw() }
  window.addEventListener('bbx:countdown-over', onPauseOver)
  return () => { alive = false; off(); window.removeEventListener('bbx:my-match', onMine); window.removeEventListener('bbx:countdown-over', onPauseOver); document.body.classList.remove('has-tnav') }
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

  // pořadí v aréně: dohrané zápasy zmizí, můj je zvýrazněný
  const aq = called ? queueOf(d, current.arena) : []
  const myPos = aq.findIndex(m => m.id === current?.id)
  const myStand = !isEv && running(t) && myReg.status === 'active' ? standingsFor(d).find(s => s.id === myReg.id) : null

  let arenaBlock
  if (called) {
    arenaBlock = html`<div class="lbl">Tvoje aréna</div>
      <div class="big">${current.arena}</div>
      <div class="vs">proti ${opp}</div>
      <div class="faint small">${current.status === 'live' ? 'Hraješ teď' : myPos === 0 ? 'Jsi na řadě' : `${myPos + 1}. na řadě`} · ${matchLabel(current, t.top_cut, t.format)}${current.best_of > 1 ? ` · BO${current.best_of} (${current.p1_reg === myReg.id ? current.p1_wins : current.p2_wins}:${current.p1_reg === myReg.id ? current.p2_wins : current.p1_wins})` : ''}</div>`
  } else if (myReg.status === 'dropped') {
    arenaBlock = html`<div class="lbl">Z turnaje jsi odstoupil.</div>`
  } else if (t.status === 'registration') {
    arenaBlock = html`<div class="lbl">Arénu se dozvíš po startu turnaje.</div>
      ${myReg.checked_in_at
        ? html`<div class="pass-checkin on">✓ Registrace zkontrolována ${fmtTime(myReg.checked_in_at)}</div>`
        : html`<div class="pass-checkin">Na místě ukaž QR kód organizátorovi – zkontroluje tvoje beyblady.</div>`}`
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
        <div class="pass-label">${isEv ? 'Přihláška na akci' : 'Můj Status'}</div>
        <div class="pass-nick">${myReg.nick}</div>
        ${beys.length ? html`<div class="pass-beys">${beys.map(b => html`<span>${b}</span>`)}</div>` : ''}
      </div>
      ${isEv ? '' : html`
      <div class="pass-tear"></div>
      <div class="pass-bottom">
        <div class="pass-arena">${arenaBlock}</div>
        ${called ? html`<div class="pass-queue">
          <div class="lbl">Pořadí v aréně</div>
          <ol>${aq.map((m, i) => {
            const mine = m.id === current.id, live = m.status === 'live'
            return html`<li class="${mine ? 'mine' : ''} ${live ? 'live' : ''}">
              <span class="pq-n">${i + 1}.</span>
              <span class="pq-who">${nickOf(d, m.p1_reg)} <i>vs</i> ${nickOf(d, m.p2_reg)}</span>
              ${live ? html`<span class="pq-sc num">${m.live_p1 != null ? `${m.live_p1}:${m.live_p2}` : 'hraje'}</span>` : ''}
            </li>`
          })}</ol>
        </div>` : ''}
      </div>
      ${myStand ? html`<div class="pass-stand">
        <span>Průběžné pořadí</span><b class="num">${myStand.rank}.</b>
        <small>${myStand.main} HB · ${myStand.aux1} PB · ${myStand.aux2} PB2</small>
      </div>` : ''}
      <div class="pass-qrrow">
        <div class="pass-qr" aria-label="QR kód pro rozhodčího">${qrSvg(qrText)}</div>
        <div class="small muted">QR kód ukaž judgovi, když si tě bude chtít načíst. Kdo, s kým a kde hraje, najdeš nahoře.</div>
      </div>`}
    </div>
    <div class="row wrap" style="margin-top:12px">
      ${!isEv && t.status !== 'registration' ? html`<button class="btn sm primary btn-ico" data-act="deck">${raw(icon('bars'))}Můj deck</button>` : ''}
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
  on(box, 'click', '[data-act=deck]', (e, b) => busy(b, () => deckModal(t)))
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
        ${t.unique_parts ? html`<div class="notice warn small">V tomhle turnaji se žádný díl nesmí v decku opakovat – ani blade, ratchet, bit, ani díly CX.</div>` : ''}
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

export function guestPrompt() {
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
  const liveNow = !done && m.live_p1 != null
  const score = m.is_bye ? 'bye' : liveNow ? `${m.live_p1} : ${m.live_p2}` : !done && !started ? 'vs'
    : m.best_of > 1 ? `${m.p1_wins} : ${m.p2_wins}` : `${m.p1_score} : ${m.p2_score}`
  const mine = meReg && (m.p1_reg === meReg || m.p2_reg === meReg)
  return html`
    <div class="match ${mine ? 'mine' : ''}">
      <div class="side l ${w1 ? 'win' : done && !m.is_bye ? 'lose' : ''}"><div class="nick">${p1}</div></div>
      <div class="score">${score}</div>
      <div class="side r ${w2 ? 'win' : done && !m.is_bye ? 'lose' : ''}"><div class="nick">${p2}</div></div>
      ${m.is_bye ? '' : matchHist(d, m)}
      <div class="info"><span>${matchLabel(m, d.t.top_cut, d.t.format)}${m.best_of > 1 ? ` · BO${m.best_of}${!done && started ? ` (hry ${m.p1_wins}:${m.p2_wins})` : ''}` : ''}</span>
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

  // organizátor v registraci: kontrola registrací (QR + beyblady), barevný stav u každého hráče
  const check = mgr && t.kind === 'tournament' && t.status === 'registration' && d.checkin
  mount(box, list.length ? html`
    ${check ? regCheckPanel(d) : ''}
    <div class="list ${check ? 'rc-list' : ''}">${list.map(p => html`
      <div class="li ${check ? `rc-row rc-${regState(p, d.checkin)}` : ''}" ${check ? html`data-check="${p.id}" role="button" tabindex="0"` : ''} style="${p.status === 'dropped' && !check ? 'opacity:.5' : ''}">
        ${t.status === 'finished' && p.final_place ? html`<span class="place p${p.final_place}">${p.final_place}.</span>` : ''}
        <span class="av">${p.avatar || '👤'}</span>
        <div class="grow">
          <div class="ellipsis" style="font-weight:600">${p.has_account ? html`<a href="#/p/${p.user_id}">${p.nick}</a>` : p.nick}
            ${p.seed ? html`<span class="faint small"> · seed ${p.seed}</span>` : ''}
            ${p.status === 'dropped' ? html`<span class="faint small"> · ${check ? 'vyřazen' : 'odstoupil'}</span>` : ''}
            ${check && p.status !== 'dropped' ? html`<span class="small rc-tag"> · ${d.checkin.get(p.id) ? '✓ zkontrolováno' : 'čeká'}</span>` : ''}</div>
          ${p.bey1 ? html`<div class="small muted ellipsis">${[p.bey1, p.bey2, p.bey3].filter(Boolean).join(' · ')}</div>`
                   : html`<div class="small faint">${p.region || (p.has_account ? '' : 'host')}</div>`}
        </div>
        ${mgr ? html`<button class="btn sm ghost" data-menu="${p.id}" aria-label="Akce s hráčem">⋯</button>` : ''}
      </div>`)}</div>
    ${t.kind === 'tournament' && t.status === 'registration' ? html`<p class="hint">Beyblady ostatních hráčů se zveřejní po skončení turnaje.</p>` : ''}`
    : html`<div class="empty">Zatím se nikdo nepřihlásil.</div>`)

  on(box, 'click', '[data-rc=scan]', () => scanModal(d, reload))
  on(box, 'click', '[data-check]', (e, el) => {
    if (e.target.closest('[data-menu], a')) return
    checkModal(d, d.pmap.get(el.dataset.check), reload)
  })
  on(box, 'keydown', '[data-check]', (e, el) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); checkModal(d, d.pmap.get(el.dataset.check), reload) }
  })
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
    <p class="hint">${t.format === 'deathmatch' ? 'Každý s každým. ' : ''}Pořadí: hlavní body → pomocné body → druhé pomocné → vzájemný zápas → los.${cut ? ` Žlutá čára = hranice ${cut === 2 ? 'finále' : `top ${cut}`}.` : ''}</p>
    ${rounds.map(r => html`
      <h2>Kolo ${r}</h2>
      <div class="list">${d.matches.filter(m => m.stage === 'swiss' && m.round === r)
        .sort((a, b) => (a.is_bye - b.is_bye) || (a.status === 'done') - (b.status === 'done') || a.pos - b.pos)
        .map(m => matchRow(d, m, myReg?.id))}</div>`)}`)
}

// ────────────────────────────────────────────────────────────────
//  VYHODNOCENÍ – nejhranější díly a nejúspěšnější buildy
// ────────────────────────────────────────────────────────────────
async function tabReport(box, { d }) {
  const { t } = d
  mount(box, html`<div class="spinner" aria-label="Počítám vyhodnocení"></div>`)
  let r
  try { r = await rpc('tournament_report', { p_tournament: t.id }) }
  catch (e) { mount(box, html`<div class="notice err">${errMsg(e)}</div>`); return }
  if (!r.battles) {
    mount(box, html`<div class="notice">Turnaj nemá zapsané souboje s beyi (výsledky se zadávaly ručně), takže není z čeho dělat vyhodnocení.</div>`)
    return
  }
  const kinds = [['blade', 'Blade'], ['ratchet', 'Ratchet'], ['bit', 'Bit']]
  const who = (p) => p.user_id ? html`<a href="#/p/${p.user_id}">${p.nick}</a>` : p.nick
  mount(box, html`
    ${t.status !== 'finished' ? html`<div class="notice small">Průběžný náhled pro organizátora – hráči vyhodnocení uvidí po ukončení turnaje.</div>` : ''}
    <p class="muted" style="margin-top:4px">${r.battles} soubojů · ${r.points} bodů</p>
    <h2>Nejhranější díly</h2>
    <div class="rep-parts">${kinds.map(([k, label]) => {
      const items = r.parts[k] || []
      const [top, ...rest] = items
      return html`<div class="card rep-part">
        <div class="rep-kind">${label}</div>
        ${top ? html`<div class="rep-top">${top.name}</div>
          <div class="small muted">${top.battles} soubojů · ${top.players === 1 ? '1 hráč' : `${top.players} hráči`}</div>
          ${rest.length ? html`<ol class="rep-rest" start="2">${rest.map(x => html`<li><span class="ellipsis">${x.name}</span><span class="faint">${x.battles}</span></li>`)}</ol>` : ''}`
          : html`<div class="faint">—</div>`}
      </div>`
    })}</div>
    <h2>Top 3 buildy podle bodů</h2>
    <div class="stack">${r.builds.map((b, i) => html`
      <div class="card rep-build">
        <div class="rep-rank r${i + 1}">${i + 1}</div>
        <div class="grow" style="min-width:0">
          <div class="rep-name">${b.bey}</div>
          <div class="small muted">${b.battles} soubojů · ${b.wins} výher (${Math.round(100 * b.wins / b.battles)} %)</div>
          <div class="rep-players">${b.players.map(p => html`<span class="chip">${who(p)} <b>${p.points}</b></span>`)}</div>
        </div>
        <div class="rep-pts"><b>${b.points}</b><small>bodů</small></div>
      </div>`)}</div>
    <p class="hint">Body = co build nasbíral v soubojích (Spin 1, Over/Burst 2, X-treme 3). Počítají se jen souboje zapsané judgem v BBXST.</p>`)
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
    const score = m.best_of > 1 ? m[`p${n}_wins`] : m.status === 'live' && m.live_p1 != null ? m[`live_p${n}`] : m[`p${n}_score`]
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
      ${col(t.top_cut === 2 ? 'Finále' : 'Grand finále', br.filter(m => m.stage === 'gf'))}
    </div></div>
    ${lbR.length ? html`<h2>Losers</h2>
    <div class="bracket-wrap"><div class="bracket">
      ${lbR.map(r => col(matchLabel({ stage: 'lb', round: r }, N), br.filter(m => m.stage === 'lb' && m.round === r)))}
    </div></div>` : ''}`)
}

// ────────────────────────────────────────────────────────────────
//  JUDGE MENU – arény, kdo je řídí, výběr zápasu
//  Judge patří jen k rozehranému zápasu (matches.judge_id): připojí se přes
//  Rozhodovat, po odeslání výsledku / PASS JUDGE / uvolnění je volný.
// ────────────────────────────────────────────────────────────────
async function tabJudge(box, { d, reload }) {
  const { t } = d
  const me = state.user?.id
  const manager = canManage(t)
  const ids = [...new Set(d.matches.filter(m => m.judge_id && m.status === 'live').map(m => m.judge_id))]
  const nicks = ids.length ? await q(sb.from('profiles').select('id,nick').in('id', ids)) : []
  const nickMap = new Map(nicks.map(n => [n.id, n.nick]))
  const arenas = Array.from({ length: t.arena_count }, (_, i) => i + 1)
  const bbxst = (m) => `${cfg.bbxstUrl}?match=${m.id}&t=${t.id}`
  const mineLive = (a) => queueOf(d, a).some(m => m.status === 'live' && m.judge_id === me)
  // arény, kde právě judguju, první
  const order = arenas.slice().sort((a, b) => mineLive(b) - mineLive(a) || a - b)
  const myMatch = d.myReg && d.matches.find(m => m.status !== 'done' && (m.p1_reg === d.myReg.id || m.p2_reg === d.myReg.id))

  mount(box, html`
    <p class="muted">Vyber zápas, který budeš řídit – BBXST se otevře v judge módu s načtenými hráči. Po odeslání výsledku jsi zase volný.</p>
    ${myMatch && d.busy.has(d.myReg.id) ? html`<div class="notice warn small">Judguješ a sám máš zápas na aréně ${myMatch.arena} – dokud řídíš jiný zápas, posouvá se tvůj o místo níž.</div>` : ''}
    <div class="stack" style="margin-top:12px">
      ${order.map(a => {
        const qa = queueOf(d, a), cur = qa[0]
        const live = cur?.status === 'live', free = live && !cur.judge_id
        const mine = live && cur.judge_id === me
        const other = live && cur.judge_id && !mine
        const judgeNick = live && cur.judge_id ? nickMap.get(cur.judge_id) || '?' : null
        const playsHere = d.myReg && cur && (cur.p1_reg === d.myReg.id || cur.p2_reg === d.myReg.id)
        return html`<div class="card arena-card ${mine ? 'mine' : ''} ${live ? 'live' : ''} ${free ? 'free' : ''}">
          <div class="arena-no num">${a}</div>
          <div class="grow" style="min-width:0">
            <div class="small muted">${mine ? 'Řídíš ty' : judgeNick ? `Judge: ${judgeNick}` : free ? 'Bez judge' : 'Volná aréna'}${qa.length > 1 ? ` · čeká ${qa.length - 1}` : ''}</div>
            ${cur ? html`
              <div class="ellipsis" style="font-weight:600;font-size:17px"><span class="p1c">${nickOf(d, cur.p1_reg)}</span> <span class="faint">vs</span> <span class="p2c">${nickOf(d, cur.p2_reg)}</span></div>
              <div class="small faint ellipsis">${matchLabel(cur, t.top_cut, t.format)}${cur.best_of > 1 ? ` · BO${cur.best_of} (${cur.p1_wins}:${cur.p2_wins})` : ''}${live ? (free ? '' : ' · hraje se') : ' · na řadě'}</div>
              ${free ? html`<div class="small arena-free">Rozehráno – čeká na judge</div>` : ''}`
              : html`<div class="faint">Teď tu nic nečeká</div>`}
          </div>
          ${live && cur.live_p1 != null ? html`<div class="arena-sc num">${cur.live_p1}<i>:</i>${cur.live_p2}</div>` : ''}
          <div class="arena-actions">
            ${cur && !playsHere ? html`<button class="btn primary sm" data-go="${cur.id}">${mine ? 'Pokračovat' : other ? 'Převzít' : free ? 'Navázat' : 'Rozhodovat'}</button>` : ''}
            ${live && cur.judge_id && (mine || manager) ? html`<button class="btn ghost sm" data-release="${cur.id}">${mine ? 'Uvolnit' : 'Uvolnit judge'}</button>` : ''}
          </div>
        </div>`
      })}
    </div>`)

  on(box, 'click', '[data-go]', (e, b) => {
    const m = d.matches.find(x => x.id === b.dataset.go)
    if (m) location.href = bbxst(m)
  })
  on(box, 'click', '[data-release]', async (e, b) => {
    const m = d.matches.find(x => x.id === b.dataset.release)
    if (!m) return
    const own = m.judge_id === me
    if (!await confirmBox(own ? 'Uvolnit se z tohoto zápasu? Skóre zůstane a zápas převezme jiný judge.'
      : `Uvolnit judge ${nickMap.get(m.judge_id) || ''} ze zápasu ${nickOf(d, m.p1_reg)} vs ${nickOf(d, m.p2_reg)}? Rozehrané skóre zůstane.`, { ok: 'Uvolnit' })) return
    await busy(b, async () => {
      try { await rpc('pass_match', { p_match: m.id }); toast('Uvolněno – zápas čeká na judge.', 'ok'); reload() }
      catch (err) { toast(errMsg(err), 'err') }
    })
  })
}

// ────────────────────────────────────────────────────────────────
//  TV ROZPIS (nahrazuje BBX_watchTV)
// ────────────────────────────────────────────────────────────────
export async function renderTV(main, [id]) {
  const k = await kindOf(id)
  if (Fashion.isFashion(k)) return Fashion.renderTV(main, [id])
  if (Training.isTraining(k)) return Training.renderTV(main, [id])
  document.body.classList.add('tv')
  let d = await load(id, { hist: false })
  const clock = () => new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })

  const draw = () => {
    const { t } = d
    // v top cutu / finále se prázdné arény neukazují
    const arenas = Array.from({ length: t.arena_count }, (_, i) => i + 1).map(a => ({ a, q: queueOf(d, a) }))
      .filter(x => t.status !== 'topcut' || x.q.length)
    const anyOpen = arenas.some(x => x.q.length)
    // série BO3: číslo hry a stav výher (modrá : červená)
    const series = (m) => m.best_of > 1 ? html`<span class="tv-series"><em>Hra ${Math.min(m.p1_wins + m.p2_wins + 1, m.best_of)}</em><span><u class="l">${m.p1_wins}</u><i>:</i><u class="r">${m.p2_wins}</u></span></span>` : ''
    const phase = t.status === 'swiss' ? `${phaseName(t)} · kolo ${t.current_round}/${t.swiss_rounds}` : t.status === 'topcut' ? (t.top_cut === 2 ? 'Finále' : `Top ${t.top_cut}`) : t.status === 'finished' ? 'Konec turnaje' : 'Registrace'
    // na šířku se všechno vejde na jednu obrazovku (mřížka podle počtu arén), na výšku pod sebe
    const land = landscape()
    const grid = land ? fitGrid(arenas.length) : null
    const maxNext = !land ? 99 : grid.rows <= 1 ? 6 : grid.rows === 2 ? 3 : 2
    let body
    if (anyOpen) {
      body = html`<div class="tv-arenas ${arenas.length === 1 ? 'one' : ''}" ${grid ? html`style="--cols:${grid.cols};--rows:${grid.rows}"` : ''}>${arenas.map(({ a, q: qa }) => {
        const [cur, ...all] = qa
        const rest = all.slice(0, maxNext), more = all.length - rest.length
        return html`<section class="tv-arena ${cur?.status === 'live' ? 'live' : ''} ${cur ? '' : 'idle'}">
          <div class="tv-ano" aria-label="aréna ${a}">${a}</div>
          <div class="tv-rows">
            ${cur ? html`<div class="tv-now">
              <span class="n l">${nickOf(d, cur.p1_reg)}</span>
              ${cur.live_p1 != null
                ? html`<span class="sc"><b>${cur.live_p1}<i>:</i>${cur.live_p2}</b>${series(cur)}</span>`
                : html`<span class="vs">${cur.status === 'live' ? 'hraje' : 'na řadě'}${cur.status === 'live' ? series(cur) : ''}</span>`}
              <span class="n r">${nickOf(d, cur.p2_reg)}</span>
              ${ptHist(liveBattles(cur))}
            </div>` : html`<div class="tv-free">volno</div>`}
            ${rest.map((m, i) => html`<div class="tv-next"><span class="i">${i + 2}.</span><span class="n l">${nickOf(d, m.p1_reg)}</span><span class="vs">vs</span><span class="n r">${nickOf(d, m.p2_reg)}</span></div>`)}
            ${more > 0 ? html`<div class="tv-more">+ ${more} ${more === 1 ? 'další zápas' : more <= 4 ? 'další zápasy' : 'dalších zápasů'}</div>` : ''}
          </div>
        </section>`
      })}</div>`
    } else {
      const st = standingsFor(d).slice(0, 8)
      body = html`<div class="card" style="max-width:900px;margin:0 auto;font-size:clamp(16px,1.6vw,24px)">
        <h2 style="margin-top:0">${t.status === 'finished' ? 'Konečné pořadí' : 'Čekáme na další kolo – průběžné pořadí'}</h2>
        <table class="standings"><tbody>${(t.status === 'finished'
          ? d.players.filter(p => p.final_place).sort((a, b) => a.final_place - b.final_place).slice(0, 8).map(p => html`<tr><td>${p.final_place}.</td><td>${p.nick}</td><td></td></tr>`)
          : st.map(s => html`<tr><td>${s.rank}</td><td>${s.nick}</td><td><b>${s.main}</b> HB · ${s.aux1} PB</td></tr>`))}</tbody></table></div>`
    }
    main.classList.toggle('tv-land', land); main.classList.toggle('tv-port', !land)
    mount(main, html`
      <div class="tv-head"><h1>${t.name}</h1><div class="r">${phase} · ${clock()}</div></div>
      ${paused(t) ? html`<div class="tv-pause" data-countdown-box><b>PAUZA</b><span class="num" data-countdown="${t.pause_until}">${fmtLeft(t.pause_until)}</span></div>` : ''}
      ${body}
      <a class="btn sm tv-exit" href="#/t/${t.id}">Zavřít TV</a>`)
  }

  // otočení / změna velikosti okna = jiný režim nebo jiná mřížka
  let lastKey = ''
  const onResize = () => {
    const key = landscape() ? `L${fitGrid(Math.max(1, d.t.arena_count)).cols}` : 'P'
    if (key !== lastKey) { lastKey = key; draw() }
  }
  draw()
  lastKey = landscape() ? `L${fitGrid(Math.max(1, d.t.arena_count)).cols}` : 'P'
  window.addEventListener('resize', onResize)
  const off = liveChannel(id, async () => { d = await load(id, { hist: false }); draw() })
  const tick = setInterval(() => { const r = main.querySelector('.tv-head .r'); if (r) r.textContent = r.textContent.replace(/\d{1,2}:\d{2}$/, clock()) }, 15000)
  // pojistka, kdyby realtime vypadl
  const poll = setInterval(async () => { try { d = await load(id, { hist: false }); draw() } catch {} }, 60000)
  window.addEventListener('bbx:countdown-over', draw)
  return () => { off(); clearInterval(tick); clearInterval(poll); window.removeEventListener('resize', onResize); window.removeEventListener('bbx:countdown-over', draw); document.body.classList.remove('tv') }
}

const landscape = () => innerWidth > innerHeight
// sloupce × řádky tak, aby karty arén měly zhruba poměr 16:9 a zbylo co nejmíň prázdných míst
function fitGrid(n) {
  const W = innerWidth, H = innerHeight * 0.85
  let best = { cols: 1, rows: n, score: Infinity }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const score = Math.abs(Math.log((W / cols) / (H / rows) / 1.7)) + (cols * rows - n) * 0.35
    if (score < best.score) best = { cols, rows, score }
  }
  return best
}

export { nickOf, running }

// ── Můj deck: jak si vede každý bey v tomhle turnaji ─────────────
async function deckModal(t) {
  let st
  try { st = await rpc('my_deck_stats', { p_tournament: t.id }) } catch (e) { return toast(errMsg(e), 'err') }
  modal(html`
    <h2>Můj deck</h2>
    <p class="muted" style="margin-top:-4px">${t.name} · souboje zapsané judgem v BBXST</p>
    <div class="stack deck-stats">${st.beys.map(b => html`
      <div class="card deck-bey">
        <div class="row between"><b class="deck-name">${b.bey}</b>
          <span class="small muted">${b.battles ? `${b.wins} V · ${b.draws} R · ${b.losses} P` : 'zatím nehrál'}</span></div>
        ${b.battles ? html`
        <div class="deck-pts"><span class="ok-t">+${b.points}</span> získal <span class="sep">·</span> <span class="bad-t">−${b.points_lost}</span> ztratil</div>
        <div class="deck-row"><span class="lbl">Dal endy</span><div class="fin-line">${finishLine(b.given)}</div></div>
        <div class="deck-row"><span class="lbl">Poražen</span><div class="fin-line">${finishLine(b.taken)}</div></div>
        ${b.beaten_by.length ? html`<div class="deck-row"><span class="lbl">Porazil ho</span>
          <div class="small">${b.beaten_by.map((o, i) => html`${i ? ', ' : ''}${o.bey} <span class="faint">×${o.n}</span>`)}</div></div>` : ''}` : ''}
      </div>`)}</div>
    <p class="hint">Počítají se jen souboje, u kterých judge vybral beye. Remízy body nemají.</p>
    <button class="btn ghost block" data-close style="margin-top:12px">Zavřít</button>`)
}
