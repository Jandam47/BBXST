# Historie bodů: žetony +1 / +2 O / +2 B / +3 u zápasů ve Swiss (i po dohrání) a pod živým skóre na TV.
# Spouštět po čerstvém tests/ui-up.sh.
import subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

tid = sql("select id from tournaments where name = 'Listopadový Cup'")
# dohraný zápas: 7× +1 pro vítěze (nejdelší možná řada), druhý dohraný se směsí endů
g1, s1 = sql(f"select g.id || '|' || g.winner_slot from games g join matches m on m.id = g.match_id where m.tournament_id = '{tid}' order by m.round, m.pos limit 1").split('|')
s1 = int(s1)
sql(f"delete from points where game_id = '{g1}'")
vals = ','.join(f"('{g1}', {i + 1}, {s1}, 1, 'spin')" for i in range(7))
sql(f"insert into points (game_id, seq, scorer_slot, pts, finish) values {vals}")
g2, s2 = sql(f"select g.id || '|' || g.winner_slot from games g join matches m on m.id = g.match_id where m.tournament_id = '{tid}' order by m.round, m.pos offset 1 limit 1").split('|')
s2 = int(s2); o2 = 3 - s2
sql(f"delete from points where game_id = '{g2}'")
sql(f"""insert into points (game_id, seq, scorer_slot, pts, finish) values
  ('{g2}', 1, {o2}, 2, 'over'), ('{g2}', 2, {s2}, 3, 'xtreme'), ('{g2}', 3, 0, 0, null), ('{g2}', 4, {s2}, 2, 'burst'),
  ('{g2}', 5, {o2}, 1, 'spin'), ('{g2}', 6, {s2}, 2, null)""")
# rozehraný zápas: live_state v orientaci p1/p2
live = sql(f"select id from matches where tournament_id = '{tid}' and status = 'live' limit 1")
sql(f"""update matches set live_p1 = 3, live_p2 = 5, live_state = '{{"game":0,"left":1,"battles":[
  {{"slot":1,"pts":1,"finish":"spin"}},{{"slot":2,"pts":1,"finish":"spin"}},{{"slot":1,"pts":2,"finish":"burst"}},
  {{"slot":2,"pts":3,"finish":"xtreme"}},{{"slot":0,"pts":0,"finish":null}},{{"slot":2,"pts":1,"finish":"spin"}}]}}' where id = '{live}'""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 360, 'height': 780}, service_workers='block')
    pg = c.new_page()
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto(BASE + f'#/t/{tid}/swiss'); pg.wait_for_selector('.pt-hist')
    pg.wait_for_timeout(500)
    rows = pg.evaluate("""[...document.querySelectorAll('.match')].map(m => ({
      l: [...m.querySelectorAll('.pt-hist .l .pt')].map(x => x.textContent), r: [...m.querySelectorAll('.pt-hist .r .pt')].map(x => x.textContent),
      top: [...m.querySelectorAll('.pt-hist .pt')].map(x => Math.round(x.getBoundingClientRect().top)) }))""")
    seven = [r for r in rows if len(r['l']) == 7 or len(r['r']) == 7]
    assert seven, rows
    assert len(set(seven[0]['top'])) == 1, 'sedm +1 se musí vejít na jeden řádek'
    flat = [x for r in rows for x in r['l'] + r['r']]
    for lab in ['+2 O', '+2 B', '+3', '+2']:
        assert lab in flat, (lab, flat)
    livez = [r for r in rows if r['l'] == ['+1', '+2 B'] and r['r'] == ['+1', '+3', '+1']]
    assert livez, 'rozehraný zápas ukazuje body z live_state'
    over = pg.evaluate("[...document.querySelectorAll('.pt-hist')].some(h => h.scrollWidth > h.clientWidth + 1)")
    assert not over, 'žetony nesmí přetékat'
    pg.locator('.match:has(.pt-hist)').first.scroll_into_view_if_needed()
    pg.screenshot(path=OUT + '280_swiss_hist.png', full_page=True)
    c.close()
    for (w, h, name) in [(1080, 1920, 'port'), (1920, 1080, 'land')]:
        c = b.new_context(viewport={'width': w, 'height': h}, service_workers='block'); pg = c.new_page()
        pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
        pg.goto(BASE + f'#/t/{tid}/tv'); pg.wait_for_selector('.tv-now .pt-hist'); pg.wait_for_timeout(500)
        labs = pg.evaluate("[...document.querySelectorAll('.tv-now .pt-hist .pt')].map(x => x.textContent)")
        assert labs == ['+1', '+2 B', '+1', '+3', '+1'], labs
        if w > h:
            assert pg.evaluate("document.documentElement.scrollHeight <= innerHeight + 1"), 'na šířku bez rolování'
        pg.screenshot(path=OUT + f'281_tv_hist_{name}.png')
        c.close()
    b.close()

if errors: print(*errors, sep='\n'); raise SystemExit(1)
print('POINTS HIST OK')
