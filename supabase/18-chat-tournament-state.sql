-- ════════════════════════════════════════════════════════════════════
--  18 – Chat k turnaji: aktivní / uzavřený / schovaný / smazaný
--
--  • chat_rooms.state: 'active' (píše organizátor+), 'closed' (jen ke čtení), 'hidden' (vidí jen organizátor
--    té akce a admini, jen ke čtení). Smazání = smazání místnosti i se zprávami.
--  • Po ukončení turnaje se BBXU zeptá, jestli chat nechat aktivní, nebo uzavřít; organizátor akce a admin
--    ho můžou kdykoliv uzavřít / znovu otevřít / schovat / smazat (chat_room_state).
--  • Místnost se zakládá jen při založení turnaje; úprava turnaje smazanou místnost znovu nevytvoří.
--  • Už skončené nebo zrušené turnaje: prázdné místnosti se smažou, s nějakou zprávou se uzavřou.
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

alter table public.chat_rooms add column if not exists state text not null default 'active';
alter table public.chat_rooms drop constraint if exists chat_rooms_state_chk;
alter table public.chat_rooms add constraint chat_rooms_state_chk check (state in ('active','closed','hidden'));

create or replace function public.bbx_chat_sync_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'tournament' then
    delete from public.chat_rooms where id = 't-' || new.id;
  elsif tg_op = 'INSERT' or old.kind <> 'tournament' then
    insert into public.chat_rooms (id, name, icon, sort, kind, tournament_id, at)
    values ('t-' || new.id, public.bbx_troom_name(new), '🏆', 10, 'info_t', new.id, coalesce(new.starts_at, new.created_at))
    on conflict (id) do update set name = excluded.name, at = excluded.at;
  else
    update public.chat_rooms set name = public.bbx_troom_name(new), at = coalesce(new.starts_at, new.created_at)
     where id = 't-' || new.id;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_chat_sync_tournament() from public, anon, authenticated;

-- skončené / zrušené turnaje (jednorázově)
delete from public.chat_rooms r
 where r.kind = 'info_t' and r.state = 'active'
   and exists (select 1 from public.tournaments t where t.id = r.tournament_id and t.status in ('finished','canceled'))
   and not exists (select 1 from public.chat_messages m where m.room_id = r.id);
update public.chat_rooms r set state = 'closed'
 where r.kind = 'info_t' and r.state = 'active'
   and exists (select 1 from public.tournaments t where t.id = r.tournament_id and t.status in ('finished','canceled'));

-- kdo spravuje místnost turnaje: organizátor té akce a admini
create or replace function public.bbx_chat_manage(p_room text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.kind = 'info_t' and public.bbx_can_manage(r.tournament_id) from public.chat_rooms r where r.id = p_room), false)
$$;

create or replace function public.bbx_chat_read(p_room text, p_at timestamptz default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case r.kind
      when 'info' then true
      when 'info_t' then r.state <> 'hidden' or public.bbx_can_manage(r.tournament_id)
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
  select coalesce((select auth.uid() is not null and not public.bbx_is_anon() and r.state = 'active' and case r.kind
      when 'test' then true
      when 'info' then public.bbx_my_level() >= 2
      when 'info_t' then public.bbx_my_level() >= 2
      when 'community' then public.bbx_comm_role(r.community_id) is not null
        or exists (select 1 from public.chat_guests g where g.room_id = r.id and g.user_id = auth.uid() and g.until > now())
      else false end
    from public.chat_rooms r where r.id = p_room), false)
$$;

-- p_state: 'active' | 'closed' | 'hidden' | 'delete'
create or replace function public.chat_room_state(p_room text, p_state text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.bbx_chat_manage(p_room) then raise exception 'Chat k turnaji spravuje organizátor akce nebo admin.'; end if;
  if p_state = 'delete' then
    delete from public.chat_rooms where id = p_room;
  elsif p_state in ('active','closed','hidden') then
    update public.chat_rooms set state = p_state where id = p_room;
  else
    raise exception 'Neplatný stav chatu.';
  end if;
end $$;

create or replace function public.chat_room_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'icon', r.icon, 'kind', r.kind, 'sort', r.sort, 'at', r.at, 'state', r.state,
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
     and (r.kind <> 'info_t' or (select t.status from public.tournaments t where t.id = r.tournament_id) <> 'canceled'
          or public.bbx_can_manage(r.tournament_id))
$$;

create or replace function public.chat_room_info(p_room text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.chat_rooms; lead boolean;
begin
  select * into r from public.chat_rooms where id = p_room;
  if not found or not public.bbx_chat_read(p_room) then raise exception 'Do téhle místnosti nemáš přístup.'; end if;
  lead := r.kind = 'community' and public.bbx_comm_lead(r.community_id);
  return jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'name', r.name, 'icon', r.icon, 'kind', r.kind, 'state', r.state,
                               'tournament_id', r.tournament_id, 'community_id', r.community_id,
                               'tournament_status', (select t.status from public.tournaments t where t.id = r.tournament_id)),
    'can_write', public.bbx_chat_write(p_room),
    'can_moderate', public.bbx_chat_moderate(p_room),
    'can_manage', public.bbx_chat_manage(p_room),
    'is_lead', lead,
    'guest', (select jsonb_build_object('until', g.until, 'see_history', g.see_history) from public.chat_guests g
               where g.room_id = r.id and g.user_id = auth.uid() and g.until > now()
                 and (r.kind <> 'community' or public.bbx_comm_role(r.community_id) is null)),
    'guests', case when lead then coalesce((select jsonb_agg(jsonb_build_object('user_id', g.user_id, 'nick', p.nick, 'until', g.until,
                       'see_history', g.see_history) order by g.until)
                       from public.chat_guests g join public.profiles p on p.id = g.user_id
                      where g.room_id = r.id and g.until > now()), '[]') end);
end $$;

-- mazání zpráv: vlastní, admin, leader / zástupce v komunitě, organizátor akce v chatu svého turnaje
create or replace function public.bbx_chat_moderate(p_room text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.bbx_my_level() >= 3
      or public.bbx_chat_manage(p_room)
      or coalesce((select r.kind = 'community' and public.bbx_comm_lead(r.community_id) from public.chat_rooms r where r.id = p_room), false)
$$;
