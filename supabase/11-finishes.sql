-- ════════════════════════════════════════════════════════════════════
--  11 – Druh endu u každého souboje (Xtreme / Burst / Over / Spin)
--
--  BBXST v judge módu posílá u bodu i „finish“: +3 = xtreme, +2 = burst / over (judge
--  vybere po přetažení +2), +1 = spin. Remíza nemá finish. Staré souboje bez finish:
--  +1 → spin, +3 → xtreme, +2 zůstane nerozlišený (null).
--  Statistiky: endy dané / obdržené v profilu (player_bey_stats → finishes)
--  a „Můj deck“ během turnaje (my_deck_stats).
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

alter table public.points add column if not exists finish text;
alter table public.points drop constraint if exists points_finish_chk;
alter table public.points add  constraint points_finish_chk check (finish in ('spin','over','burst','xtreme'));

-- staré souboje: co jde odvodit z bodů
update public.points set finish = case pts when 1 then 'spin' when 3 then 'xtreme' end
 where finish is null and scorer_slot <> 0 and pts in (1, 3);

-- druh endu z dat klienta (neznámý / chybějící → odvodit z bodů, u +2 null)
create or replace function public.bbx_finish(p_slot int, p_pts int, p_finish text) returns text
language sql immutable set search_path = public as $$
  select case when p_slot = 0 then null
              when p_finish in ('spin','over','burst','xtreme') then p_finish
              when p_pts = 1 then 'spin'
              when p_pts = 3 then 'xtreme'
         end
$$;
revoke execute on function public.bbx_finish(int, int, text) from public, anon, authenticated;

