-- ════════════════════════════════════════════════════════════════════
--  35: Oblíbené buildy a decky (★ Choose wheel v profilu)
--  fav_builds = jeden bey (stejný tvar jako v decku registrace), název skládá DB (bbx_compose_bey),
--               díly se normalizují na oficiální názvy (bbx_normalize_deck).
--  fav_decks  = název + seřazený seznam id buildů (1–10). Smazaný build z decků zmizí; deck bez buildů se smaže.
--  Jen vlastní řádky, jen účet (ne host). Limit 60 buildů a 20 decků na hráče.
--  Idempotentní.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.fav_builds (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  bey         jsonb not null,
  name        text not null default '',
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists fav_builds_user on public.fav_builds (user_id, created_at);

create table if not exists public.fav_decks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  builds      uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists fav_decks_user on public.fav_decks (user_id, created_at);

alter table public.fav_builds enable row level security;
alter table public.fav_decks  enable row level security;
drop policy if exists fav_builds_own on public.fav_builds;
create policy fav_builds_own on public.fav_builds for all to authenticated
  using (user_id = auth.uid() and not public.bbx_is_anon())
  with check (user_id = auth.uid() and not public.bbx_is_anon());
drop policy if exists fav_decks_own on public.fav_decks;
create policy fav_decks_own on public.fav_decks for all to authenticated
  using (user_id = auth.uid() and not public.bbx_is_anon())
  with check (user_id = auth.uid() and not public.bbx_is_anon());
revoke all on public.fav_builds, public.fav_decks from anon;
grant select, insert, update, delete on public.fav_builds, public.fav_decks to authenticated;

-- ── build: vlastník, normalizace dílů, název z DB, limity ──
create or replace function public.bbx_fav_build_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.bbx_privileged() then new.user_id := auth.uid(); end if;
    if (select count(*) from public.fav_builds where user_id = new.user_id) >= 60 then
      raise exception 'Maximálně 60 oblíbených buildů – nějaký smaž.';
    end if;
    new.created_at := now();
  else
    new.user_id := old.user_id; new.created_at := old.created_at;
  end if;
  if new.bey is null or jsonb_typeof(new.bey) <> 'object' or pg_column_size(new.bey) > 1000 then
    raise exception 'Build není vyplněný.';
  end if;
  new.bey  := (public.bbx_normalize_deck(jsonb_build_array(new.bey)))->0;
  new.name := public.bbx_compose_bey(new.bey, 1);
  new.note := nullif(left(btrim(coalesce(new.note, '')), 60), '');
  if exists (select 1 from public.fav_builds where user_id = new.user_id and lower(name) = lower(new.name)
               and id is distinct from new.id) then
    raise exception 'Build % už máš v oblíbených.', new.name;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.bbx_fav_build_fill() from public, anon, authenticated;
drop trigger if exists bbx_fav_build_fill on public.fav_builds;
create trigger bbx_fav_build_fill before insert or update on public.fav_builds
  for each row execute function public.bbx_fav_build_fill();

-- smazaný build zmizí z decků; deck, kterému nic nezůstane, se smaže
create or replace function public.bbx_fav_build_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.fav_decks where user_id = old.user_id and builds = array[old.id];
  update public.fav_decks set builds = array_remove(builds, old.id), updated_at = now()
   where user_id = old.user_id and old.id = any(builds);
  return old;
end $$;
revoke execute on function public.bbx_fav_build_gone() from public, anon, authenticated;
drop trigger if exists bbx_fav_build_gone on public.fav_builds;
create trigger bbx_fav_build_gone after delete on public.fav_builds
  for each row execute function public.bbx_fav_build_gone();

-- ── deck: vlastník, název, jen vlastní buildy bez opakování, limity ──
create or replace function public.bbx_fav_deck_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.bbx_privileged() then new.user_id := auth.uid(); end if;
    if (select count(*) from public.fav_decks where user_id = new.user_id) >= 20 then
      raise exception 'Maximálně 20 decků – nějaký smaž.';
    end if;
    new.created_at := now();
  else
    new.user_id := old.user_id; new.created_at := old.created_at;
  end if;
  new.name := btrim(coalesce(new.name, ''));
  if char_length(new.name) < 1 or char_length(new.name) > 40 then raise exception 'Název decku musí mít 1–40 znaků.'; end if;
  if cardinality(new.builds) < 1 or cardinality(new.builds) > 10 then raise exception 'Deck musí mít 1–10 beyů.'; end if;
  if (select count(distinct b) from unnest(new.builds) b) <> cardinality(new.builds) then
    raise exception 'Stejný build je v decku dvakrát.';
  end if;
  if exists (select 1 from unnest(new.builds) b
              where not exists (select 1 from public.fav_builds f where f.id = b and f.user_id = new.user_id)) then
    raise exception 'Deck může obsahovat jen tvoje oblíbené buildy.';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.bbx_fav_deck_fill() from public, anon, authenticated;
drop trigger if exists bbx_fav_deck_fill on public.fav_decks;
create trigger bbx_fav_deck_fill before insert or update on public.fav_decks
  for each row execute function public.bbx_fav_deck_fill();
