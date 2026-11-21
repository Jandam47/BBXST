-- ════════════════════════════════════════════════════════════════════
--  19 – Smazání účtu a nahlašování obsahu
--
--  • delete_my_account(nick): smaže účet (auth.users → profil, zprávy, bazar, členství, odběry…).
--    Turnajové výsledky zůstanou, ale registrace se anonymizují („Smazaný hráč XXXX“, bez vazby na účet).
--    Nejde pro hlavního admina ani pro leadera komunity (komunitu musí nejdřív smazat / předat hlavní admin).
--    Fotky z bazaru smaže klient předem (bazar_my_photos), dokud je ještě přihlášený.
--  • reports: nahlášení zprávy v chatu, inzerátu nebo komentáře v bazaru (report_create, kdokoliv s účtem,
--    jen obsah, který vidí). Admini (úroveň 3+) je řeší v profilu: report_list, report_resolve (smazat obsah /
--    ponechat). Ukládá se kopie obsahu, aby šlo posoudit i smazané.
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

-- ── smazání účtu ─────────────────────────────────────────────────────
create or replace function public.bazar_my_photos() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p), '{}') from public.bazar_ads a, unnest(a.photos) p where a.user_id = auth.uid()
$$;

create or replace function public.delete_my_account(p_nick text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); prof public.profiles; c text; tag text;
begin
  if me is null or public.bbx_is_anon() then raise exception 'Smazat jde jen účet, ne hosta.'; end if;
  select * into prof from public.profiles where id = me;
  if prof.nick is null or lower(btrim(coalesce(p_nick, ''))) <> lower(prof.nick) then
    raise exception 'Pro potvrzení napiš přesně svůj nick.';
  end if;
  if public.bbx_my_level() >= 4 then raise exception 'Hlavní admin svůj účet smazat nemůže.'; end if;
  select string_agg(cm.name, ', ') into c from public.community_members m join public.communities cm on cm.id = m.community_id
   where m.user_id = me and m.role = 'leader' and cm.status <> 'rejected';
  if c is not null then raise exception 'Jsi leader komunity %. Napiš hlavnímu adminovi, ať ji předá nebo smaže.', c; end if;

  perform public.bbx_set_privileged();
  tag := upper(substr(replace(me::text, '-', ''), 1, 4));
  update public.registrations set nick = 'Smazaný hráč ' || tag || case when n > 1 then '-' || n else '' end, user_id = null
    from (select id as rid, row_number() over (partition by tournament_id order by id) as n from public.registrations where user_id = me) x
   where id = x.rid;
  delete from auth.users where id = me;
end $$;

-- ── nahlášení ────────────────────────────────────────────────────────
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  kind        text not null,
  target      text not null,
  reporter    uuid references auth.users(id) on delete set null,
  reason      text not null,
  note        text,
  snapshot    jsonb not null default '{}',
  status      text not null default 'open',
  created_at  timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  action      text,
  constraint report_kind_chk check (kind in ('chat_message','bazar_ad','bazar_comment')),
  constraint report_reason_chk check (reason in ('spam','urazky','nevhodne','podvod','jine')),
  constraint report_note_chk check (coalesce(char_length(note), 0) <= 300),
  constraint report_status_chk check (status in ('open','done'))
);
create unique index if not exists reports_once on public.reports (kind, target, reporter) where status = 'open';
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

