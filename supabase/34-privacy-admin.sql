-- ════════════════════════════════════════════════════════════════════
--  34: Soukromí v profilu + počty pro Správu (ozubené kolečko v profilu)
--  profiles.privacy = { beys, h2h, standings } (true = skryté před ostatními)
--    beys      – statistiky beyů a endy v profilu (player_bey_stats)
--    h2h       – nejčastější soupeři a vzájemná bilance v profilu (player_h2h)
--    standings – nebýt v seznamu Standings (players_list; sám sebe tam hráč vidí)
--  Výsledky turnajů, pavouk, pořadí a meta zůstávají veřejné.
--  admin_counts() – odznaky Správy (žádosti, nahlášení, chyby, záloha).
--  Idempotentní.
-- ════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists privacy jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_privacy_chk;
alter table public.profiles add constraint profiles_privacy_chk
  check (jsonb_typeof(privacy) = 'object' and pg_column_size(privacy) <= 400);

create or replace function public.bbx_private(p_user uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select privacy->>p_key = 'true' from public.profiles where id = p_user), false)
$$;
revoke execute on function public.bbx_private(uuid, text) from public, anon, authenticated;

-- ── statistiky beyů (z 11) + soukromí ──
create or replace function public.player_bey_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (
    select x.* from public.bbx_battles() x join public.tournaments t on t.id = x.tournament_id
     where x.user_id = p_user and (t.status = 'finished' or p_user = auth.uid())
       and (p_user = auth.uid() or not public.bbx_private(p_user, 'beys'))
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
  select coalesce((select jsonb_object_agg(kind, items) from (
    select kind, jsonb_agg(jsonb_build_object('name', name, 'battles', battles, 'wins', wins, 'draws', draws,
                                              'losses', losses, 'points', points, 'points_lost', points_lost,
                                              'win_rate', round(100.0 * wins / battles, 1))
                           order by battles desc, wins desc, name) as items
      from g group by kind) q), '{}')
  || jsonb_build_object('finishes', jsonb_build_object(
       'given', public.bbx_finish_counts((select jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts)) from b where result = 1)),
       'taken', public.bbx_finish_counts((select jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts_lost)) from b where result = -1))))
$$;

-- ── vzájemná bilance (z 21) + soukromí ──
create or replace function public.player_h2h(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select m.id, m.tournament_id, m.finished_at, m.best_of, m.p1_wins, m.p2_wins, m.p1_score, m.p2_score,
           m.winner_reg = me.id as won,
           case when m.p1_reg = me.id then 1 else 2 end as side,
           o.user_id as opp_user, t.name as t_name
      from public.registrations me
      join public.matches m on me.id in (m.p1_reg, m.p2_reg) and m.status = 'done' and not m.is_bye
      join public.registrations o on o.id = case when m.p1_reg = me.id then m.p2_reg else m.p1_reg end
      join public.tournaments t on t.id = m.tournament_id and t.status <> 'canceled'
     where me.user_id = p_user and o.user_id is not null and o.user_id <> p_user
       and (p_user = auth.uid() or not public.bbx_private(p_user, 'h2h'))
  )
  select jsonb_build_object(
    'opponents', coalesce((select jsonb_agg(x order by (x->>'matches')::int desc, (x->>'wins')::int desc) from (
        select jsonb_build_object('user', mi.opp_user, 'nick', p.nick, 'avatar', p.avatar,
                 'matches', count(*), 'wins', count(*) filter (where mi.won),
                 'losses', count(*) filter (where not mi.won), 'last_at', max(mi.finished_at)) as x
          from mine mi join public.profiles p on p.id = mi.opp_user and p.nick is not null
         group by mi.opp_user, p.nick, p.avatar
         order by count(*) desc, count(*) filter (where mi.won) desc limit 8) q), '[]'::jsonb),
    'vs_me', case when auth.uid() is not null and auth.uid() <> p_user then jsonb_build_object(
        'wins',   (select count(*) from mine where opp_user = auth.uid() and not won),
        'losses', (select count(*) from mine where opp_user = auth.uid() and won),
        'recent', coalesce((select jsonb_agg(x order by x->>'finished_at' desc) from (
            select jsonb_build_object('tournament_id', mi.tournament_id, 'tournament', mi.t_name,
                     'finished_at', mi.finished_at, 'won', not mi.won, 'best_of', mi.best_of,
                     'my',  case when mi.side = 1 then (case when mi.best_of > 1 then mi.p2_wins else mi.p2_score end)
                                                else (case when mi.best_of > 1 then mi.p1_wins else mi.p1_score end) end,
                     'opp', case when mi.side = 1 then (case when mi.best_of > 1 then mi.p1_wins else mi.p1_score end)
                                                else (case when mi.best_of > 1 then mi.p2_wins else mi.p2_score end) end) as x
              from mine mi where mi.opp_user = auth.uid() order by mi.finished_at desc limit 5) q), '[]'::jsonb))
    end)
$$;
grant execute on function public.player_h2h(uuid) to anon, authenticated;

-- ── Standings (z 10) + soukromí: skrytý hráč chybí všem kromě sebe ──
create or replace function public.players_list() returns table (
  id uuid, nick text, region text, avatar text, role text, rating int, created_at timestamptz,
  tournaments bigint, titles bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.nick, p.region, p.avatar, p.role, p.rating, p.created_at,
         (select count(*) from public.registrations r join public.tournaments t on t.id = r.tournament_id
           where r.user_id = p.id and t.kind = 'tournament' and t.status = 'finished'),
         (select count(*) from public.registrations r join public.tournaments t on t.id = r.tournament_id
           where r.user_id = p.id and r.final_place = 1 and t.kind = 'tournament')
    from public.profiles p join auth.users u on u.id = p.id
   where p.nick is not null and not coalesce(u.is_anonymous, false)
     and (p.id = auth.uid() or coalesce(p.privacy->>'standings', '') <> 'true')
   order by p.rating desc, p.nick
$$;

-- ── počty pro Správu (admin 3+; žádosti a záloha jen hlavní admin) ──
create or replace function public.admin_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l int := public.bbx_my_level();
begin
  if l < 3 then return null; end if;
  return jsonb_build_object(
    'requests', case when l >= 4 then (select count(*) from public.communities where status = 'pending') else 0 end,
    'reports',  (select count(distinct (kind, target)) from public.reports where status = 'open'),
    'errors',   (select count(*) from public.client_errors where not resolved),
    'backup_at', case when l >= 4 then (select value::timestamptz from public.bbx_settings where key = 'last_backup') end);
end $$;
revoke execute on function public.admin_counts() from public, anon;
grant execute on function public.admin_counts() to authenticated;
