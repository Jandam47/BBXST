// ════════════════════════════════════════════════════════════════
//  Katalog dílů (tabulka bey_parts) + našeptávač + editor decku
// ════════════════════════════════════════════════════════════════
import { sb, q } from './supa.js'
import { html, esc, removeAfterTap } from './ui.js'

const CACHE_KEY = 'bbxu_parts_v1'
let catalog = null

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[\s\-_.'’]/g, '')

function buildCatalog(rows) {
  const byCat = {}
  for (const r of rows) {
    r.n = norm(r.name)
    r.na = (r.aliases || []).map(norm)
    ;(byCat[r.category] ||= []).push(r)
  }
  for (const list of Object.values(byCat)) list.sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }))
  return {
    byCat,
    find(cats, text) {
      const t = norm(text)
      if (!t) return null
      for (const c of cats) {
        const hit = (byCat[c] || []).find(r => r.n === t) || (byCat[c] || []).find(r => r.na.includes(t))
        if (hit) return hit
      }
      return null
    },
    search(cats, text, limit = 8) {
      const t = norm(text)
      const all = cats.flatMap(c => byCat[c] || [])
      if (!t) return all.slice(0, limit === Infinity ? all.length : Math.max(limit, 40))
      const scored = []
      for (const r of all) {
        let s = -1
        if (r.n === t) s = 100
        else if (r.abbr && norm(r.abbr) === t) s = 90
        else if (r.n.startsWith(t)) s = 80
        else if (r.name.toLowerCase().split(/\s+/).some(w => norm(w).startsWith(t))) s = 70
        else if (r.n.includes(t)) s = 50
        else if (r.na.some(a => a.startsWith(t))) s = 40
        else if (r.na.some(a => a.includes(t))) s = 30
        if (s >= 0) scored.push([s, r])
      }
      scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, 'cs', { numeric: true }))
      return scored.slice(0, limit).map(x => x[1])
    },
  }
}

export async function loadParts() {
  if (catalog) return catalog
  try {
    const rows = await q(sb.from('bey_parts').select('category,name,abbr,aliases,integrated').eq('active', true).limit(2000))
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)) } catch {}
    catalog = buildCatalog(rows)
  } catch (e) {
    // bez sítě použij poslední stažený seznam
    let rows = null
    try { rows = JSON.parse(localStorage.getItem(CACHE_KEY)) } catch {}
    if (!rows) throw e
    catalog = buildCatalog(rows)
  }
  return catalog
}

// ── název beye (náhled; konečný název skládá databáze stejně) ──
export function composeName(cat, b, { free = false } = {}) {
  if (!b) return null
  const bit = cat.find(['bit'], b.bit)
  let name, prefix = '', integrated = false
  if (b.type === 'cx') {
    const lock = cat.find(['lock_chip'], b.lock), main = cat.find(['main_blade', 'metal_blade'], b.main)
    const assist = cat.find(['assist_blade'], b.assist)
    if (!lock || !main || !assist) return null
    if (main.category === 'metal_blade') {
      const over = cat.find(['over_blade'], b.over)
      if (!over) return null
      prefix = over.abbr || over.name + ' '
    }
    prefix += assist.abbr || assist.name + ' '
    name = `${lock.name} ${main.name}`
  } else {
    const blade = cat.find(['blade'], b.blade)
    if (!blade) return null
    name = blade.name; integrated = blade.integrated
  }
  if (!bit) return null
  integrated = integrated || bit.integrated
  const tail = bit.abbr || ' ' + bit.name
  if (integrated || (free && !String(b.ratchet || '').trim())) return `${name} ${(prefix + tail).trim()}`   // trénink: bez ratchetu
  const r = cat.find(['ratchet'], b.ratchet)
  if (!r) return null
  return `${name} ${(prefix + r.name + tail).trim()}`
}

// ── našeptávač ──────────────────────────────────────────
const LABEL = { blade: 'Blade', lock_chip: 'Lock chip', main_blade: 'Main blade', metal_blade: 'Metal blade',
  over_blade: 'Over blade', assist_blade: 'Assist blade', ratchet: 'Ratchet', bit: 'Bit' }

