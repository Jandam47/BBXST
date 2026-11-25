# BBXU (BBX Unity) – pokyny pro Claude

Turnajová platforma pro Beyblade X (komunita Pardubice). Autor a hlavní admin: Adam (Jandam47).
Web běží na vlastní doméně **https://bbxu.cz** (GitHub Pages, soubor `CNAME`; dřív jandam47.github.io/BBXST/ – GitHub přesměrovává).
Všechny cesty v aplikaci jsou relativní – nic nepiš s `/BBXST/` ani s plnou adresou webu.
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
  0–9 + M, vnější výška 50–85, jen existující kombinace z `bey_parts`; Turbo / Operate = bit s ratchetem;
  bit na kolečku `trBitWheel` = stejné výseče ve třech řadách s hledáním jako `bitWheel` v BBXU, velikost podle
  `visualViewport`, aby ho klávesnice nezakryla).
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
  Ratchet se v editoru decku (registrace, hráč bez telefonu, fashion, trénink) vybírá na kolečku `ratchetWheel`
  (jako v BBXST: vnitřní kruh zuby 0–9 + M, vnější výška 50–85, jen existující kombinace; Turbo / Operate = bit
  s integrovaným ratchetem, normální ratchet ho zase zruší). Pole je `readonly`, `combo({ wheel: true })`.
  Bit se vybírá na kolečku `bitWheel` (parts.js): výseče jako „Založ akci“ ve třech řadách podle abecedy
  (vnitřní → vnější, počet podle obvodu; Turbo / Operate žlutě), uprostřed hledání (zkratka → název → slovo → alias), nevyhovující zhasnou, Enter /
  tlačítko uprostřed vezme nejlepší shodu, písmeno na poli bitu otevře kolečko s hledáním. Tip na zkratky nahoře.
