-- ════════════════════════════════════════════════════════════════════
--  24 – počítadlo judgování na profilu
--  player_judged(p_user): kolik zápasů hráč odjudgoval (zapsal aspoň jednu hru – games.judge_id)
--  a v kolika turnajích. Nepočítají se zrušené turnaje ani zápasy jen testovacích hráčů „T-…“ bez účtu
--  (testovací nástroje). Spouštěj celé v Supabase SQL Editoru. Jde spustit opakovaně.
-- ════════════════════════════════════════════════════════════════════
create index if not exists games_judge on public.games (judge_id) where judge_id is not null;

create or replace function public.player_judged(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with jm as (
    select distinct m.id, m.tournament_id
      from public.games g
      join public.matches m on m.id = g.match_id
      join public.tournaments t on t.id = m.tournament_id and t.status <> 'canceled'
      left join public.registrations a on a.id = m.p1_reg
      left join public.registrations b on b.id = m.p2_reg
     where g.judge_id = p_user
       and not (coalesce(a.user_id is null and a.nick like 'T-%', true) and coalesce(b.user_id is null and b.nick like 'T-%', true))
  )
  select jsonb_build_object('matches', (select count(*) from jm), 'tournaments', (select count(distinct tournament_id) from jm))
$$;
grant execute on function public.player_judged(uuid) to anon, authenticated;
