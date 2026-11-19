-- ════════════════════════════════════════════════════════════════════
--  BBXU – formáty turnaje (Klasika 3v3 / Deathmatch), pravidlo
--  „díly se v decku neopakují“, statistiky beyů, vyhodnocení turnaje, meta
--  Spusť v Supabase → SQL Editor. Jde spustit i opakovaně.
--
--  Deathmatch = každý s každým 1×. Interně používá stejnou fázi a zápasy
--  jako swiss (status 'swiss', stage 'swiss'); počet kol se nastaví při
--  startu (n − 1, při lichém počtu n). Pak organizátor turnaj ukončí,
--  spustí top cut, nebo finále top 2 (top cut velikosti 2 = jeden zápas BO3).
-- ════════════════════════════════════════════════════════════════════

alter table public.tournaments add column if not exists format text not null default 'swiss';
alter table public.tournaments add column if not exists unique_parts boolean not null default false;
do $$ begin
  alter table public.tournaments add constraint t_format_chk check (format in ('swiss','deathmatch'));
exception when duplicate_object then null; end $$;
-- deathmatch může mít víc kol než swiss (16 hráčů = 15 kol, 30 hráčů = 29 kol)
alter table public.tournaments drop constraint if exists t_nums_chk;
alter table public.tournaments add constraint t_nums_chk
  check (swiss_rounds between 1 and 127 and top_cut between 0 and 128
         and arena_count between 1 and 64 and win_score between 1 and 99);

-- formát a pravidlo dílů jdou měnit jen během registrace
create or replace function public.bbx_protect_tournament() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.bbx_privileged() then
    if tg_op = 'INSERT' then
      new.status := 'registration'; new.current_round := 0;
      new.started_at := null; new.finished_at := null; new.created_by := auth.uid();
    else
      if new.status is distinct from old.status or new.current_round is distinct from old.current_round
         or new.created_by is distinct from old.created_by or new.started_at is distinct from old.started_at
         or new.finished_at is distinct from old.finished_at then
        raise exception 'Stav turnaje se mění jen přes ovládání turnaje.';
      end if;
      if old.status not in ('registration') and (new.swiss_rounds <> old.swiss_rounds or new.win_score <> old.win_score
         or new.kind <> old.kind or new.format <> old.format or new.unique_parts <> old.unique_parts) then
        raise exception 'Po startu nejde měnit formát, počet kol, body na výhru ani pravidla decku.';
      end if;
    end if;
  end if;
  return new;
end $$;

-- první díl, který je v decku víckrát (stejná kategorie, stejný název), jinak null
create or replace function public.bbx_deck_dupe(p_deck jsonb) returns text
language sql immutable set search_path = public as $$
  select min(e.value)
    from jsonb_array_elements(coalesce(p_deck, '[]')) b, jsonb_each_text(b) e
   where e.key <> 'type' and e.value is not null and jsonb_typeof(b) = 'object'
   group by e.key, lower(e.value)
  having count(*) > 1
   limit 1
$$;
revoke execute on function public.bbx_deck_dupe(jsonb) from public, anon, authenticated;

-- registrace: navíc kontrola opakovaných dílů, když to turnaj vyžaduje
create or replace function public.bbx_protect_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  prof public.profiles;
  manager boolean;
  dupe text;
