-- ════════════════════════════════════════════════════════════════════
--  36: Stats – soutěžní statistiky místo achievementů (Stats ladder v kolečku Hráči, stats v profilu)
--
--  Počítadla (hodnota na hráče, vede nejvyšší):
--    breakdancer   = Spin finish dané          game_over  = Over finish dané
--    glueless      = Burst finish dané         xtreme     = Xtreme finish dané
--    tableflip     = vyhraná hra, ve které hráč prohrával o 5+ bodů
--    no_time       = vyhraná hra 7:0 (soupeř bez bodu, hra se souboji – ne kontumace)
--    streak        = Série: nejdelší řada vyhraných zápasů za sebou (bez volných losů)
--    draws         = King of draws: remízy v soubojích
--    iron_law      = Iron law: odjudgované zápasy (jako player_judged, bez zápasů jen testovacích „T-…“)
--    rickety       = Rickety: kolikrát hráčův bey dostal Burst (rozpadl se)
--    no_rod        = No rod???: turnaje odehrané bez Wizard Rod v decku
--  Rekordy (seznam her): blitz = Blitzkrieg (nejrychlejší hry), tyt = T.Y.T. (nejdelší hry).
--    Délka hry = od načtení zápasu / konce předchozí hry v BBXST do odeslání; jen hry ze BBXST
--    (aspoň 3 souboje), 15 s – 3 h. Blitzkrieg drží vítěz hry, T.Y.T. oba hráči.
--
--  Zdroj: jen skončené turnaje (i ligové), sezóna = rok data turnaje (od 1. ledna), null = celkem.
--  Hráči: jen účty (bez hostů, botů, testovacích „T-…“), kdo má v Soukromí „Nebýt ve Standings“, chybí
--  ostatním (sám sebe vidí). Filtr kraje (profiles.region) a ligy (tournaments.league_id).
--  Komunitní ladder: community_stats_ladder – jen souboje z tréninků komunity (počítadla endů, remízy,
--  rickety, tableflip, no_time), vidí aktivní členové a admin 3+.
--  Idempotentní.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.bbx_stat_tournaments(p_season int, p_league uuid)
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select t.id from public.tournaments t
   where t.kind = 'tournament' and t.status = 'finished'
     and (p_season is null or extract(year from coalesce(t.starts_at, t.created_at))::int = p_season)
     and (p_league is null or t.league_id = p_league)
$$;
revoke execute on function public.bbx_stat_tournaments(int, uuid) from public, anon, authenticated;

