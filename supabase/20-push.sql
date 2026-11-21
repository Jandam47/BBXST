-- ════════════════════════════════════════════════════════════════════
--  20 – Push notifikace i při zavřené aplikaci (Web Push)
--
--  • push_subscriptions: odběry zařízení (push_subscribe / push_unsubscribe z BBXU, profil → Upozornění).
--  • bbx_push(uživatelé, titulek, text, odkaz, tag): zapíše zprávu do push_outbox a přes pg_net zavolá
--    Edge Function `push` (supabase/functions/push), která ji rozešle (VAPID klíče jsou jen v secrets funkce).
--    Adresa funkce, sdílené heslo a VAPID klíče jsou v soukromé tabulce bbx_settings (push_url, push_secret,
--    vapid_public, vapid_private, vapid_subject) – vkládají se ručně, nejsou v repozitáři. Bez nich (nebo bez
--    pg_net, např. lokální test) se jen zapíše outbox.
--    Chyba notifikace nikdy neshodí hlavní akci. Autor akce sám sobě nic nedostane.
--  • Události: zápas na aréně, start turnaje, výzva / přijetí výzvy na tréninku, zpráva v bazaru, info k turnaji
--    (přihlášeným hráčům) a obecné informace (všem s upozorněním), fashion show (molo, rozstřel, boss),
--    nové nahlášení (adminům).
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

create table if not exists public.bbx_settings (key text primary key, value text not null);
alter table public.bbx_settings enable row level security;
revoke all on public.bbx_settings from anon, authenticated;

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create table if not exists public.push_outbox (
  id         bigint generated always as identity primary key,
  user_ids   uuid[] not null,
  title      text not null,
  body       text,
  url        text,
  tag        text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  sent       int,
  failed     int
);
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.bbx_require_account();
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then raise exception 'Neplatný odběr.'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, ua) values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, created_at = now();
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

create or replace function public.push_status(p_endpoint text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('this_device', exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()),
                            'devices', (select count(*) from public.push_subscriptions where user_id = auth.uid()))
$$;

create or replace function public.bbx_push(p_users uuid[], p_title text, p_body text, p_url text, p_tag text) returns void
language plpgsql security definer set search_path = public as $$
declare uids uuid[]; oid bigint; u text; s text;
begin
  select array_agg(distinct ps.user_id) into uids from public.push_subscriptions ps
   where ps.user_id = any(p_users) and ps.user_id is distinct from auth.uid();
  if uids is null then return; end if;
  delete from public.push_outbox where created_at < now() - interval '3 days';
  insert into public.push_outbox (user_ids, title, body, url, tag)
  values (uids, left(p_title, 80), left(coalesce(p_body, ''), 180), p_url, p_tag) returning id into oid;
  select value into u from public.bbx_settings where key = 'push_url';
  select value into s from public.bbx_settings where key = 'push_secret';
  if u is null or s is null
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using u, jsonb_build_object('id', oid), jsonb_build_object('Content-Type', 'application/json', 'x-bbx-secret', s);
exception when others then
  raise warning 'bbx_push: %', sqlerrm;          -- notifikace nesmí shodit hlavní akci
end $$;
revoke execute on function public.bbx_push(uuid[], text, text, text, text) from public, anon, authenticated;

create or replace function public.bbx_reg_user(p_reg uuid) returns uuid
language sql stable security definer set search_path = public as $$ select user_id from public.registrations where id = p_reg $$;
create or replace function public.bbx_reg_nick(p_reg uuid) returns text
language sql stable security definer set search_path = public as $$ select nick from public.registrations where id = p_reg $$;
revoke execute on function public.bbx_reg_user(uuid) from public, anon, authenticated;
revoke execute on function public.bbx_reg_nick(uuid) from public, anon, authenticated;

-- ── zápas na aréně ───────────────────────────────────────────────────
create or replace function public.bbx_push_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare tn text;
begin
  if new.status = 'pending' and new.arena is not null and new.p1_reg is not null and new.p2_reg is not null
     and not coalesce(new.is_bye, false)
     and (tg_op = 'INSERT' or old.arena is distinct from new.arena or old.p1_reg is distinct from new.p1_reg
          or old.p2_reg is distinct from new.p2_reg or old.status is distinct from new.status) then
    select name into tn from public.tournaments where id = new.tournament_id;
    perform public.bbx_push(array[public.bbx_reg_user(new.p1_reg)], 'Aréna ' || new.arena || ' – tvůj zápas',
      'Hraješ proti ' || public.bbx_reg_nick(new.p2_reg) || ' · ' || tn, '#/t/' || new.tournament_id, 'match-' || new.id);
    perform public.bbx_push(array[public.bbx_reg_user(new.p2_reg)], 'Aréna ' || new.arena || ' – tvůj zápas',
      'Hraješ proti ' || public.bbx_reg_nick(new.p1_reg) || ' · ' || tn, '#/t/' || new.tournament_id, 'match-' || new.id);
  end if;
  return new;
end $$;
revoke execute on function public.bbx_push_match() from public, anon, authenticated;
drop trigger if exists bbx_push_match on public.matches;
create trigger bbx_push_match after insert or update of arena, status, p1_reg, p2_reg on public.matches
  for each row execute function public.bbx_push_match();

