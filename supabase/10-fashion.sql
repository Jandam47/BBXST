-- ════════════════════════════════════════════════════════════════════
--  10 – Druhy akcí (Trénink / Fashion / Ostatní) a Fashion show
--
--  Fashion: hráči se přihlásí s N beyi (výchozí 3), design judge (jen s účtem,
--  nesoutěží) se přidají do startu. Start náhodně zamíchá pořadí (registrations.seed),
--  vyvolaný hráč = tournaments.fashion->>'current'. Každý judge dá 0–10 design,
--  0–5 sladěnost, 0–5 cosplay, 0–3 unikátnost, +1 celkový dojem. Když ohodnotí
--  všichni, vyvolá se další. Body nikdo nevidí až do vyhlášení.
--  Ukončení: shoda na 1. místě → rozstřel (+1 pro jednoho), znovu shoda →
--  náhodný „boss of fashion“ z judgů vybere vítěze. Jinak dělená místa (1, 2, 2, 4).
--  Vyhlášení na TV: od 4. místa naráz, pak 3. / 2. / 1. vždy po 5 s
--  (fashion_board je vrací postupně podle fashion->>'reveal_at').
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

alter table public.tournaments add column if not exists event_type   text not null default 'training';
alter table public.tournaments add column if not exists fashion_beys int  not null default 3;
alter table public.tournaments add column if not exists fashion      jsonb;

alter table public.tournaments drop constraint if exists t_event_type_chk;
alter table public.tournaments add  constraint t_event_type_chk check (event_type in ('training','fashion','other'));
alter table public.tournaments drop constraint if exists t_fashion_beys_chk;
alter table public.tournaments add  constraint t_fashion_beys_chk check (fashion_beys between 1 and 10);
alter table public.tournaments drop constraint if exists t_status_chk;
alter table public.tournaments add  constraint t_status_chk
  check (status in ('registration','swiss','topcut','show','finished','canceled'));

-- stav turnaje / fashion show mění jen ovládání; druh akce a počet beyů jen bez přihlášených
create or replace function public.bbx_protect_tournament() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.bbx_privileged() then
    if tg_op = 'INSERT' then
      new.status := 'registration'; new.current_round := 0; new.fashion := null;
      new.started_at := null; new.finished_at := null; new.created_by := auth.uid();
      if new.kind <> 'event' then new.event_type := 'training'; end if;
    else
      if new.status is distinct from old.status or new.current_round is distinct from old.current_round
         or new.created_by is distinct from old.created_by or new.started_at is distinct from old.started_at
         or new.finished_at is distinct from old.finished_at or new.fashion is distinct from old.fashion then
        raise exception 'Stav turnaje se mění jen přes ovládání turnaje.';
      end if;
      if old.status not in ('registration') and (new.swiss_rounds <> old.swiss_rounds or new.win_score <> old.win_score
         or new.kind <> old.kind or new.format <> old.format or new.unique_parts <> old.unique_parts
         or new.event_type <> old.event_type or new.fashion_beys <> old.fashion_beys) then
        raise exception 'Po startu nejde měnit formát, počet kol, body na výhru ani pravidla decku.';
      end if;
      if (new.event_type <> old.event_type or new.fashion_beys <> old.fashion_beys or new.kind <> old.kind)
         and exists (select 1 from public.registrations where tournament_id = old.id) then
        raise exception 'Druh akce a počet beyů jde změnit, jen dokud se nikdo nepřihlásil.';
      end if;
    end if;
  end if;
  return new;
end $$;

