-- ════════════════════════════════════════════════════════════════════
--  17 – Nový chat a bazar
--
--  CHAT (jen přihlášení s účtem; Info k turnaji čte každý)
--  • Zkušební chat ('volny', přejmenovaný i se zprávami) – píše každý s účtem.
--  • Info k turnaji: pevná místnost Obecné informace ('info') + místnost ke každému turnaji
--    ('t-<id>', název „DD.MM.RRRR Název“, zakládá / přejmenovává trigger na tournaments, jen kind 'tournament').
--    Čte každý, píšou organizátoři a admini.
--  • Komunitní chat ('c-<id>' pro každou schválenou komunitu): čtou a píšou aktivní členové; leader a zástupce
--    můžou na X minut pozvat hosta (chat_guests) – volitelně bez starých zpráv (vidí jen zprávy od pozvání).
--  • Ostatní staré místnosti (Tréninky, Turnaje, Cestování, Poptávky, Prodeje) se mažou i se zprávami.
--
--  BAZAR (jen přihlášení s účtem)
--  • bazar_ads: co prodávám, cena (null = dohodou), popis, 1–3 fotky v úložišti 'bazar' (<uid>/<soubor>.jpg),
--    stav active / sold. Vše přes RPC (bazar_list, bazar_ad, bazar_save, bazar_set_status, bazar_delete).
--  • bazar_comments: soukromé vlákno zájemce ↔ prodejce (buyer_id = zájemce). Zájemce vidí jen svoje vlákno,
--    prodejce všechna. Psaní přes bazar_comment; čtení i realtime přes RLS.
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

-- ── místnosti ────────────────────────────────────────────────────────
alter table public.chat_rooms add column if not exists kind text not null default 'test';
alter table public.chat_rooms add column if not exists tournament_id uuid references public.tournaments(id) on delete cascade;
alter table public.chat_rooms add column if not exists community_id uuid references public.communities(id) on delete cascade;
alter table public.chat_rooms add column if not exists at timestamptz;
alter table public.chat_rooms drop constraint if exists chat_rooms_kind_chk;
alter table public.chat_rooms add constraint chat_rooms_kind_chk check (kind in ('test','info','info_t','community'));

delete from public.chat_rooms where id in ('treninky','turnaje','cestovani','poptavky','prodeje');
insert into public.chat_rooms (id, name, icon, sort, kind) values ('volny', 'Zkušební chat', '💬', 0, 'test')
on conflict (id) do update set name = 'Zkušební chat', icon = '💬', sort = 0, kind = 'test';
insert into public.chat_rooms (id, name, icon, sort, kind) values ('info', 'Obecné informace', '📢', 1, 'info')
on conflict (id) do update set name = 'Obecné informace', icon = '📢', sort = 1, kind = 'info';

