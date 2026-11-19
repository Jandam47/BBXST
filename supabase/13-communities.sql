-- ════════════════════════════════════════════════════════════════════
--  13 – Komunity a komunitní tréninky
--
--  Komunita: zakládá organizátor / admin, schvaluje hlavní admin (admin_requests).
--  Zakladatel = community leader, může jmenovat zástupce (sub-community leader).
--  Do komunity se hráči hlásí, přijímá je leader nebo zástupce.
--  Komunitní trénink = akce event_type 'community' s community_id. Zakládá leader/zástupce,
--  přidávají se členové sami, leader/zástupce může pozvat hráče mimo komunitu.
--  Hráč je naráz jen na jednom otevřeném tréninku. Deck 1–3 beye, díly se můžou opakovat.
--  Výzvy (training_matches): vyzvaný potvrdí, pak oba zapisují souboje (training_battles)
--  v BBXST (training mód): mód 3v3 / 3v1 / 1v3 / 1v1, body na hru číslo nebo neomezeně,
--  sestavy jdou měnit. Statistiky: historie, comba (moje / celý trénink), meta komunity.
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

-- ── komunity ────────────────────────────────────────────────────────
create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  region      text,
  status      text not null default 'pending',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  constraint comm_status_chk check (status in ('pending','approved','rejected')),
  constraint comm_name_chk check (char_length(btrim(name)) between 3 and 40 and name !~ '[<>"''`\\]'),
  constraint comm_desc_chk check (coalesce(char_length(description), 0) <= 600)
);
create unique index if not exists communities_name_ci on public.communities (lower(btrim(name))) where status <> 'rejected';
alter table public.communities enable row level security;
revoke all on public.communities from anon, authenticated;

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member',
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  primary key (community_id, user_id),
  constraint cm_role_chk check (role in ('leader','sub','member')),
  constraint cm_status_chk check (status in ('pending','active'))
);
create index if not exists community_members_user on public.community_members (user_id);
alter table public.tournaments add column if not exists community_id uuid references public.communities(id) on delete set null;
alter table public.community_members enable row level security;
revoke all on public.community_members from anon, authenticated;

