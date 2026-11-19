# Test: rozehraná hra se pamatuje (znovuotevření BBXST), převzetí jiným judgem, PASS JUDGE, ZRUŠIT.
import re, json, subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
GO1 = ".arena-card:has(.arena-no:text-is('1')) [data-go]"
def sql(q):
    return subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAc', q]).decode().strip()

def drag(page, sel, dx):
    box = page.locator(sel).bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y); page.mouse.down()
    for i in range(1, 9): page.mouse.move(x + dx * i / 8, y)
    page.mouse.up()

def score_point(page, side, pts):
    drag(page, f'.dragBtn[data-points="{pts}"]', -220 if side == 1 else 220)
    page.wait_for_timeout(150)
    if page.locator('#pickOverlay:not(.hidden)').count():
        scorer, other = ('#pickLeft', '#pickRight') if side == 1 else ('#pickRight', '#pickLeft')
        if page.locator(f'{scorer} .beyPick.win').count() == 0:
            page.locator(f'{scorer} .beyPick:not([disabled])').first.click()
        if page.locator(f'{other} .beyPick.lose').count() == 0:
            page.locator(f'{other} .beyPick:not([disabled])').first.click()
        page.wait_for_selector('#pickOverlay.hidden', state='attached')
    page.wait_for_timeout(1400)   # cooldown + odeslání živého skóre

def new_page(b, email):
    c = b.new_context(viewport={'width': 915, 'height': 412}, device_scale_factor=2, service_workers='block')
    page = c.new_page()
    page.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    page.goto(BASE + '#/login'); page.fill('input[name=email]', email); page.fill('input[name=password]', 'x')
    page.click('#f-login button'); page.wait_for_selector('.t-card')
    return page

def board(page): return page.inner_text('#score1') + ':' + page.inner_text('#score2')
def db_live(m_id): return sql(f"select coalesce(live_p1::text,'-') || ':' || coalesce(live_p2::text,'-') || '|' || coalesce(judge_id::text,'') || '|' || status from matches where id = '{m_id}'")

