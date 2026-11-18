-- ════════════════════════════════════════════════════════════════════
--  BBXU – Supabase schéma
--  Spusť celé najednou v Supabase → SQL Editor → New query → Run.
--  Skript je idempotentní jen částečně – na čistém projektu ho pusť jednou.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────────────
--  POMOCNÉ FUNKCE – role a oprávnění
--  Hierarchie: player(0) < judge(1) < organizer(2) < admin(3) < superadmin(4)
--  Vyšší role automaticky zahrnuje nižší (admin je i organizátor a judge).
-- ────────────────────────────────────────────────────────────────────

create or replace function public.bbx_role_level(r text) returns int
language sql immutable as $$
  select case r when 'superadmin' then 4 when 'admin' then 3
                when 'organizer' then 2 when 'judge' then 1 else 0 end
$$;

create or replace function public.bbx_is_anon() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- privilegovaný režim: RPC funkce si ho zapnou, aby prošly ochrannými triggery
create or replace function public.bbx_privileged() returns boolean
language sql stable as $$
  select coalesce(current_setting('bbx.privileged', true), '') = 'on'
      -- SQL editor / service role (ne požadavky z aplikace, ty běží jako anon / authenticated)
      or coalesce(current_setting('role', true), 'none') not in ('anon', 'authenticated')
$$;

create or replace function public.bbx_set_privileged() returns void
language sql as $$ select set_config('bbx.privileged', 'on', true) $$;

-- ════════════════════════════════════════════════════════════════════
--  PROFILY
-- ════════════════════════════════════════════════════════════════════

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nick        text,
  region      text,
  avatar      text not null default '🌀',
  bio         text,
  role        text not null default 'player',
  rating      int  not null default 1000,
  created_at  timestamptz not null default now(),
  constraint profiles_role_chk   check (role in ('player','judge','organizer','admin','superadmin')),
  constraint profiles_nick_chk   check (nick is null or (char_length(btrim(nick)) between 2 and 24 and nick !~ '[<>"''`\\]')),
  constraint profiles_region_chk check (region is null or region in (
    'Hlavní město Praha','Středočeský','Jihočeský','Plzeňský','Karlovarský','Ústecký',
    'Liberecký','Královéhradecký','Pardubický','Vysočina','Jihomoravský','Olomoucký',
    'Zlínský','Moravskoslezský','Zahraničí')),
  constraint profiles_bio_chk    check (bio is null or char_length(bio) <= 280),
  constraint profiles_avatar_chk check (char_length(avatar) <= 16)
);
create unique index profiles_nick_ci on public.profiles (lower(btrim(nick))) where nick is not null;

create or replace function public.bbx_my_level() returns int
language sql stable security definer set search_path = public as $$
  select case when public.bbx_is_anon() then 0
              else coalesce((select public.bbx_role_level(role) from public.profiles where id = auth.uid()), 0) end
$$;

-- nový uživatel (e-mail, Discord i anonymní host) → prázdný profil
create or replace function public.bbx_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  md jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  n  text := nullif(btrim(coalesce(md->>'nick', md->'custom_claims'->>'global_name', md->>'full_name', md->>'name', '')), '');
  r  text := md->>'region';
begin
  -- nick z registrace / Discordu, pokud je volný a platný; jinak ho hráč doplní v profilu
  begin
    insert into public.profiles (id, nick, region) values (new.id, n, r);
  exception when others then
    insert into public.profiles (id) values (new.id) on conflict do nothing;
  end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.bbx_handle_new_user();

-- role a rating smí měnit jen RPC funkce
create or replace function public.bbx_protect_profile() returns trigger
language plpgsql as $$
begin
  if not public.bbx_privileged() then
    if new.role is distinct from old.role then raise exception 'Roli může měnit jen admin.'; end if;
    if new.rating is distinct from old.rating then raise exception 'Rating nelze měnit ručně.'; end if;
    if new.id is distinct from old.id then raise exception 'Nelze.'; end if;
    if public.bbx_is_anon() and new.nick is not null then
      raise exception 'Host nemá profil – pro vlastní nick si založ účet.';
    end if;
  end if;
  if new.nick is not null then new.nick := btrim(new.nick); end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.bbx_protect_profile();

alter table public.profiles enable row level security;
create policy profiles_read   on public.profiles for select using (true);
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ════════════════════════════════════════════════════════════════════
--  TURNAJE A AKCE
-- ════════════════════════════════════════════════════════════════════

create table public.tournaments (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'tournament',          -- tournament | event
  name          text not null,
  description   text,
  location      text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  status        text not null default 'registration',        -- registration | swiss | topcut | finished | canceled
  swiss_rounds  int  not null default 4,
  top_cut       int  not null default 8,                     -- 0 = bez top cutu
  arena_count   int  not null default 4,
  win_score     int  not null default 7,
  bo_config     jsonb not null default '{"gf":3,"lbf":3,"lbsf":3,"wbf":1,"default":1}',
  max_players   int,
  current_round int  not null default 0,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  constraint t_kind_chk   check (kind in ('tournament','event')),
  constraint t_status_chk check (status in ('registration','swiss','topcut','finished','canceled')),
  constraint t_name_chk   check (char_length(btrim(name)) between 3 and 80),
  constraint t_nums_chk   check (swiss_rounds between 1 and 15 and top_cut between 0 and 128
                                 and arena_count between 1 and 64 and win_score between 1 and 99)
);
create index tournaments_status_idx on public.tournaments (status, starts_at desc);

