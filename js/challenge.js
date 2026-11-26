// ════════════════════════════════════════════════════════════════
//  Výzva na komunitním tréninku – vyskakovací okno Přijmout / Odmítnout (BBXU)
//  Ukáže se: realtime (nová výzva), kontrola při startu / návratu do aplikace / každých 20 s,
//  odkaz z notifikace (#/t/<id>/me?vyzva=<výzva>). Přijmout = rovnou BBXST se zápasem.
// ════════════════════════════════════════════════════════════════
import { state, rpc, isLoggedIn, errMsg } from './supa.js'
import { html, modal, toast, busy } from './ui.js'

let open = null                 // { id, close }
const asked = new Set()         // výzvy, které už se v téhle relaci ukázaly (Později = neotravovat znovu)
let timer = null

export const bbxstTraining = (id) => `bbxst.html?training=${id}`

export async function challengePopup(mid, { force = false } = {}) {
  if (!mid || !isLoggedIn() || open?.id === mid) return
  if (!force && asked.has(mid)) return
  let st
  try { st = await rpc('training_state', { p_match: mid }) } catch { return }
  if (st?.status !== 'pending' || st.me !== 2) {
    if (force && st?.status === 'active' && st.me) toast('Výzva už je přijatá – otevři BBXST.', '', 5000)
    else if (force && st?.status === 'declined') toast('Výzva už je odmítnutá.', '', 4000)
    return
  }
  asked.add(mid)
  if (open) open.close()
  const m = modal(html`
    <div class="ch-pop">
      <div class="ch-ico" aria-hidden="true">⚔</div>
      <h2><b>${st.p1.nick}</b> tě vyzývá na souboj</h2>
      <p class="muted small">${st.tournament?.name || 'Komunitní trénink'} · ${(st.settings?.mode || '3v3').replace('v', ' v ')}</p>
      <div class="row ch-btns">
        <button class="btn grow" data-ch="no">Odmítnout</button>
        <button class="btn grow primary" data-ch="yes">Přijmout</button>
      </div>
      <button class="btn ghost sm" data-close>Později</button>
    </div>`, {
    onClose: () => { if (open?.id === mid) open = null },
    onMount: (box, close) => {
      box.querySelector('[data-ch=yes]').onclick = (e) => busy(e.currentTarget, async () => {
        try {
          await rpc('training_respond', { p_match: mid, p_accept: true })
          close(); location.href = bbxstTraining(mid)
        } catch (err) { toast(errMsg(err), 'err'); close() }
      })
      box.querySelector('[data-ch=no]').onclick = (e) => busy(e.currentTarget, async () => {
        try { await rpc('training_respond', { p_match: mid, p_accept: false }); toast('Výzvu jsi odmítl.', '', 3000) }
        catch (err) { toast(errMsg(err), 'err') }
        close()
      })
    },
  })
  open = { id: mid, close: m.close }
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([200, 100, 200])
}

// výzvu mezitím vyřídil někdo jinde (BBXST, notifikace) – okno zavřít
export function challengeResolved(mid) {
  if (open?.id === mid) { open.close(); open = null }
}

// čekající výzvy na mě (my_training) → okno
export async function checkChallenges() {
  if (!isLoggedIn() || !state.myRegs.length || document.hidden) return
  let t
  try { t = await rpc('my_training') } catch { return }
  const inc = (t?.matches || []).find(m => m.incoming && m.status === 'pending' && !asked.has(m.id))
  if (inc) challengePopup(inc.id)
}

// odkaz z notifikace: #/…?vyzva=<id>
export function challengeFromUrl() {
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('vyzva')
  if (id) challengePopup(id, { force: true })
}

export function startChallengeWatch() {
  clearInterval(timer)
  if (!isLoggedIn()) return
  checkChallenges()
  timer = setInterval(checkChallenges, 20000)
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkChallenges() })
