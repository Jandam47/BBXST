-- ════════════════════════════════════════════════════════════════════
--  14 – Dodělávky komunitního tréninku
--
--  • training_setup: přepínač tournament mode (settings.tourney) – v BBXST se bey
--    v sadě neopakuje (jako v judge módu). Změna nezačíná novou hru.
--  • training_history: rozsah 'me' (moje souboje) nebo 'all' (celý trénink, i pro
--    nezúčastněné – skončený trénink je historie komunity).
--  • training_combos: comba se dělí podle majitele (nick, user_id).
--  • community_detail: tréninky s datem ukončení a počtem soubojů (historie tréninků).
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.training_setup(p_match uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.training_matches; mode text; win int; l1 jsonb; l2 jsonb; s jsonb; g record; tourney boolean;
begin
  m := public.bbx_tmatch(p_match);
  mode := coalesce(p_settings->>'mode', m.settings->>'mode', '3v3');
  if mode not in ('3v3','3v1','1v3','1v1') then raise exception 'Neznámý mód tréninku.'; end if;
  if p_settings ? 'win' then win := nullif(p_settings->>'win', '')::int; else win := (m.settings->>'win')::int; end if;
  if win is not null and win not between 1 and 99 then raise exception 'Body na hru musí být 1–99, nebo neomezeně.'; end if;
  tourney := coalesce((p_settings->>'tourney')::boolean, (m.settings->>'tourney')::boolean, false);
  l1 := coalesce(p_settings->'lineup'->'p1', m.settings->'lineup'->'p1', '[]');
  l2 := coalesce(p_settings->'lineup'->'p2', m.settings->'lineup'->'p2', '[]');
  if jsonb_array_length(l1) > 3 or jsonb_array_length(l2) > 3 then raise exception 'Sestava má nejvýš 3 beye.'; end if;
  select coalesce(jsonb_agg(public.bbx_normalize_deck(jsonb_build_array(b.value))->0
                            || jsonb_build_object('name', public.bbx_compose_bey(b.value, b.ordinality::int)) order by b.ordinality), '[]')
    into l1 from jsonb_array_elements(l1) with ordinality b;
  select coalesce(jsonb_agg(public.bbx_normalize_deck(jsonb_build_array(b.value))->0
                            || jsonb_build_object('name', public.bbx_compose_bey(b.value, b.ordinality::int)) order by b.ordinality), '[]')
    into l2 from jsonb_array_elements(l2) with ordinality b;
  s := jsonb_build_object('mode', mode, 'win', win, 'tourney', tourney, 'lineup', jsonb_build_object('p1', l1, 'p2', l2),
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

-- historie: 'me' = moje souboje podle soupeřů, 'all' = všechny dvojice tréninku (p1 vlevo)
drop function if exists public.training_history(uuid);
create or replace function public.training_history(p_tournament uuid, p_scope text default 'me') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid;
begin
  perform public.bbx_training(p_tournament);
  if p_scope = 'all' then
    return (with b as (select tb.*, m.p1_reg, m.p2_reg from public.training_battles tb
                         join public.training_matches m on m.id = tb.match_id where tb.tournament_id = p_tournament)
      select jsonb_build_object(
        'scope', 'all',
        'totals', jsonb_build_object('battles', count(*), 'matches', count(distinct match_id),
                    'players', (select count(distinct x) from (select p1_reg as x from b union select p2_reg from b) u),
                    'points', coalesce(sum(pts), 0), 'draws', count(*) filter (where scorer_slot = 0),
                    'given', public.bbx_finish_counts(jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts)) filter (where scorer_slot <> 0))),
        'matches', coalesce((select jsonb_agg(x order by x->>'last' desc) from (
            select jsonb_build_object('match_id', match_id,
                     'p1', (select nick from public.registrations r where r.id = p1_reg),
                     'p2', (select nick from public.registrations r where r.id = p2_reg),
                     'last', max(created_at),
                     's1', coalesce(sum(pts) filter (where scorer_slot = 1), 0), 's2', coalesce(sum(pts) filter (where scorer_slot = 2), 0),
                     'w1', count(*) filter (where scorer_slot = 1), 'w2', count(*) filter (where scorer_slot = 2),
                     'battles', jsonb_agg(jsonb_build_object('seq', seq, 'game', game_no, 'mode', mode, 'bey', p1_bey, 'opp_bey', p2_bey,
                                  'result', case scorer_slot when 1 then 1 when 2 then -1 else 0 end, 'pts', pts, 'finish', finish) order by seq)) as x
              from b group by match_id, p1_reg, p2_reg) q), '[]'))
      from b);
  end if;
  me := (select id from public.registrations where tournament_id = p_tournament and user_id = auth.uid());
  if me is null then return jsonb_build_object('scope', 'me', 'matches', '[]'::jsonb, 'totals', null); end if;
  return (with b as (select * from public.bbx_training_battles(p_tournament) where reg_id = me)
    select jsonb_build_object(
      'scope', 'me',
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

-- comba podle úspěšnosti, rozdělená podle majitele: moje ('me') nebo celý trénink ('all')
create or replace function public.training_combos(p_tournament uuid, p_scope text default 'me') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid;
begin
  perform public.bbx_training(p_tournament);
  me := (select id from public.registrations where tournament_id = p_tournament and user_id = auth.uid());
  return (with b as (select * from public.bbx_training_battles(p_tournament)
                      where bey is not null and (p_scope = 'all' or reg_id = me)),
          g as (select bey, reg_id, user_id, nick, count(*) as battles, count(*) filter (where result = 1) as wins,
                       count(*) filter (where result = 0) as draws, count(*) filter (where result = -1) as losses,
                       sum(pts) as points, sum(pts_lost) as points_lost,
                       public.bbx_finish_counts(jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts)) filter (where result = 1)) as given
                  from b group by bey, reg_id, user_id, nick)
    select coalesce(jsonb_agg(jsonb_build_object('bey', bey, 'nick', nick, 'user_id', user_id,
                    'battles', battles, 'wins', wins, 'draws', draws, 'losses', losses,
                    'points', points, 'points_lost', points_lost, 'players', 1, 'given', given,
                    'win_rate', round(100.0 * wins / battles, 1))
                    order by (wins::numeric / battles) desc, battles desc, bey, lower(nick)), '[]') from g);
end $$;

-- detail komunity: tréninky i s datem konce a počtem soubojů (historie tréninků)
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
                           'location', t.location, 'finished_at', t.finished_at, 'created_at', t.created_at,
                           'players', (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'active'),
                           'battles', (select count(*) from public.training_battles b where b.tournament_id = t.id),
                           'matches', (select count(distinct b.match_id) from public.training_battles b where b.tournament_id = t.id))
                           order by (t.status = 'registration') desc, coalesce(t.finished_at, t.starts_at, t.created_at) desc nulls last)
                           from public.tournaments t where t.community_id = c.id and t.status <> 'canceled'), '[]'));
end $$;
