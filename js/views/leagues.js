// ════════════════════════════════════════════════════════════════
//  Ligy (22) – seznam #/leagues, detail #/l/<id>
//  Zakládá hlavní admin, správce ligy přidává organizátory, kteří smí zakládat ligové turnaje.
//  Body: účast, postup do top cutu, 1.–4. místo (leagues.scoring). Bilance V–P a body +/−.
// ════════════════════════════════════════════════════════════════
import { rpc, state, errMsg } from '../supa.js'
import { html, mount, on, formData, toast, modal, busy, confirmBox, fmtDate, plural } from '../ui.js'
import { peopleTabs } from './communities.js'
import { roleLevel } from '../core.js'

export const SCORE_KEYS = [['participation', 'Účast'], ['topcut', 'Postup do top cutu'], ['p1', '1. místo'], ['p2', '2. místo'], ['p3', '3. místo'], ['p4', '4. místo']]
const DEFAULT_SCORING = { participation: 1, topcut: 1, p1: 5, p2: 3, p3: 2, p4: 1 }
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n)
const pts = (n) => n === 1 ? 'bod' : n >= 2 && n <= 4 ? 'body' : 'bodů'

export function scoringChips(sc = DEFAULT_SCORING) {
  return html`<div class="lg-rules">${SCORE_KEYS.map(([k, l]) => html`<span><b class="num">${k === 'participation' ? sc[k] : '+' + sc[k]}</b>${l}</span>`)}</div>`
}

export async function renderList(main, _p, ctx) {
  const list = await rpc('league_list')
  if (!ctx.isCurrent()) return
  const canCreate = state.level >= 4
  const card = (l) => html`<a class="card lg-card ${l.active ? '' : 'archived'} ${l.my_role ? 'mine' : ''}" href="#/l/${l.id}">
    <div class="row between" style="gap:8px;align-items:flex-start"><h3 class="ellipsis">${l.name}</h3>
      ${l.active ? (l.my_role ? html`<span class="pill ok">${l.my_role === 'manager' ? 'správce' : 'organizátor'}</span>` : '') : html`<span class="pill">archiv</span>`}</div>
    ${l.description ? html`<p class="small muted clamp2">${l.description}</p>` : ''}
    ${l.leader ? html`<div class="lg-leader"><span class="av">${l.leader.avatar || '🌀'}</span><span class="grow ellipsis"><small class="faint">vede</small> ${l.leader.nick}</span><b class="num">${l.leader.points}</b></div>` : ''}
    <div class="small faint">${plural(Number(l.finished), 'odehraný turnaj', 'odehrané turnaje', 'odehraných turnajů')}${Number(l.tournaments) > Number(l.finished) ? ` · ${Number(l.tournaments) - Number(l.finished)} v plánu` : ''} · ${plural(Number(l.players), 'hráč', 'hráči', 'hráčů')}${l.manager ? ` · správce ${l.manager.nick}` : ''}</div>
  </a>`
  const active = list.filter(l => l.active), old = list.filter(l => !l.active)
  mount(main, html`
    ${peopleTabs('leagues')}
    <div class="row between wrap" style="gap:12px;margin-top:14px">
      <h1>Ligy</h1>
      ${canCreate ? html`<button class="btn primary sm" data-act="new">+ Liga</button>` : ''}
    </div>
    <p class="muted" style="margin-top:4px">Body ze všech ligových turnajů. Počítají se jen skončené turnaje.</p>
    ${active.length ? html`<div class="comm-grid" style="margin-top:14px">${active.map(card)}</div>`
      : html`<div class="empty" style="margin-top:14px">Zatím tu žádná liga není.${canCreate ? ' Založ první.' : ''}</div>`}
    ${old.length ? html`<h2>Archiv</h2><div class="comm-grid">${old.map(card)}</div>` : ''}`)
  on(main, 'click', '[data-act=new]', () => leagueForm(null, (id) => { location.hash = `#/l/${id}` }))
}

