// ════════════════════════════════════════════════════════════════
//  Admin v profilu: chyby z telefonů (admin 3+) a záloha dat (hlavní admin)
// ════════════════════════════════════════════════════════════════
import { rpc, errMsg } from './supa.js'
import { html, mount, on, toast, busy, timeAgo, fmtDateTime, confirmBox } from './ui.js'

const APP = { bbxu: 'BBXU', bbxst: 'BBXST' }
const device = (ua = '') => /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (ua.match(/Android [\d.]+/)?.[0] || 'Android')
  : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : 'jiné'
const browser = (ua = '') => /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox/.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge'
  : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : ''

export async function adminErrors(box) {
  let list
  try { list = await rpc('client_error_list') } catch { return }
  const draw = () => mount(box, html`
    <details class="card err-card" ${list.length ? 'open' : ''}>
      <summary><b>Chyby z telefonů</b> ${list.length ? html`<span class="pill live">${list.length}</span>` : html`<span class="small faint">· nic nového</span>`}</summary>
      ${list.length ? html`
        <div class="stack" style="margin-top:12px">${list.map(e => html`<div class="err-row">
          <div class="row between wrap" style="gap:6px">
            <span><span class="pill ${e.app === 'bbxst' ? 'p2' : ''}">${APP[e.app] || e.app}</span>${e.count > 1 ? html` <b class="num">${e.count}×</b>` : ''}</span>
            <span class="small faint">${timeAgo(e.last_at)}</span>
          </div>
          <div class="err-msg">${e.message}</div>
          <div class="small muted">${[e.url, device(e.ua) + (browser(e.ua) ? ' · ' + browser(e.ua) : ''), e.version, e.user?.nick].filter(Boolean).join(' · ')}</div>
          ${e.stack ? html`<details class="small"><summary class="faint">Podrobnosti</summary><pre class="err-stack">${e.stack}</pre></details>` : ''}
          <button class="btn sm" data-eok="${e.id}">Vyřešeno</button>
        </div>`)}</div>
        <div class="row" style="margin-top:12px"><button class="btn sm ghost" data-eall>Vyřešit všechny</button></div>
        <p class="hint">Stejná chyba se jen počítá. Když se po vyřešení objeví znovu, přijde jako nová.</p>`
      : html`<p class="small muted" style="margin-top:10px">Aplikace na telefonech zatím nic nenahlásily.</p>`}
    </details>`)
  const resolve = (b, id) => busy(b, async () => {
    try { await rpc('client_error_resolve', { p_id: id }); list = await rpc('client_error_list'); draw() }
    catch (err) { toast(errMsg(err), 'err') }
  })
  on(box, 'click', '[data-eok]', (e, b) => resolve(b, Number(b.dataset.eok)))
  on(box, 'click', '[data-eall]', async (e, b) => { if (await confirmBox('Označit všechny chyby jako vyřešené?', { ok: 'Vyřešit' })) resolve(b, null) })
  draw()
}

export const BACKUP_DAYS = 14
export const backupDue = (last) => !last || Date.now() - new Date(last).getTime() > BACKUP_DAYS * 864e5

export async function adminBackup(box) {
  let last
  try { last = await rpc('backup_status') } catch { return }
  const draw = () => mount(box, html`
    <div class="card stack backup-card ${backupDue(last) ? 'due' : ''}">
      <div class="row between wrap" style="gap:8px;align-items:center">
        <b>Záloha dat</b>
        <span class="small ${backupDue(last) ? 'warn-t' : 'faint'}">${last ? `naposledy ${fmtDateTime(last)}` : 'zatím žádná'}</span>
      </div>
      ${backupDue(last) ? html`<p class="small">Od poslední zálohy uběhlo víc než ${BACKUP_DAYS} dní. Stáhni si novou a ulož ji mimo telefon (disk, cloud).</p>` : ''}
      <button class="btn ${backupDue(last) ? 'primary' : ''}" data-backup>Stáhnout zálohu (JSON)</button>
      <p class="hint">Obsahuje turnaje, hráče, decky, zápasy, souboje, komunity, chat a bazar. Fotky z bazaru, e-maily a hesla v ní nejsou.</p>
    </div>`)
  on(box, 'click', '[data-backup]', (e, b) => busy(b, async () => {
    try {
      const data = await rpc('export_backup')
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `bbxu-zaloha-${new Date().toISOString().slice(0, 10)}.json`
      document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      const n = Object.values(data.counts || {}).reduce((s, x) => s + x, 0)
      toast(`Záloha stažená (${n} řádků, ${(blob.size / 1024 / 1024).toFixed(1)} MB).`, 'ok')
      last = data.created_at; draw()
    } catch (err) { toast(errMsg(err), 'err') }
  }))
  draw()
}
