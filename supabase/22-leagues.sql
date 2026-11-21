-- ════════════════════════════════════════════════════════════════════
--  22 – ligy
--  • leagues – zakládá hlavní admin (název, popis, bodování v jsonb, aktivní / archiv).
--  • league_staff – správce ligy (jmenuje hlavní admin) a organizátoři, kteří smí zakládat ligové turnaje
--    (povoluje hlavní admin, admin ve všech ligách, správce ve své lize). Obojí jen pro organizátory+.
--  • tournaments.league_id – ligový turnaj (vybírá se v editoru; hlídá trigger bbx_protect_league).
--  • Bodování (výchozí): účast 1, postup ze swissu do top cutu +1, 4. místo +1, 3. +2, 2. +3, 1. +5.
--    Bilance: zápasy V–P a body +/− ze všech zápasů v ligových turnajích (bez volných losů).
--    Počítají se jen skončené turnaje; hráči bez účtu podle nicku, testovací „T-…“ bez účtu ne.
--  Spouštěj celé v Supabase SQL Editoru. Jde spustit opakovaně.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 60),
  description text check (char_length(description) <= 1000),
  scoring     jsonb not null default '{"participation":1,"topcut":1,"p1":5,"p2":3,"p3":2,"p4":1}',
  active      boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists leagues_name on public.leagues (lower(btrim(name)));
alter table public.leagues enable row level security;
drop policy if exists l_read on public.leagues;
create policy l_read on public.leagues for select using (true);
revoke insert, update, delete on public.leagues from anon, authenticated;