function leagueForm(l, done) {
  const sc = { ...DEFAULT_SCORING, ...(l?.scoring || {}) }
  modal(html`
    <h2>${l ? 'Upravit ligu' : 'Nová liga'}</h2>
    <form class="stack" id="f-league">
      <label class="f"><span>Název</span><input class="input" name="name" minlength="2" maxlength="60" required value="${l?.name || ''}" placeholder="Pardubická liga – zima 2026"></label>
      <label class="f"><span>Popis</span><textarea class="input" name="description" rows="3" maxlength="1000" placeholder="Pro koho je, kdy začíná a končí, co se vyhrává…">${l?.description || ''}</textarea></label>
      <fieldset class="lg-score-f"><legend>Bodování</legend>
        ${SCORE_KEYS.map(([k, lbl]) => html`<label><span>${lbl}</span><input class="input num" type="number" min="0" max="100" step="1" name="${k}" value="${sc[k]}" required></label>`)}
      </fieldset>
      <p class="hint">Body za umístění se přičítají k bodům za účast a postup. Vítěz s top cutem tak má ${sc.participation + sc.topcut + sc.p1}.</p>
      ${l ? html`<label class="check"><span>Liga je aktivní <span class="faint small">· archivovaná zůstane vidět, ale nové turnaje do ní nejdou</span></span><input type="checkbox" name="active" ${l.active ? 'checked' : ''}></label>` : ''}
      <div class="row"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn primary grow">${l ? 'Uložit' : 'Založit ligu'}</button></div>
    </form>`, {
    onMount: (b, close) => on(b, 'submit', '#f-league', async (e, f) => {
      e.preventDefault()
      const d = formData(f)
      const scoring = Object.fromEntries(SCORE_KEYS.map(([k]) => [k, Math.round(Number(f.elements[k].value))]))
      await busy(f.querySelector('button.primary'), async () => {
        try {
          const id = await rpc('league_save', { p_id: l?.id || null, p_name: d.name, p_description: d.description, p_scoring: scoring, p_active: l ? f.elements.active.checked : true })
          close(); toast(l ? 'Uloženo.' : 'Liga je založená.', 'ok'); done(id)
        } catch (err) { toast(errMsg(err), 'err') }
      })
    }),
  })
}