- `js/config.js` – **obsahuje Adamovy živé klíče Supabase. Nikdy ho neměň ani nepřepisuj.**
- `supabase/schema.sql`, `02-parts.sql`, `03-live-score.sql`, `04-security-hardening.sql`, `05-judge-handover.sql`, `06-formats-stats.sql`, `07-parts-update.sql`, `08-judge-per-match.sql`, `09-pause.sql`, `10-fashion.sql`, `11-finishes.sql`, `12-rated.sql`, `13-communities.sql`, `14-training-extras.sql`, `15-training-bots.sql`, `16-training-reset.sql`, `17-chat-bazar.sql`, `18-chat-tournament-state.sql`, `19-account-reports.sql`, `20-push.sql`, `21-checkin-errors-backup.sql`, `22-leagues.sql`, `23-meetings.sql`, `24-judge-count.sql`, `25-reg-check.sql`, `26-judge-scan.sql`, `27-live.sql`, `28-cashier.sql`, `29-polls-feedback.sql`, `30-seen-sync.sql`, `31-community-standings.sql`, `32-parts-shatter-horus.sql`, `33-parts-hasbro-2026-11.sql`, `34-privacy-admin.sql`, `35-favorites.sql` – databáze (spuštěné v produkci, nové soubory
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
- TV rozpis turnaje (`renderTV` v tournament.js): bez automatického rolování. Na výšku (`main.tv-port`) arény pod sebou,
  na šířku (`main.tv-land`) vše na jedné obrazovce – mřížka `fitGrid` (sloupce × řádky podle počtu arén a poměru
  obrazovky), písmo podle velikosti karty (container query `cqh/cqw`), fronta zkrácená na 2–6 zápasů + „+ N dalších“.
  Při otočení / změně velikosti se překreslí.
- Historie bodů (`ptHist` / `matchHist` v tournament.js): žetony +1 / +2 O / +2 B / +2 / +3, remíza = R u obou – body hráče
  vlevo a vpravo u středu, v pořadí. Swiss řádky a Můj Status (`matchRow`): dohrané hry z `points` (`loadPoints`,
  stahuje se znovu jen po nové hře; BO3 = řádek na hru s číslem) + rozehraná z `matches.live_state`. TV: jen
  rozehraná hra pod živým skóre (`load(id, { hist: false })`). 7× +1 se vejde na řádek i na 360 px.
- **Živě** (`js/views/live.js`, `#/t/<id>/live`, tlačítko Živě vedle TV rozpis, bez přihlášení): přenos z arén pro
  diváky doma. Aréna: hráči, skóre, endy strany (X/B/O/S), deck obou hráčů (`live_decks` z 27, až po startu – pořadí
  si hráči určují na začátku sady a nemění ho): v aktuální sadě (souboje po 3) zahrané v řádcích s výsledkem
  (obrys zelený = výhra, červený = prohra, šedý = remíza), pod nimi „pool“ = zbytek decku (bey se určuje až po
  souboji, pořadí není dané); čekající zápas ukáže oba decky jako pool. Historie bodů, fronta. Sledovaní hráči
  (`localStorage bbxu_follow:<turnaj>`; s účtem tlačítko „Upozornit na telefon“ = `live_follow_set` / `live_follow_list`
  + push z triggeru `bbx_push_follow`: jde na arénu, výsledek). Feed „Dění“ (zaškrtávací arény, `bbxu_live_feed_off:<turnaj>`, sledovaní hráči vždy) + vyskakovací `.lv-flash` (rozdíl proti
  minulému načtení), statistiky turnaje v rozbalovacím okénku (endy, nejúspěšnější beye, nejvíc Xtreme / bodů),
  pavouk (`bracketHtml` z tournament.js, „Skrýt odehrané“), poslední výsledky, pořadí. **Režie**: jedna aréna přes celou
  plochu, lišta arén + AUTO (aréna s posledním děním, drží aspoň 12 s). Volby v `localStorage bbxu_live_*`.
  Realtime + polling 15 s.
- BBXST po dohraném zápase (`afterMatchNext`): „Další na aréně N“ s tlačítky ◂ BBXU · ZPĚT (jen zavře nabídku, judge mód
  zůstane zapnutý bez zápasu) · NAČÍST ZÁPAS.
- BBXST judge menu → aréna: vybraný zápas (výchozí ten na řadě / rozehraný) velkým písmem v `.jNext`, zbytek fronty
  pod ním menším (`.jQ`, klepnutím se vybere).
- BBXST judge → sken QR (26): `judge_scan_qr(token)` pustí jen aktivního hráče v běžícím turnaji (swiss / topcut), který
  má teď nedohraný zápas; vrátí turnaj, zápas a soupeře (`opp_reg`, `opp_nick`). Lišta ukáže „Hráč · Turnaj · aréna N ·
  naskenuj soupeře X“; druhý sken musí být přesně ten soupeř (jinak „Tohle není soupeř!“), pak se zápas rovnou načte.
  Chyby: není v aktivním turnaji (nezačal / skončil / zrušený), odstoupil, nemá teď zápas, jiný turnaj, stejný hráč.
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
  Přihláška má „Převést deck z turnaje“ (`importDecks` v fashion.js): turnaje, kde je hráč přihlášený (bez zrušených,
  nejbližší k datu fashion první, „stejný den“), deck přes `my_registration`, vezme se prvních `fashion_beys` beyů.
  Achievementy 1.–3. místa: `player_achievements` (profil); turnajové tituly se počítají jen z turnajů.
  Notifikace (jdi hodnotit / jsi na molu / rozstřel / boss) v `app.js` → `watchFashion`.
- **Záložka Hráči** (`openPlayersWheel` v players.js, app.js): kolečko nad stránkou Standings (`#/players`, rating) ·
  Komunity · Ligy · Trénink (jen člen komunity, `player_communities` s cache 2 min; víc komunit = podvýběr) →
  `#/c/<id>/standings` (`renderStandings` v communities.js, RPC `community_standings(komunita, od)` z 31: jen souboje
  z tréninků komunity, jen účty bez botů, vidí aktivní členové a admin 3+; období vše / 90 / 30 dní, řazení výhry /
  úspěšnost / body na klientovi). Horní přepínač Hráči | Komunity | Ligy (`peopleTabs`) už není.
- Komunity (13, `js/views/communities.js`, `#/communities`, `#/c/<id>`): zakládá
  organizátor+ (`community_create`), schvaluje hlavní admin v profilu (`admin_requests`, `community_review`).
  Zakladatel = leader, jmenuje zástupce (`community_set_role` 'sub'); členy přijímá leader i zástupce
  (`community_decide`). Role v profilu (`player_communities`). Tabulky jen přes RPC (bez select policy).
  **Komunitní trénink** = akce `event_type 'community'` + `community_id` (`js/views/training.js`, tournament.js
  přesměruje); zakládá leader/zástupce (`community_training_create`, kolečko Založ akci → Casual → Trénink → Komunitní,
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
- **Komunikace** (`js/views/komunikace.js`, záložka dole „Komunikace“, `data-tab="chat"`): klepnutí otevře kolečko
  (`openCreateWheel` s `title`/`hint`) Chat · Ankety · Nápověda · Dotazy a připomínky nad aktuální stránkou (bez přechodu,
  app.js); výseče mají žlutý odznak s počtem nového (`badge`, `unreadCounts()` z unread.js). Adresa `#/komunikace`
  kolečko otevře a po zavření bez výběru jde na `#/`. Stránky chat / ankety / dotazy už nemají horní přepínač.
  **Ankety** (29, `js/views/polls.js`, `#/ankety`, `#/ankety/<id>`): zakládá organizátor+ (`poll_create`: otázka, poznámka,
  2–10 možností, délka 5 min – 60 dní, `multi`, `anonymous` = kdo jak hlasoval nevidí nikdo); hlasuje účet (`poll_vote`, změna
  i zrušení do konce); výsledky vidí hlasující, autor a admin, po konci všichni (`poll_list`); `poll_close` / `poll_delete`
  autor nebo admin 3+; `poll_pending` do odznaku; nová anketa = push všem s odběrem. Tabulky jen přes RPC.
  **Dotazy a připomínky** (29, `js/views/feedback.js`, `#/dotazy`): soukromá zpráva hlavnímu adminovi (`feedback_send`, limit
  5 / 10 min, push superadminům); hráč vidí své + odpovědi (`feedback_mine`, „přečteno“ `bbxu_fb_seen`), hlavní admin schránku
  (`feedback_inbox` otevřené / vše, `feedback_reply` → push autorovi, `feedback_done`). Odznak (`js/unread.js`) = nepřečtené
  místnosti + ankety bez hlasu + nevyřízené dotazy (hlavní admin) / nová odpověď.
  **Bazar je zrušený** (UI pryč, `#/bazar…` ukáže „Bazar skončil“); tabulky a funkce bazaru v DB zůstaly (staré fotky
  se při smazání účtu pořád mažou přes `bazar_my_photos`).
  Router v app.js dává každému pohledu nové čisté `<main>` (posluchače `on(main, …)` nepřežijí navigaci).
- **Chat** (17, `js/views/chat.js`, `#/chat`, `#/chat/<room>`, součást Komunikace): `chat_rooms.kind` = `test`
  (Zkušební chat, id 'volny', píše každý s účtem), `info` (pevná Obecné informace) a `info_t` (místnost ke každému
  turnaji kind 'tournament', id `t-<turnaj>`, název „DD.MM.RRRR Název“ – zakládá/přejmenovává trigger
  `bbx_chat_sync_tournament`) – Info čte každý, píšou organizátoři+; `community` (id `c-<komunita>`, po schválení
  komunity, `bbx_chat_sync_community`) – čtou a píšou aktivní členové + hosté `chat_guests` (zve leader/zástupce
  `chat_guest_invite` na 1 min – 7 dní, `see_history` = vidí i zprávy před pozváním). Přístup jen RLS přes
  `bbx_chat_read(room, created_at)` / `bbx_chat_write` / `bbx_chat_moderate` (admin, leader/zástupce v komunitě).
  Přehled `chat_room_list`, detail `chat_room_info`. Limit 1 zpráva / s (`bbx_chat_fill`).
  Chat k turnaji (18): `chat_rooms.state` active / closed (jen číst) / hidden (vidí jen organizátor akce + admini);
  `chat_room_state(room, 'active'|'closed'|'hidden'|'delete')` smí organizátor akce a admin (`bbx_chat_manage`),
  tlačítka v místnosti. Po ukončení turnaje (finishModal v manage.js) se BBXU zeptá Nechat aktivní / Uzavřít
  (`askTournamentChat`). Místnost vzniká jen při založení turnaje – úprava turnaje smazanou nevrátí.
- **Odznak nepřečtených** (`js/unread.js`): na záložce Komunikace (viz výše), živě přes realtime u chatu + polling 90 s,
  i `navigator.setAppBadge`. „Přečteno“ (30): localStorage po uživateli (`seenKey` = `bbxu_chat_seen:<uid>`, `bbxu_fb_seen:<uid>`)
  + server `user_seen` (`seen_set` jen dopředu, `syncSeen` s odkladem 0,7 s; čte se z `chat_room_list.seen` a
  `feedback_count.seen`, klient bere max) – přečtené na jednom zařízení zhasne všude. Ankety se počítají do hlasování.
- **Nahlášení** (19, `js/report.js`): ⚑ u zprávy v chatu (staré nahlášení z bazaru se dají dořešit); `report_create`
  (jen obsah, který hráč vidí, kopie obsahu do `snapshot`), admini (úroveň 3+) v profilu „Nahlášený obsah“
  (`report_list`, `report_resolve` smazat / ponechat, `report_count`).
- **Smazání účtu** (19): profil → ⚙ → Profil → Smazání účtu → Smazat natrvalo (potvrzení nickem). `delete_my_account` smaže auth.users
  (kaskádou profil, zprávy, bazar, členství, odběry); registrace zůstanou anonymně („Smazaný hráč XXXX“).
  Ne hlavní admin, ne leader komunity. Fotky z bazaru klient smaže přes `bazar_my_photos`.
- **Sdílení výsledků** (`js/share.js`): skončený turnaj → „Sdílet výsledky“ = obrázek 1080×1350 (canvas: top 8,
  deck vítěze) + text; Web Share s obrázkem, stažení, kopírování textu.
- **Push notifikace** (20, `js/push.js`, `supabase/functions/push/index.ts`): odběr zařízení `push_subscribe`
  (profil → Upozornění na telefonu; po přihlášení s povoleným oprávněním se odběr obnoví sám – `syncPush`,
  při odhlášení se ruší). Triggery volají `bbx_push(uživatelé, titulek, text, odkaz, tag)` → `push_outbox` →
  pg_net → Edge Function `push` (verify_jwt false, hlavička `x-bbx-secret`), ta rozešle Web Push (npm:web-push,
  VAPID) a smaže neplatné odběry. Adresa, heslo i VAPID klíče jsou jen v soukromé `bbx_settings` (`push_url`,
  `push_secret`, `vapid_public`, `vapid_private`, `vapid_subject`; funkce je čte přes service role), veřejný klíč i v push.js.
  Události: zápas na aréně, start turnaje, výzva / přijetí na tréninku, nová anketa, dotaz / odpověď, info k turnaji (přihlášeným),
  obecné informace (všem s odběrem), fashion (molo, rozstřel, boss), nové nahlášení (adminům). Autor akce nic
  nedostane. sw.js: `push` → showNotification, `notificationclick` → otevře odkaz (#/… nebo bbxst.html…).
- **Kontrola registrací** (21 + 25, `js/regcheck.js`): stav = `registrations.checked_in_at` (mění jen RPC `checkin`,
  hlídá trigger `bbx_protect_checkin`; když hráč změní deck, kontrola se zruší). Organizátor/admin v záložce Hráči
  (turnaj v registraci): panel s počty, „Načíst QR kód“ (`checkin_lookup` podle tokenu, skener html5-qrcode se načte
  až při otevření, jde i z obrázku) nebo klepnutí na hráče → modal: 3 beyblady k odškrtnutí → Potvrdit registraci,
  Vyřadit – nenastoupí (status dropped) / Vrátit, Zpět. Řádky zelená = zkontrolováno, žlutá = čeká, červená = vyřazen.
  `checkin_list` → `d.checkin` (load v tournament.js). Řízení: Spustit turnaj jde až po kontrole všech aktivních,
  jinak „⚠ Spustit bez kontroly registrací“ s varováním. Hráče přidané v Řízení (i testovací) zkontroluje rovnou.
  Vstupenka ukazuje „✓ Registrace zkontrolována“. (`drop_noshows` z 21 zůstává v DB, UI ho nepoužívá.)
- **Pokladník a vstupné** (28): `profiles.cashier` = funkce Pokladník mimo žebříček rolí (admin v profilu → Funkce,
  `set_cashier`; chrání trigger `bbx_protect_cashier`). Turnaj: `fee`, `entry_fee` (Kč, nepovinné), `cashiers` (uuid[] – pokladníci
  z `cashier_list` nebo organizátor turnaje = `created_by`; hlídá trigger `bbx_fee_fields`), karta Vstupné v editoru (jen turnaje).
  Registrace: `paid_at` / `paid_by` (mění jen `pay_set`, trigger `bbx_protect_paid`, sloupce nejsou veřejně čitelné). Zapisuje
  `bbx_can_cash` = pokladník turnaje, organizátor (`bbx_can_manage`), admin; `pay_list` → `d.pay` (load v tournament.js, `canCash`
  v supa.js). Kontrola registrace má „💰 Zaplatil vstupné“; pokladník, který turnaj neřídí, vidí v Hráčích jen vstupné
  (`payPanel` / `payModal` v regcheck.js, sken QR přes `checkin_lookup`, který pustí i pokladníka). Start turnaje neblokuje,
  Řízení jen upozorní na nezaplacené. Vstupenka: `my_registration.paid_at`. Záhlaví turnaje: 💰 Vstupné N Kč.
- **E-maily přihlašování**: Supabase Auth posílá přes vlastní SMTP (Resend, `smtp.resend.com:465`, odesílatel `noreply@bbxu.cz`,
  doména ověřená DNS záznamy u WEDOSu; limit Resend free 100/den). České šablony v `supabase/email/` (confirm, reset,
  email-change = i převod hosta na účet) – Adam je vkládá ručně do Authentication → Emails → Templates.
- **Chyby z telefonů** (21, `js/errlog.js`): `installErrorLog(sb, app)` v app.js i bbxst.html (module skript na konci,
  sahá na globální `sb`) chytá `error` / `unhandledrejection`, router posílá i nenačtené stránky (`logError`). RPC
  `log_client_error` (i anon, stejná chyba = `count`+1, max 60 nových / 10 min), admini 3+ v profilu „Chyby z telefonů“
  (`js/admin.js` → `client_error_list`, `client_error_resolve`). Síťové chyby a kamera se ignorují.
- **Záloha** (21): hlavní admin v profilu „Záloha dat“ → `export_backup()` = JSON všech veřejných tabulek kromě
  `bbx_settings`, `push_*`, `client_errors` (bez e-mailů a fotek); čas v `bbx_settings.last_backup`, `backup_status()`.
  Po 14 dnech (`backupDue`) banner na hlavní stránce.
- **Nápověda** `#/help` (`js/views/help.js`, `?k=<sekce>` otevře sekci; sekce start, reg, play, points, standings, league, judge, live, org, training, chat, notify, account): tlačítko „?“ na hlavní stránce, „Jak na to“ v profilu. Při nové funkci pro uživatele doplň i nápovědu.
- **Nastavení v profilu** (`openSettingsWheel` v profile.js): ozubené kolečko `.prof-gear` vpravo u jména (jen vlastní profil
  s účtem) → kolečko **Profil** (Upravit, Heslo, Sdílet = QR + odkaz `#/p/<id>`, Soukromí, Odhlásit, Smazání účtu → Smazat natrvalo →
  potvrzení nickem) · **Vstupenka** (jen když je hráč aktivně v turnaji registration/swiss/topcut; víc turnajů = podvýběr; QR přes
  `my_registration`, cache `localStorage bbxu_tickets:<uid>` → funguje bez signálu) · **Aplikace** (Upozornění = `pushCard`,
  Instalace = `installCard`, Nápověda) · **Správa** (admin 3+: Žádosti a Záloha jen hlavní admin, Nahlášené, Chyby, Lidé s funkcí =
  přehled + hledání; odznaky z `admin_counts()` (34), stejný součet na kolečku a pruh „Správa čeká“ pod záhlavím).
  Modaly přes `sheet()` se zavřou při změně adresy. Odkazy `#/me?s=backup|reports|errors|requests|staff|privacy|share|tickets`
  otevřou rovnou daný modal (banner zálohy na hlavní stránce). Pod jménem už tlačítka ani admin karty nejsou; host bez účtu má
  instalaci dál přímo na stránce.
- **Oblíbené buildy a decky** (35, `js/favorites.js`, `js/views/favorites.js`, `#/oblibene`, `?tab=decky`): ★ `.prof-fav` vedle
  ozubeného kolečka → „Choose wheel“ (Oblíbené buildy · Decky · Nový build). `fav_builds` (bey ve tvaru decku, trigger
  `bbx_fav_build_fill` normalizuje díly a skládá `name` přes `bbx_compose_bey`, duplicita názvu = chyba, max 60) a `fav_decks`
  (název + `builds uuid[]` v pořadí, 1–10, jen vlastní buildy, max 20; smazaný build z decků zmizí, prázdný deck se smaže –
  `bbx_fav_build_gone`). Jen vlastní řádky (RLS), jen účet. `bindDeckEditor` přidá nad editor lištu `deckToolbar`
  (★ Podle decku / ★ Z oblíbených → `api.setBey`, když je všechno plné, zeptá se na slot); `{ favorites: false }` u hráče
  bez telefonu (Řízení, fashion). Cache 60 s v `loadFavs`.
- **Vzhled** (`js/theme.js`, seznam `THEMES` s náhledem a barvou lišty): Neon (výchozí, bez atributu), Synthwave (`synth`),
  Toxic (`toxic`), Ronin (`ronin`) = jen proměnné v `html[data-theme=…]` na konci bbxu.css (vč. `--cyan-rgb`, `--magenta-rgb`,
  `--bolt-rgb`, `--gold-rgb`, `--ink-rgb` pro průhledné barvy – piš `rgba(var(--cyan-rgb),.4)`, ne natvrdo). Nové schéma = blok
  proměnných + řádek v `THEMES` + barva v inline skriptu index.html. Bez neonů = `html[data-theme=mono]` – šedé proměnné, bez `box-shadow` /
  `text-shadow` / filtrů uvnitř, plus `filter: grayscale(1)` na `<html>` (dobarví i natvrdo psané barvy a SVG; na kořeni
  nerozbije `position: fixed`). Volba v `localStorage bbxu_theme` (jen zařízení), inline skript v hlavičce index.html ji
  nastaví před vykreslením, mění se v ⚙ → Aplikace → Vzhled (host: tlačítko v profilu). BBXST se nemění.
  Nové barvy v CSS piš přes proměnné, ať schémata fungují bez úprav (zelená OK a výhry v pruzích `.meta-bar .w`, červená chyba a trofeje zůstávají pevné).
- **Soukromí** (34): `profiles.privacy` jsonb {beys, h2h, standings} (mění hráč sám přes update profilu). `bbx_private()` →
  `player_bey_stats` a `player_h2h` vrací ostatním prázdno, `players_list` skrytého vynechá (kromě něj samého). Výsledky
  turnajů, pavouk, meta a community standings zůstávají veřejné.
- **Vzájemná bilance** (21): `player_h2h(p_user)` → profil: „Ty vs hráč“ (`vs_me`, posledních 5 zápasů) a nejčastější
  soupeři s účtem (výhry–prohry).
- **Počítadlo judgování** (24): `player_judged(p_user)` = zápasy, kde hráč zapsal aspoň jednu hru (`games.judge_id`;
  BO3 = 1 zápas), a počet turnajů; bez zrušených turnajů a zápasů jen testovacích „T-…“. Profil: dlaždice přes celou
  šířku pod statistikami (u judge+ vždy, jinak jen když je > 0).
- **Založ akci** (`js/create-wheel.js`): na hlavní stránce jedno tlačítko → kolečko (SVG) jen s tím, co uživatel smí:
  Casual (Trénink → Casual / Komunitní, Meeting → Osobně / Online), Fashion, Turnaje (Deathmatch, Klasika 3v3,
  3v3 liga → výběr z `my_leagues`). Střed = zpět / zavřít, Esc. Listy vedou do editoru s předvolbou
  (`#/new?f=deathmatch|swiss&league=<id>`, `#/new/event?type=training|fashion|meeting&mode=live|online`, druh akce se
  pak v editoru neukazuje) nebo do formuláře komunitního tréninku (`trainingForm`). Staré adresy `#/new`, `#/new/event` fungují dál.
- **Meeting** (23): `event_type 'meeting'`, `meeting_mode` live / online (u online je v `location` odkaz https, v záhlaví
  „Připojit se“), `visibility` all / staff (jen u meetingu; staff = vidí a přihlásí se jen organizátoři+ a zakladatel –
  RLS `t_read` přes `bbx_can_see`, filtr v `tournament_list`, trigger `bbx_reg_visibility`). `bbx_meeting_fields`
  u ostatních akcí způsob i viditelnost vynuluje.
- **Ligy** (22, `js/views/leagues.js`, `#/leagues`, `#/l/<id>`, kolečko Hráči): `leagues` (zakládá,
  upravuje, archivuje a maže jen hlavní admin – `league_save`, `league_delete`; bodování v `leagues.scoring`: účast 1,
  postup do top cutu +1, 4. +1, 3. +2, 2. +3, 1. +5, body se sčítají). `league_staff`: správce (jmenuje hlavní admin)
  a organizátoři ligy (přidává správce nebo admin) – `league_staff_set`, jen hráči s funkcí organizátor+; nastavuje se
  na stránce ligy (Správa) i v profilu organizátora (karta Ligové turnaje, `player_leagues.roles`). Ligové turnaje
  zakládá admin+ ve všech aktivních ligách, jinak jen správce / organizátor ligy (`bbx_league_can`, `my_leagues`);
  `tournaments.league_id` se vybírá v editoru turnaje (`#/new?league=<id>` předvybere), hlídá trigger
  `bbx_protect_league`. Tabulka `bbx_league_table` (jen skončené turnaje, hráč = účet nebo nick, bez „T-…“ bez účtu):
  body ligy, turnaje, V–P a body +/− ze zápasů bez volných losů; pořadí body → výhry → rozdíl → získané body.
  `league_list`, `league_detail`, umístění v profilu (`player_leagues.standings`), název ligy v `tournament_list`
  a v záhlaví turnaje.
- **Instalace aplikací** (`js/install.js`): BBXU a BBXST mají oddělené manifesty i platnost (`manifest.json` scope
  `./index.html`, `bbxst.webmanifest` scope `./bbxst.html`), takže jdou nainstalovat obě zvlášť. Holou adresu složky
  index.html přepíše na `index.html` (inline skript v hlavičce, ten zachytí i `beforeinstallprompt` → `window.__bip`).
  Profil (i host) → karta „Aplikace na plochu“: BBXU přes `__bip.prompt()`, BBXST odkazem `bbxst.html?install=1`, kde se
  ukáže jen tehdy výzva k instalaci (iPhone / bez nabídky prohlížeče = návod). V BBXST je `history` jiná proměnná –
  používej `window.history`. Přihlášení vrací na adresu bez `index.html` (`redirectTo` v auth.js). Manifesty se
  načítají s `?v=N` (zvyš při změně, ať telefony nečtou starý z cache). Nainstalované BBXST startuje na výšku
  (`orientation: portrait`), otočení tlačítkem v kolečku funguje v celé obrazovce i v nainstalované aplikaci.
- **Měsíční kontrola dílů**: naplánovaná úloha (2. den v měsíci, 20:13) porovná kyoganken (Takara Tomy) i nové Hasbro
  produkty (beysandbricks.com/hasbro-beyblades, obchody, zprávy) s `bey_parts` a případně otevře PR s novým
  `NN-parts-RRRR-MM.sql` (Hasbro-only díly = Hasbro název, Hasbro názvy Takara dílů = aliases; do DB nic nezapisuje).
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
- Host bez účtu = anonymní přihlášení Supabase; účet si může založit později a registrace se převedou (e-mailem přes
  `updateUser`, nebo přes Discord `linkIdentity` – v Supabase musí být zapnuté „Allow manual linking“; když linkování
  nejde, nabídne běžné přihlášení přes Discord; chybu „už propojeno“ z adresy přeloží app.js a další klik už se přihlásí).
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
`tests/ui-server.mjs` napodobuje i Supabase Storage (`/tmp/bbx-storage`); realtime lokálně není.
- `node tests/core.test.mjs` – logika (párování 4–64 hráčů, pavouk 2–32 s byes, umístění).
- `tests/reset_db.sh && node tests/db.test.mjs` – celý turnaj proti DB se stubem Supabase (role, RLS, RPC).
- `node tests/fashion.test.mjs` – fashion show v DB (po reset_db / ui-up): judge, hodnocení, rozstřel, boss, vyhlášení.
- `node tests/chat.test.mjs` – chat (místnosti, přístup, hosté) a bazar (fotky, soukromá vlákna) v DB.
- `node tests/polls.test.mjs` – ankety (zakládání, hlasování, anonymní / veřejné, konec), dotazy a připomínky (29), přečteno na serveru (30).
- `node tests/favorites.test.mjs` – oblíbené buildy a decky (35).
- `node tests/extras.test.mjs` – kontrola registrací, chyby z telefonů, záloha, vzájemná bilance (21, 25), soukromí a `admin_counts` (34).
- `node tests/leagues.test.mjs` – ligy: práva správce / organizátorů, ligové turnaje, bodování a bilance (22).
- `node tests/meetings.test.mjs` – meeting osobně / online, akce jen pro organizátory (23).
- `node tests/judge-count.test.mjs` – počítadlo odjudgovaných zápasů (24).
- `node tests/live.test.mjs` – Živě: decky po startu, sledování hráčů, push sledujícím (27).
- `node tests/cashier.test.mjs` – pokladník, vstupné, zápis zaplaceno (28).
- `node tests/account.test.mjs` – nahlášení a smazání účtu; `node tests/push.test.mjs` – odběry a push události (outbox).
- `node tests/community.test.mjs` – komunity a komunitní trénink v DB (schválení, členové, trénink, výzvy, souboje, meta, standings 31).
- `tests/ui-up.sh && python3 tests/ui_smoke.py && python3 tests/bbxst_judge.py && python3 tests/test_tools.py` – proklik v Chrome
  (`tests/judge_handover.py`, `tests/formats_stats.py`, `tests/arenas_status.py`, `tests/fashion_ui.py`, `tests/community_ui.py`, `tests/bbxst_training.py`, `tests/training_bot_ui.py`, `tests/chat_ui.py`, `tests/komunikace_ui.py`, `tests/players_wheel_ui.py`, `tests/extras_ui.py`, `tests/checkin_ui.py`, `tests/leagues_ui.py`, `tests/install_ui.py`, `tests/create_wheel_ui.py`, `tests/tv_modes_ui.py`, `tests/points_hist_ui.py`, `tests/ratchet_wheel_ui.py`, `tests/live_ui.py` a `tests/cashier_ui.py`, `tests/profile_gear_ui.py`, `tests/favorites_ui.py` každý zvlášť po čerstvém `ui-up.sh`: převzetí judge;
  deathmatch přes testovací nástroje až po finále, vyhodnocení, meta, profil)
  (poslední: zkušební turnaj 16 hráčů přes testovací nástroje až po ukončení).
Když měníš SQL, přidej nový soubor i do `tests/reset_db.sh`. Po změně logiky nebo DB pusť testy.

## Testovací nástroje
V Řízení turnaje (jen admin): přidání N testovacích hráčů bez účtu (nick „T-…“, náhodný deck bez opakovaných
dílů) a náhodné dohrání otevřených zápasů včetně soubojů s beyi (kvůli vyhodnocení). Jen přes existující RPC (`add_walkin`, `submit_game`), bez změn DB.

## Na vyřízení (dohodnuté s Adamem)
- **Achievementy** – vlastní, originální systém (konkurenční aplikace má odznaky, nesmí to vypadat jako kopie), interaktivní.
  Nápady z 25. 11. 2026: osobní emblém skládaný z odemčených kousků, stupně podle endů (Spin / Over / Burst / Xtreme),
  Beyblade momenty (comeback z 0:5, čisté 7:0, „Inženýr“ 20 comb, „Věrnost bitu“), tajné s % hráčů, komunitní cíl
  (společně 1000 Xtreme), uznání za judgování.
- **Report z turnaje vyšperkovat** (záložka Vyhodnocení / sdílení výsledků).
- **Připomínka turnaje + kalendář** (.ics, upozornění den předem) – později.
- **Méně stahování dat na turnaji**: při bodu (`live_score`) jen upravit skóre v telefonu místo `load()` celého turnaje
  (egress Free plánu 5 GB / měsíc); `watchMyMatches` v app.js poslouchá všechny `matches` bez filtru.
- Zamítnuto (neřešit): oznámení „jsi další na řadě“, sporný souboj na později, samoobsluha check-inu, zopakovat turnaj,
  převod dat z Google Sheets (BBXU začíná od nuly). Výsledky na Discord zatím ne.