create table if not exists public.chat_guests (
  room_id     text not null references public.chat_rooms(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  invited_by  uuid references auth.users(id) on delete set null,
  until       timestamptz not null,
  see_history boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.chat_guests enable row level security;
revoke all on public.chat_guests from anon, authenticated;

-- název místnosti turnaje: „20.11.2026 Název“
create or replace function public.bbx_troom_name(t public.tournaments) returns text
language sql stable set search_path = public as $$
  select to_char(coalesce(t.starts_at, t.created_at) at time zone 'Europe/Prague', 'DD.MM.YYYY') || ' ' || t.name
$$;
revoke execute on function public.bbx_troom_name(public.tournaments) from public, anon, authenticated;

create or replace function public.bbx_chat_sync_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'tournament' then
    insert into public.chat_rooms (id, name, icon, sort, kind, tournament_id, at)
    values ('t-' || new.id, public.bbx_troom_name(new), '🏆', 10, 'info_t', new.id, coalesce(new.starts_at, new.created_at))
    on conflict (id) do update set name = excluded.name, at = excluded.at;
  else
    delete from public.chat_rooms where id = 't-' || new.id;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_chat_sync_tournament() from public, anon, authenticated;
drop trigger if exists bbx_chat_sync_tournament on public.tournaments;
create trigger bbx_chat_sync_tournament after insert or update of name, starts_at, kind on public.tournaments
  for each row execute function public.bbx_chat_sync_tournament();

create or replace function public.bbx_chat_sync_community() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' then
    insert into public.chat_rooms (id, name, icon, sort, kind, community_id, at)
    values ('c-' || new.id, new.name, '👥', 20, 'community', new.id, new.created_at)
    on conflict (id) do update set name = excluded.name;
  else
    delete from public.chat_rooms where id = 'c-' || new.id;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_chat_sync_community() from public, anon, authenticated;
drop trigger if exists bbx_chat_sync_community on public.communities;
create trigger bbx_chat_sync_community after insert or update of status, name on public.communities
  for each row execute function public.bbx_chat_sync_community();

-- doplnit místnosti pro existující turnaje a komunity
insert into public.chat_rooms (id, name, icon, sort, kind, tournament_id, at)
select 't-' || t.id, public.bbx_troom_name(t), '🏆', 10, 'info_t', t.id, coalesce(t.starts_at, t.created_at)
  from public.tournaments t where t.kind = 'tournament'
on conflict (id) do update set name = excluded.name, at = excluded.at;
insert into public.chat_rooms (id, name, icon, sort, kind, community_id, at)
select 'c-' || c.id, c.name, '👥', 20, 'community', c.id, c.created_at from public.communities c where c.status = 'approved'
on conflict (id) do update set name = excluded.name;

-- ── přístup ──────────────────────────────────────────────────────────
-- čtení místnosti (p_at = čas zprávy; host bez starých zpráv vidí jen zprávy od pozvání)
create or replace function public.bbx_chat_read(p_room text, p_at timestamptz default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case r.kind
      when 'info' then true
      when 'info_t' then true
      when 'test' then auth.uid() is not null and not public.bbx_is_anon()
      when 'community' then auth.uid() is not null and not public.bbx_is_anon() and (
        public.bbx_comm_role(r.community_id) is not null
        or exists (select 1 from public.chat_guests g where g.room_id = r.id and g.user_id = auth.uid() and g.until > now()
                     and (g.see_history or p_at is null or p_at >= g.created_at)))
      else false end
    from public.chat_rooms r where r.id = p_room), false)
$$;

create or replace function public.bbx_chat_write(p_room text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select auth.uid() is not null and not public.bbx_is_anon() and case r.kind
      when 'test' then true
      when 'info' then public.bbx_my_level() >= 2
      when 'info_t' then public.bbx_my_level() >= 2
      when 'community' then public.bbx_comm_role(r.community_id) is not null
        or exists (select 1 from public.chat_guests g where g.room_id = r.id and g.user_id = auth.uid() and g.until > now())
      else false end
    from public.chat_rooms r where r.id = p_room), false)
$$;

-- mazání: vlastní zpráva, admin, nebo leader / zástupce v komunitní místnosti
create or replace function public.bbx_chat_moderate(p_room text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.bbx_my_level() >= 3
      or coalesce((select r.kind = 'community' and public.bbx_comm_lead(r.community_id) from public.chat_rooms r where r.id = p_room), false)
$$;

drop policy if exists cr_read on public.chat_rooms;
create policy cr_read on public.chat_rooms for select using (public.bbx_chat_read(id));
drop policy if exists cm_read on public.chat_messages;
create policy cm_read on public.chat_messages for select using (public.bbx_chat_read(room_id, created_at));
drop policy if exists cm_insert on public.chat_messages;
create policy cm_insert on public.chat_messages for insert with check (public.bbx_chat_write(room_id));
drop policy if exists cm_delete on public.chat_messages;
create policy cm_delete on public.chat_messages for delete using (user_id = auth.uid() or public.bbx_chat_moderate(room_id));

-- seznam místností s poslední zprávou (jen ty, které smím číst)
create or replace function public.chat_room_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'icon', r.icon, 'kind', r.kind, 'sort', r.sort, 'at', r.at,
      'tournament_status', (select t.status from public.tournaments t where t.id = r.tournament_id),
      'can_write', public.bbx_chat_write(r.id),
      'guest_until', (select g.until from public.chat_guests g where g.room_id = r.id and g.user_id = auth.uid() and g.until > now()
                        and public.bbx_comm_role(r.community_id) is null),
      'last', (select jsonb_build_object('id', m.id, 'nick', m.nick, 'body', m.body, 'created_at', m.created_at)
                 from public.chat_messages m where m.room_id = r.id and public.bbx_chat_read(r.id, m.created_at)
                order by m.id desc limit 1))
      order by r.sort, r.at desc nulls last, r.name), '[]')
    from public.chat_rooms r
   where public.bbx_chat_read(r.id)
     and (r.kind <> 'info_t' or (select t.status from public.tournaments t where t.id = r.tournament_id) <> 'canceled')
