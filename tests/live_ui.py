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
D1 = sql(f"select bey1 || '|' || bey2 || '|' || bey3 from matches m join registrations r on r.id = m.p1_reg where m.id = '{live}'").split('|')
D2 = sql(f"select bey1 || '|' || bey2 || '|' || bey3 from matches m join registrations r on r.id = m.p2_reg where m.id = '{live}'").split('|')
B = [
  {"slot": 1, "pts": 1, "finish": "spin",   "p1_bey": D1[0], "p2_bey": D2[0]},
  {"slot": 2, "pts": 3, "finish": "xtreme", "p1_bey": D1[1], "p2_bey": D2[1]},
  {"slot": 0, "pts": 0, "finish": None,     "p1_bey": D1[2], "p2_bey": D2[2]},
  {"slot": 1, "pts": 2, "finish": "burst",  "p1_bey": D1[1], "p2_bey": D2[2]},
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
    # 4. souboj = 2. sada: zahraný bey šedě s výsledkem, zbylé dva z decku svítí
    assert left[0] == ['done last', f'{D1[1]} +2 B'], left
    assert [x[0] for x in left[1:]] == ['next', 'next'] and {x[1] for x in left[1:]} == {D1[0], D1[2]}, left
    assert right[0][0] == 'done last' and '−' in right[0][1], right
    assert len(right) == 3, right
    assert 'sada 2' in pg.inner_text(card + ' .lv-setno')
    fin = pg.inner_text(card + ' .lv-p.l .lv-fin').replace('\n', ' ')
    assert 'B' in fin and 'S' in fin, fin
    # sledování hráče
    pg.click('[data-follow]'); pg.wait_for_selector('.lv-fpick')
    pg.fill('[data-q]', p1); pg.click(f'.lv-fpick:has-text("{p1}")'); pg.click('.modal [data-close]')
    pg.wait_for_selector('.lv-fc'); assert 'Hraje' in pg.inner_text('.lv-fc'), pg.inner_text('.lv-fc')
    assert pg.locator('.lv-arena.fol').count() == 1
    # nový souboj: Xtreme pro sledovaného → feed + vyskakovací hláška (polling 15 s)
    set_live(B + [{"slot": 1, "pts": 3, "finish": "xtreme", "p1_bey": D1[0], "p2_bey": D2[0]}])
    pg.wait_for_selector('.lv-flash.on', timeout=25000)
    assert 'Xtreme' in pg.inner_text('.lv-flash'), pg.inner_text('.lv-flash')
    assert 'Xtreme' in pg.inner_text('.lv-feed')
    # statistiky: otevřít / zavřít okénko
    assert pg.locator('.lv-stats').count() == 0
    pg.click('[data-stats] > summary'); pg.wait_for_selector('.lv-stats .lv-bar')
    assert 'soubojů' in pg.inner_text('.lv-sn')
    pg.screenshot(path=OUT + '300_live_tv.png')
    # push bez účtu → výzva k přihlášení
    pg.click('[data-push]'); pg.wait_for_selector('.toast:has-text("účtem")')
    # režie: jedna aréna přes celou plochu, výběr arény, auto
    pg.click('[data-dirmode]'); pg.wait_for_selector('.lv-dirbar')
    assert pg.locator('.lv-arena').count() == 1
    pg.click('.lv-mini[data-dir="1"]'); pg.wait_for_selector('.lv-arena[data-arena="1"]')
    assert pg.locator('.lv-arena').count() == 1
    a_live = sql(f"select arena from matches where id = '{live}'")
    pg.click('.lv-mini[data-dir="auto"]'); pg.wait_for_selector(f'.lv-arena[data-arena="{a_live}"]')
    pg.screenshot(path=OUT + '302_live_director.png')
    pg.click('[data-dirmode]'); pg.wait_for_selector('.lv-dirbar', state='detached')
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), 'bez vodorovného rolování'
    # po stránce bez rolování do strany i na telefonu
    c2 = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    ph = c2.new_page(); ph.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    ph.goto(BASE + f'#/t/{tid}/live'); ph.wait_for_selector('.lv-arena.live')
    assert ph.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), 'telefon: bez vodorovného rolování'
    ph.screenshot(path=OUT + '301_live_phone.png', full_page=True)
    # Dění: výběr arén – bod na jiné aréně zmizí po odškrtnutí, sledovaný hráč zůstane
    other = sql(f"select id || '|' || arena from matches where tournament_id = '{tid}' and status = 'pending' and arena is not null and id <> '{live}' order by arena limit 1").split('|')
    sql(f"""update matches set status = 'live', live_p1 = 1, live_p2 = 0,
            live_state = '{{"game":0,"left":1,"battles":[{{"slot":1,"pts":1,"finish":"spin"}}]}}' where id = '{other[0]}'""")
    pg.wait_for_selector(f'.lv-feed li:has(.lv-fa:text-is("A{other[1]}"))', timeout=25000)
    pg.uncheck(f'[data-feed-arena="{other[1]}"]')
    pg.wait_for_selector(f'.lv-feed li:has(.lv-fa:text-is("A{other[1]}"))', state='detached')
    assert pg.locator('.lv-feed li.fol').count() >= 1, 'sledovaný hráč zůstává'
    pg.reload(); pg.wait_for_selector('.lv-afilter')
    assert not pg.is_checked(f'[data-feed-arena="{other[1]}"]'), 'volba se pamatuje'
    # dohraný zápas → výsledek ve feedu
    w = sql(f"select p1_reg from matches where id = '{live}'")
    sql(f"""update matches set status = 'done', winner_reg = '{w}', p1_score = 7, p2_score = 3, p1_wins = 1, finished_at = now(),
            live_p1 = null, live_p2 = null, live_state = null where id = '{live}'""")
    pg.wait_for_selector('.lv-feed li.k-result', timeout=25000)
    assert 'porazil' in pg.inner_text('.lv-feed li.k-result')
    assert p1 in pg.inner_text('.lv-res')
    # pavouk top cutu se skrytím dohraných
    tc = sql("select id from tournaments where name = 'Bye Cup'")
    pg.goto(BASE + f'#/t/{tc}/live'); pg.wait_for_selector('.lv-bracket')
    shown = pg.locator('.lv-bracket .b-match').count()
    total = int(sql(f"select count(*) from matches where tournament_id = '{tc}' and stage <> 'swiss'"))
    undone = int(sql(f"select count(*) from matches where tournament_id = '{tc}' and stage <> 'swiss' and status <> 'done'"))
    assert shown == undone, (shown, undone)
    pg.uncheck('[data-hide-done]'); pg.wait_for_timeout(200)
    assert pg.locator('.lv-bracket .b-match').count() == total
    pg.screenshot(path=OUT + '303_live_bracket.png')
    c.close(); c2.close(); b.close()

if errors: print(*errors, sep='\n'); raise SystemExit(1)
print('LIVE OK')
