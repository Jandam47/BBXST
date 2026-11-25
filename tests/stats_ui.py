# Stats ladder (36): kolečko Hráči → Stats ladder, filtry, top 3 / top 10, komunitní ladder, stats v profilu.
# Spouštět po čerstvém tests/ui-up.sh.
import re, subprocess, os
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
os.makedirs(OUT, exist_ok=True)
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

def ctx(b, email):
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
    pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    return pg

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    h = ctx(b, 'hrac1@test.cz')
    me = sql("select id from profiles where nick = 'Hrac1'")
    h.click('.tabbar a[data-tab=players]'); h.wait_for_selector('.cw-overlay .cw-sec')
    h.dispatch_event('.cw-sec[aria-label^="Stats ladder"]', 'click')
    h.wait_for_url(re.compile(r'#/stats')); h.wait_for_selector('.st-card')
    assert h.locator('.st-card').count() == 13, h.locator('.st-card').count()
    assert h.locator('[data-mode]').count() == 0, 'bez komunity jen turnaje'
    names = h.eval_on_selector_all('.st-card h3', 'els => els.map(e => e.textContent)')
    assert names[0] == 'Breakdancer' and 'Blitzkrieg' in names and names[-1] == 'No rod???', names
    assert all(h.locator(f'.st-card >> nth={i} >> .st-row:not(.st-mine)').count() <= 3 for i in range(13))
    h.screenshot(path=OUT + '500_stats_ladder.png', full_page=True)
    # Top 10 u jednoho statu
    h.click('.st-card[data-stat="no_rod"] [data-only]'); h.wait_for_function("() => document.querySelectorAll('.st-card').length === 1")
    assert '?s=no_rod' in h.url or 's=no_rod' in h.url
    assert h.locator('.st-card .st-row').count() <= 10 and h.locator('.st-card .st-row').count() >= 4
    h.screenshot(path=OUT + '501_stats_top10.png')
    # zpět na všechny, sezóna celkem, kraj
    h.select_option('[data-f=stat]', ''); h.wait_for_function("() => document.querySelectorAll('.st-card').length === 13")
    h.select_option('[data-f=year]', 'all'); h.wait_for_selector('.st-card'); assert 'y=all' in h.url
    h.select_option('[data-f=region]', 'Zlínský'); h.wait_for_selector('.st-card')
    h.wait_for_function("() => [...document.querySelectorAll('.st-card .st-row:not(.st-mine)')].length === 0")
    h.select_option('[data-f=region]', ''); h.wait_for_selector('.st-card .st-row')
    h.click('[data-n="10"]'); h.wait_for_selector('[data-n="10"].on')
    # reload drží filtry z adresy
    h.reload(); h.wait_for_selector('.st-card'); assert h.input_value('[data-f=year]') == 'all'

    # komunitní ladder
    cid = sql("insert into communities (name, status) values ('Stats Testers', 'approved') returning id")
    sql(f"insert into community_members (community_id, user_id, role, status) values ('{cid}', '{me}', 'member', 'active')")
    h.goto(BASE + '#/'); h.wait_for_selector('.t-card')
    h.evaluate("location.hash = '#/stats?m=komunita'"); h.reload(); h.wait_for_selector('[data-mode=komunita].on', timeout=8000)
    h.wait_for_selector('.st-card')
    assert h.locator('.st-card').count() == 8, h.locator('.st-card').count()
    assert 'Stats Testers' in h.inner_text('main')
    h.screenshot(path=OUT + '502_stats_community.png')
    h.click('[data-mode=turnaje]'); h.wait_for_function("() => document.querySelectorAll('.st-card').length === 13")

    # profil: stats
    h.goto(BASE + '#/me'); h.wait_for_selector('#prof-stats h2')
    h.locator('#prof-stats').scroll_into_view_if_needed()
    h.screenshot(path=OUT + '503_profile_stats.png')
    tiles = h.locator('#prof-stats .ps-tile').count()
    print('profil tiles:', tiles, 'bedna:', h.locator('#prof-stats .ps-tile.r1, #prof-stats .ps-tile.r2, #prof-stats .ps-tile.r3').count())
    h.click('#prof-stats [data-season=all]'); h.wait_for_selector('#prof-stats [data-season=all].on')
    assert h.locator('#prof-stats .ps-tile').count() >= tiles
    b.close()

assert not errors, errors
print('stats UI OK')
