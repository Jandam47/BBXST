// ════════════════════════════════════════════════════════════════
//  BBXU – shell, router, globální notifikace o zápasech
// ════════════════════════════════════════════════════════════════
import { sb, state, configured, initAuth, onState, isLoggedIn, systemNotify, rpc, q } from './supa.js'
import { html, mount, $, toast } from './ui.js'
import * as Home from './views/home.js'
import * as Tournament from './views/tournament.js'
import * as Players from './views/players.js'
import * as Profile from './views/profile.js'
import * as Chat from './views/chat.js'
import * as Komunikace from './views/komunikace.js'
import * as Polls from './views/polls.js'
import * as Feedback from './views/feedback.js'
import { watchUnread } from './unread.js'
import { syncPush } from './push.js'
import { installErrorLog, logError } from './errlog.js'
import * as Meta from './views/meta.js'
import * as Auth from './views/auth.js'
import * as Communities from './views/communities.js'
import * as Help from './views/help.js'
import * as Leagues from './views/leagues.js'
import * as Live from './views/live.js'
import * as Favorites from './views/favorites.js'
import * as Stats from './views/stats.js'

const cfg = window.BBX_CONFIG

const routes = [
  [/^\/?$/, Home.renderList, 'home'],
  [/^\/new(?:\/(event))?$/, Home.renderEditor, 'home'],
  [/^\/t\/([0-9a-f-]{36})\/edit$/, (m, [id]) => Home.renderEditor(m, [null, id]), 'home'],
  [/^\/t\/([0-9a-f-]{36})\/tv$/, Tournament.renderTV, 'home'],
  [/^\/t\/([0-9a-f-]{36})\/live$/, Live.render, 'home'],
  [/^\/t\/([0-9a-f-]{36})(?:\/([a-z]+))?$/, Tournament.render, 'home'],
  [/^\/players$/, Players.render, 'players'],
  [/^\/communities$/, Communities.renderList, 'players'],
  [/^\/c\/([0-9a-f-]{36})$/, Communities.renderDetail, 'players'],
  [/^\/c\/([0-9a-f-]{36})\/standings$/, Communities.renderStandings, 'players'],
  [/^\/leagues$/, Leagues.renderList, 'players'],
  [/^\/stats$/, Stats.render, 'players'],
  [/^\/l\/([0-9a-f-]{36})$/, Leagues.renderDetail, 'players'],
  [/^\/meta$/, Meta.render, 'meta'],
  [/^\/p\/([0-9a-f-]{36})$/, Profile.render, 'me'],
  [/^\/me$/, Profile.renderMe, 'me'],
  [/^\/oblibene$/, Favorites.render, 'me'],
  [/^\/chat(?:\/([a-z0-9-]+))?$/, Chat.render, 'chat'],
  [/^\/komunikace$/, Komunikace.render, 'chat'],
  [/^\/ankety(?:\/([0-9a-f-]{36}))?$/, Polls.render, 'chat'],
  [/^\/dotazy$/, Feedback.render, 'chat'],
  [/^\/bazar(?:\/.*)?$/, (main) => mount(main, html`<div class="empty"><h2>Bazar skončil</h2>
    <p class="muted">Bazar jsme zrušili. Ostatní najdeš v Komunikaci.</p><a class="btn" href="#/komunikace">Komunikace</a></div>`), 'chat'],
  [/^\/login(?:\/([a-z]+))?$/, Auth.render, 'me'],
  [/^\/help$/, Help.render, 'chat'],
]

let cleanup = null
let navToken = 0

export function go(path) { location.hash = '#' + path }

