// ════════════════════════════════════════════════════════════════
//  Komunikace – kolečko (jako „Založ akci“): Chat · Ankety · Nápověda · Dotazy a připomínky.
//  Záložka Komunikace v dolní liště ho otevře nad aktuální stránkou (bez přechodu); výseče ukazují
//  počet nového (unread.js). Adresa #/komunikace (odkazy) kolečko otevře a po zavření jde na hlavní stránku.
// ════════════════════════════════════════════════════════════════
import { state } from '../supa.js'
import { html, mount } from '../ui.js'
import { openCreateWheel } from '../create-wheel.js'
import { unreadCounts } from '../unread.js'

const ITEMS = () => {
  const c = unreadCounts()
  return [
    { key: 'chat', label: 'Chat', icon: 'chat', color: 'var(--cyan)', go: '#/chat', badge: c.chat },
    { key: 'polls', label: 'Ankety', icon: 'poll', color: 'var(--bolt)', go: '#/ankety', badge: c.polls },
    { key: 'help', label: 'Nápověda', icon: 'help', color: 'var(--magenta)', go: '#/help' },
    { key: 'fb', label: state.level >= 4 ? 'Dotazy a připomínky (schránka)' : 'Dotazy a připomínky', short: 'Dotazy',
      icon: 'mail', color: '#9d7bff', go: '#/dotazy', badge: c.fb },
  ]
}

export function openCommWheel(onClose) {
  if (document.querySelector('.cw-overlay:not(.closing)')) return
  const close = openCreateWheel({ label: 'Komunikace', children: ITEMS() }, { title: 'Komunikace', hint: 'Kam chceš jít?', label: 'Komunikace' })
  // zavření bez výběru (střed, Esc, klik vedle) – výběr mění adresu, ten se pozná podle hashchange
  if (onClose) {
    const h = location.hash
    const ov = document.querySelector('.cw-overlay:not(.closing)')
    new MutationObserver((_, mo) => { if (!ov.isConnected) { mo.disconnect(); if (location.hash === h) onClose() } })
      .observe(document.body, { childList: true })
  }
  return close
}

export async function render(main) {
  mount(main, html``)
  openCommWheel(() => location.replace('#/'))
}
