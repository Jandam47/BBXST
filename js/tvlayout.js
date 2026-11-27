// ════════════════════════════════════════════════════════════════
//  Vlastní TV rozpis (okénka) – rozložení jen v tomhle zařízení (localStorage bbxu_tv_layout).
//  Okno = { k: druh, a: aréna (u arénových), x, y, w, h: % obrazovky, z }. Prázdný seznam = výchozí TV.
//  Kreslí je live.js (renderTV, sdílí data Živě); tady je jen úložiště, katalog a okno s přepínači.
// ════════════════════════════════════════════════════════════════
import { html, modal, on } from './ui.js'

const KEY = 'bbxu_tv_layout'
export const ARENA_KINDS = [['arena', 'Aréna', 'hráči, skóre, endy, body'], ['queue', 'Fronta', 'zápasy na řadě'],
  ['feed', 'Dění', 'body a výsledky, jak padají'], ['decks', 'Decky', 'zahrané beye a pool'], ['video', 'Video', 'přenos z Twitche']]
export const GLOBAL_KINDS = [['standings', 'Pořadí', 'kdo jak si vede'], ['bracket', 'Pavouk', 'top cut'],
  ['results', 'Poslední výsledky', ''], ['clock', 'Hodiny a pauza', 'čas, kolo, odpočet pauzy'], ['qr', 'QR na Živě', 'ať si diváci otevřou Živě v telefonu']]
const NAMES = Object.fromEntries([...ARENA_KINDS, ...GLOBAL_KINDS].map(([k, n]) => [k, n]))
const ARENA_SET = new Set(ARENA_KINDS.map(x => x[0]))

export const winKey = (w) => w.a ? `${w.k}:${w.a}` : w.k
export const winTitle = (w) => w.a ? (w.k === 'arena' ? `Aréna ${w.a}` : `${NAMES[w.k]} · aréna ${w.a}`) : NAMES[w.k]
export function loadLayout() {
  try {
    const l = JSON.parse(localStorage.getItem(KEY))
    if (l && Array.isArray(l.wins)) return { wins: l.wins.filter(w => NAMES[w.k] && (!ARENA_SET.has(w.k) || w.a >= 1)) }
  } catch {}
  return { wins: [] }
}
export const saveLayout = (l) => { try { localStorage.setItem(KEY, JSON.stringify({ wins: l.wins })) } catch {} }
export const customOn = () => loadLayout().wins.length > 0

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export function fitWin(w) {                // okno vždy celé na obrazovce
  w.w = clamp(w.w, 8, 100); w.h = clamp(w.h, 8, 100)
  w.x = clamp(w.x, 0, 100 - w.w); w.y = clamp(w.y, 0, 100 - w.h)
  return w
}

// rozmístit všechna okna do mřížky (okna zhruba 16:9, co nejmíň prázdných míst)
export function tile(wins) {
  const n = wins.length; if (!n) return wins
  const W = innerWidth, H = innerHeight
  let best = { cols: 1, score: Infinity }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const score = Math.abs(Math.log((W / cols) / (H / rows) / 1.6)) + (cols * rows - n) * 0.3
    if (score < best.score) best = { cols, score }
  }
  const cols = best.cols, rows = Math.ceil(n / cols), g = 0.6
  wins.forEach((w, i) => {
    const c = i % cols, r = Math.floor(i / cols)
    Object.assign(w, { x: c * 100 / cols + g / 2, y: r * 100 / rows + g / 2, w: 100 / cols - g, h: 100 / rows - g, z: i + 1 })
  })
  return wins
}

// nové okno: kaskádou přes obrazovku, nahoře
function place(wins, w) {
  const k = wins.length % 8
  return fitWin(Object.assign(w, { x: 4 + k * 4, y: 6 + k * 4, w: 34, h: 36, z: Math.max(0, ...wins.map(x => x.z || 0)) + 1 }))
}

// ── okno s přepínači okének ──
// každá změna rozložení → událost bbx:tvlayout (výchozí TV se přepne na okénka a zpět, okénka se překreslí)
export const layoutChanged = () => window.dispatchEvent(new Event('bbx:tvlayout'))
export function customize(arenaCount) {
  const n = Math.max(1, arenaCount || 1)
  const wasEmpty = !customOn()
  const has = (k, a) => loadLayout().wins.some(w => w.k === k && (w.a || 0) === (a || 0))
  const sw = (k, a, label, hint) => html`<label class="tvc-sw"><input type="checkbox" data-k="${k}" data-a="${a || 0}" ${has(k, a) ? 'checked' : ''}>
    <span class="tvc-tg" aria-hidden="true"></span><span><b>${label}</b>${hint ? html`<small>${hint}</small>` : ''}</span></label>`
  modal(html`<h2>Okénka na TV</h2>
    <p class="muted small">Zapni, co chceš na obrazovce vidět. Okénka pak přesuneš a zvětšíš přes <b>✎ Upravit</b> –
      obsah se vždy přizpůsobí velikosti okna. Rozložení si pamatuje jen tohle zařízení.</p>
    <div class="tvc-groups">
      ${Array.from({ length: n }, (_, i) => i + 1).map(a => html`<fieldset class="tvc-grp"><legend>Aréna ${a}</legend>
        ${ARENA_KINDS.map(([k, label, hint]) => sw(k, a, label, hint))}</fieldset>`)}
      <fieldset class="tvc-grp"><legend>Celý turnaj</legend>${GLOBAL_KINDS.map(([k, label, hint]) => sw(k, 0, label, hint))}</fieldset>
    </div>
    <div class="row wrap" style="gap:8px;margin-top:14px">
      <button type="button" class="btn grow" data-tile>▦ Rozmístit</button>
      <button type="button" class="btn grow ghost" data-reset>Výchozí TV</button>
      <button type="button" class="btn grow primary" data-close>Hotovo</button></div>`, {
    onMount: (box, close) => {
      on(box, 'change', 'input[data-k]', (e, cb) => {
        const l = loadLayout(), k = cb.dataset.k, a = Number(cb.dataset.a) || 0
        if (cb.checked) l.wins.push(place(l.wins, a ? { k, a } : { k }))
        else l.wins = l.wins.filter(w => !(w.k === k && (w.a || 0) === a))
        saveLayout(l); layoutChanged()
      })
      on(box, 'click', '[data-tile]', () => { const l = loadLayout(); tile(l.wins); saveLayout(l); layoutChanged() })
      on(box, 'click', '[data-reset]', () => { saveLayout({ wins: [] }); close(); layoutChanged() })
    },
    // první okénka (z výchozí TV) se po zavření rozmístí sama
    onClose: () => { const l = loadLayout(); if (wasEmpty && l.wins.length) { tile(l.wins); saveLayout(l); layoutChanged() } },
  })
}
