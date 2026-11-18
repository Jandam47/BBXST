// ════════════════════════════════════════════════════════════════
//  UI pomocníci: bezpečné šablony, modaly, toasty, QR, formáty
// ════════════════════════════════════════════════════════════════

class Raw { constructor(s) { this.s = s } toString() { return this.s } }
export const raw = (s) => new Raw(String(s))

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const renderVal = (v) => {
  if (v == null || v === false || v === true) return ''
  if (v instanceof Raw) return v.s
  if (Array.isArray(v)) return v.map(renderVal).join('')
  return esc(v)
}
// html`…${hodnota}…` – vše se escapuje, kromě výsledků jiného html`` / raw()
export function html(strings, ...vals) {
  let out = strings[0]
  vals.forEach((v, i) => { out += renderVal(v) + strings[i + 1] })
  return new Raw(out)
}

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

export function mount(el, content) { el.innerHTML = renderVal(content) }

// delegované události: on(root, 'click', '[data-act=save]', fn)
export function on(root, type, sel, fn) {
  const h = (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t) }
  root.addEventListener(type, h)
  return () => root.removeEventListener(type, h)
}

export function formData(form) {
  const o = {}
  for (const el of form.elements) {
    if (!el.name) continue
    if (el.type === 'checkbox') o[el.name] = el.checked
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value }
    else o[el.name] = el.value
  }
  return o
}

// ── toast ─────────────────────────────────────────────
export function toast(msg, kind = '', ms = 3800) {
  let box = $('.toasts')
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box) }
  const t = document.createElement('div')
  t.className = 'toast ' + kind
  t.innerHTML = renderVal(msg)
  box.append(t)
  setTimeout(() => t.remove(), ms)
}

// ── modal ─────────────────────────────────────────────
export function modal(content, { onMount, dismissable = true } = {}) {
  const bg = document.createElement('div')
  bg.className = 'modal-bg'
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${renderVal(content)}</div>`
  document.body.append(bg)
  const box = bg.firstElementChild
  let closed = false
  const close = () => { if (closed) return; closed = true; bg.remove(); document.removeEventListener('keydown', esc_) }
  const esc_ = (e) => { if (e.key === 'Escape' && dismissable) close() }
  document.addEventListener('keydown', esc_)
  if (dismissable) bg.addEventListener('click', e => { if (e.target === bg) close() })
  on(box, 'click', '[data-close]', close)
  const first = box.querySelector('input,select,textarea,button')
  if (first) setTimeout(() => first.focus(), 30)
  onMount?.(box, close)
  return { box, close }
}

export function confirmBox(text, { ok = 'Potvrdit', danger = false } = {}) {
  return new Promise(res => {
    const { close } = modal(html`
      <p style="font-size:17px">${text}</p>
      <div class="row" style="margin-top:20px">
        <button class="btn grow" data-no>Zpět</button>
        <button class="btn grow ${danger ? 'danger' : 'primary'}" data-yes>${ok}</button>
      </div>`, {
      onMount: (box, close) => {
        box.querySelector('[data-yes]').onclick = () => { close(); res(true) }
        box.querySelector('[data-no]').onclick = () => { close(); res(false) }
      },
    })
    void close
  })
}

// tlačítko během async akce
export async function busy(btn, fn) {
  if (!btn) return fn()
  const old = btn.innerHTML
  btn.disabled = true
  btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;margin:0;border-width:2px"></span>'
  try { return await fn() } finally { btn.disabled = false; btn.innerHTML = old }
}

// ── QR (vendor/qrcode.js) ─────────────────────────────
export function qrSvg(text) {
  const q = window.qrcode(0, 'M')
  q.addData(text)
  q.make()
  return raw(q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }))
}
export function qrPng(text, size = 8) {
  const q = window.qrcode(0, 'M'); q.addData(text); q.make()
  return q.createDataURL(size, 4)
}

// ── formáty ───────────────────────────────────────────
const dtf = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })
const tf = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
export const fmtDate = (d) => d ? dtf.format(new Date(d)) : ''
export const fmtTime = (d) => d ? tf.format(new Date(d)) : ''
export const fmtDateTime = (d) => d ? `${fmtDate(d)}, ${fmtTime(d)}` : ''
export function timeAgo(d) {
  const s = (Date.now() - new Date(d)) / 1000
  if (s < 60) return 'teď'
  if (s < 3600) return `před ${Math.floor(s / 60)} min`
  if (s < 86400) return `před ${Math.floor(s / 3600)} h`
  return fmtDate(d)
}
// datetime-local ↔ ISO
export const toLocalInput = (d) => {
  if (!d) return ''
  const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset())
  return x.toISOString().slice(0, 16)
}
export const fromLocalInput = (v) => v ? new Date(v).toISOString() : null

export const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`

export const STATUS = {
  registration: { label: 'Registrace otevřená', cls: 'reg' },
  swiss: { label: 'Probíhá swiss', cls: 'live' },
  topcut: { label: 'Probíhá top cut', cls: 'live' },
  finished: { label: 'Ukončeno', cls: 'done' },
  canceled: { label: 'Zrušeno', cls: 'cancel' },
}
export const statusPill = (t) => {
  const s = t.kind === 'event' && t.status === 'registration' ? { label: 'Přihlašování', cls: 'reg' } : STATUS[t.status] || STATUS.registration
  return html`<span class="pill ${s.cls}">${s.label}</span>`
}

export const AVATARS = ['🌀', '⚔️', '🐉', '🦅', '🦈', '🐺', '🦁', '🐍', '🦂', '🔥', '⚡', '❄️', '🌪️', '🌑', '☀️', '💎',
  '🗡️', '🛡️', '👑', '🎯', '🚀', '🤖', '👾', '🧿']