create or replace function public.report_create(p_kind text, p_target text, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare snap jsonb; m public.chat_messages; a public.bazar_ads; c public.bazar_comments;
begin
  perform public.bbx_require_account();
  if p_kind = 'chat_message' then
    select * into m from public.chat_messages where id = p_target::bigint;
    if not found or not public.bbx_chat_read(m.room_id, m.created_at) then raise exception 'Zpráva neexistuje.'; end if;
    if m.user_id = auth.uid() then raise exception 'Vlastní zprávu nahlásit nejde – smaž ji.'; end if;
    snap := jsonb_build_object('body', m.body, 'author_id', m.user_id, 'nick', m.nick, 'room_id', m.room_id,
                               'room', (select name from public.chat_rooms where id = m.room_id), 'at', m.created_at);
  elsif p_kind = 'bazar_ad' then
    select * into a from public.bazar_ads where id = p_target::uuid;
    if not found then raise exception 'Inzerát neexistuje.'; end if;
    if a.user_id = auth.uid() then raise exception 'Vlastní inzerát nahlásit nejde.'; end if;
    snap := jsonb_build_object('title', a.title, 'body', a.description, 'price', a.price, 'photos', a.photos, 'author_id', a.user_id,
                               'nick', (select nick from public.profiles where id = a.user_id), 'ad_id', a.id, 'at', a.created_at);
  elsif p_kind = 'bazar_comment' then
    select * into c from public.bazar_comments where id = p_target::bigint;
    if not found or not (c.buyer_id = auth.uid() or public.bbx_bazar_owner(c.ad_id) = auth.uid()) then raise exception 'Komentář neexistuje.'; end if;
    if c.author_id = auth.uid() then raise exception 'Vlastní komentář nahlásit nejde.'; end if;
    snap := jsonb_build_object('body', c.body, 'author_id', c.author_id, 'nick', c.nick, 'ad_id', c.ad_id,
                               'title', (select title from public.bazar_ads where id = c.ad_id), 'at', c.created_at);
  else
    raise exception 'Tohle nahlásit nejde.';
  end if;
  if p_reason not in ('spam','urazky','nevhodne','podvod','jine') then raise exception 'Vyber důvod.'; end if;
  insert into public.reports (kind, target, reporter, reason, note, snapshot)
  values (p_kind, p_target, auth.uid(), p_reason, nullif(btrim(p_note), ''), snap)
  on conflict do nothing;
end $$;

create or replace function public.report_list(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 3 then raise exception 'Nahlášení řeší admini.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'target', r.target, 'reason', r.reason, 'note', r.note, 'snapshot', r.snapshot,
      'status', r.status, 'action', r.action, 'created_at', r.created_at,
      'reporter', (select jsonb_build_object('id', p.id, 'nick', p.nick) from public.profiles p where p.id = r.reporter),
      'exists', case r.kind
         when 'chat_message' then exists (select 1 from public.chat_messages where id = r.target::bigint)
         when 'bazar_ad' then exists (select 1 from public.bazar_ads where id = r.target::uuid)
         else exists (select 1 from public.bazar_comments where id = r.target::bigint) end,
      'count', (select count(*) from public.reports x where x.kind = r.kind and x.target = r.target and x.status = r.status))
      order by r.created_at desc)
    from (select distinct on (kind, target) * from public.reports where status = p_status order by kind, target, created_at desc) r), '[]');
end $$;

-- p_delete: smazat nahlášený obsah (vrátí fotky smazaného inzerátu, klient je odstraní z úložiště)
create or replace function public.report_resolve(p_id bigint, p_delete boolean) returns text[]
language plpgsql security definer set search_path = public as $$
declare r public.reports; ph text[];
begin
  if public.bbx_my_level() < 3 then raise exception 'Nahlášení řeší admini.'; end if;
  select * into r from public.reports where id = p_id;
  if not found then raise exception 'Nahlášení neexistuje.'; end if;
  if p_delete then
    if r.kind = 'chat_message' then delete from public.chat_messages where id = r.target::bigint;
    elsif r.kind = 'bazar_ad' then delete from public.bazar_ads where id = r.target::uuid returning photos into ph;
    else delete from public.bazar_comments where id = r.target::bigint;
    end if;
  end if;
  update public.reports set status = 'done', resolved_by = auth.uid(), resolved_at = now(),
         action = case when p_delete then 'deleted' else 'kept' end
   where kind = r.kind and target = r.target and status = 'open';
  return coalesce(ph, '{}');
end $$;

-- počet otevřených nahlášení (odznak v profilu adminů)
create or replace function public.report_count() returns int
language sql stable security definer set search_path = public as $$
  select case when public.bbx_my_level() >= 3 then
    (select count(distinct (kind, target))::int from public.reports where status = 'open') else 0 end
$$;
