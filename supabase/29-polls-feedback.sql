-- ════════════════════════════════════════════════════════════════════
--  29 – Komunikace: ankety a dotazy / připomínky
--
--  • polls / poll_options / poll_votes: ankety s časovým limitem. Zakládá organizátor+ (poll_create),
--    volby: víc možností (multi), anonymní hlasování (anonymous = kdo jak hlasoval nevidí nikdo, ani admin).
--    Hlasuje každý s účtem (poll_vote, do konce se dá hlas změnit / vzít zpět). Výsledky vidí ten, kdo už
--    hlasoval, autor a admini; po skončení všichni. Ukončit / smazat smí autor a admin (poll_close, poll_delete).
--    Seznam poll_list (i bez přihlášení), poll_pending = počet otevřených anket, kde jsem ještě nehlasoval.
--    Nová anketa → push všem s odběrem.
--  • feedback: dotazy a připomínky pro hlavního admina – soukromé (vidí je jen autor a hlavní admin).
--    feedback_send (účet, limit 5 za 10 min), feedback_mine, feedback_inbox / feedback_reply / feedback_done
--    (hlavní admin), feedback_count. Nový dotaz → push hlavnímu adminovi, odpověď → push autorovi.
--  Tabulky jen přes RPC (RLS bez policy).
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

-- ── ankety ───────────────────────────────────────────────────────────
create table if not exists public.polls (
  id          uuid primary key default gen_random_uuid(),
  question    text not null check (char_length(btrim(question)) between 3 and 200),
  note        text check (note is null or char_length(note) <= 500),
  multi       boolean not null default false,
  anonymous   boolean not null default true,
  ends_at     timestamptz not null,
  closed_at   timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists polls_ends on public.polls (ends_at desc);

create table if not exists public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls(id) on delete cascade,
  ord      int not null,
  label    text not null check (char_length(btrim(label)) between 1 and 80)
);
create index if not exists poll_options_poll on public.poll_options (poll_id, ord);

create table if not exists public.poll_votes (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  option_id  uuid not null references public.poll_options(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id)
);
create index if not exists poll_votes_poll on public.poll_votes (poll_id, user_id);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
revoke all on public.polls, public.poll_options, public.poll_votes from anon, authenticated;

create or replace function public.bbx_poll_open(p public.polls) returns boolean
language sql stable as $$ select p.closed_at is null and p.ends_at > now() $$;
revoke execute on function public.bbx_poll_open(public.polls) from public, anon, authenticated;

create or replace function public.bbx_poll_can_manage(p public.polls) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not public.bbx_is_anon()
     and (p.created_by = auth.uid() or public.bbx_my_level() >= 3)
$$;
revoke execute on function public.bbx_poll_can_manage(public.polls) from public, anon, authenticated;

create or replace function public.poll_create(p_question text, p_options text[], p_multi boolean, p_anonymous boolean,
                                              p_minutes int, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; opts text[]; o text; i int := 0;
begin
  perform public.bbx_require_account();
  if public.bbx_my_level() < 2 then raise exception 'Ankety zakládají organizátoři a admini.'; end if;
  if char_length(btrim(coalesce(p_question, ''))) < 3 then raise exception 'Napiš otázku (aspoň 3 znaky).'; end if;
  if char_length(btrim(p_question)) > 200 then raise exception 'Otázka je moc dlouhá (max 200 znaků).'; end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 60 * 24 * 60 then raise exception 'Délka ankety musí být 5 minut až 60 dní.'; end if;
  select array_agg(x order by n) into opts
    from (select distinct on (lower(btrim(v))) btrim(v) as x, n
            from unnest(p_options) with ordinality as u(v, n)
           where btrim(coalesce(v, '')) <> '' order by lower(btrim(v)), n) d;
  if coalesce(array_length(opts, 1), 0) < 2 then raise exception 'Anketa potřebuje aspoň 2 různé možnosti.'; end if;
  if array_length(opts, 1) > 10 then raise exception 'Možností může být nejvýš 10.'; end if;
  foreach o in array opts loop
    if char_length(o) > 80 then raise exception 'Možnost je moc dlouhá (max 80 znaků).'; end if;
  end loop;
  insert into public.polls (question, note, multi, anonymous, ends_at, created_by)
  values (btrim(p_question), nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_multi, false), coalesce(p_anonymous, true),
          now() + make_interval(mins => p_minutes), auth.uid())
  returning id into pid;
  foreach o in array opts loop
    i := i + 1;
    insert into public.poll_options (poll_id, ord, label) values (pid, i, o);
  end loop;
  perform public.bbx_push(array(select distinct user_id from public.push_subscriptions),
    '📊 Nová anketa', btrim(p_question), '#/ankety/' || pid, 'poll-' || pid);
  return pid;
