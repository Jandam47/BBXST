-- ════════════════════════════════════════════════════════════════════
--  21 – prezence, hlášení chyb z telefonů, záloha dat, vzájemná bilance
--  • registrations.checked_in_at – prezence před startem (sken vstupenky / odškrtnutí v Řízení),
--    RPC checkin, checkin_list, drop_noshows; my_registration vrací i checked_in_at.
--  • client_errors – chyby z BBXU a BBXST (log_client_error, i bez účtu), admini je čtou v profilu.
--  • export_backup – celá databáze jako JSON pro hlavního admina, backup_status (připomínka po 14 dnech).
--  • player_h2h – vzájemná bilance „Ty vs hráč“ a nejčastější soupeři.
--  Spouštěj celé v Supabase SQL Editoru. Jde spustit opakovaně.
-- ════════════════════════════════════════════════════════════════════

-- ── PREZENCE ─────────────────────────────────────────────────────────
alter table public.registrations add column if not exists checked_in_at timestamptz;

-- prezenci mění jen RPC (hráč si ji sám odškrtnout nesmí)
create or replace function public.bbx_protect_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.bbx_privileged() then
    if tg_op = 'INSERT' then new.checked_in_at := null;
    else new.checked_in_at := old.checked_in_at; end if;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_protect_checkin() from public, anon, authenticated;
drop trigger if exists bbx_protect_checkin on public.registrations;
create trigger bbx_protect_checkin before insert or update on public.registrations
  for each row execute function public.bbx_protect_checkin();

