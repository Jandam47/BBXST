-- ════════════════════════════════════════════════════════════════════
--  BBXU – katalog dílů Beyblade X + kontrola registrací
--  Spusť v Supabase → SQL Editor PO souboru schema.sql (i na už běžícím projektu).
--  Nové díly pak přidáváš v Table Editor → bey_parts (viz README).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.bey_parts (
  id          bigint generated always as identity primary key,
  category    text not null,
  name        text not null,
  abbr        text,                       -- zkratka do názvu beye (F, GF, S…); prázdná = píše se celé jméno
  aliases     text[] not null default '{}', -- jiná jména (Hasbro, překlepy), podle nich taky našeptává
  integrated  boolean not null default false, -- blade / bit s pevně spojeným ratchetem
  active      boolean not null default true,  -- vypnutý díl se už nenabízí
  note        text,
  created_at  timestamptz not null default now(),
  constraint bey_parts_cat_chk check (category in
    ('blade','lock_chip','main_blade','metal_blade','over_blade','assist_blade','ratchet','bit')),
  constraint bey_parts_name_chk check (char_length(btrim(name)) between 1 and 40)
);
create unique index if not exists bey_parts_uniq on public.bey_parts (category, lower(btrim(name)));

alter table public.bey_parts enable row level security;
drop policy if exists bp_read on public.bey_parts;
create policy bp_read on public.bey_parts for select using (true);
-- zápis jen přes Supabase (Table Editor / SQL) nebo admin z aplikace
drop policy if exists bp_admin on public.bey_parts;
create policy bp_admin on public.bey_parts for all using (public.bbx_my_level() >= 3) with check (public.bbx_my_level() >= 3);

-- ── naplnění (stav listopad 2026; nové díly doplňuj v tabulce) ──
insert into public.bey_parts (category, name, abbr, aliases, integrated) values
-- celé blady BX / UX
  ('blade','Dran Sword',null,'{"Sword Dran"}',false), ('blade','Hells Scythe',null,'{"Scythe Incendio"}',false),
  ('blade','Wizard Arrow',null,'{"Arrow Wizard"}',false), ('blade','Knight Shield',null,'{}',false),
  ('blade','Knight Lance',null,'{}',false), ('blade','Shark Edge',null,'{}',false), ('blade','Leon Claw',null,'{}',false),
  ('blade','Viper Tail',null,'{}',false), ('blade','Rhino Horn',null,'{}',false), ('blade','Dran Dagger',null,'{"Dagger Dran"}',false),
  ('blade','Hells Chain',null,'{}',false), ('blade','Phoenix Feather',null,'{}',false), ('blade','Phoenix Wing',null,'{"Soar Phoenix"}',false),
  ('blade','Wyvern Gale',null,'{}',false), ('blade','Dranzer Spiral',null,'{"Dranzer S"}',false), ('blade','Cobalt Drake',null,'{}',false),
  ('blade','Unicorn Sting',null,'{}',false), ('blade','Sphinx Cowl',null,'{}',false), ('blade','Dran Buster',null,'{}',false),
  ('blade','Hells Hammer',null,'{}',false), ('blade','Wizard Rod',null,'{}',false), ('blade','Tyranno Beat',null,'{}',false),
  ('blade','Driger Slash',null,'{"Driger S"}',false), ('blade','Shinobi Shadow',null,'{}',false), ('blade','Weiss Tiger',null,'{}',false),
  ('blade','Cobalt Dragoon',null,'{}',false), ('blade','Black Shell',null,'{}',false), ('blade','Phoenix Rudder',null,'{}',false),
  ('blade','Leon Crest',null,'{}',false), ('blade','Aero Pegasus',null,'{}',false), ('blade','Lightning L-Drago',null,'{"L-Drago"}',false),
  ('blade','Whale Wave',null,'{"Tide Whale"}',false), ('blade','Bear Scratch',null,'{"Savage Bear"}',false), ('blade','Silver Wolf',null,'{}',false),
  ('blade','Knight Mail',null,'{}',false), ('blade','Ptera Swing',null,'{}',false), ('blade','Crimson Garuda',null,'{}',false),
  ('blade','Samurai Saber',null,'{}',false), ('blade','Impact Drake',null,'{}',false), ('blade','Ghost Circle',null,'{}',false),
  ('blade','Draciel Shield',null,'{"Draciel S"}',false), ('blade','Golem Rock',null,'{}',false), ('blade','Shelter Drake',null,'{}',false),
  ('blade','Xeno Xcalibur',null,'{}',false), ('blade','Victory Valkyrie',null,'{}',false), ('blade','Dragoon Storm',null,'{}',false),
  ('blade','Storm Pegasis',null,'{"Storm Pegasus"}',false), ('blade','Croc Crunch',null,'{}',false), ('blade','Shinobi Knife',null,'{}',false),
  ('blade','Mammoth Tusk',null,'{}',false), ('blade','Rock Leone',null,'{}',false), ('blade','Samurai Calibur',null,'{}',false),
  ('blade','Tricera Press',null,'{}',false), ('blade','Orochi Cluster',null,'{}',false), ('blade','Heavens Ring',null,'{}',false),
  ('blade','Dran Strike',null,'{}',false), ('blade','Scorpio Spear',null,'{}',false), ('blade','Tyranno Roar',null,'{}',false),
  ('blade','Shark Scale',null,'{}',false), ('blade','Clock Mirage',null,'{}',false), ('blade','Meteor Dragoon',null,'{}',false),
  ('blade','Mummy Curse',null,'{}',false), ('blade','Wyvern Hover',null,'{}',false),
  ('blade','Hells Nether',null,'{}',true), ('blade','Glory Valkyrie',null,'{}',true), ('blade','Bullet Griffon',null,'{"Bullet Gryphon"}',true),
