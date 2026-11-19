# BBXU (BBX Unity) – Beyblade X turnaje

Jedno rozhraní na všechno: turnaje a akce, registrace s QR vstupenkou, swiss + top cut
s loser bracketem, judge mód v BBXST, profily se statistikami, seznam hráčů a chat.
Backend je **Supabase** (zdarma), web běží na **GitHub Pages**.

Nahrazuje: `BBX_admin.html`, `BBX_watch.html`, `BBX_watchTV.html`, `QRcreate.html`,
Apps Script a Google Sheets.

```
index.html            BBXU (aplikace)
bbxst.html            BBXST – scoreboard s judge módem
js/config.js          ← sem patří adresa a klíč Supabase
js/core.js            turnajová logika (párování, pořadí, pavouk)
js/views/*.js         obrazovky BBXU
supabase/schema.sql   databáze – spustit jednou v Supabase
supabase/02-parts.sql katalog dílů Beyblade X + kontrola registrací
js/parts.js           našeptávač dílů a editor decku
vendor/               knihovny (Supabase, QR) – běží i bez CDN
tests/                testy (na web nenahrávat)
```

---

## 1. Supabase (cca 10 minut)

1. Na [supabase.com](https://supabase.com) založ projekt (Free). Region **Central EU (Frankfurt)**.
2. **SQL Editor → New query** → vlož celý `supabase/schema.sql` → **Run**.
   Pak stejně spusť `supabase/02-parts.sql` (katalog dílů). Pokud už máš `schema.sql`
   spuštěné, pusť jen `02-parts.sql`. Nic se nesmaže.
3. **Authentication → Sign In / Providers**
   - Email: zapnutý.
   - **Allow anonymous sign-ins: zapnout** (registrace hostů bez účtu).
4. **Authentication → Rate Limits** → *Anonymous sign-ins per hour* zvedni třeba na **150**.
   Výchozích 30 za hodinu na jednu IP by na turnaji nestačilo – všichni jsou na stejné Wi-Fi.
5. **Authentication → URL Configuration**
   - Site URL: adresa webu, např. `https://jandam47.github.io/BBXU/`
   - Redirect URLs: přidej stejnou adresu (pro potvrzení e-mailu a obnovu hesla).
6. **Project Settings → API Keys** → zkopíruj *publishable key* (`sb_publishable_…`)
   nebo starší *anon* klíč. **Project Settings → Data API** → zkopíruj URL projektu.
   Obojí vlož do `js/config.js`. Klíč je veřejný; bezpečnost hlídají pravidla v databázi.
   Nikdy nevkládej *secret* ani *service_role* klíč.

### Přihlášení přes Discord (volitelné)
1. [discord.com/developers](https://discord.com/developers/applications) → New Application → OAuth2.
   Redirect: `https://<tvuj-projekt>.supabase.co/auth/v1/callback`
2. Supabase → Authentication → Sign In / Providers → Discord → vlož Client ID a Secret.
3. V `js/config.js` nastav `discordEnabled: true`.
   Nick se převezme z Discordu, pokud je volný; jinak si ho hráč při prvním přihlášení zvolí.

## 2. GitHub Pages
Nahraj obsah složky (kromě `tests/`) do repozitáře → **Settings → Pages** → branch `main`, složka `/ (root)`.
BBXU a BBXST musí běžet na **stejné adrese**, jinak judge v BBXST nebude přihlášený.

## 3. Staň se hlavním adminem
Založ si v BBXU účet (nick + e-mail + heslo), potvrď e-mail, pak v SQL Editoru spusť:
```sql
update public.profiles set role = 'superadmin' where lower(nick) = lower('TvujNick');
```
Od té chvíle přidělíš role v BBXU: **Hráči → profil → Funkce**.

| Funkce | Kdo přiděluje | Co může |
|---|---|---|
| Hráč | každý účet | registrace, profil, chat |
| Judge | admin | zabrat arénu, zapisovat zápasy v BBXST |
| Organizátor (+ judge) | admin | zakládat a řídit své turnaje a akce |
| Admin (+ organizátor, judge) | hlavní admin | řídit všechny turnaje, přidělovat judge/organizátora, mazat zprávy |
| Hlavní admin | jen SQL | všechno, přiděluje adminy |

---

## Katalog dílů
Hráči si beyblady skládají z dílů, které jsou v tabulce **bey_parts**. Při psaní se nabízejí
jen existující díly a databáze jiné nepustí. Název beye se složí sám: např. *Dran Sword 3-60F*,
*Dran Brave S6-60V*, *Knight Fortress GV8-70UN*.

Nový díl přidáš v **Table Editor → bey_parts → Insert row**:

| sloupec | co vyplnit |
|---|---|
| `category` | `blade` (celý BX/UX blade), `lock_chip`, `main_blade`, `metal_blade`, `over_blade`, `assist_blade`, `ratchet`, `bit` |
| `name` | oficiální název, např. `Dran Strike`, `4-50`, `Free Flat` |
| `abbr` | zkratka do názvu beye – u bitů (`F`, `GF`), assist bladů (`S`) a over bladů (`G`). Bez zkratky se píše celé jméno. |
| `aliases` | jiná jména, podle kterých se má díl najít, např. `{"Scythe Incendio"}` (Hasbro) |
| `integrated` | `true`, když má blade nebo bit pevně spojený ratchet (Hells Nether, Turbo…) – ratchet se pak nevyplňuje |
| `active` | `false` díl skryje z nabídky (stávající registrace zůstanou) |

Ostatní sloupce nech prázdné. U pár nových bitů (Narrow, Zap, Jolt…) jsem zkratku nenašel,
tak ji případně doplň. Telefony si seznam pamatují, nový díl uvidí po znovunačtení BBXU.

## Jak probíhá turnaj

**Hráč** otevře turnaj a zaregistruje se: nick + 3 beyblady poskládané z dílů. Bez účtu se ho aplikace nejdřív zeptá,
jestli si nechce založit účet. Dostane vstupenku s QR, registraci může měnit až do startu.
Host si účet může založit i později a turnaje se mu převedou.

**Organizátor** (záložka *Řízení*):
1. *Spustit turnaj* → hned nabídne losování 1. kola (náhodné). Před potvrzením jde přelosovat.
2. Hráčům naskočí upozornění „aréna X“ a vstupenka ukáže obří číslo arény a soupeře.
3. Po dohrání kola *Vylosovat další kolo*. Párování: vítězové s vítězi, lichého hráče doplní
   nejlepší z nižší skupiny (shoda = los), odvety se vynechávají. Při lichém počtu hráčů
   dostane nejhůř umístěný volný los (výhra 7:0, každý max. jednou).
4. Po posledním kole *Top cut*: velikost (4/8/16/32/vlastní) a BO3 jdou ještě změnit.
5. Po grand finále *Ukončit a uložit*: konečné pořadí se zapíše do profilů.

Výsledek jde zadat i ručně, aréna se dá přehodit a odehraný zápas vrátit
(*Opravit odehraný zápas*; v top cutu jen dokud navazující zápas nezačal).
Hráče bez telefonu přidáš v *Řízení*, jeho QR najdeš v *Hráči → ⋯*.
Velká obrazovka: tlačítko **TV rozpis** (živé arény, bez obnovování).

**Pořadí:** hlavní body (výhry) → pomocné body (součet vlastních bodů; vítěz 7, poražený
svůj počet) → druhé pomocné (součet hlavních bodů soupeřů, které jsi porazil) → vzájemný
zápas → los.

**Top cut:** double elimination. Poražený z finále losers je 3., ze semifinále losers 4.
Výchozí BO3: grand finále, finále losers, semifinále losers. Ostatní zápasy jsou BO1.

## Judge v BBXST
1. V BBXU se přihlas účtem s funkcí Judge a otevři běžící turnaj → záložka **Judge**.
   Vidíš všechny arény a na každé aktuální zápas.
2. Klepni na **Rozhodovat** u své arény. Aréna se ti zabere a BBXST se otevře rovnou
   v judge módu s načtenými hráči.
   Bez BBXU: v BBXST táhni **DRAG TO JUDGE** (nad resetem) a naskenuj QR obou hráčů (📷),
   nebo použij *VYBRAT ZÁPAS*. QR ze dvou různých turnajů BBXST odmítne.
3. Při stavu 0:0 je nahoře uprostřed tlačítko **⇄**, které prohodí hráče na stranách
   (podle toho, kdo kde u stolu stojí). Po prvním souboji zmizí.
4. Po každém tažení bodu vybereš, který bey skóroval a který prohrál. Poslední bey v sadě se
   doplní sám. Po dohrání sady tří beyů vyskočí **OTOČ ARÉNU**.
   *= REMÍZA* zapíše souboj bez bodů. *REVERT* vrací i zápis beyů.
5. Na 7 bodech *ODESLAT VÝSLEDEK*. U BO3 se plocha vynuluje na další hru.
   Po zápase BBXST nabídne další zápas na stejné aréně. **◂ BBXU** vrací do turnaje.
   Bez signálu se výsledek uloží v telefonu a odešle sám, jakmile je síť zpátky.

Casual mód (výchozí) je původní počítadlo bez odesílání.

---

## Bezpečnost
- Hesla spravuje Supabase Auth a ukládá je jen jako šifrovaný otisk. Nevidí je nikdo, ani admin.
- Každá tabulka má pravidla (RLS). Výsledky zapisuje jen judge nebo organizátor, role přiděluje
  jen admin, stav turnaje se mění jen přes ovládání turnaje.
- QR tokeny jsou tajné. Beyblady ostatních hráčů jsou skryté až do konce turnaje
  (vidí je majitel, judge a organizátor).

## Co zatím chybí
- **Upozornění při zavřené aplikaci.** Teď chodí, když je BBXU otevřené (i na pozadí).
  Plnohodnotné push notifikace by potřebovaly Supabase Edge Function + Web Push.
- **Reset grand finále** (když vyhraje hráč z loser bracketu, nehraje se druhé finále).
- **Převod starých dat** ze Sheets.
- **Free projekt Supabase se po týdnu bez provozu uspí.** Před turnajem ho stačí v dashboardu probudit.

## Testy
Potřebují lokální PostgreSQL a Node (`cd tests && npm i`):
- `node tests/core.test.mjs`: párování, pořadí, pavouk 2–32 hráčů s byes
- `tests/reset_db.sh && node tests/db.test.mjs`: celý turnaj proti databázi s rolemi a RLS
- `tests/ui-up.sh && python3 tests/ui_smoke.py && python3 tests/bbxst_judge.py`: proklikání v Chrome