export async function renderDetail(main, [id], ctx) {
  let d, tab = 'table'
  const load = async () => { d = await rpc('league_detail', { p_id: id }) }
  await load()
  if (!ctx.isCurrent()) return
  if (!d) { mount(main, html`${peopleTabs('leagues')}<div class="empty" style="margin-top:14px">Liga neexistuje.</div>`); return }

  const draw = () => {
    const l = d.league, st = d.standings
    const manage = d.can.edit || d.can.organizers
    const me = state.user?.id
    mount(main, html`
      ${peopleTabs('leagues')}
      <header class="t-head lg-head" style="margin-top:14px">
        <span class="pill ${l.active ? 'live' : ''}">${l.active ? 'Liga' : 'Archiv'}</span>
        <h1 style="margin-top:6px">${l.name}</h1>
        <div class="meta"><span>${plural(d.tournaments.filter(t => t.status === 'finished').length, 'odehraný turnaj', 'odehrané turnaje', 'odehraných turnajů')}</span>
          <span>${plural(st.length, 'hráč', 'hráči', 'hráčů')}</span></div>
        ${l.description ? html`<p class="desc">${l.description}</p>` : ''}
        ${scoringChips(l.scoring)}
      </header>
      ${d.can.create ? html`<div class="row wrap" style="margin-top:12px"><a class="btn primary sm" href="#/new?league=${l.id}">+ Ligový turnaj</a></div>` : ''}
      <div class="seg sm" role="tablist" style="margin-top:16px">
        <button type="button" data-tab="table" class="${tab === 'table' ? 'on' : ''}" role="tab">Tabulka</button>
        <button type="button" data-tab="events" class="${tab === 'events' ? 'on' : ''}" role="tab">Turnaje (${d.tournaments.length})</button>
        ${manage ? html`<button type="button" data-tab="staff" class="${tab === 'staff' ? 'on' : ''}" role="tab">Správa</button>` : ''}
      </div>
      <div id="lg-body" style="margin-top:14px">${tab === 'table' ? table(st, me) : tab === 'events' ? events(d.tournaments) : staff(d)}</div>`)
  }

  const table = (st, me) => st.length ? html`
    <ol class="lg-table">${st.map((s, i) => {
      const diff = s.plus - s.minus
      const rank = i && st[i - 1].points === s.points && st[i - 1].wins === s.wins && (st[i - 1].plus - st[i - 1].minus) === diff && st[i - 1].plus === s.plus ? null : i + 1
      return html`<li class="lg-row ${i < 3 ? 'top p' + (i + 1) : ''} ${s.user && s.user === me ? 'is-me' : ''}">
        <details>
          <summary>
            <span class="place ${i < 3 ? 'p' + (i + 1) : ''}">${rank ? rank + '.' : ''}</span>
            <span class="av">${s.avatar || '👤'}</span>
            <span class="grow lg-who">
              <b class="ellipsis">${s.nick}${s.user && s.user === me ? html` <span class="faint small">(ty)</span>` : ''}</b>
              <small class="lg-bal"><span>${plural(s.events, 'turnaj', 'turnaje', 'turnajů')}</span><span class="num">${s.wins}–${s.losses}</span><span class="num"><i class="plus">+${s.plus}</i> / <i class="minus">−${s.minus}</i></span><span class="num ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">${signed(diff)}</span></small>
            </span>
            <span class="lg-pts num"><b>${s.points}</b><small>${pts(s.points)}</small></span>
          </summary>
          <div class="lg-results">${s.results.map(r => html`<a class="lg-res" href="#/t/${r.tournament_id}">
            <span class="place ${r.place <= 3 ? 'p' + r.place : ''}">${r.place}.</span>
            <span class="grow" style="min-width:0"><span class="ellipsis">${r.name}</span>
              <small class="faint">${fmtDate(r.at)}${r.cut ? ' · top cut' : ''} · ${r.wins}–${r.losses} · +${r.plus}/−${r.minus}</small></span>
            <b class="num">+${r.points}</b></a>`)}
            ${s.user ? html`<a class="small" href="#/p/${s.user}">Profil hráče</a>` : html`<span class="small faint">Hráč bez účtu</span>`}
          </div>
        </details>
      </li>`
    })}</ol>
    <p class="hint">Pořadí: body ligy → výhry → rozdíl bodů → získané body. Rozklikni hráče pro body z jednotlivých turnajů. Volné losy se do bilance nepočítají.</p>`
    : html`<div class="empty">Tabulka se naplní po prvním skončeném ligovém turnaji.</div>`

  const events = (ts) => ts.length ? html`<div class="list">${ts.map(t => html`<a class="li" href="#/t/${t.id}">
      <div class="grow" style="min-width:0">
        <div class="ellipsis" style="font-weight:600">${t.name}</div>
        <div class="small muted ellipsis">${[fmtDate(t.starts_at), t.location, plural(Number(t.players), 'hráč', 'hráči', 'hráčů')].filter(Boolean).join(' · ')}</div>
      </div>
      ${t.status === 'finished' ? html`<span class="small">🏆 ${t.winner || '–'}</span>`
        : html`<span class="pill ${['swiss', 'topcut'].includes(t.status) ? 'live' : ''}">${t.status === 'registration' ? 'registrace' : 'hraje se'}</span>`}
    </a>`)}</div>` : html`<div class="empty">Zatím žádný ligový turnaj.</div>`

  const ROLE = { manager: 'Správce ligy', organizer: 'Organizátor ligy' }
  const staff = (d) => html`<div class="stack">
    <div class="card stack">
      <h3>Správci a organizátoři</h3>
      ${d.staff.length ? html`<div class="list">${d.staff.map(s => html`<div class="li">
        <span class="av">${s.avatar}</span>
        <a class="grow ellipsis" href="#/p/${s.user}" style="font-weight:600">${s.nick}</a>
        <span class="pill ${s.role === 'manager' ? 'role' : ''}">${ROLE[s.role]}</span>
        ${(s.role === 'manager' ? d.can.edit : d.can.organizers) ? html`<button class="btn sm ghost" data-unstaff="${s.user}" aria-label="Odebrat ${s.nick}">✕</button>` : ''}
      </div>`)}</div>` : html`<p class="small muted">Zatím nikdo. Ligové turnaje teď zakládají jen admini.</p>`}
      <button class="btn" data-act="add-staff">+ Přidat</button>
      <p class="hint">${d.can.edit ? 'Správce jmenuješ ty, organizátory přidává správce nebo admin.' : 'Organizátor ligy smí zakládat ligové turnaje.'} Přidat jde jen hráče s funkcí organizátor. Totéž se dá nastavit v profilu hráče.</p>
    </div>
    ${d.can.edit ? html`<div class="row wrap">
      <button class="btn" data-act="edit">Upravit ligu</button>
      <button class="btn danger" data-act="delete">Smazat ligu</button></div>` : ''}
  </div>`

  const reload = async () => { await load(); draw() }
  on(main, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; draw() })
  on(main, 'click', '[data-act=edit]', () => leagueForm(d.league, reload))
  on(main, 'click', '[data-act=delete]', async () => {
    if (!await confirmBox(`Smazat ligu ${d.league.name}? Turnaje zůstanou, jen přestanou být ligové. Tabulka zmizí.`, { ok: 'Smazat', danger: true })) return
    try { await rpc('league_delete', { p_id: d.league.id }); toast('Liga smazána.', 'ok'); location.hash = '#/leagues' } catch (err) { toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-unstaff]', async (e, b) => {
    const s = d.staff.find(x => x.user === b.dataset.unstaff)
    if (!await confirmBox(`Odebrat ${s.nick} z ligy?`, { ok: 'Odebrat', danger: true })) return
    busy(b, async () => {
      try { await rpc('league_staff_set', { p_league: d.league.id, p_user: s.user, p_role: null }); reload() } catch (err) { toast(errMsg(err), 'err') }
    })
  })
  on(main, 'click', '[data-act=add-staff]', (e, b) => busy(b, () => staffModal(d, reload)))
  draw()
}

