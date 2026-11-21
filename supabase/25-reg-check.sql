-- ════════════════════════════════════════════════════════════════════
--  25 – kontrola registrací (Hráči → organizátor zkontroluje QR + beyblady)
--  • checkin_lookup(turnaj, token): najde registraci podle QR vstupenky, nic nemění (otevře se kontrola).
--  • Když hráč po kontrole změní beyblady, kontrola se zruší (musí se zkontrolovat znovu).
--  Kontrola = registrations.checked_in_at (z 21). Spouštěj celé v Supabase SQL Editoru. Jde spustit opakovaně.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.checkin_lookup(p_tournament uuid, p_token uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r uuid;
begin
  if not public.bbx_can_checkin(p_tournament) then raise exception 'Registrace kontroluje judge nebo organizátor.'; end if;
  select id into r from public.registrations where tournament_id = p_tournament and qr_token = p_token;
  if r is null then raise exception 'Vstupenka nepatří k tomuhle turnaji.'; end if;
  return r;
end $$;
grant execute on function public.checkin_lookup(uuid, uuid) to authenticated;

create or replace function public.bbx_protect_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.bbx_privileged() then
    if tg_op = 'INSERT' then new.checked_in_at := null;
    else
      new.checked_in_at := old.checked_in_at;
      -- jiné beyblady = kontrola neplatí
      if new.deck is distinct from old.deck then new.checked_in_at := null; end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_protect_checkin() from public, anon, authenticated;
