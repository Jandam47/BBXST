-- ════════════════════════════════════════════════════════════════════
--  27 – Živě: decky hráčů pro diváky a push upozornění na sledované hráče
--  • live_decks(turnaj): beye všech hráčů běžícího / skončeného turnaje (pořadí v sadě si hráči
--    určují na začátku a nemění ho, deck tedy může být vidět; před startem dál skrytý)
--  • live_follows: sledovaní hráči diváka (jen účet). live_follow_set / live_follow_list.
--  • trigger bbx_push_follow: sledovaný hráč jde na arénu / dohrál zápas → push sledujícím
--  Spouštěj celé v Supabase SQL Editoru. Jde spustit opakovaně.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.live_decks(p_tournament uuid) returns table (reg uuid, beys text[])
language sql stable security definer set search_path = public as $$
  select r.id, array[r.bey1, r.bey2, r.bey3]
    from public.registrations r join public.tournaments t on t.id = r.tournament_id
   where t.id = p_tournament and t.kind = 'tournament' and t.status in ('swiss', 'topcut', 'finished')
     and public.bbx_can_see(t.visibility, t.created_by)
$$;
grant execute on function public.live_decks(uuid) to anon, authenticated;

create table if not exists public.live_follows (
  user_id       uuid not null references auth.users(id) on delete cascade,
  reg_id        uuid not null references public.registrations(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, reg_id)
);
create index if not exists live_follows_reg on public.live_follows (reg_id);
alter table public.live_follows enable row level security;
revoke all on public.live_follows from anon, authenticated;     -- jen přes RPC

create or replace function public.live_follow_set(p_reg uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  perform public.bbx_require_account();
  select r.tournament_id into tid from public.registrations r join public.tournaments t on t.id = r.tournament_id
   where r.id = p_reg and t.kind = 'tournament' and public.bbx_can_see(t.visibility, t.created_by);
  if tid is null then raise exception 'Hráč nenalezen.'; end if;
  if p_on then
    if (select count(*) from public.live_follows where user_id = auth.uid() and tournament_id = tid) >= 30 then
      raise exception 'Sledovat jde nejvýš 30 hráčů v turnaji.';
    end if;
    insert into public.live_follows (user_id, reg_id, tournament_id) values (auth.uid(), p_reg, tid) on conflict do nothing;
  else
    delete from public.live_follows where user_id = auth.uid() and reg_id = p_reg;
  end if;
end $$;
revoke execute on function public.live_follow_set(uuid, boolean) from public, anon;
grant execute on function public.live_follow_set(uuid, boolean) to authenticated;

create or replace function public.live_follow_list(p_tournament uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select reg_id from public.live_follows where user_id = auth.uid() and tournament_id = p_tournament
$$;
revoke execute on function public.live_follow_list(uuid) from public, anon;
grant execute on function public.live_follow_list(uuid) to authenticated;

-- ── push sledujícím ──────────────────────────────────────────────────
create or replace function public.bbx_push_follow() returns trigger
language plpgsql security definer set search_path = public as $$
declare tn text; fans uuid[]; n1 text; n2 text; wnick text; lnick text; sc text;
begin
  if new.p1_reg is null or new.p2_reg is null or coalesce(new.is_bye, false) then return new; end if;
  select array_agg(distinct user_id) into fans from public.live_follows where reg_id in (new.p1_reg, new.p2_reg);
  if fans is null then return new; end if;
  select name into tn from public.tournaments where id = new.tournament_id;
  n1 := public.bbx_reg_nick(new.p1_reg); n2 := public.bbx_reg_nick(new.p2_reg);
  -- zápas dostal arénu
  if new.status = 'pending' and new.arena is not null
     and (tg_op = 'INSERT' or old.arena is distinct from new.arena or old.p1_reg is distinct from new.p1_reg
          or old.p2_reg is distinct from new.p2_reg or old.status is distinct from new.status) then
    perform public.bbx_push(fans, 'Aréna ' || new.arena || ': ' || n1 || ' vs ' || n2,
      'Sledovaný hráč jde na arénu · ' || tn, '#/t/' || new.tournament_id || '/live', 'fol-' || new.id);
  -- zápas dohraný
  elsif tg_op = 'UPDATE' and new.status = 'done' and old.status is distinct from 'done' and new.winner_reg is not null then
    wnick := case when new.winner_reg = new.p1_reg then n1 else n2 end;
    lnick := case when new.winner_reg = new.p1_reg then n2 else n1 end;
    sc := case when new.best_of > 1 then greatest(new.p1_wins, new.p2_wins) || ':' || least(new.p1_wins, new.p2_wins)
               else greatest(new.p1_score, new.p2_score) || ':' || least(new.p1_score, new.p2_score) end;
    perform public.bbx_push(fans, wnick || ' porazil ' || lnick || ' ' || sc, tn, '#/t/' || new.tournament_id || '/live', 'fol-' || new.id);
  end if;
  return new;
exception when others then
  raise warning 'bbx_push_follow: %', sqlerrm;
  return new;
end $$;
revoke execute on function public.bbx_push_follow() from public, anon, authenticated;
drop trigger if exists bbx_push_follow on public.matches;
create trigger bbx_push_follow after insert or update of arena, status, p1_reg, p2_reg on public.matches
  for each row execute function public.bbx_push_follow();
