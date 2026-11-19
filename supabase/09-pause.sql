-- ════════════════════════════════════════════════════════════════════
--  BBXU – pauza turnaje s odpočtem
--  Organizátor v Řízení vyhlásí pauzu na N minut; Můj Status, záhlaví
--  turnaje i TV rozpis ukazují PAUZA a odpočet do tournaments.pause_until.
--  Spusť v Supabase → SQL Editor. Jde spustit i opakovaně.
-- ════════════════════════════════════════════════════════════════════

alter table public.tournaments add column if not exists pause_until timestamptz;

-- p_minutes > 0 = pauza do teď + N minut, 0 / null = konec pauzy
create or replace function public.set_pause(p_tournament uuid, p_minutes int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; until timestamptz;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status not in ('registration', 'swiss', 'topcut') then raise exception 'Turnaj neběží.'; end if;
  if p_minutes is not null and (p_minutes < 0 or p_minutes > 240) then raise exception 'Pauza může mít 1 až 240 minut.'; end if;
  until := case when coalesce(p_minutes, 0) > 0 then now() + make_interval(mins => p_minutes) end;
  perform public.bbx_set_privileged();
  update public.tournaments set pause_until = until where id = t.id;
  return until;
end $$;
