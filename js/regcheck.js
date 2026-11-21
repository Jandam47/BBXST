// ════════════════════════════════════════════════════════════════
//  Kontrola registrací (organizátor / admin, turnaj v registraci) – záložka Hráči.
//  Načíst QR vstupenky (nebo klepnout na hráče) → jméno + 3 beyblady k odškrtnutí → Potvrdit registraci.
//  Stav: zelená = zkontrolováno (registrations.checked_in_at), žlutá = čeká, červená = vyřazen (status dropped).
//  Turnaj jde spustit až po kontrole všech (nebo „Spustit bez kontroly“ s varováním v Řízení).
//  Vstupné (28): u turnaje se vstupným je v kontrole i „Zaplatil vstupné“ (pay_set). Pokladník, který turnaj
//  neřídí, vidí jen vstupné: payPanel + payModal, sken QR otevře rovnou zápis platby.
// ════════════════════════════════════════════════════════════════
import { rpc, sb, q, errMsg } from './supa.js'
import { html, mount, on, modal, toast, busy, fmtTime } from './ui.js'

export const regState = (p, checkin) => p.status === 'dropped' ? 'out' : checkin?.get(p.id) ? 'ok' : 'wait'

export function regCounts(players, checkin) {
  const c = { ok: 0, wait: 0, out: 0 }
  for (const p of players) c[regState(p, checkin)]++
  return c
}

export function regCheckPanel(d) {
  const c = regCounts(d.players, d.checkin)
  const all = c.ok + c.wait
  return html`<div class="card stack rc-panel">
    <div class="row between wrap" style="gap:8px;align-items:center">
      <h3 style="margin:0">Kontrola registrací</h3>
      <span class="rc-sum"><b class="num">${c.ok}</b> / ${all} zkontrolováno</span>
    </div>
    <div class="ci-bar" role="img" aria-label="Zkontrolováno ${c.ok} z ${all}"><i style="width:${all ? (100 * c.ok / all).toFixed(1) : 0}%"></i></div>
    <div class="rc-legend small"><span class="rc-dot ok"></span>zkontrolováno ${c.ok}<span class="rc-dot wait"></span>čeká ${c.wait}<span class="rc-dot out"></span>vyřazeno ${c.out}</div>
    ${d.pay ? payLine(d) : ''}
    <button class="btn primary" data-rc="scan">📷 Načíst QR kód</button>
    <p class="hint" style="margin:0">Nebo klepni na hráče v seznamu. Dokud nejsou zkontrolovaní všichni, turnaj nejde spustit.</p>
  </div>`
}

// vstupné: kolik zaplatilo z aktivních hráčů
export function payCounts(d) {
  const act = d.players.filter(p => p.status !== 'dropped')
  const paid = act.filter(p => d.pay?.get(p.id)).length
  return { paid, all: act.length }
}
const payLine = (d) => {
  const { paid, all } = payCounts(d)
  return html`<div class="pay-sum small">💰 Vstupné${d.t.entry_fee ? ` ${d.t.entry_fee} Kč` : ''}: zaplaceno <b class="num">${paid}</b> / ${all}${d.t.entry_fee && paid ? html` · vybráno <b class="num">${paid * d.t.entry_fee} Kč</b>` : ''}</div>`
}
export function payPanel(d) {
  const { paid, all } = payCounts(d)
  return html`<div class="card stack rc-panel">
    <div class="row between wrap" style="gap:8px;align-items:center">
      <h3 style="margin:0">Vstupné</h3>
      <span class="rc-sum"><b class="num">${paid}</b> / ${all} zaplaceno</span>
    </div>
    <div class="ci-bar" role="img" aria-label="Zaplaceno ${paid} z ${all}"><i style="width:${all ? (100 * paid / all).toFixed(1) : 0}%"></i></div>
    ${d.t.entry_fee ? html`<div class="pay-sum small">💰 ${d.t.entry_fee} Kč za hráče · vybráno <b class="num">${paid * d.t.entry_fee} Kč</b> · chybí ${all - paid}</div>` : ''}
    <button class="btn primary" data-rc="scan">📷 Načíst QR kód</button>
    <p class="hint" style="margin:0">Nebo klepni na hráče v seznamu a zaškrtni, že zaplatil.</p>
  </div>`
}
// zaškrtávátko „Zaplatil vstupné“ – zapisuje se hned
const payBox = (d, p) => {
  const v = d.pay?.get(p.id)
  return html`<label class="pay-check ${v ? 'on' : ''}"><input type="checkbox" data-pay ${v ? 'checked' : ''}>
    <span>💰 Zaplatil vstupné${d.t.entry_fee ? ` (${d.t.entry_fee} Kč)` : ''}${v ? html`<small>${fmtTime(v.at)}${v.by ? ` · ${v.by}` : ''}</small>` : ''}</span></label>`
}
function bindPay(box, d, p, onDone) {
  on(box, 'change', '[data-pay]', async (e, cb) => {
    cb.disabled = true
    try {
      const r = await rpc('pay_set', { p_tournament: d.t.id, p_reg: p.id, p_on: cb.checked })
      if (r.paid_at) d.pay.set(p.id, { at: r.paid_at, by: null }); else d.pay.delete(p.id)
      cb.closest('.pay-check').classList.toggle('on', cb.checked)
      toast(cb.checked ? `${p.nick} zaplatil vstupné.` : 'Platba zrušena.', 'ok')
      onDone?.()
    } catch (err) { cb.checked = !cb.checked; toast(errMsg(err), 'err') }
    cb.disabled = false
  })
}

