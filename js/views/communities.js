// ════════════════════════════════════════════════════════════════
//  Komunity – seznam, detail, členové, žádosti, tréninky
//  Zakládá organizátor / admin, schvaluje hlavní admin (profil → Žádosti).
//  Leader + zástupci přijímají členy a zakládají komunitní tréninky.
// ════════════════════════════════════════════════════════════════
import { rpc, state, errMsg, isLoggedIn } from '../supa.js'
import { html, mount, on, formData, toast, modal, busy, confirmBox, fmtDate, fmtTime, toLocalInput, fromLocalInput, plural } from '../ui.js'
import { REGIONS } from '../core.js'

const fmtMonth = (d) => new Date(d).toLocaleDateString('cs-CZ', { month: 'short', year: '2-digit' })
export const COMM_ROLE = { leader: 'Community leader', sub: 'Sub-community leader', member: 'Člen' }

// přepínač Hráči | Komunity (sdílí ho i seznam hráčů)
export const peopleTabs = (on_) => html`<nav class="tabs people-tabs" aria-label="Hráči a komunity">
  <a href="#/players" class="${on_ === 'players' ? 'on' : ''}">Hráči</a>
  <a href="#/communities" class="${on_ === 'communities' ? 'on' : ''}">Komunity</a></nav>`

export async function renderList(main, _p, ctx) {
  const list = await rpc('community_list')
  if (!ctx.isCurrent()) return
  const canCreate = isLoggedIn() && state.level >= 2
  const approved = list.filter(c => c.status === 'approved')
  const mineOther = list.filter(c => c.status !== 'approved')

  mount(main, html`
    ${peopleTabs('communities')}
    <div class="row between wrap" style="gap:12px;margin-top:14px">
      <h1>Komunity</h1>
      ${canCreate ? html`<button class="btn primary sm" data-act="new">+ Komunita</button>` : ''}
    </div>
    <p class="muted" style="margin-top:4px">Skupiny hráčů, které spolu trénují. Do komunity tě přijme její leader nebo zástupce.</p>
    ${mineOther.length ? html`<h2>${state.level >= 4 ? 'Čekají na schválení / zamítnuté' : 'Moje žádosti'}</h2>
      <div class="list">${mineOther.map(c => html`<a class="li" href="#/c/${c.id}">
        <div class="grow" style="min-width:0"><div class="ellipsis" style="font-weight:600">${c.name}</div>
          <div class="small ${c.status === 'rejected' ? 'bad-t' : 'muted'}">${c.status === 'pending' ? 'Čeká na schválení hlavním adminem' : `Zamítnuto${c.review_note ? ` – ${c.review_note}` : ''}`}</div></div>
        <span class="pill ${c.status === 'pending' ? 'live' : ''}">${c.status === 'pending' ? 'čeká' : 'zamítnuto'}</span></a>`)}</div>` : ''}
    ${approved.length ? html`<div class="comm-grid" style="margin-top:14px">${approved.map(c => html`
      <a class="card comm-card ${c.my_status === 'active' ? 'mine' : ''}" href="#/c/${c.id}">
        <div class="row between" style="gap:8px"><h3 class="ellipsis">${c.name}</h3>
          ${c.my_status === 'active' ? html`<span class="pill ok">${c.my_role === 'member' ? 'člen' : c.my_role === 'leader' ? 'leader' : 'zástupce'}</span>`
            : c.my_status === 'pending' ? html`<span class="pill">žádost odeslána</span>` : ''}</div>
        ${c.description ? html`<p class="small muted clamp2">${c.description}</p>` : ''}
        <div class="small faint">${c.region ? `${c.region} · ` : ''}${plural(Number(c.members), 'člen', 'členové', 'členů')}${c.leader ? ` · leader ${c.leader.nick}` : ''}</div>
        ${Number(c.trainings_open) ? html`<div class="small comm-live">● ${plural(Number(c.trainings_open), 'otevřený trénink', 'otevřené tréninky', 'otevřených tréninků')}</div>` : ''}
        ${c.pending ? html`<div class="small warn-t">${plural(Number(c.pending), 'žádost', 'žádosti', 'žádostí')} o členství</div>` : ''}
      </a>`)}</div>` : html`<div class="empty" style="margin-top:14px">Zatím tu žádná komunita není.${canCreate ? ' Založ první.' : ''}</div>`}`)

  on(main, 'click', '[data-act=new]', () => communityForm(null, (id) => { location.hash = `#/c/${id}` }))
}