export function combo({ key, label, cats, value = '', placeholder = '', hidden = false, wheel = false }) {
  if (wheel) return html`<label class="f combo rw-field" data-combo="${key}" data-cats="${cats.join(',')}" data-wheel ${hidden ? 'hidden' : ''}>
    <span>${label}</span>
    <input class="input" value="${value || ''}" placeholder="${placeholder}" readonly inputmode="none" autocomplete="off"
      aria-haspopup="dialog">
  </label>`
  return html`<label class="f combo" data-combo="${key}" data-cats="${cats.join(',')}" ${hidden ? 'hidden' : ''}>
    <span>${label}</span>
    <input class="input" value="${value || ''}" placeholder="${placeholder}" autocomplete="off" autocapitalize="off" spellcheck="false"
      role="combobox" aria-autocomplete="list" aria-expanded="false">
    <ul class="combo-list" role="listbox" hidden></ul>
  </label>`
}

// napojí všechny našeptávače uvnitř root; onPick(el) se volá po výběru / opuštění pole
export function bindCombos(root, cat, onPick = () => {}) {
  let open = null, items = [], active = -1
  const close = () => {
    if (!open) return
    open.querySelector('.combo-list').hidden = true
    open.querySelector('input').setAttribute('aria-expanded', 'false')
    open = null; items = []; active = -1
  }
  const render = (wrap) => {
    const input = wrap.querySelector('input'), list = wrap.querySelector('.combo-list')
    const cats = wrap.dataset.cats.split(',')
    items = cat.search(cats, input.value, cats.includes('ratchet') && !input.value ? Infinity : 8)
    active = items.length ? 0 : -1
    const t = norm(input.value)
    list.innerHTML = items.length ? items.map((r, i) => {
      const viaAlias = t && !r.n.includes(t) && r.na.some(a => a.includes(t))
      return `<li role="option" data-i="${i}" data-name="${esc(r.name)}" class="${i === active ? 'on' : ''}">
        <span>${esc(r.name)}${viaAlias ? ` <small>(${esc(r.aliases.find(a => norm(a).includes(t)))})</small>` : ''}</span>
        <span class="tags">${cats.length > 1 ? `<em>${LABEL[r.category]}</em>` : ''}${r.abbr ? `<b>${esc(r.abbr)}</b>` : ''}${r.integrated ? '<em>s ratchetem</em>' : ''}</span></li>`
    }).join('') : `<li class="none">Nic takového v seznamu není</li>`
    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
    open = wrap
  }
  const highlight = () => open?.querySelectorAll('li[data-i]').forEach(li => {
    const on = Number(li.dataset.i) === active
    li.classList.toggle('on', on)
    if (on) li.scrollIntoView({ block: 'nearest' })
  })
  const pick = (wrap, r) => {
    const input = wrap.querySelector('input')
    input.value = r.name
    wrap.classList.remove('bad'); wrap.classList.add('ok')
    close()
    onPick(wrap)
  }
  const validate = (wrap) => {
    const input = wrap.querySelector('input')
    const r = cat.find(wrap.dataset.cats.split(','), input.value)
    if (r) { input.value = r.name; wrap.classList.add('ok'); wrap.classList.remove('bad') }
    else { wrap.classList.remove('ok'); wrap.classList.toggle('bad', !!input.value.trim()) }
    onPick(wrap)
  }

  root.addEventListener('focusin', (e) => {
    const wrap = e.target.closest('[data-combo]')
    if (wrap && !wrap.hasAttribute('data-wheel') && e.target.tagName === 'INPUT') render(wrap)
  })
  root.addEventListener('input', (e) => {
    const wrap = e.target.closest('[data-combo]')
    if (!wrap || wrap.hasAttribute('data-wheel')) return
    wrap.classList.remove('ok', 'bad')
    render(wrap)
  })
  root.addEventListener('focusout', (e) => {
    const wrap = e.target.closest('[data-combo]')
    if (!wrap) return
    setTimeout(() => { if (!wrap.contains(document.activeElement)) { if (open === wrap) close(); validate(wrap) } }, 120)
  })
  // pointerdown, aby výběr proběhl dřív než blur pole
  root.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.combo-list li[data-i]')
    if (!li) return
    e.preventDefault()
    // podle názvu, ne podle indexu – seznam mohl mezitím překreslit jiné pole
    const wrap = li.closest('[data-combo]')
    const r = cat.find(wrap.dataset.cats.split(','), li.dataset.name)
    if (r) pick(wrap, r)
  })
  root.addEventListener('keydown', (e) => {
    const wrap = e.target.closest('[data-combo]')
    if (!wrap || open !== wrap) return
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); highlight() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight() }
    else if (e.key === 'Enter') { if (active >= 0 && items[active]) { e.preventDefault(); pick(wrap, items[active]) } }
    else if (e.key === 'Escape') close()
    else if (e.key === 'Tab' && active >= 0 && items[active] && wrap.querySelector('input').value.trim()) pick(wrap, items[active])
  })
}