create table if not exists public.league_staff (
  league_id  uuid not null references public.leagues(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('manager', 'organizer')),
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
alter table public.league_staff enable row level security;
drop policy if exists ls_read on public.league_staff;
create policy ls_read on public.league_staff for select using (true);
revoke insert, update, delete on public.league_staff from anon, authenticated;

alter table public.tournaments add column if not exists league_id uuid references public.leagues(id) on delete set null;
create index if not exists tournaments_league on public.tournaments (league_id) where league_id is not null;

-- ── práva ────────────────────────────────────────────────────────────
create or replace function public.bbx_league_role(p_league uuid) returns text
language sql stable security definer set search_path = public as $$
  -- '' = žádná role (ne null – aby podmínky „= 'manager'“ nikdy nevracely null)
  select coalesce((select role from public.league_staff where league_id = p_league and user_id = auth.uid()), '')
$$;
revoke execute on function public.bbx_league_role(uuid) from public, anon, authenticated;

-- smí zakládat ligové turnaje: admin+, nebo organizátor+ zapsaný u ligy (správce i organizátor)
create or replace function public.bbx_league_can(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.bbx_privileged() or public.bbx_my_level() >= 3
      or (public.bbx_my_level() >= 2 and public.bbx_league_role(p_league) <> ''
          and exists (select 1 from public.leagues where id = p_league and active))
$$;
revoke execute on function public.bbx_league_can(uuid) from public, anon, authenticated;

-- ligu u turnaje mění jen ten, kdo do ligy smí (hlídá i přímý update tabulky z editoru)
create or replace function public.bbx_protect_league() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.bbx_privileged() then return new; end if;
  if tg_op = 'UPDATE' and new.league_id is not distinct from old.league_id then return new; end if;
  if new.league_id is not null and new.kind <> 'tournament' then
    raise exception 'Ligový může být jen turnaj, ne akce.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'finished' and public.bbx_my_level() < 3 then
    raise exception 'U skončeného turnaje mění ligu jen admin.';
  end if;
  if new.league_id is not null and not public.bbx_league_can(new.league_id) then
    raise exception 'Do téhle ligy nemůžeš zakládat turnaje.';
  end if;
  if tg_op = 'UPDATE' and old.league_id is not null and not public.bbx_league_can(old.league_id) then
    raise exception 'Turnaj z ligy může vyřadit jen její správce, organizátor ligy nebo admin.';
  end if;
  return new;
end $$;
revoke execute on function public.bbx_protect_league() from public, anon, authenticated;
drop trigger if exists bbx_protect_league on public.tournaments;
create trigger bbx_protect_league before insert or update of league_id, kind on public.tournaments
  for each row execute function public.bbx_protect_league();

-- ── správa lig ───────────────────────────────────────────────────────
create or replace function public.league_save(p_id uuid, p_name text, p_description text default null,
                                              p_scoring jsonb default null, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare lid uuid; sc jsonb; k text;
begin
  if public.bbx_my_level() < 4 then raise exception 'Ligy zakládá hlavní admin.'; end if;
  sc := '{"participation":1,"topcut":1,"p1":5,"p2":3,"p3":2,"p4":1}'::jsonb;
  if p_scoring is not null then
    foreach k in array array['participation','topcut','p1','p2','p3','p4'] loop
      if p_scoring ? k then
        if jsonb_typeof(p_scoring->k) <> 'number' or (p_scoring->>k)::numeric < 0 or (p_scoring->>k)::numeric > 100
           or (p_scoring->>k)::numeric <> trunc((p_scoring->>k)::numeric) then
          raise exception 'Body musí být celé číslo 0–100.';
        end if;
        sc := sc || jsonb_build_object(k, (p_scoring->>k)::int);
      end if;
    end loop;
  end if;
  if exists (select 1 from public.leagues where lower(btrim(name)) = lower(btrim(p_name)) and id is distinct from p_id) then
    raise exception 'Liga s tímhle názvem už existuje.';
  end if;
  if p_id is null then
    insert into public.leagues (name, description, scoring, active, created_by)
    values (btrim(p_name), nullif(btrim(p_description), ''), sc, coalesce(p_active, true), auth.uid()) returning id into lid;
  else
    update public.leagues set name = btrim(p_name), description = nullif(btrim(p_description), ''), scoring = sc,
           active = coalesce(p_active, true) where id = p_id returning id into lid;
    if lid is null then raise exception 'Liga neexistuje.'; end if;
  end if;
  return lid;
end $$;
grant execute on function public.league_save(uuid, text, text, jsonb, boolean) to authenticated;

-- smazání: turnaje zůstanou, jen přestanou být ligové
create or replace function public.league_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 4 then raise exception 'Ligy maže hlavní admin.'; end if;
  perform public.bbx_set_privileged();
  delete from public.leagues where id = p_id;
end $$;
grant execute on function public.league_delete(uuid) to authenticated;

-- p_role: 'manager' | 'organizer' | null (odebrat)
-- správce jmenuje hlavní admin; organizátora hlavní admin, admin nebo správce té ligy
create or replace function public.league_staff_set(p_league uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare cur text; lvl int := public.bbx_my_level(); tlvl int;
begin
  if not exists (select 1 from public.leagues where id = p_league) then raise exception 'Liga neexistuje.'; end if;
  if p_role is not null and p_role not in ('manager', 'organizer') then raise exception 'Neznámá role.'; end if;
  select role into cur from public.league_staff where league_id = p_league and user_id = p_user;
  if 'manager' in (coalesce(p_role, ''), coalesce(cur, '')) then
    if lvl < 4 then raise exception 'Správce ligy jmenuje hlavní admin.'; end if;
  elsif not (lvl >= 3 or public.bbx_league_role(p_league) = 'manager') then
    raise exception 'Organizátory ligy přidává její správce nebo admin.';
  end if;
  if p_role is null then
    delete from public.league_staff where league_id = p_league and user_id = p_user;
    return;
  end if;
  select public.bbx_role_level(role) into tlvl from public.profiles where id = p_user;
  if coalesce(tlvl, 0) < 2 then raise exception 'Nejdřív mu dej funkci organizátor.'; end if;
  insert into public.league_staff (league_id, user_id, role) values (p_league, p_user, p_role)
  on conflict (league_id, user_id) do update set role = excluded.role;
end $$;
grant execute on function public.league_staff_set(uuid, uuid, text) to authenticated;

-- ── tabulka ──────────────────────────────────────────────────────────
create or replace function public.bbx_league_table(p_league uuid)
returns table (pkey text, user_id uuid, nick text, avatar text, points int, events int, topcuts int,
               wins int, losses int, plus int, minus int, best int, results jsonb)
language sql stable security definer set search_path = public as $$
  with lg as (select scoring sc from public.leagues where id = p_league),
  ts as (
    select t.id, t.name, t.starts_at, t.finished_at,
           exists (select 1 from public.matches m where m.tournament_id = t.id and m.stage <> 'swiss') as has_cut
      from public.tournaments t
     where t.league_id = p_league and t.status = 'finished' and t.kind = 'tournament'
  ),
  regs as (
    select r.id, r.tournament_id, coalesce(r.user_id::text, 'n:' || lower(btrim(r.nick))) as pkey, r.user_id, r.nick,
           r.final_place, (ts.has_cut and r.seed is not null) as cut, ts.name as t_name,
           coalesce(ts.starts_at, ts.finished_at) as t_at
      from public.registrations r join ts on ts.id = r.tournament_id
     where r.final_place is not null and not (r.user_id is null and r.nick like 'T-%')
  ),
  mt as (
    select rg.id as reg,
           count(*) filter (where m.winner_reg = rg.id) as w,
           count(*) filter (where m.loser_reg = rg.id) as l,
           coalesce(sum(case when m.p1_reg = rg.id then m.p1_score else m.p2_score end), 0) as pf,
           coalesce(sum(case when m.p1_reg = rg.id then m.p2_score else m.p1_score end), 0) as pa
      from regs rg join public.matches m on rg.id in (m.p1_reg, m.p2_reg) and m.status = 'done' and not m.is_bye
     group by rg.id
  ),
  scored as (
    select rg.*, coalesce(mt.w, 0)::int as w, coalesce(mt.l, 0)::int as l, coalesce(mt.pf, 0)::int as pf, coalesce(mt.pa, 0)::int as pa,
           (coalesce((lg.sc->>'participation')::int, 0)
            + case when rg.cut then coalesce((lg.sc->>'topcut')::int, 0) else 0 end
            + case rg.final_place when 1 then coalesce((lg.sc->>'p1')::int, 0) when 2 then coalesce((lg.sc->>'p2')::int, 0)
                                  when 3 then coalesce((lg.sc->>'p3')::int, 0) when 4 then coalesce((lg.sc->>'p4')::int, 0) else 0 end)::int as pts
      from regs rg cross join lg left join mt on mt.reg = rg.id
  )
  select s.pkey, (array_agg(s.user_id) filter (where s.user_id is not null))[1],
         coalesce(max(p.nick), (array_agg(s.nick order by s.t_at desc))[1]), max(p.avatar),
         sum(s.pts)::int, count(*)::int, count(*) filter (where s.cut)::int,
         sum(s.w)::int, sum(s.l)::int, sum(s.pf)::int, sum(s.pa)::int, min(s.final_place)::int,
         jsonb_agg(jsonb_build_object('tournament_id', s.tournament_id, 'name', s.t_name, 'at', s.t_at, 'place', s.final_place,
                   'points', s.pts, 'cut', s.cut, 'wins', s.w, 'losses', s.l, 'plus', s.pf, 'minus', s.pa) order by s.t_at desc)
    from scored s left join public.profiles p on p.id = s.user_id
   group by s.pkey
$$;
revoke execute on function public.bbx_league_table(uuid) from public, anon, authenticated;

create or replace function public.league_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'active')::boolean desc, x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('id', l.id, 'name', l.name, 'description', l.description, 'active', l.active,
             'tournaments', (select count(*) from public.tournaments t where t.league_id = l.id and t.status <> 'canceled'),
             'finished', (select count(*) from public.tournaments t where t.league_id = l.id and t.status = 'finished'),
             'players', (select count(*) from public.bbx_league_table(l.id)),
             'leader', (select jsonb_build_object('nick', b.nick, 'avatar', b.avatar, 'points', b.points)
                          from public.bbx_league_table(l.id) b
                         order by b.points desc, b.wins desc, (b.plus - b.minus) desc, b.plus desc limit 1),
             'manager', (select jsonb_build_object('id', p.id, 'nick', p.nick) from public.league_staff s
                           join public.profiles p on p.id = s.user_id where s.league_id = l.id and s.role = 'manager' limit 1),
             'my_role', nullif(public.bbx_league_role(l.id), '')) as x
      from public.leagues l) q
$$;
grant execute on function public.league_list() to anon, authenticated;

create or replace function public.league_detail(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when l.id is null then null else jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'name', l.name, 'description', l.description, 'scoring', l.scoring,
                                 'active', l.active, 'created_at', l.created_at),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('user', p.id, 'nick', p.nick, 'avatar', p.avatar, 'role', s.role)
                          order by s.role, p.nick)
                         from public.league_staff s join public.profiles p on p.id = s.user_id where s.league_id = l.id), '[]'::jsonb),
    'tournaments', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'starts_at', t.starts_at,
                          'status', t.status, 'location', t.location,
                          'players', (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'active'),
                          'winner', (select r.nick from public.registrations r where r.tournament_id = t.id and r.final_place = 1 limit 1))
                          order by coalesce(t.starts_at, t.created_at) desc)
                         from public.tournaments t where t.league_id = l.id and t.status <> 'canceled'), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(jsonb_build_object('key', b.pkey, 'user', b.user_id, 'nick', b.nick, 'avatar', b.avatar,
                          'points', b.points, 'events', b.events, 'topcuts', b.topcuts, 'wins', b.wins, 'losses', b.losses,
                          'plus', b.plus, 'minus', b.minus, 'best', b.best, 'results', b.results)
                          order by b.points desc, b.wins desc, (b.plus - b.minus) desc, b.plus desc, lower(b.nick))
                         from public.bbx_league_table(l.id) b), '[]'::jsonb),
    'can', jsonb_build_object('edit', public.bbx_my_level() >= 4,
                              'organizers', public.bbx_my_level() >= 3 or public.bbx_league_role(l.id) = 'manager',
                              'create', public.bbx_league_can(l.id) and l.active))
  end
  from (select 1) d left join public.leagues l on l.id = p_id