t_id = sql("select id from tournaments where name = 'Listopadový Cup'")
judge1 = sql("select id from profiles where nick = 'Judge'")
judge2 = sql("select id from profiles where nick = 'Judge2'")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── Judge 1 rozehraje zápas na aréně 1
    a = new_page(b, 'judge@test.cz')
    a.goto(BASE + f'#/t/{t_id}/judge'); a.wait_for_selector(GO1)
    a.click(GO1); a.wait_for_selector('body.judge.has-match')
    a.wait_for_timeout(1500)
    m_id = a.evaluate('judge.match.id')
    score_point(a, 1, 2); score_point(a, 2, 1)
    assert board(a) == '2:1', board(a)
    assert a.inner_text('#judgeTag') == 'PASS JUDGE'
    st = json.loads(sql(f"select live_state from matches where id = '{m_id}'"))
    assert len(st['battles']) == 2 and st['left'] == a.evaluate('judge.leftSlot'), st

    # ── zavřít a znovu otevřít BBXST → skóre se načte
    a.goto(BASE + 'bbxst.html'); a.wait_for_selector('body.judge.has-match'); a.wait_for_timeout(1200)
    assert board(a) == '2:1', 'po znovuotevření ' + board(a)
    assert a.evaluate('judge.battles.length') == 2
    a.screenshot(path=OUT + '50_resume.png')
    a.goto('about:blank')   # „zavřený“ BBXST na stejném telefonu

    # ── Judge 2 převezme zápas z BBXU
    c = new_page(b, 'judge2@test.cz')
    c.goto(BASE + f'#/t/{t_id}/judge'); c.wait_for_selector(GO1)
    assert c.inner_text(GO1) == 'Převzít', c.inner_text(GO1)
    card = c.locator(".arena-card:has(.arena-no:text-is('1'))")
    assert '2:1' in card.inner_text().replace(' ', '').replace('\n', '') or '1:2' in card.inner_text().replace(' ', '').replace('\n', '')
    c.screenshot(path=OUT + '51_bbxu_takeover.png')
    c.click(GO1); c.wait_for_selector('#jYes')
    assert 'Judge' in c.inner_text('#jBox') and 'Převzít' in c.inner_text('#jBox')
    c.screenshot(path=OUT + '52_bbxst_takeover_confirm.png')
    c.click('#jYes'); c.wait_for_selector('body.judge.has-match'); c.wait_for_timeout(1500)
    assert board(c) == '2:1', 'převzato ' + board(c)
    assert db_live(m_id).split('|')[1] == judge2
    score_point(c, 1, 1)
    assert board(c) == '3:1'

    # ── původní judge otevře BBXST → dozví se, že zápas převzal někdo jiný
    a.goto(BASE + 'bbxst.html'); a.wait_for_selector('#jOverlay:not(.hidden)')
    assert 'převzal' in a.inner_text('#jBox') and 'Judge2' in a.inner_text('#jBox'), a.inner_text('#jBox')
    assert a.evaluate('localStorage.getItem("bbxst_judge_live")') is None
    a.click('#jBox .qr-btn')

    # ── Judge 2: PASS JUDGE
    c.click('#judgeTag'); c.wait_for_selector('#jYes'); c.click('#jYes'); c.wait_for_timeout(800)
    assert not c.evaluate('judge.match')
    live = db_live(m_id)
    assert live.split('|')[1] == '' and live.endswith('live'), live
    assert c.inner_text('#judgeTag') == '◂ BBXU'
    # dlaždice v BBXST ukazují volné místo
    c.click('#judgeMatchBtn'); c.wait_for_selector('#mTiles .aTile'); c.wait_for_timeout(300)
    assert 'volné místo' in c.inner_text('#mTiles')
    c.screenshot(path=OUT + '53_bbxst_tiles_free.png')
    c.evaluate('stopArenaPoll(); jHide()')

    # ── Judge 1 naváže z BBXU (bez dotazu), dohraje a odešle
    a.goto(BASE + f'#/t/{t_id}/judge'); a.wait_for_selector(GO1)
    assert 'Rozehráno' in a.inner_text('.arena-card.free') and a.inner_text(GO1) == 'Navázat'
    a.screenshot(path=OUT + '54_bbxu_free.png')
    a.click(GO1); a.wait_for_selector('body.judge.has-match'); a.wait_for_timeout(1500)
    assert board(a) == '3:1', 'navázání ' + board(a)
    for _ in range(3):
        if a.locator('#sendResultBtn').is_visible(): break
        score_point(a, 1, 2)
    a.wait_for_selector('#sendResultBtn', state='visible'); a.click('#sendResultBtn'); a.wait_for_timeout(2500)
    games = sql(f"select count(*) from games where match_id = '{m_id}'")
    assert games == '1', games
    assert sql(f"select live_state is null from matches where id = '{m_id}'") == 't'
    assert a.evaluate('localStorage.getItem("bbxst_judge_live")') is None
    a.wait_for_selector('#jOverlay:not(.hidden)'); a.screenshot(path=OUT + '55_after_send.png'); a.evaluate('jHide()')

    # ── ZRUŠIT zahodí rozehranou hru
    a.click('#judgeMatchBtn'); a.wait_for_selector('#mTiles .aTile:not(.empty)')
    a.locator('.aTile:not(.empty)').first.click(); a.wait_for_selector('#mOk'); a.click('#mOk')
    a.wait_for_selector('body.judge.has-match')
    if a.locator('#jYes').is_visible(): a.click('#jYes'); a.wait_for_selector('body.judge.has-match')
    a.wait_for_timeout(1500)
    m2 = a.evaluate('judge.match.id')
    score_point(a, 2, 1)
    assert sql(f"select live_state is not null from matches where id = '{m2}'") == 't'
    a.click('#judgeMatchBtn'); a.wait_for_selector('#jYes'); a.click('#jYes'); a.wait_for_timeout(800)
    r = sql(f"select coalesce(live_p1::text,'-') || '|' || (live_state is null) || '|' || coalesce(judge_id::text,'') from matches where id = '{m2}'")
    assert r == '-|true|', r
    b.close()

print('CONSOLE ERRORS:', len(errors))
for e in errors[:20]: print(' -', e[:300])
assert not errors
print('HANDOVER OK')