-- CX lock chipy
  ('lock_chip','Dran',null,'{}',false), ('lock_chip','Wizard',null,'{}',false), ('lock_chip','Perseus',null,'{}',false),
  ('lock_chip','Hells',null,'{}',false), ('lock_chip','Rhino',null,'{}',false), ('lock_chip','Phoenix',null,'{}',false),
  ('lock_chip','Pegasus',null,'{}',false), ('lock_chip','Cerberus',null,'{"Kerbeus"}',false), ('lock_chip','Whale',null,'{}',false),
  ('lock_chip','Sol',null,'{}',false), ('lock_chip','Wolf',null,'{}',false), ('lock_chip','Fox',null,'{}',false),
  ('lock_chip','Emperor',null,'{}',false), ('lock_chip','Bahamut',null,'{}',false), ('lock_chip','Knight',null,'{}',false),
  ('lock_chip','Ragna',null,'{}',false), ('lock_chip','Unicorn',null,'{}',false), ('lock_chip','Brachio',null,'{}',false),
  ('lock_chip','Drake',null,'{}',false), ('lock_chip','Valkyrie',null,'{}',false),
-- CX main blady
  ('main_blade','Brave',null,'{}',false), ('main_blade','Arc',null,'{}',false), ('main_blade','Dark',null,'{}',false),
  ('main_blade','Reaper',null,'{}',false), ('main_blade','Brush',null,'{}',false), ('main_blade','Flare',null,'{}',false),
  ('main_blade','Blast',null,'{}',false), ('main_blade','Flame',null,'{}',false), ('main_blade','Eclipse',null,'{}',false),
  ('main_blade','Hunt',null,'{}',false), ('main_blade','Might',null,'{}',false), ('main_blade','Volt',null,'{}',false),
-- CX metal blady (s over bladem)
  ('metal_blade','Whip',null,'{}',false), ('metal_blade','Delta',null,'{}',false), ('metal_blade','Rage',null,'{}',false),
  ('metal_blade','Fortress',null,'{}',false), ('metal_blade','Blitz',null,'{}',false),
-- CX over blady
  ('over_blade','Guard','G','{}',false), ('over_blade','Break','B','{}',false), ('over_blade','Outer',null,'{}',false),
  ('over_blade','Peak',null,'{}',false), ('over_blade','Flow',null,'{}',false),
-- CX assist blady
  ('assist_blade','Slash','S','{}',false), ('assist_blade','Round','R','{}',false), ('assist_blade','Bumper','B','{}',false),
  ('assist_blade','Turn','T','{}',false), ('assist_blade','Charge','C','{}',false), ('assist_blade','Zillion','Z','{}',false),
  ('assist_blade','Assault','A','{}',false), ('assist_blade','Dual','D','{}',false), ('assist_blade','Wheel','W','{}',false),
  ('assist_blade','Massive','M','{}',false), ('assist_blade','Free','F','{}',false), ('assist_blade','Jaggy','J','{}',false),
  ('assist_blade','Heavy','H','{}',false), ('assist_blade','Knuckle','K','{}',false), ('assist_blade','Vertical','V','{}',false),
  ('assist_blade','Wall',null,'{}',false), ('assist_blade','Odd',null,'{}',false), ('assist_blade','Erase',null,'{}',false),
  ('assist_blade','Gravity',null,'{}',false),
