# BBXST training mód: dva telefony, výzva přes kolečko hráčů, potvrzení, zápis z obou stran,
# synchronizace, Over/Burst, setup (1v1, do 3 bodů, změna beye), revert, remíza, ukončení.
# Spouštět po čerstvém tests/ui-up.sh.
import re, json, subprocess, os
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
os.makedirs(OUT, exist_ok=True)
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

def drag(page, sel, dx, dy=0):
    box = page.locator(sel).bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y); page.mouse.down()
    for i in range(1, 9): page.mouse.move(x + dx * i / 8, y + dy * i / 8)
    page.mouse.up()

def score(page, side, pts, finish='burst', mine=0, theirs=0):
    drag(page, f'.dragBtn[data-points="{pts}"]', -220 if side == 1 else 220)
    page.wait_for_timeout(200)
    if page.locator('#pickFinish:not(.hidden)').count():
        page.click(f'.finishPick[data-f="{finish}"]'); page.wait_for_timeout(200)
    if page.locator('#pickOverlay:not(.hidden)').count():
        scorer, other = ('#pickLeft', '#pickRight') if side == 1 else ('#pickRight', '#pickLeft')
        if page.locator(f'{scorer} .beyPick.win').count() == 0:
            page.locator(f'{scorer} .beyPick:not([disabled])').nth(mine).click()
        if page.locator(f'{other} .beyPick.lose').count() == 0:
            page.locator(f'{other} .beyPick:not([disabled])').nth(theirs).click()
        page.wait_for_selector('#pickOverlay.hidden', state='attached')
    page.wait_for_timeout(700)

def board(page): return page.inner_text('#score1') + ':' + page.inner_text('#score2')

