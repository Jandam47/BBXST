// ════════════════════════════════════════════════════════════════
//  Profil hráče: role, statistiky, historie turnajů, beyblady, rating
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, q, errMsg, refreshMe, isLoggedIn } from '../supa.js'
import { adminErrors, adminBackup, backupDue } from '../admin.js'
import { leagueBadges, leagueRolesCard } from './leagues.js'
import { installCard } from '../install.js'
import { html, mount, on, formData, toast, modal, busy, confirmBox, fmtDate, raw, plural, kindLabel, finishTiles, qrSvg, qrPng } from '../ui.js'
import { ROLES, REGIONS, roleLevel, qrPayload } from '../core.js'
import { avatarPicker } from './auth.js'
import { communityBadges, adminRequests } from './communities.js'
import { adminReports } from '../report.js'
import { pushStatus, enablePush, disablePush } from '../push.js'
import { ICONS } from '../icons.js'
import { STATS, fmtSecs, medal, thisSeason } from '../stats.js'
import { openCreateWheel } from '../create-wheel.js'
import { THEMES, getTheme, setTheme } from '../theme.js'

export async function renderMe(main) {
  if (isLoggedIn()) return render(main, [state.user.id])
  if (!state.isAnon) { location.hash = '#/login'; return }
  // host
  const regs = state.myRegs
  const ts = regs.length ? await q(sb.from('tournaments').select('id,name,starts_at,status').in('id', regs.map(r => r.tournament_id))) : []
  mount(main, html`
    <h1>Jsi tu jako host</h1>
    <p class="muted" style="margin-top:6px">Bez účtu se tvoje výsledky nesčítají do profilu. Založ si účet a turnaje níže se ti do něj přenesou.</p>
    <a class="btn primary block" style="margin-top:16px" href="#/login/signup">Založit účet</a>
    ${ts.length ? html`<h2>Moje registrace</h2><div class="list">${ts.map(t => html`<a class="li" href="#/t/${t.id}"><span class="grow">${t.name}</span><span class="faint small">${fmtDate(t.starts_at)}</span></a>`)}</div>` : ''}
    <section class="card inst-card" id="inst-card"></section>
    <button class="btn block" style="margin-top:14px" data-act="theme">Vzhled: ${THEMES.find(x => x[0] === getTheme())[1]}</button>
    <button class="btn ghost block" style="margin-top:24px" data-act="logout">Zapomenout hosta na tomhle zařízení</button>`)
  installCard(main.querySelector('#inst-card'))
  on(main, 'click', '[data-act=theme]', () => themeSheet(() => renderMe(main)))
  on(main, 'click', '[data-act=logout]', async () => {
    if (!await confirmBox('Ztratíš přístup ke svým QR kódům na tomhle zařízení. Pokračovat?', { ok: 'Ano', danger: true })) return
    await sb.auth.signOut(); location.hash = '#/'
  })
}

function sparkline(points) {
  if (points.length < 2) return ''
  const vals = [1000, ...points.map(p => p.rating)]
  const min = Math.min(...vals) - 10, max = Math.max(...vals) + 10
  const w = 300, h = 80
  const xy = vals.map((v, i) => [i / (vals.length - 1) * w, h - (v - min) / (max - min) * h])
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const last = xy[xy.length - 1]
  return raw(`<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Vývoj ratingu">
    <line x1="0" x2="${w}" y1="${(h - (1000 - min) / (max - min) * h).toFixed(1)}" y2="${(h - (1000 - min) / (max - min) * h).toFixed(1)}" style="stroke:var(--line)" stroke-dasharray="4 4"/>
    <path d="${d}" fill="none" style="stroke:var(--bolt)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" style="fill:var(--bolt)"/></svg>`)
}

// pohár achievementu (1 zlatý, 2 stříbrný, 3 bronzový)
const TROPHY = { 1: ['#fff27a', '#ffd21f', '#b98a00'], 2: ['#ffffff', '#cfdbe8', '#7f93a8'], 3: ['#ffc59a', '#e0894a', '#8a4a1c'] }
function trophy(place) {
  const [a, b, c] = TROPHY[place] || TROPHY[3]
  return raw(`<svg class="ach-cup" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="cup${place}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
    <path d="M18 10h28v10c0 9-6 16-14 16s-14-7-14-16z" fill="url(#cup${place})"/>
    <path d="M18 14h-6a6 6 0 0 0 7 9M46 14h6a6 6 0 0 1-7 9" fill="none" stroke="${b}" stroke-width="3" stroke-linecap="round"/>
    <path d="M29 36h6v8h-6zM21 50c0-4 4-6 11-6s11 2 11 6v4H21z" fill="url(#cup${place})"/>
    <text x="32" y="28" text-anchor="middle" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="15" fill="${c}">${place}</text></svg>`)
}

const BEY_KINDS = [['build', 'Buildy'], ['blade', 'Blady'], ['ratchet', 'Ratchety'], ['bit', 'Bity']]
function beyList(rows = []) {
  if (!rows.length) return html`<div class="empty">Nic tu není.</div>`
  return html`<div class="list meta-list">${rows.map(r => html`
    <div class="li meta-row">
      <div class="grow" style="min-width:0">
        <div class="meta-name">${r.name}</div>
        <div class="meta-bar" role="img" aria-label="${r.wins} výher, ${r.draws} remíz, ${r.losses} proher">
          <i class="w" style="width:${(100 * r.wins / r.battles).toFixed(1)}%"></i><i class="d" style="width:${(100 * r.draws / r.battles).toFixed(1)}%"></i></div>
        <div class="small muted">${r.battles} soubojů · ${r.wins}–${r.draws ? `${r.draws}–` : ''}${r.losses} · ${r.points} bodů</div>
      </div>
      <div class="meta-wr num"><b>${Math.round(r.win_rate)}</b><small>%</small></div>
    </div>`)}</div>`
}