// ── editor decku (turnaj 3 beyblady, fashion N) ───────────
const blankBey = { type: 'bx' }

export function deckEditor(deck, n = 3) {
  const beys = Array.from({ length: n }, (_, i) => ({ ...blankBey, ...((deck || [])[i] || {}) }))
  return html`<div class="deck" data-deck>${beys.map((b, i) => html`
    <fieldset class="bey-card" data-bey="${i}" data-type="${b.type === 'cx' ? 'cx' : 'bx'}">
      <div class="row between">
        <legend>Beyblade ${i + 1}</legend>
        <div class="seg sm" role="radiogroup" aria-label="Typ beyu ${i + 1}">
          <button type="button" data-type-btn="bx" class="${b.type !== 'cx' ? 'on' : ''}">BX/UX</button>
          <button type="button" data-type-btn="cx" class="${b.type === 'cx' ? 'on' : ''}">CX</button>
        </div>
      </div>
      <div class="bx-only">${combo({ key: 'blade', label: 'Blade', cats: ['blade'], value: b.blade, placeholder: 'např. Dran Sword' })}</div>
      <div class="cx-only grid2">
        ${combo({ key: 'lock', label: 'Lock chip', cats: ['lock_chip'], value: b.lock, placeholder: 'např. Dran' })}
        ${combo({ key: 'main', label: 'Main / metal blade', cats: ['main_blade', 'metal_blade'], value: b.main, placeholder: 'např. Brave' })}
        ${combo({ key: 'over', label: 'Over blade', cats: ['over_blade'], value: b.over, placeholder: 'např. Guard', hidden: true })}
        ${combo({ key: 'assist', label: 'Assist blade', cats: ['assist_blade'], value: b.assist, placeholder: 'např. Slash' })}
      </div>
      <div class="grid2">
        ${combo({ key: 'ratchet', label: 'Ratchet', cats: ['ratchet'], value: b.ratchet, placeholder: 'vyber na kolečku', wheel: true })}
        ${combo({ key: 'bit', label: 'Bit', cats: ['bit'], value: b.bit, placeholder: 'vyber na kolečku', wheel: true })}
      </div>
      <div class="bey-preview" aria-live="polite"></div>
    </fieldset>`)}</div>`
}

