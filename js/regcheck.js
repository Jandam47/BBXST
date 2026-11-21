// ════════════════════════════════════════════════════════════════
//  Kontrola registrací (organizátor / admin, turnaj v registraci) – záložka Hráči.
//  Načíst QR vstupenky (nebo klepnout na hráče) → jméno + 3 beyblady k odškrtnutí → Potvrdit registraci.
//  Stav: zelená = zkontrolováno (registrations.checked_in_at), žlutá = čeká, červená = vyřazen (status dropped).
//  Turnaj jde spustit až po kontrole všech (nebo „Spustit bez kontroly“ s varováním v Řízení).
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
    <button class="btn primary" data-rc="scan">📷 Načíst QR kód</button>
    <p class="hint" style="margin:0">Nebo klepni na hráče v seznamu. Dokud nejsou zkontrolovaní všichni, turnaj nejde spustit.</p>
  </div>`
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
    try { await fn(); toast(msg, 'ok'); close(); reload() } catch (err) { toast(errMsg(err), 'err') }
  })
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
export function scanModal(d, reload) {
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
      checkModal(d, p, reload)
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