$$;
grant execute on function public.league_detail(uuid) to anon, authenticated;

-- ligy, do kterých smím zakládat turnaje (editor turnaje)
create or replace function public.my_leagues() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.name), '[]'::jsonb)
    from public.leagues l where l.active and public.bbx_league_can(l.id)
$$;
grant execute on function public.my_leagues() to authenticated;

-- profil: ligové role hráče (pro správu) a umístění v ligách
create or replace function public.player_leagues(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(jsonb_build_object('league', l.id, 'name', l.name, 'active', l.active,
                 'role', (select s.role from public.league_staff s where s.league_id = l.id and s.user_id = p_user),
                 'can_org', public.bbx_my_level() >= 3 or public.bbx_league_role(l.id) = 'manager',
                 'can_mgr', public.bbx_my_level() >= 4) order by l.active desc, l.name)
               from public.leagues l), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(x order by x->>'name') from (
        select jsonb_build_object('league', l.id, 'name', l.name, 'active', l.active, 'points', b.points, 'events', b.events,
                 'rank', (select count(*) + 1 from public.bbx_league_table(l.id) o
                           where o.points > b.points
                              or (o.points = b.points and o.wins > b.wins)
                              or (o.points = b.points and o.wins = b.wins and (o.plus - o.minus) > (b.plus - b.minus))),
                 'of', (select count(*) from public.bbx_league_table(l.id))) as x
          from public.leagues l cross join lateral public.bbx_league_table(l.id) b
         where b.user_id = p_user) q), '[]'::jsonb))