async function route() {
  const path = decodeURIComponent(location.hash.replace(/^#/, '')) || '/'
  // čisté <main> pro každý pohled – posluchače on(main, …) z předchozí stránky nesmí přežít
  // (jinak např. odeslání zprávy v jedné místnosti chatu poslalo zprávu i do předchozí)
  const old = $('main'), main = old.cloneNode(false)
  old.replaceWith(main)
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
      logError(e, path.split('?')[0].replace(/[0-9a-f-]{36}/gi, ':id'))
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

// ── fashion show: „jdi hodnotit“ (design judge), „jsi na molu“ (soutěžící) ──
let fxChannel = null, fxToken = 0
const fxSeen = new Map()
async function watchFashion() {
  const token = ++fxToken
  if (fxChannel) { sb.removeChannel(fxChannel); fxChannel = null }
  if (!state.user) return
  const judging = isLoggedIn() ? (await rpc('my_fashion_judging').catch(() => [])).map(r => r.tournament_id) : []
  const myT = new Set(state.myRegs.map(r => r.tournament_id)), judgeT = new Set(judging)
  const myRegIds = new Set(state.myRegs.map(r => r.id))
  const ids = [...new Set([...myT, ...judgeT])]
  if (!ids.length || token !== fxToken) return
  const key = (t) => `${t.status}:${t.fashion?.phase}:${t.fashion?.current}`
  const now = await q(sb.from('tournaments').select('id,status,fashion,event_type,kind').in('id', ids)).catch(() => [])
  if (token !== fxToken) return
  now.filter(t => t.event_type === 'fashion').forEach(t => fxSeen.set(t.id, key(t)))
  if (![...fxSeen.keys()].some(id => ids.includes(id))) return
  const say = (msg, title, tag) => {
    toast(msg, 'call', 9000); systemNotify(title, '', tag); navigator.vibrate?.([200, 100, 200])
  }
  fxChannel = sb.channel('my-fashion')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournaments' }, async ({ new: t }) => {
      if (!t || t.kind !== 'event' || t.event_type !== 'fashion' || !t.fashion) return
      const amJ = judgeT.has(t.id), amP = myT.has(t.id)
      if (!amJ && !amP) return
      const k = key(t), prev = fxSeen.get(t.id)
      fxSeen.set(t.id, k)
      if (prev === k) return
      const f = t.fashion, link = `#/t/${t.id}/${amJ ? 'show' : 'me'}`
      if (t.status === 'show' && f.phase === 'scoring' && f.current) {
        if (amP && myRegIds.has(f.current)) return say(html`<a href="${link}"><b>Jsi na řadě!</b> Běž na molo – ${t.name}</a>`, 'Jsi na řadě na molu!', 'fx-' + f.current)
        if (amP && prev?.startsWith('registration')) return say(html`<a href="${link}"><b>Fashion show začala!</b> Pořadí na molu najdeš v Můj Status.</a>`, 'Fashion show začala', 'fx-start-' + t.id)
        if (amJ) {
          const r = await q(sb.from('registrations').select('nick').eq('id', f.current).maybeSingle()).catch(() => null)
          return say(html`<a href="${link}">Na molu je <b>${r?.nick || 'další hráč'}</b> – jdi hodnotit.</a>`, `Hodnoť: ${r?.nick || 'další hráč'}`, 'fx-' + f.current)
        }
      }
      if (amJ && t.status === 'show' && f.phase === 'tiebreak') return say(html`<a href="${link}"><b>Rozstřel o 1. místo</b> – dej +1 jednomu z hráčů.</a>`, 'Rozstřel o 1. místo', 'fx-tie-' + t.id)
      if (t.status === 'show' && f.phase === 'boss' && f.boss === state.user?.id) return say(html`<a href="${link}"><b>Jsi boss of fashion!</b> Vyber vítěze.</a>`, 'Jsi boss of fashion', 'fx-boss-' + t.id)
      if (t.status === 'finished') toast(html`<a href="#/t/${t.id}/tv">Vyhlášení <b>${t.name}</b> běží na TV.</a>`, 'call', 8000)
    })
    .subscribe()
}

// ── komunitní trénink: nová výzva / přijatá výzva ──
let trChannel = null
function watchTraining() {
  if (trChannel) { sb.removeChannel(trChannel); trChannel = null }
  if (!isLoggedIn() || !state.myRegs.length) return
  const mine = new Set(state.myRegs.map(r => r.id))
  const seen = new Map()
  const nick = async (reg) => (await q(sb.from('registrations').select('nick').eq('id', reg).maybeSingle()).catch(() => null))?.nick || 'Soupeř'
  trChannel = sb.channel('my-training')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'training_matches' }, async ({ eventType, new: m }) => {
      if (!m?.id || seen.get(m.id) === m.status) return
      seen.set(m.id, m.status)
      if (m.status === 'pending' && mine.has(m.p2_reg) && eventType === 'INSERT') {
        const n = await nick(m.p1_reg)
        toast(html`<a href="#/t/${m.tournament_id}/me"><b>${n}</b> tě vyzývá na trénink – potvrď výzvu.</a>`, 'call', 10000)
        systemNotify(`${n} tě vyzývá na souboj`, 'Komunitní trénink', 'tr-' + m.id); navigator.vibrate?.([200, 100, 200])
      } else if (m.status === 'active' && eventType === 'UPDATE' && mine.has(m.p1_reg)) {   // INSERT active = bot
        const n = await nick(m.p2_reg)
        toast(html`<a href="bbxst.html?training=${m.id}"><b>${n}</b> přijal výzvu – otevřít BBXST.</a>`, 'call', 10000)
        systemNotify(`${n} přijal výzvu`, 'Otevři BBXST v training módu', 'tr-' + m.id)
      } else if (m.status === 'declined' && mine.has(m.p1_reg)) {
        toast(`${await nick(m.p2_reg)} výzvu odmítl.`, '', 5000)
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
  installErrorLog(sb, 'bbxu')
  document.title = `${cfg.appName} – ${cfg.appSub}`
  const isRecovery = location.hash.includes('type=recovery')
  // chyba z přihlášení přes Discord (vrací ji Supabase v adrese)
  const authErr = new URLSearchParams(location.search).get('error_description')
    || new URLSearchParams(location.hash.replace(/^#\/?/, '').split('?').pop()).get('error_description')
  if (authErr) {
    window.history.replaceState(null, '', location.pathname + '#/login')
    const taken = /already|exists|linked/i.test(authErr)
    if (taken) try { sessionStorage.setItem('bbxu_discord_taken', '1') } catch {}
    setTimeout(() => toast(taken
      ? 'Tenhle Discord už má účet. Klepni znovu na Discord – přihlásíš se do něj (registrace hosta zůstanou u hosta).'
      : 'Přihlášení přes Discord se nepovedlo: ' + authErr, 'err'), 300)
  }
  await initAuth()
  renderChrome()
  watchMyMatches()
  watchFashion()
  watchTraining()
  watchUnread()
  syncPush()
  onState((evt) => {
    renderChrome()
    watchMyMatches()
    watchFashion()
    watchTraining()
      if (evt !== 'TOKEN_REFRESHED') watchUnread()
    if (evt === 'SIGNED_IN') syncPush()
    if (evt === 'PASSWORD_RECOVERY') Auth.newPasswordModal()
    if (evt === 'SIGNED_IN' && isLoggedIn() && state.profile && !state.profile.nick && !document.querySelector('#f-onb')) Auth.onboardingModal()
    if (evt === 'SIGNED_OUT') route()
  })
  // Discord / e-mailový odkaz vrátí uživatele s tokenem v URL – po zpracování ho uklidíme
  if (location.hash.includes('access_token') || location.search.includes('code=')) {
    history.replaceState(null, '', location.pathname + '#/')
  }
  window.addEventListener('hashchange', route)
  // záložka Hráči: kolečko Standings · Komunity · Ligy · Trénink (bez přechodu)
  document.querySelector('.tabbar a[data-tab="players"]')?.addEventListener('click', (e) => {
    e.preventDefault()
    Players.openPlayersWheel()
  })
  // záložka Komunikace: kolečko nad aktuální stránkou (bez přechodu)
  document.querySelector('.tabbar a[data-tab="chat"]')?.addEventListener('click', (e) => {
    e.preventDefault()
    Komunikace.openCommWheel()
  })
  await route()
  if (isRecovery && state.user) Auth.newPasswordModal()
  else if (isLoggedIn() && state.profile && !state.profile.nick) Auth.onboardingModal()
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {})
boot()