// jen vstupné (pokladník)
export function payModal(d, p, reload) {
  const { box, close } = modal(html`
    <div class="rc-head rc-${d.pay?.get(p.id) ? 'ok' : 'wait'}">
      <span class="av">${p.avatar || '👤'}</span>
      <div class="grow" style="min-width:0"><h2 class="ellipsis" style="margin:0">${p.nick}</h2>
        <span class="small">${p.status === 'dropped' ? '✕ vyřazen' : d.pay?.get(p.id) ? 'vstupné zaplaceno' : 'vstupné nezaplaceno'}</span></div>
    </div>
    <div style="margin-top:14px">${payBox(d, p)}</div>
    <button class="btn ghost block" data-close style="margin-top:14px">Zpět</button>`)
  let changed = false
  bindPay(box, d, p, () => { changed = true })
  const obs = new MutationObserver(() => { if (!box.isConnected) { obs.disconnect(); if (changed) reload() } })
  obs.observe(document.body, { childList: true })
  return close
}

// kontrola jednoho hráče
export function checkModal(d, p, reload) {
  const { t } = d
  const beys = [p.bey1, p.bey2, p.bey3].filter(Boolean)
  const st = regState(p, d.checkin)
  const at = d.checkin?.get(p.id)
  const { box, close } = modal(html`
    <div class="rc-head rc-${st}">
      <span class="av">${p.avatar || '👤'}</span>
      <div class="grow" style="min-width:0"><h2 class="ellipsis" style="margin:0">${p.nick}</h2>
        <span class="small">${st === 'ok' ? `✓ zkontrolováno ${fmtTime(at)}` : st === 'out' ? '✕ vyřazen – nenastoupí' : 'čeká na kontrolu'}</span></div>
    </div>
    ${st === 'out' ? '' : html`
      <p class="small muted" style="margin:12px 0 6px">${st === 'ok' ? 'Beyblady byly zkontrolované:' : 'Odškrtni beyblady, které hráč opravdu má:'}</p>
      <div class="rc-beys">${beys.length ? beys.map((b, i) => html`<label class="rc-bey">
        <input type="checkbox" data-bey="${i}" ${st === 'ok' ? 'checked disabled' : ''}><span>${b}</span></label>`)
        : html`<p class="small faint">Hráč nemá vyplněné beyblady.</p>`}</div>`}
    ${d.pay && st !== 'out' ? html`<div style="margin-top:12px">${payBox(d, p)}</div>` : ''}
    <div class="stack" style="margin-top:16px">
      ${st === 'wait' ? html`<button class="btn primary block" data-rc="ok" ${beys.length ? 'disabled' : ''}>Potvrdit registraci</button>` : ''}
      ${st === 'ok' ? html`<button class="btn block" data-rc="undo">Zrušit kontrolu</button>` : ''}
      ${st === 'out' ? html`<button class="btn block" data-rc="back">Vrátit do turnaje</button>`
        : html`<button class="btn danger block" data-rc="drop">Vyřadit – nenastoupí</button>`}
      <button class="btn ghost block" data-close>Zpět</button>
    </div>`)
  const okBtn = box.querySelector('[data-rc=ok]')
  on(box, 'change', '[data-bey]', () => {
    if (okBtn) okBtn.disabled = [...box.querySelectorAll('[data-bey]')].some(c => !c.checked)
  })
  const run = (b, fn, msg) => busy(b, async () => {
    try { await fn(); toast(msg, 'ok'); paid = false; close(); reload() } catch (err) { toast(errMsg(err), 'err') }
  })
  // zaplaceno se zapíše hned; seznam se obnoví po zavření okna
  let paid = false
  if (d.pay) bindPay(box, d, p, () => { paid = true })
  const obs = new MutationObserver(() => { if (!box.isConnected) { obs.disconnect(); if (paid) reload() } })
  obs.observe(document.body, { childList: true })
  on(box, 'click', '[data-rc=ok]', (e, b) => run(b, async () => {
    const r = await rpc('checkin', { p_tournament: t.id, p_reg: p.id, p_on: true })
    d.checkin?.set(p.id, r.checked_in_at)
  }, `${p.nick} je zkontrolovaný.`))
  on(box, 'click', '[data-rc=undo]', (e, b) => run(b, async () => {
    await rpc('checkin', { p_tournament: t.id, p_reg: p.id, p_on: false }); d.checkin?.delete(p.id)
  }, 'Kontrola zrušena.'))
  on(box, 'click', '[data-rc=drop]', (e, b) => run(b, async () => {
    await q(sb.from('registrations').update({ status: 'dropped' }).eq('id', p.id))
  }, `${p.nick} je vyřazený.`))
  on(box, 'click', '[data-rc=back]', (e, b) => run(b, async () => {
    await q(sb.from('registrations').update({ status: 'active' }).eq('id', p.id))
  }, `${p.nick} je zpět v turnaji.`))
  return close
}

