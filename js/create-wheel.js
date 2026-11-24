// ════════════════════════════════════════════════════════════════
//  „Založ akci“ – kolečko s tím, co smí uživatel založit (hlavní stránka).
//  Casual (trénink: casual / komunitní, meeting: osobně / online) · Fashion · Turnaje (deathmatch, 3v3, 3v3 liga).
//  Listy vedou do editoru s předvybraným druhem (#/new?f=…, #/new/event?type=…) nebo do formuláře komunitního tréninku.
// ════════════════════════════════════════════════════════════════
import { ICONS } from './icons.js'
import { esc } from './ui.js'

export function createTree({ level = 0, leads = [], leagues = [], onCommunity }) {
  const org = level >= 2
  // skryté větve pryč; větev s jedinou volbou se nahradí tou volbou (žádné kolečko s jedním dílkem)
  const prune = (n) => {
    if (!n || n.hidden) return null
    if (!n.children) return n
    const ch = n.children.map(prune).filter(Boolean)
    if (!ch.length) return null
    if (ch.length === 1 && n.go === undefined && n.label !== 'Založ akci') {
      const c = ch[0]
      return n.keepName ? { ...c, label: `${n.label} · ${c.label}`, short: n.short || n.label, icon: n.icon, color: n.color || c.color }
                        : { ...c, color: n.color || c.color }
    }
    return { ...n, children: ch }
  }
  return prune({ label: 'Založ akci', children: [
    { key: 'casual', label: 'Casual', icon: 'users', color: 'var(--cyan)', children: [
      { label: 'Trénink', icon: 'board', children: [
        { label: 'Casual trénink', short: 'Casual', icon: 'board', hidden: !org, go: '#/new/event?type=training' },
        { label: 'Komunitní trénink', short: 'Komunitní', icon: 'users', hidden: !leads.length, run: onCommunity },
      ] },
      { label: 'Meeting', icon: 'chat', hidden: !org, children: [
        { label: 'Meeting osobně', short: 'Osobně', icon: 'ticket', go: '#/new/event?type=meeting&mode=live' },
        { label: 'Meeting online', short: 'Online', icon: 'tv', go: '#/new/event?type=meeting&mode=online' },
      ] },
    ] },
    { key: 'fashion', label: 'Fashion', icon: 'hanger', color: 'var(--magenta)', hidden: !org, go: '#/new/event?type=fashion' },
    { key: 'tourney', label: 'Turnaje', icon: 'trophy', color: 'var(--bolt)', hidden: !org, children: [
      { label: 'Deathmatch', icon: 'bracket', go: '#/new?f=deathmatch' },
      { label: 'Klasika 3v3', short: '3v3', icon: 'trophy', go: '#/new?f=swiss' },
      { label: '3v3 liga', icon: 'star', keepName: true, hidden: !leagues.length, children: leagues.map(l => (
        { label: l.name, icon: 'star', go: `#/new?f=swiss&league=${l.id}` })) },
    ] },
  ] })
}

const R0 = 56, R1 = 154, C = 160, GAP = 1.6
const rad = (d) => (d - 90) * Math.PI / 180
const pt = (r, d) => [C + r * Math.cos(rad(d)), C + r * Math.sin(rad(d))].map(v => v.toFixed(2))
function sector(a0, a1) {
  if (a1 - a0 >= 359.9) {   // jediná položka = celý prstenec
    return `M${C} ${C - R1}A${R1} ${R1} 0 1 1 ${C - .01} ${C - R1}Z M${C} ${C - R0}A${R0} ${R0} 0 1 0 ${C + .01} ${C - R0}Z`
  }
  const big = a1 - a0 > 180 ? 1 : 0
  const [x1, y1] = pt(R1, a0), [x2, y2] = pt(R1, a1), [x3, y3] = pt(R0, a1), [x4, y4] = pt(R0, a0)
  return `M${x1} ${y1}A${R1} ${R1} 0 ${big} 1 ${x2} ${y2}L${x3} ${y3}A${R0} ${R0} 0 ${big} 0 ${x4} ${y4}Z`
}
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s
const icon = (name, x, y, s) => (ICONS[name] || '').replace('<svg class="nicon"', `<svg class="nicon" x="${x}" y="${y}" width="${s}" height="${s}"`)