// vzájemná bilance: já vs tenhle hráč + jeho nejčastější soupeři
function h2hBlock(h, p, own) {
  const vs = h?.vs_me, opps = h?.opponents || []
  const vsN = vs ? vs.wins + vs.losses : 0
  if (!vsN && !opps.length) return ''
  return html`
    ${vsN ? html`<div class="h2h card">
      <div class="h2h-side me"><span class="av">${state.profile?.avatar || '🌀'}</span><b>Ty</b></div>
      <div class="h2h-score num"><b class="${vs.wins > vs.losses ? 'lead' : ''}">${vs.wins}</b><i>:</i><b class="${vs.losses > vs.wins ? 'lead' : ''}">${vs.losses}</b>
        <small>${vsN === 1 ? '1 zápas' : vsN <= 4 ? `${vsN} zápasy` : `${vsN} zápasů`}</small></div>
      <div class="h2h-side opp"><span class="av">${p.avatar}</span><b class="ellipsis">${p.nick}</b></div>
      <div class="h2h-recent">${vs.recent.map(m => html`<a href="#/t/${m.tournament_id}" class="h2h-m ${m.won ? 'w' : 'l'}" title="${m.tournament}">
        <span>${m.won ? 'V' : 'P'}</span><small class="num">${m.my}:${m.opp}</small></a>`)}</div>
    </div>` : ''}
    ${opps.length ? html`<h2>${own ? 'Tvoji nejčastější soupeři' : 'Nejčastější soupeři'}</h2>
    <div class="list">${opps.map(o => {
      const me = o.user === state.user?.id
      return html`<a class="li h2h-opp ${me ? 'is-me' : ''}" href="#/p/${o.user}">
        <span class="av">${o.avatar}</span>
        <div class="grow" style="min-width:0">
          <div class="ellipsis" style="font-weight:600">${o.nick}${me ? html` <span class="small faint">(ty)</span>` : ''}</div>
          <div class="meta-bar" role="img" aria-label="${o.wins} výher, ${o.losses} proher"><i class="w" style="width:${(100 * o.wins / o.matches).toFixed(1)}%"></i></div>
        </div>
        <span class="num h2h-rec"><b>${o.wins}</b>–${o.losses}</span>
      </a>`
    })}</div>
    <p class="hint">Bilance ${own ? 'tvých' : 'hráčových'} zápasů proti hráčům s účtem (výhry–prohry).</p>` : ''}`
}

