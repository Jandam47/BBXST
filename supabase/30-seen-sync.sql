-- ════════════════════════════════════════════════════════════════════
--  30 – „Přečteno“ na serveru (chat + odpovědi na dotazy)
--
--  Dřív se „viděl jsem“ ukládalo jen v localStorage jednoho prohlížeče, takže po přihlášení jinde svítilo
--  znovu. Teď: user_seen (user_id, key) – key 'chat:<místnost>' (last_id = poslední viděná zpráva)
--  nebo 'fb' (seen_at = čas poslední přečtené odpovědi). Zápis seen_set (jen dopředu, max), čtení
--  přes chat_room_list ('seen' u místnosti) a feedback_count ('seen'). Klient bere max(server, lokálně).
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.user_seen (
  user_id     uuid not null references auth.users(id) on delete cascade,
  key         text not null check (char_length(key) between 2 and 80),
  last_id     bigint,
  seen_at     timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_seen enable row level security;
revoke all on public.user_seen from anon, authenticated;

create or replace function public.seen_set(p_key text, p_id bigint default null, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_key = 'fb' then
    if p_at is null then return; end if;
    p_id := null;
  elsif p_key like 'chat:%' then
    if p_id is null or not exists (select 1 from public.chat_rooms where id = substr(p_key, 6)) then return; end if;
    p_at := null;
  else
    raise exception 'Neplatný klíč.';
  end if;
  insert into public.user_seen (user_id, key, last_id, seen_at) values (auth.uid(), p_key, p_id, least(p_at, now()))
  on conflict (user_id, key) do update
    set last_id = greatest(user_seen.last_id, excluded.last_id),
        seen_at = greatest(user_seen.seen_at, excluded.seen_at),
        updated_at = now();
end $$;
revoke execute on function public.seen_set(text, bigint, timestamptz) from public, anon;

-- seznam místností + 'seen' = poslední zpráva, kterou jsem viděl (na kterémkoli zařízení)
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
                order by m.id desc limit 1),
      'seen', (select s.last_id from public.user_seen s where s.user_id = auth.uid() and s.key = 'chat:' || r.id))
      order by r.sort, r.at desc nulls last, r.name), '[]')
    from public.chat_rooms r
   where public.bbx_chat_read(r.id)
     and (r.kind <> 'info_t' or (select t.status from public.tournaments t where t.id = r.tournament_id) <> 'canceled'
          or public.bbx_can_manage(r.tournament_id))
$$;

create or replace function public.feedback_count() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', case when public.bbx_my_level() >= 4 then (select count(*) from public.feedback where not done) else 0 end,
    'last_reply', (select max(replied_at) from public.feedback where user_id = auth.uid() and auth.uid() is not null),
    'seen', (select s.seen_at from public.user_seen s where s.user_id = auth.uid() and s.key = 'fb'))
$$;
grant execute on function public.feedback_count() to anon, authenticated;