-- ── zápis hry: navíc finish ─────────────────────────────────────────
create or replace function public.submit_game(p_match uuid, p_p1_score int, p_p2_score int,
                                              p_points jsonb default '[]', p_client_id uuid default null,
                                              p_started_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.matches; t public.tournaments; g_no int; gid uuid; need int; pt jsonb; i int := 0;
  s1 int := 0; s2 int := 0; done boolean := false; w uuid; l uuid;
begin
  -- opakované odeslání stejné hry (offline fronta) → vrať aktuální stav
  if p_client_id is not null and exists (select 1 from public.games where client_id = p_client_id) then
    select m2.* into m from public.matches m2 join public.games g on g.match_id = m2.id where g.client_id = p_client_id;
    return jsonb_build_object('duplicate', true, 'match_done', m.status = 'done', 'p1_wins', m.p1_wins, 'p2_wins', m.p2_wins);
  end if;

  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  perform public.bbx_require_judge(m.tournament_id);
  select * into t from public.tournaments where id = m.tournament_id;
  if t.status not in ('swiss','topcut') then raise exception 'Turnaj neběží.'; end if;
  if m.status = 'done' then raise exception 'Zápas už je dohraný.'; end if;
  if m.p1_reg is null or m.p2_reg is null then raise exception 'Zápas ještě nemá oba hráče.'; end if;

  if not ((p_p1_score = t.win_score and p_p2_score between 0 and t.win_score - 1)
       or (p_p2_score = t.win_score and p_p1_score between 0 and t.win_score - 1)) then
    raise exception 'Neplatné skóre %:% (vítěz musí mít %).', p_p1_score, p_p2_score, t.win_score;
  end if;

  if jsonb_array_length(coalesce(p_points,'[]')) > 0 then
    select coalesce(sum((x->>'pts')::int) filter (where (x->>'slot')::int = 1),0),
           coalesce(sum((x->>'pts')::int) filter (where (x->>'slot')::int = 2),0)
      into s1, s2 from jsonb_array_elements(p_points) x;
    if s1 <> p_p1_score or s2 <> p_p2_score then
      raise exception 'Souboje (%:%) nesedí se skóre (%:%).', s1, s2, p_p1_score, p_p2_score;
    end if;
  end if;

  perform public.bbx_set_privileged();
  select coalesce(max(game_no),0) + 1 into g_no from public.games where match_id = m.id;
  insert into public.games (match_id, game_no, p1_score, p2_score, winner_slot, judge_id, client_id, started_at)
  values (m.id, g_no, p_p1_score, p_p2_score, case when p_p1_score > p_p2_score then 1 else 2 end,
          auth.uid(), p_client_id, p_started_at)
  returning id into gid;

  for pt in select * from jsonb_array_elements(coalesce(p_points,'[]')) loop
    i := i + 1;
    insert into public.points (game_id, seq, scorer_slot, pts, p1_bey, p2_bey, finish)
    values (gid, i, (pt->>'slot')::int, (pt->>'pts')::int, left(pt->>'p1_bey',60), left(pt->>'p2_bey',60),
            public.bbx_finish((pt->>'slot')::int, (pt->>'pts')::int, pt->>'finish'));
  end loop;

  need := (m.best_of / 2) + 1;
  if p_p1_score > p_p2_score then m.p1_wins := m.p1_wins + 1; else m.p2_wins := m.p2_wins + 1; end if;
  done := m.p1_wins >= need or m.p2_wins >= need;
  if done then
    w := case when m.p1_wins >= need then m.p1_reg else m.p2_reg end;
    l := case when m.p1_wins >= need then m.p2_reg else m.p1_reg end;
  end if;

  update public.matches
     set p1_wins = m.p1_wins, p2_wins = m.p2_wins,
         p1_score = p1_score + p_p1_score, p2_score = p2_score + p_p2_score,
         status = case when done then 'done' else 'live' end,
         winner_reg = w, loser_reg = l, judge_id = auth.uid(),
         started_at = coalesce(started_at, p_started_at, now()),
         finished_at = case when done then now() end
   where id = m.id;

  if done then
    perform public.bbx_apply_rating(m.id);
    perform public.bbx_place(m.tournament_id, m.next_win_key, m.next_win_slot, w, false);
    perform public.bbx_place(m.tournament_id, m.next_lose_key, m.next_lose_slot, l, false);
  end if;

  return jsonb_build_object('match_done', done, 'p1_wins', m.p1_wins, 'p2_wins', m.p2_wins,
                            'game_no', g_no, 'winner_reg', w);
end $$;

-- ── rozklad soubojů: navíc druh endu a bey soupeře ──────────────────
drop function if exists public.bbx_battles(uuid);
create or replace function public.bbx_battles(p_tournament uuid default null)
returns table (tournament_id uuid, reg_id uuid, user_id uuid, nick text, bey text, parts jsonb,
               result int, pts int, pts_lost int, finish text, opp_bey text, match_id uuid)
language sql stable security definer set search_path = public as $$
  select m.tournament_id, r.id, r.user_id, r.nick, s.bey,
         r.deck -> (case lower(s.bey) when lower(r.bey1) then 0 when lower(r.bey2) then 1 when lower(r.bey3) then 2 end),
         case when p.scorer_slot = 0 then 0 when p.scorer_slot = s.side then 1 else -1 end,
         case when p.scorer_slot = s.side then p.pts else 0 end,
         case when p.scorer_slot = 3 - s.side then p.pts else 0 end,
         p.finish, s.opp, m.id
    from public.points p
    join public.games g on g.id = p.game_id
    join public.matches m on m.id = g.match_id
    cross join lateral (values (1, m.p1_reg, p.p1_bey, p.p2_bey), (2, m.p2_reg, p.p2_bey, p.p1_bey)) s(side, reg, bey, opp)
    join public.registrations r on r.id = s.reg
   where s.bey is not null and (p_tournament is null or m.tournament_id = p_tournament)
$$;
revoke execute on function public.bbx_battles(uuid) from public, anon, authenticated;

-- počty endů jako jsonb {xtreme, burst, over, spin, plus2} (plus2 = +2 bez rozlišení)
create or replace function public.bbx_finish_counts(p_rows jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'xtreme', count(*) filter (where x->>'finish' = 'xtreme'),
    'burst',  count(*) filter (where x->>'finish' = 'burst'),
    'over',   count(*) filter (where x->>'finish' = 'over'),
    'spin',   count(*) filter (where x->>'finish' = 'spin'),
    'plus2',  count(*) filter (where x->>'finish' is null and (x->>'pts')::int = 2))
  from jsonb_array_elements(coalesce(p_rows, '[]')) x
$$;
revoke execute on function public.bbx_finish_counts(jsonb) from public, anon, authenticated;

-- ── profil: statistiky beyů + endy (dané / obdržené) ─────────────────
create or replace function public.player_bey_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (
    select x.* from public.bbx_battles() x join public.tournaments t on t.id = x.tournament_id
     where x.user_id = p_user and (t.status = 'finished' or p_user = auth.uid())
  ),
  rows as (
    select k.kind, case when k.kind = 'build' then b.bey else public.bbx_part_of(b.parts, k.kind) end as name, b.result, b.pts, b.pts_lost
      from b cross join (values ('build'), ('blade'), ('ratchet'), ('bit')) k(kind)
  ),
  g as (
    select kind, name, count(*) as battles,
           count(*) filter (where result = 1) as wins, count(*) filter (where result = 0) as draws,
           count(*) filter (where result = -1) as losses, sum(pts) as points, sum(pts_lost) as points_lost
      from rows where name is not null group by kind, name
  )
  select coalesce((select jsonb_object_agg(kind, items) from (
    select kind, jsonb_agg(jsonb_build_object('name', name, 'battles', battles, 'wins', wins, 'draws', draws,
                                              'losses', losses, 'points', points, 'points_lost', points_lost,
                                              'win_rate', round(100.0 * wins / battles, 1))
                           order by battles desc, wins desc, name) as items
      from g group by kind) q), '{}')
  || jsonb_build_object('finishes', jsonb_build_object(
       'given', public.bbx_finish_counts((select jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts)) from b where result = 1)),
       'taken', public.bbx_finish_counts((select jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts_lost)) from b where result = -1))))
