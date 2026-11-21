// ════════════════════════════════════════════════════════════════
//  Řízení turnaje (organizátor / admin)
//  registrace → start → swiss kola → top cut → ukončení
// ════════════════════════════════════════════════════════════════
import { askTournamentChat } from './chat.js'
import { sb, rpc, q, errMsg, state } from '../supa.js'
import { html, mount, on, formData, toast, modal, busy, confirmBox, plural, pauseLeft, fmtLeft, fmtTime } from '../ui.js'
import { pairSwissRound, pairRoundRobin, roundRobinRounds, makeRng, buildDoubleElim, computePlacements, DEFAULT_BO, matchLabel, phaseName, FORMATS, arenaQueue } from '../core.js'
import { standingsFor, nickOf } from './tournament.js'
import { loadParts, deckEditor, bindDeckEditor } from '../parts.js'

export function renderManage(box, { d, reload }) {
  const { t } = d
  const active = d.players.filter(p => p.status === 'active')
  // kontrola registrací (jen turnaj v registraci) – čekající hráči blokují start
  const waiting = d.checkin && t.kind === 'tournament' && t.status === 'registration' ? active.filter(p => !d.checkin.get(p.id)) : []
  const unpaid = d.pay && t.status === 'registration' ? active.filter(p => !d.pay.get(p.id)) : []
  const swiss = d.matches.filter(m => m.stage === 'swiss')
  const roundMs = swiss.filter(m => m.round === t.current_round)
  const roundDone = roundMs.every(m => m.status === 'done')
  const open = d.matches.filter(m => m.status !== 'done' && m.p1_reg && m.p2_reg)
  const allDone = d.matches.length > 0 && d.matches.every(m => m.status === 'done')
  const bracket = d.matches.filter(m => m.stage !== 'swiss')
  const dm = t.format === 'deathmatch', phase = phaseName(t)
  const sections = []

  // ── registrace ─────────────────────────────────
  if (t.status === 'registration') {
    if (t.kind === 'event') {
      sections.push(html`<div class="card stack">
        <h3>Akce</h3>
        <p class="muted">${plural(active.length, 'přihlášený', 'přihlášení', 'přihlášených')}. Po skončení akci ukonči, ať se uloží do historie.</p>
        <div class="row wrap"><a class="btn" href="#/t/${t.id}/edit">Upravit</a><button class="btn primary" data-act="finish-event">Ukončit akci</button></div>
      </div>`)
    } else {
      sections.push(html`<div class="card stack">
        <h3>Před startem</h3>
        <p class="muted">${plural(active.length, 'hráč', 'hráči', 'hráčů')} · ${dm
          ? `deathmatch – ${plural(roundRobinRounds(Math.max(2, active.length)), 'kolo', 'kola', 'kol')} každý s každým`
          : `${t.swiss_rounds} kol swiss · ${t.top_cut ? `top ${t.top_cut}` : 'bez top cutu'}`} · ${plural(t.arena_count, 'aréna', 'arény', 'arén')}${t.unique_parts ? ' · díly se neopakují' : ''}</p>
        ${!dm && t.top_cut > active.length ? html`<div class="notice warn">Top ${t.top_cut} je víc než přihlášených hráčů – před top cutem ho zmenšíš.</div>` : ''}
        ${waiting.length ? html`<div class="notice warn">Zkontrolováno ${active.length - waiting.length} z ${active.length} hráčů. Zkontroluj zbytek v záložce <a href="#/t/${t.id}/players">Hráči</a> – pak půjde turnaj spustit.</div>` : ''}
        ${unpaid.length ? html`<div class="notice">💰 Vstupné zatím nezaplatilo ${unpaid.length} z ${active.length} hráčů (${unpaid.slice(0, 6).map(p => p.nick).join(', ')}${unpaid.length > 6 ? '…' : ''}). Spustit jde i tak.</div>` : ''}
        <div class="row wrap"><a class="btn" href="#/t/${t.id}/edit">Upravit nastavení</a>
          <button class="btn primary" data-act="start" ${active.length < 2 || waiting.length ? 'disabled' : ''}>Spustit turnaj</button></div>
        ${waiting.length && active.length >= 2 ? html`<button class="btn sm danger-ghost start-unchecked" data-act="start-unchecked">⚠ Spustit bez kontroly registrací</button>` : ''}
        <p class="hint">Po startu se uzavře registrace a hráči už nemůžou měnit beyblady.</p>
      </div>
      <div class="card stack">
        <h3>Přidat hráče bez telefonu</h3>
        <p class="hint">Zapíšeš ho sám, jeho QR kód pak najdeš v záložce Hráči → ⋯.</p>
        <button class="btn" data-act="walkin">Přidat hráče</button>
      </div>`)
    }
  }

  // ── swiss ──────────────────────────────────────
  if (t.status === 'swiss') {
    const next = t.current_round + 1
    const lastDone = t.current_round >= t.swiss_rounds && roundDone
    sections.push(html`<div class="card stack">
      <h3>${t.current_round ? `Kolo ${t.current_round} z ${t.swiss_rounds}` : 'Turnaj běží'}</h3>
      ${t.current_round ? html`<p class="muted">Dohráno ${roundMs.filter(m => m.status === 'done').length} z ${roundMs.length} zápasů.</p>` : ''}
      ${!lastDone ? html`<button class="btn primary" data-act="draw" ${!roundDone ? 'disabled' : ''}>${dm ? `Vyhlásit ${next}. kolo` : `Vylosovat ${next}. kolo`}</button>
        ${!roundDone ? html`<p class="hint">Další kolo jde vylosovat, až budou dohrané všechny zápasy.</p>` : ''}` : ''}
    </div>`)
    if (lastDone) sections.push(topCutCard(d, active))
  }

  // ── konec ──────────────────────────────────────
  if ((t.status === 'topcut' && allDone) || (t.status === 'swiss' && t.current_round >= t.swiss_rounds && roundDone)) {
    sections.push(html`<div class="card stack">
      <h3>Ukončení turnaje</h3>
      <p class="muted">${t.status === 'topcut' ? (t.top_cut === 2 ? 'Finále je dohrané.' : 'Grand finále je dohrané.') : `${phase} je dohraný.`} Ukončením se uloží konečné pořadí do profilů hráčů a vyhodnocení turnaje.</p>
      <button class="btn ${t.status === 'topcut' ? 'primary' : ''}" data-act="finish">${t.status === 'topcut' ? 'Ukončit a uložit turnaj' : dm ? 'Ukončit podle tabulky' : 'Ukončit bez top cutu'}</button>
    </div>`)
  }

  // ── pauza ──────────────────────────────────────
  if (t.kind === 'tournament' && ['swiss', 'topcut'].includes(t.status)) {
    const left = pauseLeft(t.pause_until)
    sections.push(html`<div class="card stack pause-card ${left > 0 ? 'on' : ''}">
      <h3>Pauza</h3>
      ${left > 0 ? html`
        <p class="muted">Pauza běží – zbývá <b class="num" data-countdown="${t.pause_until}">${fmtLeft(t.pause_until)}</b>. Hráči ji vidí v Můj Status a TV rozpis ukazuje odpočet.</p>
        <div class="row wrap">
          <button class="btn" data-pause-add="5">+5 min</button>
          <button class="btn" data-pause-add="10">+10 min</button>
          <button class="btn primary" data-act="pause-end">Ukončit pauzu</button>
        </div>` : html`
        <p class="muted">Hráči uvidí „Pořadatel vyhlásil pauzu“ s odpočtem v Můj Status, nahoře v turnaji i na TV rozpisu.</p>
        <div class="row wrap" style="align-items:center">
          <label class="row" style="gap:8px;align-items:center"><input class="input" type="number" id="pause-min" min="1" max="240" value="10" style="width:90px" aria-label="Počet minut"> minut</label>
          <button class="btn primary" data-act="pause">⏸ Vyhlásit pauzu</button>
        </div>`}
    </div>`)
  }

  // ── rozehrané zápasy ───────────────────────────
  if (open.length) {
    // pořadí jako na arénách (rozehraný první, hráč-judge o místo níž); bez arény na konec
    const arenaNos = Array.from({ length: t.arena_count }, (_, i) => i + 1)
    const queues = arenaNos.map(a => arenaQueue(d.matches, a, d.busy))
    const ordered = [...queues.flat(), ...open.filter(m => !m.arena || m.arena > t.arena_count)]
    const posOf = new Map(queues.flatMap(qa => qa.map((m, i) => [m.id, i + 1])))
    const idle = arenaNos.filter((a, i) => !queues[i].length)
    const crowded = arenaNos.filter((a, i) => queues[i].length >= 2 && queues[i].some(m => m.status === 'pending'))
    sections.push(html`<h2>Rozehrané a čekající zápasy</h2>
      ${idle.length && crowded.length ? html`<div class="card row wrap" style="margin-bottom:10px;align-items:center">
        <div class="grow small"><b>Volné arény: ${idle.join(', ')}.</b> Na aréně ${crowded.join(', ')} čeká víc zápasů.</div>
        <button class="btn sm primary" data-act="rebalance">Obsadit volné arény</button>
      </div>` : ''}
      <div class="list">${ordered.map(m => html`
        <div class="li">
          <div class="grow">
            <div class="ellipsis" style="font-weight:600">${nickOf(d, m.p1_reg)} <span class="faint">vs</span> ${nickOf(d, m.p2_reg)}</div>
            <div class="small faint">${matchLabel(m, t.top_cut, t.format)}${m.best_of > 1 ? ` · BO${m.best_of} (${m.p1_wins}:${m.p2_wins})` : ''}${m.status === 'live' ? (m.judge_id ? ' · hraje se' : ' · rozehráno, bez judge') : posOf.get(m.id) ? ` · ${posOf.get(m.id)}. na aréně` : ''}${[m.p1_reg, m.p2_reg].some(r => d.busy.has(r) && d.busy.get(r) !== m.id) ? ' · hráč teď judguje' : ''}</div>
          </div>
          <select class="input" style="width:auto;min-height:36px;padding:4px 8px" data-arena="${m.id}" aria-label="Aréna">
            ${Array.from({ length: t.arena_count }, (_, i) => i + 1).map(a => html`<option value="${a}" ${a === m.arena ? 'selected' : ''}>A${a}</option>`)}
          </select>
          <button class="btn sm" data-result="${m.id}">Výsledek</button>
        </div>`)}</div>
      <p class="hint">Výsledky běžně posílá judge z BBXST. Ručně zadávej jen když BBXST nejde použít.</p>`)
  }

  // ── oprava výsledku ────────────────────────────
  const fixable = d.matches.filter(m => m.status === 'done' && !m.is_bye &&
    ((m.stage === 'swiss' && t.status === 'swiss' && m.round === t.current_round) || (m.stage !== 'swiss' && t.status === 'topcut')))
  if (fixable.length) {
    sections.push(html`<details class="card"><summary style="cursor:pointer;font-weight:600">Opravit odehraný zápas</summary>
      <div class="list" style="margin-top:12px">${fixable.map(m => html`
        <div class="li"><div class="grow small"><b>${nickOf(d, m.p1_reg)}</b> ${m.best_of > 1 ? `${m.p1_wins}:${m.p2_wins}` : `${m.p1_score}:${m.p2_score}`} <b>${nickOf(d, m.p2_reg)}</b>
          <div class="faint">${matchLabel(m, t.top_cut, t.format)}</div></div>
          <button class="btn sm danger" data-reset="${m.id}">Vrátit</button></div>`)}</div>
      <p class="hint">Vrácený zápas se odehraje znovu. V top cutu to jde jen, dokud navazující zápas nezačal.</p></details>`)
  }

  // ── testovací nástroje (jen admin) ─────────────
  if (state.level >= 3 && t.kind === 'tournament' && ['registration', 'swiss', 'topcut'].includes(t.status)) {
    sections.push(html`<details class="card" style="margin-top:24px"><summary style="cursor:pointer;font-weight:600">🧪 Testovací nástroje</summary>
      <div class="stack" style="margin-top:12px">
        ${t.status === 'registration' ? html`
          <p class="muted small">Přidá hráče bez účtu s náhodným nickem (začíná „T-“) a náhodným deckem z katalogu dílů.</p>
          <div class="row">
            <input class="input" type="number" id="test-n" min="1" max="64" value="16" style="width:90px" aria-label="Počet hráčů">
            <button class="btn" data-act="test-players">Přidat testovací hráče</button>
          </div>` : html`
          <p class="muted small">Všem zápasům, které mají oba hráče a nejsou dohrané, vyplní náhodný výsledek (u BO3 všechny hry). Další kolo pak vylosuješ normálně.</p>
          <button class="btn" data-act="test-play" ${open.length ? '' : 'disabled'}>Náhodně dohrát otevřené zápasy (${open.length})</button>`}
        <p class="hint">Zkušební turnaj po vyzkoušení zruš a smaž. Testovací hráči nemají účty, takže se nikomu nepropíšou do profilu.</p>
      </div></details>`)
  }

  // ── ostatní ────────────────────────────────────
  if (!['finished', 'canceled'].includes(t.status)) {
    sections.push(html`<details class="card" style="margin-top:24px"><summary style="cursor:pointer;font-weight:600">Zrušení</summary>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn danger" data-act="cancel">Zrušit ${t.kind === 'event' ? 'akci' : 'turnaj'}</button>
        ${t.status === 'registration' ? html`<button class="btn danger" data-act="delete">Smazat úplně</button>` : ''}
      </div></details>`)
  }
  if (t.status === 'finished' || t.status === 'canceled') sections.push(html`<div class="notice">${t.status === 'finished' ? 'Turnaj je ukončený a uložený.' : 'Zrušeno.'}</div>`)

  mount(box, html`<div class="stack">${sections}</div>`)

  // ── akce ───────────────────────────────────────
  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, 'ok'); reload() } catch (e) { toast(errMsg(e), 'err') } }

  // start: všichni musí být zkontrolovaní (Hráči → Kontrola registrací), nebo vědomě bez kontroly
  on(box, 'click', '[data-act=start], [data-act=start-unchecked]', async (e, b) => {
    const unchecked = b.dataset.act === 'start-unchecked'
    if (unchecked) {
      if (!await confirmBox(`⚠ Spustit bez kontroly registrací? ${waiting.length === 1 ? '1 hráč nebyl zkontrolovaný' : `${waiting.length} ${waiting.length <= 4 ? 'hráči nebyli zkontrolovaní' : 'hráčů nebylo zkontrolováno'}`} – nikdo neověřil, že jsou na místě a mají beyblady z přihlášky. Turnaj začne se všemi ${active.length} hráči.`, { ok: 'Spustit bez kontroly', danger: true })) return
    } else if (!await confirmBox(`Spustit turnaj s ${active.length} hráči? Registrace se uzavře.${unpaid.length ? ` 💰 Vstupné nezaplatilo ${unpaid.length} hráčů.` : ''}`, { ok: 'Spustit' })) return
    await busy(b, () => act(async () => {
      await rpc('start_tournament', { p_tournament: t.id })
      drawRound(d, reload, 1)
    }, 'Turnaj běží!'))
  })
  on(box, 'click', '[data-act=draw]', () => drawRound(d, reload, t.current_round + 1))
  on(box, 'click', '[data-act=finish]', () => finishModal(d, reload))
  on(box, 'click', '[data-act=finish-event]', async () => {
    if (!await confirmBox('Ukončit akci?', { ok: 'Ukončit' })) return
    act(() => rpc('finish_tournament', { p_tournament: t.id, p_placements: [] }), 'Akce ukončena.')
  })
  on(box, 'click', '[data-act=cancel]', async () => {
    if (!await confirmBox('Opravdu zrušit? Hráči uvidí, že se nekoná.', { ok: 'Zrušit', danger: true })) return
    act(() => rpc('cancel_tournament', { p_tournament: t.id }), 'Zrušeno.')
  })
  on(box, 'click', '[data-act=delete]', async () => {
    if (!await confirmBox('Smazat včetně všech registrací? Nejde to vrátit.', { ok: 'Smazat', danger: true })) return
    try { await q(sb.from('tournaments').delete().eq('id', t.id)); toast('Smazáno.', 'ok'); location.hash = '#/' } catch (e) { toast(errMsg(e), 'err') }
  })
  on(box, 'click', '[data-act=walkin]', (e, b) => busy(b, () => walkinModal(d, reload)))
  on(box, 'change', '[data-arena]', (e, s) => act(() => q(sb.from('matches').update({ arena: Number(s.value) }).eq('id', s.dataset.arena)), 'Aréna změněna.'))
  const setPause = (b, min) => busy(b, async () => {
    try { await rpc('set_pause', { p_tournament: t.id, p_minutes: min }); toast(min ? `Pauza ${min} min.` : 'Pauza ukončena.', 'ok'); reload() }
    catch (err) { toast(errMsg(err), 'err') }
  })
  on(box, 'click', '[data-act=pause]', (e, b) => {
    const min = Math.round(Number(box.querySelector('#pause-min').value))
    if (!(min >= 1 && min <= 240)) return toast('Zadej 1 až 240 minut.', 'err')
    setPause(b, min)
  })
  on(box, 'click', '[data-pause-add]', (e, b) => setPause(b, Math.ceil(pauseLeft(t.pause_until) / 60000) + Number(b.dataset.pauseAdd)))
  on(box, 'click', '[data-act=pause-end]', (e, b) => setPause(b, 0))
  on(box, 'click', '[data-act=rebalance]', (e, b) => busy(b, async () => {
    try {
      const n = await rpc('rebalance_arenas', { p_tournament: t.id })
      toast(n ? `Přesunuto ${n === 1 ? '1 zápas' : n < 5 ? `${n} zápasy` : `${n} zápasů`} na volné arény.` : 'Není co přesouvat.', 'ok'); reload()
    } catch (err) { toast(errMsg(err), 'err') }
  }))
  on(box, 'click', '[data-result]', (e, b) => resultModal(d, d.matches.find(m => m.id === b.dataset.result), reload))
  on(box, 'click', '[data-reset]', async (e, b) => {
    if (!await confirmBox('Vrátit zápas? Výsledek se smaže a hraje se znovu.', { ok: 'Vrátit', danger: true })) return
    act(() => rpc('reset_match', { p_match: b.dataset.reset }), 'Zápas vrácen.')
  })
  on(box, 'click', '[data-act=test-players]', (e, b) => busy(b, () => addTestPlayers(d, Number(box.querySelector('#test-n').value), reload)))
  on(box, 'click', '[data-act=test-play]', async (e, b) => {
    if (!await confirmBox(`Vyplnit náhodný výsledek u ${open.length} zápasů?`, { ok: 'Vyplnit' })) return
    busy(b, () => autoPlay(d, reload))
  })
  on(box, 'change', '#tc-size', (e, s) => { box.querySelector('#tc-custom').hidden = s.value !== 'custom'; previewSeeds() })
  on(box, 'input', '#tc-custom input', () => previewSeeds())
  on(box, 'click', '[data-act=topcut]', (e, b) => startTopCut(d, box, b, reload))
  on(box, 'click', '[data-act=final2]', (e, b) => startTopCut(d, box, b, reload, 2))

  function previewSeeds() {
    const el = box.querySelector('#tc-seeds'); if (!el) return
    const n = topSize(box)
    const st = standingsFor(d).filter(s => s.status === 'active')
    mount(el, n >= 2 && n <= st.length
      ? html`<ol class="small" style="padding-left:22px;columns:2">${st.slice(0, n).map(s => html`<li>${s.nick} <span class="faint">(${s.main} HB)</span></li>`)}</ol>`
      : html`<div class="notice warn">Zvol 2 až ${st.length} hráčů.</div>`)
  }
  previewSeeds()
}

