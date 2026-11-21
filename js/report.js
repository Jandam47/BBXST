// ════════════════════════════════════════════════════════════════
//  Nahlášení obsahu (zpráva v chatu, inzerát, komentář v bazaru) a jejich řešení adminem
// ════════════════════════════════════════════════════════════════
import { sb, rpc, errMsg } from './supa.js'
import { html, mount, on, toast, modal, busy, timeAgo, fmtDate } from './ui.js'

export const REASONS = [['spam', 'Spam / reklama'], ['urazky', 'Urážky, šikana'], ['nevhodne', 'Nevhodný obsah'], ['podvod', 'Podvod, padělek'], ['jine', 'Jiné']]
const KIND = { chat_message: 'Zpráva v chatu', bazar_ad: 'Inzerát', bazar_comment: 'Komentář v bazaru' }

export function reportModal(kind, target) {
  modal(html`
    <h2>Nahlásit ${kind === 'bazar_ad' ? 'inzerát' : kind === 'bazar_comment' ? 'komentář' : 'zprávu'}</h2>
    <p class="small muted">Nahlášení uvidí jen admini. Autor se nedozví, kdo ho nahlásil.</p>
    <form id="f-rep" class="stack" style="margin-top:10px">
      <div class="f" role="radiogroup" aria-label="Důvod"><span>Důvod</span>
        ${REASONS.map(([v, l], i) => html`<label class="check"><input type="radio" name="reason" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`)}</div>
      <label class="f"><span>Poznámka pro admina (nepovinné)</span><input class="input" name="note" maxlength="300"></label>
      <div class="row" style="gap:8px"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn danger grow">Nahlásit</button></div>
    </form>`, {
    onMount: (box, close) => on(box, 'submit', '#f-rep', (e, f) => {
      e.preventDefault()
      busy(f.querySelector('button.danger'), async () => {
        try { await rpc('report_create', { p_kind: kind, p_target: String(target), p_reason: f.reason.value, p_note: f.note.value }); close(); toast('Díky, admini se na to podívají.', 'ok') }
        catch (err) { toast(errMsg(err), 'err') }
      })
    }),
  })
}

// přehled pro adminy (profil)
export async function adminReports(box) {
  let list
  try { list = await rpc('report_list', { p_status: 'open' }) } catch { return }
  const reason = (r) => REASONS.find(x => x[0] === r)?.[1] || r
  const link = (r) => r.kind === 'chat_message' ? `#/chat/${r.snapshot.room_id}` : `#/bazar/${r.snapshot.ad_id}`
  const draw = () => mount(box, html`
    <h2>Nahlášený obsah ${list.length ? html`<span class="pill live">${list.length}</span>` : ''}</h2>
    ${list.length ? html`<div class="stack">${list.map(r => html`<div class="card stack rep-card">
      <div class="row between wrap" style="gap:8px"><b>${KIND[r.kind]}${r.count > 1 ? html` <span class="pill">${r.count}× nahlášeno</span>` : ''}</b>
        <span class="small faint">${timeAgo(r.created_at)}</span></div>
      <div class="small muted">Důvod: <b>${reason(r.reason)}</b>${r.note ? ` – ${r.note}` : ''} · nahlásil ${r.reporter?.nick || 'smazaný účet'}</div>
      <blockquote class="rep-quote">${r.snapshot.title ? html`<b>${r.snapshot.title}</b>` : ''}<div class="rq-body">${r.snapshot.body || ''}</div>
        <footer class="small faint">${r.snapshot.nick || '?'} · ${r.snapshot.room || (r.kind === 'bazar_comment' ? 'u inzerátu ' + (r.snapshot.title || '') : 'bazar')} · ${fmtDate(r.snapshot.at)}</footer>
      </blockquote>
      <div class="row wrap" style="gap:8px">
        ${r.exists ? html`<a class="btn sm ghost" href="${link(r)}">Otevřít</a><button class="btn sm danger" data-rdel="${r.id}">Smazat obsah</button>`
          : html`<span class="small muted">Obsah už je smazaný.</span>`}
        <button class="btn sm" data-rkeep="${r.id}">${r.exists ? 'Ponechat' : 'Vyřízeno'}</button></div>
    </div>`)}</div>` : html`<div class="empty">Nic nahlášeného. 👌</div>`}`)
  const resolve = (b, del) => busy(b, async () => {
    try {
      const photos = await rpc('report_resolve', { p_id: Number(b.dataset.rdel || b.dataset.rkeep), p_delete: del })
      if (photos?.length) await sb.storage.from('bazar').remove(photos).catch(() => {})
      toast(del ? 'Obsah je smazaný.' : 'Vyřízeno.', 'ok')
      list = await rpc('report_list', { p_status: 'open' }); draw()
    } catch (err) { toast(errMsg(err), 'err') }
  })
  on(box, 'click', '[data-rdel]', (e, b) => resolve(b, true))
  on(box, 'click', '[data-rkeep]', (e, b) => resolve(b, false))
  draw()
}
