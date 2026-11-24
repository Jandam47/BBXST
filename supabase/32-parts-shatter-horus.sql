-- ════════════════════════════════════════════════════════════════════
--  32 – díly: Shatter Horus (Hasbro, BX Infinity, G4567: Shatter Horus 9-65GB) + Hasbro názvy
--  Shatter Horus je jen Hasbro blade (u Takara Tomy není), proto hlavní název = Hasbro.
--  K existujícím Leon Crest / Sphinx Cowl doplní Hasbro přezdívky Crest Leon / Cowl Sphinx.
--  Jde spustit i opakovaně (nic nemaže, existující díly jen doplní).
-- ════════════════════════════════════════════════════════════════════

insert into public.bey_parts (category, name, abbr, aliases, integrated, note)
select category, name, abbr, aliases, integrated, note
  from (values
  ('blade', 'Shatter Horus', null, '{Horus Shatter,ShatterHorus,Horus}'::text[], false, 'Hasbro, G4567 (9-65GB)'),
  ('blade', 'Leon Crest', null, '{Crest Leon}', false, null),
  ('blade', 'Sphinx Cowl', null, '{Cowl Sphinx}', false, null)
  ) v(category, name, abbr, aliases, integrated, note)
on conflict (category, lower(btrim(name))) do update
  set abbr       = coalesce(public.bey_parts.abbr, excluded.abbr),
      aliases    = (select coalesce(array_agg(distinct a order by a), '{}')
                      from unnest(public.bey_parts.aliases || excluded.aliases) a),
      integrated = public.bey_parts.integrated or excluded.integrated,
      note       = coalesce(public.bey_parts.note, excluded.note),
      active     = true;
