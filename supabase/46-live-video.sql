-- ════════════════════════════════════════════════════════════════════
--  46: Živě – video z arény (kameraman)
--  • profiles.camera: funkce Kameraman. null = podle role (judge a výš ji mají automaticky),
--    true = přidělená hráči, false = odebraná. Mění jen admin / hlavní admin (set_camera).
--  • live_streams: kterou arénu turnaje kdo vysílá a kde – kanál na Twitchi (nebo video na YouTube).
--    Kameraman vysílá z aplikace Twitch v telefonu, v BBXU jen přiřadí kanál k aréně; Živě ho vloží
--    do karty arény (přehrávač Twitche / YouTube). Jedna aréna = jedno vysílání; nový kameraman převezme.
--    Video nejde přes Supabase ani přes nás – žádné náklady, neomezeně diváků, Twitch ho i nahrává.
--  Idempotentní.
-- ════════════════════════════════════════════════════════════════════

-- ── funkce Kameraman ──
alter table public.profiles add column if not exists camera boolean;

create or replace function public.bbx_protect_camera() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.bbx_privileged() and new.camera is distinct from old.camera then
    raise exception 'Funkci kameraman přiděluje admin.';
  end if;
  return new;
end $$;
revoke execute on function public.bbx_protect_camera() from public, anon, authenticated;
drop trigger if exists bbx_protect_camera on public.profiles;
create trigger bbx_protect_camera before update on public.profiles
  for each row execute function public.bbx_protect_camera();

-- smí přihlášený uživatel vysílat? (judge+ automaticky, jinak přidělená funkce; odebraná = ne)
create or replace function public.bbx_camera_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select not public.bbx_is_anon() and coalesce(
    (select coalesce(p.camera, public.bbx_role_level(p.role) >= 1) from public.profiles p where p.id = auth.uid()), false)
$$;
revoke execute on function public.bbx_camera_ok() from public, anon, authenticated;

