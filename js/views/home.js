// ════════════════════════════════════════════════════════════════
//  Hlavní stránka (turnaje a akce) + formulář pro založení / úpravu
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, q, errMsg, isLoggedIn, canManage } from '../supa.js'
import { html, mount, on, formData, toast, busy, statusPill, fmtDate, fmtTime, toLocalInput, fromLocalInput, plural } from '../ui.js'
import { DEFAULT_BO, FORMATS } from '../core.js'

export async function renderList(main, _p, ctx) {
  const all = await rpc('tournament_list')
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
      if (ql && !(`${t.name} ${t.location || ''} ${t.organizer_nick || ''}`.toLowerCase().includes(ql))) return false
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
    <a class="card t-card ${t.kind === 'event' ? 'is-event' : ''} ${['swiss', 'topcut'].includes(t.status) ? 'is-live' : ''}" href="#/t/${t.id}">
      <div class="row between"><span class="t-date">${t.starts_at ? `${fmtDate(t.starts_at)} · ${fmtTime(t.starts_at)}` : 'Termín upřesníme'}</span>${statusPill(t)}</div>
      <h3>${t.name}</h3>
      <div class="meta">
        <span>${t.kind === 'event' ? 'Akce' : 'Turnaj'}</span>
        ${t.location ? html`<span>📍 ${t.location}</span>` : ''}
        <span>👥 ${plural(Number(t.players), 'hráč', 'hráči', 'hráčů')}${t.max_players ? ` / ${t.max_players}` : ''}</span>
        ${mine.has(t.id) ? html`<span style="color:var(--bolt)">✓ Jsi přihlášený</span>` : ''}
      </div>
    </a>`

  mount(main, html`
    ${callHtml}
    <div class="row between wrap" style="gap:12px">
      <h1>Turnaje a akce</h1>
      ${state.level >= 2 ? html`<div class="row"><a class="btn sm" href="#/new/event">+ Akce</a><a class="btn primary sm" href="#/new">+ Turnaj</a></div>` : ''}
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
            format: 'swiss', unique_parts: true }
  if (id) {
    t = await q(sb.from('tournaments').select('*').eq('id', id).single())
    if (!canManage(t)) { mount(main, html`<div class="notice err">Tenhle turnaj nemůžeš upravovat.</div>`); return }
  }
  const started = id && t.status !== 'registration'
  const isEv = t.kind === 'event'
  const topPreset = [0, 4, 8, 16, 32].includes(t.top_cut) ? String(t.top_cut) : 'custom'
  const bo = { ...DEFAULT_BO, ...(t.bo_config || {}) }

  mount(main, html`
    <a class="small muted" href="${id ? `#/t/${id}` : '#/'}">← Zpět</a>
    <h1 style="margin-top:8px">${id ? 'Upravit' : 'Nový'} ${isEv ? 'akci' : 'turnaj'}</h1>
    <form class="stack" id="f-t" style="margin-top:16px">
      <div class="card stack">
        <label class="f"><span>Název</span><input class="input" name="name" required minlength="3" maxlength="80" value="${t.name}"></label>
        <div class="grid2 dates">
          <label class="f"><span>Začátek</span><input class="input" type="datetime-local" name="starts_at" value="${toLocalInput(t.starts_at)}" required></label>
          <label class="f"><span>Konec (nepovinné)</span><input class="input" type="datetime-local" name="ends_at" value="${toLocalInput(t.ends_at)}"></label>
        </div>
        <label class="f"><span>Místo</span><input class="input" name="location" maxlength="120" value="${t.location || ''}" placeholder="Klub, adresa"></label>
        <label class="f"><span>Popis</span><textarea class="input" name="description" maxlength="2000" placeholder="Pravidla, startovné, co si vzít s sebou…">${t.description || ''}</textarea></label>
        <label class="f"><span>Maximální počet hráčů (nepovinné)</span><input class="input" type="number" min="2" max="512" name="max_players" value="${t.max_players || ''}"></label>
      </div>
      ${isEv ? '' : html`
      <div class="card stack">
        <h3>Formát</h3>
        <div class="formats">
          ${FORMATS.map(f => html`<label class="format-opt">
            <input type="radio" name="format" value="${f.key}" ${t.format === f.key ? 'checked' : ''} ${started ? 'disabled' : ''}>
            <span><b>${f.label}</b><small>${f.desc}</small></span></label>`)}
        </div>
        <label class="check"><input type="checkbox" name="unique_parts" ${t.unique_parts ? 'checked' : ''} ${started ? 'disabled' : ''}> Žádný díl se v decku nesmí opakovat</label>
        <p class="hint" style="margin-top:-6px">Hlídá blade, ratchet, bit i díly CX (lock chip, main, over a assist blade).</p>
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
                                         format: d.format || 'swiss', unique_parts: !!d.unique_parts })
      if (row.format === 'deathmatch' && !started) Object.assign(row, { top_cut: 0 })
      if (row.top_cut === 1 || row.top_cut < 0) return toast('Top cut musí mít aspoň 2 hráče, nebo 0.', 'err')
    } else {
      Object.assign(row, { swiss_rounds: 1, top_cut: 0 })
    }
    await busy(f.querySelector('button.primary'), async () => {
      try {
        const saved = id
          ? await q(sb.from('tournaments').update(row).eq('id', id).select('id').single())
          : await q(sb.from('tournaments').insert(row).select('id').single())
        toast(id ? 'Uloženo.' : (isEv ? 'Akce je vypsaná.' : 'Turnaj je vypsaný.'), 'ok')
        location.hash = '#/t/' + saved.id
      } catch (err) { toast(errMsg(err), 'err') }
    })
  })
}
