// ════════════════════════════════════════════════════════════════
//  #/oblibene – oblíbené buildy a decky (★ Choose wheel v profilu)
//  ?tab=decky otevře decky
// ════════════════════════════════════════════════════════════════
import { state } from '../supa.js'
import { html, mount, on, raw } from '../ui.js'
import { ICONS } from '../icons.js'
import { openCreateWheel } from '../create-wheel.js'
import { hasAccount, loadFavs, buildModal, deleteBuild, deckModal, deleteDeck, deckBuilds, partsLine } from '../favorites.js'

// ── ★ Choose wheel (z profilu) ──
export async function openChooseWheel() {
  let f = { builds: [], decks: [] }
  try { f = await loadFavs() } catch {}
  openCreateWheel({ label: 'Choose wheel', children: [
    { label: 'Oblíbené buildy', short: 'Buildy', icon: 'star', color: 'var(--bolt)', badge: f.builds.length || null, go: '#/oblibene' },
    { label: 'Decky', icon: 'board', color: 'var(--cyan)', badge: f.decks.length || null, go: '#/oblibene?tab=decky' },
    { label: 'Nový build', short: 'Nový', icon: 'pen', color: 'var(--magenta)', run: () => buildModal(null, () => { location.hash = '#/oblibene' }) },
  ] }, { title: 'Choose wheel', hint: 'Oblíbené buildy a decky', label: 'Choose wheel' })
}

export async function render(main) {
  if (!hasAccount()) {
    return mount(main, html`<div class="empty"><h2>Oblíbené buildy</h2>
      <p class="muted">Oblíbené buildy a decky si ukládá jen hráč s účtem.</p><a class="btn" href="#/login">Přihlásit se</a></div>`)
  }
  let tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') === 'decky' ? 'decky' : 'buildy'
  const draw = async (force) => {
    let f
    try { f = await loadFavs(force) } catch (e) { return mount(main, html`<div class="empty"><p class="muted">Nepodařilo se načíst oblíbené.</p></div>`) }
    if (!main.isConnected) return
    const { builds, decks } = f
    mount(main, html`
      <div class="row between" style="align-items:center">
        <h1 class="grow fav-h1">${raw(ICONS.star)}Choose wheel</h1>
        <a class="btn sm ghost" href="#/me">Profil</a>
      </div>
      <div class="seg" role="tablist" style="margin:10px 0 14px">
        <button type="button" role="tab" data-tab="buildy" class="${tab === 'buildy' ? 'on' : ''}" aria-selected="${tab === 'buildy'}">Oblíbené buildy (${builds.length})</button>
        <button type="button" role="tab" data-tab="decky" class="${tab === 'decky' ? 'on' : ''}" aria-selected="${tab === 'decky'}">Decky (${decks.length})</button>
      </div>
      ${tab === 'buildy' ? html`
        <div class="row wrap" style="gap:8px">
          <button class="btn primary grow" data-act="new-build">+ Nový build</button>
          ${builds.length ? html`<button class="btn grow" data-act="new-deck">Vytvořit deck</button>` : ''}
        </div>
        ${builds.length ? html`<div class="fav-list">${builds.map(b => html`
          <div class="card fav-card">
            <div class="grow">
              <div class="fav-name">${b.name}</div>
              <div class="small muted">${partsLine(b.bey)}</div>
              ${b.note ? html`<div class="small fav-note">${b.note}</div>` : ''}
            </div>
            <div class="fav-acts">
              <button class="btn sm" data-edit="${b.id}">Upravit</button>
              <button class="btn sm ghost" data-del="${b.id}" aria-label="Smazat ${b.name}">${raw(ICONS.trash)}</button>
            </div>
          </div>`)}</div>`
        : html`<div class="empty"><p class="muted">Zatím nemáš žádný oblíbený build. Přidej si ty, co hraješ nejčastěji –
            při registraci je pak vyplníš jedním klepnutím.</p></div>`}`
      : html`
        <button class="btn primary block" data-act="new-deck">+ Nový deck</button>
        ${decks.length ? html`<div class="fav-list">${decks.map(d => {
          const bs = deckBuilds(d, builds)
          return html`<div class="card fav-card deck">
            <div class="grow">
              <div class="fav-name">${d.name}</div>
              <ol class="fav-deck-list">${bs.map(b => html`<li>${b.name}</li>`)}</ol>
              ${bs.length !== 3 ? html`<div class="small faint">Na turnaj se vyplní ${bs.length < 3 ? `jen ${bs.length} ze 3` : 'první 3'}.</div>` : ''}
            </div>
            <div class="fav-acts">
              <button class="btn sm" data-dedit="${d.id}">Upravit</button>
              <button class="btn sm ghost" data-ddel="${d.id}" aria-label="Smazat deck ${d.name}">${raw(ICONS.trash)}</button>
            </div>
          </div>`
        })}</div>`
        : html`<div class="empty"><p class="muted">${builds.length ? 'Zatím nemáš žádný deck. Slož si ho z oblíbených buildů.'
            : 'Deck se skládá z oblíbených buildů – nejdřív si nějaké ulož.'}</p>
            ${builds.length ? '' : html`<button class="btn" data-tab="buildy">Oblíbené buildy</button>`}</div>`}`}
      <p class="hint" style="margin-top:16px">Při registraci do turnaje, na trénink nebo na fashion najdeš nad beyi
        „★ Podle decku“ a „★ Z oblíbených“. Vyplněné díly jdou pak ještě upravit.</p>`)
  }
  const reload = () => draw(true)
  on(main, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; window.history.replaceState(null, '', tab === 'decky' ? '#/oblibene?tab=decky' : '#/oblibene'); draw() })
  on(main, 'click', '[data-act=new-build]', () => buildModal(null, reload))
  on(main, 'click', '[data-act=new-deck]', () => deckModal(null, () => { tab = 'decky'; window.history.replaceState(null, '', '#/oblibene?tab=decky'); reload() }))
  const find = async (key, id) => (await loadFavs())[key].find(x => x.id === id)
  on(main, 'click', '[data-edit]', async (e, b) => buildModal(await find('builds', b.dataset.edit), reload))
  on(main, 'click', '[data-del]', async (e, b) => deleteBuild(await find('builds', b.dataset.del), reload))
  on(main, 'click', '[data-dedit]', async (e, b) => deckModal(await find('decks', b.dataset.dedit), reload))
  on(main, 'click', '[data-ddel]', async (e, b) => deleteDeck(await find('decks', b.dataset.ddel), reload))
  await draw(true)
}
