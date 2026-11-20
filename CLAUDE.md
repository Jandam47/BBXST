# BBXU (BBX Unity) – pokyny pro Claude

Turnajová platforma pro Beyblade X (komunita Pardubice). Autor a hlavní admin: Adam (Jandam47).
Komunikuj **česky**, celé UI je česky.

## Co je co
- `index.html` + `js/app.js` + `js/views/*.js` + `css/bbxu.css` – **BBXU**: turnaje, registrace s QR, řízení
  turnaje, judge arény, hráči, profily, chat, TV rozpis (`#/t/<id>/tv`). Vanilla JS, ES moduly, **žádný build**.
- `bbxst.html` – **BBXST** scoreboard (jeden soubor, klasické `<script>`, globální proměnné). Casual mód =
  počítadlo; judge mód = načtení zápasu (QR / aréna / `?match=<id>&t=<turnaj>` z BBXU), výběr beyů po každém
  bodu (po přetažení +2 judge nejdřív vybere OVER / BURST), remíza, prohození stran při 0:0 (⇄), hláška „OTOČ ARÉNU“ po každé sadě 3 soubojů, odeslání přes RPC
  `submit_game` s offline frontou (`client_id` zajišťuje, že se hra nezapočítá dvakrát).
  **Training mód** (komunitní trénink): zelené tahací tlačítko TRAINING nad judge (jen když je hráč na otevřeném
  tréninku, `my_training`) → kolečko hráčů → výzva (`training_challenge`, soupeř potvrdí) → oba telefony zapisují
  souboje (`training_battle` s `client_id`, čekající souboje se dopošlou), stav `training_state` (realtime na
  `training_matches` + polling 4 s). S načteným soupeřem je tlačítko SETUP: mód 3v3/3v1/1v3/1v1 (v DB z pohledu
  p1/p2), body na hru číslo nebo ∞ (změna = nová hra), tournament mode (`settings.tourney`: bey se v sadě
  neopakuje jako v judge módu, sada = počet beyů hráče), sestavy z decků obou hráčů nebo nový bey z dílů
  (podržení beye v setupu = úprava jeho dílů, předvyplněné; ratchet se vybírá na kolečku – vnitřní kruh zuby
  0–9 + M, vnější výška 50–85, jen existující kombinace z `bey_parts`; Turbo / Operate = bit s ratchetem).
  Tahací RESET = nová hra (`training_new_game`, 16): skóre i zahrané beye od nuly, souboje zůstanou v historii.
  ⇄ prohodí strany jen na tomhle telefonu (`localStorage.bbxst_training_left`).
  Odkaz z BBXU: `bbxst.html?training=<id>`; rozehraný trénink se obnoví z `localStorage.bbxst_training`.
  Design BBXST se nemění – Adam ho chce zachovat.
- `BBXST.html` (velká písmena) je **jen přesměrování** na `bbxst.html` kvůli starým odkazům. Neupravovat.
- `js/core.js` – čistá turnajová logika (párování, pořadí, pavouk, umístění) – testovatelná v Node.
- `js/supa.js` – Supabase klient, stav přihlášení, `rpc()`, `errMsg()` (překlad chyb do češtiny).
- `js/ui.js` – šablony `html\`\`` (vše escapuje, `raw()` jen pro důvěryhodné HTML), `modal`, `toast`, QR.
- `js/parts.js` – katalog dílů (`bey_parts`), našeptávač, editor decku. Hlavní názvy dílů = Takara Tomy
  (zdroj kyoganken.sakura.ne.jp/beyx/weight1.htm), Hasbro názvy jsou v `aliases`. Nové díly = nový SQL soubor
  s `insert … on conflict do update` (viz `07-parts-update.sql`); web se kvůli dílům nasazovat nemusí.
