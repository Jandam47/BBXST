// ════════════════════════════════════════════════════════════════
//  Instalace aplikací na plochu (profil): BBXU a BBXST zvlášť.
//  Každá má vlastní manifest s oddělenou platností (scope index.html / bbxst.html),
//  takže jdou nainstalovat obě. BBXST se instaluje na své stránce (bbxst.html?install=1).
//  beforeinstallprompt zachytává už inline skript v index.html (window.__bip).
// ════════════════════════════════════════════════════════════════
import { html, mount, on, toast } from './ui.js'

const ua = navigator.userAgent
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true
const IOS_STEPS = 'v Safari klepni na Sdílet (čtvereček se šipkou) → Přidat na plochu'

let installedNow = false   // jen v tomhle otevření – trvalý příznak by lhal po odinstalaci

export function installCard(box) {
  const draw = () => {
    const bip = window.__bip
    const inBbxu = standalone()
    const done = installedNow
    mount(box, html`
      <h3 style="margin:0">Aplikace na plochu</h3>
      <p class="small muted" style="margin:4px 0 12px">Každá aplikace má vlastní ikonu a otevře se bez lišty prohlížeče. BBXST se otevře přes celou obrazovku na výšku, otočit jde tlačítkem v jeho menu.</p>
      <div class="inst-row">
        <img src="icons/bbxu-192.png" alt="" width="44" height="44">
        <div class="grow"><b>BBX Unity</b><small>turnaje, registrace, profil, chat</small></div>
        ${inBbxu ? html`<span class="pill ok">✓ Používáš ji</span>`
          : bip ? html`<button class="btn primary sm" data-inst="bbxu">Instalovat</button>`
          : done ? html`<span class="pill ok">✓ Nainstalováno</span>`
          : html`<button class="btn sm" data-inst="bbxu-help">Jak?</button>`}
      </div>
      <div class="inst-row">
        <img src="icons/icon-192.png" alt="" width="44" height="44">
        <div class="grow"><b>BBXST</b><small>počítadlo skóre, judge a trénink</small></div>
        <a class="btn ${inBbxu || !bip ? 'primary' : ''} sm" href="bbxst.html?install=1" data-inst="bbxst">Instalovat</a>
      </div>
      <p class="hint" id="inst-hint">${isIOS
        ? `Na iPhonu: otevři aplikaci a ${IOS_STEPS}. BBXST stejně – tlačítko Instalovat ho otevře.`
        : 'BBXST se nainstaluje na své stránce – tlačítko ji otevře a nabídne instalaci.'}</p>`)
  }
  on(box, 'click', '[data-inst=bbxu]', async () => {
    const bip = window.__bip
    if (!bip) return draw()
    bip.prompt()
    const { outcome } = await bip.userChoice.catch(() => ({}))
    window.__bip = null
    if (outcome === 'accepted') { installedNow = true; toast('BBX Unity je na ploše.', 'ok') }
    draw()
  })
  on(box, 'click', '[data-inst=bbxu-help]', () => {
    box.querySelector('#inst-hint').textContent = isIOS
      ? `Na iPhonu: ${IOS_STEPS}.`
      : 'V menu prohlížeče (⋮ vpravo nahoře) zvol Nainstalovat aplikaci nebo Přidat na plochu. Když tam není, aplikaci už nejspíš máš.'
  })
  const redraw = () => box.isConnected ? draw() : (removeEventListener('bbx:installable', redraw), removeEventListener('appinstalled', installed))
  const installed = () => { installedNow = true; redraw() }
  addEventListener('bbx:installable', redraw)
  addEventListener('appinstalled', installed)
  draw()
}
