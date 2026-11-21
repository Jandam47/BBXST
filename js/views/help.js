// ════════════════════════════════════════════════════════════════
//  Nápověda „Jak na to“ (#/help, #/help?k=judge)
// ════════════════════════════════════════════════════════════════
import { html, mount, on } from '../ui.js'

const S = [
  ['start', 'První kroky', html`
    <p>Na turnaj se přihlásíš i bez účtu – jako <b>host</b>. Výsledky se ti ale ukládají do profilu jen s účtem. Účet si můžeš založit kdykoli později a registrace se ti do něj přenesou.</p>
    <ul>
      <li>Aplikaci si přidej na plochu (v prohlížeči <i>Přidat na plochu</i> / <i>Instalovat</i>) – pak běží jako appka a jde zapnout upozornění.</li>
      <li>V profilu si nastav nick, avatara a kraj. Nick je vidět v pořadí i na TV.</li>
    </ul>`],
  ['reg', 'Registrace a vstupenka', html`
    <ul>
      <li>U turnaje dej <b>Přihlásit se</b> a slož tři beyblady z dílů. Každý bey musí být jiný; u některých turnajů se nesmí opakovat ani jednotlivé díly.</li>
      <li>Po přihlášení máš v záložce <b>Můj Status</b> vstupenku s QR kódem. Ulož si ji do telefonu – v hale bývá slabý signál.</li>
      <li><b>Prezence:</b> na místě ukaž QR judgovi nebo organizátorovi. Na vstupence pak svítí <i>✓ Prezence</i>. Kdo ji před startem nemá, může být z turnaje odebrán.</li>
      <li>Beyblady můžeš měnit, dokud turnaj nezačne. Pak už ne.</li>
    </ul>`],
  ['play', 'Během turnaje', html`
    <ul>
      <li>V <b>Můj Status</b> uvidíš svou arénu, soupeře a kolikátý jsi na řadě. Když jsi na řadě, přijde upozornění.</li>
      <li>Organizátor může vyhlásit <b>pauzu</b> – odpočet je nahoře v turnaji i na TV.</li>
      <li><b>Můj deck</b> ukazuje, jak se ti daří s každým beyem, jakými endy vyhráváš a kdo tě porazil.</li>
    </ul>`],
  ['points', 'Body a endy', html`
    <div class="help-pts">
      <div><b class="num">3</b><span>Xtreme</span></div>
      <div><b class="num">2</b><span>Burst</span></div>
      <div><b class="num">2</b><span>Over</span></div>
      <div><b class="num">1</b><span>Spin</span></div>
    </div>
    <ul>
      <li>Hraje se do <b>7 bodů</b> (organizátor může nastavit jinak). Remíza nedává body nikomu.</li>
      <li>Souboje se hrají v sadách po třech – v každé sadě nastoupí každý tvůj bey jednou, pak se aréna otočí.</li>
      <li>V top cutu se finále a zápasy o 3. a 4. místo hrají na dvě vítězné hry (BO3).</li>
    </ul>`],
  ['standings', 'Pořadí a párování', html`
    <ol class="help-order">
      <li><b>HB</b> – počet výher</li>
      <li><b>PB</b> – součet tvých bodů (vítěz zápasu má 7)</li>
      <li><b>PB2</b> – součet výher soupeřů, které jsi porazil</li>
      <li>vzájemný zápas</li>
      <li>los</li>
    </ol>
    <ul>
      <li><b>Klasika 3v3 (swiss):</b> 1. kolo je náhodné, dál hrají vítězové s vítězi. Stejná dvojice se nepotká dvakrát.</li>
      <li><b>Deathmatch:</b> každý s každým jednou.</li>
      <li><b>Volný los</b> dostane nejhůř umístěný hráč, který ho ještě neměl – počítá se jako výhra 7:0.</li>
      <li><b>Top cut</b> je double elimination: po první prohře hraješ dál v pavouku poražených.</li>
    </ul>`],
  ['judge', 'Pro judge (BBXST)', html`
    <ul>
      <li>V turnaji otevři <b>Judge</b> a vyber zápas, nebo v BBXST načti QR vstupenky hráčů. Zápas je pak tvůj – jiný judge ho nepřevezme bez organizátora.</li>
      <li>Po každém bodu vyber, kterým beyem se hrálo. U +2 nejdřív zvol <b>OVER</b> nebo <b>BURST</b>.</li>
      <li><b>⇄</b> prohodí strany při 0:0, když hráči stojí obráceně. Po každé sadě tří soubojů svítí <b>OTOČ ARÉNU</b>.</li>
      <li>Skóre se po každém bodu posílá na TV i hráčům. Když vypadne signál, hra se uloží v telefonu a odešle se sama – nic se nezapočítá dvakrát.</li>
      <li><b>PASS JUDGE</b> (zlaté tlačítko vlevo dole) předá rozehraný zápas jinému judgovi i se skóre. <b>ZRUŠIT</b> hru zahodí.</li>
    </ul>`],
  ['training', 'Komunitní trénink', html`
    <ul>
      <li>Trénink zakládá leader nebo zástupce komunity. Přidat se může člen nebo pozvaný hráč.</li>
      <li>V BBXST zelené tlačítko <b>TRAINING</b> → vyber soupeře → on výzvu potvrdí. Zapisovat můžete oba.</li>
      <li><b>SETUP</b>: mód 3v3 / 1v1, body na hru, tournament mode (bey se v sadě neopakuje) a sestavy. Podržením beye upravíš jeho díly.</li>
      <li>Tahací <b>RESET</b> začne novou hru, odehrané souboje zůstanou v historii. Trénovat jde i proti botovi.</li>
      <li>Trénink se nepočítá do ratingu. Comba a historie najdeš v tréninku i na stránce komunity.</li>
    </ul>`],
  ['chat', 'Chat a bazar', html`
    <ul>
      <li><b>Info k turnaji</b> čte každý, píšou organizátoři. <b>Komunitní chat</b> vidí jen členové a pozvaní hosté. Ve <b>Zkušebním chatu</b> může psát každý s účtem.</li>
      <li><b>Bazar</b>: inzerát s až třemi fotkami. Zájemce píše prodejci do soukromého vlákna – ostatní ho nevidí.</li>
      <li>Nevhodnou zprávu nebo inzerát nahlas přes <b>⚑</b>. Admin ho posoudí.</li>
    </ul>`],
  ['notify', 'Upozornění na telefonu', html`
    <ul>
      <li>V profilu zapni <b>Upozornění na telefonu</b>. Přijde ti, když jsi na řadě v aréně, když turnaj začne, výzva na tréninku nebo zpráva v bazaru.</li>
      <li>Na iPhonu to funguje jen v aplikaci přidané na plochu.</li>
    </ul>`],
  ['account', 'Účet a soukromí', html`
    <ul>
      <li>Účet smažeš v profilu dole (potvrdíš nickem). Zmizí profil, zprávy a inzeráty; výsledky turnajů zůstanou bez tvého jména.</li>
      <li>Když něco nefunguje, aplikace chybu sama pošle adminům – nemusíš nic hlásit, ale klidně napiš do Zkušebního chatu.</li>
    </ul>`],
]

export function render(main) {
  const k = new URLSearchParams(location.hash.split('?')[1] || '').get('k')
  mount(main, html`
    <h1>Jak na to</h1>
    <p class="muted" style="margin-top:6px">Krátce o turnajích, bodování, judgování a tréninku.</p>
    <nav class="help-nav" aria-label="Obsah nápovědy">${S.map(([id, t]) => html`<a href="#/help?k=${id}" data-k="${id}">${t}</a>`)}</nav>
    <div class="stack help">${S.map(([id, t, body]) => html`
      <details class="card help-sec" id="h-${id}" ${id === k ? 'open' : ''}>
        <summary><h2>${t}</h2></summary>
        <div class="help-body">${body}</div>
      </details>`)}</div>`)
  on(main, 'click', '[data-k]', (e, a) => {
    e.preventDefault()
    const sec = main.querySelector('#h-' + a.dataset.k)
    sec.open = true
    history.replaceState(null, '', '#/help?k=' + a.dataset.k)
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  if (k) setTimeout(() => main.querySelector('#h-' + k)?.scrollIntoView({ block: 'start' }), 50)
}
