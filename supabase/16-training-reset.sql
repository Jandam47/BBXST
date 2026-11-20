-- ════════════════════════════════════════════════════════════════════
--  16 – Komunitní trénink: RESET = nová hra
--
--  training_new_game(výzva): BBXST tahací RESET v training módu. Skóre i zahrané beye
--  (sada v tournament módu) začnou od nuly – další souboj patří do nové hry.
--  Odehrané souboje zůstanou v historii a statistikách. Prázdná hra se nezakládá znovu.
--
--  Spouští se jednou, je idempotentní.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.training_new_game(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.training_matches; g record;
begin
  m := public.bbx_tmatch(p_match);
  select * into g from public.bbx_tgame(m.id);
  if g.s1 + g.s2 > 0 or exists (select 1 from public.training_battles b where b.match_id = m.id and b.game_no = g.game_no) then
    update public.training_matches
       set settings = settings || jsonb_build_object('next_game', g.game_no + 1), updated_at = now()
     where id = m.id;
  end if;
  return public.training_state(p_match);
end $$;