export async function render(main, [id], ctx) {
  const [p, stats, bs, ach, comms, h2h, lgs, judged] = await Promise.all([
    q(sb.from('profiles').select('*').eq('id', id).maybeSingle()),
    rpc('player_stats', { p_user: id }),
    rpc('player_bey_stats', { p_user: id }).catch(() => ({})),
    rpc('player_achievements', { p_user: id }).catch(() => []),
    rpc('player_communities', { p_user: id }).catch(() => []),
    rpc('player_h2h', { p_user: id }).catch(() => ({ opponents: [] })),
    rpc('player_leagues', { p_user: id }).catch(() => ({ roles: [], standings: [] })),
    rpc('player_judged', { p_user: id }).catch(() => ({ matches: 0, tournaments: 0 })),
  ])
  if (ctx && !ctx.isCurrent()) return
  if (!p || !p.nick) { mount(main, html`<div class="empty">${p && id === state.user?.id ? html`<button class="btn primary" onclick="location.reload()">Dokonči profil</button>` : 'Profil nenalezen.'}</div>`); return }
  const own = id === state.user?.id
  const hidden = p.privacy || {}
  const lvl = roleLevel(p.role)
  const myLvl = state.level
  const canEditRoles = !own && myLvl >= 3 && lvl < myLvl
  const r = stats.record
  const tours = stats.tournaments.filter(t => t.kind === 'tournament')
  const events = stats.tournaments.filter(t => t.kind === 'event')

  mount(main, html`
    <div class="prof-head">
      <span class="av lg">${p.avatar}</span>
      <div class="grow">
        <h1>${p.nick}</h1>
        <div class="muted">${p.region || 'Kraj neuveden'} · rating <b class="num" style="color:var(--text)">${p.rating}</b></div>
        <div class="row wrap" style="margin-top:6px;gap:6px">${ROLES.filter(x => x.level > 0 && x.level <= lvl).map(x => html`<span class="pill role">${x.label}</span>`)}${p.cashier ? html`<span class="pill role cash">💰 Pokladník</span>` : ''}</div>
      </div>
      ${own ? html`<div class="prof-btns">
        <button class="prof-fav" data-act="choose" aria-label="Choose wheel – oblíbené buildy a decky" title="Oblíbené buildy a decky">${raw(ICONS.star)}</button>
        <button class="prof-gear" data-act="settings" aria-label="Nastavení profilu a aplikace" title="Nastavení">${raw(ICONS.gear)}<span class="prof-gear-badge" hidden></span></button>
      </div>` : ''}
    </div>
    ${communityBadges(comms)}
    ${leagueBadges(lgs.standings)}
    ${p.bio ? html`<p style="margin-top:14px;white-space:pre-line">${p.bio}</p>` : ''}
    ${own && state.level >= 3 ? html`<div id="admin-strip"></div>` : ''}

    <div class="stats">
      <div class="stat"><div class="v">${tours.length}</div><div class="k">${tours.length === 1 ? 'turnaj' : tours.length >= 2 && tours.length <= 4 ? 'turnaje' : 'turnajů'}</div></div>
      <div class="stat"><div class="v">${r.wins}–${r.losses}</div><div class="k">zápasy V–P</div></div>
      <div class="stat"><div class="v">${r.titles}</div><div class="k">${r.titles === 1 ? 'titul' : r.titles >= 2 && r.titles <= 4 ? 'tituly' : 'titulů'}</div></div>
      <div class="stat"><div class="v">${r.podiums}</div><div class="k">na bedně</div></div>
      ${judged.matches || roleLevel(p.role) >= 1 ? html`<div class="stat judge-stat">
        <div class="v">${judged.matches}</div>
        <div class="k">${judged.matches === 1 ? 'odjudgovaný zápas' : judged.matches >= 2 && judged.matches <= 4 ? 'odjudgované zápasy' : 'odjudgovaných zápasů'}${judged.tournaments ? ` · ${plural(judged.tournaments, 'turnaj', 'turnaje', 'turnajů')}` : ''}</div>
      </div>` : ''}
    </div>

    <section id="prof-stats" class="prof-stats" aria-live="polite"></section>

    ${!own && hidden.h2h ? '' : h2hBlock(h2h, p, own)}
    ${own && hidden.h2h && h2h?.opponents?.length ? html`<p class="hint">🔒 Soupeře a vzájemnou bilanci vidíš jen ty.</p>` : ''}

    ${ach.length ? html`<h2>Achievementy</h2>
    <div class="ach-grid">${ach.map(a => html`<a class="ach p${a.place}" href="#/t/${a.tournament_id}" title="${a.name}">
      ${trophy(a.place)}
      <b>Fashion ${a.place}</b>
      <small class="ellipsis">${a.name}</small>
      <small class="faint">${fmtDate(a.at)}</small></a>`)}</div>` : ''}

    ${stats.rating.length > 1 ? html`<h2>Vývoj ratingu</h2><div class="card">${sparkline(stats.rating)}
      <div class="row between small faint"><span>start 1000</span><span>teď ${p.rating}</span></div></div>` : ''}

    ${canEditRoles ? html`<h2>Funkce</h2>
    <div class="card roles">
      ${ROLES.map(x => {
        const has = lvl >= x.level
        const editable = canEditRoles && x.level > 0 && x.level < myLvl && x.key !== 'superadmin'
        return html`<label class="check"><span>${x.label}${x.level === 1 ? html` <span class="faint small">· rozhoduje zápasy</span>` : x.level === 2 ? html` <span class="faint small">· zakládá turnaje a akce</span>` : x.level === 3 ? html` <span class="faint small">· přiděluje role</span>` : ''}</span>
          <input type="checkbox" ${has ? 'checked' : ''} ${editable ? '' : 'disabled'} data-role="${x.key}" data-level="${x.level}"></label>`
      })}
      <label class="check"><span>💰 Pokladník <span class="faint small">· vybírá vstupné na turnajích</span></span>
        <input type="checkbox" data-cashier ${p.cashier ? 'checked' : ''}></label>
      <p class="hint">Vyšší funkce zahrnuje nižší: admin je i organizátor a judge, organizátor je i judge. Pokladník je funkce navíc – organizátor ho pak může vybrat u turnaje se vstupným.</p>
    </div>` : ''}
    ${own ? '' : leagueRolesCard(lgs.roles, lvl)}

    <h2>Turnaje</h2>
    ${tours.length ? html`<div class="list">${tours.map(t => html`
      <a class="li" href="#/t/${t.id}">
        <span class="place ${t.place && t.place <= 3 ? 'p' + t.place : ''}">${t.place ? t.place + '.' : t.status === 'finished' ? '–' : '•'}</span>
        <div class="grow" style="min-width:0">
          <div class="ellipsis" style="font-weight:600">${t.name}</div>
          <div class="small muted ellipsis">${[fmtDate(t.starts_at), plural(Number(t.players), 'hráč', 'hráči', 'hráčů'), (t.beys || []).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div>
        </div>
      </a>`)}</div>` : html`<div class="empty">Zatím žádný odehraný turnaj.</div>`}

    ${finishTiles(bs.finishes?.given, bs.finishes?.taken) ? html`<h2>Endy</h2>
    ${finishTiles(bs.finishes?.given, bs.finishes?.taken)}
    ${own && hidden.beys ? html`<p class="hint">🔒 Endy a statistiky beyů vidíš jen ty.</p>` : ''}
    <p class="hint">Velké číslo = kolikrát ${own ? 'jsi' : 'hráč'} soupeře takhle dorazil, malé = kolikrát ${own ? 'jsi' : 'byl'} takhle poražen${own ? '' : ''}.</p>` : ''}

    ${!own && hidden.beys ? html`<p class="hint" style="margin-top:18px">🔒 Hráč má statistiky beyů a endy skryté.</p>` : ''}
    ${bs.build?.length ? html`<h2>Beyblady</h2>
    <div class="seg" id="bk" role="tablist">
      ${BEY_KINDS.map(([k, l], i) => html`<button type="button" data-k="${k}" class="${i ? '' : 'on'}" role="tab">${l}</button>`)}
    </div>
    <div id="bl" style="margin-top:10px">${beyList(bs.build)}</div>
    <p class="hint">${own ? 'Tvoje statistika včetně rozehraných turnajů. Ostatní vidí jen skončené turnaje.' : 'Ze skončených turnajů, kde judge zapisoval souboje v BBXST.'} Zelená = výhry, šedá = remízy.</p>` : ''}

    ${stats.recent.length ? html`<h2>Poslední zápasy</h2>
    <div class="list">${stats.recent.map(m => html`
      <a class="li" href="#/t/${m.tournament_id}">
        <span class="pill ${m.won ? 'ok' : ''}" style="min-width:34px;justify-content:center">${m.won ? 'V' : 'P'}</span>
        <div class="grow" style="min-width:0">
          <div class="ellipsis">proti <b>${m.opponent}</b></div>
          <div class="small faint ellipsis">${m.tournament}</div>
        </div>
        <span class="num">${m.best_of > 1 ? `${m.my_wins}:${m.opp_wins}` : `${m.my_score}:${m.opp_score}`}</span>
      </a>`)}</div>` : ''}

    ${events.length ? html`<h2>Akce</h2><div class="list">${events.map(t => html`<a class="li" href="#/t/${t.id}"><span class="grow">${t.name}</span><span class="small faint">${kindLabel(t)} · ${fmtDate(t.starts_at)}</span></a>`)}</div>` : ''}
`)
  const rerender = () => render(main, [id])
  profStats(main.querySelector('#prof-stats'), id, own)
  if (own && state.level >= 3) adminStrip(main, p, rerender)
  if (own) {   // #/me?s=backup|reports|errors|requests|tickets|privacy|share → rovnou otevřít
    const s = new URLSearchParams(location.hash.split('?')[1] || '').get('s')
    if (s && OPEN[s]) { window.history.replaceState(null, '', '#/me'); OPEN[s](p, rerender) }
  }

  on(main, 'change', '[data-lgrole]', async (e, sel) => {
    const r = lgs.roles.find(x => x.league === sel.dataset.lgrole)
    sel.disabled = true
    try {
      await rpc('league_staff_set', { p_league: r.league, p_user: id, p_role: sel.value || null })
      r.role = sel.value || null
      toast(sel.value ? `${p.nick}: ${sel.value === 'manager' ? 'správce' : 'organizátor'} ligy ${r.name}.` : `${p.nick} už v lize ${r.name} nic nezakládá.`, 'ok')
    } catch (err) { sel.value = r.role || ''; toast(errMsg(err), 'err') }
    sel.disabled = false
  })
  on(main, 'click', '#bk [data-k]', (e, b) => {
    main.querySelectorAll('#bk button').forEach(x => x.classList.toggle('on', x === b))
    mount(main.querySelector('#bl'), beyList(bs[b.dataset.k]))
  })
  on(main, 'change', '[data-role]', async (e, cb) => {
    const L = Number(cb.dataset.level)
    const target = cb.checked ? cb.dataset.role : ROLES.find(x => x.level === L - 1).key
    const label = ROLES.find(x => x.key === target).label
    if (!await confirmBox(`Nastavit ${p.nick} funkci: ${label}?`, { ok: 'Nastavit' })) { cb.checked = !cb.checked; return }
    try { await rpc('set_user_role', { p_user: id, p_role: target }); toast('Funkce změněna.', 'ok'); render(main, [id]) }
    catch (err) { cb.checked = !cb.checked; toast(errMsg(err), 'err') }
  })
  on(main, 'change', '[data-cashier]', async (e, cb) => {
    if (!await confirmBox(cb.checked ? `Dát ${p.nick} funkci Pokladník?` : `Odebrat ${p.nick} funkci Pokladník?`, { ok: cb.checked ? 'Dát' : 'Odebrat' })) { cb.checked = !cb.checked; return }
    try { await rpc('set_cashier', { p_user: id, p_on: cb.checked }); toast('Funkce změněna.', 'ok'); render(main, [id]) }
    catch (err) { cb.checked = !cb.checked; toast(errMsg(err), 'err') }
  })
  on(main, 'click', '[data-act=settings]', () => openSettingsWheel(p, rerender))
  on(main, 'click', '[data-act=choose]', () => import('./favorites.js').then(m => m.openChooseWheel()))
  on(main, 'click', '[data-act=admin]', () => openSettingsWheel(p, rerender, 'admin'))
}

