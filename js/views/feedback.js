// ════════════════════════════════════════════════════════════════
//  Dotazy a připomínky (29) – #/dotazy. Soukromá zpráva hlavnímu adminovi; odpověď přijde zpět
//  (i push). Hlavní admin tu má schránku: otevřené / vše, odpověď, vyřízeno.
// ════════════════════════════════════════════════════════════════
import { state, rpc, errMsg, isLoggedIn } from '../supa.js'
import { html, mount, on, toast, busy, fmtDateTime } from '../ui.js'
import { commTabs } from './komunikace.js'

const KIND = { question: 'Dotaz', note: 'Připomínka' }
const SEEN = 'bbxu_fb_seen'
export const markFbSeen = (ts) => { try { if (ts && ts > (localStorage.getItem(SEEN) || '')) localStorage.setItem(SEEN, ts) } catch {} ; window.dispatchEvent(new Event('bbx:seen')) }
export const fbSeen = () => { try { return localStorage.getItem(SEEN) || '' } catch { return '' } }

export async function render(main, _, ctx) {
  if (!isLoggedIn() || state.isAnon || !state.profile?.nick) {
    return mount(main, html`${commTabs('fb')}<h1 class="comm-h">Dotazy a připomínky</h1>
      <div class="notice">Napsat hlavnímu adminovi můžou hráči s účtem. <a href="#/login">Přihlásit se</a></div>`)
  }
  return state.level >= 4 ? inbox(main, ctx) : mine(main, ctx)
}

async function mine(main, ctx) {
  let list = await rpc('feedback_mine'), kind = 'question'
  if (!ctx.isCurrent()) return
  const seen = fbSeen()
  const draw = () => {
    mount(main, html`${commTabs('fb')}
      <h1 class="comm-h">Dotazy a připomínky</h1>
      <p class="muted small fb-lead">Zpráva je <b>soukromá</b> – vidí ji jen hlavní admin. Odpověď ti přijde sem (a na telefon, pokud máš zapnutá upozornění).</p>
      <form class="card stack fb-form" id="f-fb">
        <div class="seg sm" role="radiogroup" aria-label="Druh zprávy">
          ${Object.entries(KIND).map(([k, l]) => html`<button type="button" data-kind="${k}" class="${k === kind ? 'on' : ''}" role="radio" aria-checked="${k === kind}">${l}</button>`)}
        </div>
        <textarea class="input" name="body" rows="4" maxlength="2000" required
          placeholder="${kind === 'question' ? 'Na co se chceš zeptat?' : 'Co bychom měli zlepšit nebo opravit?'}"></textarea>
        <button class="btn primary">Odeslat</button>
      </form>
      <h2 class="chat-sec">Moje zprávy</h2>
      ${list.length ? html`<div class="stack">${list.map(f => html`<article class="card fb-item ${f.reply ? 'answered' : ''} ${f.replied_at && f.replied_at > seen ? 'new' : ''}">
          <header class="row between small"><span class="fb-kind ${f.kind}">${KIND[f.kind]}</span><span class="faint">${fmtDateTime(f.created_at)}</span></header>
          <p class="fb-body">${f.body}</p>
          ${f.reply ? html`<div class="fb-reply"><span class="small faint">Odpověď · ${fmtDateTime(f.replied_at)}${f.replied_at > seen ? html` <b class="fb-newtag">nová</b>` : ''}</span><p>${f.reply}</p></div>`
            : html`<p class="small faint">${f.done ? 'Vyřízeno' : 'Čeká na odpověď'}</p>`}
        </article>`)}</div>` : html`<div class="empty small">Zatím jsi nic neposlal.</div>`}`)
  }
  draw()
  markFbSeen(list.map(f => f.replied_at).filter(Boolean).sort().pop())
  on(main, 'click', '[data-kind]', (e) => {
    const ta = main.querySelector('[name=body]'), keep = ta.value
    kind = e.target.closest('[data-kind]').dataset.kind; draw(); main.querySelector('[name=body]').value = keep
  })
  on(main, 'submit', '#f-fb', async (e) => {
    e.preventDefault()
    const f = e.target
    try {
      await busy(f.querySelector('button.primary'), () => rpc('feedback_send', { p_kind: kind, p_body: f.body.value }))
      toast('Odesláno ✓ Díky!')
      list = await rpc('feedback_mine'); if (ctx.isCurrent()) draw()
    } catch (err) { toast(errMsg(err), 'err') }
  })
}

async function inbox(main, ctx) {
  let all = false, list = await rpc('feedback_inbox', { p_all: all })
  if (!ctx.isCurrent()) return
  const draw = () => {
    const open = list.filter(f => !f.done).length
    mount(main, html`${commTabs('fb')}
      <h1 class="comm-h">Dotazy a připomínky</h1>
      <p class="muted small fb-lead">Soukromé zprávy od hráčů – vidíš je jen ty. ${open ? html`<b>${open}</b> čeká na vyřízení.` : 'Všechno vyřízeno.'}</p>
      <nav class="tabs people-tabs"><button class="${all ? '' : 'on'}" data-all="0">Otevřené</button><button class="${all ? 'on' : ''}" data-all="1">Vše</button></nav>
      ${list.length ? html`<div class="stack">${list.map(f => html`<article class="card fb-item ${f.done ? 'done' : ''}" data-fb="${f.id}">
          <header class="row between small">
            <span><span class="fb-kind ${f.kind}">${KIND[f.kind]}</span> ${f.user_id ? html`<a href="#/p/${f.user_id}"><b>${f.nick}</b></a>` : html`<b>${f.nick}</b>`}</span>
            <span class="faint">${fmtDateTime(f.created_at)}</span></header>
          <p class="fb-body">${f.body}</p>
          ${f.reply ? html`<div class="fb-reply"><span class="small faint">Tvoje odpověď · ${fmtDateTime(f.replied_at)}</span><p>${f.reply}</p></div>` : ''}
          <form class="fb-answer" data-answer>
            <textarea class="input" name="reply" rows="2" maxlength="2000" placeholder="${f.reply ? 'Upravit odpověď…' : 'Odpověď hráči…'}"></textarea>
            <div class="row" style="gap:8px">
              <button type="button" class="btn sm ghost" data-done="${f.done ? '0' : '1'}">${f.done ? 'Znovu otevřít' : 'Vyřízeno bez odpovědi'}</button>
              <button class="btn sm primary grow">Odpovědět</button></div>
          </form>
        </article>`)}</div>` : html`<div class="empty small">${all ? 'Zatím žádné zprávy.' : 'Nic nečeká. 👌'}</div>`}`)
  }
  const reload = async () => { list = await rpc('feedback_inbox', { p_all: all }); if (ctx.isCurrent()) { draw(); window.dispatchEvent(new Event('bbx:seen')) } }
  draw()
  on(main, 'click', '[data-all]', async (e) => { all = e.target.dataset.all === '1'; await reload() })
  on(main, 'submit', '[data-answer]', async (e) => {
    e.preventDefault()
    const f = e.target, id = Number(f.closest('[data-fb]').dataset.fb)
    try { await busy(f.querySelector('button.primary'), () => rpc('feedback_reply', { p_id: id, p_reply: f.reply.value })); toast('Odpověď odeslána ✓'); await reload() }
    catch (err) { toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-done]', async (e) => {
    const id = Number(e.target.closest('[data-fb]').dataset.fb)
    try { await rpc('feedback_done', { p_id: id, p_done: e.target.dataset.done === '1' }); await reload() }
    catch (err) { toast(errMsg(err), 'err') }
  })
}
