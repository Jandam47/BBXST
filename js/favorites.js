// ════════════════════════════════════════════════════════════════
//  Oblíbené buildy a decky (35): data, editory v modalu a lišta v editoru decku
//  (registrace, trénink, fashion: „Vyplnit podle decku“ / „Přidat z oblíbených“).
//  Tabulky fav_builds / fav_decks – jen vlastní řádky (RLS), název buildu skládá DB.
// ════════════════════════════════════════════════════════════════
import { sb, state, q, errMsg } from './supa.js'
import { html, mount, on, modal, toast, busy, confirmBox, formData } from './ui.js'
import { loadParts, deckEditor, bindDeckEditor } from './parts.js'

export const hasAccount = () => !!state.user && !state.user.is_anonymous

// ── data (krátká cache, ať registrace nečeká) ──
let cache = null, cacheAt = 0
export async function loadFavs(force = false) {
  if (!hasAccount()) return { builds: [], decks: [] }
  if (!force && cache && Date.now() - cacheAt < 60000 && cache.uid === state.user.id) return cache
  const [builds, decks] = await Promise.all([
    q(sb.from('fav_builds').select('id,bey,name,note,created_at').order('created_at')),
    q(sb.from('fav_decks').select('id,name,builds,created_at').order('created_at')),
  ])
  cache = { uid: state.user.id, builds, decks }; cacheAt = Date.now()
  return cache
}
export const dropFavCache = () => { cache = null }
export const deckBuilds = (deck, builds) => deck.builds.map(id => builds.find(b => b.id === id)).filter(Boolean)

// díly buildu jedním řádkem (náhled pod názvem)
export function partsLine(b) {
  const x = b || {}
  const parts = x.type === 'cx' ? [x.lock, x.main, x.over, x.assist, x.ratchet, x.bit] : [x.blade, x.ratchet, x.bit]
  return parts.filter(Boolean).join(' · ')
}

// ── editor buildu (nový / úprava) ──
export async function buildModal(build = null, after) {
  let cat
  try { cat = await loadParts() } catch (e) { return toast(errMsg(e), 'err') }
  modal(html`
    <h2>${build ? 'Upravit build' : 'Nový oblíbený build'}</h2>
    <form class="stack" id="f-fav">
      ${deckEditor(build ? [build.bey] : null, 1)}
      <label class="f"><span>Poznámka (nepovinné)</span>
        <input class="input" name="note" maxlength="60" placeholder="např. na útočníky, do ligy…" value="${build?.note || ''}"></label>
      <div class="row"><button type="button" class="btn grow" data-close>Zpět</button>
        <button class="btn primary grow">${build ? 'Uložit' : 'Přidat do oblíbených'}</button></div>
    </form>`, {
    onMount: (box, close) => {
      box.querySelector('legend').textContent = 'Build'
      const getDeck = bindDeckEditor(box.querySelector('[data-deck]'), cat, { favorites: false })
      on(box, 'submit', '#f-fav', async (e, f) => {
        e.preventDefault()
        let bey
        try { [bey] = getDeck() } catch (err) { return toast(err.message, 'err') }
        const note = formData(f).note.trim() || null
        await busy(f.querySelector('button.primary'), async () => {
          try {
            if (build) await q(sb.from('fav_builds').update({ bey, note }).eq('id', build.id))
            else await q(sb.from('fav_builds').insert({ bey, note }))
            dropFavCache(); close(); toast(build ? 'Build uložený.' : 'Přidáno do oblíbených.', 'ok'); after?.()
          } catch (err) { toast(errMsg(err), 'err') }
        })
      })
    },
  })
}

export async function deleteBuild(b, after) {
  if (!await confirmBox(html`Smazat <b>${b.name}</b> z oblíbených? Zmizí i z decků.`, { ok: 'Smazat', danger: true })) return
  try { await q(sb.from('fav_builds').delete().eq('id', b.id)); dropFavCache(); toast('Smazáno.', 'ok'); after?.() }
  catch (e) { toast(errMsg(e), 'err') }
}

