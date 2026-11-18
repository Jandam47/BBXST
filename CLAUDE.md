# BBXU – pokyny pro Claude

Turnajová platforma pro Beyblade X (komunita Pardubice). Autor a hlavní admin: Adam (Jandam47).
Komunikuj **česky**, celé UI je česky.

## Co je co
- `index.html` + `js/app.js` + `js/views/*.js` + `css/bbxu.css` – **BBXU**: turnaje, registrace s QR, řízení
  turnaje, judge arény, hráči, profily, chat, TV rozpis (`#/t/<id>/tv`). Vanilla JS, ES moduly, **žádný build**.
- `bbxst.html` – **BBXST** scoreboard (jeden soubor, klasické `<script>`, globální proměnné). Casual mód =
  počítadlo; judge mód = načtení zápasu (QR / aréna / `?match=<id>&t=<turnaj>` z BBXU), výběr beyů po každém
  bodu, remíza, prohození stran při 0:0 (⇄), hláška „OTOČ ARÉNU“ po každé sadě 3 soubojů, odeslání přes RPC
  `submit_game` s offline frontou (`client_id` zajišťuje, že se hra nezapočítá dvakrát).
  Design BBXST se nemění – Adam ho chce zachovat.
- `BBXST.html` (velká písmena) je **jen přesměrování** na `bbxst.html` kvůli starým odkazům. Neupravovat.
- `js/core.js` – čistá turnajová logika (párování, pořadí, pavouk, umístění) – testovatelná v Node.
- `js/supa.js` – Supabase klient, stav přihlášení, `rpc()`, `errMsg()` (překlad chyb do češtiny).
- `js/ui.js` – šablony `html\`\`` (vše escapuje, `raw()` jen pro důvěryhodné HTML), `modal`, `toast`, QR.
- `js/parts.js` – katalog dílů (`bey_parts`), našeptávač, editor decku.
- `js/config.js` – **obsahuje Adamovy živé klíče Supabase. Nikdy ho neměň ani nepřepisuj.**
- `supabase/schema.sql`, `supabase/02-parts.sql` – databáze (už spuštěné v produkci).
- `vendor/` – supabase-js, qrcode-generator, html5-qrcode (lokálně, kvůli slabé síti v hale).
- `sw.js` – service worker (síť první, cache jako záloha).

## Pravidla pro změny
- **Databáze:** nikdy neupravuj `schema.sql` / `02-parts.sql` jako způsob změny běžící DB. Každá změna = nový
  soubor `supabase/NN-popis.sql` (03, 04, …), idempotentní (`create or replace`, `if not exists`,
  `drop policy if exists`). Adam ho spouští ručně v Supabase SQL Editoru – vždy mu to napiš na konec odpovědi.
  Při změně návratového typu funkce nejdřív `drop function if exists`.
- **Bezpečnost DB:** všechny tabulky mají RLS. Změny stavu jdou přes `security definer` RPC, které nejdřív
  ověří roli (`bbx_require_manager`, `bbx_require_judge`, `bbx_my_level()`) a pak zapnou
  `bbx_set_privileged()`, aby prošly ochranné triggery. `bbx_privileged()` je true i pro SQL editor /
  service role. Nové interní funkce revokuj z `public, anon, authenticated`.
- **Registrace:** `qr_token`, `bey1–3` a `deck` nejsou veřejně čitelné (column grants). Na `registrations`
  nikdy nedělej `select('*')` z klienta – čti přes RPC (`my_registration`, `tournament_players`, `judge_*`).
- **Názvy beyů** skládá DB (`bbx_compose_bey`); `composeName()` v `js/parts.js` je jen náhled a musí dělat
  totéž. Měníš-li jedno, uprav i druhé.
- **Soubory pojmenovávej malými písmeny** (Adam nahrává z Windows, GitHub Pages rozlišuje velikost písmen).
- Po změně souborů aplikace zvyš `VERSION` v `sw.js` a nové soubory přidej do `SHELL`.
- Výstup do HTML vždy přes `html\`\`` / `esc()` / `textContent` – nicky a díly zadávají uživatelé.
- Mobil první: většina lidí používá telefon; BBXST běží na šířku.

## Pravidla turnaje (dohodnutá s Adamem)
- Role: hráč < judge < organizátor < admin < hlavní admin (vyšší zahrnuje nižší). Admin přiděluje
  judge/organizátora, hlavní admin i admina. Organizátor řídí jen své turnaje, admin všechny.
- Host bez účtu = anonymní přihlášení Supabase; účet si může založit později a registrace se převedou.
- Swiss: počet kol se zadává při založení. 1. kolo náhodně. Další kola vítězové s vítězi (skupiny podle HB);
  lichou skupinu doplní nejlepší hráč z nižší skupiny podle PB/PB2 (shoda = náhoda); odvety se vynechávají.
- Volný los (bye): nejhůř umístěný, kdo ho ještě neměl; počítá se jako výhra 7:0.
- Pořadí: HB (výhry) → PB (součet vlastních bodů; vítěz 7) → PB2 (součet HB soupeřů, které hráč porazil)
  → vzájemný zápas → deterministický los (hash).
- Hra do 7 bodů (`win_score`). Top cut: double elimination s loser bracketem, velikost 4/8/16/32/vlastní
  (byes do mocniny 2). BO3 výchozí: grand finále, finále losers (3. místo), semifinále losers (4. místo).
  Grand finále se neopakuje (bez bracket resetu).
- Deck: 3 různé beye složené z dílů v `bey_parts` (BX/UX blade, nebo CX lock chip + main/metal blade
  (+ over blade) + assist blade; ratchet; bit). Díly s integrovaným ratchetem ratchet nemají.

## Testy
Potřebují lokální PostgreSQL 16, Node a pro UI Python Playwright + Chrome a PostgREST (`/tmp/postgrest`).
- `node tests/core.test.mjs` – logika (párování 4–64 hráčů, pavouk 2–32 s byes, umístění).
- `tests/reset_db.sh && node tests/db.test.mjs` – celý turnaj proti DB se stubem Supabase (role, RLS, RPC).
- `tests/ui-up.sh && python3 tests/ui_smoke.py && python3 tests/bbxst_judge.py && python3 tests/test_tools.py` – proklik v Chrome
  (poslední: zkušební turnaj 16 hráčů přes testovací nástroje až po ukončení).
Když měníš SQL, přidej nový soubor i do `tests/reset_db.sh`. Po změně logiky nebo DB pusť testy.

## Testovací nástroje
V Řízení turnaje (jen admin): přidání N testovacích hráčů bez účtu (nick „T-…“, náhodný deck) a náhodné
dohrání otevřených zápasů. Jen přes existující RPC (`add_walkin`, `submit_game`), bez změn DB.

## Zatím chybí / nápady
- Push notifikace při zavřené aplikaci (Edge Function + Web Push) – teď jen když je BBXU otevřené.
- Přebrání arény jiným judgem (teď uvolní jen vlastník nebo organizátor).
- Volitelné pravidlo „žádný díl se v decku neopakuje“.
- Převod starých dat z Google Sheets.