export function bindDeckEditor(root, cat, { distinct = true, favorites = true, freeRatchet = false } = {}) {
  const nameOpt = { free: freeRatchet }   // trénink: ratchet nepovinný
  const cards = [...root.querySelectorAll('[data-bey]')]
  const val = (card, key) => card.querySelector(`[data-combo="${key}"] input`)?.value.trim() || ''
  const readBey = (card) => card.dataset.type === 'cx'
    ? { type: 'cx', lock: val(card, 'lock'), main: val(card, 'main'), over: val(card, 'over'), assist: val(card, 'assist'), ratchet: val(card, 'ratchet'), bit: val(card, 'bit') }
    : { type: 'bx', blade: val(card, 'blade'), ratchet: val(card, 'ratchet'), bit: val(card, 'bit') }

  const refresh = (card) => {
    const b = readBey(card)
    const isCx = card.dataset.type === 'cx'
    // over blade jen u metal bladu
    const main = isCx ? cat.find(['main_blade', 'metal_blade'], b.main) : null
    card.querySelector('[data-combo="over"]').hidden = !(main && main.category === 'metal_blade')
    // integrovaný ratchet (blade nebo bit) → ratchet se nevyplňuje
    const blade = !isCx ? cat.find(['blade'], b.blade) : null
    const bit = cat.find(['bit'], b.bit)
    const integ = (blade && blade.integrated) || (bit && bit.integrated)
    const rWrap = card.querySelector('[data-combo="ratchet"]'), rIn = rWrap.querySelector('input')
    rIn.disabled = !!(blade && blade.integrated)   // s ratchetem v bitu jde kolečko otevřít a ratchet vrátit
    rIn.placeholder = integ ? (bit && bit.integrated ? `v bitu (${bit.name})` : 'v ceně dílu') : freeRatchet ? 'bez ratchetu · vyber na kolečku' : 'vyber na kolečku'
    if (integ) { rIn.value = ''; rWrap.classList.remove('bad', 'ok') }
    const name = composeName(cat, b, nameOpt)
    card.querySelector('.bey-preview').innerHTML = name ? `→ <b>${esc(name)}</b>` : '<span class="faint">Doplň díly ze seznamu</span>'
    card.classList.toggle('complete', !!name)
  }

  bindCombos(root, cat, (wrap) => refresh(wrap.closest('[data-bey]')))
  const openWheel = (input) => {
    if (input.disabled) return
    const card = input.closest('[data-bey]'), bitIn = card.querySelector('[data-combo="bit"] input')
    ratchetWheel(cat, input.value.trim(), bitIn.value.trim(), (v) => {
      const curBit = cat.find(['bit'], bitIn.value)
      if (v.bit) bitIn.value = v.bit
      else if (curBit?.integrated && !v.none) bitIn.value = ''        // normální ratchet → pryč s Turbo / Operate
      input.value = v.ratchet
      for (const w of [input.closest('[data-combo]'), bitIn.closest('[data-combo]')]) {
        const val = w.querySelector('input').value, ok = cat.find(w.dataset.cats.split(','), val)
        w.classList.toggle('ok', !!ok); w.classList.remove('bad')
      }
      refresh(card)
      input.focus({ preventScroll: true })
    }, { free: freeRatchet })
  }
  const openBit = (input, q = '') => {
    if (document.querySelector('.bw-bg:not(.closing)')) return
    const card = input.closest('[data-bey]')
    bitWheel(cat, input.value.trim(), (name) => {
      input.value = name
      const w = input.closest('[data-combo]')
      w.classList.add('ok'); w.classList.remove('bad')
      refresh(card)
      input.focus({ preventScroll: true })
    }, q)
  }
  const open = (input, q) => input.closest('[data-combo]').dataset.combo === 'bit' ? openBit(input, q) : openWheel(input)
  root.addEventListener('click', (e) => {
    const rIn = e.target.closest('[data-wheel] input')
    if (rIn) { e.preventDefault(); open(rIn) }
  })
  root.addEventListener('keydown', (e) => {
    const rIn = e.target.closest('[data-wheel] input')
    if (!rIn) return
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(rIn) }
    // písmeno na poli bitu → kolečko rovnou s hledáním
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && rIn.closest('[data-combo]').dataset.combo === 'bit') { e.preventDefault(); openBit(rIn, e.key) }
  })
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-type-btn]')
    if (!btn) return
    const card = btn.closest('[data-bey]')
    card.dataset.type = btn.dataset.typeBtn
    card.querySelectorAll('[data-type-btn]').forEach(x => x.classList.toggle('on', x === btn))
    refresh(card)
  })
  cards.forEach(refresh)

  // vyplní kartu i beyem (oblíbené buildy / deck); díly zůstanou upravitelné
  const KEYS = ['blade', 'lock', 'main', 'over', 'assist', 'ratchet', 'bit']
  const setBey = (i, b) => {
    const card = cards[i]
    if (!card || !b) return
    card.dataset.type = b.type === 'cx' ? 'cx' : 'bx'
    card.querySelectorAll('[data-type-btn]').forEach(x => x.classList.toggle('on', x.dataset.typeBtn === card.dataset.type))
    for (const k of KEYS) {
      const w = card.querySelector(`[data-combo="${k}"]`), input = w?.querySelector('input')
      if (!input) continue
      input.value = b[k] || ''
      w.classList.toggle('ok', !!(b[k] && cat.find(w.dataset.cats.split(','), b[k]))); w.classList.remove('bad')
    }
    refresh(card)
    card.classList.add('fav-filled'); setTimeout(() => card.classList.remove('fav-filled'), 900)
  }
  const api = { count: cards.length, setBey, isComplete: (i) => cards[i]?.classList.contains('complete'),
    nameOf: (i) => composeName(cat, readBey(cards[i]), nameOpt) }
  if (favorites) import('./favorites.js').then(m => m.deckToolbar(root, api)).catch(() => {})

  // vrátí deck, nebo vyhodí chybu s popisem, co chybí
  function getDeck() {
    const deck = cards.map(readBey)
    const names = deck.map(b => composeName(cat, b, nameOpt))
    names.forEach((n, i) => {
      if (!n) {
        const card = cards[i]
        card.querySelectorAll('[data-combo]:not([hidden])').forEach(w => {
          const input = w.querySelector('input')
          if (freeRatchet && w.dataset.combo === 'ratchet' && !input.value.trim()) return   // trénink: ratchet nepovinný
          if (!input.disabled && !cat.find(w.dataset.cats.split(','), input.value)) w.classList.add('bad')
        })
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
        throw new Error(`Beyblade ${i + 1}: vyber všechny díly ze seznamu.`)
      }
    })
    if (distinct && new Set(names.map(n => n.toLowerCase())).size < names.length) throw new Error('Každý beyblade musí být jiný.')
    return deck.map(b => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== '')))
  }
  getDeck.setBey = setBey
  return getDeck
}