- `js/config.js` – **obsahuje Adamovy živé klíče Supabase. Nikdy ho neměň ani nepřepisuj.**
- `supabase/schema.sql`, `02-parts.sql`, `03-live-score.sql`, `04-security-hardening.sql`, `05-judge-handover.sql`, `06-formats-stats.sql`, `07-parts-update.sql`, `08-judge-per-match.sql`, `09-pause.sql`, `10-fashion.sql`, `11-finishes.sql`, `12-rated.sql`, `13-communities.sql`, `14-training-extras.sql`, `15-training-bots.sql`, `16-training-reset.sql` – databáze (spuštěné v produkci, nové soubory
  spouští Adam). Živé skóre: BBXST v judge módu posílá po každém bodu `live_score` → `matches.live_p1/p2`
  (TV rozpis, vstupenka, seznamy); trigger `bbx_clear_live` ho maže po uložení hry.
  Rozehraná hra: BBXST posílá s `live_score` i `p_state` → `matches.live_state` (souboje v orientaci p1/p2,
  `game` = p1_wins+p2_wins, `left`) a zároveň ji drží v localStorage (`bbxst_judge_live`). Po znovuotevření
  BBXST nebo u jiného judge hra pokračuje (novější z obou stavů).
  Judge zápasu = `matches.judge_id` (od 08 se arény nezabírají, `arena_judges` se nepoužívá): judge si každý
  zápas vybere v Judge menu / BBXST, `start_match` ho převezme; po dohrání je volný. Organizátor může judge
  uvolnit (`pass_match`) → „rozehráno, bez judge“. PASS JUDGE (zlaté tlačítko vlevo dole
  při načteném zápasu) volá `pass_match` (uvolní zápas i arénu, skóre zůstane), ZRUŠIT volá
  `pass_match(…, true)` (zahodí hru). Body ani výsledek nepošle judge, kterému zápas někdo převzal
  (`bbx_check_match_judge`, trigger na `games`); organizátor turnaje smí vždy.
- Fronta arény: `arenaQueue` v core.js a SQL `judge_arena_queue` (stejné pravidlo): rozehraný zápas první,
  pak čekající podle `wave`; zápas hráče, který právě judguje jiný rozehraný zápas, se posune o místo níž.
  Používá ji Můj Status (Tvoje aréna + pořadí v aréně), Judge menu, TV rozpis (obdélník na arénu), Řízení
  a BBXST. `rebalance_arenas` (tlačítko „Obsadit volné arény“ v Řízení) přesune čekající zápasy na volné arény.
- Pauza (09): `tournaments.pause_until`, RPC `set_pause(turnaj, minuty)` (0 = konec). Pruh s odpočtem pod
  záhlavím turnaje (`pauseBanner`), velké PAUZA na TV; odpočet tiká přes `[data-countdown]` v ui.js a po
  vypršení pošle `bbx:countdown-over` (pohled se překreslí).
- Statistiky (06): `bbx_battles()` rozloží každý zapsaný souboj (`points`) na dva řádky (bey, díly z decku,
  výsledek, body). Nad tím `tournament_report` (záložka Vyhodnocení), `meta_ranking` (stránka `#/meta`,
  `js/views/meta.js`, jen skončené turnaje, bez testovacích hráčů „T-…“ bez účtu) a `player_bey_stats` (profil).
  Blade u CX = lock chip + main blade. Souboje bez beyů (ruční výsledek) se nepočítají.
- Druh endu (11): `points.finish` = `xtreme` (+3) / `burst` / `over` (+2) / `spin` (+1), remíza null. BBXST posílá
  `finish` u každého souboje (i v `live_state` a offline frontě); `bbx_finish()` doplní chybějící z bodů (+2 bez
  volby zůstane null = „+2 nerozlišeno“). `bbx_battles` vrací i `finish`, `opp_bey`. Profil: `player_bey_stats`
  → `finishes` {given, taken} (dlaždice Endy, `finishTiles` v ui.js). Během turnaje „Můj deck“ v Můj Status
  (`my_deck_stats`, jen vlastní registrace): bilance, body získané/ztracené, endy dané/obdržené, kdo ho porazil.