-- hodnoty počítadel pro všechny hráče s účtem
create or replace function public.bbx_stat_values(p_season int, p_league uuid)
returns table (user_id uuid, key text, value int)
language sql stable security definer set search_path = public as $$
  with t as (select id from public.bbx_stat_tournaments(p_season, p_league)),
  m as (select m.* from public.matches m where m.tournament_id in (select id from t) and m.status = 'done'),
  ru as (select r.id, r.user_id from public.registrations r
          where r.tournament_id in (select id from t) and r.user_id is not null and not r.is_bot),
  g as (select g.*, m.p1_reg, m.p2_reg from public.games g join m on m.id = g.match_id),
  pt as (select p.game_id, p.seq, p.scorer_slot, p.pts, p.finish, g.p1_reg, g.p2_reg from public.points p join g on g.id = p.game_id),
  fin as (select case when scorer_slot = 1 then p1_reg else p2_reg end as win_reg,
                 case when scorer_slot = 1 then p2_reg else p1_reg end as lose_reg, finish
            from pt where scorer_slot in (1, 2) and finish is not null),
  run as (select game_id,
                 sum(case when scorer_slot = 1 then pts else 0 end) over w
               - sum(case when scorer_slot = 2 then pts else 0 end) over w as d
            from pt window w as (partition by game_id order by seq rows unbounded preceding)),
  flips as (select case when g.winner_slot = 1 then g.p1_reg else g.p2_reg end as reg
              from g join run on run.game_id = g.id
             group by g.id, g.winner_slot, g.p1_reg, g.p2_reg
            having (g.winner_slot = 1 and min(run.d) <= -5) or (g.winner_slot = 2 and max(run.d) >= 5)),
  clean as (select case when g.winner_slot = 1 then g.p1_reg else g.p2_reg end as reg from g
             where (case when g.winner_slot = 1 then g.p2_score else g.p1_score end) = 0
               and greatest(g.p1_score, g.p2_score) >= 7
               and exists (select 1 from public.points p where p.game_id = g.id)),
  draws as (select p1_reg as reg from pt where scorer_slot = 0 union all select p2_reg from pt where scorer_slot = 0),
  mres as (select r.user_id, m.id, m.finished_at, (m.winner_reg = r.id) as won
             from m join ru r on r.id in (m.p1_reg, m.p2_reg) where not m.is_bye),
  streak as (select user_id, max(cnt)::int as v from (
               select user_id, count(*) as cnt from (
                 select user_id, won,
                        row_number() over (partition by user_id order by finished_at, id)
                      - row_number() over (partition by user_id, won order by finished_at, id) as grp
                   from mres) x
                where won group by user_id, grp) y group by user_id),
  judged as (select g.judge_id as user_id, count(distinct g.match_id)::int as v
               from g left join public.registrations a on a.id = g.p1_reg left join public.registrations b on b.id = g.p2_reg
              where g.judge_id is not null
                and not (coalesce(a.user_id is null and a.nick like 'T-%', true) and coalesce(b.user_id is null and b.nick like 'T-%', true))
              group by g.judge_id),
  norod as (select r.user_id, count(*)::int as v from public.registrations r
             where r.tournament_id in (select id from t) and r.user_id is not null and not r.is_bot
               and exists (select 1 from m where r.id in (m.p1_reg, m.p2_reg))
               and not (coalesce(r.bey1, '') ilike 'wizard rod%' or coalesce(r.bey2, '') ilike 'wizard rod%' or coalesce(r.bey3, '') ilike 'wizard rod%')
             group by r.user_id)
  select ru.user_id, case f.finish when 'spin' then 'breakdancer' when 'over' then 'game_over'
                                   when 'burst' then 'glueless' else 'xtreme' end, count(*)::int
    from fin f join ru on ru.id = f.win_reg group by 1, 2
  union all select ru.user_id, 'rickety', count(*)::int from fin f join ru on ru.id = f.lose_reg where f.finish = 'burst' group by 1
  union all select ru.user_id, 'tableflip', count(*)::int from flips x join ru on ru.id = x.reg group by 1
  union all select ru.user_id, 'no_time', count(*)::int from clean x join ru on ru.id = x.reg group by 1
  union all select ru.user_id, 'draws', count(*)::int from draws x join ru on ru.id = x.reg group by 1
  union all select user_id, 'streak', v from streak
  union all select user_id, 'iron_law', v from judged
  union all select user_id, 'no_rod', v from norod
$$;
revoke execute on function public.bbx_stat_values(int, uuid) from public, anon, authenticated;

-- hry pro rekordy (Blitzkrieg / T.Y.T.)
create or replace function public.bbx_stat_games(p_season int, p_league uuid)
returns table (game_id uuid, tournament_id uuid, t_name text, played_at timestamptz, secs int,
               w_user uuid, l_user uuid, w_nick text, l_nick text, w_score int, l_score int)
language sql stable security definer set search_path = public as $$
  select g.id, t.id, t.name, g.created_at, extract(epoch from g.created_at - g.started_at)::int,
         rw.user_id, rl.user_id, coalesce(pw.nick, rw.nick), coalesce(plo.nick, rl.nick),
         case when g.winner_slot = 1 then g.p1_score else g.p2_score end,
         case when g.winner_slot = 1 then g.p2_score else g.p1_score end
    from public.games g
    join public.matches m on m.id = g.match_id and m.status = 'done' and not m.is_bye
    join public.tournaments t on t.id = m.tournament_id and t.id in (select id from public.bbx_stat_tournaments(p_season, p_league))
    join public.registrations rw on rw.id = case when g.winner_slot = 1 then m.p1_reg else m.p2_reg end
    join public.registrations rl on rl.id = case when g.winner_slot = 1 then m.p2_reg else m.p1_reg end
    left join public.profiles pw on pw.id = rw.user_id
    left join public.profiles plo on plo.id = rl.user_id
   where g.started_at is not null
     and extract(epoch from g.created_at - g.started_at) between 15 and 10800
     and (select count(*) from public.points p where p.game_id = g.id) >= 3