-- ── design judge ───────────────────────────────────────────────────
create table if not exists public.fashion_judges (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
alter table public.fashion_judges enable row level security;
drop policy if exists fj_read on public.fashion_judges;
create policy fj_read on public.fashion_judges for select using (true);
-- zápis jen přes RPC

-- ── hodnocení (tajné do vyhlášení – žádná select policy, čte se přes RPC) ──
create table if not exists public.fashion_scores (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  reg_id        uuid not null references public.registrations(id) on delete cascade,
  judge_id      uuid not null references auth.users(id) on delete cascade,
  design        int  not null check (design   between 0 and 10),
  harmony       int  not null check (harmony  between 0 and 5),
  cosplay       int  not null check (cosplay  between 0 and 5),
  uniq          int  not null check (uniq     between 0 and 3),
  extra         int  not null default 0 check (extra between 0 and 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (reg_id, judge_id)
);
alter table public.fashion_scores enable row level security;
revoke all on public.fashion_scores from anon, authenticated;

-- ── rozstřel o 1. místo ────────────────────────────────────────────
create table if not exists public.fashion_votes (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  judge_id      uuid not null references auth.users(id) on delete cascade,
  reg_id        uuid not null references public.registrations(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (tournament_id, judge_id)
);
alter table public.fashion_votes enable row level security;
revoke all on public.fashion_votes from anon, authenticated;

-- ── registrace: fashion má povinný deck s N beyi, design judge nesoutěží ──
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

  if new.user_id is not null and not public.bbx_privileged() and new.user_id = auth.uid() and not public.bbx_is_anon() then
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
  else
    new.deck := null; new.bey1 := null; new.bey2 := null; new.bey3 := null;
  end if;
  return new;
end $$;
revoke execute on function public.bbx_protect_registration() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
--  Pomocné funkce
-- ════════════════════════════════════════════════════════════════════

create or replace function public.bbx_fashion_event(p_tournament uuid) returns public.tournaments
language plpgsql stable security definer set search_path = public as $$
declare t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Akce neexistuje.'; end if;
  if t.kind <> 'event' or t.event_type <> 'fashion' then raise exception 'Tohle není Fashion akce.'; end if;
  return t;
end $$;

create or replace function public.bbx_is_fashion_judge(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.fashion_judges where tournament_id = p_tournament and user_id = auth.uid())
$$;

-- zapíše nový stav show (verze „v“ roste → realtime na tournaments překreslí všechny)
create or replace function public.bbx_fashion_set(p_tournament uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.bbx_set_privileged();
  update public.tournaments
     set fashion = coalesce(fashion, '{}') || p_patch
                   || jsonb_build_object('v', coalesce((fashion->>'v')::int, 0) + 1)
   where id = p_tournament;
end $$;

-- součet bodů hráčů (jen aktivní)
create or replace function public.bbx_fashion_totals(p_tournament uuid)
returns table (reg_id uuid, total int, design int, harmony int, cosplay int, uniq int, extra int, judges int)
language sql stable security definer set search_path = public as $$
  select r.id,
         coalesce(sum(s.design + s.harmony + s.cosplay + s.uniq + s.extra), 0)::int,
         coalesce(sum(s.design), 0)::int, coalesce(sum(s.harmony), 0)::int, coalesce(sum(s.cosplay), 0)::int,
         coalesce(sum(s.uniq), 0)::int, coalesce(sum(s.extra), 0)::int, count(s.judge_id)::int
    from public.registrations r
    left join public.fashion_scores s on s.reg_id = r.id
   where r.tournament_id = p_tournament and r.status = 'active'
   group by r.id
$$;

-- další hráč na řadě po aktuálním (null = byl poslední)
create or replace function public.bbx_fashion_next_reg(p_tournament uuid, p_after uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select r.id from public.registrations r
   where r.tournament_id = p_tournament and r.status = 'active' and r.seed is not null
     and r.seed > coalesce((select seed from public.registrations where id = p_after), 0)
   order by r.seed limit 1
$$;

-- posun na dalšího hráče; po posledním zůstane phase = 'scoring', current = poslední, last = true
create or replace function public.bbx_fashion_advance(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; nx uuid;
begin
  select * into t from public.tournaments where id = p_tournament;
  nx := public.bbx_fashion_next_reg(t.id, (t.fashion->>'current')::uuid);
  if nx is null then
    perform public.bbx_fashion_set(t.id, jsonb_build_object('last', true));
  else
    perform public.bbx_fashion_set(t.id, jsonb_build_object('current', nx, 'called_at', now(), 'last',
             public.bbx_fashion_next_reg(t.id, nx) is null));
  end if;
end $$;

-- konečné pořadí: vítěz 1., ostatní podle součtu (shoda = dělené místo)
create or replace function public.bbx_fashion_finalize(p_tournament uuid, p_winner uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.bbx_set_privileged();
  with tot as (select * from public.bbx_fashion_totals(p_tournament)),
       pl as (
         select a.reg_id,
                case when a.reg_id = p_winner then 1
                     else 2 + (select count(*) from tot b where b.reg_id <> p_winner and b.reg_id <> a.reg_id and b.total > a.total)
                end as place
           from tot a)
  update public.registrations r set final_place = pl.place from pl where r.id = pl.reg_id;
  update public.registrations set final_place = null where tournament_id = p_tournament and status <> 'active';
  update public.tournaments set status = 'finished', finished_at = now() where id = p_tournament;
  perform public.bbx_fashion_set(p_tournament, jsonb_build_object('phase', 'done', 'winner', p_winner,
           'reveal_at', now(), 'tie', '[]'::jsonb));
end $$;

-- vyhodnocení rozstřelu (všichni hlasovali nebo ho organizátor uzavřel)
create or replace function public.bbx_fashion_close_vote(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare top int; leaders uuid[]; boss uuid;
begin
  with c as (select x.reg_id, (select count(*) from public.fashion_votes v
                                where v.tournament_id = p_tournament and v.reg_id = x.reg_id) as n
               from (select (jsonb_array_elements_text(fashion->'tie'))::uuid as reg_id
                       from public.tournaments where id = p_tournament) x)
  select max(n), array_agg(reg_id) filter (where n = (select max(n) from c)) into top, leaders from c;
  if array_length(leaders, 1) = 1 then
    perform public.bbx_fashion_finalize(p_tournament, leaders[1]);
  else
    select user_id into boss from public.fashion_judges where tournament_id = p_tournament order by random() limit 1;
    perform public.bbx_fashion_set(p_tournament, jsonb_build_object('phase', 'boss', 'boss', boss, 'tie', to_jsonb(leaders)));
  end if;
end $$;

revoke execute on function public.bbx_fashion_event(uuid)            from public, anon, authenticated;
revoke execute on function public.bbx_fashion_set(uuid, jsonb)       from public, anon, authenticated;
revoke execute on function public.bbx_fashion_totals(uuid)           from public, anon, authenticated;
revoke execute on function public.bbx_fashion_next_reg(uuid, uuid)   from public, anon, authenticated;
revoke execute on function public.bbx_fashion_advance(uuid)          from public, anon, authenticated;
revoke execute on function public.bbx_fashion_finalize(uuid, uuid)   from public, anon, authenticated;
revoke execute on function public.bbx_fashion_close_vote(uuid)       from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
--  RPC – design judge
-- ════════════════════════════════════════════════════════════════════

create or replace function public.fashion_judge_join(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments;
begin
  t := public.bbx_fashion_event(p_tournament);
  if auth.uid() is null or public.bbx_is_anon() then raise exception 'Design judge musí být přihlášený svým účtem.'; end if;
  if (select nick from public.profiles where id = auth.uid()) is null then raise exception 'Nejdřív si v profilu nastav nick.'; end if;
  if t.status <> 'registration' then raise exception 'Fashion show už začala – judge se přidávají jen před startem.'; end if;
  if exists (select 1 from public.registrations where tournament_id = t.id and user_id = auth.uid()) then
    raise exception 'Jsi přihlášený do soutěže – design judge být nemůžeš. Nejdřív se ze soutěže odhlas.';
  end if;
  insert into public.fashion_judges (tournament_id, user_id) values (t.id, auth.uid()) on conflict do nothing;
  perform public.bbx_fashion_set(t.id, '{}');
end $$;

create or replace function public.fashion_judge_leave(p_tournament uuid, p_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; who uuid := coalesce(p_user, auth.uid());
begin
  t := public.bbx_fashion_event(p_tournament);
  if who is distinct from auth.uid() and not public.bbx_can_manage(t.id) then raise exception 'Nemáš oprávnění.'; end if;
  if t.status <> 'registration' then raise exception 'Po startu show se judge odhlásit nedá.'; end if;
  delete from public.fashion_judges where tournament_id = t.id and user_id = who;
  perform public.bbx_fashion_set(t.id, '{}');
end $$;

-- start: zamíchá pořadí, vyvolá prvního
create or replace function public.fashion_start(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n int; first uuid;
begin
  t := public.bbx_require_manager(p_tournament);
  perform public.bbx_fashion_event(t.id);
  if t.status <> 'registration' then raise exception 'Fashion show už běží.'; end if;
  select count(*) into n from public.registrations where tournament_id = t.id and status = 'active';
  if n < 2 then raise exception 'Potřebuješ aspoň 2 soutěžící.'; end if;
  if not exists (select 1 from public.fashion_judges where tournament_id = t.id) then
    raise exception 'Přihlas aspoň jednoho design judge.';
  end if;
  with o as (select id, row_number() over (order by random()) as rn
               from public.registrations where tournament_id = t.id and status = 'active')
  update public.registrations r set seed = o.rn from o where r.id = o.id;
  select id into first from public.registrations where tournament_id = t.id and seed = 1;
  update public.tournaments set status = 'show', started_at = now() where id = t.id;
  delete from public.fashion_scores where tournament_id = t.id;
  delete from public.fashion_votes where tournament_id = t.id;
  update public.tournaments set fashion = null where id = t.id;
  perform public.bbx_fashion_set(t.id, jsonb_build_object('phase', 'scoring', 'current', first, 'called_at', now(),
           'last', n = 1));
end $$;

-- hodnocení hráče (vyvolaného nebo už dřív vyvolaného); jde i přepsat, dokud show běží
create or replace function public.fashion_rate(p_tournament uuid, p_reg uuid, p_design int, p_harmony int,
                                               p_cosplay int, p_uniq int, p_extra int) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; r public.registrations; cur public.registrations; nj int; nr int;
begin
  t := public.bbx_fashion_event(p_tournament);
  if not public.bbx_is_fashion_judge(t.id) then raise exception 'Hodnotit můžou jen design judge této akce.'; end if;
  if t.status <> 'show' or t.fashion->>'phase' <> 'scoring' then raise exception 'Hodnocení teď neběží.'; end if;
  select * into r from public.registrations where id = p_reg and tournament_id = t.id;
  if not found or r.status <> 'active' then raise exception 'Hráč v soutěži není.'; end if;
  select * into cur from public.registrations where id = (t.fashion->>'current')::uuid;
  if r.seed > cur.seed then raise exception 'Hráč % ještě nebyl vyvolaný.', r.nick; end if;
  insert into public.fashion_scores (tournament_id, reg_id, judge_id, design, harmony, cosplay, uniq, extra)
  values (t.id, p_reg, auth.uid(), p_design, p_harmony, p_cosplay, p_uniq, coalesce(p_extra, 0))
  on conflict (reg_id, judge_id) do update
     set design = excluded.design, harmony = excluded.harmony, cosplay = excluded.cosplay,
         uniq = excluded.uniq, extra = excluded.extra, updated_at = now();
  -- všichni ohodnotili vyvolaného → další
  select count(*) into nj from public.fashion_judges where tournament_id = t.id;
  select count(*) into nr from public.fashion_scores s join public.fashion_judges j
      on j.tournament_id = s.tournament_id and j.user_id = s.judge_id
   where s.reg_id = cur.id;
  if p_reg = cur.id and nr >= nj and not coalesce((t.fashion->>'last')::boolean, false) then
    perform public.bbx_fashion_advance(t.id);
  else
    perform public.bbx_fashion_set(t.id, '{}');
  end if;
end $$;

-- organizátor: vyvolat dalšího bez čekání na všechny judge
create or replace function public.fashion_next(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'show' or t.fashion->>'phase' <> 'scoring' then raise exception 'Hodnocení teď neběží.'; end if;
  if coalesce((t.fashion->>'last')::boolean, false) then raise exception 'Tohle je poslední hráč.'; end if;
  perform public.bbx_fashion_advance(t.id);
end $$;

-- organizátor: konec hodnocení → vyhlášení (nebo rozstřel o 1. místo)
create or replace function public.fashion_finish(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; top int; leaders uuid[];
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'show' or t.fashion->>'phase' <> 'scoring' then raise exception 'Hodnocení teď neběží.'; end if;
  if not coalesce((t.fashion->>'last')::boolean, false) then raise exception 'Ještě nebyli vyvolaní všichni hráči.'; end if;
  select max(total) into top from public.bbx_fashion_totals(t.id);
  select array_agg(reg_id) into leaders from public.bbx_fashion_totals(t.id) where total = top;
  if array_length(leaders, 1) = 1 then
    perform public.bbx_fashion_finalize(t.id, leaders[1]);
  else
    delete from public.fashion_votes where tournament_id = t.id;
    perform public.bbx_fashion_set(t.id, jsonb_build_object('phase', 'tiebreak', 'tie', to_jsonb(leaders)));
  end if;
end $$;

-- rozstřel: judge dá +1 jednomu z hráčů se shodou
create or replace function public.fashion_vote(p_tournament uuid, p_reg uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; nj int; nv int;
begin
  t := public.bbx_fashion_event(p_tournament);
  if not public.bbx_is_fashion_judge(t.id) then raise exception 'Hlasovat můžou jen design judge této akce.'; end if;
  if t.status <> 'show' or t.fashion->>'phase' <> 'tiebreak' then raise exception 'Rozstřel teď neběží.'; end if;
  if not (t.fashion->'tie') ? p_reg::text then raise exception 'Hlasuje se jen mezi hráči se shodou bodů.'; end if;
  insert into public.fashion_votes (tournament_id, judge_id, reg_id) values (t.id, auth.uid(), p_reg)
  on conflict (tournament_id, judge_id) do update set reg_id = excluded.reg_id, created_at = now();
  select count(*) into nj from public.fashion_judges where tournament_id = t.id;
  select count(*) into nv from public.fashion_votes where tournament_id = t.id;
  if nv >= nj then perform public.bbx_fashion_close_vote(t.id);
  else perform public.bbx_fashion_set(t.id, '{}'); end if;
end $$;

-- organizátor: uzavřít rozstřel, i když někdo nehlasoval
create or replace function public.fashion_close_vote(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'show' or t.fashion->>'phase' <> 'tiebreak' then raise exception 'Rozstřel teď neběží.'; end if;
  perform public.bbx_fashion_close_vote(t.id);
end $$;

-- boss of fashion (nebo organizátor, kdyby boss zmizel) vybere vítěze
create or replace function public.fashion_boss_pick(p_tournament uuid, p_reg uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments;
begin
  t := public.bbx_fashion_event(p_tournament);
  if t.status <> 'show' or t.fashion->>'phase' <> 'boss' then raise exception 'Teď nikdo nevybírá vítěze.'; end if;
  if auth.uid() is distinct from (t.fashion->>'boss')::uuid and not public.bbx_can_manage(t.id) then
    raise exception 'Vítěze vybírá boss of fashion.';
  end if;
  if not (t.fashion->'tie') ? p_reg::text then raise exception 'Vybírá se jen z hráčů se shodou.'; end if;
  perform public.bbx_fashion_finalize(t.id, p_reg);
end $$;

-- ════════════════════════════════════════════════════════════════════
--  RPC – čtení: celý stav show pro aplikaci a TV
--  Body se ukážou až po vyhlášení; umístění postupně (4.+ hned, 3./2./1. po 5 s).
-- ════════════════════════════════════════════════════════════════════
create or replace function public.fashion_board(p_tournament uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t public.tournaments; me uuid := auth.uid(); mgr boolean; judge boolean;
  shown boolean; reveal timestamptz; res jsonb;
begin
  t := public.bbx_fashion_event(p_tournament);
  mgr := public.bbx_can_manage(t.id);
  judge := public.bbx_is_fashion_judge(t.id);
  shown := t.status <> 'registration';
  reveal := (t.fashion->>'reveal_at')::timestamptz;

  select jsonb_build_object(
    'state', coalesce(t.fashion, '{}'),
    'me_judge', judge,
    'judges', coalesce((select jsonb_agg(jsonb_build_object('user_id', j.user_id, 'nick', p.nick, 'avatar', p.avatar)
                          order by j.created_at)
                          from public.fashion_judges j left join public.profiles p on p.id = j.user_id
                         where j.tournament_id = t.id), '[]'),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'nick', r.nick, 'user_id', r.user_id, 'seed', r.seed, 'status', r.status,
          'has_account', (p.nick is not null and not coalesce(u.is_anonymous, false)), 'avatar', p.avatar,
          'beys', case when shown or r.user_id = me or mgr then
                    (select jsonb_agg(public.bbx_compose_bey(b.value, b.ordinality::int) order by b.ordinality)
                       from jsonb_array_elements(r.deck) with ordinality b) end,
          'rated_by', (select coalesce(jsonb_agg(s.judge_id), '[]') from public.fashion_scores s where s.reg_id = r.id),
          'my_score', case when judge then (select jsonb_build_object('design', s.design, 'harmony', s.harmony,
                         'cosplay', s.cosplay, 'uniq', s.uniq, 'extra', s.extra)
                         from public.fashion_scores s where s.reg_id = r.id and s.judge_id = me) end,
          'place', case when t.status = 'finished' and reveal is not null and r.final_place is not null
                         and now() >= reveal + make_interval(secs => case r.final_place when 1 then 15 when 2 then 10 when 3 then 5 else 0 end)
                        then r.final_place end,
          'score', case when t.status = 'finished' and reveal is not null and now() >= reveal + interval '15 seconds' then
                     (select jsonb_build_object('total', x.total, 'design', x.design, 'harmony', x.harmony, 'cosplay', x.cosplay,
                             'uniq', x.uniq, 'extra', x.extra, 'judges', x.judges)
                        from public.bbx_fashion_totals(t.id) x where x.reg_id = r.id) end)
        order by r.seed nulls last, r.created_at)
        from public.registrations r
        left join public.profiles p on p.id = r.user_id
        left join auth.users u on u.id = r.user_id
       where r.tournament_id = t.id), '[]'),
    'voted', case when t.fashion->>'phase' = 'tiebreak'
                  then (select coalesce(jsonb_agg(judge_id), '[]') from public.fashion_votes where tournament_id = t.id) end,
    'my_vote', case when judge then (select reg_id from public.fashion_votes where tournament_id = t.id and judge_id = me) end,
    'votes', case when t.status = 'finished' and reveal is not null and now() >= reveal + interval '15 seconds' then
               (select coalesce(jsonb_object_agg(reg_id, n), '{}') from
                  (select reg_id, count(*) as n from public.fashion_votes where tournament_id = t.id group by reg_id) v) end,
    'now', now()
  ) into res;
  return res;
end $$;

-- akce, kde dělám design judge (notifikace „jdi hodnotit“)
create or replace function public.my_fashion_judging() returns table (tournament_id uuid)
language sql stable security definer set search_path = public as $$
  select j.tournament_id from public.fashion_judges j join public.tournaments t on t.id = j.tournament_id
   where j.user_id = auth.uid() and t.status in ('registration','show')
$$;

-- achievementy z fashion (1.–3. místo)
create or replace function public.player_achievements(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'fashion', 'place', r.final_place, 'tournament_id', t.id,
                  'name', t.name, 'at', coalesce(t.finished_at, t.starts_at))
                  order by r.final_place, coalesce(t.finished_at, t.starts_at) desc), '[]')
    from public.registrations r join public.tournaments t on t.id = r.tournament_id
   where r.user_id = p_user and t.kind = 'event' and t.event_type = 'fashion' and t.status = 'finished'
     and r.final_place between 1 and 3
     and (t.fashion->>'reveal_at') is not null and now() >= (t.fashion->>'reveal_at')::timestamptz + interval '15 seconds'
$$;

-- přehled turnajů a akcí: navíc druh akce, show patří mezi běžící
drop function if exists public.tournament_list();
create or replace function public.tournament_list() returns table (
  id uuid, kind text, name text, description text, location text, starts_at timestamptz, ends_at timestamptz,
  status text, swiss_rounds int, top_cut int, arena_count int, current_round int, max_players int,
  created_by uuid, organizer_nick text, players bigint, finished_at timestamptz, event_type text)
language sql stable security definer set search_path = public as $$
  select t.id, t.kind, t.name, t.description, t.location, t.starts_at, t.ends_at, t.status, t.swiss_rounds, t.top_cut,
         t.arena_count, t.current_round, t.max_players, t.created_by, p.nick,
         (select count(*) from public.registrations r where r.tournament_id = t.id and r.status = 'active'), t.finished_at,
         t.event_type
    from public.tournaments t left join public.profiles p on p.id = t.created_by
   order by case t.status when 'swiss' then 0 when 'topcut' then 0 when 'show' then 0 when 'registration' then 1 else 2 end,
            case when t.status in ('finished','canceled') then null else t.starts_at end asc nulls last,
            t.starts_at desc nulls last
$$;

-- tituly a pódia v profilu a v seznamu hráčů jen z turnajů (fashion má vlastní achievementy)
create or replace function public.players_list() returns table (
  id uuid, nick text, region text, avatar text, role text, rating int, created_at timestamptz,
  tournaments bigint, titles bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.nick, p.region, p.avatar, p.role, p.rating, p.created_at,
         (select count(*) from public.registrations r join public.tournaments t on t.id = r.tournament_id
           where r.user_id = p.id and t.kind = 'tournament' and t.status = 'finished'),
         (select count(*) from public.registrations r join public.tournaments t on t.id = r.tournament_id
           where r.user_id = p.id and r.final_place = 1 and t.kind = 'tournament')
    from public.profiles p join auth.users u on u.id = p.id
   where p.nick is not null and not coalesce(u.is_anonymous, false)
   order by p.rating desc, p.nick
$$;

create or replace function public.player_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with regs as (
    select r.*, t.name as t_name, t.starts_at, t.status as t_status, t.kind, t.event_type, t.finished_at,
           (select count(*) from public.registrations x where x.tournament_id = t.id and x.status = 'active') as players
      from public.registrations r join public.tournaments t on t.id = r.tournament_id
     where r.user_id = p_user
  ),
  my_matches as (
    select m.*, case when m.p1_reg = rg.id then 1 else 2 end as side, rg.t_name, rg.t_status
      from public.matches m join regs rg on rg.id in (m.p1_reg, m.p2_reg)
     where m.status = 'done' and not m.is_bye
  ),
  bey_rows as (
    select case when mm.side = 1 then p.p1_bey else p.p2_bey end as bey,
           case when p.scorer_slot = mm.side then 1 else 0 end as won,
           case when p.scorer_slot = 0 then 1 else 0 end as draw,
           case when p.scorer_slot = mm.side then p.pts else 0 end as pts
      from my_matches mm join public.games g on g.match_id = mm.id join public.points p on p.game_id = g.id
     where mm.t_status = 'finished'
  )
  select jsonb_build_object(
    'tournaments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', tournament_id, 'name', t_name, 'starts_at', starts_at, 'status', t_status, 'kind', kind,
        'event_type', event_type,
        'place', case when kind = 'tournament' then final_place end, 'players', players,
        'beys', case when kind = 'tournament' and (t_status = 'finished' or p_user = auth.uid()) then jsonb_build_array(bey1,bey2,bey3) end)
        order by coalesce(starts_at, created_at) desc) from regs), '[]'),
    'record', jsonb_build_object(
        'wins',   (select count(*) from my_matches where winner_reg in (select id from regs)),
        'losses', (select count(*) from my_matches where loser_reg  in (select id from regs)),
        'points_for',     (select coalesce(sum(case when side = 1 then p1_score else p2_score end),0) from my_matches),
        'points_against', (select coalesce(sum(case when side = 1 then p2_score else p1_score end),0) from my_matches),
        'titles', (select count(*) from regs where final_place = 1 and kind = 'tournament'),
        'podiums',(select count(*) from regs where final_place between 1 and 3 and kind = 'tournament')),
    'beys', coalesce((select jsonb_agg(b order by (b->>'battles')::int desc) from (
        select jsonb_build_object('bey', bey, 'battles', count(*), 'wins', sum(won), 'draws', sum(draw), 'points', sum(pts)) as b
          from bey_rows where bey is not null group by bey) q), '[]'),
    'recent', coalesce((select jsonb_agg(x order by x->>'finished_at' desc) from (
        select jsonb_build_object(
          'match_id', mm.id, 'tournament_id', mm.tournament_id, 'tournament', mm.t_name, 'stage', mm.stage, 'round', mm.round,
          'finished_at', mm.finished_at,
          'won', mm.winner_reg in (select id from regs),
          'my_score', case when mm.side = 1 then mm.p1_score else mm.p2_score end,
          'opp_score', case when mm.side = 1 then mm.p2_score else mm.p1_score end,
          'my_wins', case when mm.side = 1 then mm.p1_wins else mm.p2_wins end,
          'opp_wins', case when mm.side = 1 then mm.p2_wins else mm.p1_wins end,
          'best_of', mm.best_of,
          'opponent', (select nick from public.registrations o where o.id = case when mm.side = 1 then mm.p2_reg else mm.p1_reg end),
          'opponent_user', (select user_id from public.registrations o where o.id = case when mm.side = 1 then mm.p2_reg else mm.p1_reg end)
        ) as x from my_matches mm order by mm.finished_at desc limit 30) q), '[]'),
    'rating', coalesce((select jsonb_agg(jsonb_build_object('rating', rating, 'delta', delta, 'at', created_at) order by created_at)
                          from public.rating_history where user_id = p_user), '[]')
  )
$$;

-- fashion se neukončuje obecným „Ukončit akci“ (jen přes vyhlášení)
create or replace function public.finish_tournament(p_tournament uuid, p_placements jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; pl jsonb;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status in ('finished','canceled') then raise exception 'Turnaj už je ukončený.'; end if;
  if t.kind = 'event' and t.event_type = 'fashion' then raise exception 'Fashion se ukončuje vyhlášením výsledků.'; end if;
  if t.kind = 'tournament' then
    if t.status = 'registration' then raise exception 'Turnaj ještě nezačal.'; end if;
    if exists (select 1 from public.matches where tournament_id = t.id and status <> 'done') then
      raise exception 'Některé zápasy ještě nejsou dohrané.';
    end if;
  end if;
  for pl in select * from jsonb_array_elements(coalesce(p_placements,'[]'::jsonb)) loop
    update public.registrations set final_place = (pl->>'place')::int
     where id = (pl->>'reg')::uuid and tournament_id = t.id;
  end loop;
  update public.tournaments set status = 'finished', finished_at = now() where id = t.id;
end $$;

-- odstoupení hráče během show (organizátor): přeskočí se a nepočítá se do výsledků
create or replace function public.fashion_drop(p_tournament uuid, p_reg uuid, p_drop boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'show' or t.fashion->>'phase' <> 'scoring' then raise exception 'Hodnocení teď neběží.'; end if;
  if p_drop and p_reg::text = t.fashion->>'current' and coalesce((t.fashion->>'last')::boolean, false) then
    raise exception 'Posledního vyvolaného hráče nejde vyřadit – nejdřív ho ohodnoťte, nebo ukonči show.';
  end if;
  update public.registrations set status = case when p_drop then 'dropped' else 'active' end
   where id = p_reg and tournament_id = t.id;
  if p_drop and p_reg::text = t.fashion->>'current' then
    perform public.bbx_fashion_advance(t.id);
  else
    perform public.bbx_fashion_set(t.id, jsonb_build_object('last',
             public.bbx_fashion_next_reg(t.id, (t.fashion->>'current')::uuid) is null));
  end if;
end $$;