-- moje role v komunitě (jen aktivní člen schválené komunity; zakladatel i u neschválené)
create or replace function public.bbx_comm_role(p_community uuid, p_user uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select cm.role from public.community_members cm join public.communities c on c.id = cm.community_id
   where cm.community_id = p_community and cm.user_id = p_user and cm.status = 'active'
     and (c.status = 'approved' or cm.role = 'leader')
$$;
create or replace function public.bbx_comm_lead(p_community uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and coalesce(public.bbx_comm_role(p_community) in ('leader','sub'), false)
     and exists (select 1 from public.communities where id = p_community and status = 'approved')
$$;
revoke execute on function public.bbx_comm_role(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.bbx_comm_lead(uuid) from public, anon, authenticated;

create or replace function public.bbx_require_account() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or public.bbx_is_anon() then raise exception 'Na tohle potřebuješ účet – přihlas se.'; end if;
  if (select nick from public.profiles where id = auth.uid()) is null then raise exception 'Nejdřív si v profilu nastav nick.'; end if;
end $$;
revoke execute on function public.bbx_require_account() from public, anon, authenticated;

-- ── RPC: komunity ───────────────────────────────────────────────────
create or replace function public.community_create(p_name text, p_description text default null, p_region text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform public.bbx_require_account();
  if public.bbx_my_level() < 2 then raise exception 'Komunitu můžou zakládat organizátoři a admini.'; end if;
  if exists (select 1 from public.communities where lower(btrim(name)) = lower(btrim(p_name)) and status <> 'rejected') then
    raise exception 'Komunita „%“ už existuje.', btrim(p_name);
  end if;
  insert into public.communities (name, description, region, status, created_by)
  values (btrim(p_name), nullif(btrim(p_description), ''), nullif(btrim(p_region), ''),
          case when public.bbx_my_level() >= 4 then 'approved' else 'pending' end, auth.uid())
  returning id into cid;
  if public.bbx_my_level() >= 4 then
    update public.communities set reviewed_by = auth.uid(), reviewed_at = now() where id = cid;
  end if;
  insert into public.community_members (community_id, user_id, role, status, decided_by, decided_at)
  values (cid, auth.uid(), 'leader', 'active', auth.uid(), now());
  return cid;
end $$;

create or replace function public.community_update(p_community uuid, p_name text, p_description text, p_region text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.bbx_comm_role(p_community) is distinct from 'leader' and public.bbx_my_level() < 4 then
    raise exception 'Upravit komunitu může jen její leader.';
  end if;
  if exists (select 1 from public.communities where lower(btrim(name)) = lower(btrim(p_name)) and status <> 'rejected' and id <> p_community) then
    raise exception 'Komunita „%“ už existuje.', btrim(p_name);
  end if;
  update public.communities set name = btrim(p_name), description = nullif(btrim(p_description), ''), region = nullif(btrim(p_region), '')
   where id = p_community;
end $$;

-- hlavní admin: schválit / zamítnout
create or replace function public.community_review(p_community uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 4 then raise exception 'Komunity schvaluje hlavní admin.'; end if;
  update public.communities set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
   where id = p_community and status = 'pending';
  if not found then raise exception 'Žádost už je vyřízená.'; end if;
end $$;

create or replace function public.community_delete(p_community uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.communities;
begin
  select * into c from public.communities where id = p_community;
  if not found then raise exception 'Komunita neexistuje.'; end if;
  if public.bbx_my_level() < 4 and not (c.created_by = auth.uid() and c.status <> 'approved') then
    raise exception 'Schválenou komunitu může smazat jen hlavní admin.';
  end if;
  delete from public.communities where id = p_community;
end $$;

create or replace function public.community_join(p_community uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.bbx_require_account();
  if not exists (select 1 from public.communities where id = p_community and status = 'approved') then
    raise exception 'Komunita ještě není schválená.';
  end if;
  insert into public.community_members (community_id, user_id) values (p_community, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.community_leave(p_community uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.community_members where community_id = p_community and user_id = auth.uid() and role = 'leader') then
    raise exception 'Leader komunitu opustit nemůže.';
  end if;
  delete from public.community_members where community_id = p_community and user_id = auth.uid();
end $$;

-- leader / zástupce: přijmout nebo odmítnout žádost
create or replace function public.community_decide(p_community uuid, p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.bbx_comm_lead(p_community) then raise exception 'Žádosti vyřizuje leader nebo jeho zástupce.'; end if;
  if p_accept then
    update public.community_members set status = 'active', decided_by = auth.uid(), decided_at = now()
     where community_id = p_community and user_id = p_user and status = 'pending';
  else
    delete from public.community_members where community_id = p_community and user_id = p_user and status = 'pending';
  end if;
  if not found then raise exception 'Žádost už je vyřízená.'; end if;
end $$;

-- leader: jmenovat / odvolat zástupce
create or replace function public.community_set_role(p_community uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.bbx_comm_role(p_community) is distinct from 'leader' then raise exception 'Zástupce jmenuje leader komunity.'; end if;
  if p_role not in ('sub','member') then raise exception 'Neplatná role.'; end if;
  update public.community_members set role = p_role
   where community_id = p_community and user_id = p_user and status = 'active' and role <> 'leader';
  if not found then raise exception 'Hráč není aktivní člen komunity.'; end if;
end $$;

-- leader vyřadí kohokoliv kromě sebe, zástupce jen řadové členy
create or replace function public.community_kick(p_community uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.bbx_comm_role(p_community); target text;
begin
  if me not in ('leader','sub') then raise exception 'Členy vyřazuje leader nebo zástupce.'; end if;
  select role into target from public.community_members where community_id = p_community and user_id = p_user;
  if target = 'leader' or (me = 'sub' and target = 'sub') then raise exception 'Tohohle člena vyřadit nemůžeš.'; end if;
  delete from public.community_members where community_id = p_community and user_id = p_user;
end $$;

create or replace function public.community_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'description', c.description, 'region', c.region, 'status', c.status,
      'review_note', case when c.created_by = auth.uid() then c.review_note end,
      'leader', (select jsonb_build_object('id', p.id, 'nick', p.nick, 'avatar', p.avatar) from public.community_members m
                   join public.profiles p on p.id = m.user_id where m.community_id = c.id and m.role = 'leader' limit 1),
      'members', (select count(*) from public.community_members m where m.community_id = c.id and m.status = 'active'),
      'my_role', (select m.role from public.community_members m where m.community_id = c.id and m.user_id = auth.uid()),
      'my_status', (select m.status from public.community_members m where m.community_id = c.id and m.user_id = auth.uid()),
      'pending', case when public.bbx_comm_lead(c.id) then
                   (select count(*) from public.community_members m where m.community_id = c.id and m.status = 'pending') end,
      'trainings_open', (select count(*) from public.tournaments t where t.community_id = c.id and t.status = 'registration'))
      order by (c.status = 'approved') desc, (select count(*) from public.community_members m where m.community_id = c.id and m.status = 'active') desc, c.name), '[]')
    from public.communities c
   where c.status = 'approved' or c.created_by = auth.uid() or public.bbx_my_level() >= 4
$$;

create or replace function public.community_detail(p_community uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.communities; lead boolean;
begin
  select * into c from public.communities where id = p_community;
  if not found or (c.status <> 'approved' and c.created_by is distinct from auth.uid() and public.bbx_my_level() < 4) then
    raise exception 'Komunita neexistuje.';
  end if;
  lead := public.bbx_comm_lead(c.id);
  return jsonb_build_object(
    'community', jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'region', c.region,
                                    'status', c.status, 'created_at', c.created_at, 'review_note', c.review_note),
    'my_role', (select role from public.community_members where community_id = c.id and user_id = auth.uid()),
    'my_status', (select status from public.community_members where community_id = c.id and user_id = auth.uid()),
    'is_lead', lead, 'is_admin', public.bbx_my_level() >= 4,
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'nick', p.nick, 'avatar', p.avatar, 'rating', p.rating,
                           'role', m.role, 'since', m.decided_at)
                           order by case m.role when 'leader' then 0 when 'sub' then 1 else 2 end, p.nick)
                           from public.community_members m join public.profiles p on p.id = m.user_id
                          where m.community_id = c.id and m.status = 'active'), '[]'),
    'pending', case when lead then coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'nick', p.nick, 'avatar', p.avatar,
                           'rating', p.rating, 'at', m.created_at) order by m.created_at)
                           from public.community_members m join public.profiles p on p.id = m.user_id
                          where m.community_id = c.id and m.status = 'pending'), '[]') end,
    'trainings', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'starts_at', t.starts_at, 'status', t.status,
                           'location', t.location,
                           'players', (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'active'))
                           order by (t.status = 'registration') desc, t.starts_at desc nulls last)
                           from public.tournaments t where t.community_id = c.id and t.status <> 'canceled'), '[]'));
end $$;

-- hlavní admin: žádosti ke schválení (do budoucna i další druhy)
create or replace function public.admin_requests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 4 then raise exception 'Jen pro hlavního admina.'; end if;
  return jsonb_build_object('communities', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'description', c.description, 'region', c.region, 'created_at', c.created_at,
      'by', (select jsonb_build_object('id', p.id, 'nick', p.nick, 'avatar', p.avatar, 'role', p.role) from public.profiles p where p.id = c.created_by))
      order by c.created_at) from public.communities c where c.status = 'pending'), '[]'));
end $$;

-- komunity v profilu (role leader / zástupce / člen)
create or replace function public.player_communities(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', m.role)
                  order by case m.role when 'leader' then 0 when 'sub' then 1 else 2 end, c.name), '[]')
    from public.community_members m join public.communities c on c.id = m.community_id
   where m.user_id = p_user and m.status = 'active' and c.status = 'approved'
$$;

