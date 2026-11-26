// ════════════════════════════════════════════════════════════════
//  Hráči – kolečko na záložce (Standings · Komunity · Ligy · Trénink = standings komunitního
//  tréninku, jen pro členy komunity) a Standings = seznam účtů podle ratingu s filtrem kraje
// ════════════════════════════════════════════════════════════════
import { rpc, state, isLoggedIn } from '../supa.js'
import { html, mount, on, plural } from '../ui.js'
import { REGIONS, ROLES } from '../core.js'
import { openCreateWheel } from '../create-wheel.js'

// moje komunity (kvůli výseči Trénink) – krátká cache
let myComm = { uid: null, at: 0, list: [] }
export async function myCommunities() {
  const uid = isLoggedIn() && !state.isAnon ? state.user?.id : null
  if (!uid) return []
  if (myComm.uid === uid && Date.now() - myComm.at < 120000) return myComm.list
  try { myComm = { uid, at: Date.now(), list: await rpc('player_communities', { p_user: uid }) || [] } } catch { return myComm.uid === uid ? myComm.list : [] }
  return myComm.list
}

export async function openPlayersWheel() {
  if (document.querySelector('.cw-overlay:not(.closing)')) return
  const comms = await myCommunities()
  if (document.querySelector('.cw-overlay:not(.closing)')) return
  const items = [
    { label: 'Standings', icon: 'bars', color: 'var(--cyan)', go: '#/players' },
    { label: 'Komunity', icon: 'users', color: 'var(--magenta)', go: '#/communities' },
    { label: 'Ligy', icon: 'trophy', color: 'var(--bolt)', go: '#/leagues' },
    { label: 'Stats ladder', short: 'Stats', icon: 'star', color: '#ff8a3d', go: '#/stats' },
  ]
  if (comms.length === 1) items.push({ label: 'Trénink – standings', short: 'Trénink', icon: 'scale', color: '#00ffaa', go: `#/c/${comms[0].id}/standings` })
  else if (comms.length > 1) items.push({ label: 'Trénink – standings', short: 'Trénink', icon: 'scale', color: '#00ffaa',
    children: comms.slice(0, 8).map(c => ({ label: c.name, icon: 'users', go: `#/c/${c.id}/standings` })) })
  openCreateWheel({ label: 'Hráči', children: items }, { title: 'Hráči', hint: 'Kam chceš jít?', label: 'Hráči' })
}

export async function render(main, _p, ctx) {
  const all = await rpc('players_list')
  if (!ctx.isCurrent()) return
  let qtext = '', region = ''
  const roleLabel = (r) => r === 'player' ? '' : ROLES.find(x => x.key === r)?.label

  mount(main, html`
    <h1 style="margin-top:4px">Standings</h1>
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
          <div class="ellipsis" style="font-weight:600">${p.nick}${p.id === state.user?.id ? html`<span class="faint"> (ty${state.profile?.privacy?.standings ? ' · ostatní tě tu nevidí' : ''})</span>` : ''}
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
