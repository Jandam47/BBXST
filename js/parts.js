// ════════════════════════════════════════════════════════════════
//  Katalog dílů (tabulka bey_parts) + našeptávač + editor decku
// ════════════════════════════════════════════════════════════════
import { sb, q } from './supa.js'
import { html, esc } from './ui.js'

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
export function composeName(cat, b) {
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
  if (integrated) return `${name} ${(prefix + tail).trim()}`
  const r = cat.find(['ratchet'], b.ratchet)
  if (!r) return null
  return `${name} ${(prefix + r.name + tail).trim()}`
}

// ── našeptávač ──────────────────────────────────────────
const LABEL = { blade: 'Blade', lock_chip: 'Lock chip', main_blade: 'Main blade', metal_blade: 'Metal blade',
  over_blade: 'Over blade', assist_blade: 'Assist blade', ratchet: 'Ratchet', bit: 'Bit' }

export function combo({ key, label, cats, value = '', placeholder = '', hidden = false }) {
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
      return `<li role="option" data-i="${i}" class="${i === active ? 'on' : ''}">
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
    if (wrap && e.target.tagName === 'INPUT') render(wrap)
  })
  root.addEventListener('input', (e) => {
    const wrap = e.target.closest('[data-combo]')
    if (!wrap) return
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
    pick(li.closest('[data-combo]'), items[Number(li.dataset.i)])
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

// ── editor decku (3 beyblady) ─────────────────────────────
const blankBey = { type: 'bx' }

export function deckEditor(deck) {
  const beys = [0, 1, 2].map(i => ({ ...blankBey, ...((deck || [])[i] || {}) }))
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
        ${combo({ key: 'ratchet', label: 'Ratchet', cats: ['ratchet'], value: b.ratchet, placeholder: 'např. 3-60' })}
        ${combo({ key: 'bit', label: 'Bit', cats: ['bit'], value: b.bit, placeholder: 'např. Flat / F' })}
      </div>
      <div class="bey-preview" aria-live="polite"></div>
    </fieldset>`)}</div>`
}

export function bindDeckEditor(root, cat) {
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
    rIn.disabled = !!integ
    rIn.placeholder = integ ? 'v ceně dílu' : 'např. 3-60'
    if (integ) { rIn.value = ''; rWrap.classList.remove('bad', 'ok') }
    const name = composeName(cat, b)
    card.querySelector('.bey-preview').innerHTML = name ? `→ <b>${esc(name)}</b>` : '<span class="faint">Doplň díly ze seznamu</span>'
    card.classList.toggle('complete', !!name)
  }

  bindCombos(root, cat, (wrap) => refresh(wrap.closest('[data-bey]')))
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-type-btn]')
    if (!btn) return
    const card = btn.closest('[data-bey]')
    card.dataset.type = btn.dataset.typeBtn
    card.querySelectorAll('[data-type-btn]').forEach(x => x.classList.toggle('on', x === btn))
    refresh(card)
  })
  cards.forEach(refresh)

  // vrátí deck, nebo vyhodí chybu s popisem, co chybí
  return function getDeck() {
    const deck = cards.map(readBey)
    const names = deck.map(b => composeName(cat, b))
    names.forEach((n, i) => {
      if (!n) {
        const card = cards[i]
        card.querySelectorAll('[data-combo]:not([hidden])').forEach(w => {
          const input = w.querySelector('input')
          if (!input.disabled && !cat.find(w.dataset.cats.split(','), input.value)) w.classList.add('bad')
        })
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
        throw new Error(`Beyblade ${i + 1}: vyber všechny díly ze seznamu.`)
      }
    })
    if (new Set(names.map(n => n.toLowerCase())).size < 3) throw new Error('Každý beyblade musí být jiný.')
    return deck.map(b => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== '')))
  }
}
