// ════════════════════════════════════════════════════════════════
//  Řízení turnaje (organizátor / admin)
//  registrace → start → swiss kola → top cut → ukončení
// ════════════════════════════════════════════════════════════════
import { sb, rpc, q, errMsg } from '../supa.js'
import { html, mount, on, formData, toast, modal, busy, confirmBox, plural } from '../ui.js'
import { pairSwissRound, makeRng, buildDoubleElim, computePlacements, DEFAULT_BO, matchLabel } from '../core.js'
import { standingsFor, nickOf } from './tournament.js'

export function renderManage(box, { d, reload }) {
  const { t } = d
  const active = d.players.filter(p => p.status === 'active')
  const swiss = d.matches.filter(m => m.stage === 'swiss')
  const roundMs = swiss.filter(m => m.round === t.current_round)
  const roundDone = roundMs.every(m => m.status === 'done')
  const open = d.matches.filter(m => m.status !== 'done' && m.p1_reg && m.p2_reg)
  const allDone = d.matches.length > 0 && d.matches.every(m => m.status === 'done')
  const bracket = d.matches.filter(m => m.stage !== 'swiss')
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
        <p class="muted">${plural(active.length, 'hráč', 'hráči', 'hráčů')} · ${t.swiss_rounds} kol swiss · ${t.top_cut ? `top ${t.top_cut}` : 'bez top cutu'} · ${plural(t.arena_count, 'aréna', 'arény', 'arén')}</p>
        ${t.top_cut > active.length ? html`<div class="notice warn">Top ${t.top_cut} je víc než přihlášených hráčů – před top cutem ho zmenšíš.</div>` : ''}
        <div class="row wrap"><a class="btn" href="#/t/${t.id}/edit">Upravit nastavení</a>
          <button class="btn primary" data-act="start" ${active.length < 2 ? 'disabled' : ''}>Spustit turnaj</button></div>
        <p class="hint">Po startu se uzavře registrace a hráči už nemůžou měnit beyblady.</p>
      </div>
      <form class="card stack" id="f-walkin" data-keep>
        <h3>Přidat hráče bez telefonu</h3>
        <label class="f"><span>Nick</span><input class="input" name="nick" required minlength="2" maxlength="24"></label>
        <div class="grid2" style="grid-template-columns:1fr 1fr 1fr">
          ${[1, 2, 3].map(i => html`<input class="input" name="bey${i}" required placeholder="Beyblade ${i}" maxlength="60">`)}
        </div>
        <button class="btn">Přidat</button>
        <p class="hint">QR kód takového hráče najdeš v záložce Hráči → ⋯.</p>
      </form>`)
    }
  }

  // ── swiss ──────────────────────────────────────
  if (t.status === 'swiss') {
    const next = t.current_round + 1
    const lastDone = t.current_round >= t.swiss_rounds && roundDone
    sections.push(html`<div class="card stack">
      <h3>${t.current_round ? `Kolo ${t.current_round} z ${t.swiss_rounds}` : 'Turnaj běží'}</h3>
      ${t.current_round ? html`<p class="muted">Dohráno ${roundMs.filter(m => m.status === 'done').length} z ${roundMs.length} zápasů.</p>` : ''}
      ${!lastDone ? html`<button class="btn primary" data-act="draw" ${!roundDone ? 'disabled' : ''}>Vylosovat ${next}. kolo</button>
        ${!roundDone ? html`<p class="hint">Další kolo jde vylosovat, až budou dohrané všechny zápasy.</p>` : ''}` : ''}
    </div>`)
    if (lastDone) sections.push(topCutCard(d, active))
  }

  // ── konec ──────────────────────────────────────
  if ((t.status === 'topcut' && allDone) || (t.status === 'swiss' && t.current_round >= t.swiss_rounds && roundDone)) {
    sections.push(html`<div class="card stack">
      <h3>Ukončení turnaje</h3>
      <p class="muted">${t.status === 'topcut' ? 'Grand finále je dohrané.' : 'Swiss je dohraný.'} Ukončením se uloží konečné pořadí do profilů hráčů.</p>
      <button class="btn ${t.status === 'topcut' ? 'primary' : ''}" data-act="finish">${t.status === 'topcut' ? 'Ukončit a uložit turnaj' : 'Ukončit bez top cutu'}</button>
    </div>`)
  }

  // ── rozehrané zápasy ───────────────────────────
  if (open.length) {
    sections.push(html`<h2>Rozehrané a čekající zápasy</h2>
      <div class="list">${open.sort((a, b) => (a.arena || 99) - (b.arena || 99) || (a.wave || 0) - (b.wave || 0)).map(m => html`
        <div class="li">
          <div class="grow">
            <div class="ellipsis" style="font-weight:600">${nickOf(d, m.p1_reg)} <span class="faint">vs</span> ${nickOf(d, m.p2_reg)}</div>
            <div class="small faint">${matchLabel(m, t.top_cut)}${m.best_of > 1 ? ` · BO${m.best_of} (${m.p1_wins}:${m.p2_wins})` : ''}${m.status === 'live' ? ' · hraje se' : ''}</div>
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
          <div class="faint">${matchLabel(m, t.top_cut)}</div></div>
          <button class="btn sm danger" data-reset="${m.id}">Vrátit</button></div>`)}</div>
      <p class="hint">Vrácený zápas se odehraje znovu. V top cutu to jde jen, dokud navazující zápas nezačal.</p></details>`)
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

  on(box, 'click', '[data-act=start]', async (e, b) => {
    if (!await confirmBox(`Spustit turnaj s ${active.length} hráči? Registrace se uzavře.`, { ok: 'Spustit' })) return
    await busy(b, () => act(async () => { await rpc('start_tournament', { p_tournament: t.id }); drawRound(d, reload, 1) }, 'Turnaj běží!'))
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
  on(box, 'submit', '#f-walkin', async (e, f) => {
    e.preventDefault()
    const v = formData(f)
    await busy(f.querySelector('button'), () => act(async () => {
      await rpc('add_walkin', { p_tournament: t.id, p_nick: v.nick.trim(), p_bey1: v.bey1.trim(), p_bey2: v.bey2.trim(), p_bey3: v.bey3.trim() })
      f.reset()
    }, `${v.nick} přidán.`))
  })
  on(box, 'change', '[data-arena]', (e, s) => act(() => q(sb.from('matches').update({ arena: Number(s.value) }).eq('id', s.dataset.arena)), 'Aréna změněna.'))
  on(box, 'click', '[data-result]', (e, b) => resultModal(d, d.matches.find(m => m.id === b.dataset.result), reload))
  on(box, 'click', '[data-reset]', async (e, b) => {
    if (!await confirmBox('Vrátit zápas? Výsledek se smaže a hraje se znovu.', { ok: 'Vrátit', danger: true })) return
    act(() => rpc('reset_match', { p_match: b.dataset.reset }), 'Zápas vrácen.')
  })
  on(box, 'change', '#tc-size', (e, s) => { box.querySelector('#tc-custom').hidden = s.value !== 'custom'; previewSeeds() })
  on(box, 'input', '#tc-custom input', () => previewSeeds())
  on(box, 'click', '[data-act=topcut]', (e, b) => startTopCut(d, box, b, reload))

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
  const def = Math.min(t.top_cut || 0, n)
  const presets = [4, 8, 16, 32].filter(x => x <= n)
  const isPreset = presets.includes(def)
  const bo = { ...DEFAULT_BO, ...(t.bo_config || {}) }
  return html`<div class="card stack">
    <h3>Top cut</h3>
    <p class="muted">Swiss je dohraný. Zkontroluj velikost a spusť vyřazovací pavouk (s loser bracketem).</p>
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
    <div><span class="muted small">Postupují (seed podle swissu):</span><div id="tc-seeds" style="margin-top:6px"></div></div>
    <button class="btn primary" data-act="topcut">Spustit top cut</button>
  </div>`
}
function topSize(box) {
  const s = box.querySelector('#tc-size')?.value
  return s === 'custom' ? Number(box.querySelector('#tc-custom input').value) : Number(s)
}
async function startTopCut(d, box, btn, reload) {
  const { t } = d
  const n = topSize(box)
  const st = standingsFor(d).filter(s => s.status === 'active')
  if (!(n >= 2 && n <= st.length)) return toast(`Top cut musí mít 2 až ${st.length} hráčů.`, 'err')
  const bo = { gf: box.querySelector('#bo-gf').checked ? 3 : 1, lbf: box.querySelector('#bo-lbf').checked ? 3 : 1,
               lbsf: box.querySelector('#bo-lbsf').checked ? 3 : 1, wbf: box.querySelector('#bo-wbf').checked ? 3 : 1, default: 1 }
  if (!await confirmBox(`Spustit top ${n}?`, { ok: 'Spustit' })) return
  await busy(btn, async () => {
    try {
      await rpc('create_topcut', { p_tournament: t.id, p_top: n, p_bo_config: bo,
        p_seeds: st.slice(0, n).map((s, i) => ({ reg: s.id, seed: i + 1 })), p_matches: buildDoubleElim(n, bo) })
      toast(`Top ${n} běží!`, 'ok'); location.hash = `#/t/${t.id}/bracket`; reload()
    } catch (e) { toast(errMsg(e), 'err') }
  })
}

