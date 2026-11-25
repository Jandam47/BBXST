-- ════════════════════════════════════════════════════════════════════
--  40: Judge na komunitním tréninku
--  Hráč přihlášený na stejný trénink se v BBXST (kolečko hráčů → JUDGE) připojí k rozehrané
--  dvojici jiných hráčů a zapisuje za ně souboje. training_matches.judge_id = kdo teď judguje
--  (převzetí = poslední vyhrává, ODEJÍT ho uvolní). Judge smí totéž co hráči dvojice: souboje,
--  undo, nová hra, setup, ukončení. my_training vrací „live“ = kdo s kým hraje (skóre, judge),
--  training_state vrací me = 0 pro judge a jméno judge. Idempotentní.
-- ════════════════════════════════════════════════════════════════════

alter table public.training_matches add column if not exists judge_id uuid references public.profiles(id) on delete set null;

-- smí judgovat: aktivní hráč (ne bot) na tomhle tréninku
create or replace function public.bbx_tjudge_ok(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.registrations r
           where r.tournament_id = p_tournament and r.user_id = auth.uid() and r.status = 'active' and not r.is_bot)
$$;
revoke execute on function public.bbx_tjudge_ok(uuid) from public, anon, authenticated;

-- přístup k výzvě: hráč dvojice, nebo její současný judge
drop function if exists public.bbx_tmatch(uuid, boolean);
create or replace function public.bbx_tmatch(p_match uuid, p_need_active boolean default true, p_judge boolean default true)
returns public.training_matches
language plpgsql stable security definer set search_path = public as $$
declare m public.training_matches;
begin
  select * into m from public.training_matches where id = p_match;
  if not found then raise exception 'Výzva neexistuje.'; end if;
  if not exists (select 1 from public.registrations r where r.id in (m.p1_reg, m.p2_reg) and r.user_id = auth.uid()) then
    if not (p_judge and m.judge_id is not null and m.judge_id = auth.uid() and public.bbx_tjudge_ok(m.tournament_id)) then
      raise exception 'Tohle není tvoje výzva.';
    end if;
  end if;
  if p_need_active and m.status <> 'active' then raise exception 'Výzva není aktivní.'; end if;
  if p_need_active and (select status from public.tournaments where id = m.tournament_id) <> 'registration' then
    raise exception 'Trénink už skončil – je v archivu.';
  end if;
  return m;
end $$;
revoke execute on function public.bbx_tmatch(uuid, boolean, boolean) from public, anon, authenticated;

-- připojit se jako judge (p_on = true) / odejít (false)
create or replace function public.training_judge(p_match uuid, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.training_matches;
begin
  select * into m from public.training_matches where id = p_match;
  if not found then raise exception 'Výzva neexistuje.'; end if;
  if not p_on then
    update public.training_matches set judge_id = null, updated_at = now() where id = m.id and judge_id = auth.uid();
    return null;
  end if;
  if exists (select 1 from public.registrations r where r.id in (m.p1_reg, m.p2_reg) and r.user_id = auth.uid()) then
    raise exception 'Svůj vlastní souboj judgovat nemůžeš.';
  end if;
  if not public.bbx_tjudge_ok(m.tournament_id) then raise exception 'Judgovat může jen hráč přihlášený na tenhle trénink.'; end if;
  if (select status from public.tournaments where id = m.tournament_id) <> 'registration' then
    raise exception 'Trénink už skončil – je v archivu.';
  end if;
  if m.status <> 'active' then raise exception 'Tahle dvojice už nehraje.'; end if;
  update public.training_matches set judge_id = auth.uid(), updated_at = now() where id = m.id;
  return public.training_state(p_match);
end $$;
grant execute on function public.training_judge(uuid, boolean) to authenticated;

-- stav dvojice pro BBXST (oba hráči + judge); me = 1 / 2, judge = 0
create or replace function public.training_state(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.training_matches; g record; me uuid;
begin
  m := public.bbx_tmatch(p_match, false);
  select * into g from public.bbx_tgame(m.id);
  select id into me from public.registrations where id in (m.p1_reg, m.p2_reg) and user_id = auth.uid() limit 1;
  return jsonb_build_object(
    'id', m.id, 'tournament_id', m.tournament_id, 'status', m.status, 'settings', m.settings, 'last_seq', m.last_seq,
    'me', case when me = m.p1_reg then 1 when me = m.p2_reg then 2 else 0 end,
    'judge', (select jsonb_build_object('user_id', p.id, 'nick', p.nick) from public.profiles p where p.id = m.judge_id),
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

-- BBXST: můj otevřený trénink, hráči, moje výzvy a „live“ = rozehrané dvojice ostatních (pro judge)
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
                           from public.training_matches m where (m.p1_reg = r.id or m.p2_reg = r.id) and m.status in ('pending','active')), '[]'),
    'live', coalesce((select jsonb_agg(jsonb_build_object('id', m.id,
                           'p1', (select nick from public.registrations x where x.id = m.p1_reg),
                           'p2', (select nick from public.registrations x where x.id = m.p2_reg),
                           'mode', coalesce(m.settings->>'mode', '3v3'), 'win', (m.settings->>'win')::int,
                           'game', g.game_no, 's1', g.s1, 's2', g.s2,
                           'judge', (select nick from public.profiles p where p.id = m.judge_id),
                           'mine', coalesce(m.judge_id = auth.uid(), false))
                           order by m.updated_at desc)
                       from public.training_matches m cross join lateral public.bbx_tgame(m.id) g
                      where m.tournament_id = t.id and m.status = 'active' and m.p1_reg <> r.id and m.p2_reg <> r.id), '[]'));
end $$;