// ── top cut ─────────────────────────────────────────
function topCutCard(d, active) {
  const { t } = d
  const n = active.length
  const def = Math.min(t.top_cut || (t.format === 'deathmatch' ? 4 : 0), n)
  const presets = [4, 8, 16, 32].filter(x => x <= n)
  const isPreset = presets.includes(def)
  const bo = { ...DEFAULT_BO, ...(t.bo_config || {}) }
  const dm = t.format === 'deathmatch'
  return html`${dm ? html`<div class="card stack">
    <h3>Co dál?</h3>
    <p class="muted">Deathmatch je dohraný. Můžeš turnaj ukončit podle tabulky (níž), odpálit finále, nebo spustit top cut.</p>
    <button class="btn primary" data-act="final2">🔥 Finále top 2 (BO3)</button>
    <p class="hint">První dva z tabulky hrají jeden zápas na dvě vítězné hry, ostatní mají pořadí z tabulky.</p>
  </div>` : ''}<div class="card stack">
    <h3>Top cut</h3>
    <p class="muted">${dm ? 'Vyřazovací pavouk s loser bracketem z nejlepších v tabulce.' : 'Swiss je dohraný. Zkontroluj velikost a spusť vyřazovací pavouk (s loser bracketem).'}</p>
    <div class="grid2">
      <label class="f"><span>Velikost</span><select class="input" id="tc-size">
        ${presets.map(x => html`<option value="${x}" ${x === def ? 'selected' : ''}>Top ${x}</option>`)}
        <option value="custom" ${!isPreset ? 'selected' : ''}>Vlastní</option></select></label>
      <label class="f" id="tc-custom" ${isPreset ? 'hidden' : ''}><span>Počet hráčů</span><input class="input" type="number" min="2" max="${n}" value="${def || Math.min(8, n)}"></label>
    </div>
    <span class="muted small">BO3 se hraje v:</span>
    <label class="check"><input type="checkbox" id="bo-gf" ${bo.gf === 3 ? 'checked' : ''}> Grand finále (1. a 2. místo)</label>
    <label class="check"><input type="checkbox" id="bo-lbf" ${bo.lbf === 3 ? 'checked' : ''}> Finále losers (3. místo)</label>
    <label class="check"><input type="checkbox" id="bo-lbsf" ${bo.lbsf === 3 ? 'checked' : ''}> Semifinále losers (4. místo)</label>
    <label class="check"><input type="checkbox" id="bo-wbf" ${bo.wbf === 3 ? 'checked' : ''}> Finále winners</label>
    <div><span class="muted small">Postupují (seed podle tabulky):</span><div id="tc-seeds" style="margin-top:6px"></div></div>
    <button class="btn primary" data-act="topcut">Spustit top cut</button>
  </div>`
}
function topSize(box) {
  const s = box.querySelector('#tc-size')?.value
  return s === 'custom' ? Number(box.querySelector('#tc-custom input').value) : Number(s)
}
async function startTopCut(d, box, btn, reload, fixed) {
  const { t } = d
  const n = fixed || topSize(box)
  const st = standingsFor(d).filter(s => s.status === 'active')
  if (!(n >= 2 && n <= st.length)) return toast(`Top cut musí mít 2 až ${st.length} hráčů.`, 'err')
  const bo = fixed === 2 ? { ...DEFAULT_BO, gf: 3 }
    : { gf: box.querySelector('#bo-gf').checked ? 3 : 1, lbf: box.querySelector('#bo-lbf').checked ? 3 : 1,
        lbsf: box.querySelector('#bo-lbsf').checked ? 3 : 1, wbf: box.querySelector('#bo-wbf').checked ? 3 : 1, default: 1 }
  if (!await confirmBox(n === 2 ? `Odpálit finále ${nickOf(d, st[0].id)} vs ${nickOf(d, st[1].id)} (BO${bo.gf})?` : `Spustit top ${n}?`, { ok: 'Spustit' })) return
  await busy(btn, async () => {
    try {
      await rpc('create_topcut', { p_tournament: t.id, p_top: n, p_bo_config: bo,
        p_seeds: st.slice(0, n).map((s, i) => ({ reg: s.id, seed: i + 1 })), p_matches: buildDoubleElim(n, bo) })
      toast(n === 2 ? 'Finále běží!' : `Top ${n} běží!`, 'ok'); location.hash = `#/t/${t.id}/bracket`; reload()
    } catch (e) { toast(errMsg(e), 'err') }
  })
}

