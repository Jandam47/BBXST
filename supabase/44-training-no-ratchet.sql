-- ════════════════════════════════════════════════════════════════════
--  44: Trénink – bey bez ratchetu
--  Na komunitním tréninku (deck v BBXU i sestava v BBXST SETUPu) jde bey zadat bez ratchetu
--  (kolečko ratchetu → „Bez ratchetu“). Název = jako u dílu s integrovaným ratchetem („Blade Bit“).
--  Turnaje, fashion a oblíbené buildy ratchet dál vyžadují.
--  Povolení nese proměnná transakce bbx.free_ratchet: nastaví ji trigger bbx_free_ratchet (běží
--  před registrations_protect, u každého řádku znovu – jen u komunitního tréninku 'on') a training_setup.
--  Idempotentní.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.bbx_free_ratchet() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('bbx.free_ratchet', true), '') = 'on'
$$;
revoke execute on function public.bbx_free_ratchet() from public, anon, authenticated;

-- ── název beye: bez ratchetu jen s povolením ──
create or replace function public.bbx_compose_bey(b jsonb, p_index int default 1) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  bl public.bey_parts; lk public.bey_parts; mn public.bey_parts; ov public.bey_parts; asb public.bey_parts;
  rt public.bey_parts; bt public.bey_parts;
  blade_name text; prefix text := ''; integrated boolean := false; tail text;
begin
  if b is null or jsonb_typeof(b) <> 'object' then raise exception 'Beyblade % není vyplněný.', p_index; end if;
  if coalesce(b->>'type','bx') = 'cx' then
    lk  := public.bbx_part(array['lock_chip'], b->>'lock', 'lock chip (bey ' || p_index || ')');
    mn  := public.bbx_part(array['main_blade','metal_blade'], b->>'main', 'main blade (bey ' || p_index || ')');
    if mn.category = 'metal_blade' then
      ov := public.bbx_part(array['over_blade'], b->>'over', 'over blade (bey ' || p_index || ')');
      prefix := coalesce(ov.abbr, ov.name || ' ');
    end if;
    asb := public.bbx_part(array['assist_blade'], b->>'assist', 'assist blade (bey ' || p_index || ')');
    prefix := prefix || coalesce(asb.abbr, asb.name || ' ');
    blade_name := lk.name || ' ' || mn.name;
  else
    bl := public.bbx_part(array['blade'], b->>'blade', 'blade (bey ' || p_index || ')');
    blade_name := bl.name;
    integrated := bl.integrated;
  end if;

  bt := public.bbx_part(array['bit'], b->>'bit', 'bit (bey ' || p_index || ')');
  integrated := integrated or bt.integrated;
  if integrated or (nullif(btrim(coalesce(b->>'ratchet', '')), '') is null and public.bbx_free_ratchet()) then
    tail := coalesce(bt.abbr, ' ' || bt.name);
  else
    rt := public.bbx_part(array['ratchet'], b->>'ratchet', 'ratchet (bey ' || p_index || ')');
    tail := rt.name || coalesce(bt.abbr, ' ' || bt.name);
  end if;
  return btrim(blade_name || ' ' || btrim(prefix || tail));
end $$;
revoke execute on function public.bbx_compose_bey(jsonb, int) from public, anon, authenticated;