-- ════════════════════════════════════════════════════════════════════
--  Komunitní trénink
-- ════════════════════════════════════════════════════════════════════
alter table public.tournaments drop constraint if exists t_event_type_chk;
alter table public.tournaments add  constraint t_event_type_chk check (event_type in ('training','fashion','other','community'));

create table if not exists public.training_invites (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  invited_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
alter table public.training_invites enable row level security;
revoke all on public.training_invites from anon, authenticated;

-- výzva / dvojice v tréninku
create table if not exists public.training_matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  p1_reg        uuid not null references public.registrations(id) on delete cascade,
  p2_reg        uuid not null references public.registrations(id) on delete cascade,
  status        text not null default 'pending',
  settings      jsonb not null default '{}',
  last_seq      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tm_status_chk check (status in ('pending','active','declined','canceled','done')),
  constraint tm_pair_chk check (p1_reg <> p2_reg)
);
create index if not exists training_matches_t on public.training_matches (tournament_id);
alter table public.training_matches enable row level security;
revoke all on public.training_matches from anon, authenticated;
grant select (id, tournament_id, p1_reg, p2_reg, status, last_seq, updated_at) on public.training_matches to authenticated;
drop policy if exists tm_read on public.training_matches;
create policy tm_read on public.training_matches for select to authenticated using (
  exists (select 1 from public.registrations r where r.id in (p1_reg, p2_reg) and r.user_id = auth.uid()));
do $$ begin
  alter publication supabase_realtime add table public.training_matches;
exception when duplicate_object then null; end $$;