// ── losování kola ───────────────────────────────────
function drawRound(d, reload, round) {
  const { t } = d
  let seed = Date.now()
  let result
  const st = new Map(standingsFor(d).map(s => [s.id, s]))
  const dm = t.format === 'deathmatch'
  const make = () => {
    if (dm) { const r = pairRoundRobin({ players: d.players, round, salt: t.id }); result = { pairs: r.pairs, byes: r.byes, rematches: 0 } }
    else { const r = pairSwissRound({ players: d.players, matches: d.matches, round, rng: makeRng(seed), winScore: t.win_score, salt: t.id }); result = { ...r, byes: r.bye ? [r.bye] : [] } }
  }
  try { make() } catch (e) { return toast(e.message, 'err') }

  const body = () => html`
    <h2>${round}. kolo${dm ? ` z ${roundRobinRounds(d.players.filter(p => p.status === 'active' || d.matches.some(m => m.p1_reg === p.id || m.p2_reg === p.id)).length)}` : ' – návrh párování'}</h2>
    ${dm ? html`<p class="muted small">Každý s každým – rozpis je pevný, každá dvojice se potká jednou.</p>`
      : round > 1 ? html`<p class="muted small">Vítězové hrají s vítězi; lichého hráče doplní nejlepší z nižší skupiny. Odvety se vynechávají.</p>` : html`<p class="muted small">První kolo je úplně náhodné.</p>`}
    ${result.rematches ? html`<div class="notice warn">${result.rematches}× odveta – jinak to nešlo spárovat.</div>` : ''}
    <div class="list" style="margin-top:12px">${result.pairs.map(([a, b], i) => html`
      <div class="li small">
        <b class="num" style="width:38px;color:var(--bolt)">A${(i % t.arena_count) + 1}</b>
        <span class="grow ellipsis">${nickOf(d, a)}${round > 1 ? html`<span class="faint"> ${st.get(a)?.main}</span>` : ''}
          <span class="faint"> vs </span>${nickOf(d, b)}${round > 1 ? html`<span class="faint"> ${st.get(b)?.main}</span>` : ''}</span>
        ${i >= t.arena_count ? html`<span class="faint">${Math.floor(i / t.arena_count) + 1}. vlna</span>` : ''}
      </div>`)}
      ${result.byes.map(b => html`<div class="li small"><span class="grow">Volný los (výhra ${t.win_score}:0): <b>${nickOf(d, b)}</b></span></div>`)}
    </div>
    <div class="row" style="margin-top:16px">
      ${dm ? '' : html`<button class="btn grow" data-reroll>Přelosovat</button>`}
      <button class="btn primary grow" data-ok>Potvrdit a vyhlásit</button>
    </div>`

  modal(body(), {
    onMount: (box, close) => {
      on(box, 'click', '[data-reroll]', () => { seed = Date.now() + Math.random() * 1e6; make(); box.innerHTML = body().toString() })
      on(box, 'click', '[data-ok]', async (e, b) => {
        const payload = result.pairs.map(([p1, p2]) => ({ p1, p2 }))
        for (const b of result.byes) payload.push({ p1: b, p2: null })
        await busy(b, async () => {
          try {
            await rpc('create_swiss_round', { p_tournament: t.id, p_round: round, p_pairings: payload })
            close(); toast(`${round}. kolo vyhlášeno – hráči dostanou upozornění.`, 'ok')
            location.hash = `#/t/${t.id}/swiss`; reload()
          } catch (err) { toast(errMsg(err), 'err') }
        })
      })
    },
  })
}

