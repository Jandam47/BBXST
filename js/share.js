// ════════════════════════════════════════════════════════════════
//  Sdílení výsledků skončeného turnaje: obrázek 1080×1350 (Instagram / Discord) + text ke zkopírování.
// ════════════════════════════════════════════════════════════════
import { html, mount, on, toast, modal, fmtDate } from './ui.js'

const W = 1080, H = 1350
const MEDAL = ['🥇', '🥈', '🥉']
const PLACE_COL = ['#ffe14a', '#cfe3f0', '#ff9a5a']

const ranked = (d) => d.players.filter(p => p.final_place && p.status !== 'withdrawn').sort((a, b) => a.final_place - b.final_place)
const fmtLine = (t) => [t.starts_at ? fmtDate(t.starts_at) : null, t.location].filter(Boolean).join(' · ')

export function resultsText(d) {
  const t = d.t, top = ranked(d).slice(0, 8)
  const url = location.origin + location.pathname + `#/t/${t.id}`
  return [
    `🏆 ${t.name}`,
    fmtLine(t) ? `📅 ${fmtLine(t)}` : null,
    `👥 ${d.players.filter(p => p.status === 'active').length} hráčů · ${t.format === 'deathmatch' ? 'Deathmatch' : 'Klasika 3v3'}`,
    '',
    ...top.map(p => `${MEDAL[p.final_place - 1] || '▪️'} ${p.final_place}. ${p.nick}`),
    top[0] && [top[0].bey1, top[0].bey2, top[0].bey3].some(Boolean) ? `\nDeck vítěze: ${[top[0].bey1, top[0].bey2, top[0].bey3].filter(Boolean).join(' / ')}` : '',
    '',
    `Výsledky: ${url}`,
    '#BeybladeX #BBXUnity',
  ].filter(x => x !== null && x !== undefined && x !== false).join('\n').replace(/\n{3,}/g, '\n\n')
}

const loadImg = (src) => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src })
function fit(ctx, text, max, font) {           // zmenší písmo, aby se text vešel na šířku
  let size = font.size
  do { ctx.font = `${font.weight} ${size}px ${font.family}`; size -= 2 } while (ctx.measureText(text).width > max && size > 18)
}