-- ── turnaj začal, fashion show ───────────────────────────────────────
create or replace function public.bbx_push_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
declare f jsonb := new.fashion; o jsonb := old.fashion; judges uuid[];
begin
  if new.kind = 'tournament' and old.status = 'registration' and new.status = 'swiss' then
    perform public.bbx_push(array(select user_id from public.registrations where tournament_id = new.id and status = 'active' and user_id is not null),
      'Turnaj začal', new.name || ' – mrkni na svůj první zápas.', '#/t/' || new.id, 'start-' || new.id);
  end if;
  if new.event_type = 'fashion' and new.status = 'show' and f is not null then
    select array_agg(user_id) into judges from public.fashion_judges where tournament_id = new.id;
    if f->>'phase' = 'scoring' and f->>'current' is not null and (f->>'current') is distinct from (o->>'current') then
      perform public.bbx_push(array[public.bbx_reg_user((f->>'current')::uuid)], 'Jsi na řadě na molu!', new.name, '#/t/' || new.id || '/me', 'fx-' || (f->>'current'));
      perform public.bbx_push(judges, 'Na molu: ' || public.bbx_reg_nick((f->>'current')::uuid), 'Ohodnoť – ' || new.name, '#/t/' || new.id || '/show', 'fx-j-' || new.id);
    elsif f->>'phase' = 'tiebreak' and (o->>'phase') is distinct from 'tiebreak' then
      perform public.bbx_push(judges, 'Rozstřel o 1. místo', 'Hlasuj – ' || new.name, '#/t/' || new.id || '/show', 'fx-tie-' || new.id);
    elsif f->>'phase' = 'boss' and (o->>'phase') is distinct from 'boss' and f->>'boss' is not null then
      perform public.bbx_push(array[(f->>'boss')::uuid], 'Jsi boss of fashion!', 'Vyber vítěze – ' || new.name, '#/t/' || new.id || '/show', 'fx-boss-' || new.id);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_push_tournament() from public, anon, authenticated;
drop trigger if exists bbx_push_tournament on public.tournaments;
create trigger bbx_push_tournament after update of status, fashion on public.tournaments
  for each row execute function public.bbx_push_tournament();

-- ── komunitní trénink: výzva a přijetí ───────────────────────────────
create or replace function public.bbx_push_training() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.bbx_push(array[public.bbx_reg_user(new.p2_reg)], public.bbx_reg_nick(new.p1_reg) || ' tě vyzývá na souboj',
      'Komunitní trénink – potvrď výzvu.', '#/t/' || new.tournament_id || '/me', 'tr-' || new.id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    perform public.bbx_push(array[public.bbx_reg_user(new.p1_reg)], public.bbx_reg_nick(new.p2_reg) || ' přijal výzvu',
      'Otevři BBXST v training módu.', 'bbxst.html?training=' || new.id, 'tr-' || new.id);
  end if;
  return new;
end $$;
revoke execute on function public.bbx_push_training() from public, anon, authenticated;
drop trigger if exists bbx_push_training on public.training_matches;
create trigger bbx_push_training after insert or update of status on public.training_matches
  for each row execute function public.bbx_push_training();

-- ── bazar ────────────────────────────────────────────────────────────
create or replace function public.bbx_push_bazar() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.bazar_ads;
begin
  select * into a from public.bazar_ads where id = new.ad_id;
  perform public.bbx_push(array[case when new.author_id = new.buyer_id then a.user_id else new.buyer_id end],
    new.nick || ' ti napsal v bazaru', a.title || ': ' || new.body, '#/bazar/' || new.ad_id, 'bz-' || new.ad_id);
  return new;
end $$;
revoke execute on function public.bbx_push_bazar() from public, anon, authenticated;
drop trigger if exists bbx_push_bazar on public.bazar_comments;
create trigger bbx_push_bazar after insert on public.bazar_comments
  for each row execute function public.bbx_push_bazar();

-- ── info k turnaji a obecné informace ────────────────────────────────
create or replace function public.bbx_push_chat() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.chat_rooms;
begin
  select * into r from public.chat_rooms where id = new.room_id;
  if r.kind = 'info_t' and r.state = 'active' then
    perform public.bbx_push(array(select user_id from public.registrations where tournament_id = r.tournament_id and status = 'active' and user_id is not null),
      '📢 ' || r.name, new.nick || ': ' || new.body, '#/chat/' || r.id, 'chat-' || r.id);
  elsif r.kind = 'info' then
    perform public.bbx_push(array(select distinct user_id from public.push_subscriptions),
      '📢 ' || r.name, new.nick || ': ' || new.body, '#/chat/' || r.id, 'chat-' || r.id);
  end if;
  return new;
end $$;
revoke execute on function public.bbx_push_chat() from public, anon, authenticated;
drop trigger if exists bbx_push_chat on public.chat_messages;
create trigger bbx_push_chat after insert on public.chat_messages
  for each row execute function public.bbx_push_chat();

-- ── nové nahlášení → admini ──────────────────────────────────────────
create or replace function public.bbx_push_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.bbx_push(array(select id from public.profiles where role in ('admin','superadmin')),
    'Nové nahlášení', case new.kind when 'chat_message' then 'Zpráva v chatu' when 'bazar_ad' then 'Inzerát v bazaru' else 'Komentář v bazaru' end
      || ' – mrkni do profilu.', '#/me', 'report');
  return new;
end $$;
revoke execute on function public.bbx_push_report() from public, anon, authenticated;
drop trigger if exists bbx_push_report on public.reports;
create trigger bbx_push_report after insert on public.reports
  for each row execute function public.bbx_push_report();
