// ════════════════════════════════════════════════════════════════
//  Profil hráče: role, statistiky, historie turnajů, beyblady, rating
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, q, errMsg, refreshMe, isLoggedIn } from '../supa.js'
import { adminErrors, adminBackup } from '../admin.js'
import { leagueBadges, leagueRolesCard } from './leagues.js'
import { installCard } from '../install.js'
import { html, mount, on, formData, toast, modal, busy, confirmBox, fmtDate, raw, plural, kindLabel, finishTiles } from '../ui.js'
import { ROLES, REGIONS, roleLevel } from '../core.js'
import { avatarPicker } from './auth.js'
import { communityBadges, adminRequests } from './communities.js'
import { adminReports } from '../report.js'
import { pushStatus, enablePush, disablePush } from '../push.js'

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
    <button class="btn ghost block" style="margin-top:24px" data-act="logout">Zapomenout hosta na tomhle zařízení</button>`)
  installCard(main.querySelector('#inst-card'))
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
    <line x1="0" x2="${w}" y1="${(h - (1000 - min) / (max - min) * h).toFixed(1)}" y2="${(h - (1000 - min) / (max - min) * h).toFixed(1)}" stroke="#2a3772" stroke-dasharray="4 4"/>
    <path d="${d}" fill="none" stroke="#ffd21f" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#ffd21f"/></svg>`)
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
        <div class="row wrap" style="margin-top:6px;gap:6px">${ROLES.filter(x => x.level > 0 && x.level <= lvl).map(x => html`<span class="pill role">${x.label}</span>`)}</div>
      </div>
    </div>
    ${communityBadges(comms)}
    ${leagueBadges(lgs.standings)}
    ${p.bio ? html`<p style="margin-top:14px;white-space:pre-line">${p.bio}</p>` : ''}
    ${own ? html`<div class="row wrap" style="margin-top:14px">
      <button class="btn sm" data-act="edit">Upravit profil</button>
      <button class="btn sm ghost" data-act="pw">Změnit heslo</button>
      <a class="btn sm ghost" href="#/help">Jak na to</a>
      <button class="btn sm ghost" data-act="logout">Odhlásit</button></div>` : ''}
    ${own && state.level >= 4 ? html`<section id="admin-req" class="admin-box"></section>` : ''}
    ${own && state.level >= 3 ? html`<section id="admin-rep" class="admin-box"></section>` : ''}
    ${own && state.level >= 3 ? html`<section id="admin-err" class="admin-box"></section>` : ''}
    ${own && state.level >= 4 ? html`<section id="admin-bk" class="admin-box"></section>` : ''}

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

    ${h2hBlock(h2h, p, own)}

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
      <p class="hint">Vyšší funkce zahrnuje nižší: admin je i organizátor a judge, organizátor je i judge.</p>
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
    <p class="hint">Velké číslo = kolikrát ${own ? 'jsi' : 'hráč'} soupeře takhle dorazil, malé = kolikrát ${own ? 'jsi' : 'byl'} takhle poražen${own ? '' : ''}.</p>` : ''}

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
    ${own ? html`<section class="card push-card" id="push-card" aria-live="polite"><div class="spinner" aria-label="Načítám"></div></section>` : ''}
    ${own ? html`<section class="card inst-card" id="inst-card"></section>` : ''}
    ${own ? html`<section class="danger-zone">
      <h2>Účet</h2>
      <p class="small muted">Smazáním účtu zmizí profil, zprávy, inzeráty i fotky. Výsledky turnajů zůstanou, ale bez tvého jména.</p>
      <button class="btn sm danger" data-act="delete-account">Smazat účet</button></section>` : ''}`)
  if (own && state.level >= 4) adminRequests(main.querySelector('#admin-req'))
  if (own && state.level >= 3) adminReports(main.querySelector('#admin-rep'))
  if (own && state.level >= 3) adminErrors(main.querySelector('#admin-err'))
  if (own && state.level >= 4) adminBackup(main.querySelector('#admin-bk'))
  if (own) pushCard(main.querySelector('#push-card'))
  if (own) installCard(main.querySelector('#inst-card'))

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
  on(main, 'click', '[data-act=logout]', async () => { await disablePush(); await sb.auth.signOut(); toast('Odhlášeno.'); location.hash = '#/' })
  on(main, 'click', '[data-act=pw]', () => import('./auth.js').then(m => m.newPasswordModal()))
  on(main, 'click', '[data-act=edit]', () => editModal(p, () => render(main, [id])))
  on(main, 'click', '[data-act=delete-account]', () => deleteAccountModal(p))
}

// smazání účtu: potvrzení nickem, nejdřív fotky z bazaru (dokud je hráč přihlášený), pak účet
function deleteAccountModal(p) {
  modal(html`
    <h2>Smazat účet</h2>
    <p>Tohle nejde vrátit. Smaže se profil, rating, zprávy v chatu, inzeráty v bazaru i s fotkami a členství v komunitách.
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
          ? `Zapnuté na tomhle zařízení${st.devices > 1 ? ` (celkem ${st.devices} zařízení)` : ''}. Přijde ti aréna, start turnaje, výzva, zpráva v bazaru i info k turnaji – i když máš BBX Unity zavřené.`
          : 'Aréna, start turnaje, výzva na trénink, zpráva v bazaru a info k turnaji i při zavřené aplikaci.')}</p></div>
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
