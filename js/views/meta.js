// ════════════════════════════════════════════════════════════════
//  Meta – žebříček buildů a dílů podle úspěšnosti v soubojích
//  (jen skončené turnaje, souboje zapsané judgem v BBXST)
// ════════════════════════════════════════════════════════════════
import { rpc, errMsg } from '../supa.js'
import { html, mount, on } from '../ui.js'

const KINDS = [['build', 'Buildy'], ['blade', 'Blady'], ['ratchet', 'Ratchety'], ['bit', 'Bity']]
const PERIODS = [['', 'Celá historie'], ['365', 'Poslední rok'], ['90', 'Poslední 3 měsíce'], ['30', 'Posledních 30 dní']]
const MINS = [3, 5, 10, 20, 50]

export async function render(main, _p, ctx) {
  let kind = 'build', period = '', min = 10, token = 0

  mount(main, html`
    <h1>Meta</h1>
    <p class="muted" style="margin-top:4px">Co v soubojích vyhrává. Počítají se skončené turnaje a souboje zapsané judgem v BBXST.</p>
    <div class="seg" id="mk" role="tablist" style="margin-top:16px">
      ${KINDS.map(([k, l]) => html`<button type="button" data-k="${k}" class="${k === kind ? 'on' : ''}" role="tab">${l}</button>`)}
    </div>
    <div class="row wrap" style="margin-top:10px">
      <select class="input" id="mp" aria-label="Období" style="flex:1 1 160px">${PERIODS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select>
      <select class="input" id="mm" aria-label="Minimum soubojů" style="flex:1 1 160px">
        ${MINS.map(v => html`<option value="${v}" ${v === min ? 'selected' : ''}>od ${v} soubojů</option>`)}</select>
    </div>
    <div id="ml" style="margin-top:14px"></div>`)

  const load = async () => {
    const my = ++token
    const box = main.querySelector('#ml')
    mount(box, html`<div class="spinner" aria-label="Načítám"></div>`)
    let rows
    try {
      rows = await rpc('meta_ranking', { p_kind: kind, p_min: min,
        p_since: period ? new Date(Date.now() - Number(period) * 864e5).toISOString() : null })
    } catch (e) { if (my === token) mount(box, html`<div class="notice err">${errMsg(e)}</div>`); return }
    if (my !== token || !ctx.isCurrent()) return
    if (!rows.length) {
      mount(box, html`<div class="empty"><p>Zatím tu nic není – do žebříčku se dostane, co odehrálo aspoň ${min} soubojů ve skončených turnajích.</p>
        ${min > MINS[0] ? html`<button class="btn" data-less>Zobrazit od ${MINS[0]} soubojů</button>` : ''}</div>`)
      return
    }
    mount(box, html`<div class="list meta-list">${rows.map((r, i) => {
      const w = (100 * r.wins) / r.battles, dr = (100 * r.draws) / r.battles
      return html`<div class="li meta-row">
        <span class="faint num meta-pos">${i + 1}</span>
        <div class="grow" style="min-width:0">
          <div class="meta-name">${r.name}</div>
          <div class="meta-bar" role="img" aria-label="${r.wins} výher, ${r.draws} remíz, ${r.losses} proher">
            <i class="w" style="width:${w.toFixed(1)}%"></i><i class="d" style="width:${dr.toFixed(1)}%"></i></div>
          <div class="small muted">${r.wins}–${r.draws ? `${r.draws}–` : ''}${r.losses} · ${r.battles} soubojů · ${r.ppb} b/souboj · ${r.players === 1 ? '1 hráč' : `${r.players} hráči`}${r.tournaments > 1 ? ` · ${r.tournaments} turnaje` : ''}</div>
        </div>
        <div class="meta-wr num"><b>${Math.round(r.win_rate)}</b><small>%</small></div>
      </div>`
    })}</div>
    <p class="hint">Úspěšnost = podíl vyhraných soubojů (remíza se počítá jako nevyhraný). Zelená = výhry, šedá = remízy, zbytek prohry.</p>`)
  }

  on(main, 'click', '#mk [data-k]', (e, b) => {
    kind = b.dataset.k
    main.querySelectorAll('#mk button').forEach(x => x.classList.toggle('on', x === b))
    load()
  })
  on(main, 'change', '#mp', (e, el) => { period = el.value; load() })
  on(main, 'change', '#mm', (e, el) => { min = Number(el.value); load() })
  on(main, 'click', '[data-less]', () => { min = MINS[0]; main.querySelector('#mm').value = String(min); load() })
  await load()
}
