// ════════════════════════════════════════════════════════════════
//  Hlavní stránka (turnaje a akce) + formulář pro založení / úpravu
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, q, errMsg, isLoggedIn, canManage } from '../supa.js'
import { html, mount, on, formData, toast, busy, statusPill, fmtDate, fmtTime, toLocalInput, fromLocalInput, plural, EVENT_TYPES, kindLabel } from '../ui.js'
import { DEFAULT_BO, FORMATS } from '../core.js'
import { trainingForm } from './communities.js'
import { backupDue } from '../admin.js'
import { createTree, openCreateWheel } from '../create-wheel.js'

export async function renderList(main, _p, ctx) {
  const [all, leads, invites, lastBackup, leagues] = await Promise.all([
    rpc('tournament_list'),
    isLoggedIn() ? rpc('my_lead_communities').catch(() => []) : [],
    isLoggedIn() ? rpc('my_training_invites').catch(() => []) : [],
    state.level >= 4 ? rpc('backup_status').catch(() => undefined) : undefined,
    state.level >= 2 ? rpc('my_leagues').catch(() => []) : [],
  ])
  const tree = createTree({ level: state.level, leads, leagues, onCommunity: () => trainingForm(leads, leads[0]?.id) })
  if (!ctx.isCurrent()) return
  const mine = new Set(state.myRegs.map(r => r.tournament_id))
  let query = '', filter = 'upcoming'

  // banner „tvůj zápas“ u probíhajícího turnaje
  const runningMine = all.filter(t => mine.has(t.id) && (t.status === 'swiss' || t.status === 'topcut'))
  let callHtml = ''
  if (runningMine.length) {
    const regIds = state.myRegs.map(r => r.id)
    const ms = await q(sb.from('matches').select('id,tournament_id,arena,status,p1_reg,p2_reg')
      .in('tournament_id', runningMine.map(t => t.id)).neq('status', 'done')
      .or(`p1_reg.in.(${regIds.join(',')}),p2_reg.in.(${regIds.join(',')})`)).catch(() => [])
    const m = ms.find(x => x.p1_reg && x.p2_reg && x.arena)
    if (m) {
      const t = runningMine.find(x => x.id === m.tournament_id)
      callHtml = html`<a class="banner-call" href="#/t/${t.id}">
        <span class="big">${m.arena}</span>
        <span><b>Tvůj zápas – aréna ${m.arena}</b><br><span class="muted small">${t.name} · otevři pro soupeře a QR</span></span></a>`
    }
  }

  const draw = () => {
    const ql = query.trim().toLowerCase()
    const list = all.filter(t => {
      if (ql && !(`${t.name} ${t.location || ''} ${t.organizer_nick || ''} ${t.league || ''}`.toLowerCase().includes(ql))) return false
      if (filter === 'upcoming') return !['finished', 'canceled'].includes(t.status)
      if (filter === 'mine') return mine.has(t.id)
      if (filter === 'past') return ['finished', 'canceled'].includes(t.status)
      return true
    })
    mount(main.querySelector('#t-list'), list.length ? list.map(card) : html`
      <div class="empty">${filter === 'upcoming' ? 'Teď není vypsaný žádný turnaj ani akce.' : filter === 'mine' ? 'Zatím nejsi v žádném turnaji.' : 'Nic nenalezeno.'}
      ${filter !== 'past' ? html`<br><button class="btn" data-f="past">Projít odehrané</button>` : ''}</div>`)
  }

  const card = (t) => html`
    <a class="card t-card ${t.kind === 'event' ? 'is-event' : ''} ${t.event_type === 'fashion' && t.kind === 'event' ? 'is-fashion' : ''} ${t.event_type === 'community' ? 'is-community' : ''} ${['swiss', 'topcut', 'show'].includes(t.status) ? 'is-live' : ''}" href="#/t/${t.id}">
      <div class="row between"><span class="t-date">${t.starts_at ? `${fmtDate(t.starts_at)} · ${fmtTime(t.starts_at)}` : 'Termín upřesníme'}</span>${statusPill(t)}</div>
      <h3>${t.name}</h3>
      <div class="meta">
        <span>${kindLabel(t)}</span>
        ${t.league ? html`<span class="lg-tag">🏆 ${t.league}</span>` : ''}
        ${t.event_type === 'meeting' && t.meeting_mode === 'online' ? html`<span>🌐 online</span>` : t.location ? html`<span>📍 ${t.location}</span>` : ''}
        ${t.visibility === 'staff' ? html`<span class="vis-tag">🔒 jen organizátoři</span>` : ''}
        <span>👥 ${plural(Number(t.players), 'hráč', 'hráči', 'hráčů')}${t.max_players ? ` / ${t.max_players}` : ''}</span>
        ${mine.has(t.id) ? html`<span style="color:var(--bolt)">✓ Jsi přihlášený</span>` : ''}
      </div>
    </a>`

  mount(main, html`
    ${callHtml}
    ${invites.map(i => html`<a class="banner-call invite" href="#/t/${i.tournament_id}">
      <span class="big">👥</span>
      <span><b>Pozvánka na trénink ${i.name}</b><br><span class="muted small">${i.community}${i.by ? ` · zve ${i.by}` : ''}${i.starts_at ? ` · ${fmtDate(i.starts_at)} ${fmtTime(i.starts_at)}` : ''}</span></span></a>`)}
    ${lastBackup !== undefined && backupDue(lastBackup) ? html`<a class="banner-call backup" href="#/me?s=backup">
      <span class="big">⛁</span>
      <span><b>Čas na zálohu dat</b><br><span class="muted small">${lastBackup ? `Poslední záloha je z ${fmtDate(lastBackup)}.` : 'Zálohu jsi ještě nestáhl.'} Stáhneš ji v profilu.</span></span></a>` : ''}
    <div class="row between wrap" style="gap:12px">
      <h1>Turnaje a akce</h1>
      <div class="row">
        <a class="btn sm ghost help-btn" href="#/help" aria-label="Nápověda – jak na to">?</a>
        ${tree ? html`<button class="btn primary sm create-btn" data-act="create" aria-haspopup="dialog">+ Založ akci</button>` : ''}
      </div>
    </div>
    <input class="input" style="margin-top:14px" type="search" placeholder="Hledat podle názvu, místa nebo organizátora" id="t-q" aria-label="Hledat turnaj">
    <div class="tabs" role="tablist">
      <button type="button" data-f="upcoming" class="on">Nadcházející</button>
      ${mine.size ? html`<button type="button" data-f="mine">Moje</button>` : ''}
      <button type="button" data-f="past">Odehrané</button>
      <button type="button" data-f="all">Vše</button>
    </div>
    <div id="t-list" class="stack"></div>
    ${!isLoggedIn() ? html`<p class="hint" style="text-align:center;margin-top:24px">Máš účet? <a href="#/login">Přihlas se</a> – výsledky se ti budou ukládat do profilu.</p>` : ''}`)

  on(main, 'input', '#t-q', (e, el) => { query = el.value; draw() })
  on(main, 'click', '[data-act=create]', () => openCreateWheel(tree))
  on(main, 'click', '[data-f]', (e, el) => {
    filter = el.dataset.f
    main.querySelectorAll('.tabs [data-f]').forEach(a => a.classList.toggle('on', a.dataset.f === filter))
    draw()
  })
  draw()
}