// ── kolečko ratchetů (stejně jako v BBXST): vnitřní kruh zuby, vnější výška; Turbo / Operate = ratchet v bitu ──
const RW_TEETH = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'M']
const RW_HEIGHTS = ['50', '55', '60', '65', '70', '75', '80', '85']
export function ratchetWheel(cat, cur, curBit, onPick, { free = false } = {}) {
  const have = new Set((cat.byCat.ratchet || []).map(r => r.name))
  const specials = (cat.byCat.bit || []).filter(r => r.integrated)
  const m = /^([0-9M])-(\d+)$/.exec(cur || '')
  let t = m?.[1] ?? null, h = m?.[2] ?? null
  let pickT = false, pickH = false                 // zavře se, až vybereš obě řady (předvyplněné se nepočítá)
  const bg = document.createElement('div')
  bg.className = 'modal-bg rw-bg'
  bg.innerHTML = '<div class="modal rw" role="dialog" aria-modal="true" aria-label="Výběr ratchetu"></div>'
  const box = bg.firstElementChild
  const prevFocus = document.activeElement
  const close = (now) => { now === true ? bg.remove() : removeAfterTap(bg); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.({ preventScroll: true }) }   // klepnutí: ghost click, Esc: hned
  const done = (v) => { close(); onPick(v) }
  // Esc zavře jen kolečko, ne okno pod ním (přidání hráče)
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(true) } }
  const at = (i, n, r) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return `left:${50 + r * Math.cos(a)}%;top:${50 + r * Math.sin(a)}%` }
  const draw = () => {
    const ok = t && h && have.has(`${t}-${h}`)
    box.innerHTML = `<div class="rw-head"><h3>Ratchet</h3><span class="faint small">vnitřní kruh zuby · vnější výška</span></div>
      <div class="rw-dial">
        ${RW_HEIGHTS.map((v, i) => `<button type="button" class="rw-k h ${v === h ? 'on' : ''}" style="${at(i, RW_HEIGHTS.length, 43)}" data-h="${v}"
            ${[...have].some(x => x.endsWith('-' + v) && (!t || x === `${t}-${v}`)) ? '' : 'disabled'} aria-label="výška ${v}">${v}</button>`).join('')}
        ${RW_TEETH.map((v, i) => `<button type="button" class="rw-k t ${v === t ? 'on' : ''}" style="${at(i, RW_TEETH.length, 26.5)}" data-t="${v}"
            ${[...have].some(x => x.startsWith(v + '-')) ? '' : 'disabled'} aria-label="${v === 'M' ? 'zuby M' : `${v} zubů`}">${v}</button>`).join('')}
        <div class="rw-center"><b>${t ?? '?'}-${h ?? '??'}</b><small>${ok ? 'zuby · výška' : t ? 'vyber výšku' : 'vyber zuby'}</small></div>
      </div>
      ${specials.length ? `<div class="rw-specials">${specials.map(r => `<button type="button" class="rw-sp ${norm(curBit) === r.n ? 'on' : ''}" data-sp="${esc(r.name)}">
        ${esc(r.name)}<small>${r.abbr ? esc(r.abbr) + ' · ' : ''}ratchet je v bitu</small></button>`).join('')}</div>` : ''}
      ${free ? `<button type="button" class="rw-none ${!cur && !specials.some(r => norm(curBit) === r.n) ? 'on' : ''}" data-rw-none>Bez ratchetu<small>jen na tréninku</small></button>` : ''}
      <div class="row" style="margin-top:14px">
        <button type="button" class="btn grow" data-rw-back>Zpět</button>
        <button type="button" class="btn primary grow" data-rw-ok ${ok ? '' : 'disabled'}>Použít</button>
      </div>`
    box.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
      t = b.dataset.t; pickT = true
      if (h && !have.has(`${t}-${h}`)) { h = null; pickH = false }
      if (pickH && h) return done({ ratchet: `${t}-${h}` })     // obě řady vybrané → hotovo
      draw()
    })
    box.querySelectorAll('[data-h]').forEach(b => b.onclick = () => {
      h = b.dataset.h; pickH = true
      if (t && !have.has(`${t}-${h}`)) { t = null; pickT = false }
      if (pickT && t) return done({ ratchet: `${t}-${h}` })
      draw()
    })
    box.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => done({ ratchet: '', bit: b.dataset.sp }))
    box.querySelector('[data-rw-none]')?.addEventListener('click', () => done({ ratchet: '', none: true }))
    box.querySelector('[data-rw-ok]').onclick = () => ok && done({ ratchet: `${t}-${h}` })
    box.querySelector('[data-rw-back]').onclick = close
  }
  draw()
  bg.addEventListener('click', (e) => { if (e.target === bg) close() })
  document.addEventListener('keydown', onKey, true)
  document.body.append(bg)
  setTimeout(() => (box.querySelector('.rw-k.on') || box.querySelector('.rw-k.t:not(:disabled)'))?.focus({ preventScroll: true }), 30)
}

