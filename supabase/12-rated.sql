-- ════════════════════════════════════════════════════════════════════
--  12 – Turnaj se (ne)započítává do hráčského ratingu
--
--  tournaments.rated (výchozí true = jako dosud). Když je vypnuté, výsledky
--  zápasů se ukládají normálně, jen bbx_apply_rating rating hráčů nemění.
--  Po startu turnaje se přepínač nedá změnit (hlídá bbx_protect_tournament).
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

alter table public.tournaments add column if not exists rated boolean not null default true;

create or replace function public.bbx_apply_rating(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches; uw uuid; ul uuid; rw int; rl int; ew float; d int;
begin
  select * into m from public.matches where id = p_match;
  if not coalesce((select rated from public.tournaments where id = m.tournament_id), true) then return; end if;
  select user_id into uw from public.registrations where id = m.winner_reg;
  select user_id into ul from public.registrations where id = m.loser_reg;
  if uw is null or ul is null or uw = ul then return; end if;
  select rating into rw from public.profiles where id = uw;
  select rating into rl from public.profiles where id = ul;
  if rw is null or rl is null then return; end if;
  ew := 1.0 / (1.0 + power(10.0, (rl - rw) / 400.0));
  d := greatest(1, round(32 * (1 - ew))::int);
  perform public.bbx_set_privileged();
  update public.profiles set rating = rw + d where id = uw;
  update public.profiles set rating = rl - d where id = ul;
  insert into public.rating_history (user_id, match_id, rating, delta) values (uw, m.id, rw + d, d), (ul, m.id, rl - d, -d);
end $$;
revoke execute on function public.bbx_apply_rating(uuid) from public, anon, authenticated;

-- přepínač ratingu jde změnit jen před startem
create or replace function public.bbx_protect_tournament() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.bbx_privileged() then
    if tg_op = 'INSERT' then
      new.status := 'registration'; new.current_round := 0; new.fashion := null;
      new.started_at := null; new.finished_at := null; new.created_by := auth.uid();
      if new.kind <> 'event' then new.event_type := 'training'; end if;
    else
      if new.status is distinct from old.status or new.current_round is distinct from old.current_round
         or new.created_by is distinct from old.created_by or new.started_at is distinct from old.started_at
         or new.finished_at is distinct from old.finished_at or new.fashion is distinct from old.fashion then
        raise exception 'Stav turnaje se mění jen přes ovládání turnaje.';
      end if;
      if old.status not in ('registration') and (new.swiss_rounds <> old.swiss_rounds or new.win_score <> old.win_score
         or new.kind <> old.kind or new.format <> old.format or new.unique_parts <> old.unique_parts
         or new.event_type <> old.event_type or new.fashion_beys <> old.fashion_beys or new.rated <> old.rated) then
        raise exception 'Po startu nejde měnit formát, počet kol, body na výhru, rating ani pravidla decku.';
      end if;
      if (new.event_type <> old.event_type or new.fashion_beys <> old.fashion_beys or new.kind <> old.kind)
         and exists (select 1 from public.registrations where tournament_id = old.id) then
        raise exception 'Druh akce a počet beyů jde změnit, jen dokud se nikdo nepřihlásil.';
      end if;
    end if;
  end if;
  return new;
end $$;