-- souboje (p1/p2 v orientaci zápasu; zapisují oba hráči)
create table if not exists public.training_battles (
  id            bigint generated always as identity primary key,
  match_id      uuid not null references public.training_matches(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  seq           int not null,
  game_no       int not null default 1,
  scorer_slot   int not null,
  pts           int not null,
  finish        text,
  mode          text,
  p1_bey        text, p2_bey text,
  p1_parts      jsonb, p2_parts jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  client_id     uuid unique,
  created_at    timestamptz not null default now(),
  constraint tb_slot_chk check (scorer_slot in (0,1,2)),
  constraint tb_pts_chk check (pts between 0 and 3),
  constraint tb_finish_chk check (finish in ('spin','over','burst','xtreme')),
  unique (match_id, seq)
);
alter table public.training_battles enable row level security;
revoke all on public.training_battles from anon, authenticated;

create or replace function public.bbx_protect_tournament() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.bbx_privileged() then
    if tg_op = 'INSERT' then
      new.status := 'registration'; new.current_round := 0; new.fashion := null;
      new.started_at := null; new.finished_at := null; new.created_by := auth.uid();
      if new.kind <> 'event' then new.event_type := 'training'; end if;
      if new.event_type = 'community' or new.community_id is not null then
        raise exception 'Komunitní trénink se zakládá na stránce komunity.';
      end if;
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
      if (new.event_type is distinct from old.event_type and 'community' in (new.event_type, old.event_type))
         or new.community_id is distinct from old.community_id then
        raise exception 'Komunitní trénink nejde převést na jiný druh akce.';
      end if;
      if (new.event_type <> old.event_type or new.fashion_beys <> old.fashion_beys or new.kind <> old.kind)
         and exists (select 1 from public.registrations where tournament_id = old.id) then
        raise exception 'Druh akce a počet beyů jde změnit, jen dokud se nikdo nepřihlásil.';
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.bbx_protect_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  prof public.profiles;
  manager boolean;
  dupe text;
  i int;
begin
  select * into t from public.tournaments where id = new.tournament_id;
  if not found then raise exception 'Turnaj neexistuje.'; end if;
  manager := public.bbx_privileged() or public.bbx_can_manage(new.tournament_id);

  new.nick := btrim(new.nick);
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

  if new.user_id is not null and not public.bbx_privileged() and new.user_id = auth.uid() and not public.bbx_is_anon() then
    select * into prof from public.profiles where id = new.user_id;
    if prof.nick is null then raise exception 'Nejdřív si v profilu nastav nick.'; end if;
    new.nick := prof.nick;
  end if;

  if exists (select 1 from public.profiles p
              where p.nick is not null and lower(p.nick) = lower(new.nick)
                and p.id is distinct from new.user_id) then
    raise exception 'Nick „%“ patří registrovanému hráči. Zvol jiný, nebo se přihlas.', new.nick;
  end if;

  if t.kind = 'tournament' then
    if tg_op = 'INSERT' or new.deck is distinct from old.deck then
      if new.deck is null or jsonb_typeof(new.deck) <> 'array' or jsonb_array_length(new.deck) <> 3 then
        raise exception 'Vyber tři beyblady ze seznamu dílů.';
      end if;
      new.bey1 := public.bbx_compose_bey(new.deck->0, 1);
      new.bey2 := public.bbx_compose_bey(new.deck->1, 2);
      new.bey3 := public.bbx_compose_bey(new.deck->2, 3);
      new.deck := public.bbx_normalize_deck(new.deck);
      if t.unique_parts then
        dupe := public.bbx_deck_dupe(new.deck);
        if dupe is not null then
          raise exception 'Díl „%“ je v decku víckrát – v tomhle turnaji se díly nesmí opakovat.', dupe;
        end if;
      end if;
    elsif tg_op = 'UPDATE' then
      new.bey1 := old.bey1; new.bey2 := old.bey2; new.bey3 := old.bey3;
    end if;
    if lower(new.bey1) in (lower(new.bey2), lower(new.bey3)) or lower(new.bey2) = lower(new.bey3) then
      raise exception 'Každý beyblade musí být jiný.';
    end if;
  elsif t.event_type = 'fashion' then
    if tg_op = 'INSERT' and new.user_id is not null
       and exists (select 1 from public.fashion_judges where tournament_id = t.id and user_id = new.user_id) then
      raise exception 'Jsi design judge – soutěžit zároveň nemůžeš. Nejdřív se odhlas z judgů.';
    end if;
    if tg_op = 'INSERT' or new.deck is distinct from old.deck then
      if new.deck is null or jsonb_typeof(new.deck) <> 'array' or jsonb_array_length(new.deck) <> t.fashion_beys then
        raise exception 'Vyplň všech % beybladů ze seznamu dílů.', t.fashion_beys;
      end if;
      for i in 0 .. t.fashion_beys - 1 loop
        perform public.bbx_compose_bey(new.deck->i, i + 1);   -- ověří díly
      end loop;
      new.bey1 := public.bbx_compose_bey(new.deck->0, 1);
      new.bey2 := case when t.fashion_beys >= 2 then public.bbx_compose_bey(new.deck->1, 2) end;
      new.bey3 := case when t.fashion_beys >= 3 then public.bbx_compose_bey(new.deck->2, 3) end;
      new.deck := public.bbx_normalize_deck(new.deck);
    elsif tg_op = 'UPDATE' then
      new.bey1 := old.bey1; new.bey2 := old.bey2; new.bey3 := old.bey3;
    end if;
  elsif t.event_type = 'community' then
    -- komunitní trénink: jen účty, člen komunity nebo pozvaný, jen jeden otevřený trénink naráz
    if tg_op = 'INSERT' then
      if new.user_id is null or exists (select 1 from auth.users u where u.id = new.user_id and u.is_anonymous) then
        raise exception 'Na komunitní trénink se může přidat jen hráč s účtem.';
      end if;
      if not manager and not public.bbx_privileged()
         and not exists (select 1 from public.community_members cm where cm.community_id = t.community_id
                           and cm.user_id = new.user_id and cm.status = 'active')
         and not exists (select 1 from public.training_invites ti where ti.tournament_id = t.id and ti.user_id = new.user_id) then
        raise exception 'Na trénink se můžou přidat členové komunity a pozvaní hráči.';
      end if;
      if exists (select 1 from public.registrations r2 join public.tournaments t2 on t2.id = r2.tournament_id
                  where r2.user_id = new.user_id and r2.status = 'active' and t2.id <> t.id
                    and t2.kind = 'event' and t2.event_type = 'community' and t2.status = 'registration') then
        raise exception 'Už jsi přihlášený na jiný trénink – nejdřív se z něj odhlas.';
      end if;
    end if;
    if new.deck is not null and (tg_op = 'INSERT' or new.deck is distinct from old.deck) then
      if jsonb_typeof(new.deck) <> 'array' or jsonb_array_length(new.deck) not between 1 and 3 then
        raise exception 'Deck na trénink má 1 až 3 beyblady.';
      end if;
      new.bey1 := public.bbx_compose_bey(new.deck->0, 1);
      new.bey2 := case when jsonb_array_length(new.deck) >= 2 then public.bbx_compose_bey(new.deck->1, 2) end;
      new.bey3 := case when jsonb_array_length(new.deck) >= 3 then public.bbx_compose_bey(new.deck->2, 3) end;
      new.deck := public.bbx_normalize_deck(new.deck);
    elsif new.deck is null then
      new.bey1 := null; new.bey2 := null; new.bey3 := null;
    elsif tg_op = 'UPDATE' then
      new.bey1 := old.bey1; new.bey2 := old.bey2; new.bey3 := old.bey3;
    end if;
  else
    new.deck := null; new.bey1 := null; new.bey2 := null; new.bey3 := null;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_protect_registration() from public, anon, authenticated;

-- organizátor turnaje / admin / leader nebo zástupce komunity tréninku
create or replace function public.bbx_can_manage(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.bbx_my_level() >= 3
      or (public.bbx_my_level() >= 2 and exists (
            select 1 from public.tournaments where id = t and created_by = auth.uid()))
      or exists (select 1 from public.tournaments x where x.id = t and x.community_id is not null
                   and public.bbx_comm_lead(x.community_id))
$$;

create or replace function public.community_training_create(p_community uuid, p_name text, p_starts_at timestamptz default null,
                                                            p_location text default null, p_description text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if not public.bbx_comm_lead(p_community) then raise exception 'Trénink zakládá leader nebo zástupce komunity.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'Název tréninku je moc krátký.'; end if;
  perform public.bbx_set_privileged();
  insert into public.tournaments (kind, event_type, community_id, name, starts_at, location, description,
                                  swiss_rounds, top_cut, created_by, status, rated)
  values ('event', 'community', p_community, btrim(p_name), p_starts_at, nullif(btrim(p_location), ''),
          nullif(btrim(p_description), ''), 1, 0, auth.uid(), 'registration', false)
  returning id into tid;
  return tid;
end $$;

create or replace function public.bbx_training(p_tournament uuid) returns public.tournaments
language plpgsql stable security definer set search_path = public as $$
declare t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournament;
  if not found or t.event_type <> 'community' then raise exception 'Tohle není komunitní trénink.'; end if;
  return t;
end $$;
revoke execute on function public.bbx_training(uuid) from public, anon, authenticated;

-- moje aktivní registrace v tréninku
create or replace function public.bbx_training_reg(p_tournament uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.registrations where tournament_id = p_tournament and user_id = auth.uid() and status = 'active'
$$;
revoke execute on function public.bbx_training_reg(uuid) from public, anon, authenticated;

create or replace function public.training_invite(p_tournament uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments;
begin
  t := public.bbx_training(p_tournament);
  if not public.bbx_comm_lead(t.community_id) then raise exception 'Zvát může leader nebo zástupce komunity.'; end if;
  if t.status <> 'registration' then raise exception 'Trénink už skončil.'; end if;
  if not exists (select 1 from public.profiles p join auth.users u on u.id = p.id
                  where p.id = p_user and p.nick is not null and not coalesce(u.is_anonymous, false)) then
    raise exception 'Pozvat jde jen hráče s účtem.';
  end if;
  if exists (select 1 from public.registrations where tournament_id = t.id and user_id = p_user) then
    raise exception 'Hráč už na tréninku je.';
  end if;
  insert into public.training_invites (tournament_id, user_id, invited_by) values (t.id, p_user, auth.uid())
  on conflict do nothing;
end $$;

create or replace function public.training_invite_decline(p_tournament uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.training_invites where tournament_id = p_tournament and user_id = auth.uid()
$$;

create or replace function public.my_training_invites() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tournament_id', t.id, 'name', t.name, 'starts_at', t.starts_at,
                  'community', c.name, 'by', p.nick) order by i.created_at desc), '[]')
    from public.training_invites i join public.tournaments t on t.id = i.tournament_id
    left join public.communities c on c.id = t.community_id
    left join public.profiles p on p.id = i.invited_by
   where i.user_id = auth.uid() and t.status = 'registration'
     and not exists (select 1 from public.registrations r where r.tournament_id = t.id and r.user_id = auth.uid())
$$;

-- výchozí sestavy z decku hráče (pole prvků decku se jménem)
create or replace function public.bbx_lineup(p_reg uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(b.value || jsonb_build_object('name', public.bbx_compose_bey(b.value, b.ordinality::int))
                                    order by b.ordinality)
                     from public.registrations r, jsonb_array_elements(r.deck) with ordinality b
                    where r.id = p_reg), '[]')
$$;
revoke execute on function public.bbx_lineup(uuid) from public, anon, authenticated;

create or replace function public.training_challenge(p_tournament uuid, p_opponent uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; me uuid; mid uuid;
begin
  t := public.bbx_training(p_tournament);
  if t.status <> 'registration' then raise exception 'Trénink už skončil.'; end if;
  me := public.bbx_training_reg(t.id);
  if me is null then raise exception 'Nejdřív se na trénink přidej.'; end if;
  if p_opponent = me then raise exception 'Sám sebe vyzvat nemůžeš.'; end if;
  if not exists (select 1 from public.registrations where id = p_opponent and tournament_id = t.id and status = 'active') then
    raise exception 'Hráč na tréninku není.';
  end if;
  select id into mid from public.training_matches
   where tournament_id = t.id and status in ('pending','active')
     and ((p1_reg = me and p2_reg = p_opponent) or (p1_reg = p_opponent and p2_reg = me)) limit 1;
  if mid is not null then return mid; end if;
  insert into public.training_matches (tournament_id, p1_reg, p2_reg, settings)
  values (t.id, me, p_opponent, jsonb_build_object('mode', '3v3', 'win', 7,
          'lineup', jsonb_build_object('p1', public.bbx_lineup(me), 'p2', public.bbx_lineup(p_opponent))))
  returning id into mid;
  return mid;
end $$;

create or replace function public.bbx_tmatch(p_match uuid, p_need_active boolean default true) returns public.training_matches
language plpgsql stable security definer set search_path = public as $$
declare m public.training_matches;
begin
  select * into m from public.training_matches where id = p_match;
  if not found then raise exception 'Výzva neexistuje.'; end if;
  if not exists (select 1 from public.registrations r where r.id in (m.p1_reg, m.p2_reg) and r.user_id = auth.uid()) then
    raise exception 'Tohle není tvoje výzva.';
  end if;
  if p_need_active and m.status <> 'active' then raise exception 'Výzva není aktivní.'; end if;
  return m;
end $$;
revoke execute on function public.bbx_tmatch(uuid, boolean) from public, anon, authenticated;

create or replace function public.training_respond(p_match uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m public.training_matches;
begin
  m := public.bbx_tmatch(p_match, false);
  if m.status <> 'pending' then raise exception 'Výzva už je vyřízená.'; end if;
  if (select user_id from public.registrations where id = m.p2_reg) is distinct from auth.uid() then
    raise exception 'Výzvu potvrzuje vyzvaný hráč.';
  end if;
  update public.training_matches set status = case when p_accept then 'active' else 'declined' end, updated_at = now()
   where id = m.id;
end $$;

-- ukončení dvojice (bez soubojů = zrušeno, jinak hotovo)
create or replace function public.training_end(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.training_matches;
begin
  m := public.bbx_tmatch(p_match, false);
  if m.status not in ('pending','active') then return; end if;
  update public.training_matches
     set status = case when exists (select 1 from public.training_battles where match_id = m.id) then 'done' else 'canceled' end,
         updated_at = now()
   where id = m.id;
end $$;

-- nastavení: mód, body na hru (null = neomezeně), sestavy obou hráčů
create or replace function public.training_setup(p_match uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.training_matches; mode text; win int; l1 jsonb; l2 jsonb; s jsonb; g record;
begin
  m := public.bbx_tmatch(p_match);
  mode := coalesce(p_settings->>'mode', m.settings->>'mode', '3v3');
  if mode not in ('3v3','3v1','1v3','1v1') then raise exception 'Neznámý mód tréninku.'; end if;
  if p_settings ? 'win' then win := nullif(p_settings->>'win', '')::int; else win := (m.settings->>'win')::int; end if;
  if win is not null and win not between 1 and 99 then raise exception 'Body na hru musí být 1–99, nebo neomezeně.'; end if;
  l1 := coalesce(p_settings->'lineup'->'p1', m.settings->'lineup'->'p1', '[]');
  l2 := coalesce(p_settings->'lineup'->'p2', m.settings->'lineup'->'p2', '[]');
  if jsonb_array_length(l1) > 3 or jsonb_array_length(l2) > 3 then raise exception 'Sestava má nejvýš 3 beye.'; end if;
  -- přepočítat jména z dílů (stejně jako registrace)
  select coalesce(jsonb_agg(public.bbx_normalize_deck(jsonb_build_array(b.value))->0
                            || jsonb_build_object('name', public.bbx_compose_bey(b.value, b.ordinality::int)) order by b.ordinality), '[]')
    into l1 from jsonb_array_elements(l1) with ordinality b;
  select coalesce(jsonb_agg(public.bbx_normalize_deck(jsonb_build_array(b.value))->0
                            || jsonb_build_object('name', public.bbx_compose_bey(b.value, b.ordinality::int)) order by b.ordinality), '[]')
    into l2 from jsonb_array_elements(l2) with ordinality b;
  s := jsonb_build_object('mode', mode, 'win', win, 'lineup', jsonb_build_object('p1', l1, 'p2', l2),
                          'next_game', (m.settings->>'next_game')::int);
  -- jiný mód nebo body → nová hra (pokud aktuální už začala)
  if (mode is distinct from m.settings->>'mode' or win is distinct from (m.settings->>'win')::int) then
    select * into g from public.bbx_tgame(m.id);
    if g.s1 + g.s2 > 0 or exists (select 1 from public.training_battles b where b.match_id = m.id and b.game_no = g.game_no) then
      s := s || jsonb_build_object('next_game', g.game_no + 1);
    end if;
  end if;
  update public.training_matches set settings = s, updated_at = now() where id = m.id;
  return s;
end $$;

-- stav aktuální hry (game_no, body) z uložených soubojů
-- změna módu nebo bodů v setupu začne novou hru (settings.next_game)
create or replace function public.bbx_tgame(p_match uuid) returns table (game_no int, s1 int, s2 int)
language sql stable security definer set search_path = public as $$
  with last as (select greatest(coalesce((select max(b.game_no) from public.training_battles b where b.match_id = p_match), 1),
                                coalesce((select (m.settings->>'next_game')::int from public.training_matches m where m.id = p_match), 1)) as g)
  select last.g,
         coalesce((select sum(pts) from public.training_battles b where b.match_id = p_match and b.game_no = last.g and scorer_slot = 1), 0)::int,
         coalesce((select sum(pts) from public.training_battles b where b.match_id = p_match and b.game_no = last.g and scorer_slot = 2), 0)::int
    from last
$$;
revoke execute on function public.bbx_tgame(uuid) from public, anon, authenticated;

-- jeden souboj; p_i1 / p_i2 = index beye v sestavě hráče p1 / p2 (null = nevybráno)
create or replace function public.training_battle(p_match uuid, p_client_id uuid, p_slot int, p_pts int, p_finish text,
                                                  p_i1 int, p_i2 int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.training_matches; g record; win int; gno int; a1 int; a2 int; actual int; b1 jsonb; b2 jsonb; sq int;
begin
  if p_client_id is not null and exists (select 1 from public.training_battles where client_id = p_client_id) then
    return public.training_state(p_match);
  end if;
  m := public.bbx_tmatch(p_match);
  if (select status from public.tournaments where id = m.tournament_id) <> 'registration' then raise exception 'Trénink už skončil.'; end if;
  if p_slot not in (0,1,2) or (p_slot <> 0 and p_pts not between 1 and 3) then raise exception 'Neplatný souboj.'; end if;
  select * into g from public.bbx_tgame(m.id);
  win := (m.settings->>'win')::int;
  gno := g.game_no; a1 := g.s1; a2 := g.s2;
  if win is not null and (a1 >= win or a2 >= win) then gno := gno + 1; a1 := 0; a2 := 0; end if;
  actual := case when p_slot = 0 then 0
                 when win is null then p_pts
                 else least(p_pts, win - case when p_slot = 1 then a1 else a2 end) end;
  b1 := case when p_i1 is not null then m.settings->'lineup'->'p1'->p_i1 end;
  b2 := case when p_i2 is not null then m.settings->'lineup'->'p2'->p_i2 end;
  sq := m.last_seq + 1;
  insert into public.training_battles (match_id, tournament_id, seq, game_no, scorer_slot, pts, finish, mode,
                                       p1_bey, p2_bey, p1_parts, p2_parts, created_by, client_id)
  values (m.id, m.tournament_id, sq, gno, p_slot, actual, public.bbx_finish(p_slot, p_pts, p_finish), m.settings->>'mode',
          b1->>'name', b2->>'name', b1 - 'name', b2 - 'name', auth.uid(), p_client_id);
  update public.training_matches set last_seq = sq, updated_at = now() where id = m.id;
  return public.training_state(p_match);
end $$;

create or replace function public.training_undo(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.training_matches;
begin
  m := public.bbx_tmatch(p_match);
  delete from public.training_battles where match_id = m.id and seq = (select max(seq) from public.training_battles where match_id = m.id);
  update public.training_matches set last_seq = coalesce((select max(seq) from public.training_battles where match_id = m.id), 0),
         updated_at = now() where id = m.id;
  return public.training_state(p_match);
end $$;

-- stav dvojice pro BBXST (oba telefony)
create or replace function public.training_state(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.training_matches; g record; me uuid;
begin
  m := public.bbx_tmatch(p_match, false);
  select * into g from public.bbx_tgame(m.id);
  select id into me from public.registrations where id in (m.p1_reg, m.p2_reg) and user_id = auth.uid() limit 1;
  return jsonb_build_object(
    'id', m.id, 'tournament_id', m.tournament_id, 'status', m.status, 'settings', m.settings, 'last_seq', m.last_seq,
    'me', case when me = m.p1_reg then 1 else 2 end,
    'p1', (select jsonb_build_object('reg', r.id, 'nick', r.nick, 'user_id', r.user_id) from public.registrations r where r.id = m.p1_reg),
    'p2', (select jsonb_build_object('reg', r.id, 'nick', r.nick, 'user_id', r.user_id) from public.registrations r where r.id = m.p2_reg),
    'challenger', (select r.user_id from public.registrations r where r.id = m.p1_reg),
    'decks', jsonb_build_object('p1', public.bbx_lineup(m.p1_reg), 'p2', public.bbx_lineup(m.p2_reg)),
    'tournament', (select jsonb_build_object('name', t.name, 'status', t.status) from public.tournaments t where t.id = m.tournament_id),
    'game', jsonb_build_object('no', g.game_no, 's1', g.s1, 's2', g.s2),
    'games', coalesce((select jsonb_agg(jsonb_build_object('no', x.game_no, 's1', x.s1, 's2', x.s2) order by x.game_no) from (
               select b.game_no, sum(pts) filter (where scorer_slot = 1) as s1, sum(pts) filter (where scorer_slot = 2) as s2
                 from public.training_battles b where b.match_id = m.id group by b.game_no) x), '[]'),
    'battles', coalesce((select jsonb_agg(jsonb_build_object('seq', b.seq, 'game', b.game_no, 'slot', b.scorer_slot, 'pts', b.pts,
                 'finish', b.finish, 'p1_bey', b.p1_bey, 'p2_bey', b.p2_bey) order by b.seq)
               from public.training_battles b where b.match_id = m.id and b.game_no = g.game_no), '[]'));
end $$;

-- BBXST: můj otevřený trénink, hráči na něm a moje výzvy
create or replace function public.my_training() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.registrations; t public.tournaments;
begin
  select r2.* into r from public.registrations r2 join public.tournaments t2 on t2.id = r2.tournament_id
   where r2.user_id = auth.uid() and r2.status = 'active' and t2.event_type = 'community' and t2.status = 'registration'
   order by r2.created_at desc limit 1;
  if not found then return null; end if;
  select * into t from public.tournaments where id = r.tournament_id;
  return jsonb_build_object(
    'tournament', jsonb_build_object('id', t.id, 'name', t.name, 'community', (select name from public.communities where id = t.community_id)),
    'me', jsonb_build_object('reg', r.id, 'nick', r.nick),
    'players', coalesce((select jsonb_agg(jsonb_build_object('reg', x.id, 'nick', x.nick) order by lower(x.nick))
                           from public.registrations x where x.tournament_id = t.id and x.status = 'active' and x.id <> r.id), '[]'),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status,
                           'incoming', m.p2_reg = r.id, 'opp_reg', case when m.p1_reg = r.id then m.p2_reg else m.p1_reg end,
                           'opponent', (select nick from public.registrations o where o.id = case when m.p1_reg = r.id then m.p2_reg else m.p1_reg end))
                           order by m.updated_at desc)
                           from public.training_matches m where (m.p1_reg = r.id or m.p2_reg = r.id) and m.status in ('pending','active')), '[]'));
end $$;

-- BBXU: celá stránka tréninku
create or replace function public.training_board(p_tournament uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tournaments; me uuid; lead boolean;
begin
  t := public.bbx_training(p_tournament);
  me := public.bbx_training_reg(t.id);
  lead := public.bbx_comm_lead(t.community_id);
  return jsonb_build_object(
    'community', (select jsonb_build_object('id', c.id, 'name', c.name) from public.communities c where c.id = t.community_id),
    'is_lead', lead,
    'is_member', public.bbx_comm_role(t.community_id) is not null,
    'invited', exists (select 1 from public.training_invites where tournament_id = t.id and user_id = auth.uid()),
    'other_training', (select jsonb_build_object('id', t2.id, 'name', t2.name) from public.registrations r2
                         join public.tournaments t2 on t2.id = r2.tournament_id
                        where r2.user_id = auth.uid() and r2.status = 'active' and t2.id <> t.id
                          and t2.event_type = 'community' and t2.status = 'registration' limit 1),
    'me', me,
    'players', coalesce((select jsonb_agg(jsonb_build_object('reg', r.id, 'user_id', r.user_id, 'nick', r.nick, 'avatar', p.avatar,
                           'has_deck', r.deck is not null,
                           'guest', not exists (select 1 from public.community_members cm where cm.community_id = t.community_id
                                                  and cm.user_id = r.user_id and cm.status = 'active'))
                           order by lower(r.nick))
                           from public.registrations r left join public.profiles p on p.id = r.user_id
                          where r.tournament_id = t.id and r.status = 'active'), '[]'),
    'matches', case when me is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
                           'id', m.id, 'status', m.status, 'incoming', m.p2_reg = me, 'mode', m.settings->>'mode',
                           'opponent', (select nick from public.registrations o where o.id = case when m.p1_reg = me then m.p2_reg else m.p1_reg end),
                           'opp_reg', case when m.p1_reg = me then m.p2_reg else m.p1_reg end,
                           'battles', m.last_seq, 'updated_at', m.updated_at)
                           order by (m.status in ('pending','active')) desc, m.updated_at desc)
                           from public.training_matches m where (m.p1_reg = me or m.p2_reg = me)
                            and m.status in ('pending','active','done')), '[]') end,
    'invites', case when lead then coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'nick', p.nick) order by p.nick)
                           from public.training_invites i join public.profiles p on p.id = i.user_id
                          where i.tournament_id = t.id
                            and not exists (select 1 from public.registrations r where r.tournament_id = t.id and r.user_id = i.user_id)), '[]') end);