function communityForm(c, done) {
  modal(html`
    <h2>${c ? 'Upravit komunitu' : 'Nová komunita'}</h2>
    <form class="stack" id="f-comm">
      <label class="f"><span>Název</span><input class="input" name="name" minlength="3" maxlength="40" required value="${c?.name || ''}"></label>
      <label class="f"><span>Kraj</span><select class="input" name="region"><option value="">—</option>
        ${REGIONS.map(r => html`<option ${c?.region === r ? 'selected' : ''}>${r}</option>`)}</select></label>
      <label class="f"><span>Popis</span><textarea class="input" name="description" rows="3" maxlength="600" placeholder="Kde a kdy trénujete, pro koho komunita je…">${c?.description || ''}</textarea></label>
      ${c ? '' : html`<p class="hint">${state.level >= 4 ? 'Jako hlavní admin ji rovnou schválíš.' : 'Komunitu musí schválit hlavní admin. Pak se v ní staneš community leaderem.'}</p>`}
      <div class="row"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn primary grow">${c ? 'Uložit' : 'Odeslat ke schválení'}</button></div>
    </form>`, {
    onMount: (b, close) => on(b, 'submit', '#f-comm', async (e, f) => {
      e.preventDefault()
      const d = formData(f)
      await busy(f.querySelector('button.primary'), async () => {
        try {
          if (c) { await rpc('community_update', { p_community: c.id, p_name: d.name, p_description: d.description, p_region: d.region }); close(); toast('Uloženo.', 'ok'); done(c.id) }
          else {
            const id = await rpc('community_create', { p_name: d.name, p_description: d.description, p_region: d.region })
            close(); toast(state.level >= 4 ? 'Komunita je založená.' : 'Žádost odeslána hlavnímu adminovi.', 'ok'); done(id)
          }
        } catch (err) { toast(errMsg(err), 'err') }
      })
    }),
  })
}

// založení komunitního tréninku (komunita předvybraná, nebo výběr z mých)
export async function trainingForm(communities, preselect) {
  if (!communities.length) return toast('Trénink zakládá leader nebo zástupce schválené komunity.', 'err')
  modal(html`
    <h2>Komunitní trénink</h2>
    <form class="stack" id="f-tr">
      <label class="f"><span>Komunita</span><select class="input" name="community">
        ${communities.map(c => html`<option value="${c.id}" ${c.id === preselect ? 'selected' : ''}>${c.name}</option>`)}</select></label>
      <label class="f"><span>Název</span><input class="input" name="name" minlength="3" maxlength="80" required placeholder="Středeční trénink"></label>
      <div class="grid2">
        <label class="f"><span>Začátek</span><input class="input" type="datetime-local" name="starts_at" value="${toLocalInput(new Date(Date.now() + 36e5))}"></label>
        <label class="f"><span>Místo</span><input class="input" name="location" maxlength="120"></label>
      </div>
      <label class="f"><span>Poznámka</span><textarea class="input" name="description" rows="2" maxlength="600"></textarea></label>
      <p class="hint">Přidat se můžou členové komunity, další hráče pozveš na stránce tréninku. Trénink se nepočítá do ratingu.</p>
      <div class="row"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn primary grow">Založit trénink</button></div>
    </form>`, {
    onMount: (b, close) => on(b, 'submit', '#f-tr', async (e, f) => {
      e.preventDefault()
      const d = formData(f)
      await busy(f.querySelector('button.primary'), async () => {
        try {
          const id = await rpc('community_training_create', { p_community: d.community, p_name: d.name,
            p_starts_at: fromLocalInput(d.starts_at), p_location: d.location, p_description: d.description })
          close(); toast('Trénink je založený.', 'ok'); location.hash = `#/t/${id}`
        } catch (err) { toast(errMsg(err), 'err') }
      })
    }),
  })
}

