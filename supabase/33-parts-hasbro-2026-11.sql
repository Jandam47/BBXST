-- ════════════════════════════════════════════════════════════════════
--  33 – díly z Hasbro vlny BX Infinity (listopad 2026), které u Takara Tomy nejsou
--  Zdroj: Hasbro produkty (G2745 Suppress Superion 0-70LP, G4569 Glare Cyclops 7-55FB,
--  G4570 Seize Jaguar, G4568 Glory Valkerion / Valkyrie LF). Hlavní název = Hasbro.
--  Jde spustit i opakovaně (nic nemaže, existující díly jen doplní).
-- ════════════════════════════════════════════════════════════════════

insert into public.bey_parts (category, name, abbr, aliases, integrated, note)
select category, name, abbr, aliases, integrated, note
  from (values
  ('blade', 'Suppress Superion', null, '{Sieg Superion,SiegSuperion,Superion,Supress Superion}'::text[], false, 'Hasbro, G2745 (0-70LP)'),
  ('blade', 'Glare Cyclops', null, '{Cyclops,Gaze Cyclops}', false, 'Hasbro, G4569 (7-55FB)'),
  ('blade', 'Seize Jaguar', null, '{Jaguar}', false, 'Hasbro, G4570'),
  ('blade', 'Glory Valkyrie', null, '{Glory Valkerion}', false, null),
  ('bit', 'Low Point', 'LP', '{}', false, 'Hasbro, G2745')
  ) v(category, name, abbr, aliases, integrated, note)
on conflict (category, lower(btrim(name))) do update
  set abbr       = coalesce(public.bey_parts.abbr, excluded.abbr),
      aliases    = (select coalesce(array_agg(distinct a order by a), '{}')
                      from unnest(public.bey_parts.aliases || excluded.aliases) a),
      integrated = public.bey_parts.integrated or excluded.integrated,
      note       = coalesce(public.bey_parts.note, excluded.note),
      active     = true;