// smazání účtu: potvrzení nickem, nejdřív fotky z bazaru (dokud je hráč přihlášený), pak účet
function deleteAccountModal(p) {
  modal(html`
    <h2>Smazat účet</h2>
    <p>Tohle nejde vrátit. Smaže se profil, rating, zprávy v chatu, dotazy, hlasy v anketách a členství v komunitách.
      Ve výsledcích turnajů zůstaneš jako „Smazaný hráč“.</p>
    <form id="f-del" class="stack" style="margin-top:10px">
      <label class="f"><span>Pro potvrzení napiš svůj nick: <b>${p.nick}</b></span><input class="input" name="nick" autocomplete="off" required></label>
      <div class="row" style="gap:8px"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn danger grow">Smazat účet</button></div>
    </form>`, {
    onMount: (box, close) => on(box, 'submit', '#f-del', (e, f) => {
      e.preventDefault()
      if (f.nick.value.trim().toLowerCase() !== p.nick.toLowerCase()) return toast('Nick nesedí.', 'err')
      busy(f.querySelector('button.danger'), async () => {
        try {
          const photos = await rpc('bazar_my_photos')
          await rpc('delete_my_account', { p_nick: f.nick.value.trim() })
          if (photos?.length) await sb.storage.from('bazar').remove(photos).catch(() => {})
          close(); await sb.auth.signOut().catch(() => {})
          toast('Účet je smazaný. Díky, že jsi hrál s námi.', 'ok', 6000); location.hash = '#/'
        } catch (err) { toast(errMsg(err), 'err') }
      })
    }),
  })
}

function editModal(p, done) {
  let avatar = p.avatar
  modal(html`
    <h2>Upravit profil</h2>
    <form class="stack" id="f-prof">
      <label class="f"><span>Nick</span><input class="input" name="nick" required minlength="2" maxlength="24" value="${p.nick}"></label>
      <label class="f"><span>Kraj</span><select class="input" name="region">${REGIONS.map(r => html`<option ${r === p.region ? 'selected' : ''}>${r}</option>`)}</select></label>
      <div><span class="muted small">Avatar</span><div style="margin-top:6px">${avatarPicker(avatar)}</div></div>
      <label class="f"><span>O mně</span><textarea class="input" name="bio" maxlength="280" placeholder="Oblíbený bey, klub…">${p.bio || ''}</textarea></label>
      <button class="btn primary block">Uložit</button>
    </form>`, {
    onMount: (box, close) => {
      on(box, 'click', '[data-av]', (e, b) => { avatar = b.dataset.av; box.querySelectorAll('[data-av]').forEach(x => x.classList.toggle('on', x === b)) })
      on(box, 'submit', '#f-prof', async (e, f) => {
        e.preventDefault()
        const v = formData(f)
        await busy(f.querySelector('button.primary'), async () => {
          try {
            await q(sb.from('profiles').update({ nick: v.nick.trim(), region: v.region, avatar, bio: v.bio.trim() || null }).eq('id', p.id))
            await refreshMe(); close(); toast('Profil uložen.', 'ok'); done()
          } catch (err) { toast(errMsg(err), 'err') }
        })
      })
    },
  })
}

