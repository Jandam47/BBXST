# TV rozpis: na šířku vše na jedné obrazovce (mřížka arén, bez rolování), na výšku pod sebou.
# Spouštět po čerstvém tests/ui-up.sh.
import re, subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

tid = sql("select id from tournaments where name = 'Listopadový Cup'")
sql(f"update tournaments set arena_count = 6 where id = '{tid}'")
# fronta: všechny čekající zápasy na aréně 1
sql(f"update matches set arena = 1 where tournament_id = '{tid}' and status in ('pending','live')")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for (w, h, name) in [(1920, 1080, 'land_tv'), (844, 390, 'land_phone'), (390, 844, 'port_phone'), (1080, 1920, 'port_tv')]:
        c = b.new_context(viewport={'width': w, 'height': h}, service_workers='block')
        pg = c.new_page()
        pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
        pg.goto(BASE + f'#/t/{tid}/tv'); pg.wait_for_selector('.tv-arena'); pg.wait_for_timeout(600)
        land = w > h
        assert pg.evaluate("document.querySelector('main').classList.contains('tv-land')") == land
        if land:
            assert pg.evaluate("document.documentElement.scrollHeight <= innerHeight + 1"), f'{name}: na šířku se nesmí rolovat'
            cut = pg.evaluate("[...document.querySelectorAll('.tv-now')].filter(e => e.getBoundingClientRect().bottom > e.closest('.tv-arena').getBoundingClientRect().bottom + 1).length")
            assert cut == 0, f'{name}: aktuální zápas se nevejde do karty'
            cols = pg.evaluate("getComputedStyle(document.querySelector('.tv-arenas')).gridTemplateColumns.split(' ').length")
            assert cols >= 2, cols
        else:
            cols = pg.evaluate("getComputedStyle(document.querySelector('.tv-arenas')).gridTemplateColumns.split(' ').length")
            assert cols == 1, f'{name}: na výšku pod sebou'
        y0 = pg.evaluate('scrollY'); pg.wait_for_timeout(2500)
        assert pg.evaluate('scrollY') == y0, 'samo se nerozjíždí'
        pg.screenshot(path=OUT + f'270_tv_{name}.png')
        c.close()
    # otočení za běhu
    c = b.new_context(viewport={'width': 1280, 'height': 720}, service_workers='block'); pg = c.new_page()
    pg.goto(BASE + f'#/t/{tid}/tv'); pg.wait_for_selector('main.tv-land')
    pg.set_viewport_size({'width': 720, 'height': 1280}); pg.wait_for_selector('main.tv-port')
    b.close()

if errors: print(*errors, sep='\n'); raise SystemExit(1)
print('TV MODES OK')