-- ratchety
  ('ratchet','0-60',null,'{}',false), ('ratchet','0-80',null,'{}',false), ('ratchet','1-50',null,'{}',false), ('ratchet','1-60',null,'{}',false),
  ('ratchet','1-70',null,'{}',false), ('ratchet','1-80',null,'{}',false), ('ratchet','2-60',null,'{}',false), ('ratchet','2-70',null,'{}',false),
  ('ratchet','2-80',null,'{}',false), ('ratchet','3-60',null,'{}',false), ('ratchet','3-70',null,'{}',false), ('ratchet','3-80',null,'{}',false),
  ('ratchet','3-85',null,'{}',false), ('ratchet','4-50',null,'{}',false), ('ratchet','4-55',null,'{}',false), ('ratchet','4-60',null,'{}',false),
  ('ratchet','4-70',null,'{}',false), ('ratchet','4-80',null,'{}',false), ('ratchet','5-60',null,'{}',false), ('ratchet','5-70',null,'{}',false),
  ('ratchet','5-80',null,'{}',false), ('ratchet','6-60',null,'{}',false), ('ratchet','6-70',null,'{}',false), ('ratchet','6-80',null,'{}',false),
  ('ratchet','7-55',null,'{}',false), ('ratchet','7-60',null,'{}',false), ('ratchet','7-70',null,'{}',false), ('ratchet','7-80',null,'{}',false),
  ('ratchet','8-70',null,'{}',false), ('ratchet','8-80',null,'{}',false), ('ratchet','9-60',null,'{}',false), ('ratchet','9-65',null,'{}',false),
  ('ratchet','9-70',null,'{}',false), ('ratchet','9-80',null,'{}',false), ('ratchet','M-85',null,'{}',false),
-- bity
  ('bit','Flat','F','{}',false), ('bit','Taper','T','{}',false), ('bit','Ball','B','{}',false), ('bit','Needle','N','{}',false),
  ('bit','High Needle','HN','{}',false), ('bit','Low Flat','LF','{}',false), ('bit','Orb','O','{}',false), ('bit','Point','P','{}',false),
  ('bit','Spike','S','{}',false), ('bit','Rush','R','{}',false), ('bit','High Taper','HT','{}',false), ('bit','Gear Flat','GF','{}',false),
  ('bit','Gear Ball','GB','{}',false), ('bit','Gear Point','GP','{}',false), ('bit','Gear Needle','GN','{}',false), ('bit','Accel','A','{}',false),
  ('bit','Disk Ball','DB','{"Disc Ball"}',false), ('bit','Hexa','H','{}',false), ('bit','Quake','Q','{}',false), ('bit','Metal Needle','MN','{}',false),
  ('bit','Unite','U','{}',false), ('bit','Dot','D','{}',false), ('bit','Cyclone','C','{}',false), ('bit','Glide','G','{}',false),
  ('bit','Elevate','E','{}',false), ('bit','Level','L','{}',false), ('bit','Bound Spike','BS','{}',false), ('bit','Rubber Accel','RA','{}',false),
  ('bit','Trans Point','TP','{}',false), ('bit','Free Ball','FB','{}',false), ('bit','Under Needle','UN','{}',false), ('bit','Low Rush','LR','{}',false),
  ('bit','Vortex','V','{}',false), ('bit','Low Orb','LO','{}',false), ('bit','Wedge','W','{}',false), ('bit','Kick','K','{}',false),
  ('bit','Wall Ball','WB','{}',false), ('bit','Wall Wedge','WW','{}',false), ('bit','Trans Kick','TK','{}',false), ('bit','Yielding','Y','{}',false),
  ('bit','Ignition','I','{}',false), ('bit','Free Flat','FF','{}',false), ('bit','Gear Rush','GR','{}',false),
  ('bit','Narrow',null,'{}',false), ('bit','Gear Unite',null,'{}',false), ('bit','Zap',null,'{}',false), ('bit','Jolt',null,'{}',false),
  ('bit','Under Flat',null,'{}',false), ('bit','Disk Spike',null,'{"Disc Spike"}',false), ('bit','Merge',null,'{}',false),
  ('bit','Turbo','Tr','{}',true), ('bit','Operate',null,'{}',true)
on conflict do nothing;

-- ════════════════════════════════════════════════════════════════════
--  Skládání beye z dílů
--  deck = pole 3 beyů, každý:
--    {"type":"bx","blade":"Dran Sword","ratchet":"3-60","bit":"Flat"}
--    {"type":"cx","lock":"Dran","main":"Brave","assist":"Slash","ratchet":"6-60","bit":"Vortex"}
--    {"type":"cx","lock":"Knight","main":"Fortress","over":"Guard","assist":"Vertical","ratchet":"8-70","bit":"Under Needle"}
--  → název „Dran Sword 3-60F“, „Dran Brave S6-60V“, „Knight Fortress GV8-70UN“
-- ════════════════════════════════════════════════════════════════════

