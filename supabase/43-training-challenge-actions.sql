-- ════════════════════════════════════════════════════════════════════
--  43: Výzva na tréninku – Přijmout / Odmítnout přímo z notifikace
--  • push_outbox.data + bbx_push(…, p_data) = doplňky notifikace (tlačítka akcí); Edge Function `push`
--    je přidá do payloadu.
--  • Výzva (bbx_push_training): notifikace má tlačítka „Přijmout“ (otevře BBXST a výzvu přijme)
--    a „Odmítnout“ (odmítne na pozadí přes training_decline_token, bez otevření aplikace).
--    Klepnutí na notifikaci otevře stránku tréninku s oknem Přijmout / Odmítnout (#/t/<id>/me?vyzva=<výzva>).
--  • training_matches.action_token = jednorázový klíč výzvy jen pro notifikaci vyzvaného (klientům se nečte).
--  Idempotentní.
-- ════════════════════════════════════════════════════════════════════

alter table public.training_matches add column if not exists action_token uuid default gen_random_uuid();
alter table public.push_outbox add column if not exists data jsonb;

-- bbx_push s volitelnými doplňky (stará 5parametrová verze pryč, ať volání nejsou nejednoznačná)
drop function if exists public.bbx_push(uuid[], text, text, text, text);
create or replace function public.bbx_push(p_users uuid[], p_title text, p_body text, p_url text, p_tag text, p_data jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare uids uuid[]; oid bigint; u text; s text;
begin
  select array_agg(distinct ps.user_id) into uids from public.push_subscriptions ps
   where ps.user_id = any(p_users) and ps.user_id is distinct from auth.uid();
  if uids is null then return; end if;
  delete from public.push_outbox where created_at < now() - interval '3 days';
  insert into public.push_outbox (user_ids, title, body, url, tag, data)
  values (uids, left(p_title, 80), left(coalesce(p_body, ''), 180), p_url, p_tag, p_data) returning id into oid;
  select value into u from public.bbx_settings where key = 'push_url';
  select value into s from public.bbx_settings where key = 'push_secret';
  if u is null or s is null
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using u, jsonb_build_object('id', oid), jsonb_build_object('Content-Type', 'application/json', 'x-bbx-secret', s);
exception when others then
  raise warning 'bbx_push: %', sqlerrm;          -- notifikace nesmí shodit hlavní akci
end $$;
revoke execute on function public.bbx_push(uuid[], text, text, text, text, jsonb) from public, anon, authenticated;

-- výzva / přijetí na tréninku
create or replace function public.bbx_push_training() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.bbx_push(array[public.bbx_reg_user(new.p2_reg)], public.bbx_reg_nick(new.p1_reg) || ' tě vyzývá na souboj',
      'Komunitní trénink – přijmeš výzvu?', '#/t/' || new.tournament_id || '/me?vyzva=' || new.id, 'tr-' || new.id,
      jsonb_build_object(
        'actions', jsonb_build_array(jsonb_build_object('action', 'accept', 'title', '✓ Přijmout'),
                                     jsonb_build_object('action', 'decline', 'title', '✕ Odmítnout')),
        'accept_url', 'bbxst.html?training=' || new.id || '&accept=1',
        'decline', jsonb_build_object('match', new.id, 'token', new.action_token)));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    perform public.bbx_push(array[public.bbx_reg_user(new.p1_reg)], public.bbx_reg_nick(new.p2_reg) || ' přijal výzvu',
      'Otevři BBXST v training módu.', 'bbxst.html?training=' || new.id, 'tr-' || new.id);
  end if;
  return new;
end $$;
revoke execute on function public.bbx_push_training() from public, anon, authenticated;

-- odmítnutí z notifikace (service worker nemá přihlášení – ověří se jednorázovým klíčem výzvy)
create or replace function public.training_decline_token(p_match uuid, p_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_match is null or p_token is null then return false; end if;
  update public.training_matches set status = 'declined', action_token = null, updated_at = now()
   where id = p_match and action_token = p_token and status = 'pending';
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.training_decline_token(uuid, uuid) from public;
grant execute on function public.training_decline_token(uuid, uuid) to anon, authenticated;
