# Záložka Hráči (31): kolečko Standings · Komunity · Ligy (+ Trénink pro členy komunity) a standings
# komunitního tréninku. Spouštět po čerstvém tests/ui-up.sh.
import re, subprocess, os
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
os.makedirs(OUT, exist_ok=True)
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

def ctx(b, email=None, w=390, h=844):
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404|400 \(Bad Request', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    if email:
        pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
        pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    else:
        pg.goto(BASE + '#/'); pg.wait_for_timeout(800)
    return pg

def wheel_labels(pg):
    return pg.evaluate("[...document.querySelectorAll('.cw-sec title')].map(t => t.textContent)")

# komunita s tréninkem: Hrac1 a Hrac2 členové, Hrac3 ne; 5 soubojů (Hrac1 vyhraje 3, Hrac2 2)
uid = lambda nick: sql(f"select id from profiles where nick = '{nick}'")
h1, h2 = uid('Hrac1'), uid('Hrac2')
cid = sql(f"insert into communities (name, status, created_by) values ('Testovací komunita', 'approved', '{h1}') returning id")
sql(f"insert into community_members (community_id, user_id, role, status) values ('{cid}', '{h1}', 'leader', 'active'), ('{cid}', '{h2}', 'member', 'active')")
tid = sql(f"""insert into tournaments (kind, event_type, community_id, name, swiss_rounds, top_cut, created_by, status, rated)
              values ('event', 'community', '{cid}', 'Trénink na test', 1, 0, '{h1}', 'registration', false) returning id""")
r1 = sql(f"insert into registrations (tournament_id, user_id, nick) values ('{tid}', '{h1}', 'Hrac1') returning id")
r2 = sql(f"insert into registrations (tournament_id, user_id, nick) values ('{tid}', '{h2}', 'Hrac2') returning id")
mid = sql(f"insert into training_matches (tournament_id, p1_reg, p2_reg, status) values ('{tid}', '{r1}', '{r2}', 'active') returning id")
for seq, (slot, pts, fin) in enumerate([(1, 3, 'xtreme'), (2, 1, 'spin'), (1, 2, 'over'), (1, 1, 'spin'), (2, 2, 'burst')], 1):
    sql(f"""insert into training_battles (match_id, tournament_id, seq, scorer_slot, pts, finish, p1_bey, p2_bey)
            values ('{mid}', '{tid}', {seq}, {slot}, {pts}, '{fin}', 'Dran Sword 3-60F', 'Hells Scythe 4-60T')""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── nečlen: tři výseče ──
    h3 = ctx(b, 'hrac3@test.cz')
    url0 = h3.url
    h3.click('.tabbar a[data-tab=players]'); h3.wait_for_selector('.cw-overlay .cw-sec')
    assert h3.inner_text('.cw-title') == 'Hráči' and h3.url == url0, 'kolečko nad stránkou, bez přechodu'
    assert wheel_labels(h3) == ['Standings', 'Komunity', 'Ligy'], wheel_labels(h3)
    h3.click('.cw-sec[data-i="0"]'); h3.wait_for_url(re.compile(r'#/players$')); h3.wait_for_selector('#pl .li')
    assert h3.inner_text('h1') == 'Standings' and h3.locator('.people-tabs').count() == 0
    h3.click('.tabbar a[data-tab=players]'); h3.wait_for_selector('.cw-overlay .cw-sec'); h3.click('.cw-sec[data-i="2"]')
    h3.wait_for_url(re.compile(r'#/leagues$')); h3.wait_for_selector('h1')
    assert h3.locator('.people-tabs').count() == 0
    h3.goto(BASE + f'#/c/{cid}/standings'); h3.wait_for_selector('.empty')
    assert 'členové' in h3.inner_text('.empty'), 'nečlen standings nevidí'

    # ── člen: výseč Trénink → standings ──
    m1 = ctx(b, 'hrac1@test.cz')
    m1.click('.tabbar a[data-tab=players]'); m1.wait_for_selector('.cw-overlay .cw-sec')
    assert wheel_labels(m1) == ['Standings', 'Komunity', 'Ligy', 'Trénink – standings'], wheel_labels(m1)
    m1.screenshot(path=OUT + '310_players_wheel.png')
    m1.click('.cw-sec[data-i="3"]'); m1.wait_for_url(re.compile(rf'#/c/{cid}/standings$')); m1.wait_for_selector('.cst-row')
    rows = m1.locator('.cst-row').all_inner_texts()
    assert len(rows) == 2 and 'Hrac1' in rows[0] and '3–0–2' in rows[0] and 'X 1' in rows[0], rows
    assert 'body 6:3' in rows[0] and '2–0–3' in rows[1], rows
    assert m1.locator('.cst-row.me').count() == 1
    m1.click('[data-sort=rate]'); m1.wait_for_selector('.cst-main >> text=60 %')
    m1.click('[data-sort=points]'); assert m1.inner_text('.cst-row >> nth=0 >> .cst-main') == '+3'
    m1.screenshot(path=OUT + '311_training_standings.png', full_page=True)
    sql(f"update training_battles set created_at = now() - interval '40 days' where match_id = '{mid}' and seq <= 2")
    m1.click('[data-since="30"]'); m1.wait_for_function("document.querySelector('.cst-row') && document.querySelector('.cst-row').innerText.includes('2–0–1')")
    # odkaz ze stránky komunity
    m1.goto(BASE + f'#/c/{cid}'); m1.wait_for_selector(f'a[href="#/c/{cid}/standings"]')

    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    print('PLAYERS WHEEL OK')