-- smí řídit prezenci: organizátor turnaje, admin, nebo judge
create or replace function public.bbx_can_checkin(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.bbx_privileged() or public.bbx_can_manage(p_tournament) or public.bbx_my_level() >= 1
$$;
revoke execute on function public.bbx_can_checkin(uuid) from public, anon, authenticated;

create or replace function public.checkin(p_tournament uuid, p_token uuid default null, p_reg uuid default null,
                                          p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; r public.registrations; was timestamptz;
begin
  select * into t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Turnaj neexistuje.'; end if;
  if not public.bbx_can_checkin(t.id) then raise exception 'Prezenci zapisuje judge nebo organizátor.'; end if;
  if t.status in ('finished', 'canceled') then raise exception 'Turnaj už skončil.'; end if;
  if p_token is not null then
    select * into r from public.registrations where tournament_id = t.id and qr_token = p_token;
    if not found then raise exception 'Vstupenka nepatří k tomuhle turnaji.'; end if;
  else
    select * into r from public.registrations where tournament_id = t.id and id = p_reg;
    if not found then raise exception 'Hráč v turnaji není.'; end if;
  end if;
  was := r.checked_in_at;
  perform public.bbx_set_privileged();
  update public.registrations set checked_in_at = case when p_on then coalesce(checked_in_at, now()) end
   where id = r.id returning * into r;
  return jsonb_build_object('reg', r.id, 'nick', r.nick, 'status', r.status,
                            'checked_in_at', r.checked_in_at, 'already', p_on and was is not null);
end $$;
grant execute on function public.checkin(uuid, uuid, uuid, boolean) to authenticated;

create or replace function public.checkin_list(p_tournament uuid)
returns table (reg uuid, checked_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.checked_in_at from public.registrations r
   where r.tournament_id = p_tournament and public.bbx_can_checkin(p_tournament)
$$;
grant execute on function public.checkin_list(uuid) to authenticated;

-- před startem: kdo nemá prezenci, odstoupí (vrací počet)
create or replace function public.drop_noshows(p_tournament uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n int;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'registration' then raise exception 'Turnaj už běží.'; end if;
  update public.registrations set status = 'dropped'
   where tournament_id = t.id and status = 'active' and checked_in_at is null and not coalesce(is_bot, false);
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.drop_noshows(uuid) to authenticated;

drop function if exists public.my_registration(uuid);
create or replace function public.my_registration(p_tournament uuid)
returns table (id uuid, tournament_id uuid, nick text, bey1 text, bey2 text, bey3 text, deck jsonb,
               qr_token uuid, status text, seed int, final_place int, created_at timestamptz, updated_at timestamptz,
               checked_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.tournament_id, r.nick, r.bey1, r.bey2, r.bey3, r.deck, r.qr_token, r.status, r.seed, r.final_place,
         r.created_at, r.updated_at, r.checked_in_at
    from public.registrations r
   where r.tournament_id = p_tournament and r.user_id = auth.uid() and auth.uid() is not null
$$;
grant execute on function public.my_registration(uuid) to anon, authenticated;

-- ── CHYBY Z TELEFONŮ ─────────────────────────────────────────────────
create table if not exists public.client_errors (
  id        bigserial primary key,
  app       text not null default 'bbxu' check (app in ('bbxu', 'bbxst')),
  message   text not null,
  stack     text,
  url       text,
  ua        text,
  version   text,
  sig       text not null,
  user_id   uuid references auth.users(id) on delete set null,
  count     int  not null default 1,
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now(),
  resolved  boolean not null default false
);
create index if not exists client_errors_open on public.client_errors (sig) where not resolved;
create index if not exists client_errors_at on public.client_errors (last_at desc);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

create or replace function public.log_client_error(p_app text, p_message text, p_stack text default null,
                                                   p_url text default null, p_ua text default null,
                                                   p_version text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s text; m text := left(btrim(coalesce(p_message, '')), 500); st text := left(p_stack, 4000);
begin
  if m = '' then return; end if;
  if p_app not in ('bbxu', 'bbxst') then return; end if;
  -- stejná chyba (aplikace + text + první řádek stacku) se jen počítá
  s := md5(p_app || '|' || m || '|' || coalesce(split_part(st, E'\n', 2), ''));
  update public.client_errors set count = count + 1, last_at = now(),
         url = coalesce(left(p_url, 300), url), version = coalesce(left(p_version, 40), version),
         user_id = coalesce(auth.uid(), user_id)
   where sig = s and not resolved;
  if found then return; end if;
  -- pojistka proti zahlcení: nejvýš 60 nových chyb za 10 minut
  if (select count(*) from public.client_errors where first_at > now() - interval '10 minutes') >= 60 then return; end if;
  insert into public.client_errors (app, message, stack, url, ua, version, sig, user_id)
  values (p_app, m, st, left(p_url, 300), left(p_ua, 300), left(p_version, 40), s, auth.uid());
end $$;
grant execute on function public.log_client_error(text, text, text, text, text, text) to anon, authenticated;

create or replace function public.client_error_list(p_resolved boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 3 then raise exception 'Chyby vidí jen admini.'; end if;
  return coalesce((select jsonb_agg(x order by x->>'last_at' desc) from (
    select jsonb_build_object('id', e.id, 'app', e.app, 'message', e.message, 'stack', e.stack, 'url', e.url,
             'ua', e.ua, 'version', e.version, 'count', e.count, 'first_at', e.first_at, 'last_at', e.last_at,
             'user', (select jsonb_build_object('id', p.id, 'nick', p.nick) from public.profiles p where p.id = e.user_id)) as x
      from public.client_errors e where e.resolved = p_resolved
     order by e.last_at desc limit 100) q), '[]'::jsonb);
end $$;
grant execute on function public.client_error_list(boolean) to authenticated;

-- p_id null = vyřešit všechny
create or replace function public.client_error_resolve(p_id bigint default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if public.bbx_my_level() < 3 then raise exception 'Chyby řeší jen admini.'; end if;
  update public.client_errors set resolved = true where not resolved and (p_id is null or id = p_id);
  get diagnostics n = row_count;
  delete from public.client_errors where resolved and last_at < now() - interval '60 days';
  return n;
end $$;
grant execute on function public.client_error_resolve(bigint) to authenticated;

create or replace function public.client_error_count() returns int
language sql stable security definer set search_path = public as $$
  select case when public.bbx_my_level() >= 3 then (select count(*)::int from public.client_errors where not resolved) else 0 end
$$;
grant execute on function public.client_error_count() to authenticated;

-- ── ZÁLOHA ───────────────────────────────────────────────────────────
-- všechny veřejné tabulky kromě tajných nastavení a technických front
create or replace function public.export_backup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; rows jsonb; tabs jsonb := '{}'::jsonb; cnt jsonb := '{}'::jsonb;
begin
  if public.bbx_my_level() < 4 then raise exception 'Zálohu stahuje jen hlavní admin.'; end if;
  for r in select tablename from pg_tables
            where schemaname = 'public'
              and tablename not in ('bbx_settings', 'push_subscriptions', 'push_outbox', 'client_errors')
            order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', r.tablename) into rows;
    tabs := tabs || jsonb_build_object(r.tablename, rows);
    cnt := cnt || jsonb_build_object(r.tablename, jsonb_array_length(rows));
  end loop;
  insert into public.bbx_settings (key, value) values ('last_backup', now()::text)
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('app', 'BBXU', 'format', 1, 'created_at', now(), 'counts', cnt, 'tables', tabs);
end $$;
grant execute on function public.export_backup() to authenticated;

create or replace function public.backup_status() returns timestamptz
language plpgsql stable security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 4 then return null; end if;
  return (select value::timestamptz from public.bbx_settings where key = 'last_backup');
end $$;
grant execute on function public.backup_status() to authenticated;

-- ── VZÁJEMNÁ BILANCE ─────────────────────────────────────────────────
-- opponents = nejčastější soupeři hráče p_user (jen hráči s účtem), vs_me = já proti p_user
create or replace function public.player_h2h(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select m.id, m.tournament_id, m.finished_at, m.best_of, m.p1_wins, m.p2_wins, m.p1_score, m.p2_score,
           m.winner_reg = me.id as won,
           case when m.p1_reg = me.id then 1 else 2 end as side,
           o.user_id as opp_user, t.name as t_name
      from public.registrations me
      join public.matches m on me.id in (m.p1_reg, m.p2_reg) and m.status = 'done' and not m.is_bye
      join public.registrations o on o.id = case when m.p1_reg = me.id then m.p2_reg else m.p1_reg end
      join public.tournaments t on t.id = m.tournament_id and t.status <> 'canceled'
     where me.user_id = p_user and o.user_id is not null and o.user_id <> p_user
  )
  select jsonb_build_object(
    'opponents', coalesce((select jsonb_agg(x order by (x->>'matches')::int desc, (x->>'wins')::int desc) from (
        select jsonb_build_object('user', mi.opp_user, 'nick', p.nick, 'avatar', p.avatar,
                 'matches', count(*), 'wins', count(*) filter (where mi.won),
                 'losses', count(*) filter (where not mi.won), 'last_at', max(mi.finished_at)) as x
          from mine mi join public.profiles p on p.id = mi.opp_user and p.nick is not null
         group by mi.opp_user, p.nick, p.avatar
         order by count(*) desc, count(*) filter (where mi.won) desc limit 8) q), '[]'::jsonb),
    'vs_me', case when auth.uid() is not null and auth.uid() <> p_user then jsonb_build_object(
        'wins',   (select count(*) from mine where opp_user = auth.uid() and not won),
        'losses', (select count(*) from mine where opp_user = auth.uid() and won),
        'recent', coalesce((select jsonb_agg(x order by x->>'finished_at' desc) from (
            select jsonb_build_object('tournament_id', mi.tournament_id, 'tournament', mi.t_name,
                     'finished_at', mi.finished_at, 'won', not mi.won, 'best_of', mi.best_of,
                     'my',  case when mi.side = 1 then (case when mi.best_of > 1 then mi.p2_wins else mi.p2_score end)
                                                else (case when mi.best_of > 1 then mi.p1_wins else mi.p1_score end) end,
                     'opp', case when mi.side = 1 then (case when mi.best_of > 1 then mi.p1_wins else mi.p1_score end)
                                                else (case when mi.best_of > 1 then mi.p2_wins else mi.p2_score end) end) as x
              from mine mi where mi.opp_user = auth.uid() order by mi.finished_at desc limit 5) q), '[]'::jsonb))
    end)
$$;
grant execute on function public.player_h2h(uuid) to anon, authenticated;