export async function renderDetail(main, [id], ctx) {
  let d
  const load = async () => { d = await rpc('community_detail', { p_community: id }) }
  await load()
  if (!ctx.isCurrent()) return

  const draw = () => {
    const c = d.community
    const member = d.my_status === 'active'
    const isLeader = d.my_role === 'leader' && member
    const open = d.trainings.filter(t => t.status === 'registration')
    const past = d.trainings.filter(t => t.status !== 'registration')
    mount(main, html`
      ${peopleTabs('communities')}
      <header class="t-head" style="margin-top:14px">
        ${c.status !== 'approved' ? html`<span class="pill ${c.status === 'pending' ? 'live' : ''}">${c.status === 'pending' ? 'Čeká na schválení' : 'Zamítnuto'}</span>` : ''}
        <h1 style="margin-top:6px">${c.name}</h1>
        <div class="meta">${c.region ? html`<span>📍 ${c.region}</span>` : ''}<span>${plural(d.members.length, 'člen', 'členové', 'členů')}</span>
          ${d.my_role && member ? html`<span class="comm-role ${d.my_role}">${COMM_ROLE[d.my_role]}</span>` : ''}</div>
        ${c.description ? html`<p class="desc">${c.description}</p>` : ''}
        ${c.status === 'rejected' && c.review_note ? html`<div class="notice err">Důvod zamítnutí: ${c.review_note}</div>` : ''}
      </header>

      ${c.status === 'approved' ? html`<div class="row wrap" style="margin-top:12px">
        ${!isLoggedIn() ? html`<a class="btn primary" href="#/login">Přihlas se a přidej se</a>`
          : !d.my_status ? html`<button class="btn primary" data-act="join">Chci do komunity</button>`
          : d.my_status === 'pending' ? html`<span class="pill">Žádost odeslána – čeká na leadera</span><button class="btn sm ghost" data-act="leave">Zrušit žádost</button>`
          : d.my_role !== 'leader' ? html`<button class="btn sm ghost" data-act="leave">Odejít z komunity</button>` : ''}
        ${d.is_lead ? html`<button class="btn primary" data-act="training">+ Komunitní trénink</button>` : ''}
        ${isLeader || d.is_admin ? html`<button class="btn sm" data-act="edit">Upravit</button>` : ''}
      </div>` : html`<div class="row wrap" style="margin-top:12px">
        ${d.my_role === 'leader' ? html`<button class="btn sm" data-act="edit">Upravit</button>` : ''}
        ${d.my_role === 'leader' || d.is_admin ? html`<button class="btn sm danger" data-act="delete">Smazat žádost</button>` : ''}</div>`}

      ${d.pending?.length ? html`<h2>Žádosti o členství</h2>
        <div class="list">${d.pending.map(p => html`<div class="li comm-mem"><span class="av">${p.avatar || '👤'}</span>
          <div class="grow" style="min-width:0"><a class="ellipsis" href="#/p/${p.user_id}" style="font-weight:600">${p.nick}</a>
            <div class="small faint">rating ${p.rating} · ${fmtDate(p.at)}</div></div>
          <div class="li-acts"><button class="btn sm primary" data-acc="${p.user_id}">Přijmout</button>
          <button class="btn sm ghost" data-rej="${p.user_id}" aria-label="Odmítnout ${p.nick}">Odmítnout</button></div></div>`)}</div>` : ''}

      ${c.status === 'approved' ? html`
      <h2>Tréninky</h2>
      ${open.length ? html`<div class="list">${open.map(t => html`
        <a class="li" href="#/t/${t.id}">
          <div class="grow" style="min-width:0"><div class="ellipsis" style="font-weight:600">${t.name}</div>
            <div class="small faint">${t.starts_at ? `${fmtDate(t.starts_at)}, ${fmtTime(t.starts_at)}` : 'bez termínu'}${t.location ? ` · ${t.location}` : ''} · ${plural(Number(t.players), 'hráč', 'hráči', 'hráčů')}</div></div>
          <span class="pill live">otevřený</span></a>`)}</div>`
        : html`<div class="empty">Teď neběží žádný trénink.${d.is_lead ? ' Založ ho tlačítkem nahoře.' : ''}</div>`}

      <h2>Historie tréninků</h2>
      ${past.length ? html`<div class="list">${past.map(t => { const when = t.finished_at || t.starts_at || t.created_at
        return html`<a class="li tr-past" href="#/t/${t.id}/history">
          <div class="tr-date"><b>${new Date(when).getDate()}.</b><small>${fmtMonth(when)}</small></div>
          <div class="grow" style="min-width:0"><div class="ellipsis" style="font-weight:600">${t.name}</div>
            <div class="small faint">${fmtDate(when)}${t.location ? ` · ${t.location}` : ''} · ${plural(Number(t.players), 'hráč', 'hráči', 'hráčů')} · ${plural(Number(t.battles), 'souboj', 'souboje', 'soubojů')}</div></div>
          <span class="faint" aria-hidden="true">›</span></a>` })}</div>`
        : html`<div class="empty">Skončené tréninky se uloží sem – s historií soubojů a comby.</div>`}
      <p class="small" style="margin-top:8px"><a href="#/meta?c=${c.id}">Meta komunity z tréninků →</a></p>` : ''}

      <h2>Členové</h2>
      <div class="list">${d.members.map(m => html`<div class="li comm-mem"><span class="av">${m.avatar || '👤'}</span>
        <div class="grow" style="min-width:0"><a class="ellipsis" href="#/p/${m.user_id}" style="font-weight:600">${m.nick}</a>
          <div class="small faint">${m.role !== 'member' ? html`<span class="comm-role ${m.role}">${COMM_ROLE[m.role]}</span> · ` : ''}rating ${m.rating}</div></div>
        <div class="li-acts">
        ${isLeader && m.role === 'member' ? html`<button class="btn sm" data-sub="${m.user_id}">Jmenovat zástupcem</button>` : ''}
        ${isLeader && m.role === 'sub' ? html`<button class="btn sm ghost" data-unsub="${m.user_id}">Odvolat zástupce</button>` : ''}
        ${(isLeader && m.role !== 'leader') || (d.my_role === 'sub' && member && m.role === 'member') ? html`<button class="btn sm ghost" data-kick="${m.user_id}" aria-label="Vyřadit ${m.nick}">Vyřadit</button>` : ''}
        </div>
      </div>`)}</div>`)
  }
  const act = (btn, fn, msg) => busy(btn, async () => {
    try { await fn(); if (msg) toast(msg, 'ok'); await load(); if (ctx.isCurrent()) draw() } catch (e) { toast(errMsg(e), 'err') }
  })
  on(main, 'click', '[data-act=join]', (e, b) => act(b, () => rpc('community_join', { p_community: id }), 'Žádost odeslána. Přijme tě leader nebo jeho zástupce.'))
  on(main, 'click', '[data-act=leave]', async (e, b) => {
    if (!await confirmBox(d.my_status === 'pending' ? 'Zrušit žádost o členství?' : `Opravdu odejít z komunity ${d.community.name}?`, { ok: 'Ano', danger: true })) return
    act(b, () => rpc('community_leave', { p_community: id }))
  })
  on(main, 'click', '[data-act=edit]', () => communityForm(d.community, async () => { await load(); draw() }))
  on(main, 'click', '[data-act=delete]', async () => {
    if (!await confirmBox('Smazat komunitu?', { ok: 'Smazat', danger: true })) return
    try { await rpc('community_delete', { p_community: id }); toast('Smazáno.', 'ok'); location.hash = '#/communities' } catch (e) { toast(errMsg(e), 'err') }
  })
  on(main, 'click', '[data-act=training]', () => trainingForm([{ id, name: d.community.name }], id))
  on(main, 'click', '[data-acc]', (e, b) => act(b, () => rpc('community_decide', { p_community: id, p_user: b.dataset.acc, p_accept: true }), 'Přijato.'))
  on(main, 'click', '[data-rej]', (e, b) => act(b, () => rpc('community_decide', { p_community: id, p_user: b.dataset.rej, p_accept: false })))
  on(main, 'click', '[data-sub]', (e, b) => act(b, () => rpc('community_set_role', { p_community: id, p_user: b.dataset.sub, p_role: 'sub' }), 'Zástupce jmenován.'))
  on(main, 'click', '[data-unsub]', (e, b) => act(b, () => rpc('community_set_role', { p_community: id, p_user: b.dataset.unsub, p_role: 'member' })))
  on(main, 'click', '[data-kick]', async (e, b) => {
    if (!await confirmBox('Vyřadit člena z komunity?', { ok: 'Vyřadit', danger: true })) return
    act(b, () => rpc('community_kick', { p_community: id, p_user: b.dataset.kick }))
  })
  draw()
}