$$;
grant execute on function public.player_leagues(uuid) to anon, authenticated;

-- přehled akcí: navíc liga
drop function if exists public.tournament_list();
create or replace function public.tournament_list() returns table (
  id uuid, kind text, name text, description text, location text, starts_at timestamptz, ends_at timestamptz,
  status text, swiss_rounds int, top_cut int, arena_count int, current_round int, max_players int,
  created_by uuid, organizer_nick text, players bigint, finished_at timestamptz, event_type text, community text,
  league_id uuid, league text)
language sql stable security definer set search_path = public as $$
  select t.id, t.kind, t.name, t.description, t.location, t.starts_at, t.ends_at, t.status, t.swiss_rounds, t.top_cut,
         t.arena_count, t.current_round, t.max_players, t.created_by, p.nick,
         (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'active'), t.finished_at,
         t.event_type, (select c.name from public.communities c where c.id = t.community_id),
         t.league_id, (select l.name from public.leagues l where l.id = t.league_id)
    from public.tournaments t left join public.profiles p on p.id = t.created_by
   order by case t.status when 'swiss' then 0 when 'topcut' then 0 when 'show' then 0 when 'registration' then 1 else 2 end,
            case when t.status in ('finished','canceled') then null else t.starts_at end asc nulls last,
            t.starts_at desc nulls last
$$;
grant execute on function public.tournament_list() to anon, authenticated;
