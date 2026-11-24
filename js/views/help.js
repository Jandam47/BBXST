// ════════════════════════════════════════════════════════════════
//  Nápověda „Jak na to“ (#/help, #/help?k=judge)
// ════════════════════════════════════════════════════════════════
import { html, mount, on } from '../ui.js'

const S = [
  ['start', 'První kroky', html`
    <p>Na turnaj se přihlásíš i bez účtu – jako <b>host</b>. Výsledky se ti ale ukládají do profilu jen s účtem. Účet si můžeš založit kdykoli později a registrace se ti do něj přenesou.</p>
    <ul>
      <li>Web najdeš na <b>bbxu.cz</b>. Aplikaci si přidej na plochu: <b>Profil → Aplikace na plochu</b>. BBXU (turnaje) a BBXST (počítadlo / judge) se instalují zvlášť – na plochu si dej obě.</li>
      <li>V profilu si nastav nick, avatara a kraj. Nick je vidět v pořadí i na TV.</li>
    </ul>`],
  ['reg', 'Registrace a vstupenka', html`
    <ul>
      <li>U turnaje dej <b>Přihlásit se</b> a slož tři beyblady z dílů. Každý bey musí být jiný; u některých turnajů se nesmí opakovat ani jednotlivé díly.</li>
      <li>Díly vybíráš ze seznamu – začni psát a klepni na návrh. <b>Ratchet</b> se vybírá na kolečku: uvnitř počet zubů, venku výška. <b>Turbo / Operate</b> (ratchet je v bitu) jsou pod kolečkem.</li>
      <li><b>Bit</b> se vybírá taky na kolečku: okolo svítí všechny bity zkratkou ve třech řadách podle abecedy (od středu ven), uprostřed je hledání. Piš zkratku (F, LF, GB…) – co neodpovídá, zhasne; Enter nebo klepnutí na název uprostřed vybere. Turbo / Operate jsou žlutě.</li>
      <li>Po přihlášení máš v záložce <b>Můj Status</b> vstupenku s QR kódem. Ulož si ji do telefonu – v hale bývá slabý signál.</li>
      <li><b>Kontrola registrace:</b> na místě ukaž QR kód organizátorovi. Zkontroluje, že máš beyblady z přihlášky, a na vstupence pak svítí <i>✓ Registrace zkontrolována</i>. Když potom beyblady změníš, musí tě zkontrolovat znovu.</li>
      <li>Beyblady můžeš měnit, dokud turnaj nezačne. Pak už ne.</li>
      <li><b>Vstupné:</b> když se na turnaji platí, uvidíš v záhlaví turnaje 💰 a částku. Zaplatíš na místě pokladníkovi nebo organizátorovi – ukážeš mu QR kód a na vstupence pak svítí <i>💰 Vstupné zaplaceno</i>.</li>
    </ul>`],
  ['play', 'Během turnaje', html`
    <ul>
      <li>V <b>Můj Status</b> uvidíš svou arénu, soupeře a kolikátý jsi na řadě. Když jsi na řadě, přijde upozornění.</li>
      <li>Organizátor může vyhlásit <b>pauzu</b> – odpočet je nahoře v turnaji i na TV.</li>
      <li><b>Můj deck</b> ukazuje, jak se ti daří s každým beyem, jakými endy vyhráváš a kdo tě porazil.</li>
      <li>V záložce <b>Swiss</b> má každý zápas pod skóre <b>historii bodů</b> v pořadí, jak padaly: <i>+1</i>, <i>+2 O</i> (over), <i>+2 B</i> (burst), <i>+3</i> (xtreme), <i>R</i> = remíza. Zůstane tam i po dohrání.</li>
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
  ['league', 'Ligy', html`
    <p>Ligové turnaje se po skončení sčítají do tabulky ligy (Hráči → Ligy). Výchozí bodování:</p>
    <div class="help-pts lg">
      <div><b class="num">1</b><span>účast</span></div>
      <div><b class="num">+1</b><span>top cut</span></div>
      <div><b class="num">+5</b><span>1. místo</span></div>
      <div><b class="num">+3</b><span>2. místo</span></div>
      <div><b class="num">+2</b><span>3. místo</span></div>
      <div><b class="num">+1</b><span>4. místo</span></div>
    </div>
    <ul>
      <li>Body se sčítají – vítěz turnaje s top cutem má 1 + 1 + 5 = 7 bodů.</li>
      <li>U každého hráče je i bilance: zápasy výhry–prohry a body <b>+</b> získané / <b>−</b> ztracené ve všech ligových zápasech. Volné losy se nepočítají.</li>
      <li>Při shodě bodů rozhoduje počet výher, pak rozdíl bodů.</li>
      <li>Ligu zakládá hlavní admin a jmenuje jejího správce. Ligové turnaje smí zakládat správce, organizátoři, které do ligy přidá, a admini.</li>
    </ul>`],
  ['judge', 'Pro judge (BBXST)', html`
    <ul>
      <li>Zápas načteš třemi způsoby: v BBXU <b>Judge menu</b> → Rozhodovat, v BBXST <b>menu → aréna</b> (zápas na řadě je velkým písmem, fronta pod ním), nebo <b>naskenuj QR</b> vstupenky obou hráčů.</li>
      <li>Skenovat jde jen hráče, který teď v běžícím turnaji hraje. Po prvním skenu uvidíš turnaj, arénu a jméno soupeře – <b>druhý sken musí být přesně ten soupeř</b>, jinak BBXST upozorní. Zápas se pak načte sám.</li>
      <li>Zápas je pak tvůj – jiný judge ho nepřevezme bez organizátora.</li>
      <li>Po každém bodu vyber, kterým beyem se hrálo. U +2 nejdřív zvol <b>OVER</b> nebo <b>BURST</b>.</li>
      <li><b>⇄</b> prohodí strany při 0:0, když hráči stojí obráceně. Po každé sadě tří soubojů svítí <b>OTOČ ARÉNU</b>.</li>
      <li>Skóre se po každém bodu posílá na TV, do Živě i hráčům. Když vypadne signál, hra se uloží v telefonu a odešle se sama – nic se nezapočítá dvakrát.</li>
      <li><b>PASS JUDGE</b> (zlaté tlačítko vlevo dole) předá rozehraný zápas jinému judgovi i se skóre. <b>ZRUŠIT</b> hru zahodí.</li>
    </ul>`],
  ['live', 'Živě a TV rozpis', html`
    <ul>
      <li><b>Živě</b> (tlačítko v záhlaví turnaje) je přenos pro diváky – funguje i bez přihlášení, klidně na TV doma. U každé arény: skóre, endy obou stran a decky hráčů. Beye zahrané v aktuální sadě jsou v řádcích – zelený obrys = vyhrál, červený = prohrál, šedý = remíza. Pod nimi je <b>pool</b>: beye, které v sadě ještě nehrály (pořadí se dopředu neví).</li>
      <li><b>★ Sledovat hráče</b>: vybraní hráči jsou nahoře – kde hrají, proti komu a jak dopadli. S účtem si zapneš <b>Upozornit na telefon</b>: přijde ti, když sledovaný jde na arénu a jak zápas skončil.</li>
      <li><b>Dění</b> ukazuje každý bod a výsledek, jak padají; zaškrtávacími okénky vybereš, ze kterých arén. Velké věci (Xtreme, výsledek sledovaného) vyskočí přes obrazovku.</li>
      <li><b>🎬 Režie</b> ukáže jednu arénu přes celou obrazovku. Arénu přepneš v liště nahoře, <b>AUTO</b> sama skáče tam, kde se něco děje.</li>
      <li>Dál je tam pavouk top cutu (<i>Skrýt odehrané</i>), poslední výsledky, pořadí a rozbalovací <b>Statistiky turnaje</b>.</li>
      <li><b>TV rozpis</b> je pro obrazovku v hale: na šířku je všechno na jedné stránce, na výšku arény pod sebou. Sám neroluje.</li>
    </ul>`],
  ['org', 'Pro organizátory', html`
    <ul>
      <li>Akci založíš na hlavní stránce tlačítkem <b>Založ akci</b> → kolečko: Casual (trénink, meeting), Fashion, Turnaje (Deathmatch, Klasika 3v3, ligový turnaj).</li>
      <li><b>Kontrola registrací</b> (záložka Hráči): načti QR kód nebo klepni na hráče, odškrtej tři beyblady a <i>Potvrdit registraci</i>. Kdo nepřišel → <i>Vyřadit</i>. Zelená = zkontrolováno, žlutá = čeká, červená = vyřazen.</li>
      <li>Turnaj jde spustit, až jsou všichni zkontrolovaní. Výjimečně <i>⚠ Spustit bez kontroly registrací</i>.</li>
      <li><b>Vstupné:</b> v editoru turnaje zaškrtni <i>Platí se vstupné</i>, napiš částku a vyber, kdo ho vybírá – pokladníka (funkci mu dá admin v profilu) nebo sebe jako organizátora. Při kontrole registrace pak zaškrtneš <i>Zaplatil vstupné</i>. Pokladník vidí v záložce Hráči jen vstupné: načte QR kód nebo klepne na hráče a zaškrtne platbu. Nahoře vidí, kolik hráčů zaplatilo a kolik je vybráno.</li>
      <li>Hráče bez telefonu přidáš v <b>Řízení</b> – rovnou je zkontrolovaný a QR kód najdeš v záložce Hráči.</li>
      <li>V Řízení je i <b>pauza</b> s odpočtem, <b>Obsadit volné arény</b> (přesune čekající zápasy) a uvolnění judge ze zápasu.</li>
    </ul>`],
  ['training', 'Komunitní trénink', html`
    <ul>
      <li>Trénink zakládá leader nebo zástupce komunity. Přidat se může člen nebo pozvaný hráč.</li>
      <li>V BBXST zelené tlačítko <b>TRAINING</b> → vyber soupeře → on výzvu potvrdí. Zapisovat můžete oba.</li>
      <li><b>SETUP</b>: mód 3v3 / 1v1, body na hru, tournament mode (bey se v sadě neopakuje) a sestavy. Podržením beye upravíš jeho díly – ratchet i bit se vybírají na kolečku jako v registraci.</li>
      <li>Tahací <b>RESET</b> začne novou hru, odehrané souboje zůstanou v historii. Trénovat jde i proti botovi.</li>
      <li>Trénink se nepočítá do ratingu. Comba a historie najdeš v tréninku i na stránce komunity.</li>
    </ul>`],
  ['chat', 'Komunikace: chat, ankety, dotazy', html`
    <ul>
      <li>Záložka <b>Komunikace</b> dole otevře kolečko: Chat, Ankety, Nápověda a Dotazy a připomínky. Žluté číslo na záložce i na výseči ukazuje, kde je něco nového: nepřečtené místnosti v chatu, ankety, ve kterých jsi ještě nehlasoval, a nová odpověď na tvůj dotaz. Co si přečteš, zhasne na všech zařízeních, kde jsi přihlášený.</li>
      <li><b>Info k turnaji</b> čte každý, píšou organizátoři. <b>Komunitní chat</b> vidí jen členové a pozvaní hosté. Ve <b>Zkušebním chatu</b> může psát každý s účtem.</li>
      <li><b>Ankety</b> zakládají organizátoři a admini: otázka, 2–10 možností, délka (od 15 minut po týden nebo vlastní konec), hlasování pro víc možností a anonymní režim. Hlasuje každý s účtem a do konce může hlas změnit. Výsledky uvidíš po hlasování, po skončení je vidí všichni. U anonymní ankety nikdo neuvidí, kdo jak hlasoval.</li>
      <li><b>Dotazy a připomínky</b> jsou soukromé – přečte je jen hlavní admin. Odpověď ti přijde zpátky do Komunikace (a na telefon, když máš zapnutá upozornění).</li>
      <li>Nevhodnou zprávu v chatu nahlas přes <b>⚑</b>. Admin ji posoudí.</li>
    </ul>`],
  ['notify', 'Upozornění na telefonu', html`
    <ul>
      <li>V profilu zapni <b>Upozornění na telefonu</b>. Přijde ti, když jsi na řadě v aréně, když turnaj začne, výzva na tréninku, nová anketa nebo odpověď na tvůj dotaz.</li>
      <li>Upozornění na sledované hráče si zapneš v <b>Živě</b> u sekce Sledovaní.</li>
      <li>Na iPhonu to funguje jen v aplikaci přidané na plochu.</li>
    </ul>`],
  ['account', 'Účet a soukromí', html`
    <ul>
      <li>Účet smažeš v profilu dole (potvrdíš nickem). Zmizí profil a zprávy; výsledky turnajů zůstanou bez tvého jména.</li>
      <li>Když něco nefunguje, aplikace chybu sama pošle adminům – nemusíš nic hlásit, ale klidně napiš přes <b>Dotazy a připomínky</b>.</li>
    </ul>`],
]

export function render(main) {
  const k = new URLSearchParams(location.hash.split('?')[1] || '').get('k')
  mount(main, html`
    <h1>Jak na to</h1>
    <p class="muted" style="margin-top:6px">Krátce o turnajích, bodování, judgování, živém přenosu a tréninku.</p>
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