end $$;

-- rozklad tréninkových soubojů na řádky hráčů (jako bbx_battles)
create or replace function public.bbx_training_battles(p_tournament uuid default null, p_community uuid default null)
returns table (tournament_id uuid, reg_id uuid, user_id uuid, nick text, bey text, parts jsonb, result int, pts int, pts_lost int,
               finish text, opp_bey text, opp_nick text, match_id uuid, seq int, game_no int, mode text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.tournament_id, r.id, r.user_id, r.nick, s.bey, s.parts,
         case when b.scorer_slot = 0 then 0 when b.scorer_slot = s.side then 1 else -1 end,
         case when b.scorer_slot = s.side then b.pts else 0 end,
         case when b.scorer_slot = 3 - s.side then b.pts else 0 end,
         b.finish, s.opp, o.nick, b.match_id, b.seq, b.game_no, b.mode, b.created_at
    from public.training_battles b
    join public.training_matches m on m.id = b.match_id
    join public.tournaments t on t.id = b.tournament_id
    cross join lateral (values (1, m.p1_reg, m.p2_reg, b.p1_bey, b.p1_parts, b.p2_bey),
                               (2, m.p2_reg, m.p1_reg, b.p2_bey, b.p2_parts, b.p1_bey)) s(side, reg, oreg, bey, parts, opp)
    join public.registrations r on r.id = s.reg
    join public.registrations o on o.id = s.oreg
   where (p_tournament is null or b.tournament_id = p_tournament)
     and (p_community is null or t.community_id = p_community)
$$;
revoke execute on function public.bbx_training_battles(uuid, uuid) from public, anon, authenticated;

-- moje historie v tréninku (dvojice → hry → souboje)
create or replace function public.training_history(p_tournament uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid;
begin
  perform public.bbx_training(p_tournament);
  me := (select id from public.registrations where tournament_id = p_tournament and user_id = auth.uid());
  if me is null then return jsonb_build_object('matches', '[]'::jsonb, 'totals', null); end if;
  return (with b as (select * from public.bbx_training_battles(p_tournament) where reg_id = me)
    select jsonb_build_object(
      'totals', jsonb_build_object('battles', count(*), 'wins', count(*) filter (where result = 1),
                                   'draws', count(*) filter (where result = 0), 'losses', count(*) filter (where result = -1),
                                   'points', coalesce(sum(pts), 0), 'points_lost', coalesce(sum(pts_lost), 0),
                                   'given', public.bbx_finish_counts(jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts)) filter (where result = 1)),
                                   'taken', public.bbx_finish_counts(jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts_lost)) filter (where result = -1))),
      'matches', coalesce((select jsonb_agg(x order by x->>'last' desc) from (
          select jsonb_build_object('match_id', match_id, 'opponent', min(opp_nick), 'last', max(created_at),
                   'points', sum(pts), 'points_lost', sum(pts_lost),
                   'wins', count(*) filter (where result = 1), 'losses', count(*) filter (where result = -1),
                   'battles', jsonb_agg(jsonb_build_object('seq', seq, 'game', game_no, 'mode', mode, 'bey', bey, 'opp_bey', opp_bey,
                                                           'result', result, 'pts', greatest(pts, pts_lost), 'finish', finish) order by seq)) as x
            from b group by match_id) q), '[]'))
    from b);
