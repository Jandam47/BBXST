-- ════════════════════════════════════════════════════════════════════
--  15 – Komunitní trénink: boti a archiv
--
--  • Bot = registrace bez účtu (registrations.is_bot) na komunitním tréninku. Zakládá ho leader
--    nebo zástupce (training_bot_create), odebírá training_bot_remove (status 'dropped', historie
--    zůstane). Vyzvat ho může kdokoliv z tréninku; výzva je hned aktivní a sestavu bota
--    vyzyvatel nastaví v BBXST SETUPu (bez decku bota = zrcadlo vyzyvatelova decku).
--  • Archiv: po ukončení / zrušení tréninku se rozehrané výzvy uzavřou (trigger) a nejde už
--    zapisovat, měnit setup ani vracet souboje (bbx_tmatch).
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

alter table public.registrations add column if not exists is_bot boolean not null default false;

-- registrační trigger: bot nepotřebuje účet ani členství, is_bot nastaví jen RPC
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
  -- bot (jen komunitní trénink) zakládá jen RPC training_bot_create
  if not public.bbx_privileged() then
    new.is_bot := case when tg_op = 'INSERT' then false else old.is_bot end;
  end if;

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

  if new.user_id is not null and not new.is_bot and not public.bbx_privileged() and new.user_id = auth.uid() and not public.bbx_is_anon() then
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
      if not new.is_bot and (new.user_id is null or exists (select 1 from auth.users u where u.id = new.user_id and u.is_anonymous)) then
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

create or replace function public.training_bot_create(p_tournament uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; base text; nm text; k int := 1; rid uuid;
begin
  t := public.bbx_training(p_tournament);
  if not public.bbx_comm_lead(t.community_id) then raise exception 'Bota zakládá leader nebo zástupce komunity.'; end if;
  if t.status <> 'registration' then raise exception 'Trénink už skončil.'; end if;
  base := coalesce(nullif(btrim(p_name), ''), 'BOT');
  if char_length(base) not between 2 and 20 or base ~ '[<>"''`\\]' then raise exception 'Jméno bota musí mít 2–20 znaků.'; end if;
  nm := base;
  while exists (select 1 from public.registrations where tournament_id = t.id and lower(btrim(nick)) = lower(nm))
     or exists (select 1 from public.profiles where nick is not null and lower(nick) = lower(nm)) loop
    k := k + 1; nm := base || ' ' || k;
    if k > 50 then raise exception 'Zvol jiné jméno bota.'; end if;
  end loop;
  perform public.bbx_set_privileged();
  insert into public.registrations (tournament_id, user_id, nick, status, is_bot) values (t.id, null, nm, 'active', true) returning id into rid;
  return rid;
end $$;

create or replace function public.training_bot_remove(p_reg uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.registrations; t public.tournaments;
begin
  select * into r from public.registrations where id = p_reg and is_bot;
  if not found then raise exception 'Bot neexistuje.'; end if;
  t := public.bbx_training(r.tournament_id);
  if not public.bbx_comm_lead(t.community_id) then raise exception 'Bota odebírá leader nebo zástupce komunity.'; end if;
  perform public.bbx_set_privileged();
  update public.registrations set status = 'dropped' where id = r.id;
  update public.training_matches
     set status = case when exists (select 1 from public.training_battles b where b.match_id = training_matches.id) then 'done' else 'canceled' end,
         updated_at = now()
   where p2_reg = r.id and status in ('pending','active');
end $$;

create or replace function public.training_challenge(p_tournament uuid, p_opponent uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; me uuid; mid uuid; bot boolean;
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
  bot := coalesce((select is_bot from public.registrations where id = p_opponent), false);
  -- bot přijme výzvu hned; bez vlastního decku hraje zrcadlově s deckem vyzyvatele (sestavu změníš v SETUPu)
  insert into public.training_matches (tournament_id, p1_reg, p2_reg, status, settings)
  values (t.id, me, p_opponent, case when bot then 'active' else 'pending' end, jsonb_build_object('mode', '3v3', 'win', 7,
          'lineup', jsonb_build_object('p1', public.bbx_lineup(me),
                                       'p2', case when bot and jsonb_array_length(public.bbx_lineup(p_opponent)) = 0
                                                  then public.bbx_lineup(me) else public.bbx_lineup(p_opponent) end)))
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
  if p_need_active and (select status from public.tournaments where id = m.tournament_id) <> 'registration' then
    raise exception 'Trénink už skončil – je v archivu.';
  end if;
  return m;
end $$;
revoke execute on function public.bbx_tmatch(uuid, boolean) from public, anon, authenticated;

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
    'players', coalesce((select jsonb_agg(jsonb_build_object('reg', x.id, 'nick', x.nick, 'bot', x.is_bot) order by x.is_bot, lower(x.nick))
                           from public.registrations x where x.tournament_id = t.id and x.status = 'active' and x.id <> r.id), '[]'),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status,
                           'incoming', m.p2_reg = r.id, 'opp_reg', case when m.p1_reg = r.id then m.p2_reg else m.p1_reg end,
                           'opponent', (select nick from public.registrations o where o.id = case when m.p1_reg = r.id then m.p2_reg else m.p1_reg end))
                           order by m.updated_at desc)
                           from public.training_matches m where (m.p1_reg = r.id or m.p2_reg = r.id) and m.status in ('pending','active')), '[]'));
end $$;

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
                           'has_deck', r.deck is not null, 'bot', r.is_bot,
                           'guest', not r.is_bot and not exists (select 1 from public.community_members cm where cm.community_id = t.community_id
                                                  and cm.user_id = r.user_id and cm.status = 'active'))
                           order by r.is_bot, lower(r.nick))
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

-- archiv: ukončený / zrušený trénink uzavře rozehrané výzvy
create or replace function public.bbx_training_close() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_type = 'community' and new.status in ('finished','canceled') and old.status is distinct from new.status then
    update public.training_matches m
       set status = case when exists (select 1 from public.training_battles b where b.match_id = m.id) then 'done' else 'canceled' end,
           updated_at = now()
     where m.tournament_id = new.id and m.status in ('pending','active');
  end if;
  return new;
end $$;
revoke execute on function public.bbx_training_close() from public, anon, authenticated;
drop trigger if exists bbx_training_close on public.tournaments;
create trigger bbx_training_close after update of status on public.tournaments
  for each row execute function public.bbx_training_close();

-- už skončené tréninky: dorovnat rozehrané výzvy
update public.training_matches m
   set status = case when exists (select 1 from public.training_battles b where b.match_id = m.id) then 'done' else 'canceled' end,
       updated_at = now()
 where m.status in ('pending','active')
   and exists (select 1 from public.tournaments t where t.id = m.tournament_id and t.status in ('finished','canceled'));