export async function resultsImage(d) {
  await document.fonts?.ready
  const t = d.t, top = ranked(d).slice(0, 8)
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const x = c.getContext('2d')
  const DISP = "'Chakra Petch', system-ui, sans-serif", BODY = "'Barlow', system-ui, sans-serif"

  // pozadí: černá, mřížka, azurová a purpurová záře
  x.fillStyle = '#03060d'; x.fillRect(0, 0, W, H)
  const g1 = x.createRadialGradient(140, 120, 0, 140, 120, 700); g1.addColorStop(0, 'rgba(0,229,255,.22)'); g1.addColorStop(1, 'rgba(0,229,255,0)')
  const g2 = x.createRadialGradient(W - 100, H - 160, 0, W - 100, H - 160, 760); g2.addColorStop(0, 'rgba(255,43,214,.20)'); g2.addColorStop(1, 'rgba(255,43,214,0)')
  x.fillStyle = g1; x.fillRect(0, 0, W, H); x.fillStyle = g2; x.fillRect(0, 0, W, H)
  x.strokeStyle = 'rgba(0,229,255,.06)'; x.lineWidth = 1
  for (let i = 0; i <= W; i += 54) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke() }
  for (let i = 0; i <= H; i += 54) { x.beginPath(); x.moveTo(0, i); x.lineTo(W, i); x.stroke() }
  // HUD rohy
  x.strokeStyle = '#00e5ff'; x.lineWidth = 6
  for (const [cx, cy, dx, dy] of [[40, 40, 1, 1], [W - 40, 40, -1, 1], [40, H - 40, 1, -1], [W - 40, H - 40, -1, -1]]) {
    x.beginPath(); x.moveTo(cx, cy + 70 * dy); x.lineTo(cx, cy); x.lineTo(cx + 70 * dx, cy); x.stroke()
  }

  // hlavička: nápis BBX Unity, název, datum
  const mark = await loadImg('icons/bbxunity-wordmark.webp')
  if (mark) { const h = 92, w = mark.width * h / mark.height; x.drawImage(mark, (W - w) / 2, 84, w, h) }
  x.textAlign = 'center'; x.fillStyle = '#ffffff'
  fit(x, t.name, W - 160, { weight: 700, size: 76, family: DISP }); x.fillText(t.name, W / 2, 278)
  x.font = `500 34px ${BODY}`; x.fillStyle = 'rgba(200,230,255,.75)'
  x.fillText([fmtLine(t), `${d.players.filter(p => p.status === 'active').length} hráčů`].filter(Boolean).join('  ·  '), W / 2, 332)

  // vítěz
  let y = 400
  if (top[0]) {
    x.fillStyle = 'rgba(255,225,74,.08)'; x.fillRect(90, y, W - 180, 250)
    x.strokeStyle = '#ffe14a'; x.lineWidth = 3; x.strokeRect(90, y, W - 180, 250)
    x.font = `700 30px ${DISP}`; x.fillStyle = '#ffe14a'; x.fillText('VÍTĚZ', W / 2, y + 56)
    fit(x, top[0].nick, W - 260, { weight: 700, size: 92, family: DISP }); x.fillStyle = '#ffffff'; x.fillText(top[0].nick, W / 2, y + 150)
    const beys = [top[0].bey1, top[0].bey2, top[0].bey3].filter(Boolean)
    if (beys.length) { fit(x, beys.join('  /  '), W - 260, { weight: 600, size: 30, family: BODY }); x.fillStyle = 'rgba(200,230,255,.8)'; x.fillText(beys.join('  /  '), W / 2, y + 210) }
    y += 300
  }
  // další místa
  x.textAlign = 'left'
  const rest = top.slice(1)
  const step = Math.min(90, (H - 150 - y) / Math.max(1, rest.length)), rh = step - 12, fs = Math.round(rh * 0.55)
  for (const p of rest) {
    const i = p.final_place - 1
    x.fillStyle = 'rgba(255,255,255,.035)'; x.fillRect(90, y, W - 180, rh)
    x.fillStyle = PLACE_COL[i] || '#00e5ff'; x.fillRect(90, y, 8, rh)
    x.font = `700 ${fs}px ${DISP}`; x.fillText(`${p.final_place}.`, 130, y + rh / 2 + fs * 0.36)
    x.fillStyle = '#ffffff'; fit(x, p.nick, W - 400, { weight: 600, size: fs + 2, family: BODY }); x.fillText(p.nick, 230, y + rh / 2 + fs * 0.36)
    y += step
  }
  // patička
  x.textAlign = 'center'; x.font = `600 28px ${BODY}`; x.fillStyle = 'rgba(0,229,255,.85)'
  x.fillText('BBX Unity · Beyblade X turnaje', W / 2, H - 80)
  return new Promise(r => c.toBlob(r, 'image/png'))
}

export async function shareResultsModal(d) {
  const { box, close } = modal(html`<h2>Sdílet výsledky</h2><div class="spinner" aria-label="Připravuji obrázek"></div>`)
  const text = resultsText(d)
  const blob = await resultsImage(d)
  const url = URL.createObjectURL(blob)
  const file = new File([blob], `vysledky-${d.t.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.png`, { type: 'image/png' })
  const canShareFile = !!navigator.canShare?.({ files: [file] })
  mount(box, html`
    <h2>Sdílet výsledky</h2>
    <img class="share-img" src="${url}" alt="Obrázek s výsledky turnaje ${d.t.name}">
    <div class="row wrap" style="gap:8px;margin-top:12px">
      ${canShareFile ? html`<button class="btn primary grow" data-sh="share">Sdílet obrázek</button>` : ''}
      <a class="btn grow ${canShareFile ? '' : 'primary'}" href="${url}" download="${file.name}">Stáhnout obrázek</a>
      <button class="btn grow" data-sh="copy">Kopírovat text</button>
    </div>
    <details class="share-text"><summary>Text výsledků</summary><pre>${text}</pre></details>
    <button class="btn ghost block" style="margin-top:10px" data-close>Zavřít</button>`)
  on(box, 'click', '[data-sh=share]', async () => {
    try { await navigator.share({ files: [file], text, title: d.t.name }) }
    catch (e) { if (e?.name !== 'AbortError') toast('Sdílení se nepovedlo – obrázek stáhni.', 'err') }
  })
  on(box, 'click', '[data-sh=copy]', async () => {
    try { await navigator.clipboard.writeText(text); toast('Text je zkopírovaný.', 'ok') }
    catch { toast('Kopírování nejde – označ text ručně.', 'err'); box.querySelector('.share-text').open = true }
  })
  const obs = new MutationObserver(() => { if (!document.body.contains(box)) { URL.revokeObjectURL(url); obs.disconnect() } })
  obs.observe(document.body, { childList: true })
  return close
}