// upozornění i při zavřené aplikaci (toto zařízení)
async function pushCard(box) {
  const st = await pushStatus()
  const msg = {
    'ios-install': 'Na iPhonu to jde jen z aplikace na ploše: v Safari dej Sdílet → Přidat na plochu, otevři BBX Unity odtud a zapni upozornění tady.',
    unsupported: 'Tenhle prohlížeč upozornění při zavřené aplikaci neumí. Zkus Chrome nebo aplikaci přidanou na plochu.',
    denied: 'Upozornění máš pro BBX Unity zakázaná. Povol je v nastavení prohlížeče (ikona zámku u adresy) a vrať se sem.',
  }[st.support]
  mount(box, html`
    <div class="row between wrap" style="gap:10px">
      <div class="grow" style="min-width:200px"><h3 style="margin:0">Upozornění na telefonu</h3>
        <p class="small muted" style="margin:4px 0 0">${msg || (st.on
          ? `Zapnuté na tomhle zařízení${st.devices > 1 ? ` (celkem ${st.devices} zařízení)` : ''}. Přijde ti aréna, start turnaje, výzva, nová anketa, odpověď na dotaz i info k turnaji – i když máš BBX Unity zavřené.`
          : 'Aréna, start turnaje, výzva na trénink, nová anketa, odpověď na dotaz a info k turnaji i při zavřené aplikaci.')}</p></div>
      ${!msg ? html`<button class="btn ${st.on ? 'ghost' : 'primary'}" data-push="${st.on ? 'off' : 'on'}">${st.on ? 'Vypnout' : 'Zapnout'}</button>` : ''}
    </div>`)
  on(box, 'click', '[data-push]', (e, b) => busy(b, async () => {
    try {
      if (b.dataset.push === 'on') { localStorage.removeItem('bbxu_push_off'); await enablePush(); toast('Upozornění jsou zapnutá.', 'ok') }
      else { localStorage.setItem('bbxu_push_off', '1'); await disablePush(); toast('Upozornění na tomhle zařízení jsou vypnutá.', 'ok') }
      pushCard(box)
    } catch (err) { toast(err.message || errMsg(err), 'err') }
  }))
}

// ── Nastavení (ozubené kolečko u jména): kolečko jako v BBXST ──
//    Profil: upravit, heslo, sdílet, soukromí, odhlásit, Smazání účtu → Smazat natrvalo (+ potvrzení nickem)
//    Vstupenka: QR do běžících turnajů (i bez signálu z localStorage)
//    Aplikace: upozornění, instalace na plochu, nápověda
//    Správa (admin 3+): žádosti, nahlášený obsah, chyby z telefonů, záloha, lidé s funkcí – s odznaky
const sheet = (body, fill, opts = {}) => modal(html`${body}<button class="btn block" data-close style="margin-top:14px">Zavřít</button>`, {
  onMount: (m, close) => {
    if (opts.wide) m.classList.add('wide')
    window.addEventListener('hashchange', close, { once: true })
    fill?.(m, close)
  },
})
const box = (cls, fill) => sheet(html`<section class="card ${cls}" id="${cls}" aria-live="polite"><div class="spinner" aria-label="Načítám"></div></section>`,
  (m) => fill(m.querySelector('section')))
const adminBox = (id, fill) => sheet(html`<section id="${id}" class="admin-box admin-sheet"><div class="spinner" aria-label="Načítám"></div></section>`,
  (m) => fill(m.querySelector('section')), { wide: true })

const OPEN = {
  backup: () => adminBox('admin-bk', adminBackup),
  reports: () => adminBox('admin-rep', adminReports),
  errors: () => adminBox('admin-err', adminErrors),
  requests: () => adminBox('admin-req', adminRequests),
  staff: () => staffSheet(),
  words: () => wordsSheet(),
  privacy: (p, rerender) => privacySheet(rerender),
  share: (p) => shareSheet(p),
  theme: () => themeSheet(),
  tickets: async () => {
    const t = await myTickets()
    if (t.length) ticketSheet(t[0]); else toast('Teď nemáš žádnou vstupenku do běžícího turnaje.')
  },
}

export async function openSettingsWheel(p, rerender, start) {
  const lvl = state.level
  const [counts, tickets] = await Promise.all([lvl >= 3 ? rpc('admin_counts').catch(() => null) : null, myTickets()])
  const c = counts || {}
  const due = lvl >= 4 && counts && backupDue(c.backup_at)
  const admin = { label: 'Správa', icon: 'shield', color: 'var(--bolt)', hidden: lvl < 3,
    badge: (c.requests || 0) + (c.reports || 0) + (c.errors || 0) + (due ? 1 : 0) || null, children: [
      { label: 'Žádosti ke schválení', short: 'Žádosti', icon: 'users', hidden: lvl < 4, badge: c.requests || null, run: OPEN.requests },
      { label: 'Nahlášený obsah', short: 'Nahlášené', icon: 'flag', badge: c.reports || null, run: OPEN.reports },
      { label: 'Chyby z telefonů', short: 'Chyby', icon: 'bug', badge: c.errors || null, run: OPEN.errors },
      { label: 'Záloha dat', short: 'Záloha', icon: 'disk', hidden: lvl < 4, badge: due ? '!' : null, run: OPEN.backup },
      { label: 'Lidé s funkcí', short: 'Funkce', icon: 'star', run: OPEN.staff },
      { label: 'Zakázaná slova', short: 'Slova', icon: 'lock', hidden: lvl < 4, run: OPEN.words },
    ] }
  const vis = (n) => n.children ? { ...n, children: n.children.filter(c => !c.hidden).map(vis) } : n
  if (start === 'admin') return openCreateWheel(vis(admin), { title: 'Správa', hint: 'Co chceš vyřídit?', label: 'Správa' })
  openCreateWheel(vis({ label: 'Nastavení', children: [
    { label: 'Profil', icon: 'user', color: 'var(--cyan)', children: [
      { label: 'Upravit profil', short: 'Upravit', icon: 'pen', run: () => editModal(p, rerender) },
      { label: 'Změnit heslo', short: 'Heslo', icon: 'key', run: () => import('./auth.js').then(m => m.newPasswordModal()) },
      { label: 'Sdílet profil', short: 'Sdílet', icon: 'share', run: () => shareSheet(p) },
      { label: 'Soukromí', icon: 'lock', run: () => privacySheet(rerender) },
      { label: 'Odhlásit', icon: 'logout', run: async () => { await disablePush(); await sb.auth.signOut(); toast('Odhlášeno.'); location.hash = '#/' } },
      { label: 'Smazání účtu', short: 'Smazání', icon: 'warn', color: '#ff4d6d', children: [
        { label: 'Smazat účet natrvalo', short: 'Smazat', icon: 'trash', run: () => deleteAccountModal(p) },
      ] },
    ] },
    { label: 'Vstupenka', icon: 'ticket', color: '#00ffaa', hidden: !tickets.length,
      ...(tickets.length === 1 ? { run: () => ticketSheet(tickets[0]) }
        : { children: tickets.map(t => ({ label: t.name, icon: 'ticket', run: () => ticketSheet(t) })) }) },
    { label: 'Aplikace', icon: 'phone', color: 'var(--magenta)', children: [
      { label: 'Upozornění na telefonu', short: 'Upozornění', icon: 'bell', run: () => box('push-card', pushCard) },
      { label: 'Aplikace na plochu', short: 'Instalace', icon: 'install', run: () => box('inst-card', installCard) },
      { label: 'Vzhled', icon: 'contrast', run: () => themeSheet() },
      { label: 'Nápověda', icon: 'help', go: '#/help' },
    ] },
    admin,
  ] }), { title: 'Nastavení', hint: 'Co chceš nastavit?', label: 'Nastavení' })
}

