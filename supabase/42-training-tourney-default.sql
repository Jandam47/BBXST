-- ════════════════════════════════════════════════════════════════════
--  42: Trénink – tournament mode je u nové výzvy zapnutý
--  training_challenge zakládá výzvu s settings.tourney = true (bey se v sadě neopakuje jako v judge
--  módu). Vypnout jde v BBXST SETUPu. Rozehrané výzvy zůstávají, jak jsou. Idempotentní.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.training_challenge(p_tournament uuid, p_opponent uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; me uuid; mid uuid; bot boolean;
begin
  t := public.bbx_training(p_tournament);
  if t.status <> 'registration' then raise exception 'Trénink už skončil.'; end if;
  me := public.bbx_training_reg(t.id);
  if me is null then raise exception 'Nejdřív se na trénink přidej.'; end if;
  if p_opponent = me then raise exception 'Sám sebe vyzvat nemůžeš.'; end if;
  if not exists (select 1 from public.registrations where id = p_opponent and tournament_id = t.id and status = 'active') then
    raise exception 'Hráč na tréninku není.';
  end if;
  select id into mid from public.training_matches
   where tournament_id = t.id and status in ('pending','active')
     and ((p1_reg = me and p2_reg = p_opponent) or (p1_reg = p_opponent and p2_reg = me)) limit 1;
  if mid is not null then return mid; end if;
  bot := coalesce((select is_bot from public.registrations where id = p_opponent), false);
  -- bot přijme výzvu hned; bez vlastního decku hraje zrcadlově s deckem vyzyvatele (sestavu změníš v SETUPu)
  insert into public.training_matches (tournament_id, p1_reg, p2_reg, status, settings)
  values (t.id, me, p_opponent, case when bot then 'active' else 'pending' end, jsonb_build_object('mode', '3v3', 'win', 7, 'tourney', true,
          'lineup', jsonb_build_object('p1', public.bbx_lineup(me),
                                       'p2', case when bot and jsonb_array_length(public.bbx_lineup(p_opponent)) = 0
                                                  then public.bbx_lineup(me) else public.bbx_lineup(p_opponent) end)))
  returning id into mid;
  return mid;
end $$;