// ── editor decku: název + výběr buildů v pořadí klepnutí ──
export async function deckModal(deck = null, after, preselect = []) {
  const { builds } = await loadFavs(true)
  if (!builds.length) return toast('Nejdřív si ulož nějaký oblíbený build.')
  let picked = deck ? deck.builds.filter(id => builds.some(b => b.id === id)) : preselect.slice()
  modal(html`
    <h2>${deck ? 'Upravit deck' : 'Nový deck'}</h2>
    <form class="stack" id="f-fdeck">
      <label class="f"><span>Název decku</span>
        <input class="input" name="name" required maxlength="40" placeholder="např. Turnajový, Liga, Trénink" value="${deck?.name || ''}"></label>
      <div><div class="small muted">Klepni na buildy v pořadí, v jakém je chceš mít (na turnaj 3).</div>
        <div class="fav-pick" id="fd-list" role="group" aria-label="Buildy v decku"></div></div>
      <div class="row"><button type="button" class="btn grow" data-close>Zpět</button>
        <button class="btn primary grow">${deck ? 'Uložit' : 'Vytvořit deck'}</button></div>
    </form>`, {
    onMount: (box, close) => {
      const draw = () => mount(box.querySelector('#fd-list'), builds.map(b => {
        const n = picked.indexOf(b.id) + 1
        return html`<button type="button" class="fav-pick-it ${n ? 'on' : ''}" data-pick="${b.id}" aria-pressed="${!!n}">
          <span class="fav-num" aria-hidden="true">${n || ''}</span>
          <span class="grow"><b>${b.name}</b>${b.note ? html`<span class="small muted"> · ${b.note}</span>` : ''}</span></button>`
      }))
      draw()
      on(box, 'click', '[data-pick]', (e, el) => {
        const id = el.dataset.pick
        picked = picked.includes(id) ? picked.filter(x => x !== id) : picked.length >= 10 ? picked : [...picked, id]
        draw()
      })
      on(box, 'submit', '#f-fdeck', async (e, f) => {
        e.preventDefault()
        if (!picked.length) return toast('Vyber aspoň jeden build.', 'err')
        const row = { name: formData(f).name.trim(), builds: picked }
        await busy(f.querySelector('button.primary'), async () => {
          try {
            if (deck) await q(sb.from('fav_decks').update(row).eq('id', deck.id))
            else await q(sb.from('fav_decks').insert(row))
            dropFavCache(); close(); toast(deck ? 'Deck uložený.' : 'Deck vytvořený.', 'ok'); after?.()
          } catch (err) { toast(errMsg(err), 'err') }
        })
      })
    },
  })
}

export async function deleteDeck(d, after) {
  if (!await confirmBox(html`Smazat deck <b>${d.name}</b>? Buildy v oblíbených zůstanou.`, { ok: 'Smazat', danger: true })) return
  try { await q(sb.from('fav_decks').delete().eq('id', d.id)); dropFavCache(); toast('Smazáno.', 'ok'); after?.() }
  catch (e) { toast(errMsg(e), 'err') }
}

// ── výběr ze seznamu (modal) → Promise s vybranou položkou nebo null ──
function pickModal(title, items, row) {
  return new Promise(res => {
    let done = false
    modal(html`<h2>${title}</h2>
      <div class="list fav-choose">${items.map((it, i) => html`<button type="button" class="li" data-i="${i}">${row(it)}</button>`)}</div>
      <button class="btn block" data-close style="margin-top:14px">Zpět</button>`, {
      onMount: (box, close) => on(box, 'click', '[data-i]', (e, el) => { done = true; close(); res(items[+el.dataset.i]) }),
      onClose: () => { if (!done) res(null) },
    })
  })
}

// ── lišta nad editorem decku: vyplnit podle decku / přidat z oblíbených ──
export async function deckToolbar(root, api) {
  if (!hasAccount() || !root.isConnected) return
  let favs
  try { favs = await loadFavs() } catch { return }
  if (!root.isConnected || root.previousElementSibling?.classList.contains('fav-bar')) return
  const bar = document.createElement('div')
  bar.className = 'fav-bar'
  root.before(bar)
  const n = api.count
  if (!favs.builds.length) {
    mount(bar, html`<p class="hint">★ Tip: oblíbené buildy a decky si ulož v profilu pod hvězdičkou – tady je pak vyplníš jedním klepnutím.</p>`)
    return
  }
  mount(bar, html`
    ${favs.decks.length ? html`<button type="button" class="btn sm" data-fav="deck" title="Vyplnit podle decku">★ Podle decku</button>` : ''}
    <button type="button" class="btn sm ghost" data-fav="build" title="Přidat z oblíbených">★ Z oblíbených</button>`)
  const fill = (i, b) => api.setBey(i, b.bey)
  on(bar, 'click', '[data-fav=deck]', async () => {
    const d = await pickModal('Vyplnit podle decku', favs.decks, (x) => {
      const bs = deckBuilds(x, favs.builds)
      return html`<span class="grow"><b>${x.name}</b><br><span class="small muted">${bs.map(b => b.name).join(' · ')}</span></span>
        ${bs.length !== n ? html`<span class="pill">${bs.length} ${bs.length === 1 ? 'bey' : bs.length < 5 ? 'beye' : 'beyů'}</span>` : ''}`
    })
    if (!d) return
    const bs = deckBuilds(d, favs.builds).slice(0, n)
    bs.forEach((b, i) => fill(i, b))
    toast(bs.length < n ? `Vyplněno ${bs.length} z ${n} – zbytek doplň.` : `Vyplněno podle decku ${d.name}. Můžeš ho ještě upravit.`, 'ok')
  })
  on(bar, 'click', '[data-fav=build]', async () => {
    const b = await pickModal('Přidat z oblíbených', favs.builds, (x) => html`<span class="grow"><b>${x.name}</b>
      ${x.note ? html`<br><span class="small muted">${x.note}</span>` : ''}</span>`)
    if (!b) return
    let slot = n === 1 ? 0 : [...Array(n).keys()].find(i => !api.isComplete(i))
    if (slot === undefined) {
      const pick = await pickModal('Nahradit který beyblade?', [...Array(n).keys()], (i) => html`<span class="grow">Beyblade ${i + 1}
        <br><span class="small muted">${api.nameOf(i) || ''}</span></span>`)
      if (pick === null) return
      slot = pick
    }
    fill(slot, b)
    toast(`${b.name} → beyblade ${slot + 1}`, 'ok')
  })
}