-- ── díly decku normalizované na oficiální názvy: bez ratchetu jen s povolením ──
create or replace function public.bbx_normalize_deck(p_deck jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb := '[]'; b jsonb; i int := 0; o jsonb; mn public.bey_parts; bt public.bey_parts; bl public.bey_parts;
begin
  for b in select * from jsonb_array_elements(p_deck) loop
    i := i + 1;
    bt := public.bbx_part(array['bit'], b->>'bit', 'bit');
    if coalesce(b->>'type','bx') = 'cx' then
      mn := public.bbx_part(array['main_blade','metal_blade'], b->>'main', 'main blade');
      o := jsonb_build_object('type','cx',
             'lock',   (public.bbx_part(array['lock_chip'], b->>'lock', 'lock chip')).name,
             'main',   mn.name,
             'over',   case when mn.category = 'metal_blade' then (public.bbx_part(array['over_blade'], b->>'over', 'over blade')).name end,
             'assist', (public.bbx_part(array['assist_blade'], b->>'assist', 'assist blade')).name);
    else
      bl := public.bbx_part(array['blade'], b->>'blade', 'blade');
      o := jsonb_build_object('type','bx','blade', bl.name);
    end if;
    o := o || jsonb_build_object('bit', bt.name,
           'ratchet', case when bt.integrated or coalesce(bl.integrated,false) then null
                           when nullif(btrim(coalesce(b->>'ratchet', '')), '') is null and public.bbx_free_ratchet() then null
                           else (public.bbx_part(array['ratchet'], b->>'ratchet', 'ratchet')).name end);
    out := out || jsonb_build_array(jsonb_strip_nulls(o));
    bl := null;
  end loop;
  return out;
end $$;
revoke execute on function public.bbx_normalize_deck(jsonb) from public, anon, authenticated;

-- ── registrace: povolení jen u komunitního tréninku (název triggeru se řadí před registrations_protect) ──
create or replace function public.bbx_free_ratchet_reg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('bbx.free_ratchet',
    case when exists (select 1 from public.tournaments t where t.id = new.tournament_id
                        and t.kind = 'event' and t.event_type = 'community') then 'on' else '' end, true);
  return new;
end $$;
revoke execute on function public.bbx_free_ratchet_reg() from public, anon, authenticated;

drop trigger if exists bbx_free_ratchet on public.registrations;
create trigger bbx_free_ratchet before insert or update on public.registrations
  for each row execute function public.bbx_free_ratchet_reg();

-- ── oblíbené buildy: ratchet povinný (i kdyby proměnná zůstala z dřívějška v transakci) ──
create or replace function public.bbx_fav_free_off() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('bbx.free_ratchet', '', true);
  return new;
end $$;
revoke execute on function public.bbx_fav_free_off() from public, anon, authenticated;

drop trigger if exists bbx_a_fav_free_off on public.fav_builds;
create trigger bbx_a_fav_free_off before insert or update on public.fav_builds
  for each row execute function public.bbx_fav_free_off();

-- ── BBXST SETUP: sestava smí mít bey bez ratchetu (jinak beze změny proti 41) ──
create or replace function public.training_setup(p_match uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.training_matches; mode text; win int; l1 jsonb; l2 jsonb; s jsonb; g record; tourney boolean; ch1 boolean; ch2 boolean;
begin
  m := public.bbx_tmatch(p_match);
  perform set_config('bbx.free_ratchet', 'on', true);
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
  -- změněná sestava se uloží hráči do decku na tomhle tréninku (další výzvy ji převezmou)
  ch1 := coalesce((p_settings->'lineup') ? 'p1', false)
         and (jsonb_path_query_array(l1, '$[*].name') is distinct from jsonb_path_query_array(coalesce(m.settings->'lineup'->'p1', '[]'), '$[*].name'));
  ch2 := coalesce((p_settings->'lineup') ? 'p2', false)
         and (jsonb_path_query_array(l2, '$[*].name') is distinct from jsonb_path_query_array(coalesce(m.settings->'lineup'->'p2', '[]'), '$[*].name'));
  if (ch1 and jsonb_array_length(l1) > 0) or (ch2 and jsonb_array_length(l2) > 0) then
    perform public.bbx_set_privileged();
    if ch1 and jsonb_array_length(l1) > 0 then
      update public.registrations set deck = (select jsonb_agg(b.value - 'name' order by b.ordinality) from jsonb_array_elements(l1) with ordinality b)
       where id = m.p1_reg;
    end if;
    if ch2 and jsonb_array_length(l2) > 0 then
      update public.registrations set deck = (select jsonb_agg(b.value - 'name' order by b.ordinality) from jsonb_array_elements(l2) with ordinality b)
       where id = m.p2_reg;
    end if;
  end if;
  return s;
end $$;

-- ── výchozí sestava z decku: název z registrace (bey1–3 složila DB při uložení decku) ──
create or replace function public.bbx_lineup(p_reg uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(b.value || jsonb_build_object('name',
                                      coalesce((array[r.bey1, r.bey2, r.bey3])[b.ordinality], public.bbx_compose_bey(b.value, b.ordinality::int)))
                                    order by b.ordinality)
                     from public.registrations r, jsonb_array_elements(r.deck) with ordinality b
                    where r.id = p_reg), '[]')
$$;
revoke execute on function public.bbx_lineup(uuid) from public, anon, authenticated;