create or replace function public.set_camera(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 3 then raise exception 'Funkci kameraman přiděluje admin.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Uživatel neexistuje.'; end if;
  if p_on and exists (select 1 from auth.users where id = p_user and coalesce(is_anonymous, false)) then
    raise exception 'Host (bez účtu) nemůže mít funkci.';
  end if;
  perform public.bbx_set_privileged();
  -- shodné s výchozím stavem podle role = null (pak se řídí rolí i po její změně)
  update public.profiles
     set camera = case when p_on = (public.bbx_role_level(role) >= 1) then null else p_on end
   where id = p_user;
end $$;
revoke execute on function public.set_camera(uuid, boolean) from public, anon;
grant execute on function public.set_camera(uuid, boolean) to authenticated;

-- ── vysílání ──
drop function if exists public.live_video_can(uuid, int);
drop function if exists public.live_video_beat(uuid, int, text);
drop function if exists public.live_video_start(uuid, int, text, jsonb);
drop function if exists public.live_video_list(uuid);
create table if not exists public.live_streams (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  arena         int  not null check (arena between 1 and 64),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  provider      text not null check (provider in ('twitch', 'youtube')),
  channel       text not null check (channel ~ '^[A-Za-z0-9_-]{3,25}$'),
  started_at    timestamptz not null default now(),
  primary key (tournament_id, arena)
);
alter table public.live_streams enable row level security;   -- jen přes RPC
revoke all on public.live_streams from anon, authenticated;

-- kanál z toho, co kameraman napíše: jméno kanálu, twitch.tv/…, nebo odkaz na video na YouTube
create or replace function public.bbx_parse_stream(p_url text, out provider text, out channel text)
language plpgsql immutable set search_path = public as $$
declare u text := btrim(coalesce(p_url, '')); m text[];
begin
  m := regexp_match(u, '(?:youtube\.com/(?:watch\?(?:[^#]*&)?v=|live/|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})', 'i');
  if m is not null then provider := 'youtube'; channel := m[1]; return; end if;
  m := regexp_match(u, '^(?:https?://)?(?:www\.|m\.)?twitch\.tv/([A-Za-z0-9_]{3,25})(?:[/?#].*)?$', 'i');
  if m is null then m := regexp_match(u, '^@?([A-Za-z0-9_]{3,25})$'); end if;
  if m is not null then provider := 'twitch'; channel := lower(m[1]); return; end if;
  raise exception 'Zadej jméno kanálu na Twitchi nebo odkaz na vysílání (twitch.tv/… nebo YouTube).';
end $$;
revoke execute on function public.bbx_parse_stream(text) from public, anon, authenticated;

-- přiřadit vysílání k aréně (převezme arénu, pokud ji vysílal někdo jiný)
create or replace function public.live_video_start(p_tournament uuid, p_arena int, p_url text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; s record;
begin
  if not public.bbx_camera_ok() then raise exception 'Vysílat může jen kameraman (judge a výš, nebo komu funkci přidělí admin).'; end if;
  select * into t from public.tournaments where id = p_tournament;
  if t.id is null or t.kind <> 'tournament' then raise exception 'Turnaj neexistuje.'; end if;
  if t.status not in ('swiss', 'topcut') then raise exception 'Vysílat jde jen během turnaje.'; end if;
  if p_arena is null or p_arena not between 1 and t.arena_count then raise exception 'Taková aréna v turnaji není.'; end if;
  select * into s from public.bbx_parse_stream(p_url);
  insert into public.live_streams (tournament_id, arena, user_id, provider, channel)
       values (p_tournament, p_arena, auth.uid(), s.provider, s.channel)
  on conflict (tournament_id, arena) do update
     set user_id = excluded.user_id, provider = excluded.provider, channel = excluded.channel, started_at = now();
  -- jeden telefon = jedna aréna: jiné vysílání téhož kameramana v turnaji skončí
  delete from public.live_streams where tournament_id = p_tournament and user_id = auth.uid() and arena <> p_arena;
  return jsonb_build_object('provider', s.provider, 'channel', s.channel);
end $$;
revoke execute on function public.live_video_start(uuid, int, text) from public, anon;
grant execute on function public.live_video_start(uuid, int, text) to authenticated;

-- konec: kameraman sám, organizátor turnaje nebo admin
create or replace function public.live_video_stop(p_tournament uuid, p_arena int) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.live_streams
   where tournament_id = p_tournament and arena = p_arena
     and (user_id = auth.uid() or public.bbx_can_manage(p_tournament));
end $$;
revoke execute on function public.live_video_stop(uuid, int) from public, anon;
grant execute on function public.live_video_stop(uuid, int) to authenticated;

-- co se teď vysílá (Živě, i bez přihlášení); po skončení turnaje nic
create or replace function public.live_video_list(p_tournament uuid)
returns table (arena int, provider text, channel text, nick text, started_at timestamptz, mine boolean, can_stop boolean)
language sql stable security definer set search_path = public as $$
  select s.arena, s.provider, s.channel, p.nick, s.started_at,
         coalesce(s.user_id = auth.uid(), false), coalesce(s.user_id = auth.uid() or public.bbx_can_manage(t.id), false)
    from public.live_streams s
    join public.tournaments t on t.id = s.tournament_id
    join public.profiles p on p.id = s.user_id
   where s.tournament_id = p_tournament
     and t.status in ('swiss', 'topcut') and public.bbx_can_see(t.visibility, t.created_by)
   order by s.arena
$$;
revoke execute on function public.live_video_list(uuid) from public;
grant execute on function public.live_video_list(uuid) to anon, authenticated;

-- jen pro klienta: smím vysílat? (tlačítko v Živě)
create or replace function public.live_video_me() returns boolean
language sql stable security definer set search_path = public as $$ select public.bbx_camera_ok() $$;
revoke execute on function public.live_video_me() from public, anon;
grant execute on function public.live_video_me() to authenticated;
