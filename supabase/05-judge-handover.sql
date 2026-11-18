-- ════════════════════════════════════════════════════════════════════
--  BBXU – rozehraná hra se pamatuje na serveru + předání / převzetí judge
--  Spusť v Supabase → SQL Editor. Jde spustit i opakovaně.
--
--  • matches.live_state: souboje rozehrané hry (beye, body, strany) – BBXST
--    ji posílá s každým bodem, takže po zavření nebo u jiného judge
--    hra pokračuje tam, kde skončila.
--  • pass_match: judge předá zápas (PASS JUDGE) – uvolní zápas i arénu.
--  • start_match: kdo zápas načte, ten ho řídí a zabere si jeho arénu.
--  • Body ani výsledek už nepošle judge, kterému zápas někdo převzal.
-- ════════════════════════════════════════════════════════════════════

alter table public.matches add column if not exists live_state jsonb;

-- jméno judge, který zápas právě řídí
create or replace function public.bbx_judge_nick(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select nick from public.profiles where id = p_user
$$;
revoke execute on function public.bbx_judge_nick(uuid) from public, anon, authenticated;

-- zápas pro BBXST: navíc kdo ho řídí a rozehraný stav
create or replace function public.bbx_match_json(m public.matches) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'tournament_id', m.tournament_id, 'tournament_name', t.name, 'win_score', t.win_score,
    'stage', m.stage, 'round', m.round, 'key', m.key, 'arena', m.arena, 'wave', m.wave,
    'best_of', m.best_of, 'p1_wins', m.p1_wins, 'p2_wins', m.p2_wins, 'status', m.status,
    'games_played', (select count(*) from public.games g where g.match_id = m.id),
    'judge_id', m.judge_id, 'judge_nick', public.bbx_judge_nick(m.judge_id),
    'live_p1', m.live_p1, 'live_p2', m.live_p2, 'live_state', m.live_state,
    'p1', jsonb_build_object('reg', r1.id, 'nick', r1.nick, 'beys', jsonb_build_array(r1.bey1, r1.bey2, r1.bey3)),
    'p2', jsonb_build_object('reg', r2.id, 'nick', r2.nick, 'beys', jsonb_build_array(r2.bey1, r2.bey2, r2.bey3)))
  from public.tournaments t, public.registrations r1, public.registrations r2
  where t.id = m.tournament_id and r1.id = m.p1_reg and r2.id = m.p2_reg
$$;
revoke execute on function public.bbx_match_json(public.matches) from public, anon, authenticated;

-- smí tenhle uživatel zápis do zápasu? (řídí ho on, nikdo, nebo je to organizátor turnaje)
create or replace function public.bbx_check_match_judge(m public.matches) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;                       -- SQL editor / service role
  if m.judge_id is not null and m.judge_id <> auth.uid() and not public.bbx_can_manage(m.tournament_id) then
    raise exception 'Zápas převzal judge %.', coalesce(public.bbx_judge_nick(m.judge_id), '?');
  end if;
end $$;
revoke execute on function public.bbx_check_match_judge(public.matches) from public, anon, authenticated;

-- načtení zápasu v BBXST = převzetí zápasu i jeho arény
create or replace function public.start_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  perform public.bbx_require_judge(m.tournament_id);
  if m.status = 'done' then raise exception 'Zápas už je dohraný.'; end if;
  perform public.bbx_set_privileged();
  update public.matches set status = 'live', judge_id = auth.uid(), started_at = coalesce(started_at, now()) where id = m.id;
  if m.arena is not null then
    delete from public.arena_judges where tournament_id = m.tournament_id and arena = m.arena and judge_id <> auth.uid();
    insert into public.arena_judges (tournament_id, arena, judge_id) values (m.tournament_id, m.arena, auth.uid())
      on conflict (tournament_id, arena) do nothing;
  end if;
end $$;

-- živé skóre + stav rozehrané hry
drop function if exists public.live_score(uuid, int, int);
create or replace function public.live_score(p_match uuid, p_p1 int, p_p2 int, p_state jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.tournaments;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  perform public.bbx_require_judge(m.tournament_id);
  if m.status = 'done' then return; end if;
  perform public.bbx_check_match_judge(m);
  select * into t from public.tournaments where id = m.tournament_id;
  if p_p1 < 0 or p_p2 < 0 or p_p1 > t.win_score or p_p2 > t.win_score then
    raise exception 'Neplatné skóre %:%.', p_p1, p_p2;
  end if;
  if p_state is not null and (jsonb_typeof(p_state) <> 'object' or length(p_state::text) > 20000) then
    raise exception 'Neplatný stav hry.';
  end if;
  perform public.bbx_set_privileged();
  update public.matches
     set live_p1 = p_p1, live_p2 = p_p2, live_at = now(),
         live_state = coalesce(p_state, live_state),
         status = case when status = 'pending' then 'live' else status end,
         judge_id = coalesce(judge_id, auth.uid()),
         started_at = coalesce(started_at, now())
   where id = p_match;
end $$;

-- PASS JUDGE (p_discard = false): zápas i aréna se uvolní, rozehrané skóre zůstane pro dalšího judge.
-- ZRUŠIT (p_discard = true): judge zápas pustí a rozehranou hru zahodí.
create or replace function public.pass_match(p_match uuid, p_discard boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'Zápas nenalezen.'; end if;
  perform public.bbx_require_judge(m.tournament_id);
  if m.status = 'done' then return; end if;
  perform public.bbx_check_match_judge(m);
  perform public.bbx_set_privileged();
  if p_discard then
    update public.matches
       set judge_id = null, live_p1 = null, live_p2 = null, live_at = null, live_state = null,
           status = case when exists (select 1 from public.games g where g.match_id = m.id) then 'live' else 'pending' end
     where id = m.id;
  else
    update public.matches set judge_id = null where id = m.id;
    if m.arena is not null then
      delete from public.arena_judges where tournament_id = m.tournament_id and arena = m.arena and judge_id = auth.uid();
    end if;
  end if;
end $$;

-- po uložení hry, dohrání nebo vrácení zápasu živé skóre i stav zmizí
create or replace function public.bbx_clear_live() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'done'
     or (new.p1_wins + new.p2_wins) <> (old.p1_wins + old.p2_wins)
     or (new.status = 'pending' and old.status <> 'pending') then
    new.live_p1 := null; new.live_p2 := null; new.live_at := null; new.live_state := null;
  end if;
  return new;
end $$;

-- výsledek hry nepřijme od judge, kterému zápas mezitím někdo převzal
-- (např. starý telefon odešle offline frontu po převzetí)
create or replace function public.bbx_guard_game() returns trigger
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = new.match_id;
  perform public.bbx_check_match_judge(m);
  return new;
end $$;
revoke execute on function public.bbx_guard_game() from public, anon, authenticated;
drop trigger if exists games_guard_judge on public.games;
create trigger games_guard_judge before insert on public.games
  for each row execute function public.bbx_guard_game();