// ── profil: odznaky komunit ─────────────────────────────────────
export function communityBadges(list) {
  if (!list?.length) return ''
  return html`<div class="comm-badges">${list.map(c => html`<a class="comm-badge ${c.role}" href="#/c/${c.id}">
    <b>${c.name}</b><small>${COMM_ROLE[c.role]}</small></a>`)}</div>`
}

// ── profil hlavního admina: žádosti ke schválení ────────────────
export async function adminRequests(box) {
  let r
  try { r = await rpc('admin_requests') } catch { return }
  const draw = () => mount(box, html`
    <h2>Žádosti ke schválení ${r.communities.length ? html`<span class="pill live">${r.communities.length}</span>` : ''}</h2>
    ${r.communities.length ? html`<div class="stack">${r.communities.map(c => html`<div class="card stack admin-req">
      <div class="row between wrap" style="gap:8px"><b>Nová komunita: ${c.name}</b><span class="small faint">${fmtDate(c.created_at)}</span></div>
      <div class="small muted">Žádá <a href="#/p/${c.by?.id}">${c.by?.nick || '?'}</a>${c.region ? ` · ${c.region}` : ''}</div>
      ${c.description ? html`<p class="small">${c.description}</p>` : ''}
      <div class="row"><button class="btn sm primary" data-ok="${c.id}">Schválit</button><button class="btn sm danger" data-no="${c.id}">Zamítnout</button></div>
    </div>`)}</div>` : html`<div class="empty">Nic nečeká. 👌</div>`}`)
  const reload = async () => { r = await rpc('admin_requests'); draw() }
  on(box, 'click', '[data-ok]', (e, b) => busy(b, async () => {
    try { await rpc('community_review', { p_community: b.dataset.ok, p_approve: true }); toast('Komunita schválena.', 'ok'); reload() } catch (err) { toast(errMsg(err), 'err') }
  }))
  on(box, 'click', '[data-no]', (e, b) => {
    modal(html`<h2>Zamítnout komunitu</h2>
      <form class="stack" id="f-rej"><label class="f"><span>Důvod (uvidí ho zakladatel)</span><input class="input" name="note" maxlength="200"></label>
      <div class="row"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn danger grow">Zamítnout</button></div></form>`, {
      onMount: (m, close) => on(m, 'submit', '#f-rej', async (e, f) => {
        e.preventDefault()
        try { await rpc('community_review', { p_community: b.dataset.no, p_approve: false, p_note: formData(f).note }); close(); toast('Zamítnuto.', 'ok'); reload() }
        catch (err) { toast(errMsg(err), 'err') }
      }),
    })
  })
  draw()
}