create or replace function public.bbx_can_manage(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.bbx_my_level() >= 3
      or (public.bbx_my_level() >= 2 and exists (
            select 1 from public.tournaments where id = t and created_by = auth.uid()))
$$;

create or replace function public.bbx_protect_tournament() returns trigger
language plpgsql as $$
begin
  if not public.bbx_privileged() then
    if tg_op = 'INSERT' then
      new.status := 'registration'; new.current_round := 0;
      new.started_at := null; new.finished_at := null; new.created_by := auth.uid();
    else
      if new.status is distinct from old.status or new.current_round is distinct from old.current_round
         or new.created_by is distinct from old.created_by or new.started_at is distinct from old.started_at
         or new.finished_at is distinct from old.finished_at then
        raise exception 'Stav turnaje se mění jen přes ovládání turnaje.';
      end if;
      if old.status not in ('registration') and (new.swiss_rounds <> old.swiss_rounds or new.win_score <> old.win_score or new.kind <> old.kind) then
        raise exception 'Po startu nejde měnit počet kol, body na výhru ani typ.';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger tournaments_protect before insert or update on public.tournaments
  for each row execute function public.bbx_protect_tournament();

alter table public.tournaments enable row level security;
create policy t_read   on public.tournaments for select using (true);
create policy t_insert on public.tournaments for insert with check (public.bbx_my_level() >= 2);
create policy t_update on public.tournaments for update using (public.bbx_can_manage(id)) with check (public.bbx_can_manage(id));
create policy t_delete on public.tournaments for delete using (public.bbx_can_manage(id) and status in ('registration','canceled'));

-- ════════════════════════════════════════════════════════════════════
--  REGISTRACE DO TURNAJE
--  qr_token a beyblady nejsou veřejně čitelné (viz granty níže) –
--  čtou se přes RPC: my_registration, tournament_players, judge_*.
-- ════════════════════════════════════════════════════════════════════

create table public.registrations (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null default auth.uid(),
  nick          text not null,
  bey1          text, bey2 text, bey3 text,
  qr_token      uuid not null default gen_random_uuid() unique,
  status        text not null default 'active',               -- active | dropped
  seed          int,
  final_place   int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint reg_status_chk check (status in ('active','dropped')),
  constraint reg_nick_chk   check (char_length(btrim(nick)) between 2 and 24 and nick !~ '[<>"''`\\]'),
  constraint reg_bey_chk    check (coalesce(char_length(bey1),0) <= 60 and coalesce(char_length(bey2),0) <= 60 and coalesce(char_length(bey3),0) <= 60),
  unique (tournament_id, user_id)
);
create unique index registrations_nick_ci on public.registrations (tournament_id, lower(btrim(nick)));

create or replace function public.bbx_protect_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  prof public.profiles;
  manager boolean;
begin
  select * into t from public.tournaments where id = new.tournament_id;
  if not found then raise exception 'Turnaj neexistuje.'; end if;
  manager := public.bbx_privileged() or public.bbx_can_manage(new.tournament_id);

  new.nick := btrim(new.nick);
  new.bey1 := nullif(btrim(coalesce(new.bey1,'')), '');
  new.bey2 := nullif(btrim(coalesce(new.bey2,'')), '');
  new.bey3 := nullif(btrim(coalesce(new.bey3,'')), '');
  new.updated_at := now();

  if not manager then
    if t.status <> 'registration' then raise exception 'Registrace do tohoto turnaje je uzavřená.'; end if;
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
      new.status := 'active'; new.seed := null; new.final_place := null;
      new.qr_token := gen_random_uuid();
      if t.max_players is not null and (select count(*) from public.registrations
             where tournament_id = t.id and status = 'active') >= t.max_players then
        raise exception 'Turnaj je plný.';
      end if;
    else
      if new.user_id is distinct from old.user_id or new.tournament_id <> old.tournament_id
         or new.status <> old.status or new.seed is distinct from old.seed
         or new.final_place is distinct from old.final_place or new.qr_token <> old.qr_token then
        raise exception 'Tuhle část registrace upravit nemůžeš.';
      end if;
    end if;
  end if;

  -- přihlášený hráč (ne host) má vždy nick ze svého profilu
  if new.user_id is not null and not public.bbx_privileged() and new.user_id = auth.uid() and not public.bbx_is_anon() then
    select * into prof from public.profiles where id = new.user_id;
    if prof.nick is null then raise exception 'Nejdřív si v profilu nastav nick.'; end if;
    new.nick := prof.nick;
  end if;

  -- host nesmí použít nick registrovaného účtu
  if exists (select 1 from public.profiles p
              where p.nick is not null and lower(p.nick) = lower(new.nick)
                and p.id is distinct from new.user_id) then
    raise exception 'Nick „%“ patří registrovanému hráči. Zvol jiný, nebo se přihlas.', new.nick;
  end if;

  if t.kind = 'tournament' then
    if new.bey1 is null or new.bey2 is null or new.bey3 is null then
      raise exception 'Vyplň všechny tři beyblady.';
    end if;
    if lower(new.bey1) in (lower(new.bey2), lower(new.bey3)) or lower(new.bey2) = lower(new.bey3) then
      raise exception 'Každý beyblade musí být jiný.';
    end if;
  end if;
  return new;
end $$;
create trigger registrations_protect before insert or update on public.registrations
  for each row execute function public.bbx_protect_registration();

alter table public.registrations enable row level security;
create policy reg_read   on public.registrations for select using (true);
create policy reg_insert on public.registrations for insert with check (auth.uid() is not null and user_id = auth.uid());
create policy reg_update on public.registrations for update
  using (user_id = auth.uid() or public.bbx_can_manage(tournament_id))
  with check (user_id = auth.uid() or public.bbx_can_manage(tournament_id));
create policy reg_delete on public.registrations for delete
  using ((user_id = auth.uid() and exists (select 1 from public.tournaments t where t.id = tournament_id and t.status = 'registration'))
         or (public.bbx_can_manage(tournament_id) and exists (select 1 from public.tournaments t where t.id = tournament_id and t.status = 'registration')));

-- tajné sloupce (QR token, beyblady) nejsou přímo čitelné
revoke select on public.registrations from anon, authenticated;
grant select (id, tournament_id, user_id, nick, status, seed, final_place, created_at, updated_at)
  on public.registrations to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
--  ZÁPASY, HRY, BODY
--  match = dvojice hráčů (swiss: 1 hra do 7, top cut: BO1/BO3)
--  game  = jedna hra do 7 bodů
--  point = jeden souboj v rámci hry (kdo bodoval, kolik, kterými beyi)
-- ════════════════════════════════════════════════════════════════════

create table public.matches (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  stage          text not null,                 -- swiss | wb | lb | gf
  round          int  not null,
  pos            int  not null default 1,
  key            text not null,                 -- unikátní v turnaji: S3-2, W1-1, L4-1, GF
  arena          int,
  wave           int,
  p1_reg         uuid references public.registrations(id) on delete set null,
  p2_reg         uuid references public.registrations(id) on delete set null,
  p1_bye         boolean not null default false,
  p2_bye         boolean not null default false,
  best_of        int  not null default 1,
  p1_wins        int  not null default 0,
  p2_wins        int  not null default 0,
  p1_score       int  not null default 0,       -- součet bodů ze všech her
  p2_score       int  not null default 0,
  status         text not null default 'pending', -- pending | live | done
  winner_reg     uuid references public.registrations(id) on delete set null,
  loser_reg      uuid references public.registrations(id) on delete set null,
  is_bye         boolean not null default false,  -- volný los / kontumace
  judge_id       uuid references auth.users(id) on delete set null,
  next_win_key   text, next_win_slot  int,
  next_lose_key  text, next_lose_slot int,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  constraint m_stage_chk  check (stage in ('swiss','wb','lb','gf')),
  constraint m_status_chk check (status in ('pending','live','done')),
  constraint m_bo_chk     check (best_of in (1,3,5)),
  unique (tournament_id, key)
);
create index matches_t_idx   on public.matches (tournament_id, stage, round, pos);
create index matches_p1_idx  on public.matches (p1_reg);
create index matches_p2_idx  on public.matches (p2_reg);

create table public.games (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  game_no     int  not null,
  p1_score    int  not null,
  p2_score    int  not null,
  winner_slot int  not null check (winner_slot in (1,2)),
  judge_id    uuid references auth.users(id) on delete set null,
  client_id   uuid unique,                      -- ochrana proti dvojímu odeslání z offline fronty
  started_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (match_id, game_no)
);

create table public.points (
  id           bigint generated always as identity primary key,
  game_id      uuid not null references public.games(id) on delete cascade,
  seq          int  not null,
  scorer_slot  int  not null check (scorer_slot in (0,1,2)),  -- 0 = remíza
  pts          int  not null check (pts between 0 and 3),
  p1_bey       text,
  p2_bey       text,
  created_at   timestamptz not null default now()
);
create index points_game_idx on public.points (game_id, seq);

alter table public.matches enable row level security;
alter table public.games   enable row level security;
alter table public.points  enable row level security;
create policy m_read on public.matches for select using (true);
create policy g_read on public.games   for select using (true);
create policy p_read on public.points  for select using (true);
-- organizátor smí měnit arénu / vlnu ručně (zbytek hlídá trigger)
create policy m_update on public.matches for update using (public.bbx_can_manage(tournament_id)) with check (public.bbx_can_manage(tournament_id));

create or replace function public.bbx_protect_match() returns trigger
language plpgsql as $$
begin
  if not public.bbx_privileged() then
    if row(new.p1_reg,new.p2_reg,new.status,new.winner_reg,new.loser_reg,new.p1_wins,new.p2_wins,new.p1_score,new.p2_score,new.key,new.stage)
       is distinct from row(old.p1_reg,old.p2_reg,old.status,old.winner_reg,old.loser_reg,old.p1_wins,old.p2_wins,old.p1_score,old.p2_score,old.key,old.stage) then
      raise exception 'Ručně jde změnit jen aréna a pořadí.';
    end if;
  end if;
  return new;
end $$;
create trigger matches_protect before update on public.matches
  for each row execute function public.bbx_protect_match();

-- ════════════════════════════════════════════════════════════════════
--  JUDGE – obsazení arén
-- ════════════════════════════════════════════════════════════════════

create table public.arena_judges (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  arena         int  not null,
  judge_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  claimed_at    timestamptz not null default now(),
  primary key (tournament_id, arena)
);
alter table public.arena_judges enable row level security;
create policy aj_read   on public.arena_judges for select using (true);
create policy aj_insert on public.arena_judges for insert
  with check (judge_id = auth.uid() and public.bbx_my_level() >= 1
              and arena between 1 and (select arena_count from public.tournaments where id = tournament_id));
create policy aj_delete on public.arena_judges for delete
  using (judge_id = auth.uid() or public.bbx_can_manage(tournament_id));

-- ════════════════════════════════════════════════════════════════════
--  RATING (Elo) – historie pro graf na profilu
-- ════════════════════════════════════════════════════════════════════

create table public.rating_history (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  match_id   uuid references public.matches(id) on delete set null,
  rating     int not null,
  delta      int not null,
  created_at timestamptz not null default now()
);
create index rating_history_user_idx on public.rating_history (user_id, created_at);
alter table public.rating_history enable row level security;
create policy rh_read on public.rating_history for select using (true);

-- ════════════════════════════════════════════════════════════════════
--  CHAT
-- ════════════════════════════════════════════════════════════════════

create table public.chat_rooms (
  id    text primary key,
  name  text not null,
  icon  text not null default '💬',
  sort  int  not null default 0
);
insert into public.chat_rooms (id, name, icon, sort) values
  ('treninky','Tréninky','⚙️',1), ('turnaje','Turnaje','🏆',2), ('cestovani','Cestování','🚗',3),
  ('poptavky','Poptávky','🔍',4), ('prodeje','Prodeje','💎',5), ('volny','Volný talk','💬',6)
on conflict do nothing;

create table public.chat_messages (
  id         bigint generated always as identity primary key,
  room_id    text not null references public.chat_rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  nick       text,
  avatar     text,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint chat_body_chk check (char_length(btrim(body)) between 1 and 1000)
);
create index chat_messages_room_idx on public.chat_messages (room_id, id desc);

create or replace function public.bbx_chat_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare prof public.profiles;
begin
  if public.bbx_privileged() then return new; end if;
  select * into prof from public.profiles where id = auth.uid();
  if prof.nick is null or public.bbx_is_anon() then raise exception 'Psát můžou jen přihlášení hráči s nickem.'; end if;
  if exists (select 1 from public.chat_messages where user_id = auth.uid() and created_at > now() - interval '1 second') then
    raise exception 'Zpomal :)';
  end if;
  new.user_id := auth.uid(); new.nick := prof.nick; new.avatar := prof.avatar;
  new.body := btrim(new.body); new.created_at := now();
  return new;
end $$;
create trigger chat_fill before insert on public.chat_messages
  for each row execute function public.bbx_chat_fill();

alter table public.chat_rooms    enable row level security;
alter table public.chat_messages enable row level security;
create policy cr_read on public.chat_rooms for select using (true);
create policy cm_read on public.chat_messages for select using (true);
create policy cm_insert on public.chat_messages for insert with check (auth.uid() is not null and not public.bbx_is_anon());
create policy cm_delete on public.chat_messages for delete using (user_id = auth.uid() or public.bbx_my_level() >= 3);

-- ════════════════════════════════════════════════════════════════════
--  RPC – ROLE
-- ════════════════════════════════════════════════════════════════════

create or replace function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare me int := public.bbx_my_level(); target_role text; target int; new_level int := public.bbx_role_level(p_role);
begin
  if p_role not in ('player','judge','organizer','admin') then raise exception 'Neplatná role.'; end if;
  if p_user = auth.uid() then raise exception 'Svou vlastní roli měnit nemůžeš.'; end if;
  select role into target_role from public.profiles where id = p_user;
  if not found then raise exception 'Uživatel neexistuje.'; end if;
  target := public.bbx_role_level(target_role);
  if me < 3 then raise exception 'Role přiděluje jen admin.'; end if;
  if target >= me then raise exception 'Tomuto účtu roli měnit nemůžeš.'; end if;
  if new_level >= me then raise exception 'Takovou roli přidělit nemůžeš.'; end if;   -- admin dá max organizátora, hlavní admin max admina
  if exists (select 1 from auth.users where id = p_user and coalesce(is_anonymous,false)) then
    raise exception 'Host (bez účtu) nemůže mít roli.';
  end if;
  perform public.bbx_set_privileged();
  update public.profiles set role = p_role where id = p_user;
end $$;

-- ════════════════════════════════════════════════════════════════════
--  RPC – ČTENÍ REGISTRACÍ
-- ════════════════════════════════════════════════════════════════════

-- moje registrace v turnaji včetně QR tokenu
create or replace function public.my_registration(p_tournament uuid)
returns table (id uuid, tournament_id uuid, nick text, bey1 text, bey2 text, bey3 text,
               qr_token uuid, status text, seed int, final_place int, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.tournament_id, r.nick, r.bey1, r.bey2, r.bey3, r.qr_token, r.status, r.seed, r.final_place, r.created_at, r.updated_at
    from public.registrations r
   where r.tournament_id = p_tournament and r.user_id = auth.uid() and auth.uid() is not null
$$;

-- všechny moje registrace (pro notifikace a „moje turnaje“)
create or replace function public.my_registrations()
returns table (id uuid, tournament_id uuid, nick text, status text)
language sql stable security definer set search_path = public as $$
  select r.id, r.tournament_id, r.nick, r.status from public.registrations r
   where r.user_id = auth.uid() and auth.uid() is not null
$$;

-- seznam hráčů turnaje; beyblady vidí jen majitel, judge/organizátor, nebo všichni po skončení
create or replace function public.tournament_players(p_tournament uuid)
returns table (id uuid, user_id uuid, nick text, bey1 text, bey2 text, bey3 text, status text,
               seed int, final_place int, created_at timestamptz, avatar text, region text, has_account boolean)
language sql stable security definer set search_path = public as $$
  with t as (select * from public.tournaments where id = p_tournament),
       can_see as (select (select status from t) = 'finished' or public.bbx_my_level() >= 1 as v)
  select r.id, r.user_id, r.nick,
         case when (select v from can_see) or r.user_id = auth.uid() then r.bey1 end,
         case when (select v from can_see) or r.user_id = auth.uid() then r.bey2 end,
         case when (select v from can_see) or r.user_id = auth.uid() then r.bey3 end,
         r.status, r.seed, r.final_place, r.created_at, p.avatar, p.region,
         (p.nick is not null and not coalesce(u.is_anonymous, false))
    from public.registrations r
    left join public.profiles p on p.id = r.user_id
    left join auth.users u on u.id = r.user_id
   where r.tournament_id = p_tournament
   order by r.created_at
$$;

-- ════════════════════════════════════════════════════════════════════
--  RPC – ŘÍZENÍ TURNAJE
-- ════════════════════════════════════════════════════════════════════

create or replace function public.bbx_require_manager(p_tournament uuid) returns public.tournaments
language plpgsql security definer set search_path = public as $$
declare t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if not found then raise exception 'Turnaj neexistuje.'; end if;
  if not (public.bbx_privileged() or public.bbx_can_manage(p_tournament)) then raise exception 'Tenhle turnaj nemůžeš řídit.'; end if;
  perform public.bbx_set_privileged();
  return t;
end $$;

create or replace function public.start_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n int;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.kind <> 'tournament' then raise exception 'Akce se nespouští, jen ukončí.'; end if;
  if t.status <> 'registration' then raise exception 'Turnaj už běží.'; end if;
  select count(*) into n from public.registrations where tournament_id = t.id and status = 'active';
  if n < 2 then raise exception 'Potřebuješ aspoň 2 hráče.'; end if;
  update public.tournaments set status = 'swiss', started_at = now(), current_round = 0 where id = t.id;
end $$;

-- p_pairings: [{"p1":"<reg>","p2":"<reg>|null"}, …] v pořadí, v jakém se rozdělí do arén
create or replace function public.create_swiss_round(p_tournament uuid, p_round int, p_pairings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; pr jsonb; i int := 0; ids uuid[] := '{}'; a uuid; b uuid; nk int;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'swiss' then raise exception 'Turnaj není ve swiss fázi.'; end if;
  if p_round <> t.current_round + 1 then raise exception 'Čekám kolo %, přišlo %.', t.current_round + 1, p_round; end if;
  if p_round > t.swiss_rounds then raise exception 'Všechna swiss kola už proběhla.'; end if;
  if exists (select 1 from public.matches where tournament_id = t.id and stage = 'swiss' and status <> 'done') then
    raise exception 'Nejdřív dohrajte všechny zápasy aktuálního kola.';
  end if;

  for pr in select * from jsonb_array_elements(p_pairings) loop
    a := (pr->>'p1')::uuid;
    b := nullif(pr->>'p2','')::uuid;
    if a is null then raise exception 'Chybí hráč 1.'; end if;
    if a = any(ids) or (b is not null and b = any(ids)) then raise exception 'Hráč je v kole dvakrát.'; end if;
    if not exists (select 1 from public.registrations where id = a and tournament_id = t.id and status = 'active')
       or (b is not null and not exists (select 1 from public.registrations where id = b and tournament_id = t.id and status = 'active')) then
      raise exception 'Hráč nepatří do turnaje nebo odstoupil.';
    end if;
    ids := ids || a; if b is not null then ids := ids || b; end if;

    if b is null then
      -- volný los = výhra win_score:0
      insert into public.matches (tournament_id, stage, round, pos, key, p1_reg, p2_bye, status, winner_reg,
                                  p1_wins, p1_score, is_bye, finished_at)
      values (t.id, 'swiss', p_round, 999, 'S'||p_round||'-BYE', a, true, 'done', a, 1, t.win_score, true, now());
    else
      i := i + 1;
      insert into public.matches (tournament_id, stage, round, pos, key, p1_reg, p2_reg, arena, wave, best_of)
      values (t.id, 'swiss', p_round, i, 'S'||p_round||'-'||i, a, b,
              ((i - 1) % t.arena_count) + 1, ((i - 1) / t.arena_count) + 1, 1);
    end if;
  end loop;

  select count(*) into nk from public.registrations where tournament_id = t.id and status = 'active';
  if coalesce(array_length(ids,1),0) <> nk then raise exception 'Párování nepokrývá všechny aktivní hráče (% z %).', coalesce(array_length(ids,1),0), nk; end if;

  update public.tournaments set current_round = p_round where id = t.id;
end $$;

-- umístí hráče (nebo „bye“) do slotu navazujícího zápasu
create or replace function public.bbx_place(p_tournament uuid, p_key text, p_slot int, p_reg uuid, p_bye boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null then return; end if;
  if p_slot = 1 then
    update public.matches set p1_reg = p_reg, p1_bye = p_bye where tournament_id = p_tournament and key = p_key;
  else
    update public.matches set p2_reg = p_reg, p2_bye = p_bye where tournament_id = p_tournament and key = p_key;
  end if;
  perform public.bbx_check_ready(p_tournament, p_key);
end $$;

-- zápas má oba sloty → buď kontumace (bye), nebo mu přidělíme arénu
create or replace function public.bbx_check_ready(p_tournament uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.tournaments; a int; w int;
begin
  select * into m from public.matches where tournament_id = p_tournament and key = p_key;
  if not found or m.status = 'done' then return; end if;
  if not ((m.p1_reg is not null or m.p1_bye) and (m.p2_reg is not null or m.p2_bye)) then return; end if;

  if m.p1_bye or m.p2_bye then
    -- kontumace: kdo má soupeře „bye“, postupuje; dva bye → postupuje bye
    update public.matches
       set status = 'done', is_bye = true, finished_at = now(),
           winner_reg = case when m.p1_bye then m.p2_reg else m.p1_reg end,
           loser_reg  = null
     where id = m.id;
    perform public.bbx_place(p_tournament, m.next_win_key, m.next_win_slot,
                             case when m.p1_bye then m.p2_reg else m.p1_reg end,
                             (m.p1_bye and m.p2_bye));
    perform public.bbx_place(p_tournament, m.next_lose_key, m.next_lose_slot, null, true);
    return;
  end if;

  if m.arena is null then
    select * into t from public.tournaments where id = p_tournament;
    select g.a, (select count(*) from public.matches x
                  where x.tournament_id = p_tournament and x.arena = g.a and x.status <> 'done') + 1
      into a, w
      from generate_series(1, t.arena_count) g(a)
     order by (select count(*) from public.matches x
                where x.tournament_id = p_tournament and x.arena = g.a and x.status <> 'done'), g.a
     limit 1;
    update public.matches set arena = a, wave = w where id = m.id;
  end if;
end $$;

-- p_seeds:   [{"reg":"<id>","seed":1}, …]  (top X ze swiss pořadí)
-- p_matches: kostra pavouka z core.js: [{"key","stage","round","pos","best_of","p1_seed","p2_seed",
--             "next_win_key","next_win_slot","next_lose_key","next_lose_slot"}]
--            p*_seed > počet hráčů = bye; null = slot čeká na postupujícího
create or replace function public.create_topcut(p_tournament uuid, p_top int, p_bo_config jsonb, p_seeds jsonb, p_matches jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; s jsonb; mm jsonb; r1 uuid; r2 uuid; s1 int; s2 int; k text;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'swiss' then raise exception 'Top cut jde spustit jen po swissu.'; end if;
  if exists (select 1 from public.matches where tournament_id = t.id and stage = 'swiss' and status <> 'done') then
    raise exception 'Swiss ještě není dohraný.';
  end if;
  if t.current_round < t.swiss_rounds then raise exception 'Ještě nebyla odehrána všechna swiss kola.'; end if;
  if p_top < 2 or p_top <> jsonb_array_length(p_seeds) then raise exception 'Neplatná velikost top cutu.'; end if;

  update public.registrations set seed = null where tournament_id = t.id;
  for s in select * from jsonb_array_elements(p_seeds) loop
    update public.registrations set seed = (s->>'seed')::int
     where id = (s->>'reg')::uuid and tournament_id = t.id and status = 'active';
    if not found then raise exception 'Seed hráč nepatří do turnaje.'; end if;
  end loop;

  for mm in select * from jsonb_array_elements(p_matches) loop
    s1 := nullif(mm->>'p1_seed','')::int; s2 := nullif(mm->>'p2_seed','')::int;
    r1 := case when s1 is not null and s1 <= p_top then (select id from public.registrations where tournament_id = t.id and seed = s1) end;
    r2 := case when s2 is not null and s2 <= p_top then (select id from public.registrations where tournament_id = t.id and seed = s2) end;
    insert into public.matches (tournament_id, stage, round, pos, key, best_of, p1_reg, p2_reg, p1_bye, p2_bye,
                                next_win_key, next_win_slot, next_lose_key, next_lose_slot)
    values (t.id, mm->>'stage', (mm->>'round')::int, (mm->>'pos')::int, mm->>'key', coalesce((mm->>'best_of')::int,1),
            r1, r2, coalesce(s1 > p_top, false), coalesce(s2 > p_top, false),
            nullif(mm->>'next_win_key',''), nullif(mm->>'next_win_slot','')::int,
            nullif(mm->>'next_lose_key',''), nullif(mm->>'next_lose_slot','')::int);
  end loop;

  update public.tournaments set status = 'topcut', top_cut = p_top, bo_config = coalesce(p_bo_config, bo_config) where id = t.id;

  for k in select key from public.matches where tournament_id = t.id and stage = 'wb' and round = 1 order by pos loop
    perform public.bbx_check_ready(t.id, k);
  end loop;
end $$;

-- p_placements: [{"reg":"<id>","place":1}, …]
create or replace function public.finish_tournament(p_tournament uuid, p_placements jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; pl jsonb;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status in ('finished','canceled') then raise exception 'Turnaj už je ukončený.'; end if;
  if t.kind = 'tournament' then
    if t.status = 'registration' then raise exception 'Turnaj ještě nezačal.'; end if;
    if exists (select 1 from public.matches where tournament_id = t.id and status <> 'done') then
      raise exception 'Některé zápasy ještě nejsou dohrané.';
    end if;
  end if;
  for pl in select * from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) loop
    update public.registrations set final_place = (pl->>'place')::int
     where id = (pl->>'reg')::uuid and tournament_id = t.id;
  end loop;
  update public.tournaments set status = 'finished', finished_at = now() where id = t.id;
  delete from public.arena_judges where tournament_id = t.id;
end $$;

-- oprava: vrátí odehraný zápas do stavu „čeká“ (smaže hry, vrátí rating, vyprázdní navazující slot)
create or replace function public.reset_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.tournaments; nx public.matches; rh record; k text; sl int; i int;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  t := public.bbx_require_manager(m.tournament_id);
  select * into m from public.matches where id = p_match for update;
  if m.is_bye then raise exception 'Volný los ani postup bez boje nejde vrátit.'; end if;
  if m.status = 'pending' and not exists (select 1 from public.games where match_id = m.id) then
    raise exception 'Zápas ještě nebyl hraný.';
  end if;
  if m.stage = 'swiss' then
    if t.status <> 'swiss' or m.round <> t.current_round then raise exception 'Vrátit jde jen zápas z aktuálního kola.'; end if;
  else
    if t.status <> 'topcut' then raise exception 'Top cut už neběží.'; end if;
    if m.status = 'done' then
      for i in 1..2 loop
        k  := case i when 1 then m.next_win_key  else m.next_lose_key  end;
        sl := case i when 1 then m.next_win_slot else m.next_lose_slot end;
        continue when k is null;
        select * into nx from public.matches where tournament_id = m.tournament_id and key = k;
        if nx.status <> 'pending' or exists (select 1 from public.games where match_id = nx.id) then
          raise exception 'Navazující zápas (%) už začal – nejdřív vrať ten.', k;
        end if;
        if sl = 1 then update public.matches set p1_reg = null, p1_bye = false, arena = null, wave = null where id = nx.id;
        else           update public.matches set p2_reg = null, p2_bye = false, arena = null, wave = null where id = nx.id; end if;
      end loop;
    end if;
  end if;
  for rh in select * from public.rating_history where match_id = m.id loop
    update public.profiles set rating = rating - rh.delta where id = rh.user_id;
  end loop;
  delete from public.rating_history where match_id = m.id;
  delete from public.games where match_id = m.id;
  update public.matches set p1_wins = 0, p2_wins = 0, p1_score = 0, p2_score = 0, status = 'pending',
         winner_reg = null, loser_reg = null, finished_at = null, started_at = null, judge_id = null
   where id = m.id;
end $$;

-- hráč bez telefonu: organizátor ho zapíše ručně (user_id = null)
create or replace function public.add_walkin(p_tournament uuid, p_nick text, p_bey1 text, p_bey2 text, p_bey3 text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; rid uuid;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'registration' then raise exception 'Registrace je uzavřená.'; end if;
  insert into public.registrations (tournament_id, user_id, nick, bey1, bey2, bey3)
  values (t.id, null, p_nick, p_bey1, p_bey2, p_bey3) returning id into rid;
  return rid;
end $$;

-- QR kód cizí registrace (organizátor ho ukáže hráči bez telefonu)
create or replace function public.manager_registration_qr(p_reg uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r public.registrations;
begin
  select * into r from public.registrations where id = p_reg;
  if not found or not public.bbx_can_manage(r.tournament_id) then raise exception 'Nemáš oprávnění.'; end if;
  return r.qr_token;
end $$;

create or replace function public.cancel_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status = 'finished' then raise exception 'Ukončený turnaj nejde zrušit.'; end if;
  update public.tournaments set status = 'canceled', finished_at = now() where id = t.id;
end $$;

-- ════════════════════════════════════════════════════════════════════
--  RPC – JUDGE
-- ════════════════════════════════════════════════════════════════════

create or replace function public.bbx_require_judge(p_tournament uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 1 and not public.bbx_can_manage(p_tournament) and not public.bbx_privileged() then
    raise exception 'Tohle může jen judge.';
  end if;
end $$;

create or replace function public.bbx_match_json(m public.matches) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'tournament_id', m.tournament_id, 'tournament_name', t.name, 'win_score', t.win_score,
    'stage', m.stage, 'round', m.round, 'key', m.key, 'arena', m.arena, 'wave', m.wave,
    'best_of', m.best_of, 'p1_wins', m.p1_wins, 'p2_wins', m.p2_wins, 'status', m.status,
    'games_played', (select count(*) from public.games g where g.match_id = m.id),
    'p1', jsonb_build_object('reg', r1.id, 'nick', r1.nick, 'beys', jsonb_build_array(r1.bey1, r1.bey2, r1.bey3)),
    'p2', jsonb_build_object('reg', r2.id, 'nick', r2.nick, 'beys', jsonb_build_array(r2.bey1, r2.bey2, r2.bey3)))
  from public.tournaments t, public.registrations r1, public.registrations r2
  where t.id = m.tournament_id and r1.id = m.p1_reg and r2.id = m.p2_reg
$$;

-- QR obsah: BBXU1|<tournament_id>|<qr_token>
create or replace function public.judge_lookup_qr(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.registrations; t public.tournaments;
begin
  select * into r from public.registrations where qr_token = p_token;
  if not found then raise exception 'Neznámý QR kód.'; end if;
  perform public.bbx_require_judge(r.tournament_id);
  select * into t from public.tournaments where id = r.tournament_id;
  if r.status <> 'active' then raise exception 'Hráč % z turnaje odstoupil.', r.nick; end if;
  return jsonb_build_object('reg', r.id, 'nick', r.nick, 'beys', jsonb_build_array(r.bey1, r.bey2, r.bey3),
                            'tournament_id', t.id, 'tournament_name', t.name, 'tournament_status', t.status);
end $$;

-- najde nedohraný zápas dvou hráčů
create or replace function public.judge_find_match(p_reg_a uuid, p_reg_b uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.matches; ta uuid; tb uuid;
begin
  select tournament_id into ta from public.registrations where id = p_reg_a;
  select tournament_id into tb from public.registrations where id = p_reg_b;
  if ta is null or tb is null then raise exception 'Hráč nenalezen.'; end if;
  if ta <> tb then raise exception 'Hráči nejsou ve stejném turnaji!'; end if;
  perform public.bbx_require_judge(ta);
  select * into m from public.matches
   where tournament_id = ta and status <> 'done'
     and ((p1_reg = p_reg_a and p2_reg = p_reg_b) or (p1_reg = p_reg_b and p2_reg = p_reg_a))
   order by created_at limit 1;
  if not found then raise exception 'Tihle dva hráči spolu teď nemají naplánovaný zápas.'; end if;
  return public.bbx_match_json(m);
end $$;

-- fronta zápasů na aréně (ruční výběr bez QR)
create or replace function public.judge_arena_queue(p_tournament uuid, p_arena int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.bbx_require_judge(p_tournament);
  return coalesce((select jsonb_agg(public.bbx_match_json(m) order by m.wave, m.created_at)
                     from public.matches m
                    where m.tournament_id = p_tournament and m.arena = p_arena and m.status <> 'done'
                      and m.p1_reg is not null and m.p2_reg is not null), '[]'::jsonb);
end $$;

create or replace function public.judge_get_match(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  perform public.bbx_require_judge(m.tournament_id);
  return public.bbx_match_json(m);
end $$;

create or replace function public.start_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  perform public.bbx_require_judge(m.tournament_id);
  if m.status = 'done' then raise exception 'Zápas už je dohraný.'; end if;
  perform public.bbx_set_privileged();
  update public.matches set status = 'live', judge_id = auth.uid(), started_at = coalesce(started_at, now()) where id = m.id;
end $$;

-- Elo, K = 32
create or replace function public.bbx_apply_rating(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches; uw uuid; ul uuid; rw int; rl int; ew float; d int;
begin
  select * into m from public.matches where id = p_match;
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

-- Odeslání jedné hry z BBXST.
-- p_points: [{"slot":1|2|0,"pts":1..3,"p1_bey":"…","p2_bey":"…"}, …] v pořadí soubojů
create or replace function public.submit_game(p_match uuid, p_p1_score int, p_p2_score int,
                                              p_points jsonb default '[]', p_client_id uuid default null,
                                              p_started_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.matches; t public.tournaments; g_no int; gid uuid; need int; pt jsonb; i int := 0;
  s1 int := 0; s2 int := 0; done boolean := false; w uuid; l uuid;
begin
  -- opakované odeslání stejné hry (offline fronta) → vrať aktuální stav
  if p_client_id is not null and exists (select 1 from public.games where client_id = p_client_id) then
    select m2.* into m from public.matches m2 join public.games g on g.match_id = m2.id where g.client_id = p_client_id;
    return jsonb_build_object('duplicate', true, 'match_done', m.status = 'done', 'p1_wins', m.p1_wins, 'p2_wins', m.p2_wins);
  end if;

  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  perform public.bbx_require_judge(m.tournament_id);
  select * into t from public.tournaments where id = m.tournament_id;
  if t.status not in ('swiss','topcut') then raise exception 'Turnaj neběží.'; end if;
  if m.status = 'done' then raise exception 'Zápas už je dohraný.'; end if;
  if m.p1_reg is null or m.p2_reg is null then raise exception 'Zápas ještě nemá oba hráče.'; end if;

  if not ((p_p1_score = t.win_score and p_p2_score between 0 and t.win_score - 1)
       or (p_p2_score = t.win_score and p_p1_score between 0 and t.win_score - 1)) then
    raise exception 'Neplatné skóre %:% (vítěz musí mít %).', p_p1_score, p_p2_score, t.win_score;
  end if;

  if jsonb_array_length(coalesce(p_points,'[]')) > 0 then
    select coalesce(sum((x->>'pts')::int) filter (where (x->>'slot')::int = 1),0),
           coalesce(sum((x->>'pts')::int) filter (where (x->>'slot')::int = 2),0)
      into s1, s2 from jsonb_array_elements(p_points) x;
    if s1 <> p_p1_score or s2 <> p_p2_score then
      raise exception 'Souboje (%:%) nesedí se skóre (%:%).', s1, s2, p_p1_score, p_p2_score;
    end if;
  end if;

  perform public.bbx_set_privileged();
  select coalesce(max(game_no),0) + 1 into g_no from public.games where match_id = m.id;
  insert into public.games (match_id, game_no, p1_score, p2_score, winner_slot, judge_id, client_id, started_at)
  values (m.id, g_no, p_p1_score, p_p2_score, case when p_p1_score > p_p2_score then 1 else 2 end,
          auth.uid(), p_client_id, p_started_at)
  returning id into gid;

  for pt in select * from jsonb_array_elements(coalesce(p_points,'[]')) loop
    i := i + 1;
    insert into public.points (game_id, seq, scorer_slot, pts, p1_bey, p2_bey)
    values (gid, i, (pt->>'slot')::int, (pt->>'pts')::int, left(pt->>'p1_bey',60), left(pt->>'p2_bey',60));
  end loop;

  need := (m.best_of / 2) + 1;
  if p_p1_score > p_p2_score then m.p1_wins := m.p1_wins + 1; else m.p2_wins := m.p2_wins + 1; end if;
  done := m.p1_wins >= need or m.p2_wins >= need;
  if done then
    w := case when m.p1_wins >= need then m.p1_reg else m.p2_reg end;
    l := case when m.p1_wins >= need then m.p2_reg else m.p1_reg end;
  end if;

  update public.matches
     set p1_wins = m.p1_wins, p2_wins = m.p2_wins,
         p1_score = p1_score + p_p1_score, p2_score = p2_score + p_p2_score,
         status = case when done then 'done' else 'live' end,
         winner_reg = w, loser_reg = l, judge_id = auth.uid(),
         started_at = coalesce(started_at, p_started_at, now()),
         finished_at = case when done then now() end
   where id = m.id;

  if done then
    perform public.bbx_apply_rating(m.id);
    perform public.bbx_place(m.tournament_id, m.next_win_key, m.next_win_slot, w, false);
    perform public.bbx_place(m.tournament_id, m.next_lose_key, m.next_lose_slot, l, false);
  end if;

  return jsonb_build_object('match_done', done, 'p1_wins', m.p1_wins, 'p2_wins', m.p2_wins,
                            'game_no', g_no, 'winner_reg', w);
end $$;

-- ════════════════════════════════════════════════════════════════════
--  RPC – PROFIL / STATISTIKY
-- ════════════════════════════════════════════════════════════════════

create or replace function public.player_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with regs as (
    select r.*, t.name as t_name, t.starts_at, t.status as t_status, t.kind, t.finished_at,
           (select count(*) from public.registrations x where x.tournament_id = t.id and x.status = 'active') as players
      from public.registrations r join public.tournaments t on t.id = r.tournament_id
     where r.user_id = p_user
  ),
  my_matches as (
    select m.*, case when m.p1_reg = rg.id then 1 else 2 end as side, rg.t_name, rg.t_status
      from public.matches m join regs rg on rg.id in (m.p1_reg, m.p2_reg)
     where m.status = 'done' and not m.is_bye
  ),
  bey_rows as (
    select case when mm.side = 1 then p.p1_bey else p.p2_bey end as bey,
           case when p.scorer_slot = mm.side then 1 else 0 end as won,
           case when p.scorer_slot = 0 then 1 else 0 end as draw,
           case when p.scorer_slot = mm.side then p.pts else 0 end as pts
      from my_matches mm join public.games g on g.match_id = mm.id join public.points p on p.game_id = g.id
     where mm.t_status = 'finished'
  )
  select jsonb_build_object(
    'tournaments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', tournament_id, 'name', t_name, 'starts_at', starts_at, 'status', t_status, 'kind', kind,
        'place', final_place, 'players', players,
        'beys', case when t_status = 'finished' or p_user = auth.uid() then jsonb_build_array(bey1,bey2,bey3) end)
        order by coalesce(starts_at, created_at) desc) from regs), '[]'),
    'record', jsonb_build_object(
        'wins',   (select count(*) from my_matches where winner_reg in (select id from regs)),
        'losses', (select count(*) from my_matches where loser_reg  in (select id from regs)),
        'points_for',     (select coalesce(sum(case when side = 1 then p1_score else p2_score end),0) from my_matches),
        'points_against', (select coalesce(sum(case when side = 1 then p2_score else p1_score end),0) from my_matches),
        'titles', (select count(*) from regs where final_place = 1),
        'podiums',(select count(*) from regs where final_place between 1 and 3)),
    'beys', coalesce((select jsonb_agg(b order by (b->>'battles')::int desc) from (
        select jsonb_build_object('bey', bey, 'battles', count(*), 'wins', sum(won), 'draws', sum(draw), 'points', sum(pts)) as b
          from bey_rows where bey is not null group by bey) q), '[]'),
    'recent', coalesce((select jsonb_agg(x order by x->>'finished_at' desc) from (
        select jsonb_build_object(
          'match_id', mm.id, 'tournament_id', mm.tournament_id, 'tournament', mm.t_name, 'stage', mm.stage, 'round', mm.round,
          'finished_at', mm.finished_at,
          'won', mm.winner_reg in (select id from regs),
          'my_score', case when mm.side = 1 then mm.p1_score else mm.p2_score end,
          'opp_score', case when mm.side = 1 then mm.p2_score else mm.p1_score end,
          'my_wins', case when mm.side = 1 then mm.p1_wins else mm.p2_wins end,
          'opp_wins', case when mm.side = 1 then mm.p2_wins else mm.p1_wins end,
          'best_of', mm.best_of,
          'opponent', (select nick from public.registrations o where o.id = case when mm.side = 1 then mm.p2_reg else mm.p1_reg end),
          'opponent_user', (select user_id from public.registrations o where o.id = case when mm.side = 1 then mm.p2_reg else mm.p1_reg end)
        ) as x from my_matches mm order by mm.finished_at desc limit 30) q), '[]'),
    'rating', coalesce((select jsonb_agg(jsonb_build_object('rating', rating, 'delta', delta, 'at', created_at) order by created_at)
                          from public.rating_history where user_id = p_user), '[]')
  )
$$;

-- přehled turnajů a akcí s počtem hráčů
create or replace function public.tournament_list() returns table (
  id uuid, kind text, name text, description text, location text, starts_at timestamptz, ends_at timestamptz,
  status text, swiss_rounds int, top_cut int, arena_count int, current_round int, max_players int,
  created_by uuid, organizer_nick text, players bigint, finished_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.kind, t.name, t.description, t.location, t.starts_at, t.ends_at, t.status, t.swiss_rounds, t.top_cut,
         t.arena_count, t.current_round, t.max_players, t.created_by, p.nick,
         (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'active'), t.finished_at
    from public.tournaments t left join public.profiles p on p.id = t.created_by
   order by case t.status when 'swiss' then 0 when 'topcut' then 0 when 'registration' then 1 else 2 end,
            case when t.status in ('finished','canceled') then null else t.starts_at end asc nulls last,
            t.starts_at desc nulls last
$$;

-- seznam hráčů s účtem (stránka Hráči)
create or replace function public.players_list() returns table (
  id uuid, nick text, region text, avatar text, role text, rating int, created_at timestamptz,
  tournaments bigint, titles bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.nick, p.region, p.avatar, p.role, p.rating, p.created_at,
         (select count(*) from public.registrations r join public.tournaments t on t.id = r.tournament_id
           where r.user_id = p.id and t.kind = 'tournament' and t.status = 'finished'),
         (select count(*) from public.registrations r where r.user_id = p.id and r.final_place = 1)
    from public.profiles p join auth.users u on u.id = p.id
   where p.nick is not null and not coalesce(u.is_anonymous, false)
   order by p.rating desc, p.nick
$$;

-- ════════════════════════════════════════════════════════════════════
--  OPRÁVNĚNÍ K FUNKCÍM
--  Interní pomocné funkce nejsou volatelné přes API.
-- ════════════════════════════════════════════════════════════════════

revoke execute on function public.bbx_set_privileged()                 from public, anon, authenticated;
revoke execute on function public.bbx_place(uuid,text,int,uuid,boolean) from public, anon, authenticated;
revoke execute on function public.bbx_check_ready(uuid,text)           from public, anon, authenticated;
revoke execute on function public.bbx_apply_rating(uuid)               from public, anon, authenticated;
revoke execute on function public.bbx_require_manager(uuid)            from public, anon, authenticated;
revoke execute on function public.bbx_handle_new_user()                from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
--  REALTIME – živé změny pro notifikace, TV rozpis a chat
-- ════════════════════════════════════════════════════════════════════

alter publication supabase_realtime add table public.tournaments, public.matches, public.chat_messages, public.arena_judges;

-- ════════════════════════════════════════════════════════════════════
--  HLAVNÍ ADMIN
--  Po své první registraci v BBXU (a nastavení nicku) spusť zvlášť:
--    update public.profiles set role = 'superadmin' where lower(nick) = lower('TvujNick');
-- ════════════════════════════════════════════════════════════════════