// admin: odznak na kolečku + pruh „Správa: …“ pod záhlavím, když něco čeká
async function adminStrip(main, p, rerender) {
  const c = await rpc('admin_counts').catch(() => null)
  if (!c || !main.isConnected) return
  const due = state.level >= 4 && backupDue(c.backup_at)
  const parts = [
    c.requests && plural(c.requests, 'žádost', 'žádosti', 'žádostí'),
    c.reports && plural(c.reports, 'nahlášení', 'nahlášení', 'nahlášení'),
    c.errors && plural(c.errors, 'chyba', 'chyby', 'chyb'),
    due && 'čas na zálohu',
  ].filter(Boolean)
  const n = (c.requests || 0) + (c.reports || 0) + (c.errors || 0) + (due ? 1 : 0)
  const b = main.querySelector('.prof-gear-badge')
  if (b && n) { b.hidden = false; b.textContent = n > 99 ? '99+' : n }
  const strip = main.querySelector('#admin-strip')
  if (strip && parts.length) mount(strip, html`<button class="admin-strip" data-act="admin">
    <span class="as-ico">${raw(ICONS.shield)}</span><span class="grow"><b>Správa čeká</b><br><span class="small">${parts.join(' · ')}</span></span><span aria-hidden="true">›</span></button>`)
}

// ── vstupenky: běžící / chystané turnaje, kde jsem aktivně přihlášený; QR se drží v telefonu ──
const tkKey = () => `bbxu_tickets:${state.user?.id}`
async function myTickets() {
  const regs = state.myRegs.filter(r => r.status === 'active')
  try {
    const ts = regs.length ? await q(sb.from('tournaments').select('id,name,starts_at,status,location')
      .in('id', regs.map(r => r.tournament_id)).eq('kind', 'tournament').in('status', ['registration', 'swiss', 'topcut'])) : []
    const list = (await Promise.all(ts.map(async t => {
      const [r] = await rpc('my_registration', { p_tournament: t.id })
      return r?.qr_token ? { id: t.id, name: t.name, starts_at: t.starts_at, status: t.status, location: t.location,
        nick: r.nick, qr: r.qr_token, beys: [r.bey1, r.bey2, r.bey3].filter(Boolean), checked: !!r.checked_in_at } : null
    }))).filter(Boolean).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    try { localStorage.setItem(tkKey(), JSON.stringify(list)) } catch {}
    return list
  } catch {   // bez signálu: poslední uložené
    try { return JSON.parse(localStorage.getItem(tkKey()) || '[]').map(t => ({ ...t, offline: true })) } catch { return [] }
  }
}
function ticketSheet(t) {
  const text = qrPayload(t.id, t.qr)
  sheet(html`
    <div class="tk">
      <div class="tk-label">Vstupenka</div>
      <h2 class="tk-name">${t.name}</h2>
      <div class="small muted">${fmtDate(t.starts_at)}${t.location ? ` · ${t.location}` : ''}</div>
      <div class="tk-qr" aria-label="QR kód vstupenky">${qrSvg(text)}</div>
      <div class="tk-nick">${t.nick}</div>
      ${t.beys.length ? html`<div class="pass-beys">${t.beys.map(b => html`<span>${b}</span>`)}</div>` : ''}
      ${t.checked ? html`<div class="pass-checkin on">✓ Registrace zkontrolována</div>` : ''}
      <p class="hint">${t.offline ? 'Jsi bez signálu – ukazuju uloženou vstupenku. ' : ''}QR ukaž organizátorovi u kontroly registrace nebo judgovi. Funguje i bez signálu.</p>
    </div>
    <div class="row" style="gap:8px;margin-top:12px">
      <a class="btn grow" href="#/t/${t.id}">Můj Status</a>
      <button class="btn grow" data-tk-save>Uložit QR</button>
    </div>`, (m) => on(m, 'click', '[data-tk-save]', () => {
    const a = document.createElement('a')
    a.href = qrPng(text, 10); a.download = `bbxu-${t.name}-${t.nick}.png`.replace(/[^\w.-]+/g, '_'); a.click()
  }))
}

// ── vzhled: Neon / Bez neonů (js/theme.js), platí pro tohle zařízení ──
function themeSheet(after) {
  const draw = (m) => mount(m.querySelector('.theme-opts'), THEMES.map(([k, l, d, sw]) => html`
    <button type="button" class="theme-opt ${getTheme() === k ? 'on' : ''}" data-theme-k="${k}" aria-pressed="${getTheme() === k}">
      <span class="theme-sw ${k}" aria-hidden="true" style="--sw-bg:${sw[0]};--sw-1:${sw[1]};--sw-2:${sw[2]};--sw-3:${sw[3]}"><i></i><i></i><i></i></span>
      <span class="grow"><b>${l}</b><span class="small muted">${d}</span></span></button>`))
  sheet(html`<h2>Vzhled</h2>
    <p class="small muted">Platí pro tohle zařízení. Mění se jen barvy, rozložení zůstává. BBXST (počítadlo) zůstává, jak je.</p>
    <div class="theme-opts" role="group" aria-label="Vzhled aplikace"></div>`, (m) => {
    draw(m)
    on(m, 'click', '[data-theme-k]', (e, b) => { setTheme(b.dataset.themeK); draw(m); after?.() })
  })
}

