// ════════════════════════════════════════════════════════════════
//  BBXU – shell, router, globální notifikace o zápasech
// ════════════════════════════════════════════════════════════════
import { sb, state, configured, initAuth, onState, isLoggedIn, systemNotify } from './supa.js'
import { html, mount, $, toast } from './ui.js'
import * as Home from './views/home.js'
import * as Tournament from './views/tournament.js'
import * as Players from './views/players.js'
import * as Profile from './views/profile.js'
import * as Chat from './views/chat.js'
import * as Auth from './views/auth.js'

const cfg = window.BBX_CONFIG

const routes = [
  [/^\/?$/, Home.renderList, 'home'],
  [/^\/new(?:\/(event))?$/, Home.renderEditor, 'home'],
  [/^\/t\/([0-9a-f-]{36})\/edit$/, (m, [id]) => Home.renderEditor(m, [null, id]), 'home'],
  [/^\/t\/([0-9a-f-]{36})\/tv$/, Tournament.renderTV, 'home'],
  [/^\/t\/([0-9a-f-]{36})(?:\/([a-z]+))?$/, Tournament.render, 'home'],
  [/^\/players$/, Players.render, 'players'],
  [/^\/p\/([0-9a-f-]{36})$/, Profile.render, 'me'],
  [/^\/me$/, Profile.renderMe, 'me'],
  [/^\/chat(?:\/([a-z]+))?$/, Chat.render, 'chat'],
  [/^\/login(?:\/([a-z]+))?$/, Auth.render, 'me'],
]

let cleanup = null
let navToken = 0

export function go(path) { location.hash = '#' + path }

async function route() {
  const path = decodeURIComponent(location.hash.replace(/^#/, '')) || '/'
  const main = $('main')
  if (typeof cleanup === 'function') { try { cleanup() } catch {} }
  cleanup = null
  document.body.classList.remove('tv')
  const token = ++navToken
  for (const [re, view, tab] of routes) {
    const m = re.exec(path.split('?')[0])
    if (!m) continue
    setTab(tab)
    mount(main, html`<div class="spinner" aria-label="Načítám"></div>`)
    try {
      const c = await view(main, m.slice(1), { isCurrent: () => token === navToken })
      if (token === navToken) cleanup = c
      else if (typeof c === 'function') c()
    } catch (e) {
      console.error(e)
      if (token === navToken) mount(main, html`<div class="notice err">Stránku se nepodařilo načíst: ${e.message || e}</div>`)
    }
    window.scrollTo(0, 0)
    return
  }
  mount(main, html`<div class="empty"><h2>Tahle stránka neexistuje</h2><a class="btn" href="#/">Na turnaje</a></div>`)
}

function setTab(tab) {
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab))
}

function renderChrome() {
  const p = state.profile
  const me = $('#me-slot')
  if (isLoggedIn() && p?.nick) {
    mount(me, html`<a class="me-chip" href="#/me"><span class="av">${p.avatar}</span>${p.nick}</a>`)
  } else if (isLoggedIn()) {
    mount(me, html`<a class="btn sm" href="#/me">Dokonči profil</a>`)
  } else {
    mount(me, html`<a class="btn sm" href="#/login">Přihlásit</a>`)
  }
}

// ── živé notifikace: „hraješ na aréně X“ ─────────────────
let channel = null
const announced = new Set()
function watchMyMatches() {
  if (channel) { sb.removeChannel(channel); channel = null }
  const regIds = new Set(state.myRegs.filter(r => r.status === 'active').map(r => r.id))
  if (!regIds.size) return
  channel = sb.channel('my-matches')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, ({ new: m }) => {
      if (!m || !(regIds.has(m.p1_reg) || regIds.has(m.p2_reg))) return
      window.dispatchEvent(new CustomEvent('bbx:my-match', { detail: m }))
      if (m.status === 'pending' && m.arena && m.p1_reg && m.p2_reg) {
        const key = m.id + ':' + m.arena
        if (announced.has(key)) return
        announced.add(key)
        toast(html`Tvůj zápas: <b>aréna ${m.arena}</b>. Otevři turnaj pro detail.`, 'call', 8000)
        systemNotify(`Aréna ${m.arena}`, 'Máš naplánovaný zápas – běž ke stolu.', 'match-' + m.id)
        navigator.vibrate?.([200, 100, 200])
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournaments' }, ({ new: t, old }) => {
      if (!state.myRegs.some(r => r.tournament_id === t.id)) return
      if (t.status === 'swiss' && old?.status === 'registration') {
        toast(html`Turnaj <b>${t.name}</b> začal!`, 'call', 8000)
        systemNotify('Turnaj začal', t.name, 'start-' + t.id)
      }
    })
    .subscribe()
}

async function boot() {
  if (!configured) {
    mount($('main'), html`
      <div class="card stack">
        <h1>BBXU ještě není připojené</h1>
        <p class="muted">V souboru <b>js/config.js</b> chybí adresa a klíč projektu Supabase. Postup je v README.</p>
      </div>`)
    return
  }
  document.title = `${cfg.appName} – ${cfg.appSub}`
  const isRecovery = location.hash.includes('type=recovery')
  await initAuth()
  renderChrome()
  watchMyMatches()
  onState((evt) => {
    renderChrome()
    watchMyMatches()
    if (evt === 'PASSWORD_RECOVERY') Auth.newPasswordModal()
    if (evt === 'SIGNED_IN' && isLoggedIn() && state.profile && !state.profile.nick && !document.querySelector('#f-onb')) Auth.onboardingModal()
    if (evt === 'SIGNED_OUT') route()
  })
  // Discord / e-mailový odkaz vrátí uživatele s tokenem v URL – po zpracování ho uklidíme
  if (location.hash.includes('access_token') || location.search.includes('code=')) {
    history.replaceState(null, '', location.pathname + '#/')
  }
  window.addEventListener('hashchange', route)
  await route()
  if (isRecovery && state.user) Auth.newPasswordModal()
  else if (isLoggedIn() && state.profile && !state.profile.nick) Auth.onboardingModal()
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {})
boot()