$$;

create or replace function public.chat_room_info(p_room text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.chat_rooms; lead boolean;
begin
  select * into r from public.chat_rooms where id = p_room;
  if not found or not public.bbx_chat_read(p_room) then raise exception 'Do téhle místnosti nemáš přístup.'; end if;
  lead := r.kind = 'community' and public.bbx_comm_lead(r.community_id);
  return jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'name', r.name, 'icon', r.icon, 'kind', r.kind,
                               'tournament_id', r.tournament_id, 'community_id', r.community_id),
    'can_write', public.bbx_chat_write(p_room),
    'can_moderate', public.bbx_chat_moderate(p_room),
    'is_lead', lead,
    'guest', (select jsonb_build_object('until', g.until, 'see_history', g.see_history) from public.chat_guests g
               where g.room_id = r.id and g.user_id = auth.uid() and g.until > now()
                 and (r.kind <> 'community' or public.bbx_comm_role(r.community_id) is null)),
    'guests', case when lead then coalesce((select jsonb_agg(jsonb_build_object('user_id', g.user_id, 'nick', p.nick, 'until', g.until,
                       'see_history', g.see_history) order by g.until)
                       from public.chat_guests g join public.profiles p on p.id = g.user_id
                      where g.room_id = r.id and g.until > now()), '[]') end);
end $$;

