-- ════════════════════════════════════════════════════════════════════
--  28 – Pokladník a vstupné
--  • profiles.cashier: funkce Pokladník (mimo žebříček rolí), přiděluje admin – set_cashier
--  • tournaments.fee / entry_fee (Kč, nepovinné) / cashiers (kdo vybírá: pokladníci nebo organizátor turnaje)
--  • registrations.paid_at / paid_by: zaplacené vstupné – mění jen pay_set (pokladník turnaje, organizátor, admin)
--  • pay_list, cashier_list, checkin_lookup pustí i pokladníka, my_registration vrací paid_at
--  Spouštěj celé v Supabase SQL Editoru. Jde spustit opakovaně.
-- ════════════════════════════════════════════════════════════════════

-- ── funkce Pokladník ─────────────────────────────────────────────────
alter table public.profiles add column if not exists cashier boolean not null default false;

create or replace function public.bbx_protect_cashier() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.bbx_privileged() and new.cashier is distinct from old.cashier then
    raise exception 'Funkci pokladník přiděluje admin.';
  end if;
  return new;
end $$;
revoke execute on function public.bbx_protect_cashier() from public, anon, authenticated;
drop trigger if exists bbx_protect_cashier on public.profiles;
create trigger bbx_protect_cashier before update on public.profiles
  for each row execute function public.bbx_protect_cashier();

