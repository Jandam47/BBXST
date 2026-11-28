// ════════════════════════════════════════════════════════════════
//  Nápověda „Jak na to“ (#/help, #/help?k=judge)
// ════════════════════════════════════════════════════════════════
import { html, mount, on } from '../ui.js'

const S = [
  ['start', 'První kroky', html`
    <p>Na turnaj se přihlásíš i bez účtu – jako <b>host</b>. Výsledky se ti ale ukládají do profilu jen s účtem. Účet si můžeš založit kdykoli později – e-mailem nebo přes <b>Discord</b> – a registrace se ti do něj přenesou.</p>
    <ul>
      <li>Web najdeš na <b>bbxu.cz</b>. Aplikaci si přidej na plochu: <b>Profil → ozubené kolečko ⚙ → Aplikace → Instalace</b> (host bez účtu má kartu přímo v profilu). BBXU (turnaje) a BBXST (počítadlo / judge) se instalují zvlášť – na plochu si dej obě.</li>
      <li>V profilu si nastav nick, avatara a kraj. Nick je vidět v pořadí i na TV. Nick se sprostým nebo urážlivým slovem nejde uložit.</li>
    </ul>`],
  ['reg', 'Registrace a vstupenka', html`
    <ul>
      <li>U turnaje dej <b>Přihlásit se</b> a slož tři beyblady z dílů. Každý bey musí být jiný; u některých turnajů se nesmí opakovat ani jednotlivé díly.</li>
      <li>Díly vybíráš ze seznamu – začni psát a klepni na návrh. <b>Ratchet</b> se vybírá na kolečku: uvnitř počet zubů, venku výška. <b>Turbo / Operate</b> (ratchet je v bitu) jsou pod kolečkem.</li>
      <li><b>Bit</b> se vybírá taky na kolečku: okolo svítí všechny bity zkratkou ve třech řadách podle abecedy (od středu ven), uprostřed je hledání. Piš zkratku (F, LF, GB…) – co neodpovídá, zhasne; Enter nebo klepnutí na název uprostřed vybere. Turbo / Operate jsou žlutě.</li>
      <li>Po přihlášení máš v záložce <b>Můj Status</b> vstupenku s QR kódem. Ulož si ji do telefonu – v hale bývá slabý signál.</li>
      <li><b>Oblíbené buildy a decky:</b> v profilu klepni na hvězdičku ★ vedle ozubeného kolečka (Choose wheel). Ulož si buildy, které hraješ, a slož z nich decky. Při registraci pak nad beyi klepni na <b>★ Podle decku</b> nebo <b>★ Z oblíbených</b> – beye se vyplní a ještě je můžeš upravit.</li>
      <li>Vstupenku máš i v profilu: <b>⚙ → Vstupenka</b> (když jsi v turnaji). Telefon si ji pamatuje, takže se ukáže i bez signálu.</li>
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
      <li>Záložka <b>Hráči</b> dole otevře kolečko: <b>Standings</b> (všichni hráči podle ratingu), Komunity, Ligy, <b>Stats ladder</b> a – když jsi v komunitě – <b>Trénink</b> (standings jen z komunitních tréninků).</li>
    </ul>
    <h3>Stats</h3>
    <p>Z každého turnaje si odneseš stats. Na <b>Stats ladderu</b> vidíš, kdo kterému statu vládne – top 3 nebo top 10, podle sezóny (od 1. ledna) nebo celkem, podle kraje a ligy. V komunitě je i <b>komunitní ladder</b> z tréninků. V profilu uvidíš svoje stats a medaile za 1.–3. místo. Po skončení turnaje najdeš v záložce <b>Vyhodnocení</b> i <b>Stats turnaje</b> – kdo v které kategorii vyhrál právě ten turnaj.</p>
    <ul>
      <li><b>Breakdancer / Game over / Glueless / Xtreme hunter</b> – Spin / Over / Burst / Xtreme finish dané soupeřům.</li>
      <li><b>Tableflip</b> – vyhraná hra, ve které jsi prohrával o 5 a víc bodů. <b>No time to lose</b> – výhra 7:0.</li>
      <li><b>Blitzkrieg</b> a <b>T.Y.T.</b> – nejrychlejší a nejdelší hry (měří BBXST).</li>
      <li><b>Série</b> – nejdelší řada vyhraných zápasů. <b>King of draws</b> – nejvíc remíz. <b>Iron law</b> – nejvíc odjudgovaných zápasů.</li>
      <li><b>Rickety</b> – kolikrát se tvůj bey rozpadl. <b>No rod???</b> – turnaje bez Wizard Rod v decku.</li>
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
      <li>Každá liga patří ke kraji. Ligový turnaj dostane kraj ligy sám.</li>
    </ul>`],
  ['judge', 'Pro judge (BBXST)', html`
    <ul>
      <li>Zápas načteš třemi způsoby: v BBXU <b>Judge menu</b> → Rozhodovat, v BBXST <b>menu → aréna</b> (zápas na řadě je velkým písmem, fronta pod ním), nebo <b>naskenuj QR</b> vstupenky obou hráčů.</li>
      <li>Skenovat jde jen hráče, který teď v běžícím turnaji hraje. Po prvním skenu uvidíš turnaj, arénu a jméno soupeře – <b>druhý sken musí být přesně ten soupeř</b>, jinak BBXST upozorní. Zápas se pak načte sám.</li>
      <li>Zápas je pak tvůj – jiný judge ho nepřevezme bez organizátora.</li>
      <li>Po každém bodu vyber, kterým beyem se hrálo. Místo jedné +2 jsou dvě tahací tlačítka – <b>+2 BURST</b> a <b>+2 OVER</b> (stejně v tréninku), takže end už se zvlášť nevybírá.</li>
      <li><b>⇄</b> prohodí strany při 0:0, když hráči stojí obráceně. Po každé sadě tří soubojů svítí <b>OTOČ ARÉNU</b>.</li>
      <li>Skóre se po každém bodu posílá na TV, do Živě i hráčům. Když vypadne signál, hra se uloží v telefonu a odešle se sama – nic se nezapočítá dvakrát.</li>
      <li><b>PASS JUDGE</b> (zlaté tlačítko vlevo dole) předá rozehraný zápas jinému judgovi i se skóre. <b>ZRUŠIT</b> hru zahodí.</li>
    </ul>`],
  ['live', 'Živě a TV rozpis', html`
    <ul>
      <li><b>Živě</b> (tlačítko v záhlaví turnaje) je přenos pro diváky – funguje i bez přihlášení, klidně na TV doma. U každé arény: skóre, endy obou stran a decky hráčů. Beye zahrané v aktuální sadě jsou v řádcích – zelený obrys = vyhrál, červený = prohrál, šedý = remíza. Pod nimi je <b>pool</b>: beye, které v sadě ještě nehrály (pořadí se dopředu neví).</li>
      <li><b>★ Sledovat hráče</b>: vybraní hráči jsou nahoře – kde hrají, proti komu a jak dopadli. S účtem si zapneš <b>Upozornit na telefon</b>: přijde ti, když sledovaný jde na arénu a jak zápas skončil.</li>
      <li><b>Dění</b> ukazuje každý bod a výsledek, jak padají; zaškrtávacími okénky vybereš, ze kterých arén. Velké věci (Xtreme, výsledek sledovaného) vyskočí přes obrazovku.</li>
      <li><b>Video z arény</b>: když arénu někdo vysílá, je v její kartě přehrávač Twitche (nebo YouTube). Pouští se ztlumený – zvuk a celou obrazovku zapneš přímo v přehrávači, <i>Otevřít ↗</i> ho pustí v aplikaci Twitch. Na mobilních datech si video vypneš tlačítkem <b>📹 Video</b> v záhlaví. Video má zpoždění pár sekund, skóre v Živě je napřed.</li>
      <li><b>🎥 Vysílat</b> (judge, organizátor a kdo má funkci kameraman): v telefonu spusť vysílání v aplikaci <b>Twitch</b> (Go Live, účet zdarma), pak v Živě klepni na 🎥 Vysílat, napiš svůj kanál (nebo odkaz na živé vysílání na YouTube) a vyber arénu. BBXU si kanál pamatuje. Když stejnou arénu přiřadí někdo jiný, převezme ji. Konec: 🎥 Vysíláš arénu → Ukončit (a ukonči i vysílání v aplikaci). Organizátor může vysílání v Živě ukončit křížkem ✕ pod videem. Twitch vysílání sám nahrává, záznam najdeš na kanálu.</li>
      <li><b>🎬 Režie</b> ukáže jednu arénu přes celou obrazovku. Arénu přepneš v liště nahoře, <b>AUTO</b> sama skáče tam, kde se něco děje.</li>
      <li>Dál je tam pavouk top cutu (<i>Skrýt odehrané</i>), poslední výsledky, pořadí a rozbalovací <b>Statistiky turnaje</b>.</li>
      <li><b>TV rozpis</b> je pro obrazovku v hale: na šířku je všechno na jedné stránce, na výšku arény pod sebou. Sám neroluje.</li>
      <li><b>Vlastní TV (okénka)</b>: v TV rozpisu vpravo dole <b>⚙ Okna</b> – zapni, co chceš vidět: pro každou arénu <i>Arénu</i>, <i>Frontu</i>, <i>Dění</i>, <i>Decky</i> a <i>Video</i> (Twitch), pro celý turnaj <i>Pořadí</i>, <i>Pavouk</i>, <i>Poslední výsledky</i>, <i>Hodiny a pauzu</i> a <i>QR na Živě</i>. Okénka se rozmístí sama, přes <b>✎ Upravit</b> je přesuneš (lišta nahoře), zvětšíš (roh vpravo dole) nebo zavřeš ✕. Obsah se vždy přizpůsobí velikosti okna. Rozložení si pamatuje jen to zařízení, <i>Výchozí TV</i> vrátí původní rozpis.</li>
    </ul>`],
  ['org', 'Pro organizátory', html`
    <ul>
      <li>Akci založíš na hlavní stránce tlačítkem <b>Založ akci</b> → kolečko: Casual (trénink, meeting), Fashion, Turnaje (Deathmatch, Klasika 3v3, ligový turnaj).</li>
      <li>U turnaje vyplň <b>kraj</b> (u ostatních akcí je nepovinný). Hráči si pak na hlavní stránce vyfiltrují akce ze svého kraje.</li>
      <li><b>Kontrola registrací</b> (záložka Hráči): načti QR kód nebo klepni na hráče, odškrtej tři beyblady a <i>Potvrdit registraci</i>. Kdo nepřišel → <i>Vyřadit</i>. Zelená = zkontrolováno, žlutá = čeká, červená = vyřazen.</li>
      <li>Turnaj jde spustit, až jsou všichni zkontrolovaní. Výjimečně <i>⚠ Spustit bez kontroly registrací</i>.</li>
      <li><b>Vstupné:</b> v editoru turnaje zaškrtni <i>Platí se vstupné</i>, napiš částku a vyber, kdo ho vybírá – pokladníka (funkci mu dá admin v profilu) nebo sebe jako organizátora. Při kontrole registrace pak zaškrtneš <i>Zaplatil vstupné</i>. Pokladník vidí v záložce Hráči jen vstupné: načte QR kód nebo klepne na hráče a zaškrtne platbu. Nahoře vidí, kolik hráčů zaplatilo a kolik je vybráno.</li>
      <li>Hráče bez telefonu přidáš v <b>Řízení</b> – rovnou je zkontrolovaný a QR kód najdeš v záložce Hráči.</li>
      <li>V Řízení je i <b>pauza</b> s odpočtem, <b>Obsadit volné arény</b> (přesune čekající zápasy) a uvolnění judge ze zápasu.</li>
    </ul>`],
  ['training', 'Komunitní trénink', html`
    <ul>
      <li>Trénink zakládá leader nebo zástupce komunity. Přidat se může člen nebo pozvaný hráč.</li>
      <li>Deck na trénink má 1–3 beye, díly se můžou opakovat a <b>ratchet je nepovinný</b> – na kolečku ratchetu je <i>Bez ratchetu</i> (i v BBXST SETUPu). Na turnaji ratchet vybrat musíš.</li>
      <li>V BBXST zelené tlačítko <b>TRAINING</b> → vyber soupeře → on výzvu potvrdí. Zapisovat můžete oba.</li>
      <li>Když tě někdo vyzve, v BBXU i v BBXST vyskočí okno <b>Přijmout / Odmítnout</b>. Přijmout tě rovnou pošle do BBXST se zápasem. V notifikaci na telefonu jsou tlačítka Přijmout / Odmítnout taky (Odmítnout funguje bez otevření aplikace); klepnutí na notifikaci otevře trénink s tím oknem.</li>
      <li><b>Judge na tréninku</b>: v kolečku hráčů klepni na <b>JUDGE</b> – uvidíš, kdo s kým právě hraje a jaké je skóre. Vyber dvojici a zapisuješ souboje za ně (body, beye, setup). Odejdeš v SETUPu tlačítkem <b>ODEJÍT (JUDGE)</b>; hráči vidí, kdo je judguje.</li>
      <li><b>SETUP</b>: mód 3v3 / 1v1, body na hru, tournament mode (bey se v sadě neopakuje – u nové výzvy je zapnutý, vypneš ho tady) a sestavy. Podržením beye upravíš jeho díly – ratchet i bit se vybírají na kolečku jako v registraci. Změněná sestava se uloží do decku hráče na tomhle tréninku, takže ji má i v dalších výzvách. Při výběru beye jsou nahoře i tvoje <b>★ oblíbené buildy</b> z profilu.</li>
      <li>Tahací <b>RESET</b> začne novou hru, odehrané souboje zůstanou v historii. Trénovat jde i proti botovi.</li>
      <li><b>Battle Pass</b> (BX-09, jen Chrome na Androidu): v BBXST vpravo nad menu fialové tlačítko <b>BATTLEPASS</b> – táhni ho doleva nebo nahoru → Připojit. Po každém odpalu se nad +3 ukáže jeho síla (RPM). Dalším zatažením otevřeš <b>Statistiku</b> (dnešní odpaly a paměť Battle Passu – poslední, nejsilnější, nejslabší, průměr) nebo Battle Pass odpojíš. Nesmí být zároveň připojený k jiné aplikaci.</li>
      <li>Trénink se nepočítá do ratingu. Comba a historie najdeš v tréninku i na stránce komunity.</li>
      <li>Skončený nebo zrušený trénink může leader nebo zástupce <b>smazat</b> (tlačítko v archivu tréninku). Smažou se i všechny jeho souboje – zmizí z historie, comb, mety komunity, Standings i stats. Nejde to vrátit.</li>
      <li><b>Standings z tréninků</b> (Hráči → Trénink, nebo odkaz na stránce komunity) vidí jen členové komunity: pořadí jen ze soubojů na jejích trénincích – výhry, úspěšnost nebo body, za celé období, 90 nebo 30 dní.</li>
    </ul>`],
  ['chat', 'Komunikace: chat, ankety, dotazy', html`
    <ul>
      <li>Záložka <b>Komunikace</b> dole otevře kolečko: Chat, Ankety, Nápověda a Dotazy a připomínky. Žluté číslo na záložce i na výseči ukazuje, kde je něco nového: nepřečtené místnosti v chatu, ankety, ve kterých jsi ještě nehlasoval, a nová odpověď na tvůj dotaz. Co si přečteš, zhasne na všech zařízeních, kde jsi přihlášený.</li>
      <li><b>Info k turnaji</b> čte každý, píšou organizátoři. <b>Komunitní chat</b> vidí jen členové a pozvaní hosté. Ve <b>Zkušebním chatu</b> může psát každý s účtem.</li>
      <li><b>Ankety</b> zakládají organizátoři a admini: otázka, 2–10 možností, délka (od 15 minut po týden nebo vlastní konec), hlasování pro víc možností a anonymní režim. Hlasuje každý s účtem a do konce může hlas změnit. Výsledky uvidíš po hlasování, po skončení je vidí všichni. U anonymní ankety nikdo neuvidí, kdo jak hlasoval.</li>
      <li><b>Dotazy a připomínky</b> jsou soukromé – přečte je jen hlavní admin. Odpověď ti přijde zpátky do Komunikace (a na telefon, když máš zapnutá upozornění).</li>
      <li>Sprostá slova se v chatu automaticky nahradí hvězdičkami. Nevhodnou zprávu nahlas přes <b>⚑</b>. Admin ji posoudí.</li>
    </ul>`],
  ['notify', 'Upozornění na telefonu', html`
    <ul>
      <li>Zapneš je v profilu přes <b>ozubené kolečko ⚙ → Aplikace → Upozornění</b>. Přijde ti, když jsi na řadě v aréně, když turnaj začne, výzva na tréninku, nová anketa nebo odpověď na tvůj dotaz.</li>
      <li>Upozornění na sledované hráče si zapneš v <b>Živě</b> u sekce Sledovaní.</li>
      <li>Na iPhonu to funguje jen v aplikaci přidané na plochu.</li>
    </ul>`],
  ['account', 'Účet a soukromí', html`
    <ul>
      <li>Úpravu profilu, změnu hesla a odhlášení najdeš v profilu pod <b>ozubeným kolečkem ⚙ → Profil</b>.</li>
      <li><b>⚙ → Aplikace → Vzhled</b>: vybereš barvy aplikace: <i>Neon</i> (původní), <i>Synthwave</i>, <i>Toxic</i>, <i>Ronin</i> nebo černobílý <i>Bez neonů</i>. Platí pro tohle zařízení (host ho najde přímo v profilu).</li>
      <li><b>⚙ → Profil → Sdílet</b>: QR kód a odkaz na tvůj profil – kamarád ho naskenuje a hned tě najde.</li>
      <li><b>⚙ → Profil → Soukromí</b>: můžeš skrýt statistiky beyů a endy, soupeře a vzájemnou bilanci, nebo se schovat ze Standings. Výsledky turnajů zůstávají veřejné.</li>
      <li>Admini mají v kolečku <b>Správu</b>: žádosti o komunity, nahlášený obsah, chyby z telefonů, zálohu a lidi s funkcí. Žlutý odznak ukáže, že něco čeká.</li>
      <li>Účet smažeš přes <b>⚙ → Profil → Smazání účtu → Smazat natrvalo</b> a potvrdíš nickem – omylem to nejde. Zmizí profil a zprávy; výsledky turnajů zůstanou bez tvého jména.</li>
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