// ── ruční výsledek ──────────────────────────────────
function resultModal(d, m, reload) {
  const { t } = d
  const p1 = nickOf(d, m.p1_reg), p2 = nickOf(d, m.p2_reg)
  modal(html`
    <h2>Výsledek ${m.best_of > 1 ? `${m.p1_wins + m.p2_wins + 1}. hry` : 'zápasu'}</h2>
    <p class="muted small">${matchLabel(m, t.top_cut, t.format)}${m.best_of > 1 ? ` · BO${m.best_of}, zatím ${m.p1_wins}:${m.p2_wins}` : ''}. Vítěz má ${t.win_score} bodů.</p>
    <form class="stack" id="f-res" style="margin-top:12px">
      <div class="grid2">
        <label class="f"><span class="p1c">${p1}</span><input class="input num" name="s1" type="number" min="0" max="${t.win_score}" required inputmode="numeric"></label>
        <label class="f"><span class="p2c">${p2}</span><input class="input num" name="s2" type="number" min="0" max="${t.win_score}" required inputmode="numeric"></label>
      </div>
      <button class="btn primary block">Uložit výsledek</button>
    </form>`, {
    onMount: (box, close) => on(box, 'submit', '#f-res', async (e, f) => {
      e.preventDefault()
      const v = formData(f), s1 = Number(v.s1), s2 = Number(v.s2)
      if (!((s1 === t.win_score && s2 < t.win_score) || (s2 === t.win_score && s1 < t.win_score)))
        return toast(`Jeden hráč musí mít ${t.win_score}, druhý méně.`, 'err')
      await busy(f.querySelector('button'), async () => {
        try {
          const r = await rpc('submit_game', { p_match: m.id, p_p1_score: s1, p_p2_score: s2, p_points: [], p_client_id: crypto.randomUUID() })
          close(); toast(r.match_done ? 'Zápas uzavřen.' : `Uloženo, stav ${r.p1_wins}:${r.p2_wins}.`, 'ok'); reload()
        } catch (err) { toast(errMsg(err), 'err') }
      })
    }),
  })
}