// ── sdílet profil: odkaz + QR (adresa podle toho, kde web běží) ──
function shareSheet(p) {
  const url = location.href.split('#')[0].replace(/index\.html$/, '') + '#/p/' + p.id
  sheet(html`
    <h2>Sdílet profil</h2>
    <p class="small muted">Kdo naskenuje QR nebo otevře odkaz, uvidí tvůj profil.</p>
    <div class="tk-qr" aria-label="QR kód profilu">${qrSvg(url)}</div>
    <div class="tk-nick">${p.avatar} ${p.nick}</div>
    <input class="input" readonly value="${url}" aria-label="Odkaz na profil" style="margin-top:12px;font-size:13px">
    <div class="row" style="gap:8px;margin-top:10px">
      ${navigator.share ? html`<button class="btn primary grow" data-sh="share">Poslat</button>` : ''}
      <button class="btn grow" data-sh="copy">Kopírovat odkaz</button>
    </div>`, (m) => {
    on(m, 'click', '[data-sh=share]', () => navigator.share({ title: `${p.nick} · BBX Unity`, url }).catch(() => {}))
    on(m, 'click', '[data-sh=copy]', async () => {
      try { await navigator.clipboard.writeText(url); toast('Odkaz zkopírovaný.', 'ok') }
      catch { m.querySelector('input').select(); toast('Zkopíruj odkaz ručně.') }
    })
  })
}

// ── soukromí (34): co ostatní v profilu neuvidí ──
const PRIV = [
  ['beys', 'Statistiky beyů a endy', 'Buildy, blady, ratchety, bity a endy uvidíš jen ty.'],
  ['h2h', 'Soupeři a vzájemná bilance', 'Ostatní neuvidí tvoje nejčastější soupeře ani „Ty vs hráč“.'],
  ['standings', 'Nebýt ve Standings', 'Nebudeš v seznamu hráčů podle ratingu (sám sebe tam uvidíš).'],
]
function privacySheet(rerender) {
  sheet(html`
    <h2>Soukromí</h2>
    <p class="small muted">Co ostatní v tvém profilu neuvidí. Výsledky turnajů, pavouk, pořadí a meta zůstávají veřejné.</p>
    <div class="card roles" style="margin-top:12px">${PRIV.map(([k, l, d]) => html`
      <label class="check"><span>${l}<br><span class="faint small">${d}</span></span>
        <input type="checkbox" data-priv="${k}" ${state.profile?.privacy?.[k] ? 'checked' : ''}></label>`)}</div>`, (m) => {
    on(m, 'change', '[data-priv]', async (e, cb) => {
      const next = { ...(state.profile?.privacy || {}), [cb.dataset.priv]: cb.checked }
      for (const k of Object.keys(next)) if (!next[k]) delete next[k]
      cb.disabled = true
      try {
        await q(sb.from('profiles').update({ privacy: next }).eq('id', state.user.id))
        state.profile.privacy = next; toast(cb.checked ? 'Skryto před ostatními.' : 'Zase viditelné.', 'ok'); rerender()
      } catch (err) { cb.checked = !cb.checked; toast(errMsg(err), 'err') }
      cb.disabled = false
    })
  })
}

// ── lidé s funkcí (admin): přehled + hledání hráče; funkce se mění v jeho profilu ──
async function staffSheet() {
  const rows = await q(sb.from('profiles').select('id,nick,avatar,role,cashier').not('nick', 'is', null)
    .or('role.neq.player,cashier.eq.true')).catch(() => [])
  const groups = [...ROLES].reverse().filter(r => r.level > 0).map(r => [r, rows.filter(x => x.role === r.key)])
  const cash = rows.filter(x => x.cashier)
  const li = (x) => html`<a class="li" href="#/p/${x.id}"><span class="av">${x.avatar}</span><span class="grow ellipsis">${x.nick}</span></a>`
  sheet(html`
    <h2>Lidé s funkcí</h2>
    <input class="input" type="search" id="st-q" placeholder="Najít hráče podle nicku" aria-label="Najít hráče" style="margin-top:8px">
    <div id="st-r" class="list" style="margin-top:8px"></div>
    ${groups.map(([r, l]) => l.length ? html`<h3 style="margin-top:14px">${r.label} <span class="faint small">${l.length}</span></h3><div class="list">${l.map(li)}</div>` : '')}
    ${cash.length ? html`<h3 style="margin-top:14px">💰 Pokladník <span class="faint small">${cash.length}</span></h3><div class="list">${cash.map(li)}</div>` : ''}
    <p class="hint">Funkci změníš v profilu hráče (karta Funkce).</p>`, (m) => {
    let tm
    on(m, 'input', '#st-q', (e, el) => {
      clearTimeout(tm)
      tm = setTimeout(async () => {
        const v = el.value.trim()
        const res = v.length < 2 ? [] : await q(sb.from('profiles').select('id,nick,avatar,role,cashier')
          .ilike('nick', `%${v.replace(/[%_]/g, '\\$&')}%`).limit(10)).catch(() => [])
        mount(m.querySelector('#st-r'), res.map(li))
      }, 250)
    })
  }, { wide: true })
}

