-- ════════════════════════════════════════════════════════════════════
--  41: Trénink – sestava změněná v BBXST SETUPu se uloží do decku
--  training_setup: když se sestava hráče v setupu změní (jiný bey nebo upravené díly), uloží se
--  hráči do decku na tomhle tréninku (registrations.deck, 1–3 beye). Další výzvy i stránka tréninku
--  v BBXU ji pak mají. Platí pro oba hráče dvojice (i bota), mění ji hráč i judge. Idempotentní.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.training_setup(p_match uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.training_matches; mode text; win int; l1 jsonb; l2 jsonb; s jsonb; g record; tourney boolean; ch1 boolean; ch2 boolean;
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