create or replace function public.set_cashier(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 3 then raise exception 'Funkci pokladník přiděluje admin.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Uživatel neexistuje.'; end if;
  if p_on and exists (select 1 from auth.users where id = p_user and coalesce(is_anonymous, false)) then
    raise exception 'Host (bez účtu) nemůže mít funkci.';
  end if;
  perform public.bbx_set_privileged();
  update public.profiles set cashier = p_on where id = p_user;
end $$;
revoke execute on function public.set_cashier(uuid, boolean) from public, anon;
grant execute on function public.set_cashier(uuid, boolean) to authenticated;

-- pokladníci pro výběr v editoru turnaje
create or replace function public.cashier_list() returns table (id uuid, nick text, avatar text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nick, p.avatar from public.profiles p
   where p.cashier and p.nick is not null and public.bbx_my_level() >= 2
   order by lower(p.nick)
$$;
revoke execute on function public.cashier_list() from public, anon;
grant execute on function public.cashier_list() to authenticated;

-- ── vstupné u turnaje ────────────────────────────────────────────────
alter table public.tournaments add column if not exists fee boolean not null default false;
alter table public.tournaments add column if not exists entry_fee int;
alter table public.tournaments add column if not exists cashiers uuid[] not null default '{}';
alter table public.tournaments drop constraint if exists tournaments_entry_fee_check;
alter table public.tournaments add constraint tournaments_entry_fee_check check (entry_fee is null or entry_fee between 1 and 100000);

-- bez vstupného nic; se vstupným jen pokladníci nebo organizátor turnaje, aspoň jeden
create or replace function public.bbx_fee_fields() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid := coalesce(new.created_by, auth.uid()); u uuid;
begin
  if not new.fee then
    new.entry_fee := null; new.cashiers := '{}';
    return new;
  end if;
  new.cashiers := array(select distinct x from unnest(coalesce(new.cashiers, '{}')) x where x is not null);
  if cardinality(new.cashiers) = 0 then raise exception 'Vyber, kdo bude vybírat vstupné.'; end if;
  if cardinality(new.cashiers) > 10 then raise exception 'Pokladníků může být nejvýš 10.'; end if;
  if tg_op = 'UPDATE' and new.cashiers is not distinct from old.cashiers then return new; end if;
  foreach u in array new.cashiers loop
    if u is distinct from owner and not exists (select 1 from public.profiles where id = u and cashier) then
      raise exception 'Vstupné může vybírat jen pokladník nebo organizátor turnaje.';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.bbx_fee_fields() from public, anon, authenticated;
drop trigger if exists bbx_fee_fields on public.tournaments;
create trigger bbx_fee_fields before insert or update of fee, entry_fee, cashiers on public.tournaments
  for each row execute function public.bbx_fee_fields();

-- ── zaplaceno u registrace ───────────────────────────────────────────
alter table public.registrations add column if not exists paid_at timestamptz;
alter table public.registrations add column if not exists paid_by uuid references auth.users(id) on delete set null;

create or replace function public.bbx_protect_paid() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.bbx_privileged() then
    if tg_op = 'INSERT' then new.paid_at := null; new.paid_by := null;
    else new.paid_at := old.paid_at; new.paid_by := old.paid_by;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_protect_paid() from public, anon, authenticated;
drop trigger if exists bbx_protect_paid on public.registrations;
create trigger bbx_protect_paid before insert or update on public.registrations
  for each row execute function public.bbx_protect_paid();

-- kdo smí zapisovat vstupné: pokladník turnaje, organizátor (řídí turnaj), admin
create or replace function public.bbx_can_cash(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.bbx_privileged() or exists (
    select 1 from public.tournaments t where t.id = p_tournament and t.fee
       and (auth.uid() = any(t.cashiers) or public.bbx_can_manage(t.id)))
$$;
revoke execute on function public.bbx_can_cash(uuid) from public, anon, authenticated;

create or replace function public.pay_set(p_tournament uuid, p_reg uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; r public.registrations;
begin
  select * into t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Turnaj neexistuje.'; end if;
  if not t.fee then raise exception 'Tenhle turnaj vstupné nemá.'; end if;
  if not public.bbx_can_cash(t.id) then raise exception 'Vstupné zapisuje pokladník turnaje nebo organizátor.'; end if;
  if t.status in ('finished', 'canceled') then raise exception 'Turnaj už skončil.'; end if;
  perform public.bbx_set_privileged();
  update public.registrations
     set paid_at = case when p_on then coalesce(paid_at, now()) end,
         paid_by = case when p_on then coalesce(paid_by, auth.uid()) end
   where id = p_reg and tournament_id = t.id returning * into r;
  if not found then raise exception 'Hráč v turnaji není.'; end if;
  return jsonb_build_object('reg', r.id, 'paid_at', r.paid_at);
end $$;
revoke execute on function public.pay_set(uuid, uuid, boolean) from public, anon;
grant execute on function public.pay_set(uuid, uuid, boolean) to authenticated;

create or replace function public.pay_list(p_tournament uuid)
returns table (reg uuid, paid_at timestamptz, paid_by_nick text)
language sql stable security definer set search_path = public as $$
  select r.id, r.paid_at, p.nick from public.registrations r left join public.profiles p on p.id = r.paid_by
   where r.tournament_id = p_tournament and public.bbx_can_cash(p_tournament)
$$;
revoke execute on function public.pay_list(uuid) from public, anon;
grant execute on function public.pay_list(uuid) to authenticated;

-- QR vstupenky načte i pokladník (pro zápis vstupného)
create or replace function public.checkin_lookup(p_tournament uuid, p_token uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r uuid;
begin
  if not (public.bbx_can_checkin(p_tournament) or public.bbx_can_cash(p_tournament)) then
    raise exception 'Registrace kontroluje judge nebo organizátor.';
  end if;
  select id into r from public.registrations where tournament_id = p_tournament and qr_token = p_token;
  if r is null then raise exception 'Vstupenka nepatří k tomuhle turnaji.'; end if;
  return r;
end $$;
grant execute on function public.checkin_lookup(uuid, uuid) to authenticated;

-- vstupenka: hráč vidí, jestli má zaplaceno
drop function if exists public.my_registration(uuid);
create or replace function public.my_registration(p_tournament uuid)
returns table (id uuid, tournament_id uuid, nick text, bey1 text, bey2 text, bey3 text, deck jsonb,
               qr_token uuid, status text, seed int, final_place int, created_at timestamptz, updated_at timestamptz,
               checked_in_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.tournament_id, r.nick, r.bey1, r.bey2, r.bey3, r.deck, r.qr_token, r.status, r.seed, r.final_place,
         r.created_at, r.updated_at, r.checked_in_at, r.paid_at
    from public.registrations r
   where r.tournament_id = p_tournament and r.user_id = auth.uid() and auth.uid() is not null
$$;
grant execute on function public.my_registration(uuid) to anon, authenticated;