begin
  select * into t from public.tournaments where id = new.tournament_id;
  if not found then raise exception 'Turnaj neexistuje.'; end if;
  manager := public.bbx_privileged() or public.bbx_can_manage(new.tournament_id);

  new.nick := btrim(new.nick);
  new.updated_at := now();

  if not manager then
    if t.status <> 'registration' then raise exception 'Registrace do tohoto turnaje je uzavřená.'; end if;
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
      new.status := 'active'; new.seed := null; new.final_place := null;
      new.qr_token := gen_random_uuid();
      if t.max_players is not null and (select count(*) from public.registrations
             where tournament_id = t.id and status = 'active') >= t.max_players then
        raise exception 'Turnaj je plný.';
      end if;
    else
      if new.user_id is distinct from old.user_id or new.tournament_id <> old.tournament_id
         or new.status <> old.status or new.seed is distinct from old.seed
         or new.final_place is distinct from old.final_place or new.qr_token <> old.qr_token then
        raise exception 'Tuhle část registrace upravit nemůžeš.';
      end if;
    end if;
  end if;

  if new.user_id is not null and not public.bbx_privileged() and new.user_id = auth.uid() and not public.bbx_is_anon() then
    select * into prof from public.profiles where id = new.user_id;
    if prof.nick is null then raise exception 'Nejdřív si v profilu nastav nick.'; end if;
    new.nick := prof.nick;
  end if;

  if exists (select 1 from public.profiles p
              where p.nick is not null and lower(p.nick) = lower(new.nick)
                and p.id is distinct from new.user_id) then
    raise exception 'Nick „%“ patří registrovanému hráči. Zvol jiný, nebo se přihlas.', new.nick;
  end if;

  if t.kind = 'tournament' then
    if tg_op = 'INSERT' or new.deck is distinct from old.deck then
      if new.deck is null or jsonb_typeof(new.deck) <> 'array' or jsonb_array_length(new.deck) <> 3 then
        raise exception 'Vyber tři beyblady ze seznamu dílů.';
      end if;
      new.bey1 := public.bbx_compose_bey(new.deck->0, 1);
      new.bey2 := public.bbx_compose_bey(new.deck->1, 2);
      new.bey3 := public.bbx_compose_bey(new.deck->2, 3);
      new.deck := public.bbx_normalize_deck(new.deck);
      if t.unique_parts then
        dupe := public.bbx_deck_dupe(new.deck);
        if dupe is not null then
          raise exception 'Díl „%“ je v decku víckrát – v tomhle turnaji se díly nesmí opakovat.', dupe;
        end if;
      end if;
    elsif tg_op = 'UPDATE' then
      new.bey1 := old.bey1; new.bey2 := old.bey2; new.bey3 := old.bey3;
    end if;
    if lower(new.bey1) in (lower(new.bey2), lower(new.bey3)) or lower(new.bey2) = lower(new.bey3) then
      raise exception 'Každý beyblade musí být jiný.';
    end if;
  else
    new.deck := null; new.bey1 := null; new.bey2 := null; new.bey3 := null;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_protect_registration() from public, anon, authenticated;

-- start: deathmatch si spočítá počet kol, pravidlo dílů se zkontroluje u všech
create or replace function public.start_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n int; bad text;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.kind <> 'tournament' then raise exception 'Akce se nespouští, jen ukončí.'; end if;
  if t.status <> 'registration' then raise exception 'Turnaj už běží.'; end if;
  select count(*) into n from public.registrations where tournament_id = t.id and status = 'active';
  if n < 2 then raise exception 'Potřebuješ aspoň 2 hráče.'; end if;
  if t.unique_parts then
    select string_agg(nick, ', ' order by nick) into bad from public.registrations
     where tournament_id = t.id and status = 'active' and public.bbx_deck_dupe(deck) is not null;
    if bad is not null then
      raise exception 'Opakované díly v decku mají: %. Ať si deck upraví, nebo pravidlo vypni.', bad;
    end if;
  end if;
  perform public.bbx_set_privileged();
  update public.tournaments
     set status = 'swiss', started_at = now(), current_round = 0,
         swiss_rounds = case when t.format = 'deathmatch' then (case when n % 2 = 0 then n - 1 else n end) else swiss_rounds end
   where id = t.id;
end $$;

