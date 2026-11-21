-- ════════════════════════════════════════════════════════════════════
--  26 – BBXST judge: sken QR jen hráče, který teď v běžícím turnaji hraje
--  judge_scan_qr(token): hráč + turnaj + jeho nedohraný zápas (soupeř, aréna). Když turnaj neběží
--  nebo hráč nemá zápas, vrátí srozumitelnou chybu. BBXST pak u druhého skenu hlídá, že je to ten soupeř.
--  Spouštěj celé v Supabase SQL Editoru. Jde spustit opakovaně.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.judge_scan_qr(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.registrations; t public.tournaments; m public.matches; opp public.registrations;
begin
  select * into r from public.registrations where qr_token = p_token;
  if not found then raise exception 'Neznámý QR kód.'; end if;
  perform public.bbx_require_judge(r.tournament_id);
  select * into t from public.tournaments where id = r.tournament_id;
  if t.kind <> 'tournament' or t.status not in ('swiss', 'topcut') then
    raise exception 'Hráč % není v aktivním turnaji (% %).', r.nick, t.name,
      case t.status when 'registration' then 'ještě nezačal' when 'finished' then 'už skončil' when 'canceled' then 'je zrušený' else 'neběží' end;
  end if;
  if r.status <> 'active' then raise exception 'Hráč % z turnaje % odstoupil.', r.nick, t.name; end if;
  select * into m from public.matches
   where tournament_id = t.id and status <> 'done' and r.id in (p1_reg, p2_reg)
     and p1_reg is not null and p2_reg is not null and not is_bye
   order by (status = 'live') desc, wave, created_at limit 1;
  if not found then raise exception 'Hráč % teď v turnaji % nemá zápas (čeká na další kolo).', r.nick, t.name; end if;
  select * into opp from public.registrations where id = case when m.p1_reg = r.id then m.p2_reg else m.p1_reg end;
  return jsonb_build_object('reg', r.id, 'nick', r.nick, 'beys', jsonb_build_array(r.bey1, r.bey2, r.bey3),
                            'tournament_id', t.id, 'tournament_name', t.name, 'tournament_status', t.status,
                            'match', public.bbx_match_json(m), 'opp_reg', opp.id, 'opp_nick', opp.nick);
end $$;
grant execute on function public.judge_scan_qr(uuid) to authenticated;