// ── ukončení ────────────────────────────────────────
function finishModal(d, reload) {
  const { t } = d
  const pl = computePlacements({ players: d.players, matches: d.matches, topN: t.status === 'topcut' ? t.top_cut : 0, winScore: t.win_score, salt: t.id })
  modal(html`
    <h2>Konečné pořadí</h2>
    <div class="list">${pl.slice(0, 16).map(p => html`<div class="li small"><span class="place p${p.place}">${p.place}.</span><span class="grow">${nickOf(d, p.reg)}</span></div>`)}</div>
    ${pl.length > 16 ? html`<p class="hint">…a dalších ${pl.length - 16} hráčů podle swissu.</p>` : ''}
    <div class="row" style="margin-top:16px"><button class="btn grow" data-close>Zpět</button><button class="btn primary grow" data-ok>Ukončit a uložit</button></div>`, {
    onMount: (box, close) => on(box, 'click', '[data-ok]', async (e, b) => {
      await busy(b, async () => {
        try {
          await rpc('finish_tournament', { p_tournament: t.id, p_placements: pl }); close(); toast('Turnaj uložen. Gratulace vítězům!', 'ok'); reload()
          if (t.kind === 'tournament') askTournamentChat(t.id)
        }
        catch (err) { toast(errMsg(err), 'err') }
      })
    }),
  })
}