// ── skener QR vstupenek ────────────────────────────
let qrLib = null
const loadQrLib = () => qrLib || (qrLib = new Promise((ok, bad) => {
  if (window.Html5Qrcode) return ok()
  const s = document.createElement('script')
  s.src = './vendor/html5-qrcode.min.js'; s.onload = () => ok(); s.onerror = () => { qrLib = null; bad(new Error('Skener se nenačetl.')) }
  document.head.append(s)
}))
const QR_RE = /^BBXU1\|([0-9a-f-]{36})\|([0-9a-f-]{36})$/i

// načte vstupenku a otevře kontrolu toho hráče
export function scanModal(d, reload, { payOnly = false } = {}) {
  const { t } = d
  let scanner = null, busyScan = false
  const { box, close } = modal(html`
    <h2 style="margin-top:0">Načíst QR kód</h2>
    <div id="ci-reader" class="ci-reader"></div>
    <div id="ci-last" class="ci-last" aria-live="polite">Namiř kameru na QR kód vstupenky.</div>
    <div class="row" style="margin-top:12px">
      <label class="btn grow" style="text-align:center">🖼 Z obrázku<input type="file" accept="image/*" id="ci-file" hidden></label>
      <button class="btn ghost grow" data-close>Zpět</button>
    </div>`, { dismissable: true })
  const last = box.querySelector('#ci-last')
  const show = (cls, txt) => { last.className = `ci-last ${cls}`; last.textContent = txt }
  const stop = async () => { try { if (scanner?.isScanning) await scanner.stop() } catch {} }
  const handle = async (txt) => {
    if (busyScan) return
    const m = QR_RE.exec(String(txt).trim())
    if (!m) return show('err', 'Tohle není vstupenka BBXU.')
    if (m[1] !== t.id) return show('err', 'Vstupenka je na jiný turnaj.')
    busyScan = true
    try {
      const reg = await rpc('checkin_lookup', { p_tournament: t.id, p_token: m[2] })
      const p = d.pmap.get(reg) || d.players.find(x => x.id === reg)
      if (!p) throw new Error('Hráč v seznamu není – obnov stránku.')
      navigator.vibrate?.(60)
      await stop(); close()
      ;(payOnly ? payModal : checkModal)(d, p, reload)
    } catch (err) { show('err', errMsg(err)); busyScan = false }
  }
  loadQrLib().then(async () => {
    if (!box.isConnected) return
    scanner = new window.Html5Qrcode('ci-reader')
    try { await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, handle) }
    catch { show('err', 'Kamera nedostupná – povol ji v prohlížeči, nebo načti QR z obrázku.') }
  }).catch(err => show('err', err.message))
  box.querySelector('#ci-file').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''
    if (!f || !scanner) return
    await stop()
    try { await handle(await scanner.scanFile(f, false)) } catch { show('err', 'V obrázku jsem QR kód nenašel.') }
  }
  const obs = new MutationObserver(() => { if (!box.isConnected) { obs.disconnect(); stop() } })
  obs.observe(document.body, { childList: true })
}
