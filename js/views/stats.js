// ════════════════════════════════════════════════════════════════
//  #/stats – Stats ladder (36): turnajový (sezóna, kraj, liga) a komunitní (tréninky komunity)
//  Parametry v adrese: ?m=komunita&c=<id>&y=<rok|all>&r=<kraj>&l=<liga>&s=<stat>&n=3|10
// ════════════════════════════════════════════════════════════════
import { rpc, state } from '../supa.js'
import { html, mount, on } from '../ui.js'
import { REGIONS } from '../core.js'
import { STATS, statByKey, fmtSecs, medal, thisSeason } from '../stats.js'
import { myCommunities } from './players.js'

const params = () => new URLSearchParams(location.hash.split('?')[1] || '')

export async function render(main, _p, ctx) {
  const q = params()
  const st = {
    mode: q.get('m') === 'komunita' ? 'komunita' : 'turnaje',
    comm: q.get('c') || null,
    year: q.get('y') === 'all' ? null : Number(q.get('y')) || thisSeason(),
    region: q.get('r') || null,
    league: q.get('l') || null,
    stat: statByKey(q.get('s')) ? q.get('s') : null,
    n: q.get('n') === '10' || q.get('s') ? 10 : 3,
  }
  const [comms, leagues, seasons] = await Promise.all([
    myCommunities().catch(() => []), rpc('league_list').catch(() => []), rpc('stat_seasons').catch(() => []),
  ])
  if (!ctx.isCurrent()) return
  if (st.mode === 'komunita' && !comms.length) st.mode = 'turnaje'
  if (st.mode === 'komunita' && !comms.some(c => c.id === st.comm)) st.comm = comms[0].id
  let data = null, err = null, token = 0

  const save = () => {
    const p = new URLSearchParams()
    if (st.mode === 'komunita') { p.set('m', 'komunita'); p.set('c', st.comm) }
    p.set('y', st.year || 'all')
    if (st.mode === 'turnaje' && st.region) p.set('r', st.region)
    if (st.mode === 'turnaje' && st.league) p.set('l', st.league)
    if (st.stat) p.set('s', st.stat)
    if (st.n === 10) p.set('n', '10')
    window.history.replaceState(null, '', '#/stats?' + p)
  }

  const years = () => {
    const ys = new Set([thisSeason(), ...(st.mode === 'komunita' ? (data?.seasons || []) : seasons)])
    return [...ys].sort((a, b) => b - a)
  }

  const row = (x, val) => html`<a class="st-row ${x.user === state.user?.id ? 'me' : ''}" href="#/p/${x.user}">
    <span class="st-rank">${medal(x.rank) || x.rank + '.'}</span>
    <span class="av">${x.avatar || '🌀'}</span>
    <span class="grow ellipsis">${x.nick}${st.mode === 'turnaje' && x.region && !st.region ? html` <small class="faint">${x.region}</small>` : ''}</span>
    <b class="num">${val}</b></a>`

  const gameRow = (g, i, kind) => {
    const mine = g.w_user === state.user?.id || (kind === 'tyt' && g.l_user === state.user?.id)
    return html`<a class="st-row ${mine ? 'me' : ''}" href="#/t/${g.tournament_id}">
      <span class="st-rank">${medal(i + 1) || i + 1 + '.'}</span>
      <span class="grow"><span class="ellipsis"><b>${g.w_nick}</b> <span class="faint">${g.w_score}:${g.l_score}</span> ${g.l_nick}</span>
        <br><small class="faint ellipsis">${g.tournament}</small></span>
      <b class="num">${fmtSecs(g.secs)}</b></a>`
  }

  const card = (s) => {
    let body
    if (s.kind === 'record') {
      const list = (data?.[s.key] || []).slice(0, st.n)
      body = list.length ? list.map((g, i) => gameRow(g, i, s.key)) : html`<p class="st-empty">Zatím žádná hra ze BBXST.</p>`
    } else {
      const list = (data?.counters?.[s.key] || []).slice(0, st.n)
      const me = data?.me?.[s.key]
      const inTop = list.some(x => x.user === state.user?.id)
      body = html`${list.length ? list.map(x => row(x, x.value)) : html`<p class="st-empty">Zatím ho nikdo nemá.</p>`}
        ${me && !inTop ? html`<div class="st-row me st-mine"><span class="st-rank">${me.rank}.</span><span class="grow">Ty</span><b class="num">${me.value}</b></div>` : ''}`
    }
    return html`<section class="card st-card" data-stat="${s.key}">
      <header class="st-head"><span class="st-ico" aria-hidden="true">${s.icon}</span>
        <div class="grow"><h3>${s.name}</h3><div class="small muted">${s.desc}</div></div>
        ${st.stat ? '' : html`<button class="btn sm ghost" data-only="${s.key}" aria-label="Ukázat top 10 – ${s.name}">Top 10</button>`}</header>
      <div class="st-list">${body}</div></section>`
  }

  const draw = () => {
    if (!main.isConnected) return
    const list = STATS.filter(s => (st.mode === 'turnaje' || s.community) && (!st.stat || s.key === st.stat))
    const comm = comms.find(c => c.id === st.comm)
    mount(main, html`
      <h1 style="margin-top:14px">Stats ladder</h1>
      <p class="muted small" style="margin-top:4px">${st.mode === 'turnaje'
        ? 'Stats ze skončených turnajů a lig. Sezóna běží od 1. ledna.'
        : html`Stats z komunitních tréninků – <b>${comm?.name || ''}</b>.`}</p>
      ${comms.length ? html`<div class="seg" role="tablist" style="margin-top:12px">
        <button type="button" role="tab" data-mode="turnaje" class="${st.mode === 'turnaje' ? 'on' : ''}" aria-selected="${st.mode === 'turnaje'}">Turnaje</button>
        <button type="button" role="tab" data-mode="komunita" class="${st.mode === 'komunita' ? 'on' : ''}" aria-selected="${st.mode === 'komunita'}">Komunita</button>
      </div>` : ''}
      <div class="st-filters">
        ${st.mode === 'komunita' && comms.length > 1 ? html`<label class="f"><span>Komunita</span>
          <select class="input" data-f="comm">${comms.map(c => html`<option value="${c.id}" ${c.id === st.comm ? 'selected' : ''}>${c.name}</option>`)}</select></label>` : ''}
        <label class="f"><span>Sezóna</span>
          <select class="input" data-f="year">${years().map(y => html`<option value="${y}" ${st.year === y ? 'selected' : ''}>${y}</option>`)}
            <option value="all" ${st.year ? '' : 'selected'}>Celkem</option></select></label>
        ${st.mode === 'turnaje' ? html`
          <label class="f"><span>Kraj</span>
            <select class="input" data-f="region"><option value="">Všechny kraje</option>
              ${REGIONS.map(r => html`<option value="${r}" ${st.region === r ? 'selected' : ''}>${r}</option>`)}</select></label>
          ${leagues.length ? html`<label class="f"><span>Liga</span>
            <select class="input" data-f="league"><option value="">Všechny turnaje</option>
              ${leagues.map(l => html`<option value="${l.id}" ${st.league === l.id ? 'selected' : ''}>${l.name}</option>`)}</select></label>` : ''}` : ''}
        <label class="f"><span>Stat</span>
          <select class="input" data-f="stat"><option value="">Všechny stats</option>
            ${STATS.filter(s => st.mode === 'turnaje' || s.community).map(s => html`<option value="${s.key}" ${st.stat === s.key ? 'selected' : ''}>${s.name}</option>`)}</select></label>
      </div>
      <div class="seg sm" role="radiogroup" aria-label="Kolik míst ukázat" style="margin-top:10px">
        <button type="button" data-n="3" class="${st.n === 3 ? 'on' : ''}" aria-pressed="${st.n === 3}">Top 3</button>
        <button type="button" data-n="10" class="${st.n === 10 ? 'on' : ''}" aria-pressed="${st.n === 10}">Top 10</button>
      </div>
      ${err ? html`<div class="notice warn" style="margin-top:14px">${err}</div>`
        : !data ? html`<div class="spinner" aria-label="Načítám" style="margin-top:20px"></div>`
        : html`<div class="st-grid">${list.map(card)}</div>`}`)
  }

  const load = async () => {
    const my = ++token
    data = null; err = null; save(); draw()
    try {
      const d = st.mode === 'komunita'
        ? await rpc('community_stats_ladder', { p_community: st.comm, p_season: st.year, p_limit: 10 })
        : await rpc('stats_ladder', { p_season: st.year, p_region: st.region, p_league: st.league, p_limit: 10 })
      if (my !== token) return
      data = d
    } catch (e) { if (my !== token) return; err = 'Stats se nepodařilo načíst.' }
    draw()
  }

  on(main, 'click', '[data-mode]', (e, b) => {
    st.mode = b.dataset.mode
    if (st.mode === 'komunita') { st.comm = st.comm || comms[0]?.id; if (st.stat && !statByKey(st.stat).community) st.stat = null }
    load()
  })
  on(main, 'change', '[data-f]', (e, el) => {
    const v = el.value || null
    if (el.dataset.f === 'year') st.year = v === 'all' ? null : Number(v)
    else if (el.dataset.f === 'stat') { st.stat = v; if (v) st.n = 10; save(); return draw() }
    else st[el.dataset.f] = v
    load()
  })
  on(main, 'click', '[data-n]', (e, b) => { st.n = Number(b.dataset.n); save(); draw() })
  on(main, 'click', '[data-only]', (e, b) => { st.stat = b.dataset.only; st.n = 10; save(); draw(); window.scrollTo({ top: 0 }) })
  await load()
}
