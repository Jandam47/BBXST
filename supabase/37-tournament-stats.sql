-- ════════════════════════════════════════════════════════════════════
--  37: Stats jednoho turnaje – kdo v které kategorii turnaj vyhrál (záložka Vyhodnocení)
--  Stejné staty jako 36 (bez No rod???), ale jen z tohoto turnaje a na úrovni registrace:
--  počítají se i hráči bez účtu (nick z registrace), ne boti a ne testovací „T-…“ bez účtu.
--  Iron law = judge (účet) s nejvíc zápasy v turnaji. Shoda = víc vítězů. Blitzkrieg / T.Y.T. = nejrychlejší /
--  nejdelší hra turnaje (jen ze BBXST, ≥ 3 souboje, 15 s – 3 h).
--  Vidí každý po skončení turnaje, organizátor i během (náhled). Idempotentní.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.tournament_stats(p_tournament uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournament;
  if t.id is null then raise exception 'Turnaj neexistuje.'; end if;
  if t.status <> 'finished' and not public.bbx_can_manage(t.id) then return null; end if;
  return (with
    regs as (select r.id, r.user_id, coalesce(p.nick, r.nick) as nick, p.avatar
               from public.registrations r left join public.profiles p on p.id = r.user_id
              where r.tournament_id = p_tournament and not r.is_bot
                and not (r.user_id is null and r.nick like 'T-%')),
    m as (select * from public.matches where tournament_id = p_tournament and status = 'done'),
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
    mres as (select r.id as reg, m.id, m.finished_at, (m.winner_reg = r.id) as won
               from m join regs r on r.id in (m.p1_reg, m.p2_reg) where not m.is_bye),
    streak as (select reg, max(cnt)::int as v from (
                 select reg, count(*) as cnt from (
                   select reg, won,
                          row_number() over (partition by reg order by finished_at, id)
                        - row_number() over (partition by reg, won order by finished_at, id) as grp
                     from mres) x
                  where won group by reg, grp) y group by reg),
    v as (  -- (klíč, hodnota, hráč) – hráč = registrace, u Iron law judge
      select case f.finish when 'spin' then 'breakdancer' when 'over' then 'game_over'
                           when 'burst' then 'glueless' else 'xtreme' end as key, count(*)::int as value,
             r.user_id, r.nick, r.avatar
        from fin f join regs r on r.id = f.win_reg group by 1, r.id, r.user_id, r.nick, r.avatar
      union all select 'rickety', count(*)::int, r.user_id, r.nick, r.avatar
        from fin f join regs r on r.id = f.lose_reg where f.finish = 'burst' group by r.id, r.user_id, r.nick, r.avatar
      union all select 'tableflip', count(*)::int, r.user_id, r.nick, r.avatar
        from flips x join regs r on r.id = x.reg group by r.id, r.user_id, r.nick, r.avatar
      union all select 'no_time', count(*)::int, r.user_id, r.nick, r.avatar
        from clean x join regs r on r.id = x.reg group by r.id, r.user_id, r.nick, r.avatar
      union all select 'draws', count(*)::int, r.user_id, r.nick, r.avatar
        from draws x join regs r on r.id = x.reg group by r.id, r.user_id, r.nick, r.avatar
      union all select 'streak', s.v, r.user_id, r.nick, r.avatar from streak s join regs r on r.id = s.reg
      union all select 'iron_law', count(distinct g.match_id)::int, p.id, p.nick, p.avatar
        from g join public.profiles p on p.id = g.judge_id group by p.id, p.nick, p.avatar),
    best as (select key, max(value) as top from v where value > 0 group by key),
    gm as (select g.id, extract(epoch from g.created_at - g.started_at)::int as secs,
                  rw.user_id as w_user, coalesce(pw.nick, rw.nick) as w_nick, rl.user_id as l_user, coalesce(plo.nick, rl.nick) as l_nick,
                  case when g.winner_slot = 1 then g.p1_score else g.p2_score end as w_score,
                  case when g.winner_slot = 1 then g.p2_score else g.p1_score end as l_score
             from g
             join public.registrations rw on rw.id = case when g.winner_slot = 1 then g.p1_reg else g.p2_reg end
             join public.registrations rl on rl.id = case when g.winner_slot = 1 then g.p2_reg else g.p1_reg end
             left join public.profiles pw on pw.id = rw.user_id
             left join public.profiles plo on plo.id = rl.user_id
             join m on m.id = g.match_id and not m.is_bye
            where g.started_at is not null
              and extract(epoch from g.created_at - g.started_at) between 15 and 10800
              and (select count(*) from public.points p where p.game_id = g.id) >= 3
              and not (rw.user_id is null and rw.nick like 'T-%' and rl.user_id is null and rl.nick like 'T-%')),
    gj as (select jsonb_build_object('secs', secs, 'w_user', w_user, 'w_nick', w_nick, 'l_user', l_user, 'l_nick', l_nick,
                                     'w_score', w_score, 'l_score', l_score) as j, secs from gm)
    select jsonb_build_object(
      'stats', coalesce((select jsonb_object_agg(b.key, jsonb_build_object('value', b.top,
                 'winners', (select jsonb_agg(jsonb_build_object('user', v.user_id, 'nick', v.nick, 'avatar', v.avatar) order by v.nick)
                               from v where v.key = b.key and v.value = b.top))) from best b), '{}'::jsonb),
      'blitz', (select j from gj order by secs limit 1),
      'tyt', (select j from gj order by secs desc limit 1)));
end $$;
grant execute on function public.tournament_stats(uuid) to anon, authenticated;
