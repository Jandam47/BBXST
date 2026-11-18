# Test judge módu BBXST v Chrome (na šířku) proti lokálnímu backendu.
import re, json, subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
def sql(q):
    return subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAc', q]).decode().strip()

def drag(page, sel, dx):
    box = page.locator(sel).bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y); page.mouse.down()
    for i in range(1, 9): page.mouse.move(x + dx * i / 8, y)
    page.mouse.up()

def score_point(page, side, pts_sel):
    drag(page, pts_sel, -220 if side == 1 else 220)
    page.wait_for_timeout(150)
    if page.locator('#pickOverlay:not(.hidden)').count():
        scorer = '#pickLeft' if side == 1 else '#pickRight'
        other = '#pickRight' if side == 1 else '#pickLeft'
        if page.locator(f'{scorer} .beyPick.win').count() == 0:
            page.locator(f'{scorer} .beyPick:not([disabled])').first.click()
        if page.locator(f'{other} .beyPick.lose').count() == 0:
            page.locator(f'{other} .beyPick:not([disabled])').first.click()
        page.wait_for_selector('#pickOverlay.hidden', state='attached')
    page.wait_for_timeout(250)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 915, 'height': 412}, device_scale_factor=2, service_workers='block')
    page = c.new_page()
    page.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))

    # casual: bez přihlášení, judge mód odmítne
    page.goto(BASE + 'bbxst.html'); page.wait_for_selector('#modeBtn')
    drag(page, '#modeBtn', 150); page.wait_for_selector('#jOverlay:not(.hidden)')
    assert 'přihlas' in page.inner_text('#jBox').lower()
    page.screenshot(path=OUT + '30_bbxst_need_login.png'); page.click('#jBox .qr-btn')
    score_point(page, 1, '.dragBtn[data-points="2"]')
    assert page.inner_text('#score1') == '2', 'casual skóre'

    # přihlášení judge v BBXU (stejná doména → sdílená session)
    page.goto(BASE + '#/login'); page.fill('input[name=email]', 'judge@test.cz'); page.fill('input[name=password]', 'x')
    page.click('#f-login button'); page.wait_for_selector('.t-card')

    t_id = sql("select id from tournaments where name = 'Listopadový Cup'")
    m_id = sql(f"select id from matches where tournament_id = '{t_id}' and status = 'pending' and p1_reg is not null and p2_reg is not null order by arena, wave limit 1")
    # z BBXU: záložka Judge → klepnutí na arénu otevře BBXST rovnou se zápasem
    page.goto(BASE + f'#/t/{t_id}/judge'); page.wait_for_selector('[data-go]')
    page.screenshot(path=OUT + '31_bbxu_judge_arenas.png')
    page.locator('[data-go]').first.click()
    page.wait_for_selector('body.judge.has-match.can-swap')
    m_id = page.evaluate('judge.match.id')
    page.wait_for_timeout(1500)
    page.screenshot(path=OUT + '32_bbxst_judge.png')
    # prohození stran při 0:0
    left_before = page.evaluate('judge.sides[1].nick'); slot_before = page.evaluate('judge.leftSlot')
    page.click('#swapBtn'); page.wait_for_timeout(200)
    assert page.evaluate('judge.sides[2].nick') == left_before and page.evaluate('judge.leftSlot') == 3 - slot_before
    assert page.evaluate('player1Name') == page.evaluate('judge.sides[1].nick')
    page.click('#swapBtn'); page.wait_for_timeout(1500)

    # bod +2 vlevo → výběr beyů
    drag(page, '.dragBtn[data-points="2"]', -220); page.wait_for_selector('#pickOverlay:not(.hidden)')
    page.locator('#pickLeft .beyPick').first.click(); page.wait_for_timeout(100)
    page.screenshot(path=OUT + '33_bbxst_pick.png')
    page.locator('#pickRight .beyPick:not([disabled])').first.click(); page.wait_for_timeout(500)
    assert page.inner_text('#score1') == '2'
    assert not page.is_visible('#swapBtn'), 'po prvním bodu nejde prohodit'
    # remíza a revert
    page.click('#drawBtn'); page.wait_for_selector('#pickOverlay:not(.hidden)')
    page.locator('#pickLeft .beyPick:not([disabled])').first.click(); page.locator('#pickRight .beyPick:not([disabled])').first.click()
    page.wait_for_timeout(400)
    n = page.evaluate('judge.battles.length'); assert n == 2, n
    # třetí souboj: beye se doplní samy (poslední v kole) a vyskočí „otoč arénu“
    score_point(page, 2, '.dragBtn[data-points="1"]')
    page.wait_for_function("document.getElementById('overlayText').innerText.includes('OTOČ ARÉNU')", timeout=4000)
    page.screenshot(path=OUT + '33b_bbxst_rotate.png')
    assert page.evaluate('judge.battles.length') == 3
    assert page.evaluate("judge.battles[2].beys[1]") not in [page.evaluate("judge.battles[0].beys[1]"), page.evaluate("judge.battles[1].beys[1]")]
    page.evaluate('revert()'); assert page.evaluate('judge.battles.length') == 2 and page.inner_text('#score2') == '0'
    # dohraj 7:3 pro levého
    score_point(page, 2, '.dragBtn[data-points="3"]')
    print('after +3 right:', page.inner_text('#score1'), page.inner_text('#score2'), page.evaluate('judge.battles.length'), page.evaluate('matchOver'))
    while int(page.inner_text('#score1')) < 7:
        score_point(page, 1, '.dragBtn[data-points="2"]')
    page.wait_for_selector('#sendResultBtn', state='visible'); page.wait_for_timeout(1200)
    page.screenshot(path=OUT + '34_bbxst_win.png')
    page.click('#sendResultBtn'); page.wait_for_selector('#jOverlay:not(.hidden) h3', timeout=6000)
    assert 'ARÉN' in page.inner_text('#jBox h3'), page.inner_text('#jBox')
    page.screenshot(path=OUT + '35_bbxst_after.png')
    row = sql(f"select status, p1_score, p2_score, (select count(*) from points pt join games g on g.id = pt.game_id where g.match_id = m.id) from matches m where id = '{m_id}'")
    print('match row:', row)
    st, s1, s2, npts = row.split('|')
    assert st == 'done' and sorted([int(s1), int(s2)]) == [3, 7] and int(npts) >= 5
    beys_ok = sql(f"select bool_and(p1_bey is not null and p2_bey is not null) from points pt join games g on g.id = pt.game_id where g.match_id = '{m_id}'")
    assert beys_ok == 't'

    # QR cesta: naskenuj dva hráče dalšího zápasu (obráceně) a ověř mapování stran
    page.evaluate('jHide(); unloadJudge()')
    m2 = sql(f"select id, p1_reg, p2_reg from matches where tournament_id = '{t_id}' and status = 'pending' and p1_reg is not null and p2_reg is not null order by arena, wave limit 1").split('|')
    tok1 = sql(f"select qr_token from registrations where id = '{m2[1]}'"); tok2 = sql(f"select qr_token from registrations where id = '{m2[2]}'")
    page.evaluate(f"judgeScan(1, 'BBXU1|{t_id}|{tok2}')"); page.wait_for_timeout(600)
    page.evaluate(f"judgeScan(2, 'BBXU1|{t_id}|{tok1}')"); page.wait_for_selector('body.has-match')
    assert page.evaluate('judge.leftSlot') == 2
    page.wait_for_timeout(1500)
    score_point(page, 1, '.dragBtn[data-points="3"]'); score_point(page, 1, '.dragBtn[data-points="3"]'); score_point(page, 1, '.dragBtn[data-points="1"]')
    page.click('#sendResultBtn'); page.wait_for_selector('#jOverlay:not(.hidden) h3', timeout=6000)
    r2 = sql(f"select p1_score, p2_score, status from matches where id = '{m2[0]}'")
    print('QR match row:', r2)
    assert r2 == '0|7|done', 'levý hráč byl p2 → skóre 0:7'

    # jiný turnaj → chyba
    page.evaluate('jHide()')
    other_t = sql("select id from tournaments where name = 'Bye Cup'")
    page.evaluate(f"judgeScan(1, 'BBXU1|{t_id}|{tok1}')"); page.wait_for_timeout(500)
    page.evaluate(f"judgeScan(2, 'BBXU1|{other_t}|{tok2}')"); page.wait_for_selector('#jOverlay:not(.hidden)')
    assert 'stejném turnaji' in page.inner_text('#jBox')
    page.screenshot(path=OUT + '36_bbxst_wrong_tournament.png')
    page.evaluate('jHide()')

    # ruční výběr zápasu
    page.evaluate('cancelMatch()'); page.wait_for_timeout(200)
    page.click('#judgeMatchBtn'); page.wait_for_selector('#mT'); page.wait_for_timeout(500)
    page.screenshot(path=OUT + '37_bbxst_manual.png')
    b.close()

print('CONSOLE ERRORS:', len(errors))
for e in errors[:20]: print(' -', e[:300])
print('BBXST OK')

# tlačítko ◂ BBXU vrátí do záložky Judge turnaje
