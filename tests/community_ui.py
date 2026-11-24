# Komunity a komunitní trénink v Chrome (BBXU část): založení, schválení hlavním adminem,
# členové, zástupce, trénink, deck, pozvánka, výzva, historie, comba, meta komunity, profil.
# Spouštět po čerstvém tests/ui-up.sh.
import re, subprocess, os
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
os.makedirs(OUT, exist_ok=True)
errors = []
def sql(q):
    return subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAc', q]).decode().strip()

def ctx(b, email=None, w=390, h=844):
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block')
    page = c.new_page()
    page.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    page.on('dialog', lambda d: d.dismiss())
    if email:
        page.goto(BASE + '#/login'); page.fill('input[name=email]', email); page.fill('input[name=password]', 'x')
        page.click('#f-login button'); page.wait_for_selector('.t-card')
    return c, page

def go(page, hash):
    page.goto(BASE + hash); page.reload(); page.wait_for_timeout(700)

def shot(page, name, full=True):
    page.wait_for_timeout(500); page.screenshot(path=OUT + name + '.png', full_page=full)

def pick(page, bey, key, text):
    sel = f'[data-bey="{bey}"] [data-combo="{key}"]'
    if key == 'ratchet':   # ratchet se vybírá na kolečku: zuby, pak výška
        t, h = (text.split('-') if '-' in text else (text[0], text[1:]))
        page.click(sel + ' input'); page.wait_for_selector('.rw-dial')
        page.click(f'.rw-k[data-t="{t}"]'); page.click(f'.rw-k[data-h="{h}"]'); page.wait_for_selector('.rw-dial', state='detached')
        return
    if key == 'bit':       # bit se vybírá na kolečku s hledáním
        page.click(sel + ' input'); page.wait_for_selector('.bw-dial')
        page.fill('.bw-q', text); page.keyboard.press('Enter'); page.wait_for_selector('.bw-dial', state='detached')
        return
    page.click(sel + ' input'); page.fill(sel + ' input', text)
    page.wait_for_selector(sel + ' .combo-list:not([hidden]) li')
    page.keyboard.press('Enter')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── organizátor založí komunitu ──
    c1, org = ctx(b, 'org@test.cz')
    org.click('.tabbar a[data-tab=players]'); org.wait_for_selector('.cw-overlay .cw-sec')
    org.click('.cw-sec[data-i="1"]'); org.wait_for_selector('[data-act=new]')     # kolečko Hráči → Komunity
    org.click('[data-act=new]'); org.wait_for_selector('#f-comm')
    org.fill('#f-comm [name=name]', 'BBX Pardubice')
    org.select_option('#f-comm [name=region]', 'Pardubický')
    org.fill('#f-comm [name=description]', 'Trénujeme každou středu v klubu Deskovka. Přidej se!')
    shot(org, '130_comm_new', full=False)
    org.click('#f-comm button.primary'); org.wait_for_selector('text=Čeká na schválení')
    cid = sql("select id from communities where name = 'BBX Pardubice'")
    shot(org, '131_comm_pending')

    # ── hlavní admin schválí v profilu ──
    c2, adam = ctx(b, 'adam@test.cz')
    go(adam, '#/me'); adam.wait_for_selector('.admin-req')
    shot(adam, '132_admin_requests')
    adam.click(f'[data-ok="{cid}"]'); adam.wait_for_selector('text=Nic nečeká')
    assert sql(f"select status from communities where id = '{cid}'") == 'approved'

    # ── hráči žádají o členství ──
    players = {}
    for n in (1, 2, 3):
        cx, pg = ctx(b, f'hrac{n}@test.cz')
        go(pg, f'#/c/{cid}'); pg.wait_for_selector('[data-act=join]')
        pg.click('[data-act=join]'); pg.wait_for_selector('text=Žádost odeslána')
        players[n] = pg
    go(org, f'#/c/{cid}'); org.wait_for_selector('[data-acc]')
    shot(org, '133_comm_requests')
    for _ in range(3):
        org.locator('[data-acc]').first.click(); org.wait_for_timeout(700)
    assert sql(f"select count(*) from community_members where community_id = '{cid}' and status = 'active'") == '4'
    h1 = sql("select id from profiles where nick = 'Hrac1'")
    org.click(f'[data-sub="{h1}"]'); org.wait_for_timeout(700)
    assert sql(f"select role from community_members where community_id = '{cid}' and user_id = '{h1}'") == 'sub'
    shot(org, '134_comm_detail')

    # ── zástupce založí trénink z hlavní stránky (+ Trénink) ──
    p1 = players[1]
    go(p1, '#/'); p1.wait_for_selector('[data-act=create]')
    p1.click('[data-act=create]'); p1.wait_for_selector('#f-tr')   # jediná možnost = rovnou formulář
    assert p1.locator('.cw-overlay').count() == 0
    p1.fill('#f-tr [name=name]', 'Středeční trénink')
    p1.fill('#f-tr [name=location]', 'Deskovka')
    p1.click('#f-tr button.primary'); p1.wait_for_selector('[data-act=join]')
    tid = p1.evaluate("location.hash.split('/')[2]")
    p1.click('[data-act=join]'); p1.wait_for_selector('#deck-box')
    p1.click('[data-act=deck]'); p1.wait_for_selector('#f-deck')
    pick(p1, 0, 'blade', 'dran sw'); pick(p1, 0, 'ratchet', '360'); pick(p1, 0, 'bit', 'flat')
    pick(p1, 1, 'blade', 'dran sw'); pick(p1, 1, 'ratchet', '360'); pick(p1, 1, 'bit', 'flat')   # stejný bey 2× je OK
    pick(p1, 2, 'blade', 'hells sc'); pick(p1, 2, 'ratchet', '460'); pick(p1, 2, 'bit', 'taper')
    p1.click('#f-deck button.primary'); p1.wait_for_selector('#deck-box .pass-beys')

    # člen se přidá (bez decku), zástupce pozve hráče mimo komunitu
    p2 = players[2]
    go(p2, f'#/t/{tid}'); p2.wait_for_selector('[data-act=join]'); p2.click('[data-act=join]'); p2.wait_for_selector('#deck-box')
    sql(f"""update registrations set deck = '[{{"type":"bx","blade":"Shark Edge","ratchet":"3-60","bit":"Low Flat"}}]'
            where tournament_id = '{tid}' and nick = 'Hrac2'""")
    go(p1, f'#/t/{tid}/manage'); p1.wait_for_selector('#inv-q')
    p1.fill('#inv-q', 'hrac5'); p1.wait_for_selector('[data-inv]')
    shot(p1, '135_training_invite', full=False)
    p1.click('[data-inv]'); p1.wait_for_timeout(700)
    c5, p5 = ctx(b, 'hrac5@test.cz')
    go(p5, '#/'); p5.wait_for_selector('.banner-call.invite')
    shot(p5, '136_invite_banner', full=False)
    p5.click('.banner-call.invite'); p5.wait_for_selector('[data-act=join]'); p5.click('[data-act=join]'); p5.wait_for_selector('#deck-box')

    # ── výzva ──
    go(p2, f'#/t/{tid}/me'); p2.wait_for_selector('[data-challenge]')
    r1 = sql(f"select id from registrations where tournament_id = '{tid}' and nick = 'Hrac1'")
    p2.click(f'[data-challenge="{r1}"]'); p2.wait_for_selector('.tr-wait')
    go(p1, f'#/t/{tid}/me'); p1.wait_for_selector('.tr-call')
    shot(p1, '137_training_call')
    p1.click('.tr-call [data-accept]'); p1.wait_for_url(re.compile(r'bbxst\.html\?training='))
    mid = sql(f"select id from training_matches where tournament_id = '{tid}'")
    assert sql(f"select status from training_matches where id = '{mid}'") == 'active'

    # souboje přímo přes RPC (BBXST má vlastní test)
    u1 = sql("select id from profiles where nick = 'Hrac1'")
    for slot, pts, fin, i1, i2 in [(1, 3, 'xtreme', 0, 0), (2, 2, 'burst', 0, 1), (1, 1, 'spin', 0, 2), (2, 2, 'over', 0, 2), (0, 0, '', 0, 0), (2, 3, 'xtreme', 0, 2)]:
        sql(f"""select set_config('request.jwt.claims', '{{"sub":"{u1}","role":"authenticated"}}', true);
                select training_battle('{mid}', gen_random_uuid(), {slot}, {pts}, nullif('{fin}', ''), {i1}, {i2})""")
    go(p1, f'#/t/{tid}/me'); p1.wait_for_selector('.tr-active')
    shot(p1, '138_training_me')
    go(p1, f'#/t/{tid}/history'); p1.wait_for_selector('.tr-hist')
    p1.click('.tr-hist summary'); shot(p1, '139_training_history')
    go(p1, f'#/t/{tid}/combos'); p1.wait_for_selector('.meta-row')
    shot(p1, '140_training_combos')
    p1.click('[data-s=all]'); p1.wait_for_timeout(800); p1.wait_for_selector('.meta-row')
    assert p1.locator('.meta-row').count() >= 3

    # ── meta komunity a profil ──
    go(p1, f'#/meta?c={cid}'); p1.wait_for_selector('#msrc [data-src=community].on')
    p1.select_option('#mm', '3'); p1.wait_for_timeout(800)
    shot(p1, '141_meta_community')
    go(p1, f'#/p/{u1}'); p1.wait_for_selector('.comm-badge.sub')
    shot(p1, '142_profile_badge', full=False)
    go(p1, '#/'); p1.wait_for_selector('.t-card.is-community')

    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    print('COMMUNITY UI OK')