def phone(b, email):
    c = b.new_context(viewport={'width': 915, 'height': 412}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
    pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    return pg

# ── příprava: komunita, trénink, dva hráči s decky ──
u1 = sql("select id from profiles where nick = 'Hrac1'"); u2 = sql("select id from profiles where nick = 'Hrac2'")
cid = sql(f"""insert into communities (name, status, created_by) values ('Trénink BBXST', 'approved', '{u1}') returning id""")
sql(f"""insert into community_members (community_id, user_id, role, status) values ('{cid}', '{u1}', 'leader', 'active'), ('{cid}', '{u2}', 'member', 'active')""")
tid = sql(f"""insert into tournaments (kind, event_type, community_id, name, swiss_rounds, top_cut, created_by, rated)
              values ('event', 'community', '{cid}', 'Páteční trénink', 1, 0, '{u1}', false) returning id""")
D1 = json.dumps([{"type": "bx", "blade": "Dran Sword", "ratchet": "3-60", "bit": "Flat"},
                 {"type": "bx", "blade": "Hells Scythe", "ratchet": "4-60", "bit": "Taper"},
                 {"type": "bx", "blade": "Wizard Arrow", "ratchet": "4-80", "bit": "Ball"}])
D2 = json.dumps([{"type": "bx", "blade": "Shark Edge", "ratchet": "3-60", "bit": "Low Flat"},
                 {"type": "bx", "blade": "Leon Claw", "ratchet": "5-60", "bit": "Point"},
                 {"type": "bx", "blade": "Knight Shield", "ratchet": "3-80", "bit": "Needle"}])
for u, d in ((u1, D1), (u2, D2)):
    sql(f"""select set_config('request.jwt.claims', '{{"sub":"{u}","role":"authenticated"}}', true);
            insert into registrations (tournament_id, user_id, nick, deck) values ('{tid}', '{u}', (select nick from profiles where id = '{u}'), '{d}')""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    a = phone(b, 'hrac1@test.cz'); c = phone(b, 'hrac2@test.cz')

    # ── A: tahací TRAINING → kolečko → vyzvat Hrac2 ──
    a.goto(BASE + 'bbxst.html'); a.wait_for_selector('body.has-training')
    a.screenshot(path=OUT + '150_bbxst_train_btn.png')
    drag(a, '#trainBtn', 140, -40); a.wait_for_selector('#trCircle:not(.hidden) .trP')
    a.screenshot(path=OUT + '151_bbxst_circle.png')
    a.click('.trP:has-text("Hrac2")'); a.wait_for_selector('text=VÝZVA ODESLÁNA')
    mid = sql(f"select id from training_matches where tournament_id = '{tid}'")
    assert sql(f"select status from training_matches where id = '{mid}'") == 'pending'

    # ── C: kolečko ukazuje „vyzval tě“ → přijmout ──
    c.goto(BASE + 'bbxst.html'); c.wait_for_selector('body.has-training')
    drag(c, '#trainBtn', 140, -40); c.wait_for_selector('.trP.incoming')
    c.screenshot(path=OUT + '152_bbxst_circle_incoming.png')
    c.click('.trP.incoming'); c.wait_for_selector('#jYes'); c.click('#jYes')
    c.wait_for_selector('body.training.has-tmatch')
    a.wait_for_selector('body.training.has-tmatch', timeout=8000)      # A čekal a sám načetl
    assert a.inner_text('#player1Info .nick') == 'Hrac1' and a.inner_text('#player2Info .nick') == 'Hrac2'
    assert c.inner_text('#player1Info .nick') == 'Hrac2', 'každý má sebe vlevo'

    # ── zápis z obou telefonů ──
    score(a, 1, 3)                                 # Hrac1 xtreme
    assert board(a) == '3:0', board(a)
    a.screenshot(path=OUT + '153_bbxst_training_score.png')
    c.wait_for_function("document.getElementById('score2').innerText === '3'", timeout=8000)   # sync na druhý telefon
    score(c, 1, 2, finish='over')                  # Hrac2 over z druhého telefonu
    a.wait_for_function("document.getElementById('score2').innerText === '2'", timeout=8000)
    rows = sql(f"select string_agg(scorer_slot || ':' || pts || ':' || coalesce(finish,'-') || ':' || coalesce(p1_bey,'?') || '/' || coalesce(p2_bey,'?'), ' | ' order by seq) from training_battles where match_id = '{mid}'")
    print('battles:', rows)
    assert 'xtreme' in rows and ':2:over:' in rows and 'Dran Sword' in rows
    # remíza
    a.click('#trainBar .drawBtn'); a.wait_for_selector('#pickOverlay:not(.hidden)')
    a.locator('#pickLeft .beyPick').first.click(); a.locator('#pickRight .beyPick').first.click()
    a.wait_for_timeout(800)
    assert sql(f"select count(*) from training_battles where match_id = '{mid}' and scorer_slot = 0") == '1'
    # revert
    a.evaluate('revert()'); a.wait_for_timeout(800)
    assert sql(f"select count(*) from training_battles where match_id = '{mid}'") == '2'

    # ── setup: 1v1, do 3 bodů, Hrac2 dostane jiný bey ──
    drag(a, '#trainBtn', 140, -40); a.wait_for_selector('#trSetup:not(.hidden)')
    a.screenshot(path=OUT + '154_bbxst_setup.png')
    a.click('[data-mode="1v1"]')
    for _ in range(4): a.click('[data-win="-1"]')
    assert a.inner_text('.trWin') == '3'
    a.click('.trCol.right .trSlot'); a.wait_for_selector('.trList .beyPick')
    a.click('.trList .beyPick:has-text("Leon Claw")')
    a.click('#trSave'); a.wait_for_selector('#trSetup', state='hidden')
    st = json.loads(sql(f"select settings from training_matches where id = '{mid}'"))
    assert st['mode'] == '1v1' and st['win'] == 3 and st['lineup']['p2'][0]['name'] == 'Leon Claw 5-60P', st
    assert board(a) == '0:0', 'nový mód = nová hra ' + board(a)
    # 1v1: beye se doplní samy
    score(a, 1, 3)
    assert board(a) == '3:0'
    last = sql(f"select p1_bey || '/' || p2_bey || '/' || game_no from training_battles where match_id = '{mid}' order by seq desc limit 1")
    assert last == 'Dran Sword 3-60F/Leon Claw 5-60P/2', last
    a.screenshot(path=OUT + '155_bbxst_training_win.png')
    score(a, 2, 1)                                  # další bod = hra 3
    assert board(a) == '0:1', board(a)

    # ── tournament mode: 3v3, ∞, bey se v sadě neopakuje ──
    drag(a, '#trainBtn', 140, -40); a.wait_for_selector('#trSetup:not(.hidden)')
    a.click('[data-mode="3v3"]'); a.click('[data-inf]'); a.click('[data-tourney="1"]')
    a.click('.trCol.right .trSlot >> nth=0'); a.wait_for_selector('.trList .beyPick')
    a.click('.trList .beyPick:has-text("Shark Edge")')
    a.screenshot(path=OUT + '156_bbxst_setup_tourney.png')
    a.click('#trSave'); a.wait_for_selector('#trSetup', state='hidden')
    st = json.loads(sql(f"select settings from training_matches where id = '{mid}'"))
    assert st['tourney'] is True and st['mode'] == '3v3' and st['win'] is None, st
    for _ in range(3): score(a, 1, 1)
    g = sql(f"select max(game_no) from training_battles where match_id = '{mid}'")
    seq = sql(f"select string_agg(p1_bey, ',' order by seq) from training_battles where match_id = '{mid}' and game_no = {g}")
    assert seq == 'Dran Sword 3-60F,Hells Scythe 4-60T,Wizard Arrow 4-80B', seq
    score(a, 1, 1)                                  # nová sada – zase všechny tři
    assert sql(f"select p1_bey from training_battles where match_id = '{mid}' order by seq desc limit 1") == 'Dran Sword 3-60F'

    # ── tournament mode: po výhře se výběr beyů resetuje (nová hra) ──
    a.evaluate(f"async () => {{ await rpc('training_setup', {{ p_match: '{mid}', p_settings: {{ win: 2 }} }}); await trRefresh() }}")
    a.wait_for_timeout(600)
    score(a, 1, 1)
    assert a.evaluate('cycleUsed(1).length') == 1
    score(a, 1, 1)                                  # 2:0 → dohráno
    a.wait_for_timeout(600)
    assert a.evaluate('trCompute().over') is True
    assert a.evaluate('cycleUsed(1).length') == 0, 'po výhře se sada resetuje'
    score(a, 1, 1)                                  # nová hra – zase první bey
    assert sql(f"select p1_bey from training_battles where match_id = '{mid}' order by seq desc limit 1") == 'Dran Sword 3-60F'
    a.evaluate(f"async () => {{ await rpc('training_setup', {{ p_match: '{mid}', p_settings: {{ win: null }} }}); await trRefresh() }}")
    a.wait_for_timeout(600)

    # ── prohození stran (⇄) ──
    a.wait_for_selector('#swapBtn', state='visible')
    a.click('#swapBtn'); a.wait_for_timeout(400)
    assert a.inner_text('#player1Info .nick') == 'Hrac2', 'po ⇄ je soupeř vlevo'
    a.screenshot(path=OUT + '157_bbxst_training_swapped.png')
    score(a, 1, 1)                                  # bod levé straně = Hrac2 (slot 2)
    assert sql(f"select scorer_slot from training_battles where match_id = '{mid}' order by seq desc limit 1") == '2'
    assert c.inner_text('#player1Info .nick') == 'Hrac2', 'druhý telefon si strany nemění'

    # ── podržení beye v setupu = úprava dílů (předvyplněné) ──
    drag(a, '#trainBtn', 140, -40); a.wait_for_selector('#trSetup:not(.hidden)')
    slot = a.locator('.trSlot:has-text("Hells Scythe")')
    bb = slot.bounding_box(); a.mouse.move(bb['x'] + 30, bb['y'] + 20); a.mouse.down(); a.wait_for_timeout(800); a.mouse.up()
    a.wait_for_selector('#nbBlade')
    assert 'UPRAVIT BEY' in a.inner_text('#trSetup .trTitle')
    assert a.input_value('#nbBlade') == 'Hells Scythe' and a.input_value('#nbRatchet') == '4-60' and a.input_value('#nbBit') == 'Taper'
    # vlastní našeptávač: rozbalovací seznam ▾ a filtrování psaním (i zkratka / malá písmena)
    # ratchet na kolečku: vnitřní kruh zuby, vnější výška
    a.click('#nbRatchet'); a.wait_for_selector('#trWheel:not(.hidden) .twDial')
    assert a.inner_text('.twCenter b') == '4-60'
    assert a.locator('.twK.h[data-h="75"]').is_disabled(), '75 žádný ratchet nemá'
    a.click('.twK.t[data-t="3"]'); a.wait_for_timeout(200)
    assert a.locator('#trWheel:not(.hidden)').count() == 1, 'po jedné řadě se nezavře'
    assert a.inner_text('.twCenter b') == '3-60'
    a.click('.twK.h[data-h="60"]')                     # obě řady → zavře se
    a.wait_for_selector('#trWheel', state='hidden')
    assert a.input_value('#nbRatchet') == '3-60'
    a.click('#nbRatchet'); a.wait_for_selector('#trWheel:not(.hidden)')
    a.click('.twK.h[data-h="85"]'); a.wait_for_timeout(200)
    assert a.locator('#trWheel:not(.hidden)').count() == 1
    a.click('.twK.t[data-t="3"]')
    a.wait_for_selector('#trWheel', state='hidden'); assert a.input_value('#nbRatchet') == '3-85'
    a.click('#nbRatchet'); a.wait_for_selector('#trWheel:not(.hidden)')
    a.click('.twK.t[data-t="M"]'); a.wait_for_timeout(200)
    assert a.locator('#trWheel:not(.hidden)').count() == 1
    a.click('.twK.h[data-h="85"]')
    a.wait_for_selector('#trWheel', state='hidden'); assert a.input_value('#nbRatchet') == 'M-85'
    a.click('#nbRatchet'); a.wait_for_selector('#trWheel:not(.hidden)')
    a.click('.twK.t[data-t="8"]'); a.wait_for_timeout(150)  # 8-85 není → výška se zruší, nabídne 70 / 80
    assert a.locator('.twK.h:not([disabled])').all_inner_texts() == ['70', '80']
    a.screenshot(path=OUT + '163_bbxst_ratchet_wheel.png')
    a.click('.twSpecial[data-sp="Turbo"]'); a.wait_for_selector('#trWheel', state='hidden')
    assert a.input_value('#nbRatchet') == '' and a.input_value('#nbBit') == 'Turbo'
    a.click('#nbRatchet'); a.wait_for_selector('#trWheel:not(.hidden)')
    a.click('.twK.t[data-t="4"]'); a.click('.twK.h[data-h="60"]'); a.wait_for_selector('#trWheel', state='hidden')
    assert a.input_value('#nbRatchet') == '4-60' and a.input_value('#nbBit') == '', 'normální ratchet zruší Turbo'
    # bit na kolečku s výsečemi a hledáním uprostřed
    a.click('#nbBit'); a.wait_for_selector('#trWheel:not(.hidden) .tbDial')
    nbits = int(sql("select count(*) from bey_parts where category = 'bit' and active"))
    assert a.locator('.tbK').count() == nbits and a.locator('.tbK.off').count() == 0
    assert 'zkratk' in a.inner_text('.tbTip')
    a.fill('.tbQ', 'tr'); assert a.inner_text('#tbBest b') == 'Turbo'
    a.keyboard.press('Enter'); a.wait_for_selector('#trWheel', state='hidden')
    assert a.input_value('#nbBit') == 'Turbo' and a.input_value('#nbRatchet') == '', 'Turbo zruší ratchet'
    assert 'Turbo' in a.get_attribute('#nbRatchet', 'placeholder')
    a.click('#nbBit'); a.wait_for_selector('#trWheel:not(.hidden) .tbK.on[data-bit="Turbo"]')
    a.fill('.tbQ', 'bal'); a.wait_for_timeout(250)
    assert a.inner_text('#tbBest b') == 'Ball' and a.locator('.tbK.off').count() > 30
    a.screenshot(path=OUT + '159_bbxst_part_suggest.png')
    a.click('#tbBest'); a.wait_for_selector('#trWheel', state='hidden')
    assert a.input_value('#nbBit') == 'Ball'
    a.click('#nbBit'); a.wait_for_selector('#trWheel:not(.hidden)'); a.keyboard.press('Escape'); a.wait_for_selector('#trWheel', state='hidden')
    assert a.input_value('#nbBit') == 'Ball' and a.locator('#trSetup:not(.hidden)').count() == 1, 'Esc zavře jen kolečko'
    a.click('#nbRatchet'); a.wait_for_selector('#trWheel:not(.hidden)')
    a.click('.twK.t[data-t="4"]'); a.click('.twK.h[data-h="60"]'); a.wait_for_selector('#trWheel', state='hidden')
    assert a.input_value('#nbBit') == 'Ball'
    a.screenshot(path=OUT + '158_bbxst_edit_bey.png')
    a.click('#nbOk'); a.wait_for_selector('.trSlot:has-text("upraveno")')
    a.click('#trSave'); a.wait_for_selector('#trSetup', state='hidden')
    st = json.loads(sql(f"select settings from training_matches where id = '{mid}'"))
    assert any(x['name'] == 'Hells Scythe 4-60B' for x in st['lineup']['p1']), st['lineup']['p1']

    # ── RESET = nová hra (skóre i zahrané beye od nuly, souboje v historii zůstanou) ──
    g0 = int(sql(f"select max(game_no) from training_battles where match_id = '{mid}'"))
    n0 = int(sql(f"select count(*) from training_battles where match_id = '{mid}'"))
    score(a, 1, 1)
    drag(a, '#resetBtn', 140, -40); a.wait_for_selector('#jYes'); a.click('#jYes'); a.wait_for_timeout(900)
    assert board(a) == '0:0', board(a)
    assert a.evaluate('cycleUsed(1).length') == 0 and a.evaluate('judge.battles.length') == 0
    c.wait_for_timeout(4500); assert board(c) == '0:0', 'druhý telefon taky'
    score(a, 1, 1)
    assert int(sql(f"select max(game_no) from training_battles where match_id = '{mid}'")) == g0 + 1
    assert int(sql(f"select count(*) from training_battles where match_id = '{mid}'")) == n0 + 2, 'historie zůstane'

    # ── ukončení souboje ──
    drag(a, '#trainBtn', 140, -40); a.wait_for_selector('#trSetup:not(.hidden)')
    a.click('#trEnd'); a.click('#jYes'); a.wait_for_selector('#trCircle:not(.hidden)')
    assert sql(f"select status from training_matches where id = '{mid}'") == 'done'
    c.wait_for_function("!document.body.classList.contains('has-tmatch')", timeout=8000)

    # historie v BBXU
    a.goto(BASE + f'#/t/{tid}/history'); a.reload(); a.wait_for_selector('.tr-hist')
    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    print('BBXST TRAINING OK')