export function openCreateWheel(tree, { title = 'Co chceš založit?', hint = 'Vyber druh akce', label = 'Založ akci' } = {}) {
  if (!tree) return
  // jediná možnost (např. leader komunity bez funkce organizátor) = rovnou ji otevřít
  if (tree.children.length === 1 && !tree.children[0].children) {
    const n = tree.children[0]
    return n.run ? n.run() : (location.hash = n.go)
  }
  const stack = [tree]
  const ov = document.createElement('div')
  ov.className = 'cw-overlay'
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', label)
  const prevFocus = document.activeElement
  const close = () => { ov.remove(); removeEventListener('keydown', key); prevFocus?.focus?.() }
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); stack.length > 1 ? back() : close() }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.cw-sec')) { e.preventDefault(); pick(+e.target.dataset.i) }
  }
  const back = () => { stack.pop(); draw(-1) }
  const pick = (i) => {
    const n = stack[stack.length - 1].children[i]
    if (!n) return
    if (n.children) { stack.push({ ...n, color: n.color || stack[stack.length - 1].color }); return draw(1) }
    close()
    if (n.run) n.run()
    else if (n.go) location.hash = n.go
  }
  const draw = (dir = 0) => {
    const node = stack[stack.length - 1]
    const items = node.children
    const step = 360 / items.length
    const color = node.color
    const crumbs = stack.slice(1).map(s => s.label).join(' › ')
    const secs = items.map((n, i) => {
      const a0 = (i - .5) * step + (items.length > 1 ? GAP / 2 : 0), a1 = (i + .5) * step - (items.length > 1 ? GAP / 2 : 0)
      const mid = i * step, rm = (R0 + R1) / 2 + 4
      const [lx, ly] = items.length === 1 ? [C, C - rm] : pt(rm, mid)
      const name = n.short || n.label
      const small = items.length > 4 || name.length > 10
      return `<g class="cw-sec${n.children ? ' has-sub' : ''}" data-i="${i}" tabindex="0" role="button" aria-label="${esc(n.label)}${n.badge ? ` (${n.badge} nových)` : ''}${n.children ? ' – další volby' : ''}" style="--c:${n.color || color || 'var(--cyan)'}">
        <title>${esc(n.label)}</title>
        <path d="${sector(a0, a1)}" fill-rule="evenodd"/>
        ${icon(n.icon, (+lx - 13).toFixed(1), (+ly - 26).toFixed(1), 26)}
        <text x="${lx}" y="${(+ly + 16).toFixed(1)}" class="${small ? 'sm' : ''}">${esc(clip(name, small ? 14 : 12))}</text>
        ${n.children ? `<text x="${lx}" y="${(+ly + 30).toFixed(1)}" class="more">•••</text>` : ''}
        ${n.badge ? `<g class="cw-badge" aria-hidden="true"><circle cx="${(+lx + 16).toFixed(1)}" cy="${(+ly - 26).toFixed(1)}" r="10"/><text x="${(+lx + 16).toFixed(1)}" y="${(+ly - 22).toFixed(1)}">${n.badge > 9 ? '9+' : n.badge}</text></g>` : ''}
      </g>`
    }).join('')
    ov.innerHTML = `
      <div class="cw-box">
        <p class="cw-title">${esc(stack.length > 1 ? crumbs : title)}</p>
        <svg class="cw-wheel ${dir > 0 ? 'in' : dir < 0 ? 'out' : 'open'}" viewBox="0 0 320 320" style="--c:${color || 'var(--cyan)'}">
          ${secs}
          <g class="cw-center" tabindex="0" role="button" aria-label="${stack.length > 1 ? 'Zpět' : 'Zavřít'}">
            <circle cx="${C}" cy="${C}" r="${R0 - 8}"/>
            <text x="${C}" y="${C + 9}">${stack.length > 1 ? '←' : '✕'}</text>
          </g>
        </svg>
        <p class="cw-hint">${stack.length > 1 ? 'Střed = zpět' : hint}</p>
      </div>`
    ov.querySelector('.cw-center').onclick = () => stack.length > 1 ? back() : close()
    ov.querySelector('.cw-center').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); stack.length > 1 ? back() : close() } }
    ov.querySelectorAll('.cw-sec').forEach(g => { g.onclick = () => pick(+g.dataset.i) })
    ov.querySelector('.cw-sec')?.focus({ preventScroll: true })
  }
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.classList.contains('cw-box')) close() })
  addEventListener('keydown', key)
  document.body.append(ov)
  draw()
  return close
}
