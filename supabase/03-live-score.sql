-- ════════════════════════════════════════════════════════════════════
--  BBXU – živé skóre rozehrané hry (pro TV rozpis a hráče)
--  Spusť v Supabase → SQL Editor. Jde spustit i opakovaně.
-- ════════════════════════════════════════════════════════════════════

alter table public.matches add column if not exists live_p1 int;
alter table public.matches add column if not exists live_p2 int;
alter table public.matches add column if not exists live_at timestamptz;

-- judge posílá z BBXST aktuální stav hry (p1/p2 podle databáze, ne podle stran stolu)
create or replace function public.live_score(p_match uuid, p_p1 int, p_p2 int) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.tournaments;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  perform public.bbx_require_judge(m.tournament_id);
  if m.status = 'done' then return; end if;
  select * into t from public.tournaments where id = m.tournament_id;
  if p_p1 < 0 or p_p2 < 0 or p_p1 > t.win_score or p_p2 > t.win_score then
    raise exception 'Neplatné skóre %:%.', p_p1, p_p2;
  end if;
  perform public.bbx_set_privileged();
  update public.matches
     set live_p1 = p_p1, live_p2 = p_p2, live_at = now(),
         status = case when status = 'pending' then 'live' else status end,
         judge_id = coalesce(judge_id, auth.uid()),
         started_at = coalesce(started_at, now())
   where id = p_match;
end $$;

-- po uložení hry, dohrání nebo vrácení zápasu živé skóre zmizí
create or replace function public.bbx_clear_live() returns trigger
language plpgsql as $$
begin
  if new.status = 'done'
     or (new.p1_wins + new.p2_wins) <> (old.p1_wins + old.p2_wins)
     or (new.status = 'pending' and old.status <> 'pending') then
    new.live_p1 := null; new.live_p2 := null; new.live_at := null;
  end if;
  return new;
end $$;
drop trigger if exists matches_clear_live on public.matches;
create trigger matches_clear_live before update on public.matches
  for each row execute function public.bbx_clear_live();
