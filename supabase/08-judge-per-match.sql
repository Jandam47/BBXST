-- ════════════════════════════════════════════════════════════════════
--  BBXU – judge patří jen k zápasu, pořadí na arénách, obsazení volných arén
--  Spusť v Supabase → SQL Editor. Jde spustit i opakovaně.
--
--  • Arény se už nezabírají dopředu. Judge = matches.judge_id rozehraného
--    zápasu; po dohrání zápasu, PASS JUDGE nebo uvolnění organizátorem je volný.
--  • Fronta arény: rozehraný zápas první, pak čekající podle pořadí. Zápas hráče,
--    který zrovna judguje jiný rozehraný zápas, se posune o jedno místo níž
--    (stejné pravidlo je v js/core.js → arenaQueue).
--  • rebalance_arenas: organizátor přesune čekající zápasy z přeplněných arén
--    na volné.
-- ════════════════════════════════════════════════════════════════════

-- staré zabrané arény už nic neznamenají
delete from public.arena_judges;

-- načtení zápasu v BBXST = převzetí zápasu (bez zabírání arény)
create or replace function public.start_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  perform public.bbx_require_judge(m.tournament_id);
  if m.status = 'done' then raise exception 'Zápas už je dohraný.'; end if;
  perform public.bbx_set_privileged();
  update public.matches set status = 'live', judge_id = auth.uid(), started_at = coalesce(started_at, now()) where id = m.id;
end $$;

-- hráč tohoto zápasu právě judguje jiný rozehraný zápas
create or replace function public.bbx_match_busy(m public.matches) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matches lm
      join public.registrations r on r.user_id = lm.judge_id
     where lm.tournament_id = m.tournament_id and lm.status = 'live' and lm.id <> m.id
       and r.id in (m.p1_reg, m.p2_reg))
$$;
revoke execute on function public.bbx_match_busy(public.matches) from public, anon, authenticated;

-- fronta arény ve stejném pořadí jako v BBXU (rozehraný první, zaneprázdněný hráč o místo níž)
create or replace function public.judge_arena_queue(p_tournament uuid, p_arena int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.bbx_require_judge(p_tournament);
  return coalesce((
    select jsonb_agg(public.bbx_match_json(q.m) order by q.live desc, q.k)
      from (select m, m.status = 'live' as live,
                   (row_number() over (partition by m.status = 'live' order by m.wave, m.pos, m.created_at))
                   + case when m.status <> 'live' and public.bbx_match_busy(m) then 1.5 else 0 end as k
              from public.matches m
             where m.tournament_id = p_tournament and m.arena = p_arena and m.status <> 'done'
               and m.p1_reg is not null and m.p2_reg is not null) q), '[]'::jsonb);
end $$;

-- obsadit volné arény zápasy z arén, kde jich čeká víc
create or replace function public.rebalance_arenas(p_tournament uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; moved int := 0; idle int; donor int; mid uuid;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status not in ('swiss', 'topcut') then raise exception 'Turnaj teď neběží.'; end if;
  perform public.bbx_set_privileged();
  loop
    select a into idle from generate_series(1, t.arena_count) a
     where not exists (select 1 from public.matches m
                        where m.tournament_id = t.id and m.arena = a and m.status <> 'done'
                          and m.p1_reg is not null and m.p2_reg is not null)
     order by a limit 1;
    exit when idle is null;
    select m.arena into donor from public.matches m
     where m.tournament_id = t.id and m.arena is not null and m.status <> 'done'
       and m.p1_reg is not null and m.p2_reg is not null
     group by m.arena
    having count(*) >= 2 and count(*) filter (where m.status = 'pending') >= 1
     order by count(*) desc, m.arena limit 1;
    exit when donor is null;
    select id into mid from public.matches
     where tournament_id = t.id and arena = donor and status = 'pending' and p1_reg is not null and p2_reg is not null
     order by wave desc, pos desc limit 1;
    update public.matches set arena = idle, wave = 1 where id = mid;
    moved := moved + 1;
    idle := null; donor := null;
  end loop;
  return moved;
end $$;
