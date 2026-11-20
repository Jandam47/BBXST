// ════════════════════════════════════════════════════════════════
//  Komunitní trénink (akce druhu „community“)
//  přidat se · deck (1–3 beye, díly se můžou opakovat) · vyzvat · BBXST training mód
//  · historie dvojic · comba (moje / celý trénink) · řízení pro leadera a zástupce
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, q, errMsg, refreshMe, isLoggedIn, askNotify } from '../supa.js'
import { html, raw, mount, on, formData, toast, modal, busy, confirmBox, statusPill, fmtDate, fmtTime, toLocalInput,
         fromLocalInput, plural, finishTiles, finishLine } from '../ui.js'
import { icon } from '../icons.js'
import { loadParts, deckEditor, bindDeckEditor } from '../parts.js'
import { liveChannel } from './tournament.js'

export const isTraining = (t) => !!t && t.event_type === 'community'
const bbxstUrl = (matchId) => `bbxst.html${matchId ? `?training=${matchId}` : ''}`
const MODE = { '3v3': '3v3', '3v1': '3v1', '1v3': '1v3', '1v1': '1v1' }

async function load(id) {
  const [t, b] = await Promise.all([
    q(sb.from('tournaments').select('*').eq('id', id).maybeSingle()),
    rpc('training_board', { p_tournament: id }),
  ])
  let myReg = null
  if (state.user && b.me) myReg = (await rpc('my_registration', { p_tournament: id }))?.[0] || null
  return { t, b, myReg }
}