-- kolo: víc volných losů v jednom kole (deathmatch, když soupeř odstoupil)
create or replace function public.create_swiss_round(p_tournament uuid, p_round int, p_pairings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; pr jsonb; i int := 0; nb int := 0; ids uuid[] := '{}'; a uuid; b uuid; nk int;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'swiss' then raise exception 'Turnaj není ve swiss fázi.'; end if;
  if p_round <> t.current_round + 1 then raise exception 'Čekám kolo %, přišlo %.', t.current_round + 1, p_round; end if;
  if p_round > t.swiss_rounds then raise exception 'Všechna swiss kola už proběhla.'; end if;
  if exists (select 1 from public.matches where tournament_id = t.id and stage = 'swiss' and status <> 'done') then
    raise exception 'Nejdřív dohrajte všechny zápasy aktuálního kola.';
  end if;

  for pr in select * from jsonb_array_elements(p_pairings) loop
    a := (pr->>'p1')::uuid;
    b := nullif(pr->>'p2','')::uuid;
    if a is null then raise exception 'Chybí hráč 1.'; end if;
    if a = any(ids) or (b is not null and b = any(ids)) then raise exception 'Hráč je v kole dvakrát.'; end if;
    if not exists (select 1 from public.registrations where id = a and tournament_id = t.id and status = 'active')
       or (b is not null and not exists (select 1 from public.registrations where id = b and tournament_id = t.id and status = 'active')) then
      raise exception 'Hráč nepatří do turnaje nebo odstoupil.';
    end if;
    ids := ids || a; if b is not null then ids := ids || b; end if;

    if b is null then
      -- volný los = výhra win_score:0 (v deathmatchi jich může být víc, když někdo odstoupil)
      nb := nb + 1;
      insert into public.matches (tournament_id, stage, round, pos, key, p1_reg, p2_bye, status, winner_reg,
                                  p1_wins, p1_score, is_bye, finished_at)
      values (t.id, 'swiss', p_round, 999, 'S'||p_round||'-BYE'||case when nb > 1 then '-'||nb else '' end, a, true, 'done', a, 1, t.win_score, true, now());
    else
      i := i + 1;
      insert into public.matches (tournament_id, stage, round, pos, key, p1_reg, p2_reg, arena, wave, best_of)
      values (t.id, 'swiss', p_round, i, 'S'||p_round||'-'||i, a, b,
              ((i - 1) % t.arena_count) + 1, ((i - 1) / t.arena_count) + 1, 1);
    end if;
  end loop;

  select count(*) into nk from public.registrations where tournament_id = t.id and status = 'active';
  if coalesce(array_length(ids,1),0) <> nk then raise exception 'Párování nepokrývá všechny aktivní hráče (% z %).', coalesce(array_length(ids,1),0), nk; end if;

  update public.tournaments set current_round = p_round where id = t.id;
end $$;

-- BBXST potřebuje znát formát (popisek kola)
create or replace function public.bbx_match_json(m public.matches) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'tournament_id', m.tournament_id, 'tournament_name', t.name, 'win_score', t.win_score,
    'format', t.format, 'top_cut', t.top_cut,
    'stage', m.stage, 'round', m.round, 'key', m.key, 'arena', m.arena, 'wave', m.wave,
    'best_of', m.best_of, 'p1_wins', m.p1_wins, 'p2_wins', m.p2_wins, 'status', m.status,
    'games_played', (select count(*) from public.games g where g.match_id = m.id),
    'judge_id', m.judge_id, 'judge_nick', public.bbx_judge_nick(m.judge_id),
    'live_p1', m.live_p1, 'live_p2', m.live_p2, 'live_state', m.live_state,
    'p1', jsonb_build_object('reg', r1.id, 'nick', r1.nick, 'beys', jsonb_build_array(r1.bey1, r1.bey2, r1.bey3)),
    'p2', jsonb_build_object('reg', r2.id, 'nick', r2.nick, 'beys', jsonb_build_array(r2.bey1, r2.bey2, r2.bey3)))
  from public.tournaments t, public.registrations r1, public.registrations r2
  where t.id = m.tournament_id and r1.id = m.p1_reg and r2.id = m.p2_reg