end $$;
revoke execute on function public.poll_create(text, text[], boolean, boolean, int, text) from public, anon;

-- seznam anket (p_poll = jen jedna); výsledky jen když je smím vidět, hlasující jen u neanonymních
create or replace function public.poll_list(p_poll uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb := '[]'::jsonb; p public.polls; me uuid := auth.uid(); mine uuid[]; vis boolean; opn boolean; mng boolean;
begin
  if public.bbx_is_anon() then me := null; end if;
  for p in select * from public.polls x
            where p_poll is null or x.id = p_poll
            order by (x.closed_at is null and x.ends_at > now()) desc,
                     case when x.closed_at is null and x.ends_at > now() then x.ends_at end asc,
                     coalesce(x.closed_at, x.ends_at) desc
            limit 60 loop
    opn := public.bbx_poll_open(p);
    mng := public.bbx_poll_can_manage(p);
    select coalesce(array_agg(option_id), '{}') into mine from public.poll_votes where poll_id = p.id and user_id = me;
    vis := not opn or cardinality(mine) > 0 or mng;
    res := res || jsonb_build_object(
      'id', p.id, 'question', p.question, 'note', p.note, 'multi', p.multi, 'anonymous', p.anonymous,
      'ends_at', p.ends_at, 'closed_at', p.closed_at, 'created_at', p.created_at, 'open', opn,
      'author', (select nick from public.profiles where id = p.created_by), 'author_id', p.created_by,
      'can_manage', mng, 'my', to_jsonb(mine), 'results', vis,
      'voters', (select count(distinct user_id) from public.poll_votes where poll_id = p.id),
      'options', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'label', o.label,
          'votes', case when vis then (select count(*) from public.poll_votes v where v.option_id = o.id) end,
          'who', case when vis and not p.anonymous then
                   (select coalesce(jsonb_agg(pr.nick order by pr.nick), '[]'::jsonb)
                      from public.poll_votes v join public.profiles pr on pr.id = v.user_id where v.option_id = o.id) end
        ) order by o.ord), '[]'::jsonb) from public.poll_options o where o.poll_id = p.id));
  end loop;
  return res;
end $$;
grant execute on function public.poll_list(uuid) to anon, authenticated;