end $$;

-- comba seřazená podle úspěšnosti: moje ('me') nebo celý trénink ('all')
create or replace function public.training_combos(p_tournament uuid, p_scope text default 'me') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid;
begin
  perform public.bbx_training(p_tournament);
  me := (select id from public.registrations where tournament_id = p_tournament and user_id = auth.uid());
  return (with b as (select * from public.bbx_training_battles(p_tournament)
                      where bey is not null and (p_scope = 'all' or reg_id = me)),
          g as (select bey, count(*) as battles, count(*) filter (where result = 1) as wins,
                       count(*) filter (where result = 0) as draws, count(*) filter (where result = -1) as losses,
                       sum(pts) as points, sum(pts_lost) as points_lost, count(distinct reg_id) as players,
                       public.bbx_finish_counts(jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts)) filter (where result = 1)) as given
                  from b group by bey)
    select coalesce(jsonb_agg(jsonb_build_object('bey', bey, 'battles', battles, 'wins', wins, 'draws', draws, 'losses', losses,
                    'points', points, 'points_lost', points_lost, 'players', players, 'given', given,
                    'win_rate', round(100.0 * wins / battles, 1))
                    order by (wins::numeric / battles) desc, battles desc, bey), '[]') from g);
end $$;

-- meta komunity (jen její tréninky)
create or replace function public.community_meta(p_community uuid, p_kind text default 'build', p_min int default 5,
                                                 p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_kind not in ('build','blade','ratchet','bit') then raise exception 'Neznámý druh: %.', p_kind; end if;
  if not exists (select 1 from public.communities where id = p_community and status = 'approved') then
    raise exception 'Komunita neexistuje.';
  end if;
  return (
    with b as (
      select case when p_kind = 'build' then x.bey else public.bbx_part_of(x.parts, p_kind) end as name,
             x.result, x.pts, x.pts_lost, x.tournament_id, x.user_id::text as who
        from public.bbx_training_battles(null, p_community) x
        join public.tournaments t on t.id = x.tournament_id
       where x.bey is not null and (p_since is null or x.created_at >= p_since)
    ),
    g as (
      select name, count(*) as battles,
             count(*) filter (where result = 1) as wins, count(*) filter (where result = 0) as draws,
             count(*) filter (where result = -1) as losses,
             sum(pts) as points, sum(pts_lost) as points_lost,
             count(distinct who) as players, count(distinct tournament_id) as tournaments
        from b where name is not null group by name
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', name, 'battles', battles, 'wins', wins, 'draws', draws, 'losses', losses,
             'points', points, 'points_lost', points_lost, 'players', players, 'tournaments', tournaments,
             'win_rate', round(100.0 * wins / battles, 1), 'ppb', round(points::numeric / battles, 2))
           order by (wins::numeric / battles) desc, battles desc, name), '[]')
      from (select * from g where battles >= greatest(coalesce(p_min, 1), 1)
             order by (wins::numeric / battles) desc, battles desc limit 300) q
  );