async function staffModal(d, reload) {
  const all = (await rpc('players_list')).filter(p => roleLevel(p.role) >= 2 && !d.staff.some(s => s.user === p.id))
  const { box, close } = modal(html`
    <h2>Přidat do ligy</h2>
    ${all.length ? html`<form class="stack" id="f-staff">
      <label class="f"><span>Organizátor</span><select class="input" name="user" required>
        ${all.map(p => html`<option value="${p.id}">${p.nick}</option>`)}</select></label>
      ${d.can.edit ? html`<label class="f"><span>Role</span><select class="input" name="role">
        <option value="organizer">Organizátor ligy – zakládá ligové turnaje</option>
        <option value="manager">Správce ligy – navíc přidává organizátory</option></select></label>` : html`<input type="hidden" name="role" value="organizer">`}
      <div class="row"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn primary grow">Přidat</button></div>
    </form>` : html`<p class="muted">Všichni organizátoři už v lize jsou. Funkci organizátor dává admin v profilu hráče.</p>
      <button class="btn block" data-close>Zavřít</button>`}`)
  on(box, 'submit', '#f-staff', async (e, f) => {
    e.preventDefault()
    const v = formData(f)
    await busy(f.querySelector('button.primary'), async () => {
      try { await rpc('league_staff_set', { p_league: d.league.id, p_user: v.user, p_role: v.role }); close(); toast('Přidáno.', 'ok'); reload() }
      catch (err) { toast(errMsg(err), 'err') }
    })
  })
}

// profil: umístění v ligách
export function leagueBadges(list = []) {
  if (!list.length) return ''
  return html`<div class="lg-badges">${list.map(s => html`<a class="lg-badge ${s.rank <= 3 ? 'p' + s.rank : ''}" href="#/l/${s.league}">
    <b class="num">${s.rank}.</b><span class="ellipsis">${s.name}</span><small class="num">${s.points} ${pts(s.points)}</small></a>`)}</div>`
}

// profil: ligové role organizátora (správu vidí hlavní admin, admin a správci lig)
export function leagueRolesCard(roles = [], targetLevel) {
  const editable = roles.filter(r => r.can_org || r.can_mgr)
  if (!editable.length || targetLevel < 2) return ''
  return html`<div class="card stack lg-roles">
    <h3 style="margin:0">Ligové turnaje</h3>
    ${editable.map(r => html`<label class="lg-role-row"><span class="grow ellipsis">${r.name}${r.active ? '' : html` <span class="faint small">· archiv</span>`}</span>
      <select class="input" data-lgrole="${r.league}" aria-label="Role v lize ${r.name}">
        <option value="" ${!r.role ? 'selected' : ''}>—</option>
        <option value="organizer" ${r.role === 'organizer' ? 'selected' : ''} ${!r.can_org && r.role !== 'organizer' ? 'disabled' : ''}>Organizátor ligy</option>
        ${r.can_mgr || r.role === 'manager' ? html`<option value="manager" ${r.role === 'manager' ? 'selected' : ''} ${!r.can_mgr ? 'disabled' : ''}>Správce ligy</option>` : ''}
      </select></label>`)}
    <p class="hint">Organizátor ligy smí zakládat turnaje do téhle ligy, správce navíc přidává další organizátory.</p>
  </div>`
}