// ── hráč bez telefonu ───────────────────────────────
async function walkinModal(d, reload) {
  let cat
  try { cat = await loadParts() } catch (e) { return toast(errMsg(e), 'err') }
  modal(html`
    <h2>Hráč bez telefonu</h2>
    <form class="stack" id="f-walkin">
      <label class="f"><span>Nick</span><input class="input" name="nick" required minlength="2" maxlength="24"></label>
      ${deckEditor()}
      <button class="btn primary block">Přidat do turnaje</button>
    </form>`, {
    onMount: (box, close) => {
      const getDeck = bindDeckEditor(box.querySelector('[data-deck]'), cat)
      on(box, 'submit', '#f-walkin', async (e, f) => {
        e.preventDefault()
        const nick = formData(f).nick.trim()
        let deck
        try { deck = getDeck() } catch (err) { return toast(err.message, 'err') }
        await busy(f.querySelector('button.primary'), async () => {
          try {
            const rid = await rpc('add_walkin', { p_tournament: d.t.id, p_nick: nick, p_deck: deck })
            // hráče zapisuje organizátor na místě → rovnou zkontrolovaný
            if (rid && d.t.status === 'registration') await rpc('checkin', { p_tournament: d.t.id, p_reg: rid }).catch(() => {})
            close(); toast(`${nick} přidán.`, 'ok'); reload()
          }
          catch (err) { toast(errMsg(err), 'err') }
        })
      })
    },
  })
}