end $$;

-- komunity, kde smím zakládat trénink (pro BBXU)
create or replace function public.my_lead_communities() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]')
    from public.communities c where c.status = 'approved' and public.bbx_comm_lead(c.id)
$$;

-- přehled akcí: navíc název komunity u tréninku
drop function if exists public.tournament_list();
create or replace function public.tournament_list() returns table (
  id uuid, kind text, name text, description text, location text, starts_at timestamptz, ends_at timestamptz,
  status text, swiss_rounds int, top_cut int, arena_count int, current_round int, max_players int,
  created_by uuid, organizer_nick text, players bigint, finished_at timestamptz, event_type text, community text)
language sql stable security definer set search_path = public as $$
  select t.id, t.kind, t.name, t.description, t.location, t.starts_at, t.ends_at, t.status, t.swiss_rounds, t.top_cut,
         t.arena_count, t.current_round, t.max_players, t.created_by, p.nick,
         (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'active'), t.finished_at,
         t.event_type, (select c.name from public.communities c where c.id = t.community_id)
    from public.tournaments t left join public.profiles p on p.id = t.created_by
   order by case t.status when 'swiss' then 0 when 'topcut' then 0 when 'show' then 0 when 'registration' then 1 else 2 end,
            case when t.status in ('finished','canceled') then null else t.starts_at end asc nulls last,
            t.starts_at desc nulls last
$$;