- Akce mají druh `tournaments.event_type` (10): `training` (Trénink), `fashion`, `other` (Ostatní); Trénink/Ostatní =
  jen přihlášení. **Fashion** (`js/views/fashion.js`, vlastní pohled i TV; tournament.js ho přesměruje): přihláška
  s `fashion_beys` beyi (deck, stejné beye OK), design judge (`fashion_judges`, jen účet, nesoutěží, jen před startem).
  `fashion_start` zamíchá pořadí do `registrations.seed`, status `show`, stav v `tournaments.fashion`
  (`phase` scoring/tiebreak/boss/done, `current`, `last`, `tie`, `boss`, `reveal_at`, `v` = verze kvůli realtime).
  `fashion_rate` (0–10 design, 0–5 sladěnost, 0–5 cosplay, 0–3 unikátnost, +1 dojem); když ohodnotí všichni
  judge vyvolaného, vyvolá se další. Body (`fashion_scores`) nikdo nevidí do vyhlášení – čte se jen přes
  `fashion_board`. `fashion_finish`: shoda na 1. místě → rozstřel (`fashion_vote`, +1), znovu shoda → náhodný
  boss of fashion z judgů (`fashion_boss_pick`). Ostatní shody = dělené místo (1, 2, 2, 4). `fashion_board` vrací
  místa postupně: 4.+ hned po `reveal_at`, 3. za 5 s, 2. za 10 s, 1. za 15 s (TV vyhlášení), body až na konci.
  Achievementy 1.–3. místa: `player_achievements` (profil); turnajové tituly se počítají jen z turnajů.
  Notifikace (jdi hodnotit / jsi na molu / rozstřel / boss) v `app.js` → `watchFashion`.
- Komunity (13, `js/views/communities.js`, `#/communities`, `#/c/<id>`, přepínač Hráči | Komunity): zakládá
  organizátor+ (`community_create`), schvaluje hlavní admin v profilu (`admin_requests`, `community_review`).
  Zakladatel = leader, jmenuje zástupce (`community_set_role` 'sub'); členy přijímá leader i zástupce
  (`community_decide`). Role v profilu (`player_communities`). Tabulky jen přes RPC (bez select policy).
  **Komunitní trénink** = akce `event_type 'community'` + `community_id` (`js/views/training.js`, tournament.js
  přesměruje); zakládá leader/zástupce (`community_training_create`, + Trénink na hlavní stránce, „Komunitní“ v + Akce,
  stránka komunity), nezapočítává se do ratingu. Přidat se může člen nebo pozvaný (`training_invite`), jen účet,
  jen jeden otevřený trénink naráz (hlídá registrační trigger), deck 1–3 beye s opakováním dílů.
  `bbx_can_manage` pustí leadera/zástupce k řízení tréninku. Výzvy `training_matches`, souboje `training_battles`
  (p1/p2 + díly beyů). Historie `training_history` (me / all = všechny dvojice), comba `training_combos` (me / all, dělená podle
  majitele), skončené tréninky = „Historie tréninků“ na stránce komunity (s datem), meta komunity
  `community_meta` (stránka Meta → Komunita, `#/meta?c=<id>`), notifikace výzev v app.js `watchTraining`.
  **Boti** (15): `registrations.is_bot` (bez účtu, nastaví jen RPC), zakládá leader/zástupce v Řízení
  (`training_bot_create`, odebrání `training_bot_remove` = status dropped, historie zůstane). Výzva botovi je hned
  aktivní (BBXU „Hrát“ → rovnou BBXST), bez decku bota = zrcadlo vyzyvatelova decku, sestavu mění hráč v SETUPu.
  **Archiv**: skončený / zrušený trénink = jen ke čtení (zpět do komunity, razítko Archiv, bez Řízení a BBXST);
  trigger `bbx_training_close` uzavře rozehrané výzvy a `bbx_tmatch` odmítne zápis i setup.
  **TV tréninku** (`#/t/<id>/tv`, `Training.renderTV`): comba celého tréninku (`training_combos` all) po 12 na
  stránku (střídání po 12 s), obnova pollingem 8 s (TV nemusí být přihlášená), tlačítko TV v záhlaví jen u živého tréninku (v archivu ne).