$$;
revoke execute on function public.bbx_match_json(public.matches) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
--  STATISTIKY
--  Každý zapsaný souboj (points) = dva řádky, jeden za každou stranu:
--  bey, jeho díly z decku, výsledek (1 výhra / 0 remíza / −1 prohra) a body.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.bbx_battles(p_tournament uuid default null)
returns table (tournament_id uuid, reg_id uuid, user_id uuid, nick text, bey text, parts jsonb,
               result int, pts int, pts_lost int)
language sql stable security definer set search_path = public as $$
  select m.tournament_id, r.id, r.user_id, r.nick, s.bey,
         r.deck -> (case lower(s.bey) when lower(r.bey1) then 0 when lower(r.bey2) then 1 when lower(r.bey3) then 2 end),
         case when p.scorer_slot = 0 then 0 when p.scorer_slot = s.side then 1 else -1 end,
         case when p.scorer_slot = s.side then p.pts else 0 end,
         case when p.scorer_slot = 3 - s.side then p.pts else 0 end
    from public.points p
    join public.games g on g.id = p.game_id
    join public.matches m on m.id = g.match_id
    cross join lateral (values (1, m.p1_reg, p.p1_bey), (2, m.p2_reg, p.p2_bey)) s(side, reg, bey)
    join public.registrations r on r.id = s.reg
   where s.bey is not null and (p_tournament is null or m.tournament_id = p_tournament)
$$;
revoke execute on function public.bbx_battles(uuid) from public, anon, authenticated;

-- název dílu z decku: blade (u CX lock chip + main blade), ratchet, bit
create or replace function public.bbx_part_of(p_parts jsonb, p_kind text) returns text
language sql immutable set search_path = public as $$
  select case p_kind
    when 'blade'   then case when p_parts->>'type' = 'cx' then nullif(concat_ws(' ', p_parts->>'lock', p_parts->>'main'), '')
                             else p_parts->>'blade' end
    when 'ratchet' then p_parts->>'ratchet'
    when 'bit'     then p_parts->>'bit'
  end
$$;
revoke execute on function public.bbx_part_of(jsonb, text) from public, anon, authenticated;