-- pozvání hosta do komunitního chatu
create or replace function public.chat_guest_invite(p_room text, p_user uuid, p_minutes int, p_history boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r public.chat_rooms;
begin
  select * into r from public.chat_rooms where id = p_room;
  if not found or r.kind <> 'community' then raise exception 'Hosty jde zvát jen do komunitního chatu.'; end if;
  if not public.bbx_comm_lead(r.community_id) then raise exception 'Hosty zve leader nebo zástupce komunity.'; end if;
  if p_minutes is null or p_minutes not between 1 and 10080 then raise exception 'Přístup může být na 1 minutu až 7 dní.'; end if;
  if not exists (select 1 from public.profiles p join auth.users u on u.id = p.id
                  where p.id = p_user and p.nick is not null and not coalesce(u.is_anonymous, false)) then
    raise exception 'Pozvat jde jen hráče s účtem.';
  end if;
  if public.bbx_comm_role(r.community_id, p_user) is not null then raise exception 'Hráč je člen komunity – chat už vidí.'; end if;
  insert into public.chat_guests (room_id, user_id, invited_by, until, see_history, created_at)
  values (r.id, p_user, auth.uid(), now() + make_interval(mins => p_minutes), coalesce(p_history, false), now())
  on conflict (room_id, user_id) do update
    set until = excluded.until, see_history = excluded.see_history, invited_by = excluded.invited_by, created_at = excluded.created_at;
end $$;

create or replace function public.chat_guest_remove(p_room text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.chat_rooms;
begin
  select * into r from public.chat_rooms where id = p_room;
  if not found or r.kind <> 'community' or not public.bbx_comm_lead(r.community_id) then
    raise exception 'Hosty odebírá leader nebo zástupce komunity.';
  end if;
  delete from public.chat_guests where room_id = r.id and user_id = p_user;
end $$;

-- ════════════════════════════════════════════════════════════════════
--  BAZAR
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.bazar_ads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  price       int,
  description text,
  photos      text[] not null default '{}',
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint bazar_title_chk check (char_length(btrim(title)) between 3 and 80),
  constraint bazar_price_chk check (price is null or price between 0 and 1000000),
  constraint bazar_desc_chk check (coalesce(char_length(description), 0) <= 1000),
  constraint bazar_photos_chk check (cardinality(photos) between 1 and 3),
  constraint bazar_status_chk check (status in ('active','sold'))
);
create index if not exists bazar_ads_created on public.bazar_ads (created_at desc);
alter table public.bazar_ads enable row level security;
revoke all on public.bazar_ads from anon, authenticated;

create table if not exists public.bazar_comments (
  id         bigint generated always as identity primary key,
  ad_id      uuid not null references public.bazar_ads(id) on delete cascade,
  buyer_id   uuid not null references auth.users(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  nick       text,
  avatar     text,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint bazar_body_chk check (char_length(btrim(body)) between 1 and 1000)
);
create index if not exists bazar_comments_ad on public.bazar_comments (ad_id, buyer_id, id);
alter table public.bazar_comments enable row level security;
revoke all on public.bazar_comments from anon, authenticated;
grant select on public.bazar_comments to authenticated;

create or replace function public.bbx_bazar_owner(p_ad uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from public.bazar_ads where id = p_ad
$$;
drop policy if exists bc_read on public.bazar_comments;
create policy bc_read on public.bazar_comments for select to authenticated
  using (buyer_id = auth.uid() or public.bbx_bazar_owner(ad_id) = auth.uid());
do $$ begin
  alter publication supabase_realtime add table public.bazar_comments;
exception when duplicate_object then null; end $$;

create or replace function public.bbx_bazar_photos(p_photos text[]) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare x text;
begin
  if p_photos is null or cardinality(p_photos) not between 1 and 3 then raise exception 'Přidej 1 až 3 fotky.'; end if;
  foreach x in array p_photos loop
    if x !~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.(jpg|webp)$') then raise exception 'Neplatná fotka.'; end if;
  end loop;
  return p_photos;
end $$;
revoke execute on function public.bbx_bazar_photos(text[]) from public, anon, authenticated;

create or replace function public.bazar_save(p_id uuid, p_title text, p_price int, p_description text, p_photos text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform public.bbx_require_account();
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 80 then raise exception 'Napiš, co prodáváš (3–80 znaků).'; end if;
  if p_price is not null and p_price not between 0 and 1000000 then raise exception 'Cena musí být 0 až 1 000 000 Kč.'; end if;
  if p_id is null then
    if (select count(*) from public.bazar_ads where user_id = auth.uid() and status = 'active') >= 20 then
      raise exception 'Máš 20 aktivních inzerátů – nejdřív nějaký označ jako prodaný nebo smaž.';
    end if;
    insert into public.bazar_ads (user_id, title, price, description, photos)
    values (auth.uid(), btrim(p_title), p_price, nullif(btrim(p_description), ''), public.bbx_bazar_photos(p_photos))
    returning id into rid;
  else
    update public.bazar_ads set title = btrim(p_title), price = p_price, description = nullif(btrim(p_description), ''),
           photos = public.bbx_bazar_photos(p_photos), updated_at = now()
     where id = p_id and user_id = auth.uid() returning id into rid;
    if rid is null then raise exception 'Upravit můžeš jen svůj inzerát.'; end if;
  end if;
  return rid;
end $$;

create or replace function public.bazar_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('active','sold') then raise exception 'Neplatný stav.'; end if;
  update public.bazar_ads set status = p_status, updated_at = now() where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Stav mění jen prodejce.'; end if;
end $$;

-- smaže inzerát a vrátí cesty fotek (klient je smaže z úložiště)
create or replace function public.bazar_delete(p_id uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare ph text[];
begin
  delete from public.bazar_ads where id = p_id and (user_id = auth.uid() or public.bbx_my_level() >= 3) returning photos into ph;
  if ph is null then raise exception 'Smazat můžeš jen svůj inzerát.'; end if;
  return ph;
end $$;

create or replace function public.bazar_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or public.bbx_is_anon() then raise exception 'Bazar vidí jen přihlášení hráči.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'price', a.price, 'photo', a.photos[1], 'status', a.status, 'created_at', a.created_at,
      'mine', a.user_id = auth.uid(), 'nick', p.nick, 'avatar', p.avatar,
      'threads', case when a.user_id = auth.uid() then (select count(distinct c.buyer_id) from public.bazar_comments c where c.ad_id = a.id) end,
      'last_comment', (select max(c.id) from public.bazar_comments c where c.ad_id = a.id
                         and (a.user_id = auth.uid() or c.buyer_id = auth.uid())))
      order by (a.status = 'active') desc, a.created_at desc)
    from public.bazar_ads a left join public.profiles p on p.id = a.user_id
   where a.status = 'active' or a.updated_at > now() - interval '14 days' or a.user_id = auth.uid()), '[]');
end $$;

create or replace function public.bazar_ad(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.bazar_ads; mine boolean;
begin
  if auth.uid() is null or public.bbx_is_anon() then raise exception 'Bazar vidí jen přihlášení hráči.'; end if;
  select * into a from public.bazar_ads where id = p_id;
  if not found then raise exception 'Inzerát už neexistuje.'; end if;
  mine := a.user_id = auth.uid();
  return jsonb_build_object(
    'ad', jsonb_build_object('id', a.id, 'title', a.title, 'price', a.price, 'description', a.description, 'photos', a.photos,
                             'status', a.status, 'created_at', a.created_at, 'updated_at', a.updated_at, 'user_id', a.user_id),
    'seller', (select jsonb_build_object('id', p.id, 'nick', p.nick, 'avatar', p.avatar) from public.profiles p where p.id = a.user_id),
    'mine', mine, 'can_delete', mine or public.bbx_my_level() >= 3,
    'threads', coalesce((select jsonb_agg(th order by th->>'last' desc) from (
        select jsonb_build_object('buyer', (select jsonb_build_object('id', p.id, 'nick', p.nick, 'avatar', p.avatar)
                                              from public.profiles p where p.id = c.buyer_id),
                                  'last', max(c.created_at),
                                  'comments', jsonb_agg(jsonb_build_object('id', c.id, 'author_id', c.author_id, 'nick', c.nick,
                                               'avatar', c.avatar, 'body', c.body, 'created_at', c.created_at) order by c.id)) as th
          from public.bazar_comments c
         where c.ad_id = a.id and (mine or c.buyer_id = auth.uid())
         group by c.buyer_id) q), '[]'));
end $$;

-- komentář: zájemce píše do svého vlákna, prodejce odpovídá do vlákna zájemce (p_buyer)
create or replace function public.bazar_comment(p_ad uuid, p_body text, p_buyer uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.bazar_ads; prof public.profiles; buyer uuid;
begin
  perform public.bbx_require_account();
  select * into a from public.bazar_ads where id = p_ad;
  if not found then raise exception 'Inzerát už neexistuje.'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then raise exception 'Komentář má 1–1000 znaků.'; end if;
  if a.user_id = auth.uid() then
    if p_buyer is null or not exists (select 1 from public.bazar_comments where ad_id = a.id and buyer_id = p_buyer) then
      raise exception 'Odpovídat jde jen na komentář zájemce.';
    end if;
    buyer := p_buyer;
  else
    if a.status <> 'active' then raise exception 'Inzerát je prodaný.'; end if;
    buyer := auth.uid();
  end if;
  if exists (select 1 from public.bazar_comments where author_id = auth.uid() and created_at > now() - interval '1 second') then
    raise exception 'Zpomal :)';
  end if;
  select * into prof from public.profiles where id = auth.uid();
  insert into public.bazar_comments (ad_id, buyer_id, author_id, nick, avatar, body)
  values (a.id, buyer, auth.uid(), prof.nick, prof.avatar, btrim(p_body));
end $$;

-- ── úložiště fotek (jen v Supabase; lokální test DB schéma storage nemá) ──
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('bazar', 'bazar', true, 1048576, array['image/jpeg', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/webp'];
    execute 'drop policy if exists bazar_upload on storage.objects';
    execute $p$create policy bazar_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'bazar' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists bazar_remove on storage.objects';
    execute $p$create policy bazar_remove on storage.objects for delete to authenticated
      using (bucket_id = 'bazar' and ((storage.foldername(name))[1] = auth.uid()::text or public.bbx_my_level() >= 3))$p$;
  end if;
end $$;
