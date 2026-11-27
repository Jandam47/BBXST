-- ════════════════════════════════════════════════════════════════════
--  45: Zakázaná slova (cenzura)
--  Seznam `banned_words` spravuje jen hlavní admin (profil → ⚙ → Správa → Zakázaná slova).
--  Nick (profil i registrace / hráč bez účtu / bot) se zakázaným slovem nejde uložit,
--  v chatu se slovo nahradí hvězdičkami.
--  Porovnání: malá písmena, bez diakritiky, leetspeak (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s),
--  zdvojená písmena jako jedno (kuuurva = kurva). Slovo „exact“ platí jen jako celé slovo
--  (např. „pica“ nechytí „EpicUser“), ostatní i uvnitř slova („kurv“ chytí kurva, kurvo, kurvy…).
--  Nick se navíc čte i bez mezer a teček (k.u.r.v.a).
--  Idempotentní.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.banned_words (
  word       text primary key,
  exact      boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint banned_words_chk check (word = lower(btrim(word)) and char_length(word) between 2 and 40)
);
alter table public.banned_words enable row level security;   -- jen přes RPC
revoke all on public.banned_words from anon, authenticated;

-- normalizace pro porovnání (bez diakritiky, leetspeak, zdvojená písmena)
create or replace function public.bbx_norm_word(p text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(
           translate(lower(coalesce(p, '')),
                     'áäàâãåčćçďéěëèêíïìîľĺňńñóöòôõőřŕšśťúůüùûűýÿžź013457@$!',
                     'aaaaaacccdeeeeeiiiillnnnoooooorrsstuuuuuuyyzzoieastasi'),
           '(.)\1+', '\1', 'g')
$$;
revoke execute on function public.bbx_norm_word(text) from public, anon, authenticated;

-- obsahuje normalizovaný token zakázané slovo?
create or replace function public.bbx_bad_token(p_norm text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_norm <> '' and exists (
    select 1 from public.banned_words w, lateral (select public.bbx_norm_word(w.word) n) x
     where (w.exact and p_norm = x.n) or (not w.exact and position(x.n in p_norm) > 0))
$$;
revoke execute on function public.bbx_bad_token(text) from public, anon, authenticated;

-- je v textu (nick) zakázané slovo? po slovech i celé bez oddělovačů
create or replace function public.bbx_has_banned(p text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t text;
begin
  if p is null or btrim(p) = '' then return false; end if;
  for t in select m[1] from regexp_matches(p, '([[:alnum:]@$]+)', 'g') m loop
    if public.bbx_bad_token(public.bbx_norm_word(t)) then return true; end if;
  end loop;
  -- i dohromady (k.u.r.v.a, k u r v a) – jen slova uvnitř, ne „exact“
  return exists (
    select 1 from public.banned_words w
     where not w.exact
       and position(public.bbx_norm_word(w.word)
                    in public.bbx_norm_word(regexp_replace(p, '[^[:alnum:]@$]+', '', 'g'))) > 0);
end $$;
revoke execute on function public.bbx_has_banned(text) from public, anon, authenticated;

-- text se zakázanými slovy nahrazenými hvězdičkami (chat)
create or replace function public.bbx_censor(p text) returns text
language plpgsql stable security definer set search_path = public as $$
declare out text := ''; m text[];
begin
  if p is null or not exists (select 1 from public.banned_words) then return p; end if;
  for m in select regexp_matches(p, '([^[:alnum:]@$]*)([[:alnum:]@$]*)', 'g') loop
    out := out || m[1] || case when m[2] <> '' and public.bbx_bad_token(public.bbx_norm_word(m[2]))
                                then repeat('*', char_length(m[2])) else m[2] end;
  end loop;
  return out;
end $$;
revoke execute on function public.bbx_censor(text) from public, anon, authenticated;

-- ── nick v profilu: nový účet (z Discordu / registrace) s nevhodným nickem dostane prázdný nick,
--    změna nicku se odmítne ──
create or replace function public.bbx_nick_censor_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.nick is null then return new; end if;
  if tg_op = 'UPDATE' and new.nick is not distinct from old.nick then return new; end if;
  if public.bbx_has_banned(new.nick) then
    if tg_op = 'INSERT' then new.nick := null; return new; end if;
    raise exception 'Nick obsahuje nevhodné slovo. Zvol jiný.';
  end if;
  return new;
end $$;
revoke execute on function public.bbx_nick_censor_profile() from public, anon, authenticated;
drop trigger if exists bbx_nick_censor on public.profiles;
create trigger bbx_nick_censor before insert or update of nick on public.profiles
  for each row execute function public.bbx_nick_censor_profile();

-- ── nick v registraci (host, hráč bez telefonu, bot) ──
create or replace function public.bbx_nick_censor_reg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.nick is not distinct from old.nick then return new; end if;
  if public.bbx_has_banned(new.nick) then raise exception 'Nick obsahuje nevhodné slovo. Zvol jiný.'; end if;
  return new;
end $$;
revoke execute on function public.bbx_nick_censor_reg() from public, anon, authenticated;
drop trigger if exists bbx_nick_censor on public.registrations;
create trigger bbx_nick_censor before insert or update of nick on public.registrations
  for each row execute function public.bbx_nick_censor_reg();

-- ── chat: hvězdičky (běží po chat_fill, který text ořízne) ──
create or replace function public.bbx_chat_censor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body := public.bbx_censor(new.body);
  return new;
end $$;
revoke execute on function public.bbx_chat_censor() from public, anon, authenticated;
drop trigger if exists chat_zz_censor on public.chat_messages;
create trigger chat_zz_censor before insert or update of body on public.chat_messages
  for each row execute function public.bbx_chat_censor();

-- ── správa seznamu (jen hlavní admin) ──
create or replace function public.banned_word_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 4 then raise exception 'Jen pro hlavního admina.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('word', word, 'exact', exact, 'created_at', created_at) order by word)
                     from public.banned_words), '[]');
end $$;
revoke execute on function public.banned_word_list() from public, anon;
grant execute on function public.banned_word_list() to authenticated;

create or replace function public.banned_word_set(p_word text, p_on boolean default true, p_exact boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare w text := lower(btrim(coalesce(p_word, '')));
begin
  if public.bbx_my_level() < 4 then raise exception 'Jen pro hlavního admina.'; end if;
  if char_length(w) not between 2 and 40 then raise exception 'Slovo musí mít 2–40 znaků.'; end if;
  if w ~ '\s' then raise exception 'Zadej jedno slovo bez mezer.'; end if;
  if p_on then
    insert into public.banned_words (word, exact, created_by) values (w, coalesce(p_exact, false), auth.uid())
      on conflict (word) do update set exact = excluded.exact;
  else
    delete from public.banned_words where word = w;
  end if;
end $$;
revoke execute on function public.banned_word_set(text, boolean, boolean) from public, anon;
grant execute on function public.banned_word_set(text, boolean, boolean) to authenticated;

-- vyzkoušení: jak dopadne nick a zpráva v chatu
create or replace function public.banned_word_test(p_text text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 4 then raise exception 'Jen pro hlavního admina.'; end if;
  return jsonb_build_object('nick_ok', not public.bbx_has_banned(p_text), 'chat', public.bbx_censor(p_text));
end $$;
revoke execute on function public.banned_word_test(text) from public, anon;
grant execute on function public.banned_word_test(text) to authenticated;

-- kontrola nicku před založením účtu (registrační formulář, i bez přihlášení)
create or replace function public.nick_allowed(p_nick text) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.bbx_has_banned(left(coalesce(p_nick, ''), 40))
$$;
revoke execute on function public.nick_allowed(text) from public;
grant execute on function public.nick_allowed(text) to anon, authenticated;

-- ── výchozí seznam (hlavní admin ho pak upravuje) ──
insert into public.banned_words (word, exact) values
  ('kurv', false), ('kokot', false), ('curak', false), ('zmrd', false), ('mrdat', false), ('mrdka', false),
  ('mrdko', false), ('mrdej', false), ('sukat', false), ('jebat', false), ('jebem', false), ('jebni', false),
  ('vyjeb', false), ('kunda', false), ('picus', true), ('buzerant', false), ('teplous', false), ('cigos', false),
  ('hovno', false), ('prdel', false), ('srac', false),
  ('pica', true), ('pico', true), ('pice', true), ('pici', true), ('picu', true), ('negr', true), ('fag', true),
  ('fuck', false), ('shit', false), ('bitch', false), ('cunt', false), ('nigger', false), ('nigga', false),
  ('whore', false), ('slut', false), ('faggot', false), ('retard', false), ('hitler', false)
on conflict (word) do nothing;