-- ── vyhodnocení turnaje ─────────────────────────────────────────────
create or replace function public.tournament_report(p_tournament uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tournaments; res jsonb;
begin
  select * into t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Turnaj neexistuje.'; end if;
  if t.status <> 'finished' and not public.bbx_can_manage(t.id) then
    raise exception 'Vyhodnocení bude po skončení turnaje.';
  end if;
  with b as (select * from public.bbx_battles(p_tournament)),
  pr as (
    select k.kind, public.bbx_part_of(b.parts, k.kind) as name, b.reg_id, b.result
      from b cross join (values ('blade'), ('ratchet'), ('bit')) k(kind)
  ),
  part_rows as (
    select kind, name, count(*) as battles, count(distinct reg_id) as players,
           count(*) filter (where result = 1) as wins,
           row_number() over (partition by kind order by count(*) desc, count(*) filter (where result = 1) desc, name) as rn
      from pr where name is not null group by kind, name
  ),
  builds as (
    select bey, sum(pts) as points, count(*) as battles, count(*) filter (where result = 1) as wins,
           row_number() over (order by sum(pts) desc, count(*) filter (where result = 1) desc, count(*), bey) as rn
      from b group by bey
  ),
  build_players as (
    select bey, jsonb_agg(jsonb_build_object('nick', nick, 'user_id', user_id, 'points', points, 'battles', battles)
                          order by points desc, nick) as players
      from (select bey, reg_id, min(nick) as nick, min(user_id::text)::uuid as user_id, sum(pts) as points, count(*) as battles
              from b group by bey, reg_id) x
     group by bey
  )
  select jsonb_build_object(
    'battles', (select count(*) / 2 from b),
    'points',  (select coalesce(sum(pts), 0) from b),
    'parts', (select coalesce(jsonb_object_agg(kind, items), '{}') from (
        select kind, jsonb_agg(jsonb_build_object('name', name, 'battles', battles, 'players', players, 'wins', wins) order by rn) as items
          from part_rows where rn <= 3 group by kind) q),
    'builds', (select coalesce(jsonb_agg(jsonb_build_object('bey', bu.bey, 'points', bu.points, 'battles', bu.battles,
                                                              'wins', bu.wins, 'players', bp.players) order by bu.rn), '[]')
                 from builds bu join build_players bp on bp.bey = bu.bey where bu.rn <= 3)
  ) into res;
  return res;
end $$;

-- ── meta: žebříček buildů / bladů / ratchetů / bitů ze skončených turnajů ──
-- (testovací hráči z Testovacích nástrojů – bez účtu, nick „T-…“ – se nepočítají)
create or replace function public.meta_ranking(p_kind text default 'build', p_min int default 10, p_since timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_kind not in ('build','blade','ratchet','bit') then raise exception 'Neznámý druh: %.', p_kind; end if;
  return (
    with b as (
      select case when p_kind = 'build' then x.bey else public.bbx_part_of(x.parts, p_kind) end as name,
             x.result, x.pts, x.pts_lost, x.tournament_id, coalesce(x.user_id::text, lower(x.nick)) as who
        from public.bbx_battles() x
        join public.tournaments t on t.id = x.tournament_id
       where t.status = 'finished' and t.kind = 'tournament'
         and (p_since is null or t.finished_at >= p_since)
         and not (x.user_id is null and x.nick like 'T-%')
    ),
    g as (
      select name, count(*) as battles,
             count(*) filter (where result = 1) as wins, count(*) filter (where result = 0) as draws,
             count(*) filter (where result = -1) as losses,
             sum(pts) as points, sum(pts_lost) as points_lost,
             count(distinct who) as players, count(distinct tournament_id) as tournaments
        from b where name is not null group by name
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', name, 'battles', battles, 'wins', wins, 'draws', draws, 'losses', losses,
             'points', points, 'points_lost', points_lost, 'players', players, 'tournaments', tournaments,
             'win_rate', round(100.0 * wins / battles, 1), 'ppb', round(points::numeric / battles, 2))
           order by (wins::numeric / battles) desc, battles desc, name), '[]')
      from (select * from g where battles >= greatest(coalesce(p_min, 1), 1)
             order by (wins::numeric / battles) desc, battles desc limit 300) q
  );
end $$;

-- ── profil: jak se hráči daří s jednotlivými beyi a díly ──
create or replace function public.player_bey_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (
    select x.* from public.bbx_battles() x join public.tournaments t on t.id = x.tournament_id
     where x.user_id = p_user and (t.status = 'finished' or p_user = auth.uid())
  ),
  rows as (
    select k.kind, case when k.kind = 'build' then b.bey else public.bbx_part_of(b.parts, k.kind) end as name, b.result, b.pts, b.pts_lost
      from b cross join (values ('build'), ('blade'), ('ratchet'), ('bit')) k(kind)
  ),
  g as (
    select kind, name, count(*) as battles,
           count(*) filter (where result = 1) as wins, count(*) filter (where result = 0) as draws,
           count(*) filter (where result = -1) as losses, sum(pts) as points, sum(pts_lost) as points_lost
      from rows where name is not null group by kind, name
  )
  select coalesce(jsonb_object_agg(kind, items), '{}') from (
    select kind, jsonb_agg(jsonb_build_object('name', name, 'battles', battles, 'wins', wins, 'draws', draws,
                                              'losses', losses, 'points', points, 'points_lost', points_lost,
                                              'win_rate', round(100.0 * wins / battles, 1))
                           order by battles desc, wins desc, name) as items
      from g group by kind) q
$$;