- `vendor/` – supabase-js, qrcode-generator, html5-qrcode (lokálně, kvůli slabé síti v hale).
- `sw.js` – service worker (síť první, cache jako záloha).
- Vzhled: cyberpunk (černé pozadí s mřížkou, azurová `--cyan` + purpurová `--magenta`, žlutá `--bolt` jen pro
  aktivní věci a hlavní akce; hráč vlevo `.p1c`, vpravo `.p2c`; HUD rohy na kartách). Neonové ikony v `js/icons.js`.
  Logo BBX Unity = `icons/bbxunity.webp` (velké jen na přihlášení), v záhlaví jen nápis
  `icons/bbxunity-wordmark.webp`, ikony aplikace `icons/bbxu-*.png`.
  `icons/icon-*.png` a `favicon-32.png` patří BBXST – neměnit.

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
- Formáty (`tournaments.format`): **Klasika 3v3** (`swiss`) a **Deathmatch** (`deathmatch` = každý s každým 1×,
  `pairRoundRobin` v core.js, kruhová metoda s pevným pořadím podle hashe; počet kol nastaví `start_tournament`
  na n−1 / n). Deathmatch používá status i stage `swiss` – v UI se popisuje přes `phaseName(t)`. Po dohrání:
  ukončit podle tabulky, top cut, nebo finále top 2 (= `create_topcut` s velikostí 2, jeden zápas GF BO3).
  Když v deathmatchi někdo odstoupí, jeho soupeř má v tom kole volný los (víc volných losů v kole je OK).
- `tournaments.rated` (12, výchozí ano): jestli turnaj mění hráčský rating (`bbx_apply_rating` ho jinak přeskočí);
  přepínač v editoru, po startu nejde změnit, v záhlaví „bez ratingu“.
- `tournaments.unique_parts`: žádný díl (ani CX lock chip / main / over / assist) se v decku neopakuje –
  hlídá registrační trigger (`bbx_deck_dupe`) a `start_tournament`.
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
- `node tests/fashion.test.mjs` – fashion show v DB (po reset_db / ui-up): judge, hodnocení, rozstřel, boss, vyhlášení.
- `node tests/community.test.mjs` – komunity a komunitní trénink v DB (schválení, členové, trénink, výzvy, souboje, meta).
- `tests/ui-up.sh && python3 tests/ui_smoke.py && python3 tests/bbxst_judge.py && python3 tests/test_tools.py` – proklik v Chrome
  (`tests/judge_handover.py`, `tests/formats_stats.py`, `tests/arenas_status.py`, `tests/fashion_ui.py`, `tests/community_ui.py`, `tests/bbxst_training.py` a `tests/training_bot_ui.py` každý zvlášť po čerstvém `ui-up.sh`: převzetí judge;
  deathmatch přes testovací nástroje až po finále, vyhodnocení, meta, profil)
  (poslední: zkušební turnaj 16 hráčů přes testovací nástroje až po ukončení).
Když měníš SQL, přidej nový soubor i do `tests/reset_db.sh`. Po změně logiky nebo DB pusť testy.

## Testovací nástroje
V Řízení turnaje (jen admin): přidání N testovacích hráčů bez účtu (nick „T-…“, náhodný deck bez opakovaných
dílů) a náhodné dohrání otevřených zápasů včetně soubojů s beyi (kvůli vyhodnocení). Jen přes existující RPC (`add_walkin`, `submit_game`), bez změn DB.

## Zatím chybí / nápady
- Push notifikace při zavřené aplikaci (Edge Function + Web Push) – teď jen když je BBXU otevřené.
- Převod starých dat z Google Sheets.
