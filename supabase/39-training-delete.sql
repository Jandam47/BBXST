-- ════════════════════════════════════════════════════════════════════
--  39: Smazání archivovaného komunitního tréninku
--  training_delete(trénink): jen skončený / zrušený komunitní trénink, smí leader / zástupce komunity
--  nebo admin 3+. Smaže trénink i s registracemi, výzvami, souboji a pozvánkami (on delete cascade),
--  takže zmizí z historie, comb, mety komunity, Standings komunity i komunitního Stats ladderu. Idempotentní.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.training_delete(p_tournament uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournament;
  if t.id is null then raise exception 'Trénink neexistuje.'; end if;
  if t.event_type is distinct from 'community' then raise exception 'Takhle jde smazat jen komunitní trénink.'; end if;
  if t.status not in ('finished', 'canceled') then raise exception 'Smazat jde jen skončený nebo zrušený trénink.'; end if;
  if not (public.bbx_my_level() >= 3 or public.bbx_comm_lead(t.community_id)) then
    raise exception 'Trénink smí smazat leader nebo zástupce komunity.';
  end if;
  perform public.bbx_set_privileged();
  delete from public.tournaments where id = p_tournament;
  return t.community_id;
end $$;
revoke execute on function public.training_delete(uuid) from public, anon;
grant execute on function public.training_delete(uuid) to authenticated;
