-- ════════════════════════════════════════════════════════════════════
--  BBXU – zpřísnění podle bezpečnostního přehledu Supabase (Advisors)
--  Spusť v Supabase → SQL Editor. Jde spustit i opakovaně.
-- ════════════════════════════════════════════════════════════════════

-- 1) Interní pomocné funkce nemají být volatelné přes API (/rest/v1/rpc/…).
--    bbx_match_json by jinak šlo zneužít ke čtení beybladů před koncem turnaje.
--    Volají je jen jiné funkce s právy vlastníka, takže aplikace dál funguje.
revoke execute on function public.bbx_match_json(public.matches)          from public, anon, authenticated;
revoke execute on function public.bbx_compose_bey(jsonb, int)             from public, anon, authenticated;
revoke execute on function public.bbx_normalize_deck(jsonb)               from public, anon, authenticated;
revoke execute on function public.bbx_part(text[], text, text)            from public, anon, authenticated;
revoke execute on function public.bbx_require_judge(uuid)                 from public, anon, authenticated;
revoke execute on function public.bbx_protect_registration()              from public, anon, authenticated;
revoke execute on function public.bbx_chat_fill()                         from public, anon, authenticated;
-- bbx_my_level, bbx_can_manage, bbx_is_anon a bbx_privileged zůstávají – používají je pravidla RLS
-- a triggery pod rolí přihlášeného uživatele (prozradí jen jeho vlastní oprávnění).

-- 2) Pevná search_path u funkcí, které ji neměly nastavenou.
alter function public.bbx_role_level(text)     set search_path = public;
alter function public.bbx_is_anon()            set search_path = public;
alter function public.bbx_privileged()         set search_path = public;
alter function public.bbx_set_privileged()     set search_path = public;
alter function public.bbx_protect_profile()    set search_path = public;
alter function public.bbx_protect_tournament() set search_path = public;
alter function public.bbx_protect_match()      set search_path = public;
alter function public.bbx_clear_live()         set search_path = public;