// ── Zakázaná slova (45, jen hlavní admin): nick s nimi nejde uložit, v chatu se nahradí hvězdičkami ──
function wordsSheet() {
  sheet(html`
    <h2>Zakázaná slova</h2>
    <p class="hint">Nick s takovým slovem nejde uložit, v chatu se slovo nahradí hvězdičkami. Nevadí velká písmena, diakritika,
      čísla místo písmen (k0k0t) ani zdvojená písmena. <b>Uvnitř slova</b> = chytí i delší tvary (<i>kurv</i> → kurva, kurvo…),
      <b>jen celé slovo</b> = pro krátká slova, která jsou uvnitř běžných slov (<i>pica</i> nechytí EpicUser).</p>
    <form id="bw-add" class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
      <input class="input grow" name="word" maxlength="40" required placeholder="Nové slovo" aria-label="Nové zakázané slovo" autocomplete="off" style="min-width:140px">
      <label class="row small" style="gap:6px;align-items:center"><input type="checkbox" name="exact"> jen celé slovo</label>
      <button class="btn primary">Přidat</button>
    </form>
    <input class="input" id="bw-test" placeholder="Vyzkoušet: napiš nick nebo zprávu" aria-label="Vyzkoušet text" autocomplete="off" style="margin-top:10px">
    <p id="bw-res" class="small" aria-live="polite" style="min-height:2.6em;margin-top:6px"></p>
    <div id="bw-list"><div class="spinner" aria-label="Načítám"></div></div>`, (m) => {
    const list = m.querySelector('#bw-list')
    const load = async () => {
      let rows
      try { rows = await rpc('banned_word_list') } catch (e) { return mount(list, html`<p class="bad-t">${errMsg(e)}</p>`) }
      mount(list, rows.length ? html`<p class="small faint">${plural(rows.length, 'slovo', 'slova', 'slov')} · čárkovaně = jen celé slovo</p>
        <div class="bw-words">${rows.map(r => html`<span class="bw-word ${r.exact ? 'exact' : ''}">
          <span>${r.word}</span><small>${r.exact ? 'celé' : 'uvnitř'}</small>
          <button type="button" class="bw-del" data-del="${r.word}" aria-label="Odebrat ${r.word}" title="Odebrat">✕</button></span>`)}</div>`
        : html`<p class="hint">Seznam je prázdný.</p>`)
    }
    on(m, 'submit', '#bw-add', async (e, f) => {
      e.preventDefault()
      const d = formData(f)
      try { await rpc('banned_word_set', { p_word: d.word, p_on: true, p_exact: !!d.exact }); f.reset(); toast('Přidáno.'); load(); test() }
      catch (err) { toast(errMsg(err), 'err') }
    })
    on(m, 'click', '[data-del]', async (e, b) => {
      try { await rpc('banned_word_set', { p_word: b.dataset.del, p_on: false }); load(); test() }
      catch (err) { toast(errMsg(err), 'err') }
    })
    let tm
    const res = m.querySelector('#bw-res'), inp = m.querySelector('#bw-test')
    const test = async () => {
      const v = inp.value.trim()
      if (!v) return mount(res, '')
      try {
        const r = await rpc('banned_word_test', { p_text: v })
        if (inp.value.trim() !== v) return
        mount(res, html`Nick: <b class="${r.nick_ok ? 'ok-t' : 'bad-t'}">${r.nick_ok ? '✓ projde' : '✕ odmítne se'}</b><br>Chat: <span>${r.chat}</span>`)
      } catch (err) { mount(res, html`<span class="bad-t">${errMsg(err)}</span>`) }
    }
    on(m, 'input', '#bw-test', () => { clearTimeout(tm); tm = setTimeout(test, 300) })
    load()
  }, { wide: true })
}

// ── Stats (36): umístění v top 3 (držitel) a hodnoty hráče; sezóna / celkem ──
async function profStats(box, id, own) {
  if (!box) return
  let season = thisSeason()
  const draw = async () => {
    let d
    try { d = await rpc('player_stat_ranks', { p_user: id, p_season: season }) } catch { return mount(box, '') }
    if (!box.isConnected) return
    const v = d?.values || {}
    const counters = STATS.filter(s => s.kind === 'count' && v[s.key]?.value)
    const recs = STATS.filter(s => s.kind === 'record' && d?.[s.key])
    // dlaždice: na bedně (1.–3.) zlatá / stříbrná / bronzová s medailí v rohu, ty jdou první
    const tiles = [
      ...counters.map(s => ({ s, v: v[s.key].value, rank: v[s.key].rank })),
      ...recs.map(s => ({ s, v: fmtSecs(d[s.key].secs), rank: d[s.key].rank })),
    ].map((t, i) => ({ ...t, i, podium: t.rank && t.rank <= 3 ? t.rank : 0 }))
     .sort((a, b) => (a.podium || 9) - (b.podium || 9) || a.i - b.i)
    mount(box, html`
      <div class="row between" style="align-items:center;gap:8px">
        <h2 class="grow">Stats</h2>
        <div class="seg sm" role="radiogroup" aria-label="Sezóna">
          <button type="button" data-season="${thisSeason()}" class="${season ? 'on' : ''}" aria-pressed="${!!season}">${thisSeason()}</button>
          <button type="button" data-season="all" class="${season ? '' : 'on'}" aria-pressed="${!season}">Celkem</button>
        </div>
      </div>
      ${tiles.length ? html`<div class="ps-grid">${tiles.map(t => html`
          <a class="ps-tile ${t.podium ? 'r' + t.podium : ''}" href="#/stats?s=${t.s.key}&y=${season || 'all'}"
             aria-label="${t.s.name}: ${t.v}${t.rank ? `, ${t.rank}. místo` : ''}">
            ${t.podium ? html`<span class="ps-medal" aria-hidden="true">${medal(t.podium)}</span>` : ''}
            <span class="ps-v num">${t.v}</span><span class="ps-k">${t.s.name}</span>
            ${t.rank ? html`<span class="ps-r">${t.rank}. místo</span>` : ''}</a>`)}
        </div>`
        : html`<p class="hint">${own ? 'Zatím žádné stats – odnes si je z turnajů.' : 'Zatím žádné stats.'}</p>`}
      <a class="btn sm ghost" href="#/stats" style="margin-top:8px">Stats ladder</a>`)
  }
  on(box, 'click', '[data-season]', (e, b) => { season = b.dataset.season === 'all' ? null : Number(b.dataset.season); draw() })
  await draw()
}
