# Živě: přenos z arén – beye aktuální sady (zahrané šedě, +body / −), endy, sledovaný hráč, feed a vyskakovací hláška.
# Spouštět po čerstvém tests/ui-up.sh.
import json, re, subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

tid = sql("select id from tournaments where name = 'Listopadový Cup'")
sql(f"update tournaments set arena_count = 3 where id = '{tid}'")
live = sql(f"select id from matches where tournament_id = '{tid}' and status = 'live' limit 1")
p1 = sql(f"select r.nick from matches m join registrations r on r.id = m.p1_reg where m.id = '{live}'")
p2 = sql(f"select r.nick from matches m join registrations r on r.id = m.p2_reg where m.id = '{live}'")
B = [
  {"slot": 1, "pts": 1, "finish": "spin",   "p1_bey": "Dran Sword 3-60F",  "p2_bey": "Shark Edge 1-60LF"},
  {"slot": 2, "pts": 3, "finish": "xtreme", "p1_bey": "Wizard Rod 9-60B",  "p2_bey": "Leon Claw 5-60P"},
  {"slot": 0, "pts": 0, "finish": None,     "p1_bey": "Hells Scythe 4-60T", "p2_bey": "Knight Shield 3-80N"},
  {"slot": 1, "pts": 2, "finish": "burst",  "p1_bey": "Dran Sword 3-60F",  "p2_bey": "Leon Claw 5-60P"},
]
def set_live(battles):
    s1 = sum(b['pts'] for b in battles if b['slot'] == 1); s2 = sum(b['pts'] for b in battles if b['slot'] == 2)
    st = json.dumps({"game": 0, "left": 1, "battles": battles}).replace("'", "''")
    sql(f"update matches set live_p1 = {s1}, live_p2 = {s2}, live_state = '{st}' where id = '{live}'")
set_live(B)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 1920, 'height': 1080}, service_workers='block')
    pg = c.new_page()
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    # tlačítko Živě v záhlaví turnaje
    pg.goto(BASE + f'#/t/{tid}'); pg.wait_for_selector('a.btn-live'); pg.click('a.btn-live')
    pg.wait_for_selector('.lv-arena.live')
    card = '.lv-arena.live'
    assert pg.inner_text(card + ' .lv-sc').replace('\n', '').replace(' ', '') == '3:3', pg.inner_text(card + ' .lv-sc')
    left = pg.evaluate(f"[...document.querySelectorAll('{card} .lv-set > div:first-child li')].map(l => [l.className, l.innerText.replace(/\\n/g,' ')])")
    right = pg.evaluate(f"[...document.querySelectorAll('{card} .lv-set > div:last-child li')].map(l => [l.className, l.innerText.replace(/\\n/g,' ')])")
    # 4. souboj = 2. sada: jen jeden zahraný bey, zbytek „?“
    assert left[0] == ['last', 'Dran Sword 3-60F +2 B'], left
    assert left[1][0] == 'hid' and left[2][0] == 'hid', left
    assert right[0][0] == 'last' and '−' in right[0][1], right
    assert 'sada 2' in pg.inner_text(card + ' .lv-setno')
    fin = pg.inner_text(card + ' .lv-p.l .lv-fin').replace('\n', ' ')
    assert 'B' in fin and 'S' in fin, fin
    # sledování hráče
    pg.click('[data-follow]'); pg.wait_for_selector('.lv-fpick')
    pg.fill('[data-q]', p1); pg.click(f'.lv-fpick:has-text("{p1}")'); pg.click('.modal [data-close]')
    pg.wait_for_selector('.lv-fc'); assert 'Hraje' in pg.inner_text('.lv-fc'), pg.inner_text('.lv-fc')
    assert pg.locator('.lv-arena.fol').count() == 1
    # nový souboj: Xtreme pro sledovaného → feed + vyskakovací hláška (polling 15 s)
    set_live(B + [{"slot": 1, "pts": 3, "finish": "xtreme", "p1_bey": "Wizard Rod 9-60B", "p2_bey": "Hells Chain 5-60HN"}])
    pg.wait_for_selector('.lv-flash.on', timeout=25000)
    assert 'Xtreme' in pg.inner_text('.lv-flash'), pg.inner_text('.lv-flash')
    assert 'Xtreme' in pg.inner_text('.lv-feed')
    pg.screenshot(path=OUT + '300_live_tv.png')
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), 'bez vodorovného rolování'
    # po stránce bez rolování do strany i na telefonu
    c2 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    ph = c2.new_page(); ph.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    ph.goto(BASE + f'#/t/{tid}/live'); ph.wait_for_selector('.lv-arena.live')
    assert ph.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), 'telefon: bez vodorovného rolování'
    ph.screenshot(path=OUT + '301_live_phone.png', full_page=True)
    # dohraný zápas → výsledek ve feedu
    w = sql(f"select p1_reg from matches where id = '{live}'")
    sql(f"""update matches set status = 'done', winner_reg = '{w}', p1_score = 7, p2_score = 3, p1_wins = 1, finished_at = now(),
            live_p1 = null, live_p2 = null, live_state = null where id = '{live}'""")
    pg.wait_for_selector('.lv-feed li.k-result', timeout=25000)
    assert 'porazil' in pg.inner_text('.lv-feed li.k-result')
    assert p1 in pg.inner_text('.lv-res')
    c.close(); c2.close(); b.close()

if errors: print(*errors, sep='\n'); raise SystemExit(1)
print('LIVE OK')