-- hlas: prázdné pole = vzít hlas zpět
create or replace function public.poll_vote(p_poll uuid, p_options uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare p public.polls; n int;
begin
  perform public.bbx_require_account();
  select * into p from public.polls where id = p_poll for update;
  if p.id is null then raise exception 'Anketa neexistuje.'; end if;
  if not public.bbx_poll_open(p) then raise exception 'Anketa už skončila.'; end if;
  select count(distinct x) into n from unnest(coalesce(p_options, '{}')) x;
  if exists (select 1 from unnest(coalesce(p_options, '{}')) x
              where not exists (select 1 from public.poll_options o where o.id = x and o.poll_id = p_poll)) then
    raise exception 'Neplatná možnost.';
  end if;
  if not p.multi and n > 1 then raise exception 'V téhle anketě jde vybrat jen jedna možnost.'; end if;
  delete from public.poll_votes where poll_id = p_poll and user_id = auth.uid();
  insert into public.poll_votes (poll_id, option_id, user_id)
  select distinct p_poll, x, auth.uid() from unnest(coalesce(p_options, '{}')) x;
end $$;
revoke execute on function public.poll_vote(uuid, uuid[]) from public, anon;

create or replace function public.poll_close(p_poll uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.polls;
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null then raise exception 'Anketa neexistuje.'; end if;
  if not public.bbx_poll_can_manage(p) then raise exception 'Anketu může ukončit jen její autor nebo admin.'; end if;
  update public.polls set closed_at = now() where id = p_poll and closed_at is null and ends_at > now();
end $$;
revoke execute on function public.poll_close(uuid) from public, anon;

create or replace function public.poll_delete(p_poll uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.polls;
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null then return; end if;
  if not public.bbx_poll_can_manage(p) then raise exception 'Anketu může smazat jen její autor nebo admin.'; end if;
  delete from public.polls where id = p_poll;
end $$;
revoke execute on function public.poll_delete(uuid) from public, anon;

create or replace function public.poll_pending() returns int
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or public.bbx_is_anon() then 0 else
    (select count(*)::int from public.polls p
      where p.closed_at is null and p.ends_at > now()
        and not exists (select 1 from public.poll_votes v where v.poll_id = p.id and v.user_id = auth.uid())) end
$$;
grant execute on function public.poll_pending() to anon, authenticated;

-- ── dotazy a připomínky (soukromě pro hlavního admina) ───────────────
create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  nick        text,
  kind        text not null check (kind in ('question', 'note')),
  body        text not null check (char_length(btrim(body)) between 3 and 2000),
  created_at  timestamptz not null default now(),
  reply       text check (reply is null or char_length(reply) <= 2000),
  replied_at  timestamptz,
  replied_by  uuid references auth.users(id) on delete set null,
  done        boolean not null default false
);
create index if not exists feedback_user on public.feedback (user_id, id desc);
create index if not exists feedback_open on public.feedback (done, id desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

create or replace function public.feedback_send(p_kind text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare fid bigint; me text;
begin
  perform public.bbx_require_account();
  if p_kind not in ('question', 'note') then raise exception 'Neplatný druh zprávy.'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 3 then raise exception 'Napiš aspoň pár slov.'; end if;
  if char_length(btrim(p_body)) > 2000 then raise exception 'Zpráva je moc dlouhá (max 2000 znaků).'; end if;
  if (select count(*) from public.feedback where user_id = auth.uid() and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Moc zpráv najednou – zkus to za chvíli.';
  end if;
  select nick into me from public.profiles where id = auth.uid();
  insert into public.feedback (user_id, nick, kind, body) values (auth.uid(), me, p_kind, btrim(p_body)) returning id into fid;
  perform public.bbx_push(array(select id from public.profiles where role = 'superadmin'),
    case when p_kind = 'question' then '✉️ Dotaz od ' else '✉️ Připomínka od ' end || me, btrim(p_body), '#/dotazy', 'fb');
  return fid;
end $$;
revoke execute on function public.feedback_send(text, text) from public, anon;

create or replace function public.feedback_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'body', body, 'created_at', created_at,
           'reply', reply, 'replied_at', replied_at, 'done', done) order by id desc), '[]'::jsonb)
    from public.feedback where user_id = auth.uid() and auth.uid() is not null
$$;
revoke execute on function public.feedback_mine() from public, anon;
grant execute on function public.feedback_mine() to authenticated;

create or replace function public.feedback_inbox(p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 4 then raise exception 'Dotazy a připomínky čte jen hlavní admin.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'user_id', f.user_id, 'nick', coalesce(pr.nick, f.nick, 'Smazaný hráč'),
           'kind', f.kind, 'body', f.body, 'created_at', f.created_at, 'reply', f.reply, 'replied_at', f.replied_at, 'done', f.done)
           order by f.done, f.id desc), '[]'::jsonb)
    from (select * from public.feedback where p_all or not done order by id desc limit 200) f
    left join public.profiles pr on pr.id = f.user_id);
end $$;
revoke execute on function public.feedback_inbox(boolean) from public, anon;

create or replace function public.feedback_reply(p_id bigint, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare f public.feedback;
begin
  if public.bbx_my_level() < 4 then raise exception 'Odpovídá jen hlavní admin.'; end if;
  if char_length(btrim(coalesce(p_reply, ''))) < 1 then raise exception 'Napiš odpověď.'; end if;
  if char_length(btrim(p_reply)) > 2000 then raise exception 'Odpověď je moc dlouhá (max 2000 znaků).'; end if;
  update public.feedback set reply = btrim(p_reply), replied_at = now(), replied_by = auth.uid(), done = true
   where id = p_id returning * into f;
  if f.id is null then raise exception 'Zpráva neexistuje.'; end if;
  if f.user_id is not null then
    perform public.bbx_push(array[f.user_id], '✉️ Odpověď na ' || case when f.kind = 'question' then 'tvůj dotaz' else 'tvou připomínku' end,
      btrim(p_reply), '#/dotazy', 'fb-' || f.id);
  end if;
end $$;
revoke execute on function public.feedback_reply(bigint, text) from public, anon;

create or replace function public.feedback_done(p_id bigint, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.bbx_my_level() < 4 then raise exception 'Jen hlavní admin.'; end if;
  update public.feedback set done = coalesce(p_done, true) where id = p_id;
end $$;
revoke execute on function public.feedback_done(bigint, boolean) from public, anon;

-- odznak: hlavní admin = nevyřízené; ostatní = čas poslední odpovědi (klient porovná s „přečteno“)
create or replace function public.feedback_count() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', case when public.bbx_my_level() >= 4 then (select count(*) from public.feedback where not done) else 0 end,
    'last_reply', (select max(replied_at) from public.feedback where user_id = auth.uid() and auth.uid() is not null))
$$;
grant execute on function public.feedback_count() to anon, authenticated;