create or replace function public.bbx_part(p_categories text[], p_name text, p_label text)
returns public.bey_parts
language plpgsql stable security definer set search_path = public as $$
declare r public.bey_parts; n text := lower(btrim(coalesce(p_name,'')));
begin
  if n = '' then raise exception 'Vyplň %.', p_label; end if;
  select * into r from public.bey_parts
   where category = any(p_categories)
     and (lower(btrim(name)) = n or n = any(select lower(btrim(a)) from unnest(aliases) a))
   order by active desc, (lower(btrim(name)) = n) desc
   limit 1;
  if not found then raise exception '% „%“ v seznamu dílů není.', initcap(p_label), btrim(p_name); end if;
  return r;
end $$;

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
  if integrated then
    tail := coalesce(bt.abbr, ' ' || bt.name);
  else
    rt := public.bbx_part(array['ratchet'], b->>'ratchet', 'ratchet (bey ' || p_index || ')');
    tail := rt.name || coalesce(bt.abbr, ' ' || bt.name);
  end if;
  return btrim(blade_name || ' ' || btrim(prefix || tail));
end $$;

-- díly decku normalizované na oficiální názvy (pro statistiky)
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
                           else (public.bbx_part(array['ratchet'], b->>'ratchet', 'ratchet')).name end);
    out := out || jsonb_build_array(jsonb_strip_nulls(o));
    bl := null;
  end loop;
  return out;
end $$;

-- ════════════════════════════════════════════════════════════════════
--  Registrace: deck je povinný, názvy beyů se skládají v databázi
-- ════════════════════════════════════════════════════════════════════
alter table public.registrations add column if not exists deck jsonb;

create or replace function public.bbx_protect_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  prof public.profiles;
  manager boolean;
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
    -- deck kontroluj při zápisu nové registrace a při jeho změně (ne při odstoupení apod.)
    if tg_op = 'INSERT' or new.deck is distinct from old.deck then
      if new.deck is null or jsonb_typeof(new.deck) <> 'array' or jsonb_array_length(new.deck) <> 3 then
        raise exception 'Vyber tři beyblady ze seznamu dílů.';
      end if;
      new.bey1 := public.bbx_compose_bey(new.deck->0, 1);
      new.bey2 := public.bbx_compose_bey(new.deck->1, 2);
      new.bey3 := public.bbx_compose_bey(new.deck->2, 3);
      new.deck := public.bbx_normalize_deck(new.deck);
    elsif tg_op = 'UPDATE' then
      new.bey1 := old.bey1; new.bey2 := old.bey2; new.bey3 := old.bey3;
    end if;
    if lower(new.bey1) in (lower(new.bey2), lower(new.bey3)) or lower(new.bey2) = lower(new.bey3) then
      raise exception 'Každý beyblade musí být jiný.';
    end if;
  else
    new.deck := null; new.bey1 := null; new.bey2 := null; new.bey3 := null;
  end if;
  return new;
end $$;

-- moje registrace vrací i deck (kvůli úpravě v aplikaci)
drop function if exists public.my_registration(uuid);
create or replace function public.my_registration(p_tournament uuid)
returns table (id uuid, tournament_id uuid, nick text, bey1 text, bey2 text, bey3 text, deck jsonb,
               qr_token uuid, status text, seed int, final_place int, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.tournament_id, r.nick, r.bey1, r.bey2, r.bey3, r.deck, r.qr_token, r.status, r.seed, r.final_place, r.created_at, r.updated_at
    from public.registrations r
   where r.tournament_id = p_tournament and r.user_id = auth.uid() and auth.uid() is not null
$$;

-- hráč bez telefonu – teď s deckem ze seznamu dílů
drop function if exists public.add_walkin(uuid, text, text, text, text);
create or replace function public.add_walkin(p_tournament uuid, p_nick text, p_deck jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; rid uuid;
begin
  t := public.bbx_require_manager(p_tournament);
  if t.status <> 'registration' then raise exception 'Registrace je uzavřená.'; end if;
  insert into public.registrations (tournament_id, user_id, nick, deck)
  values (t.id, null, p_nick, p_deck) returning id into rid;
  return rid;
end $$;

-- náhled názvu pro aplikaci (stejná logika jako při uložení)
create or replace function public.compose_bey(p_bey jsonb) returns text
language sql stable security definer set search_path = public as $$
  select public.bbx_compose_bey(p_bey, 1)
$$;