// ── testovací nástroje ──────────────────────────────
const TEST_NAMES = ['Kuba', 'Ondra', 'Tom', 'Matěj', 'Vojta', 'Adam', 'Filip', 'Lukáš', 'Dan', 'Honza', 'Šimon', 'Petr',
  'Kryštof', 'Marek', 'David', 'Eliška', 'Tereza', 'Anna', 'Nela', 'Bára', 'Max', 'Radek', 'Jirka', 'Michal', 'Patrik',
  'Viktor', 'Sam', 'Leo', 'Oliver', 'Ema', 'Klára', 'Zuzka']
const pickRand = (arr) => arr[Math.floor(Math.random() * arr.length)]

async function addTestPlayers(d, n, reload) {
  n = Math.max(1, Math.min(64, n || 16))
  let cat
  try { cat = await loadParts() } catch (e) { return toast(errMsg(e), 'err') }
  const blades = (cat.byCat.blade || []).filter(b => !b.integrated)
  const ratchets = cat.byCat.ratchet || [], bits = (cat.byCat.bit || []).filter(b => !b.integrated)
  if (blades.length < 3 || !ratchets.length || !bits.length) return toast('V katalogu dílů je málo dílů.', 'err')
  const taken = new Set(d.players.map(p => p.nick.toLowerCase()))
  let added = 0
  for (let i = 0; i < n; i++) {
    let nick, k = 0
    do { nick = `T-${pickRand(TEST_NAMES)}${k++ > 3 ? Math.floor(Math.random() * 90 + 10) : ''}` } while (taken.has(nick.toLowerCase()))
    taken.add(nick.toLowerCase())
    const used = new Set()
    const uniq = (list) => { let x, k = 0; do { x = pickRand(list) } while (used.has(x.name) && k++ < 50); used.add(x.name); return x.name }
    const deck = [0, 1, 2].map(() => ({ type: 'bx', blade: uniq(blades), ratchet: uniq(ratchets), bit: uniq(bits) }))
    try {
      const rid = await rpc('add_walkin', { p_tournament: d.t.id, p_nick: nick, p_deck: deck }); added++
      if (rid && d.t.status === 'registration') await rpc('checkin', { p_tournament: d.t.id, p_reg: rid }).catch(() => {})
    }
    catch (e) { toast(errMsg(e), 'err'); break }
  }
  toast(`Přidáno ${added} testovacích hráčů.`, 'ok')
  reload()
}