$$;

-- ── Můj deck: jak si vede každý můj bey v turnaji (jen vlastní registrace) ──
create or replace function public.my_deck_stats(p_tournament uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.registrations;
begin
  select * into r from public.registrations where tournament_id = p_tournament and user_id = auth.uid() limit 1;
  if not found then raise exception 'V tomhle turnaji nejsi přihlášený.'; end if;
  return (
    with b as (select * from public.bbx_battles(p_tournament) where reg_id = r.id),
    beys as (select ord, name from (values (1, r.bey1), (2, r.bey2), (3, r.bey3)) v(ord, name) where name is not null)
    select jsonb_build_object('nick', r.nick, 'beys', coalesce(jsonb_agg(jsonb_build_object(
      'bey', beys.name,
      'battles', (select count(*) from b where lower(b.bey) = lower(beys.name)),
      'wins',    (select count(*) from b where lower(b.bey) = lower(beys.name) and result = 1),
      'draws',   (select count(*) from b where lower(b.bey) = lower(beys.name) and result = 0),
      'losses',  (select count(*) from b where lower(b.bey) = lower(beys.name) and result = -1),
      'points',  (select coalesce(sum(pts), 0) from b where lower(b.bey) = lower(beys.name)),
      'points_lost', (select coalesce(sum(pts_lost), 0) from b where lower(b.bey) = lower(beys.name)),
      'given', public.bbx_finish_counts((select jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts))
                                          from b where lower(b.bey) = lower(beys.name) and result = 1)),
      'taken', public.bbx_finish_counts((select jsonb_agg(jsonb_build_object('finish', finish, 'pts', pts_lost))
                                          from b where lower(b.bey) = lower(beys.name) and result = -1)),
      'beaten_by', coalesce((select jsonb_agg(jsonb_build_object('bey', opp_bey, 'n', n, 'pts', p) order by n desc, p desc, opp_bey)
                               from (select opp_bey, count(*) as n, sum(pts_lost) as p from b
                                      where lower(b.bey) = lower(beys.name) and result = -1 and opp_bey is not null
                                      group by opp_bey) o), '[]')
    ) order by beys.ord), '[]'))
    from beys
  );
end $$;