// ── kolečko bitů (výseče jako „Založ akci“): uprostřed hledání, okolo všechny bity zkratkou ve třech řadách
//    podle abecedy (vnitřní → vnější); při hledání zhasnou ty, které neodpovídají; Enter / tlačítko uprostřed
//    vezme nejlepší shodu ──
const BW_LENS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>'
const BW_C = 160, BW_RINGS = [[66, 96], [98, 127], [129, 158]], BW_COL = ['var(--cyan)', '#9d7bff', 'var(--magenta)']
function bwSector(r0, r1, a0, a1) {
  const p = (r, d) => { const t = (d - 90) * Math.PI / 180; return `${(BW_C + r * Math.cos(t)).toFixed(2)} ${(BW_C + r * Math.sin(t)).toFixed(2)}` }
  const big = a1 - a0 > 180 ? 1 : 0
  return `M${p(r1, a0)}A${r1} ${r1} 0 ${big} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${p(r0, a0)}Z`
}
export function bitWheel(cat, cur, onPick, startQ = '') {
  const lab = (r) => r.abbr || r.name.slice(0, 2)
  const bits = [...(cat.byCat.bit || [])].sort((a, b) => lab(a).localeCompare(lab(b), 'en', { sensitivity: 'base' }))
  // počty na řadu podle obvodu (vnější řada delší)
  const mids = BW_RINGS.map(([a, b]) => (a + b) / 2), sum = mids.reduce((x, y) => x + y, 0)
  const raw = mids.map(m => bits.length * m / sum), cnt = raw.map(Math.floor)
  raw.map((v, i) => [v - cnt[i], i]).sort((x, y) => y[0] - x[0]).slice(0, bits.length - cnt.reduce((x, y) => x + y, 0)).forEach(([, i]) => cnt[i]++)
  const curR = cat.find(['bit'], cur)
  const score = (r, t) => {
    if (!t) return 1
    const a = norm(r.abbr || '')
    if (a === t) return 100
    if (a && a.startsWith(t)) return 80
    if (r.n.startsWith(t)) return 70
    if (r.name.split(/\s+/).some(w => norm(w).startsWith(t))) return 60
    if (r.na.some(x => x.startsWith(t))) return 40
    return 0
  }
  const bg = document.createElement('div')
  bg.className = 'modal-bg rw-bg bw-bg'
  bg.innerHTML = '<div class="modal rw bw" role="dialog" aria-modal="true" aria-label="Výběr bitu"></div>'
  const box = bg.firstElementChild
  const prevFocus = document.activeElement
  const close = (now) => { now === true ? bg.remove() : removeAfterTap(bg); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.({ preventScroll: true }) }   // klepnutí: ghost click, Esc: hned
  const done = (r) => { close(); onPick(r.name) }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(true) }
    else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.bw-k')) { e.preventDefault(); done(rOf.get(e.target.dataset.bit)) }
  }
  let k0 = 0
  const segs = BW_RINGS.map(([r0, r1], ri) => {
    const list = bits.slice(k0, k0 += cnt[ri]), step = 360 / (list.length || 1), gap = (2.4 / r1) * 180 / Math.PI, rm = (r0 + r1) / 2
    return list.map((r, i) => {
      const mid = i * step, t = (mid - 90) * Math.PI / 180
      const x = (BW_C + rm * Math.cos(t)).toFixed(1), y = (BW_C + rm * Math.sin(t)).toFixed(1), ab = lab(r)
      return `<g class="bw-k r${ri + 1} ${r.integrated ? 'int' : ''} ${r === curR ? 'on' : ''}" data-bit="${esc(r.name)}" data-ab="${esc(ab)}" tabindex="0" role="button"
          aria-label="${esc(r.name)}${r.integrated ? ' (ratchet v bitu)' : ''}" style="--c:${r.integrated ? 'var(--bolt)' : BW_COL[ri]}">
        <title>${esc(r.name)}</title>
        <path d="${bwSector(r0, r1, mid - step / 2 + gap / 2, mid + step / 2 - gap / 2)}"/>
        <text x="${x}" y="${(+y + 5).toFixed(1)}" class="${ab.length > 1 ? 'm' : ''}">${esc(ab)}</text>
      </g>`
    }).join('')
  }).join('')
  box.innerHTML = `<div class="bw-head">
      <button type="button" class="btn sm" data-bw-back>← Zpět</button>
      <h3>Bit</h3>
      <span class="bw-cur">${curR ? esc(curR.name) : ''}</span>
    </div>
    <p class="bw-tip"><b>Tip</b> Hledej písmenkovou zkratkou, je to rychlejší: <span>F</span> Flat · <span>LF</span> Low Flat · <span>GB</span> Gear Ball</p>
    <div class="bw-dial">
      <svg viewBox="0 0 320 320" aria-hidden="false">${segs}</svg>
      <div class="bw-center">
        <label class="bw-search">${BW_LENS}<input class="bw-q" type="search" placeholder="hledat" value="${esc(startQ)}"
          autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="Hledat bit"></label>
        <button type="button" class="bw-best" data-bw-best></button>
      </div>
    </div>`
  const q = box.querySelector('.bw-q'), bestBtn = box.querySelector('[data-bw-best]')
  const keys = [...box.querySelectorAll('[data-bit]')]
  const rOf = new Map(bits.map(r => [r.name, r]))
  let best = null
  const showBest = (r, hint) => {
    bestBtn.disabled = !r
    bestBtn.innerHTML = r ? `<b>${esc(r.name)}</b><small>${r.abbr ? esc(r.abbr) : ''}${r.integrated ? ' · ratchet v bitu' : ''}</small>`
      : `<small>${hint}</small>`
  }
  const filter = () => {
    const t = norm(q.value)
    best = null; let bs = 0, hits = 0
    for (const k of keys) {
      const r = rOf.get(k.dataset.bit), sc = score(r, t)
      k.classList.toggle('off', !sc); k.setAttribute('tabindex', sc ? '0' : '-1')
      if (sc) hits++
      if (t && sc > bs) { bs = sc; best = r }
    }
    if (t && hits === 0) showBest(null, 'nic nenalezeno')
    else if (best) showBest(best)
    else showBest(curR, 'klepni na bit nebo hledej')
    box.querySelector('.bw-dial').classList.toggle('searching', !!t)
  }
  keys.forEach(k => {
    k.onclick = () => done(rOf.get(k.dataset.bit))
    k.onmouseenter = k.onfocus = () => showBest(rOf.get(k.dataset.bit))
    k.onmouseleave = k.onblur = filter
  })
  q.addEventListener('input', filter)
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const r = best || (norm(q.value) ? null : curR); if (r) done(r) } })
  bestBtn.onclick = () => { const r = best || curR; if (r) done(r) }
  box.querySelector('[data-bw-back]').onclick = close
  filter()
  bg.addEventListener('click', (e) => { if (e.target === bg) close() })
  document.addEventListener('keydown', onKey, true)
  document.body.append(bg)
  // klávesnice: hledání hned; na dotyku jen když už se píše (jinak by klávesnice zakryla kolečko)
  if (startQ || matchMedia('(pointer: fine)').matches) { q.focus({ preventScroll: true }); q.setSelectionRange(q.value.length, q.value.length) }
}
