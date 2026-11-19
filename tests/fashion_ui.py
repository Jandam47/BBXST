# Fashion show v Chrome: založení, přihláška, design judge, start, hodnocení, rozstřel,
# boss of fashion, vyhlášení na TV, achievement v profilu. Spouštět po čerstvém tests/ui-up.sh.
import re, subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
import os; os.makedirs(OUT, exist_ok=True)
errors = []
def sql(q):
    return subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAc', q]).decode().strip()

def ctx(b, email=None, w=390, h=844):
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block')
    page = c.new_page()
    page.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    if email:
        page.goto(BASE + '#/login'); page.fill('input[name=email]', email); page.fill('input[name=password]', 'x')
        page.click('#f-login button'); page.wait_for_selector('.t-card')
    else:
        page.goto(BASE); page.wait_for_selector('.t-card')
    return c, page

def shot(page, name, full=True):
    page.wait_for_timeout(600)
    page.screenshot(path=OUT + name + '.png', full_page=full)

def go(page, hash):
    # bez realtime (testovací backend) – vždy čerstvé načtení
    page.goto(BASE + hash); page.reload()

def pick(page, bey, key, text):
    sel = f'[data-bey="{bey}"] [data-combo="{key}"]'
    page.click(sel + ' input'); page.fill(sel + ' input', text)
    page.wait_for_selector(sel + ' .combo-list:not([hidden]) li')
    page.keyboard.press('Enter')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── organizátor založí Fashion ──
    c, org = ctx(b, 'org@test.cz')
    org.click('text=+ Akce'); org.wait_for_selector('#f-t')
    org.fill('input[name=name]', 'Fashion Night Pardubice')
    org.fill('input[name=starts_at]', '2026-12-05T17:00')
    org.fill('input[name=location]', 'Klub Deskovka, Pardubice')
    org.fill('textarea[name=description]', 'Přines svoje nejhezčí beyblady a cosplay. Hodnotí design judge.')
    assert org.locator('#f-fbeys').is_hidden()
    org.click('.seg-opt:has-text("Fashion")')
    assert org.locator('#f-fbeys').is_visible()
    org.fill('input[name=fashion_beys]', '2')
    shot(org, '90_fashion_new')
    org.click('#f-t button.primary'); org.wait_for_selector('.t-head')
    t_id = org.evaluate("location.hash.split('/')[2]")
    assert sql(f"select event_type || fashion_beys from tournaments where id = '{t_id}'") == 'fashion2'

    # ── hráč se přihlásí se 2 beyi ──
    c2, pl = ctx(b, 'hrac1@test.cz')
    go(pl, f'#/t/{t_id}'); pl.wait_for_selector('#f-reg [data-deck]')
    assert pl.locator('[data-bey]').count() == 2
    pick(pl, 0, 'blade', 'dran sw'); pick(pl, 0, 'ratchet', '360'); pick(pl, 0, 'bit', 'flat')
    pick(pl, 1, 'blade', 'dran sw'); pick(pl, 1, 'ratchet', '360'); pick(pl, 1, 'bit', 'flat')
    shot(pl, '91_fashion_register')
    pl.click('#f-reg button.primary'); pl.wait_for_selector('.fx-pass')
    shot(pl, '92_fashion_pass_wait')

    # další soutěžící přímo v DB (Hrac2–4)
    for n in (2, 3, 4):
        sql(f"""insert into registrations (tournament_id, user_id, nick, deck)
                select '{t_id}', id, nick, '[{{"type":"bx","blade":"Shark Edge","ratchet":"3-60","bit":"Low Flat"}},{{"type":"bx","blade":"Leon Claw","ratchet":"5-60","bit":"Point"}}]'
                  from profiles where nick = 'Hrac{n}'""")

    # ── host bez účtu nemůže být design judge ──
    c3, host = ctx(b)
    go(host, f'#/t/{t_id}'); host.wait_for_selector('[data-act=judge-join]')
    host.click('[data-act=judge-join]'); host.wait_for_selector('text=Design judge potřebuje účet')
    shot(host, '93_fashion_judge_needs_account', full=False)
    c3.close()

    # ── tři design judge (Judge, Judge2, Hrac5) ──
    judges = []
    for email in ('judge@test.cz', 'judge2@test.cz', 'hrac5@test.cz'):
        cj, pj = ctx(b, email)
        go(pj, f'#/t/{t_id}'); pj.wait_for_selector('[data-act=judge-join]')
        pj.click('[data-act=judge-join]'); pj.wait_for_selector('.fx-judge-badge')
        judges.append((cj, pj, email))
    shot(judges[0][1], '94_fashion_judge_card')
    # soutěžící nemůže být judge
    go(pl, f'#/t/{t_id}/players'); pl.wait_for_selector('.fx-chips')
    shot(pl, '95_fashion_players')

    # ── start ──
    go(org, f'#/t/{t_id}/manage'); org.wait_for_selector('[data-act=start]')
    shot(org, '96_fashion_manage_before')
    org.click('[data-act=start]'); org.click('[data-yes]')
    org.wait_for_selector('.fx-ctl')
    order = sql(f"select string_agg(nick, ',' order by seed) from registrations where tournament_id = '{t_id}'").split(',')
    print('pořadí', order)

    # TV během show
    ct, tv = ctx(b, None, 1600, 900)
    go(tv, f'#/t/{t_id}/tv'); tv.wait_for_selector('.fx-tv-nick')
    assert tv.inner_text('.fx-tv-nick') == order[0]
    shot(tv, '97_fashion_tv_stage', full=False)

    # ── hodnocení: první dva stejně (rozstřel), další méně ──
    plan = {0: (10, 5, 5, 3, 1), 1: (10, 5, 5, 3, 1), 2: (7, 3, 3, 2, 0), 3: (4, 2, 1, 0, 0)}
    for i, name in enumerate(order):
        for k, (cj, pj, email) in enumerate(judges):
            go(pj, f'#/t/{t_id}/show'); pj.wait_for_selector('.fx-stage-nick')
            assert pj.inner_text('.fx-stage-nick') == name, (pj.inner_text('.fx-stage-nick'), name)
            pj.click('[data-rate]'); pj.wait_for_selector('#f-rate')
            d_, h_, c_, u_, x_ = plan[i]
            for key, v in (('design', d_), ('harmony', h_), ('cosplay', c_), ('uniq', u_)):
                pj.click(f'.fx-pick [data-k="{key}"][data-v="{v}"]')
            if x_: pj.check('#f-rate [name=extra]')
            assert pj.inner_text('[data-total]') == str(d_ + h_ + c_ + u_ + x_)
            if i == 0 and k == 0: shot(pj, '98_fashion_rate_modal', full=False)
            pj.click('#f-rate button.primary'); pj.wait_for_selector('#f-rate', state='detached')
            if i == 0 and k == 0:
                pj.wait_for_timeout(800); shot(pj, '99_fashion_show_judge')
        if i == 0:
            # soutěžící na molu / čekající
            go(pl, f'#/t/{t_id}/me'); pl.wait_for_selector('.fx-pass'); shot(pl, '100_fashion_pass_show')
        cur = sql(f"select r.nick from tournaments t join registrations r on r.id = (t.fashion->>'current')::uuid where t.id = '{t_id}'")
        if i < 3: assert cur == order[i + 1], (cur, order[i + 1])

    # body jsou tajné
    go(pl, f'#/t/{t_id}/show'); pl.wait_for_selector('.fx-order')
    assert 'bodů' not in pl.inner_text('.fx-order')
    go(org, f'#/t/{t_id}/manage'); org.wait_for_selector('[data-act=finish]')
    shot(org, '101_fashion_manage_last')
    org.click('[data-act=finish]'); org.click('[data-yes]')

    # ── rozstřel: Judge → první, Judge2 → druhý, Hrac5 nehlasuje → organizátor uzavře → boss ──
    tie = sql(f"select string_agg(r.nick, ',' order by r.seed) from tournaments t, jsonb_array_elements_text(t.fashion->'tie') x join registrations r on r.id = x::uuid where t.id = '{t_id}'").split(',')
    assert tie == order[:2], tie
    go(tv, f'#/t/{t_id}/tv'); tv.wait_for_selector('.fx-tv-duel'); shot(tv, '102_fashion_tv_tiebreak', full=False)
    for k, name in ((0, tie[0]), (1, tie[1])):
        pj = judges[k][1]
        go(pj, f'#/t/{t_id}/show'); pj.wait_for_selector('[data-vote]')
        if k == 0: shot(pj, '103_fashion_vote', full=False)
        pj.click(f'[data-vote]:has-text("{name}")'); pj.wait_for_timeout(700)
    go(org, f'#/t/{t_id}/manage'); org.wait_for_selector('[data-act=close-vote]')
    org.click('[data-act=close-vote]'); org.click('[data-yes]'); org.wait_for_timeout(1000)
    boss_nick = sql(f"select p.nick from tournaments t join profiles p on p.id = (t.fashion->>'boss')::uuid where t.id = '{t_id}'")
    print('boss', boss_nick)
    go(tv, f'#/t/{t_id}/tv'); tv.wait_for_selector('.fx-tv-stage.boss'); shot(tv, '104_fashion_tv_boss', full=False)
    bj = next(pj for (cj, pj, email) in judges if email.startswith(boss_nick.lower()))
    go(bj, f'#/t/{t_id}/show'); bj.wait_for_selector('[data-boss]')
    shot(bj, '105_fashion_boss', full=False)
    bj.click(f'[data-boss]:has-text("{tie[1]}")'); bj.click('[data-yes]')

    # ── vyhlášení na TV ──
    go(tv, f'#/t/{t_id}/tv'); tv.wait_for_selector('.fx-podium'); tv.wait_for_timeout(1500)
    assert tv.locator('.fx-rest li').count() == 1         # 4. místo hned
    assert tv.locator('.fx-pod.on').count() == 0
    shot(tv, '106_fashion_tv_reveal_start', full=False)
    tv.wait_for_selector('.fx-pod.p3.on', timeout=9000); tv.wait_for_timeout(1200)
    shot(tv, '107_fashion_tv_reveal_3', full=False)
    tv.wait_for_selector('.fx-pod.p1.on', timeout=16000); tv.wait_for_timeout(1500)
    assert tie[1] in tv.inner_text('.fx-pod.p1')
    assert tie[0] in tv.inner_text('.fx-pod.p2')
    shot(tv, '108_fashion_tv_reveal_all', full=False)

    # ── výsledky v aplikaci a achievement ──
    go(pl, f'#/t/{t_id}/results'); pl.wait_for_selector('.fx-pts'); shot(pl, '109_fashion_results')
    win_user = sql(f"select user_id from registrations where tournament_id = '{t_id}' and final_place = 1")
    pl.goto(BASE + f'#/p/{win_user}'); pl.wait_for_selector('.ach.p1'); shot(pl, '110_fashion_achievement')
    pl.goto(BASE); pl.wait_for_selector('.t-card'); pl.click('[data-f=past]'); pl.wait_for_selector('.t-card.is-fashion'); shot(pl, '111_fashion_home_card', full=False)

    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    print('FASHION OK')
