-- ════════════════════════════════════════════════════════════════════
--  38: Kraj u turnaje a ligy
--  tournaments.region / leagues.region (stejné kraje jako profiles.region).
--  Ligový turnaj dostane kraj ligy automaticky (trigger bbx_tournament_region); změna kraje ligy
--  (league_save) ho přepíše i jejím turnajům. Komunitní trénink dostane kraj komunity.
--  tournament_list, league_list, league_detail vrací i kraj. Idempotentní.
-- ════════════════════════════════════════════════════════════════════

alter table public.tournaments add column if not exists region text;
alter table public.leagues     add column if not exists region text;
alter table public.tournaments drop constraint if exists tournaments_region_chk;
alter table public.tournaments add constraint tournaments_region_chk check (region is null or region in (
  'Hlavní město Praha','Středočeský','Jihočeský','Plzeňský','Karlovarský','Ústecký',
  'Liberecký','Královéhradecký','Pardubický','Vysočina','Jihomoravský','Olomoucký',
  'Zlínský','Moravskoslezský','Zahraničí'));
alter table public.leagues drop constraint if exists leagues_region_chk;
alter table public.leagues add constraint leagues_region_chk check (region is null or region in (
  'Hlavní město Praha','Středočeský','Jihočeský','Plzeňský','Karlovarský','Ústecký',
  'Liberecký','Královéhradecký','Pardubický','Vysočina','Jihomoravský','Olomoucký',
  'Zlínský','Moravskoslezský','Zahraničí'));
create index if not exists tournaments_region on public.tournaments (region);

-- ligový turnaj = kraj ligy; komunitní trénink = kraj komunity (když ho mají)
create or replace function public.bbx_tournament_region() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if new.league_id is not null then
    select region into r from public.leagues where id = new.league_id;
    if r is not null then new.region := r; end if;
  elsif new.community_id is not null and new.region is null then
    select region into r from public.communities where id = new.community_id;
    if r is not null and r in ('Hlavní město Praha','Středočeský','Jihočeský','Plzeňský','Karlovarský','Ústecký',
        'Liberecký','Královéhradecký','Pardubický','Vysočina','Jihomoravský','Olomoucký','Zlínský','Moravskoslezský','Zahraničí')
    then new.region := r; end if;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_tournament_region() from public, anon, authenticated;
drop trigger if exists bbx_tournament_region on public.tournaments;
create trigger bbx_tournament_region before insert or update of league_id, region, community_id on public.tournaments
  for each row execute function public.bbx_tournament_region();

-- ── liga s krajem ──
drop function if exists public.league_save(uuid, text, text, jsonb, boolean);
create or replace function public.league_save(p_id uuid, p_name text, p_description text default null,
                                              p_scoring jsonb default null, p_active boolean default true,
                                              p_region text default null) returns uuid
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
    insert into public.leagues (name, description, scoring, active, created_by, region)
    values (btrim(p_name), nullif(btrim(p_description), ''), sc, coalesce(p_active, true), auth.uid(), nullif(p_region, '')) returning id into lid;
  else
    update public.leagues set name = btrim(p_name), description = nullif(btrim(p_description), ''), scoring = sc,
           active = coalesce(p_active, true), region = nullif(p_region, '') where id = p_id returning id into lid;
    if lid is null then raise exception 'Liga neexistuje.'; end if;
    -- turnaje ligy převezmou nový kraj
    if nullif(p_region, '') is not null then
      perform public.bbx_set_privileged();
      update public.tournaments set region = p_region where league_id = lid and region is distinct from p_region;
    end if;
  end if;
  return lid;
end $$;
grant execute on function public.league_save(uuid, text, text, jsonb, boolean, text) to authenticated;

create or replace function public.league_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'active')::boolean desc, x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('id', l.id, 'name', l.name, 'description', l.description, 'active', l.active, 'region', l.region,
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
                                 'active', l.active, 'created_at', l.created_at, 'region', l.region),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('user', p.id, 'nick', p.nick, 'avatar', p.avatar, 'role', s.role)
                          order by s.role, p.nick)
                         from public.league_staff s join public.profiles p on p.id = s.user_id where s.league_id = l.id), '[]'::jsonb),
    'tournaments', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'starts_at', t.starts_at,
                          'status', t.status, 'location', t.location, 'region', t.region,
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

-- ── přehled turnajů s krajem (z 23 + region) ──
drop function if exists public.tournament_list();
create or replace function public.tournament_list() returns table (
  id uuid, kind text, name text, description text, location text, starts_at timestamptz, ends_at timestamptz,
  status text, swiss_rounds int, top_cut int, arena_count int, current_round int, max_players int,
  created_by uuid, organizer_nick text, players bigint, finished_at timestamptz, event_type text, community text,
  league_id uuid, league text, meeting_mode text, visibility text, region text)
language sql stable security definer set search_path = public as $$
  select t.id, t.kind, t.name, t.description, t.location, t.starts_at, t.ends_at, t.status, t.swiss_rounds, t.top_cut,
         t.arena_count, t.current_round, t.max_players, t.created_by, p.nick,
         (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'active'), t.finished_at,
         t.event_type, (select c.name from public.communities c where c.id = t.community_id),
         t.league_id, (select l.name from public.leagues l where l.id = t.league_id), t.meeting_mode, t.visibility, t.region
    from public.tournaments t left join public.profiles p on p.id = t.created_by
   where public.bbx_can_see(t.visibility, t.created_by)
   order by case t.status when 'swiss' then 0 when 'topcut' then 0 when 'show' then 0 when 'registration' then 1 else 2 end,
            case when t.status in ('finished','canceled') then null else t.starts_at end asc nulls last,
            t.starts_at desc nulls last
$$;
grant execute on function public.tournament_list() to anon, authenticated;