export async function render(main, [id, tabArg]) {
  let d = await load(id)
  let tab = tabArg || 'me'
  let combosScope = 'me'
  let histScope = 'me'

  const isArchive = () => ['finished', 'canceled'].includes(d.t.status)
  const tabsFor = () => {
    const open = d.t.status === 'registration'
    const tabs = []
    if (open) tabs.push(['me', d.myReg ? 'Trénink' : 'Přidat se', d.myReg ? 'ticket' : 'pen'])
    if (d.myReg || !open) tabs.push(['history', 'Historie', 'bars'])
    tabs.push(['combos', 'Comba', 'scale'])
    tabs.push(['players', `Hráči (${d.b.players.length})`, 'users'])
    if (d.b.is_lead && !isArchive()) tabs.push(['manage', 'Řízení', 'gear'])
    return tabs
  }

  const draw = () => {
    const { t, b } = d
    const tabs = tabsFor()
    if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0]
    const arch = isArchive()
    const back = b.community ? `#/c/${b.community.id}` : '#/'
    mount(main, html`
      <header class="t-head ${arch ? 'tr-archive' : ''}">
        <div class="row between wrap">
          <a class="btn sm ghost tr-back" href="${back}">← ${b.community ? b.community.name : 'Zpět'}</a>
          ${arch ? html`<span class="tr-stamp">Archiv</span>`
            : html`<span class="row" style="gap:8px">${statusPill(t)}
            <a class="btn sm ghost btn-ico" href="#/t/${t.id}/tv">${raw(icon('tv'))}TV</a>
            <a class="btn sm ghost btn-ico" href="${bbxstUrl()}">${raw(icon('bars'))}BBXST</a></span>`}</div>
        <h1 style="margin-top:10px">${t.name}</h1>
        <div class="meta">
          ${b.community ? html`<a class="tr-comm" href="#/c/${b.community.id}">👥 ${b.community.name}</a>` : ''}
          ${t.starts_at ? html`<span>🗓 ${fmtDate(t.starts_at)}, ${fmtTime(t.starts_at)}</span>` : ''}
          ${t.location ? html`<span>📍 ${t.location}</span>` : ''}
          ${t.status === 'finished' && t.finished_at ? html`<span>🏁 skončil ${fmtDate(t.finished_at)}</span>` : ''}
          <span>Komunitní trénink · bez ratingu</span>
        </div>
        ${t.description ? html`<p class="desc">${t.description}</p>` : ''}
        ${arch ? html`<p class="tr-archive-note">${t.status === 'canceled' ? 'Trénink byl zrušen.' : 'Trénink skončil.'}
          Tohle je jeho historie – jen ke čtení, nic se tu už nemění.</p>` : ''}
      </header>
      <nav class="tabs t-nav" role="tablist" aria-label="Trénink">${tabs.map(([k, l, ico]) => html`<a href="#/t/${t.id}/${k}" class="${k === tab ? 'on' : ''}" role="tab" aria-selected="${k === tab}"><span class="ico" aria-hidden="true">${raw(icon(ico))}</span><span class="lb">${l}</span></a>`)}</nav>
      <section id="tab"></section>`)
    const box = main.querySelector('#tab')
    ;({ me: tabMe, players: tabPlayers, history: tabHistory, combos: tabCombos, manage: tabManage }[tab] || tabMe)(box)
  }

  let alive = true, busyReload = false, again = false
  async function reload() {
    if (!alive) return
    if (busyReload) { again = true; return }
    busyReload = true
    try { const nd = await load(id); if (alive) { d = nd; if (!document.querySelector('form[data-keep]')) draw() } } catch (e) { console.error(e) }
    busyReload = false
    if (again) { again = false; reload() }
  }

  // ── TRÉNINK (moje účast, deck, výzvy) ───────────────────────────
  function tabMe(box) {
    const { t, b, myReg } = d
    const open = t.status === 'registration'
    if (!myReg) {
      let body
      if (!open) body = html`<div class="notice">Trénink už skončil.</div>`
      else if (!isLoggedIn()) body = html`<div class="notice">Na komunitní trénink se přidávají hráči s účtem. <a href="#/login">Přihlas se</a>.</div>`
      else if (!b.is_member && !b.invited) body = html`<div class="notice">Trénink je pro členy komunity <a href="#/c/${b.community?.id}">${b.community?.name}</a>. Požádej o členství, nebo tě může pozvat leader.</div>`
      else body = html`<div class="card stack">
        ${b.invited && !b.is_member ? html`<div class="notice ok-n">Leader tě pozval na tenhle trénink. 🎉</div>` : ''}
        ${b.other_training ? html`<div class="notice warn">Jsi přihlášený na trénink <a href="#/t/${b.other_training.id}">${b.other_training.name}</a>. Najednou můžeš být jen na jednom – nejdřív se z něj odhlas.</div>` : ''}
        <p>Po přidání si postavíš deck a můžeš vyzývat ostatní na souboje. Skóre zapisujete v BBXST v training módu.</p>
        <div class="row wrap"><button class="btn primary" data-act="join" ${b.other_training ? 'disabled' : ''}>Přidat se na trénink</button>
          ${b.invited ? html`<button class="btn ghost" data-act="decline">Odmítnout pozvánku</button>` : ''}</div></div>`
      mount(box, body)
      on(box, 'click', '[data-act=join]', (e, btn) => busy(btn, async () => {
        try {
          await q(sb.from('registrations').insert({ tournament_id: t.id, nick: state.profile?.nick || 'hráč' }))
          await refreshMe(); askNotify(); toast('Jsi na tréninku. Postav si deck!', 'ok'); await reload()
        } catch (err) { toast(errMsg(err), 'err') }
      }))
      on(box, 'click', '[data-act=decline]', (e, btn) => busy(btn, async () => {
        try { await rpc('training_invite_decline', { p_tournament: t.id }); toast('Pozvánka odmítnuta.', 'ok'); location.hash = '#/' } catch (err) { toast(errMsg(err), 'err') }
      }))
      return
    }

    const beys = [myReg.bey1, myReg.bey2, myReg.bey3].filter(Boolean)
    const ms = b.matches
    const incoming = ms.filter(m => m.status === 'pending' && m.incoming)
    const outgoing = ms.filter(m => m.status === 'pending' && !m.incoming)
    const active = ms.filter(m => m.status === 'active')
    mount(box, html`
      ${incoming.map(m => html`<div class="card tr-call">
        <div><b>${m.opponent}</b> tě vyzývá na souboj</div>
        <div class="row"><button class="btn primary" data-accept="${m.id}">Přijmout</button><button class="btn ghost" data-decline="${m.id}">Odmítnout</button></div></div>`)}
      ${active.map(m => html`<div class="card tr-active">
        <div class="grow"><div class="lbl">Souboj · ${MODE[m.mode] || '3v3'}</div><b>proti ${m.opponent}</b>
          <div class="small faint">${plural(m.battles, 'souboj zapsaný', 'souboje zapsané', 'soubojů zapsaných')}</div></div>
        <div class="row"><a class="btn primary" href="${bbxstUrl(m.id)}">Otevřít v BBXST</a><button class="btn sm ghost" data-end="${m.id}">Ukončit</button></div></div>`)}
      ${outgoing.map(m => html`<div class="card tr-wait"><span>Výzva pro <b>${m.opponent}</b> čeká na potvrzení…</span>
        <button class="btn sm ghost" data-end="${m.id}">Zrušit</button></div>`)}

      <div class="card stack" id="deck-box">
        <div class="row between"><h3>Můj deck</h3>${open ? html`<button class="btn sm" data-act="deck">${beys.length ? 'Upravit deck' : 'Postavit deck'}</button>` : ''}</div>
        ${beys.length ? html`<div class="pass-beys">${beys.map(x => html`<span>${x}</span>`)}</div>`
          : html`<p class="muted">Zatím nemáš deck. Postav si 1 až 3 beye – díly se můžou opakovat.</p>`}
        <p class="hint">V BBXST jde sestava během souboje kdykoliv změnit (pro tebe i soupeře).</p>
      </div>

      <h2>Vyzvat hráče</h2>
      ${playersList(true)}

      ${open ? html`<button class="btn ghost sm" data-act="leave" style="margin-top:18px">Odhlásit se z tréninku</button>` : ''}`)
    bindPlayers(box)
    on(box, 'click', '[data-act=deck]', () => deckForm(box.querySelector('#deck-box')))
    on(box, 'click', '[data-accept]', (e, btn) => busy(btn, async () => {
      try { await rpc('training_respond', { p_match: btn.dataset.accept, p_accept: true }); location.href = bbxstUrl(btn.dataset.accept) } catch (err) { toast(errMsg(err), 'err') }
    }))
    on(box, 'click', '[data-decline]', (e, btn) => busy(btn, async () => {
      try { await rpc('training_respond', { p_match: btn.dataset.decline, p_accept: false }); await reload() } catch (err) { toast(errMsg(err), 'err') }
    }))
    on(box, 'click', '[data-end]', async (e, btn) => {
      if (!await confirmBox('Ukončit tenhle souboj? Zapsané souboje zůstanou v historii.', { ok: 'Ukončit' })) return
      busy(btn, async () => { try { await rpc('training_end', { p_match: btn.dataset.end }); await reload() } catch (err) { toast(errMsg(err), 'err') } })
    })
    on(box, 'click', '[data-act=leave]', async () => {
      if (!await confirmBox('Odhlásit se z tréninku? Historie soubojů zůstane.', { ok: 'Odhlásit', danger: true })) return
      try { await q(sb.from('registrations').delete().eq('id', myReg.id)); await refreshMe(); toast('Odhlášeno.', 'ok'); await reload() }
      catch (err) { toast(errMsg(err), 'err') }
    })
  }

  // seznam hráčů s tlačítkem Vyzvat
  function playersList(challenge) {
    const { b, myReg, t } = d
    const busyWith = new Set(b.matches.filter(m => ['pending', 'active'].includes(m.status)).map(m => m.opp_reg))
    const others = b.players.filter(p => p.reg !== myReg?.id)
    if (!others.length) return html`<div class="empty">Zatím tu nikdo další není.</div>`
    return html`<div class="list">${others.map(p => html`<div class="li ${p.bot ? 'tr-bot' : ''}">
      <span class="av">${p.bot ? '🤖' : p.avatar || '👤'}</span>
      <div class="grow" style="min-width:0">${p.bot ? html`<b class="ellipsis">${p.nick}</b>` : html`<a class="ellipsis" href="#/p/${p.user_id}" style="font-weight:600">${p.nick}</a>`}
        <div class="small faint">${p.bot ? 'bot · výzvu přijme hned, sestavu mu nastavíš v BBXST' : html`${p.guest ? 'host komunity · ' : ''}${p.has_deck ? 'má deck' : 'bez decku'}`}</div></div>
      ${challenge && myReg && t.status === 'registration' ? (busyWith.has(p.reg)
        ? (p.bot ? html`<a class="btn sm" href="${bbxstUrl(b.matches.find(m => m.opp_reg === p.reg && ['pending', 'active'].includes(m.status))?.id)}">Pokračovat</a>`
                 : html`<span class="pill">rozehráno</span>`)
        : html`<button class="btn sm primary" data-challenge="${p.reg}" data-bot="${p.bot ? '1' : ''}">${p.bot ? 'Hrát' : 'Vyzvat'}</button>`) : ''}
    </div>`)}</div>`
  }
  function bindPlayers(box) {
    on(box, 'click', '[data-challenge]', (e, btn) => busy(btn, async () => {
      try {
        const mid = await rpc('training_challenge', { p_tournament: d.t.id, p_opponent: btn.dataset.challenge })
        if (btn.dataset.bot) { location.href = bbxstUrl(mid); return }        // bot přijímá hned
        toast('Výzva odeslána – čeká na potvrzení.', 'ok'); await reload()
      }
      catch (err) { toast(errMsg(err), 'err') }
    }))
  }
  function tabPlayers(box) { mount(box, playersList(true)); bindPlayers(box) }

  async function deckForm(slot) {
    let cat
    try { cat = await loadParts() } catch (e) { return toast(errMsg(e), 'err') }
    let deck = d.myReg.deck || [], n = Math.max(1, deck.length || 3)
    const paint = () => {
      mount(slot, html`<form class="stack" id="f-deck" data-keep>
        <div class="row between"><h3>Můj deck</h3>
          <div class="seg seg-sm" role="radiogroup" aria-label="Počet beyů">${[1, 2, 3].map(k => html`<button type="button" data-n="${k}" class="${k === n ? 'on' : ''}">${k}</button>`)}</div></div>
        ${deckEditor(deck, n)}
        <p class="hint">Na tréninku se díly můžou opakovat.</p>
        <div class="row"><button type="button" class="btn grow" data-act="cancel">Zpět</button><button class="btn primary grow">Uložit deck</button></div>
      </form>`)
      getDeck = bindDeckEditor(slot.querySelector('[data-deck]'), cat, { distinct: false })
    }
    let getDeck
    paint()
    on(slot, 'click', '[data-n]', (e, btn) => {
      try { deck = getDeck() } catch { /* nedoplněné – necháme, co je */ }
      n = Number(btn.dataset.n); paint()
    })
    on(slot, 'click', '[data-act=cancel]', () => { draw() })
    on(slot, 'submit', '#f-deck', async (e, f) => {
      e.preventDefault()
      let nd
      try { nd = getDeck() } catch (err) { return toast(err.message, 'err') }
      await busy(f.querySelector('button.primary'), async () => {
        try { await q(sb.from('registrations').update({ deck: nd }).eq('id', d.myReg.id)); toast('Deck uložen.', 'ok'); d = await load(id); draw() }
        catch (err) { toast(errMsg(err), 'err') }
      })
    })
  }

  // ── HISTORIE ────────────────────────────────────────────────────
  async function tabHistory(box) {
    const scope = d.myReg ? histScope : 'all'
    mount(box, html`
      ${d.myReg ? html`<div class="seg" role="tablist">
        <button type="button" data-hs="me" class="${scope === 'me' ? 'on' : ''}">Moje souboje</button>
        <button type="button" data-hs="all" class="${scope === 'all' ? 'on' : ''}">Celý trénink</button></div>` : ''}
      <div id="hl" style="margin-top:12px"><div class="spinner" aria-label="Načítám"></div></div>`)
    on(box, 'click', '[data-hs]', (e, btn) => { histScope = btn.dataset.hs; tabHistory(box) })
    const out = box.querySelector('#hl')
    let h
    try { h = await rpc('training_history', { p_tournament: id, p_scope: scope }) } catch (e) { return mount(out, html`<div class="notice err">${errMsg(e)}</div>`) }
    const T = h.totals
    if (!T || !T.battles) return mount(out, html`<div class="empty">${scope === 'me' && d.t.status === 'registration'
      ? 'Zatím žádné zapsané souboje. Vyzvi někoho a zapisujte v BBXST.' : 'V tréninku nejsou žádné zapsané souboje.'}</div>`)
    const battles = (m) => html`<div class="tr-battles">${m.battles.map((x, i) => html`
          ${i === 0 || m.battles[i - 1].game !== x.game ? html`<div class="tr-game">Hra ${x.game}${x.mode ? ` · ${x.mode}` : ''}</div>` : ''}
          <div class="tr-b ${scope === 'all' ? (x.result > 0 ? 'a' : x.result < 0 ? 'b' : 'd') : (x.result > 0 ? 'w' : x.result < 0 ? 'l' : 'd')}">
            <span class="tr-res">${x.result === 0 ? '=' : scope === 'all' ? `+${x.pts}` : x.result > 0 ? `+${x.pts}` : `−${x.pts}`}</span>
            <span class="grow ellipsis">${x.bey || '?'} <span class="faint">vs</span> ${x.opp_bey || '?'}</span>
            ${x.finish ? html`<span class="fin-chip ${x.finish}">${x.finish}</span>` : ''}
          </div>`)}</div>`
    if (scope === 'all') return mount(out, html`
      <div class="stats">
        <div class="stat"><div class="v">${T.battles}</div><div class="k">soubojů</div></div>
        <div class="stat"><div class="v">${T.matches}</div><div class="k">dvojic</div></div>
        <div class="stat"><div class="v">${T.players}</div><div class="k">hráčů</div></div>
        <div class="stat"><div class="v">${T.draws}</div><div class="k">remíz</div></div>
      </div>
      <div class="fin-line" style="margin-top:10px">${finishLine(T.given)}</div>
      <h2>Všechny dvojice</h2>
      <div class="stack">${h.matches.map(m => html`<details class="card tr-hist">
        <summary><div class="row between" style="gap:8px"><b class="ellipsis"><span class="p1c">${m.p1}</span> <span class="faint">vs</span> <span class="p2c">${m.p2}</span></b>
          <span class="num"><span class="p1c">${m.s1}</span> : <span class="p2c">${m.s2}</span></span></div>
          <div class="small faint">${plural(m.battles.length, 'souboj', 'souboje', 'soubojů')} · ${m.w1}–${m.w2} · ${fmtDate(m.last)}, ${fmtTime(m.last)}</div></summary>
        ${battles(m)}
      </details>`)}</div>`)
    mount(out, html`
      <div class="stats">
        <div class="stat"><div class="v">${T.battles}</div><div class="k">soubojů</div></div>
        <div class="stat"><div class="v">${T.wins}–${T.losses}</div><div class="k">V–P${T.draws ? ` (${T.draws} R)` : ''}</div></div>
        <div class="stat"><div class="v ok-t">+${T.points}</div><div class="k">získáno</div></div>
        <div class="stat"><div class="v bad-t">−${T.points_lost}</div><div class="k">ztraceno</div></div>
      </div>
      ${finishTiles(T.given, T.taken)}
      <h2>Souboje podle soupeřů</h2>
      <div class="stack">${h.matches.map(m => html`<details class="card tr-hist">
        <summary><div class="row between" style="gap:8px"><b>proti ${m.opponent}</b>
          <span class="num"><span class="ok-t">+${m.points}</span> / <span class="bad-t">−${m.points_lost}</span></span></div>
          <div class="small faint">${m.wins} V · ${m.losses} P · ${fmtDate(m.last)}, ${fmtTime(m.last)}</div></summary>
        ${battles(m)}
      </details>`)}</div>`)
  }

  // ── COMBA ───────────────────────────────────────────────────────
  async function tabCombos(box) {
    mount(box, html`
      ${d.myReg ? html`<div class="seg" id="cs" role="tablist">
        <button type="button" data-s="me" class="${combosScope === 'me' ? 'on' : ''}">Moje comba</button>
        <button type="button" data-s="all" class="${combosScope === 'all' ? 'on' : ''}">Celý trénink</button></div>` : ''}
      <div id="cl" style="margin-top:12px"><div class="spinner" aria-label="Načítám"></div></div>`)
    const scope = d.myReg ? combosScope : 'all'
    on(box, 'click', '[data-s]', (e, btn) => { combosScope = btn.dataset.s; tabCombos(box) })
    let rows
    try { rows = await rpc('training_combos', { p_tournament: id, p_scope: scope }) } catch (e) { return mount(box.querySelector('#cl'), html`<div class="notice err">${errMsg(e)}</div>`) }
    mount(box.querySelector('#cl'), rows.length ? html`<div class="list meta-list">${rows.map((r, i) => html`
      <div class="li meta-row">
        <span class="faint num" style="width:22px;text-align:right">${i + 1}.</span>
        <div class="grow" style="min-width:0">
          <div class="meta-name">${r.bey}</div>
          ${scope === 'all' ? html`<div class="small tr-owner">hraje ${r.user_id ? html`<a href="#/p/${r.user_id}">${r.nick}</a>` : html`<b>🤖 ${r.nick}</b>`}</div>` : ''}
          <div class="meta-bar" role="img" aria-label="${r.wins} výher, ${r.draws} remíz, ${r.losses} proher">
            <i class="w" style="width:${(100 * r.wins / r.battles).toFixed(1)}%"></i><i class="d" style="width:${(100 * r.draws / r.battles).toFixed(1)}%"></i></div>
          <div class="small muted">${r.battles} soubojů · ${r.wins}–${r.draws ? `${r.draws}–` : ''}${r.losses} · +${r.points} / −${r.points_lost}</div>
          <div class="fin-line" style="margin-top:4px">${finishLine(r.given)}</div>
        </div>
        <div class="meta-wr num"><b>${Math.round(r.win_rate)}</b><small>%</small></div>
      </div>`)}</div>` : html`<div class="empty">Zatím žádné souboje s vybranými beyi.</div>`)
  }

  // ── ŘÍZENÍ (leader / zástupce) ──────────────────────────────────
  async function tabManage(box) {
    const { t, b } = d
    const open = t.status === 'registration'
    mount(box, html`<div class="stack">
      ${open ? html`<div class="card stack">
        <h3>Pozvat hráče mimo komunitu</h3>
        <input class="input" type="search" id="inv-q" placeholder="Hledat nick" aria-label="Hledat hráče">
        <div id="inv-l"></div>
        ${b.invites?.length ? html`<p class="small muted">Pozvaní (zatím se nepřidali): ${b.invites.map(i => i.nick).join(', ')}</p>` : ''}
      </div>
      <div class="card stack">
        <h3>Boti</h3>
        <p class="small muted">Pro trénink bez soupeře. Bota může vyzvat kdokoliv z tréninku, výzvu přijme hned a sestavu mu hráč nastaví v BBXST.</p>
        <form class="row" id="f-bot"><input class="input grow" name="name" maxlength="20" placeholder="BOT" aria-label="Jméno bota">
          <button class="btn primary">🤖 Vytvořit bota</button></form>
        ${b.players.some(p => p.bot) ? html`<div class="list">${b.players.filter(p => p.bot).map(p => html`<div class="li"><span class="av">🤖</span>
          <div class="grow">${p.nick}</div><button class="btn sm danger" data-unbot="${p.reg}">Odebrat</button></div>`)}</div>` : ''}
      </div>` : ''}
      <div class="card stack"><h3>Trénink</h3>
        <div class="row wrap">
          <button class="btn" data-act="edit">Upravit</button>
          ${open ? html`<button class="btn primary" data-act="finish">Ukončit trénink</button>` : ''}
          ${open ? html`<button class="btn danger" data-act="cancel">Zrušit</button>` : ''}
        </div>
        <p class="hint">Po ukončení se už nedá zapisovat. Historie, comba i meta komunity zůstanou.</p>
      </div></div>`)
    let all = null
    on(box, 'input', '#inv-q', async (e, el) => {
      const qq = el.value.trim().toLowerCase()
      const out = box.querySelector('#inv-l')
      if (qq.length < 2) return mount(out, '')
      all ??= await rpc('players_list')
      const inT = new Set(d.b.players.map(p => p.user_id))
      const invited = new Set((d.b.invites || []).map(i => i.user_id))
      const hits = all.filter(p => p.nick.toLowerCase().includes(qq) && !inT.has(p.id)).slice(0, 8)
      mount(out, hits.length ? html`<div class="list">${hits.map(p => html`<div class="li"><span class="av">${p.avatar}</span>
        <div class="grow">${p.nick}</div>
        ${invited.has(p.id) ? html`<span class="pill">pozván</span>` : html`<button class="btn sm primary" data-inv="${p.id}">Pozvat</button>`}</div>`)}</div>`
        : html`<p class="small faint">Nikdo takový (nebo už je na tréninku).</p>`)
    })
    on(box, 'click', '[data-inv]', (e, btn) => busy(btn, async () => {
      try { await rpc('training_invite', { p_tournament: t.id, p_user: btn.dataset.inv }); toast('Pozvánka odeslána.', 'ok'); btn.replaceWith(Object.assign(document.createElement('span'), { className: 'pill', textContent: 'pozván' })); d = await load(id) }
      catch (err) { toast(errMsg(err), 'err') }
    }))
    on(box, 'submit', '#f-bot', async (e, f) => {
      e.preventDefault()
      busy(f.querySelector('button'), async () => {
        try { await rpc('training_bot_create', { p_tournament: t.id, p_name: f.name.value.trim() || null }); toast('Bot je na tréninku.', 'ok'); await reload() }
        catch (err) { toast(errMsg(err), 'err') }
      })
    })
    on(box, 'click', '[data-unbot]', async (e, btn) => {
      if (!await confirmBox('Odebrat bota? Jeho odehrané souboje zůstanou v historii.', { ok: 'Odebrat', danger: true })) return
      busy(btn, async () => { try { await rpc('training_bot_remove', { p_reg: btn.dataset.unbot }); await reload() } catch (err) { toast(errMsg(err), 'err') } })
    })
    on(box, 'click', '[data-act=edit]', () => editForm())
    on(box, 'click', '[data-act=finish]', async (e, btn) => {
      if (!await confirmBox('Ukončit trénink? Rozehrané souboje se uzavřou.', { ok: 'Ukončit' })) return
      busy(btn, async () => { try { await rpc('finish_tournament', { p_tournament: t.id, p_placements: [] }); toast('Trénink ukončen.', 'ok'); await reload() } catch (err) { toast(errMsg(err), 'err') } })
    })
    on(box, 'click', '[data-act=cancel]', async () => {
      if (!await confirmBox('Zrušit trénink?', { ok: 'Zrušit', danger: true })) return
      try { await rpc('cancel_tournament', { p_tournament: t.id }); toast('Zrušeno.', 'ok'); await reload() } catch (err) { toast(errMsg(err), 'err') }
    })
  }

  function editForm() {
    const { t } = d
    modal(html`<h2>Upravit trénink</h2>
      <form class="stack" id="f-ed">
        <label class="f"><span>Název</span><input class="input" name="name" minlength="3" maxlength="80" required value="${t.name}"></label>
        <div class="grid2">
          <label class="f"><span>Začátek</span><input class="input" type="datetime-local" name="starts_at" value="${toLocalInput(t.starts_at)}"></label>
          <label class="f"><span>Místo</span><input class="input" name="location" maxlength="120" value="${t.location || ''}"></label>
        </div>
        <label class="f"><span>Poznámka</span><textarea class="input" name="description" rows="2" maxlength="600">${t.description || ''}</textarea></label>
        <div class="row"><button type="button" class="btn grow" data-close>Zpět</button><button class="btn primary grow">Uložit</button></div>
      </form>`, {
      onMount: (m, close) => on(m, 'submit', '#f-ed', async (e, f) => {
        e.preventDefault()
        const v = formData(f)
        try {
          await q(sb.from('tournaments').update({ name: v.name.trim(), starts_at: fromLocalInput(v.starts_at), location: v.location.trim() || null,
                                                  description: v.description.trim() || null }).eq('id', t.id))
          close(); toast('Uloženo.', 'ok'); await reload()
        } catch (err) { toast(errMsg(err), 'err') }
      }),
    })
  }

  draw()
  const off = liveChannel(id, reload)
  const ch = sb.channel('tm-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'training_matches', filter: `tournament_id=eq.${id}` }, () => reload())
    .subscribe()
  document.body.classList.add('has-tnav')
  return () => { alive = false; off(); sb.removeChannel(ch); document.body.classList.remove('has-tnav') }
}