$$;
revoke execute on function public.bbx_stat_games(int, uuid) from public, anon, authenticated;

-- kdo se počítá do žebříčku (účet, ne skrytý, kraj)
create or replace function public.bbx_stat_players(p_region text)
returns table (id uuid, nick text, avatar text, region text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nick, p.avatar, p.region from public.profiles p join auth.users u on u.id = p.id
   where p.nick is not null and not coalesce(u.is_anonymous, false)
     and (p.id = auth.uid() or coalesce(p.privacy->>'standings', '') <> 'true')
     and (p_region is null or p.region = p_region)
$$;
revoke execute on function public.bbx_stat_players(text) from public, anon, authenticated;

create or replace function public.stat_seasons() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(y order by y desc), '[]'::jsonb) from (
    select distinct extract(year from coalesce(starts_at, created_at))::int as y
      from public.tournaments where kind = 'tournament' and status = 'finished') s
$$;
grant execute on function public.stat_seasons() to anon, authenticated;

-- ── Stats ladder (turnaje) ──
create or replace function public.stats_ladder(p_season int default null, p_region text default null,
                                               p_league uuid default null, p_limit int default 10) returns jsonb
language sql stable security definer set search_path = public as $$
  with lim as (select least(greatest(coalesce(p_limit, 10), 1), 50) as n),
  pl as (select * from public.bbx_stat_players(p_region)),
  r as (select v.key, v.value, pl.id, pl.nick, pl.avatar, pl.region,
               rank() over (partition by v.key order by v.value desc) as rk,
               row_number() over (partition by v.key order by v.value desc, pl.nick) as rn
          from public.bbx_stat_values(p_season, p_league) v join pl on pl.id = v.user_id where v.value > 0),
  gm as (select * from public.bbx_stat_games(p_season, p_league)),
  gj as (select jsonb_build_object('game', game_id, 'tournament_id', tournament_id, 'tournament', t_name, 'at', played_at,
                  'secs', secs, 'w_user', w_user, 'l_user', l_user, 'w_nick', w_nick, 'l_nick', l_nick,
                  'w_score', w_score, 'l_score', l_score) as j, secs, w_user, l_user from gm)
  select jsonb_build_object(
    'counters', coalesce((select jsonb_object_agg(key, rows) from (
        select key, jsonb_agg(jsonb_build_object('user', id, 'nick', nick, 'avatar', avatar, 'region', region,
                                                 'value', value, 'rank', rk) order by rk, nick) as rows
          from r where rn <= (select n from lim) group by key) q), '{}'::jsonb),
    'me', coalesce((select jsonb_object_agg(key, jsonb_build_object('value', value, 'rank', rk)) from r where id = auth.uid()), '{}'::jsonb),
    'blitz', coalesce((select jsonb_agg(j order by secs) from (
        select j, secs from gj where w_user in (select id from pl) order by secs limit (select n from lim)) q), '[]'::jsonb),
    'tyt', coalesce((select jsonb_agg(j order by secs desc) from (
        select j, secs from gj where w_user in (select id from pl) or l_user in (select id from pl)
         order by secs desc limit (select n from lim)) q), '[]'::jsonb))
$$;
grant execute on function public.stats_ladder(int, text, uuid, int) to anon, authenticated;

