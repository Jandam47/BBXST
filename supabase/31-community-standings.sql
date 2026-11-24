-- ════════════════════════════════════════════════════════════════════
--  31 – Standings komunitního tréninku
--
--  community_standings(komunita, od kdy): pořadí hráčů jen ze soubojů na komunitních trénincích
--  té komunity (training_battles přes bbx_training_battles). Jen hráči s účtem (bez botů).
--  Vidí ho aktivní členové komunity a admini (3+). Pořadí si řadí klient (výhry / úspěšnost / body).
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.community_standings(p_community uuid, p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.communities;
begin
  select * into c from public.communities where id = p_community and status = 'approved';
  if c.id is null then raise exception 'Komunita neexistuje.'; end if;
  if public.bbx_my_level() < 3 and not exists (select 1 from public.community_members m
       where m.community_id = p_community and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'Standings tréninku vidí jen členové komunity.';
  end if;
  return jsonb_build_object(
    'community', jsonb_build_object('id', c.id, 'name', c.name),
    'trainings', (select count(distinct x.tournament_id) from public.bbx_training_battles(null, p_community) x
                   where p_since is null or x.created_at >= p_since),
    'players', (with b as (
        select x.* from public.bbx_training_battles(null, p_community) x
          join public.registrations r on r.id = x.reg_id
         where x.user_id is not null and not r.is_bot and (p_since is null or x.created_at >= p_since))
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', g.user_id, 'nick', coalesce(p.nick, g.nick), 'avatar', p.avatar,
               'battles', g.battles, 'wins', g.wins, 'draws', g.draws, 'losses', g.losses,
               'points', g.points, 'points_lost', g.points_lost, 'xtreme', g.xtreme,
               'trainings', g.trainings, 'opponents', g.opponents, 'last', g.last,
               'win_rate', round(100.0 * g.wins / nullif(g.battles, 0), 1))
             order by g.wins desc, g.points - g.points_lost desc, g.battles), '[]'::jsonb)
        from (select user_id, min(nick) as nick, count(*) as battles,
                     count(*) filter (where result = 1) as wins, count(*) filter (where result = 0) as draws,
                     count(*) filter (where result = -1) as losses,
                     coalesce(sum(pts), 0) as points, coalesce(sum(pts_lost), 0) as points_lost,
                     count(*) filter (where result = 1 and finish = 'xtreme') as xtreme,
                     count(distinct tournament_id) as trainings, count(distinct opp_nick) as opponents,
                     max(created_at) as last
                from b group by user_id) g
        left join public.profiles p on p.id = g.user_id));
end $$;
revoke execute on function public.community_standings(uuid, timestamptz) from public, anon;