// ────────────────────────────────────────────────────────────────
//  TV: comba celého tréninku (jako záložka Comba → Celý trénink)
//  Obnova každých 8 s (TV nemusí být přihlášená – realtime by nedostala), víc comb = stránky po 12 s.
// ────────────────────────────────────────────────────────────────
const TV_PER_PAGE = 12
export async function renderTV(main, [id]) {
  document.body.classList.add('tv')
  const clock = () => new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
  let t = null, comm = null, rows = [], tot = null, page = 0, alive = true, err = null

  async function load() {
    try {
      const [tt, rr, hh] = await Promise.all([
        q(sb.from('tournaments').select('id,name,status').eq('id', id).maybeSingle()),
        rpc('training_combos', { p_tournament: id, p_scope: 'all' }),
        rpc('training_history', { p_tournament: id, p_scope: 'all' }),
      ])
      if (tt && !comm) comm = (await rpc('training_board', { p_tournament: id }))?.community?.name || ''
      t = tt; rows = rr || []; tot = hh?.totals || null; err = null
    } catch (e) { err = errMsg(e) }
  }

  const draw = () => {
    if (!alive) return
    if (!t) return mount(main, html`<div class="empty"><h2>Trénink nenalezen</h2><a class="btn" href="#/">Zpět</a></div>`)
    const pages = Math.max(1, Math.ceil(rows.length / TV_PER_PAGE))
    if (page >= pages) page = 0
    const slice = rows.slice(page * TV_PER_PAGE, (page + 1) * TV_PER_PAGE)
    const open = t.status === 'registration'
    mount(main, html`
      <div class="tv-head"><h1>${t.name}</h1><div class="r">Comba celého tréninku · ${clock()}</div></div>
      <div class="trtv-sub">
        ${comm ? html`<span>${comm}</span>` : ''}
        ${tot ? html`<span>${plural(tot.battles, 'souboj', 'souboje', 'soubojů')}</span><span>${plural(tot.players, 'hráč', 'hráči', 'hráčů')}</span>` : ''}
        <span class="${open ? 'trtv-live' : ''}">${open ? 'Trénink běží' : 'Archiv'}</span>
        ${pages > 1 ? html`<span class="trtv-page num">${page + 1} / ${pages}</span>` : ''}
        ${err ? html`<span class="bad-t">Bez spojení – zkouším znovu</span>` : ''}
      </div>
      ${rows.length ? html`<ol class="trtv-grid" start="${page * TV_PER_PAGE + 1}">${slice.map((r, i) => {
        const rank = page * TV_PER_PAGE + i + 1
        return html`<li class="trtv-row ${rank <= 3 ? 'top top' + rank : ''}">
          <span class="trtv-rank num">${rank}</span>
          <div class="trtv-main">
            <div class="trtv-bey">${r.bey}</div>
            <div class="trtv-owner">${r.user_id ? r.nick : `🤖 ${r.nick}`}</div>
            <div class="meta-bar"><i class="w" style="width:${(100 * r.wins / r.battles).toFixed(1)}%"></i><i class="d" style="width:${(100 * r.draws / r.battles).toFixed(1)}%"></i></div>
            <div class="trtv-stats num">${r.wins}–${r.draws ? `${r.draws}–` : ''}${r.losses} · ${r.battles} soub. · +${r.points} / −${r.points_lost}</div>
          </div>
          <div class="trtv-wr num"><b>${Math.round(r.win_rate)}</b><small>%</small></div>
        </li>` })}</ol>`
      : html`<div class="fx-tv-wait"><h2>Zatím žádné souboje</h2><p>Vyzvěte se v BBXST – comba se tu objeví po prvním zapsaném souboji.</p></div>`}
      <a class="btn sm tv-exit" href="#/t/${t.id}">Zavřít TV</a>`)
  }

  await load(); draw()
  const poll = setInterval(async () => { await load(); draw() }, 8000)
  const pager = setInterval(() => { if (rows.length > TV_PER_PAGE) { page++; draw() } }, 12000)
  const clockTimer = setInterval(() => { const r = main.querySelector('.tv-head .r'); if (r) r.textContent = r.textContent.replace(/\d{1,2}:\d{2}$/, clock()) }, 15000)
  return () => { alive = false; clearInterval(poll); clearInterval(pager); clearInterval(clockTimer); document.body.classList.remove('tv') }
}