-- ── stats jednoho hráče (profil, player_stat_ranks): hodnoty + pořadí, umístění v rekordech (top 3) ──
drop function if exists public.player_stats(uuid, int);   -- jen pro jistotu: player_stats(uuid) je jiná funkce (profil)
create or replace function public.player_stat_ranks(p_user uuid, p_season int default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with pl as (select * from public.bbx_stat_players(null)),
  r as (select v.key, v.value, v.user_id, rank() over (partition by v.key order by v.value desc) as rk
          from public.bbx_stat_values(p_season, null) v
         where v.value > 0 and (v.user_id in (select id from pl) or v.user_id = p_user)),
  gm as (select * from public.bbx_stat_games(p_season, null)),
  fast as (select game_id, w_user, secs, rank() over (order by secs) as rk from gm where w_user in (select id from pl)),
  slow as (select game_id, w_user, l_user, secs, rank() over (order by secs desc) as rk
             from gm where w_user in (select id from pl) or l_user in (select id from pl))
  select jsonb_build_object(
    'values', coalesce((select jsonb_object_agg(key, jsonb_build_object('value', value,
                 'rank', case when p_user in (select id from pl) then rk end)) from r where user_id = p_user), '{}'::jsonb),
    'blitz', (select jsonb_build_object('rank', min(rk), 'secs', min(secs)) from fast where w_user = p_user and rk <= 3 having count(*) > 0),
    'tyt', (select jsonb_build_object('rank', min(rk), 'secs', max(secs)) from slow where p_user in (w_user, l_user) and rk <= 3 having count(*) > 0))
$$;
grant execute on function public.player_stat_ranks(uuid, int) to anon, authenticated;

-- ── komunitní stats ladder (jen tréninky komunity) ──
create or replace function public.community_stats_ladder(p_community uuid, p_season int default null, p_limit int default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.communities; lim int := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  select * into c from public.communities where id = p_community and status = 'approved';
  if c.id is null then raise exception 'Komunita neexistuje.'; end if;
  if public.bbx_my_level() < 3 and not exists (select 1 from public.community_members m
       where m.community_id = p_community and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'Komunitní stats vidí jen členové komunity.';
  end if;
  return (with b as (
      select x.* from public.bbx_training_battles(null, p_community) x
        join public.registrations r on r.id = x.reg_id
       where x.user_id is not null and not r.is_bot
         and (p_season is null or extract(year from x.created_at)::int = p_season)),
    run as (select b.*, sum(b.pts - b.pts_lost) over (partition by match_id, game_no, reg_id order by seq rows unbounded preceding) as d,
                   sum(b.pts) over (partition by match_id, game_no, reg_id) as own,
                   sum(b.pts_lost) over (partition by match_id, game_no, reg_id) as opp
              from b),
    games as (select user_id, match_id, game_no, min(d) as low, max(own) as own, max(opp) as opp
                from run group by user_id, match_id, game_no, reg_id),
    v as (
      select user_id, case finish when 'spin' then 'breakdancer' when 'over' then 'game_over'
                                  when 'burst' then 'glueless' else 'xtreme' end as key, count(*)::int as value
        from b where result = 1 and finish is not null group by 1, 2
      union all select user_id, 'rickety', count(*)::int from b where result = -1 and finish = 'burst' group by 1
      union all select user_id, 'draws', count(*)::int from b where result = 0 group by 1
      union all select user_id, 'tableflip', count(*)::int from games where own >= 7 and own > opp and low <= -5 group by 1
      union all select user_id, 'no_time', count(*)::int from games where own >= 7 and opp = 0 group by 1),
    pl as (select * from public.bbx_stat_players(null)),
    r as (select v.key, v.value, pl.id, pl.nick, pl.avatar, rank() over (partition by v.key order by v.value desc) as rk,
                 row_number() over (partition by v.key order by v.value desc, pl.nick) as rn
            from v join pl on pl.id = v.user_id where v.value > 0)
    select jsonb_build_object(
      'community', jsonb_build_object('id', c.id, 'name', c.name),
      'seasons', coalesce((select jsonb_agg(y order by y desc) from (
          select distinct extract(year from x.created_at)::int as y from public.bbx_training_battles(null, p_community) x) s), '[]'::jsonb),
      'counters', coalesce((select jsonb_object_agg(key, rows) from (
          select key, jsonb_agg(jsonb_build_object('user', id, 'nick', nick, 'avatar', avatar, 'value', value, 'rank', rk)
                                order by rk, nick) as rows
            from r where rn <= lim group by key) q), '{}'::jsonb),
      'me', coalesce((select jsonb_object_agg(key, jsonb_build_object('value', value, 'rank', rk)) from r where id = auth.uid()), '{}'::jsonb)));
end $$;
revoke execute on function public.community_stats_ladder(uuid, int, int) from public, anon;
grant execute on function public.community_stats_ladder(uuid, int, int) to authenticated;