// rozpad skóre na souboje 1–3 body s náhodnými beyi (jako by zapisoval judge v BBXST)
function fakeBattles(s1, s2, [b1, b2]) {
  const out = []
  let a = 0, b = 0
  while (a < s1 || b < s2) {
    const side = a < s1 && (b >= s2 || Math.random() < 0.5) ? 1 : 2
    const v = Math.min(side === 1 ? s1 - a : s2 - b, [1, 1, 2, 2, 3][Math.floor(Math.random() * 5)])
    if (side === 1) a += v; else b += v
    const finish = v === 3 ? 'xtreme' : v === 1 ? 'spin' : Math.random() < 0.5 ? 'burst' : 'over'
    out.push({ slot: side, pts: v, finish, p1_bey: pickRand(b1.filter(Boolean)), p2_bey: pickRand(b2.filter(Boolean)) })
  }
  return out
}

async function autoPlay(d, reload) {
  const win = d.t.win_score
  const todo = d.matches.filter(m => m.status !== 'done' && m.p1_reg && m.p2_reg)
  let done = 0
  for (const m of todo) {
    let finished = false, guard = 0
    let beys = null
    try { const j = await rpc('judge_get_match', { p_match: m.id }); beys = [j.p1.beys, j.p2.beys] } catch (e) {}
    while (!finished && guard++ < 5) {
      const p1 = Math.random() < 0.5, lo = Math.floor(Math.random() * win)
      try {
        const r = await rpc('submit_game', { p_match: m.id, p_p1_score: p1 ? win : lo, p_p2_score: p1 ? lo : win,
                                             p_points: beys ? fakeBattles(p1 ? win : lo, p1 ? lo : win, beys) : [], p_client_id: crypto.randomUUID() })
        finished = r.match_done
      } catch (e) { toast(errMsg(e), 'err'); finished = true }
    }
    done++
  }
  toast(`Dohráno ${done} zápasů.`, 'ok')
  reload()
}