// ── losování kola ───────────────────────────────────
function drawRound(d, reload, round) {
  const { t } = d
  let seed = Date.now()
  let result
  const st = new Map(standingsFor(d).map(s => [s.id, s]))
  const make = () => { result = pairSwissRound({ players: d.players, matches: d.matches, round, rng: makeRng(seed), winScore: t.win_score, salt: t.id }) }
  try { make() } catch (e) { return toast(e.message, 'err') }

  const body = () => html`
    <h2>${round}. kolo – návrh párování</h2>
    ${round > 1 ? html`<p class="muted small">Vítězové hrají s vítězi; lichého hráče doplní nejlepší z nižší skupiny. Odvety se vynechávají.</p>` : html`<p class="muted small">První kolo je úplně náhodné.</p>`}
    ${result.rematches ? html`<div class="notice warn">${result.rematches}× odveta – jinak to nešlo spárovat.</div>` : ''}
    <div class="list" style="margin-top:12px">${result.pairs.map(([a, b], i) => html`
      <div class="li small">
        <b class="num" style="width:38px;color:var(--bolt)">A${(i % t.arena_count) + 1}</b>
        <span class="grow ellipsis">${nickOf(d, a)}${round > 1 ? html`<span class="faint"> ${st.get(a)?.main}</span>` : ''}
          <span class="faint"> vs </span>${nickOf(d, b)}${round > 1 ? html`<span class="faint"> ${st.get(b)?.main}</span>` : ''}</span>
        ${i >= t.arena_count ? html`<span class="faint">${Math.floor(i / t.arena_count) + 1}. vlna</span>` : ''}
      </div>`)}
      ${result.bye ? html`<div class="li small"><span class="grow">Volný los (výhra ${t.win_score}:0): <b>${nickOf(d, result.bye)}</b></span></div>` : ''}
    </div>
    <div class="row" style="margin-top:16px">
      <button class="btn grow" data-reroll>Přelosovat</button>
      <button class="btn primary grow" data-ok>Potvrdit a vyhlásit</button>
    </div>`

  modal(body(), {
    onMount: (box, close) => {
      on(box, 'click', '[data-reroll]', () => { seed = Date.now() + Math.random() * 1e6; make(); box.innerHTML = body().toString() })
      on(box, 'click', '[data-ok]', async (e, b) => {
        const payload = result.pairs.map(([p1, p2]) => ({ p1, p2 }))
        if (result.bye) payload.push({ p1: result.bye, p2: null })
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
    <p class="muted small">${matchLabel(m, t.top_cut)}${m.best_of > 1 ? ` · BO${m.best_of}, zatím ${m.p1_wins}:${m.p2_wins}` : ''}. Vítěz má ${t.win_score} bodů.</p>
    <form class="stack" id="f-res" style="margin-top:12px">
      <div class="grid2">
        <label class="f"><span style="color:#b9d4ff">${p1}</span><input class="input num" name="s1" type="number" min="0" max="${t.win_score}" required inputmode="numeric"></label>
        <label class="f"><span style="color:#ffc2cd">${p2}</span><input class="input num" name="s2" type="number" min="0" max="${t.win_score}" required inputmode="numeric"></label>
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
        try { await rpc('finish_tournament', { p_tournament: t.id, p_placements: pl }); close(); toast('Turnaj uložen. Gratulace vítězům!', 'ok'); reload() }
        catch (err) { toast(errMsg(err), 'err') }
      })
    }),
  })
}
