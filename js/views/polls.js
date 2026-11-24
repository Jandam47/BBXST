// ════════════════════════════════════════════════════════════════
//  Ankety (29) – #/ankety, #/ankety/<id>. Zakládá organizátor+, hlasuje každý s účtem.
//  Volby: časový limit, víc možností, anonymní hlasování. Výsledky po hlasování (autor a admin vždy),
//  po skončení všem. Data jen přes RPC (poll_list / poll_vote / poll_create / poll_close / poll_delete).
// ════════════════════════════════════════════════════════════════
import { state, rpc, errMsg, isLoggedIn } from '../supa.js'
import { html, mount, on, toast, modal, busy, confirmBox, fmtDateTime, plural, raw } from '../ui.js'

const canCreate = () => isLoggedIn() && !state.isAnon && state.level >= 2
const canVote = () => isLoggedIn() && !state.isAnon && !!state.profile?.nick

const DURATIONS = [[15, '15 minut'], [60, '1 hodina'], [180, '3 hodiny'], [720, '12 hodin'], [1440, '1 den'], [4320, '3 dny'], [10080, '1 týden'], [0, 'Vlastní konec…']]

export function leftText(until) {
  const ms = new Date(until) - Date.now()
  if (ms <= 0) return 'končí'
  const m = Math.ceil(ms / 60000)
  if (m < 60) return `zbývá ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `zbývá ${h} h${m % 60 ? ` ${m % 60} min` : ''}`
  const d = Math.floor(h / 24)
  return `zbývá ${plural(d, 'den', 'dny', 'dní')}${h % 24 ? ` ${h % 24} h` : ''}`
}

function pollCard(p, { detail = false, editing = false } = {}) {
  const voted = p.my.length > 0
  const ballot = p.open && canVote() && (!voted || editing)
  const total = p.options.reduce((s, o) => s + (o.votes || 0), 0)
  const max = Math.max(0, ...p.options.map(o => o.votes || 0))
  const status = p.open
    ? html`<span class="poll-st open" data-left="${p.ends_at}">${leftText(p.ends_at)}</span>`
    : html`<span class="poll-st done">Skončila ${fmtDateTime(p.closed_at || p.ends_at)}</span>`
  return html`<article class="card poll ${p.open ? '' : 'ended'}" data-poll="${p.id}">
    <header class="poll-head">
      <h3>${detail ? p.question : html`<a href="#/ankety/${p.id}">${p.question}</a>`}</h3>
      <div class="poll-meta small">${status}
        <span class="poll-tag">${p.multi ? 'víc možností' : 'jedna možnost'}</span>
        <span class="poll-tag ${p.anonymous ? '' : 'pub'}">${p.anonymous ? 'anonymní' : 'veřejné hlasování'}</span></div>
      ${p.note ? html`<p class="poll-note small muted">${p.note}</p>` : ''}
    </header>
    ${ballot ? html`<form class="poll-ballot" data-ballot>
        ${p.options.map(o => html`<label class="poll-opt-in"><input type="${p.multi ? 'checkbox' : 'radio'}" name="opt" value="${o.id}" ${p.my.includes(o.id) ? 'checked' : ''}>
          <span>${o.label}</span></label>`)}
        <div class="row" style="gap:8px;margin-top:10px">
          ${editing ? html`<button type="button" class="btn sm" data-cancel>Zpět</button>` : ''}
          ${editing && voted ? html`<button type="button" class="btn sm ghost" data-withdraw>Zrušit hlas</button>` : ''}
          <button class="btn primary sm grow">${voted ? 'Uložit hlas' : 'Hlasovat'}</button>
        </div>
        ${p.multi ? html`<p class="small faint" style="margin:6px 0 0">Můžeš zaškrtnout víc možností.</p>` : ''}
      </form>`
    : p.results ? html`<ul class="poll-res">${p.options.map(o => {
        const pct = total ? Math.round(100 * o.votes / total) : 0
        const mine = p.my.includes(o.id), win = !p.open && max > 0 && o.votes === max
        return html`<li class="${mine ? 'mine' : ''} ${win ? 'win' : ''}">
          <div class="poll-bar" style="--w:${pct}%"></div>
          <div class="poll-row"><span class="poll-lab">${mine ? html`<b class="poll-check" aria-label="můj hlas">✓</b> ` : ''}${o.label}</span>
            <span class="poll-num">${o.votes} · ${pct} %</span></div>
          ${o.who?.length ? html`<div class="poll-who small faint">${o.who.join(', ')}</div>` : ''}
        </li>`
      })}</ul>`
    : html`<ul class="poll-res hidden-res">${p.options.map(o => html`<li><div class="poll-row"><span class="poll-lab">${o.label}</span></div></li>`)}</ul>
        <p class="small muted">${p.open ? (isLoggedIn() && !state.isAnon ? 'Výsledky uvidíš po hlasování.' : html`Hlasovat můžou hráči s účtem. <a href="#/login">Přihlásit se</a>`) : ''}</p>`}
    <footer class="poll-foot small faint">
      <span>${plural(p.voters, 'hlasující', 'hlasující', 'hlasujících')}${p.author ? ` · založil ${p.author}` : ''}</span>
      <span class="row" style="gap:6px">
        ${p.open && voted && !editing && canVote() ? html`<button class="btn sm ghost" data-edit>Změnit hlas</button>` : ''}
        ${p.can_manage && p.open ? html`<button class="btn sm ghost" data-close>Ukončit</button>` : ''}
        ${p.can_manage ? html`<button class="btn sm ghost danger-t" data-del>Smazat</button>` : ''}
      </span>
    </footer>
  </article>`
}

export async function render(main, [id], ctx) {
  let polls = [], editing = null, showOld = false
  const load = async () => { polls = await rpc('poll_list', { p_poll: id || null }) }
  await load()
  if (!ctx.isCurrent()) return
  const draw = () => {
    const open = polls.filter(p => p.open), done = polls.filter(p => !p.open)
    mount(main, html`
      ${id ? html`<a class="small" href="#/ankety">← Všechny ankety</a>` : html`<div class="row between poll-top">
        <h1 class="comm-h">Ankety</h1>
        ${canCreate() ? html`<button class="btn primary sm" data-new>+ Nová anketa</button>` : ''}</div>`}
      ${id && !polls.length ? html`<div class="empty"><h2>Anketa neexistuje</h2><p class="muted">Možná ji autor smazal.</p></div>` : ''}
      ${id ? polls.map(p => pollCard(p, { detail: true, editing: editing === p.id })) : html`
        ${open.length ? open.map(p => pollCard(p, { editing: editing === p.id }))
          : html`<div class="empty small">Teď neběží žádná anketa.${canCreate() ? ' Založ první tlačítkem nahoře.' : ''}</div>`}
        ${done.length ? html`<h2 class="chat-sec">Skončené</h2>
          ${(showOld ? done : done.slice(0, 5)).map(p => pollCard(p))}
          ${done.length > 5 && !showOld ? html`<button class="btn sm ghost" data-old>Zobrazit starší (${done.length - 5})</button>` : ''}` : ''}`}`)
  }
  draw()
  const reload = async () => { await load(); if (ctx.isCurrent()) draw() }

  on(main, 'submit', '[data-ballot]', async (e) => {
    e.preventDefault()
    const f = e.target, pid = f.closest('[data-poll]').dataset.poll
    const sel = [...f.querySelectorAll('input[name=opt]:checked')].map(x => x.value)
    if (!sel.length) return toast('Vyber aspoň jednu možnost.', 'err')
    try { await busy(f.querySelector('button.primary'), () => rpc('poll_vote', { p_poll: pid, p_options: sel })); editing = null; toast('Hlas uložen ✓'); window.dispatchEvent(new Event('bbx:seen')); await reload() }
    catch (err) { toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-edit]', (e) => { editing = e.target.closest('[data-poll]').dataset.poll; draw() })
  on(main, 'click', '[data-cancel]', () => { editing = null; draw() })
  on(main, 'click', '[data-withdraw]', async (e) => {
    const pid = e.target.closest('[data-poll]').dataset.poll
    try { await rpc('poll_vote', { p_poll: pid, p_options: [] }); editing = null; toast('Hlas zrušen'); window.dispatchEvent(new Event('bbx:seen')); await reload() }
    catch (err) { toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-close]', async (e) => {
    const pid = e.target.closest('[data-poll]').dataset.poll
    if (!await confirmBox('Ukončit anketu teď? Hlasovat už nepůjde a výsledky uvidí všichni.', { ok: 'Ukončit' })) return
    try { await rpc('poll_close', { p_poll: pid }); await reload() } catch (err) { toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-del]', async (e) => {
    const pid = e.target.closest('[data-poll]').dataset.poll
    if (!await confirmBox('Smazat anketu i se všemi hlasy?', { ok: 'Smazat', danger: true })) return
    try { await rpc('poll_delete', { p_poll: pid }); toast('Anketa smazána'); if (id) location.hash = '#/ankety'; else await reload() }
    catch (err) { toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-old]', () => { showOld = true; draw() })
  on(main, 'click', '[data-new]', () => newPollModal((pid) => { location.hash = '#/ankety/' + pid }))

  // odpočet „zbývá …“ a automatické zavření po konci
  const tick = setInterval(() => {
    let ended = false
    main.querySelectorAll('[data-left]').forEach(el => { el.textContent = leftText(el.dataset.left); if (new Date(el.dataset.left) <= Date.now()) ended = true })
    if (ended && !editing) reload()
  }, 20000)
  return () => clearInterval(tick)
}

export function newPollModal(onDone) {
  const optRow = (v = '') => `<div class="poll-opt-edit"><input class="input" name="opt" maxlength="80" placeholder="Možnost" value="${v}"><button type="button" class="btn sm ghost" data-rm aria-label="Odebrat možnost">✕</button></div>`
  modal(html`<form id="f-poll" class="stack">
    <h2>Nová anketa</h2>
    <label class="f"><span>Otázka</span><input class="input" name="question" maxlength="200" required placeholder="Např. Kdy uděláme další trénink?"></label>
    <label class="f"><span>Poznámka (nepovinné)</span><textarea class="input" name="note" maxlength="500" rows="2" placeholder="Doplňující info"></textarea></label>
    <div class="f"><span>Možnosti (2–10)</span><div class="poll-opts">${raw(optRow() + optRow())}</div>
      <button type="button" class="btn sm ghost" data-add style="margin-top:6px">+ Přidat možnost</button></div>
    <label class="f"><span>Délka ankety</span><select class="input" name="dur">${DURATIONS.map(([v, l]) => html`<option value="${v}" ${v === 1440 ? 'selected' : ''}>${l}</option>`)}</select></label>
    <label class="f" data-custom hidden><span>Konec ankety</span><input class="input" type="datetime-local" name="until"></label>
    <label class="check"><input type="checkbox" name="multi"> Hlasovat pro víc možností</label>
    <label class="check"><input type="checkbox" name="anonymous" checked> Anonymní hlasování <span class="small faint">(nikdo neuvidí, kdo jak hlasoval)</span></label>
    <div class="row" style="margin-top:6px"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn primary grow">Založit anketu</button></div>
  </form>`, {
    onMount(box, close) {
      const f = box.querySelector('#f-poll'), opts = f.querySelector('.poll-opts')
      const sync = () => {
        const n = opts.children.length
        f.querySelector('[data-add]').hidden = n >= 10
        opts.querySelectorAll('[data-rm]').forEach(b => { b.disabled = n <= 2 })
      }
      sync()
      on(f, 'click', '[data-add]', () => { opts.insertAdjacentHTML('beforeend', optRow()); sync(); opts.lastElementChild.querySelector('input').focus() })
      on(f, 'click', '[data-rm]', (e) => { if (opts.children.length > 2) { e.target.closest('.poll-opt-edit').remove(); sync() } })
      // Enter v poslední možnosti = další řádek
      on(f, 'keydown', 'input[name=opt]', (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        if (e.target.closest('.poll-opt-edit') === opts.lastElementChild && opts.children.length < 10 && e.target.value.trim()) {
          opts.insertAdjacentHTML('beforeend', optRow()); sync()
        }
        e.target.closest('.poll-opt-edit').nextElementSibling?.querySelector('input').focus()
      })
      const dur = f.querySelector('[name=dur]'), custom = f.querySelector('[data-custom]')
      dur.onchange = () => { custom.hidden = dur.value !== '0' }
      f.onsubmit = async (e) => {
        e.preventDefault()
        let minutes = Number(dur.value)
        if (!minutes) {
          const t = new Date(f.until.value)
          if (!f.until.value || isNaN(t)) return toast('Vyber, kdy má anketa skončit.', 'err')
          minutes = Math.round((t - Date.now()) / 60000)
          if (minutes < 5) return toast('Konec musí být aspoň za 5 minut.', 'err')
        }
        const options = [...opts.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean)
        if (options.length < 2) return toast('Vyplň aspoň 2 možnosti.', 'err')
        try {
          const pid = await busy(f.querySelector('button.primary'), () => rpc('poll_create', {
            p_question: f.question.value, p_options: options, p_multi: f.multi.checked, p_anonymous: f.anonymous.checked,
            p_minutes: minutes, p_note: f.note.value || null }))
          close(); toast('Anketa založena ✓'); onDone?.(pid)
        } catch (err) { toast(errMsg(err), 'err') }
      }
    },
  })
}
