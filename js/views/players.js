// ════════════════════════════════════════════════════════════════
//  Hráči – seznam účtů s filtrem podle kraje
// ════════════════════════════════════════════════════════════════
import { rpc, state } from '../supa.js'
import { html, mount, on, plural } from '../ui.js'
import { REGIONS, ROLES } from '../core.js'

export async function render(main, _p, ctx) {
  const all = await rpc('players_list')
  if (!ctx.isCurrent()) return
  let qtext = '', region = ''
  const roleLabel = (r) => r === 'player' ? '' : ROLES.find(x => x.key === r)?.label

  mount(main, html`
    <h1>Hráči</h1>
    <p class="muted" style="margin-top:4px">${all.length} hráčů s účtem, seřazeno podle ratingu.</p>
    <div class="row wrap" style="margin-top:14px">
      <input class="input grow" type="search" placeholder="Hledat nick" id="pq" aria-label="Hledat nick" style="flex:1 1 200px">
      <select class="input" id="pr" style="flex:1 1 180px" aria-label="Kraj">
        <option value="">Všechny kraje</option>${REGIONS.map(r => html`<option>${r}</option>`)}
      </select>
    </div>
    <div id="pl" style="margin-top:14px"></div>`)

  const draw = () => {
    const ql = qtext.trim().toLowerCase()
    const list = all.filter(p => (!ql || p.nick.toLowerCase().includes(ql)) && (!region || p.region === region))
    mount(main.querySelector('#pl'), list.length ? html`<div class="list">${list.map(p => html`
      <a class="li" href="#/p/${p.id}">
        <span class="faint num" style="width:26px;text-align:right">${all.indexOf(p) + 1}</span>
        <span class="av">${p.avatar}</span>
        <div class="grow" style="min-width:0">
          <div class="ellipsis" style="font-weight:600">${p.nick}${p.id === state.user?.id ? html`<span class="faint"> (ty)</span>` : ''}
            ${roleLabel(p.role) ? html` <span class="pill role" style="font-size:11px;padding:0 8px">${roleLabel(p.role)}</span>` : ''}</div>
          <div class="small muted ellipsis">${p.region || 'Kraj neuveden'} · ${plural(Number(p.tournaments), 'turnaj', 'turnaje', 'turnajů')}${Number(p.titles) ? ` · 🏆 ${p.titles}` : ''}</div>
        </div>
        <span class="num" style="font-weight:700">${p.rating}</span>
      </a>`)}</div>` : html`<div class="empty">Nikoho takového nemáme.</div>`)
  }
  on(main, 'input', '#pq', (e, el) => { qtext = el.value; draw() })
  on(main, 'change', '#pr', (e, el) => { region = el.value; draw() })
  draw()
}
