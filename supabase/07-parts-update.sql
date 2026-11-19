-- ════════════════════════════════════════════════════════════════════
--  BBXU – doplnění katalogu dílů (stav listopad 2026)
--  Zdroj: kyoganken.sakura.ne.jp/beyx/weight1.htm (Takara Tomy), anglické názvy
--  ověřené podle obchodů a Beyblade Wiki. Hlavní název = Takara Tomy,
--  Hasbro názvy jsou v aliases (našeptávač je najde, do decku se uloží TT název).
--  Spusť v Supabase → SQL Editor. Jde spustit i opakovaně (nic nemaže,
--  existující díly jen doplní o zkratku a přezdívky).
-- ════════════════════════════════════════════════════════════════════

insert into public.bey_parts (category, name, abbr, aliases, integrated, note)
select category, name, abbr, aliases, integrated, note
  from (values
  -- ratchety
  ('ratchet', '0-70', null, '{}'::text[], false, null),
  ('ratchet', '5-50', null, '{}', false, null),
  -- bity (nové + chybějící zkratky)
  ('bit', 'Low Cyclone', 'LC', '{}', false, 'BX-52'),
  ('bit', 'Under Flat', 'UF', '{}', false, null),
  ('bit', 'Disk Spike', 'DS', '{}', false, null),
  ('bit', 'Gear Unite', 'GU', '{}', false, null),
  ('bit', 'Jolt', 'J', '{}', false, null),
  ('bit', 'Merge', 'M', '{}', false, null),
  ('bit', 'Narrow', 'Nr', '{}', false, null),
  ('bit', 'Zap', 'Z', '{}', false, null),
  ('bit', 'Operate', 'Op', '{}', true, 'integrovaný ratchet'),
  -- blady Takara Tomy (nové)
  ('blade', 'Luster Dragoon', null, '{LusterDragoon}', false, 'BX-52, levá rotace'),
  ('blade', 'Goat Tackle', null, '{Tackle Goat,GoatTackle}', false, 'BX-46'),
  ('blade', 'Storm Spriggan', null, '{StormSpriggan}', false, null),
  ('blade', 'Samurai Steel', null, '{Steel Samurai}', false, null),
  ('blade', 'Shark Gill', null, '{Gill Shark,SharkGill}', false, 'CX-11'),
  ('blade', 'Tricera Spiky', null, '{TriceraSpiky}', false, null),
  ('blade', 'Dran Sword V2', null, '{Dran Sword Ver.2.0,Sword Dran V2}', false, null),
  ('blade', 'Wizard Arrow V2', null, '{Wizard Arrow Ver.2.0,Arrow Wizard V2}', false, 'BX-53'),
  ('blade', 'Knight Shield V2', null, '{Knight Shield Ver.2.0,Helm Knight V2}', false, 'BX-53'),
  -- kolaborace (Marvel, Star Wars, Transformers)
  ('blade', 'Iron Man', null, '{Ironman}', false, 'Marvel'),
  ('blade', 'Thanos', null, '{}', false, 'Marvel'),
  ('blade', 'Spider-Man', null, '{Spiderman,Spider Man}', false, 'Marvel'),
  ('blade', 'Venom', null, '{}', false, 'Marvel'),
  ('blade', 'Luke Skywalker', null, '{}', false, 'Star Wars'),
  ('blade', 'Darth Vader', null, '{}', false, 'Star Wars'),
  ('blade', 'The Mandalorian', null, '{Mandalorian}', false, 'Star Wars'),
  ('blade', 'Moff Gideon', null, '{}', false, 'Star Wars'),
  ('blade', 'Optimus Prime', null, '{}', false, 'Transformers'),
  ('blade', 'Megatron', null, '{}', false, 'Transformers'),
  ('blade', 'Optimus Primal', null, '{}', false, 'Transformers'),
  ('blade', 'Starscream', null, '{}', false, 'Transformers'),
  ('blade', 'Bumblebee', null, '{}', false, 'Transformers (Hasbro)'),
  -- jen Hasbro
  ('blade', 'Yell Kong', null, '{}', false, 'Hasbro'),
  ('blade', 'Stun Medusa', null, '{}', false, 'Hasbro'),
  -- Hasbro názvy existujících bladů
  ('blade', 'Hells Chain', null, '{Chain Incendio}', false, null),
  ('blade', 'Knight Shield', null, '{Helm Knight}', false, null),
  ('blade', 'Shark Edge', null, '{Keel Shark}', false, null),
  ('blade', 'Leon Claw', null, '{Claw Leon}', false, null),
  ('blade', 'Viper Tail', null, '{Tail Viper}', false, null),
  ('blade', 'Rhino Horn', null, '{Horn Rhino}', false, null),
  ('blade', 'Phoenix Feather', null, '{Feather Phoenix}', false, null),
  ('blade', 'Wyvern Gale', null, '{Gale Wyvern}', false, null),
  ('blade', 'Unicorn Sting', null, '{Sting Unicorn}', false, null),
  ('blade', 'Dran Buster', null, '{Buster Dran}', false, null),
  ('blade', 'Hells Hammer', null, '{Hammer Incendio}', false, null),
  ('blade', 'Wizard Rod', null, '{Wand Wizard}', false, null),
  ('blade', 'Tyranno Beat', null, '{Beat Tyranno}', false, null),
  ('blade', 'Weiss Tiger', null, '{Pearl Tiger}', false, null),
  ('blade', 'Black Shell', null, '{Obsidian Shell}', false, null),
  ('blade', 'Phoenix Rudder', null, '{Rudder Phoenix}', false, null),
  ('blade', 'Silver Wolf', null, '{Sterling Wolf}', false, null),
  ('blade', 'Samurai Saber', null, '{Saber Samurai}', false, null),
  ('blade', 'Knight Mail', null, '{Mail Knight}', false, null),
  ('blade', 'Ghost Circle', null, '{Circle Ghost}', false, null),
  ('blade', 'Golem Rock', null, '{Rock Golem}', false, null),
  ('blade', 'Tyranno Roar', null, '{Roar Tyranno}', false, null),
  ('blade', 'Tricera Press', null, '{Ridge Triceratops}', false, null),
  ('blade', 'Shark Scale', null, '{Scale Shark}', false, null),
  ('blade', 'Meteor Dragoon', null, '{Meteoroid Dragoon}', false, null),
  ('blade', 'Mammoth Tusk', null, '{Tusk Mammoth}', false, null),
  ('blade', 'Wyvern Hover', null, '{Hover Wyvern}', false, null),
  ('blade', 'Shinobi Knife', null, '{Knife Shinobi}', false, null),
  ('blade', 'Croc Crunch', null, '{Bite Croc}', false, null),
  -- CX: lock chipy
  ('lock_chip', 'Leon', null, '{}', false, null),
  ('lock_chip', 'Bucks', null, '{Stag}', false, null),
  ('lock_chip', 'Kraken', null, '{}', false, null),
  ('lock_chip', 'Hornet', null, '{}', false, null),
  ('lock_chip', 'Croc', null, '{Croco}', false, 'CX-19'),
  ('lock_chip', 'Hells', null, '{Incendio}', false, null),
  -- CX: main / metal / over / assist blady
  ('main_blade', 'Fang', null, '{}', false, null),
  ('main_blade', 'Fort', null, '{}', false, null),
  ('main_blade', 'Wriggle', null, '{Wiggle}', false, null),
  ('main_blade', 'Antlers', null, '{Antler}', false, null),
  ('main_blade', 'Brave', null, '{Courage}', false, null),
  ('metal_blade', 'Tread', null, '{}', false, 'CX-19'),
  ('over_blade', 'Tough', 'T', '{}', false, null),
  ('over_blade', 'Flow', 'F', '{}', false, null),
  ('over_blade', 'Peak', 'P', '{}', false, null),
  ('over_blade', 'Outer', 'O', '{}', false, null),
  ('assist_blade', 'Quell', 'Q', '{}', false, null),
  ('assist_blade', 'Erase', 'E', '{}', false, null),
  ('assist_blade', 'Gravity', 'G', '{}', false, null),
  ('assist_blade', 'Odd', 'O', '{}', false, null)
  ) v(category, name, abbr, aliases, integrated, note)
on conflict (category, lower(btrim(name))) do update
  set abbr       = coalesce(public.bey_parts.abbr, excluded.abbr),
      aliases    = (select coalesce(array_agg(distinct a order by a), '{}')
                      from unnest(public.bey_parts.aliases || excluded.aliases) a),
      integrated = public.bey_parts.integrated or excluded.integrated,
      note       = coalesce(public.bey_parts.note, excluded.note),
      active     = true;