// ────────────────────────────────────────────────────────────────
export async function renderEditor(main, [kindArg, id]) {
  if (state.level < 2) {
    mount(main, html`<div class="notice">Turnaje a akce zakládají ověření organizátoři. Status organizátora ti přidělí admin.</div>`)
    return
  }
  let t = { kind: kindArg === 'event' ? 'event' : 'tournament', name: '', description: '', location: '', starts_at: null,
            swiss_rounds: 4, top_cut: 8, arena_count: 4, win_score: 7, bo_config: DEFAULT_BO, max_players: null,
            format: 'swiss', unique_parts: true, rated: true, event_type: 'training', fashion_beys: 3 }
  // předvolba z kolečka „Založ akci“ (#/new?f=deathmatch, #/new/event?type=meeting&mode=online)
  const qs = new URLSearchParams(location.hash.split('?')[1] || '')
  const preType = !id && t.kind === 'event' && ['training', 'fashion', 'meeting', 'other'].includes(qs.get('type')) ? qs.get('type') : null
  if (preType) Object.assign(t, { event_type: preType, meeting_mode: qs.get('mode') === 'online' ? 'online' : 'live', visibility: 'all' })
  // formát (a liga) vybrané v kolečku se v editoru už nepřepínají
  const preF = !id && t.kind === 'tournament' && ['swiss', 'deathmatch'].includes(qs.get('f'))
  if (preF) t.format = qs.get('f')
  if (id) {
    t = await q(sb.from('tournaments').select('*').eq('id', id).single())
    if (t.event_type === 'community') { location.hash = `#/t/${id}/manage`; return }
    if (!canManage(t)) { mount(main, html`<div class="notice err">Tenhle turnaj nemůžeš upravovat.</div>`); return }
  }
  const started = id && t.status !== 'registration'
  const isEv = t.kind === 'event'
  const leads = isEv && !id ? await rpc('my_lead_communities').catch(() => []) : []
  // ligy, do kterých smím turnaj zařadit (+ aktuální liga turnaje, i když do ní už nesmím)
  let leagues = !isEv ? await rpc('my_leagues').catch(() => []) : []
  if (!isEv && t.league_id && !leagues.some(l => l.id === t.league_id)) {
    const cur = await q(sb.from('leagues').select('id,name').eq('id', t.league_id).maybeSingle()).catch(() => null)
    if (cur) leagues = [cur, ...leagues]
  }
  if (!id) {
    const want = new URLSearchParams(location.hash.split('?')[1] || '').get('league')
    if (want && leagues.some(l => l.id === want)) t.league_id = want
  }
  // vstupné: kdo ho může vybírat = pokladníci (funkce v profilu) + organizátor turnaje
  const owner = t.created_by || state.user?.id
  const cashiers = !isEv ? await rpc('cashier_list').catch(() => []) : []
  const cashPick = !isEv ? [
    { id: owner, nick: owner === state.user?.id ? 'Já – organizátor' : 'Organizátor turnaje', avatar: '🧑‍💼', org: true },
    ...cashiers.filter(c => c.id !== owner),
    ...(t.cashiers || []).filter(x => x !== owner && !cashiers.some(c => c.id === x)).map(x => ({ id: x, nick: 'Dřívější pokladník', avatar: '👤' })),
  ] : []
  const meet = t.event_type === 'meeting'
  const online = meet && t.meeting_mode === 'online'
  const title = id ? `Upravit ${isEv ? 'akci' : 'turnaj'}`
    : !isEv ? (t.league_id ? 'Nový ligový turnaj' : t.format === 'deathmatch' ? 'Nový turnaj · Deathmatch' : 'Nový turnaj · Klasika 3v3')
    : preType === 'meeting' ? `Nový meeting · ${online ? 'online' : 'osobně'}`
    : preType === 'fashion' ? 'Nová fashion show' : preType === 'training' ? 'Nový casual trénink' : 'Nová akce'
  const topPreset = [0, 4, 8, 16, 32].includes(t.top_cut) ? String(t.top_cut) : 'custom'
  const bo = { ...DEFAULT_BO, ...(t.bo_config || {}) }

  mount(main, html`
    <a class="small muted" href="${id ? `#/t/${id}` : '#/'}">← Zpět</a>
    <h1 style="margin-top:8px">${title}</h1>
    <form class="stack" id="f-t" style="margin-top:16px">
      <div class="card stack">
        <label class="f"><span>Název</span><input class="input" name="name" required minlength="3" maxlength="80" value="${t.name}"></label>
        <div class="grid2 dates">
          <label class="f"><span>Začátek</span><input class="input" type="datetime-local" name="starts_at" value="${toLocalInput(t.starts_at)}" required></label>
          <label class="f"><span>Konec (nepovinné)</span><input class="input" type="datetime-local" name="ends_at" value="${toLocalInput(t.ends_at)}"></label>
        </div>
        <label class="f" id="f-loc"><span>${online ? 'Odkaz na schůzku' : 'Místo'}</span><input class="input" name="location" maxlength="${online ? 300 : 120}" type="${online ? 'url' : 'text'}" value="${t.location || ''}" placeholder="${online ? 'https://discord.gg/… nebo Meet / Teams' : 'Klub, adresa'}"></label>
        <label class="f"><span>Popis</span><textarea class="input" name="description" maxlength="2000" placeholder="${meet ? 'Program, o čem se bude mluvit…' : 'Pravidla, startovné, co si vzít s sebou…'}">${t.description || ''}</textarea></label>
        ${isEv ? html`
        <div id="f-meet" class="stack" ${meet ? '' : 'hidden'}>
          <fieldset class="f ev-type"><span>Jak</span>
            <div class="seg" role="radiogroup" aria-label="Jak se meeting koná">
              <label class="seg-opt"><input type="radio" name="meeting_mode" value="live" ${!online ? 'checked' : ''}><span>Osobně</span></label>
              <label class="seg-opt"><input type="radio" name="meeting_mode" value="online" ${online ? 'checked' : ''}><span>Online</span></label>
            </div></fieldset>
          <fieldset class="f ev-type"><span>Kdo meeting uvidí</span>
            <div class="seg" role="radiogroup" aria-label="Kdo meeting uvidí">
              <label class="seg-opt"><input type="radio" name="visibility" value="all" ${t.visibility !== 'staff' ? 'checked' : ''}><span>Všichni</span></label>
              <label class="seg-opt"><input type="radio" name="visibility" value="staff" ${t.visibility === 'staff' ? 'checked' : ''}><span>Organizátoři</span></label>
            </div>
            <div class="hint">„Organizátoři“ = meeting vidí a přihlásí se na něj jen organizátoři a admini.</div></fieldset>
        </div>
        ${preType ? html`<input type="hidden" name="event_type" value="${preType}">` : html`
        <fieldset class="f ev-type"><span>Druh akce</span>
          <div class="seg" role="radiogroup" aria-label="Druh akce">
            ${EVENT_TYPES.map(([k, l]) => html`<label class="seg-opt"><input type="radio" name="event_type" value="${k}" ${t.event_type === k ? 'checked' : ''} ${started ? 'disabled' : ''}><span>${l}</span></label>`)}
            ${leads.length ? html`<label class="seg-opt"><input type="radio" name="event_type" value="community"><span>Komunitní</span></label>` : ''}
          </div>
          <div class="hint" id="ev-hint">${evHint(t.event_type)}</div>
        </fieldset>`}
        <label class="f" id="f-fbeys" ${t.event_type === 'fashion' ? '' : 'hidden'}><span>Kolik beybladů ukáže každý hráč</span>
          <input class="input" type="number" min="1" max="10" name="fashion_beys" value="${t.fashion_beys || 3}" ${started ? 'disabled' : ''}></label>` : ''}
        <label class="f" id="f-max" ${meet ? 'hidden' : ''}><span>Maximální počet hráčů (nepovinné)</span><input class="input" type="number" min="2" max="512" name="max_players" value="${t.max_players || ''}"></label>
      </div>
      ${preF ? html`<input type="hidden" name="league_id" value="${t.league_id || ''}">` : isEv || !leagues.length ? '' : html`
      <div class="card stack lg-pick">
        <h3>Liga</h3>
        <label class="f"><span>Ligový turnaj?</span>
          <select class="input" name="league_id">
            <option value="">Ne – běžný turnaj</option>
            ${leagues.map(l => html`<option value="${l.id}" ${t.league_id === l.id ? 'selected' : ''}>${l.name}</option>`)}
          </select></label>
        <p class="hint">Ligový turnaj se po skončení započítá do tabulky ligy: body za účast, postup do top cutu a 1.–4. místo.</p>
      </div>`}
      ${isEv ? '' : html`
      <div class="card stack fee-card">
        <h3>Vstupné</h3>
        <label class="check"><input type="checkbox" name="fee" ${t.fee ? 'checked' : ''}> Platí se vstupné</label>
        <div id="fee-opts" class="stack" ${t.fee ? '' : 'hidden'}>
          <label class="f"><span>Kolik (Kč, nepovinné)</span><input class="input" type="number" min="1" max="100000" name="entry_fee" value="${t.entry_fee || ''}" placeholder="např. 100"></label>
          <fieldset class="f"><span>Kdo vybírá vstupné</span>
            <div class="cash-pick" role="group" aria-label="Kdo vybírá vstupné">${cashPick.map(c => html`
              <label class="cash-opt ${c.org ? 'org' : ''}"><input type="checkbox" name="cashier" value="${c.id}" ${(t.cashiers || []).includes(c.id) ? 'checked' : ''}>
                <span class="av">${c.avatar || '👤'}</span><span>${c.nick}</span></label>`)}</div>
          </fieldset>
          <p class="hint">${cashiers.length ? 'Vybraný pokladník při kontrole registrace zaškrtne, kdo zaplatil.' : 'Zatím nikdo nemá funkci Pokladník – přidělí ji admin v profilu hráče. Do té doby vybírá organizátor.'}</p>
        </div>
      </div>
      <div class="card stack">
        <h3>Formát</h3>
        ${preF ? html`<input type="hidden" name="format" value="${t.format}">
        <div class="format-fixed"><b>${FORMATS.find(f => f.key === t.format)?.label}</b>${t.league_id ? html` <span class="lg-tag">🏆 ${leagues.find(l => l.id === t.league_id)?.name || ''}</span>` : ''}
          <small>${FORMATS.find(f => f.key === t.format)?.desc}</small></div>` : html`
        <div class="formats">
          ${FORMATS.map(f => html`<label class="format-opt">
            <input type="radio" name="format" value="${f.key}" ${t.format === f.key ? 'checked' : ''} ${started ? 'disabled' : ''}>
            <span><b>${f.label}</b><small>${f.desc}</small></span></label>`)}
        </div>`}
        <label class="check"><input type="checkbox" name="unique_parts" ${t.unique_parts ? 'checked' : ''} ${started ? 'disabled' : ''}> Žádný díl se v decku nesmí opakovat</label>
        <p class="hint" style="margin-top:-6px">Hlídá blade, ratchet, bit i díly CX (lock chip, main, over a assist blade).</p>
        <label class="check"><input type="checkbox" name="rated" ${t.rated !== false ? 'checked' : ''} ${started ? 'disabled' : ''}> Započítávat do hráčského ratingu</label>
        <p class="hint" style="margin-top:-6px">Vypni pro tréninkové a přátelské turnaje – výsledky se uloží, ale rating hráčů se nezmění.</p>
        <div class="grid2">
          <label class="f" id="f-rounds" ${t.format === 'deathmatch' ? 'hidden' : ''}><span>Počet kol swiss</span><input class="input" type="number" min="1" max="15" name="swiss_rounds" value="${t.swiss_rounds}" ${started ? 'disabled' : ''}></label>
          <label class="f"><span>Body na výhru</span><input class="input" type="number" min="1" max="99" name="win_score" value="${t.win_score}" ${started ? 'disabled' : ''} required></label>
        </div>
        <p class="hint" id="dm-hint" ${t.format === 'deathmatch' ? '' : 'hidden'}>Počet kol se dopočítá při startu (8 hráčů = 7 kol).</p>
        <label class="f"><span>Počet arén</span><input class="input" type="number" min="1" max="64" name="arena_count" value="${t.arena_count}" required></label>
      </div>
      <div class="card stack" id="tc-card" ${t.format === 'deathmatch' ? 'hidden' : ''}>
        <h3>Top cut</h3>
        <div class="grid2">
          <label class="f"><span>Velikost</span>
            <select class="input" name="top_preset" id="top-preset">
              ${[['0', 'Bez top cutu'], ['4', 'Top 4'], ['8', 'Top 8'], ['16', 'Top 16'], ['32', 'Top 32'], ['custom', 'Vlastní']].map(([v, l]) => html`<option value="${v}" ${v === topPreset ? 'selected' : ''}>${l}</option>`)}
            </select></label>
          <label class="f" id="top-custom" ${topPreset === 'custom' ? '' : 'hidden'}><span>Počet hráčů</span><input class="input" type="number" min="2" max="128" name="top_custom" value="${t.top_cut}"></label>
        </div>
        <p class="hint">Vyřazovací pavouk s loser bracketem. Velikost jde změnit ještě před spuštěním top cutu.</p>
        <span class="muted small">Na dvě vítězné hry (BO3) se hraje:</span>
        <label class="check"><input type="checkbox" name="bo_gf" ${bo.gf === 3 ? 'checked' : ''}> Grand finále (1. a 2. místo)</label>
        <label class="check"><input type="checkbox" name="bo_lbf" ${bo.lbf === 3 ? 'checked' : ''}> Finále losers (rozhoduje o 3. místě)</label>
        <label class="check"><input type="checkbox" name="bo_lbsf" ${bo.lbsf === 3 ? 'checked' : ''}> Semifinále losers (rozhoduje o 4. místě)</label>
        <label class="check"><input type="checkbox" name="bo_wbf" ${bo.wbf === 3 ? 'checked' : ''}> Finále winners</label>
      </div>`}
      <button class="btn primary block">${id ? 'Uložit změny' : isEv ? 'Vypsat akci' : 'Vypsat turnaj'}</button>
    </form>`)

  on(main, 'change', '[name=event_type]', (e, el) => {
    if (el.value === 'community') {
      // komunitní trénink má vlastní formulář (komunita, termín, místo)
      main.querySelector(`[name=event_type][value="${t.event_type}"]`).checked = true
      return trainingForm(leads, leads[0]?.id)
    }
    main.querySelector('#f-fbeys').hidden = el.value !== 'fashion'
    main.querySelector('#f-meet').hidden = el.value !== 'meeting'
    main.querySelector('#f-max').hidden = el.value === 'meeting'
    main.querySelector('#ev-hint').textContent = evHint(el.value)
  })
  on(main, 'change', '[name=meeting_mode]', (e, el) => {
    const on_ = el.value === 'online', inp = main.querySelector('#f-loc input')
    main.querySelector('#f-loc span').textContent = on_ ? 'Odkaz na schůzku' : 'Místo'
    inp.type = on_ ? 'url' : 'text'; inp.maxLength = on_ ? 300 : 120
    inp.placeholder = on_ ? 'https://discord.gg/… nebo Meet / Teams' : 'Klub, adresa'
  })
  on(main, 'change', '[name=fee]', (e, el) => {
    main.querySelector('#fee-opts').hidden = !el.checked
    // první zapnutí: předvyber organizátora, ať je hned komu platit
    if (el.checked && !main.querySelector('[name=cashier]:checked')) main.querySelector('[name=cashier]').checked = true
  })
  on(main, 'change', '#top-preset', (e, el) => { main.querySelector('#top-custom').hidden = el.value !== 'custom' })
  on(main, 'change', '[name=format]', (e, el) => {
    const dm = el.value === 'deathmatch'
    main.querySelector('#f-rounds').hidden = dm; main.querySelector('#dm-hint').hidden = !dm; main.querySelector('#tc-card').hidden = dm
  })
  on(main, 'submit', '#f-t', async (e, f) => {
    e.preventDefault()
    const d = formData(f)
    const row = {
      name: d.name.trim(), description: d.description.trim() || null, location: d.location.trim() || null,
      starts_at: fromLocalInput(d.starts_at), ends_at: fromLocalInput(d.ends_at),
      max_players: d.max_players ? Number(d.max_players) : null, kind: t.kind,
    }
    if (!isEv) {
      Object.assign(row, {
        arena_count: Number(d.arena_count),
        top_cut: d.top_preset === 'custom' ? Number(d.top_custom) : Number(d.top_preset),
        bo_config: { gf: d.bo_gf ? 3 : 1, lbf: d.bo_lbf ? 3 : 1, lbsf: d.bo_lbsf ? 3 : 1, wbf: d.bo_wbf ? 3 : 1, default: 1 },
      })
      if (!started) Object.assign(row, { swiss_rounds: Math.max(1, Number(d.swiss_rounds) || 1), win_score: Number(d.win_score),
                                         format: d.format || 'swiss', unique_parts: !!d.unique_parts, rated: !!d.rated })
      if (row.format === 'deathmatch' && !started) Object.assign(row, { top_cut: 0 })
      if (row.top_cut === 1 || row.top_cut < 0) return toast('Top cut musí mít aspoň 2 hráče, nebo 0.', 'err')
      if (leagues.length) row.league_id = d.league_id || null
      row.fee = !!d.fee
      row.entry_fee = row.fee && d.entry_fee ? Number(d.entry_fee) : null
      row.cashiers = row.fee ? [...f.querySelectorAll('[name=cashier]:checked')].map(x => x.value) : []
      if (row.fee && !row.cashiers.length) return toast('Vyber, kdo bude vybírat vstupné.', 'err')
    } else {
      Object.assign(row, { swiss_rounds: 1, top_cut: 0 })
      if (!started) Object.assign(row, { event_type: d.event_type || 'training',
                                         fashion_beys: Math.min(10, Math.max(1, Number(d.fashion_beys) || 3)) })
      const et = started ? t.event_type : (d.event_type || 'training')
      if (et === 'meeting') {
        Object.assign(row, { meeting_mode: d.meeting_mode === 'online' ? 'online' : 'live', visibility: d.visibility === 'staff' ? 'staff' : 'all', max_players: null })
        if (row.meeting_mode === 'online' && row.location && !/^https?:\/\//i.test(row.location)) return toast('Odkaz na online schůzku musí začínat https://', 'err')
      }
    }
    await busy(f.querySelector('button.primary'), async () => {
      try {
        const saved = id
          ? await q(sb.from('tournaments').update(row).eq('id', id).select('id').single())
          : await q(sb.from('tournaments').insert(row).select('id').single())
        toast(id ? 'Uloženo.' : (isEv ? (row.event_type === 'meeting' ? 'Meeting je vypsaný.' : 'Akce je vypsaná.') : 'Turnaj je vypsaný.'), 'ok')
        location.hash = '#/t/' + saved.id
      } catch (err) { toast(errMsg(err), 'err') }
    })
  })
}

const evHint = (k) => k === 'meeting' ? 'Setkání osobně nebo online – hráči se jen přihlásí.' : k === 'fashion'
  ? 'Soutěž o nejlepší sestavu: hráči se přihlásí s beyblady, design judge je hodnotí a na TV se vyhlásí top 3.'
  : k === 'other' ? 'Cokoliv dalšího – hráči se jen přihlásí.' : 'Trénink – hráči se jen přihlásí, bez výsledků.'
