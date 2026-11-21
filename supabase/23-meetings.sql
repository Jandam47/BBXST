-- ════════════════════════════════════════════════════════════════════
--  23 – meeting (osobně / online) a viditelnost akce
--  • tournaments.event_type 'meeting' + meeting_mode ('live' osobně / 'online'); u online je v location odkaz.
--  • tournaments.visibility: 'all' (všichni) / 'staff' (jen organizátoři+ a zakladatel) – jen u meetingu.
--    Hlídá čtení (RLS t_read), přehled tournament_list i přihlášky (bbx_reg_visibility).
--  Spouštěj celé v Supabase SQL Editoru. Jde spustit opakovaně.
-- ════════════════════════════════════════════════════════════════════

alter table public.tournaments drop constraint if exists t_event_type_chk;
alter table public.tournaments add  constraint t_event_type_chk
  check (event_type in ('training','fashion','other','community','meeting'));
alter table public.tournaments add column if not exists meeting_mode text;
alter table public.tournaments drop constraint if exists t_meeting_mode_chk;
alter table public.tournaments add  constraint t_meeting_mode_chk check (meeting_mode is null or meeting_mode in ('live','online'));
alter table public.tournaments add column if not exists visibility text not null default 'all';
alter table public.tournaments drop constraint if exists t_visibility_chk;
alter table public.tournaments add  constraint t_visibility_chk check (visibility in ('all','staff'));

-- meeting má vždy způsob; viditelnost a způsob jen u meetingu
create or replace function public.bbx_meeting_fields() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.kind = 'event' and new.event_type = 'meeting' then
    new.meeting_mode := coalesce(new.meeting_mode, 'live');
  else
    new.meeting_mode := null; new.visibility := 'all';
  end if;
  return new;
end $$;
revoke execute on function public.bbx_meeting_fields() from public, anon, authenticated;
drop trigger if exists bbx_meeting_fields on public.tournaments;
create trigger bbx_meeting_fields before insert or update on public.tournaments
  for each row execute function public.bbx_meeting_fields();

-- kdo akci vidí
create or replace function public.bbx_can_see(p_visibility text, p_created_by uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_visibility = 'all' or public.bbx_privileged() or public.bbx_my_level() >= 2
      or (auth.uid() is not null and p_created_by = auth.uid())
$$;
grant execute on function public.bbx_can_see(text, uuid) to anon, authenticated;

drop policy if exists t_read on public.tournaments;
create policy t_read on public.tournaments for select using (public.bbx_can_see(visibility, created_by));

-- na akci jen pro organizátory se nikdo jiný nepřihlásí
create or replace function public.bbx_reg_visibility() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text; c uuid;
begin
  if public.bbx_privileged() then return new; end if;
  select visibility, created_by into v, c from public.tournaments where id = new.tournament_id;
  if not public.bbx_can_see(coalesce(v, 'all'), c) then raise exception 'Akce neexistuje.'; end if;
  return new;
end $$;
revoke execute on function public.bbx_reg_visibility() from public, anon, authenticated;
drop trigger if exists bbx_reg_visibility on public.registrations;
create trigger bbx_reg_visibility before insert on public.registrations
  for each row execute function public.bbx_reg_visibility();

-- přehled akcí: navíc způsob meetingu a viditelnost, skryté akce jen pro ty, kdo je smí vidět
drop function if exists public.tournament_list();
create or replace function public.tournament_list() returns table (
  id uuid, kind text, name text, description text, location text, starts_at timestamptz, ends_at timestamptz,
  status text, swiss_rounds int, top_cut int, arena_count int, current_round int, max_players int,
  created_by uuid, organizer_nick text, players bigint, finished_at timestamptz, event_type text, community text,
  league_id uuid, league text, meeting_mode text, visibility text)
language sql stable security definer set search_path = public as $$
  select t.id, t.kind, t.name, t.description, t.location, t.starts_at, t.ends_at, t.status, t.swiss_rounds, t.top_cut,
         t.arena_count, t.current_round, t.max_players, t.created_by, p.nick,
         (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'active'), t.finished_at,
         t.event_type, (select c.name from public.communities c where c.id = t.community_id),
         t.league_id, (select l.name from public.leagues l where l.id = t.league_id), t.meeting_mode, t.visibility
    from public.tournaments t left join public.profiles p on p.id = t.created_by
   where public.bbx_can_see(t.visibility, t.created_by)
   order by case t.status when 'swiss' then 0 when 'topcut' then 0 when 'show' then 0 when 'registration' then 1 else 2 end,
            case when t.status in ('finished','canceled') then null else t.starts_at end asc nulls last,
            t.starts_at desc nulls last
$$;
grant execute on function public.tournament_list() to anon, authenticated;
