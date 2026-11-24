// ════════════════════════════════════════════════════════════════
//  Komunikace – rozcestník (kolečko jako „Založ akci“): Chat · Ankety · Nápověda · Dotazy a připomínky.
//  Záložka Komunikace v dolní liště otevře #/komunikace a s ním kolečko; po zavření zůstane rozcestník.
// ════════════════════════════════════════════════════════════════
import { state } from '../supa.js'
import { html, mount, on, raw } from '../ui.js'
import { ICONS } from '../icons.js'
import { openCreateWheel } from '../create-wheel.js'

const boss = () => state.level >= 4

export const ITEMS = () => [
  { key: 'chat', label: 'Chat', icon: 'chat', color: 'var(--cyan)', go: '#/chat', text: 'Zkušební chat, info k turnajům, komunitní chat' },
  { key: 'polls', label: 'Ankety', icon: 'poll', color: 'var(--bolt)', go: '#/ankety', text: 'Hlasování s časovým limitem' },
  { key: 'help', label: 'Nápověda', icon: 'help', color: 'var(--magenta)', go: '#/help', text: 'Jak na registraci, turnaj, judge, trénink…' },
  { key: 'fb', label: 'Dotazy a připomínky', short: 'Dotazy', icon: 'mail', color: '#9d7bff', go: '#/dotazy',
    text: boss() ? 'Zprávy od hráčů – jen pro tebe' : 'Soukromá zpráva hlavnímu adminovi' },
]

export function openCommWheel() {
  return openCreateWheel({ label: 'Komunikace', children: ITEMS() }, { title: 'Komunikace', hint: 'Kam chceš jít?', label: 'Komunikace' })
}

// přepínač mezi částmi Komunikace (nahoře v chatu, anketách a dotazech)
export const commTabs = (on_) => html`<nav class="tabs people-tabs comm-tabs" aria-label="Komunikace">
  <a href="#/chat" class="${on_ === 'chat' ? 'on' : ''}">Chat</a>
  <a href="#/ankety" class="${on_ === 'polls' ? 'on' : ''}">Ankety</a>
  <a href="#/dotazy" class="${on_ === 'fb' ? 'on' : ''}">Dotazy</a>
  <a href="#/help">Nápověda</a></nav>`

export async function render(main) {
  mount(main, html`
    <h1 class="comm-h">Komunikace</h1>
    <div class="comm-grid">${ITEMS().map(it => html`<a class="card comm-card" href="${it.go}" style="--c:${it.color}">
      <span class="comm-ico">${raw(ICONS[it.icon])}</span>
      <b>${it.label}</b><span class="small muted">${it.text}</span></a>`)}</div>
    <button class="btn ghost sm comm-wheel-btn" data-wheel-open>Otevřít kolečko</button>`)
  on(main, 'click', '[data-wheel-open]', () => openCommWheel())
  const close = openCommWheel()
  return () => close?.()
}
