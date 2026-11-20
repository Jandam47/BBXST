# Komunitní trénink: bot (založení v Řízení, „Hrát“ → BBXST hned bez potvrzení, zápis) a archiv
# (po ukončení: zpět do komunity, razítko Archiv, bez Řízení a bez BBXST, nic se nemění).
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

def ctx(b, email, w=390, h=844):
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
    pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    return pg

def go(page, h):
    page.goto(BASE + '#' + h); page.wait_for_timeout(700)

def drag(page, sel, dx, dy=0):
    box = page.locator(sel).bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y); page.mouse.down()
    for i in range(1, 9): page.mouse.move(x + dx * i / 8, y + dy * i / 8)
    page.mouse.up()

# ── příprava: komunita (Hrac1 leader, Hrac2 člen), trénink, Hrac2 s deckem ──
u1 = sql("select id from profiles where nick = 'Hrac1'"); u2 = sql("select id from profiles where nick = 'Hrac2'")
cid = sql(f"insert into communities (name, status, created_by) values ('Bot klub', 'approved', '{u1}') returning id")
sql(f"insert into community_members (community_id, user_id, role, status) values ('{cid}', '{u1}', 'leader', 'active'), ('{cid}', '{u2}', 'member', 'active')")
tid = sql(f"""insert into tournaments (kind, event_type, community_id, name, swiss_rounds, top_cut, created_by, rated)
              values ('event', 'community', '{cid}', 'Sólo trénink', 1, 0, '{u1}', false) returning id""")
D2 = json.dumps([{"type": "bx", "blade": "Shark Edge", "ratchet": "3-60", "bit": "Low Flat"},
                 {"type": "bx", "blade": "Leon Claw", "ratchet": "5-60", "bit": "Point"},
                 {"type": "bx", "blade": "Knight Shield", "ratchet": "3-80", "bit": "Needle"}])
sql(f"insert into registrations (tournament_id, user_id, nick, deck) values ('{tid}', '{u2}', 'Hrac2', '{D2}')")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    lead = ctx(b, 'hrac1@test.cz'); pl = ctx(b, 'hrac2@test.cz')

    # ── leader vytvoří bota v Řízení ──
    go(lead, f'/t/{tid}/manage'); lead.wait_for_selector('#f-bot')
    lead.click('#f-bot button'); lead.wait_for_selector('[data-unbot]')
    assert 'BOT' in lead.inner_text('#tab')
    lead.locator('#f-bot').scroll_into_view_if_needed()
    lead.screenshot(path=OUT + '170_training_bot_manage.png', full_page=True)

    # ── hráč: bot v seznamu → Hrát → BBXST rovnou proti botovi ──
    go(pl, f'/t/{tid}/players'); pl.wait_for_selector('.li.tr-bot [data-challenge]')
    assert pl.inner_text('.li.tr-bot [data-challenge]') == 'Hrát'
    pl.screenshot(path=OUT + '171_training_bot_players.png')
    pl.click('.li.tr-bot [data-challenge]')
    pl.wait_for_url(re.compile(r'bbxst\.html'))
    pl.set_viewport_size({'width': 915, 'height': 412})
    pl.wait_for_selector('body.has-tmatch')
    assert 'BOT' in pl.inner_text('#player2Info'), pl.inner_text('#player2Info')
    mid = sql(f"select m.id from training_matches m join registrations r on r.id = m.p2_reg where r.is_bot and m.tournament_id = '{tid}'")
    assert sql(f"select status from training_matches where id = '{mid}'") == 'active'
    drag(pl, '.dragBtn[data-points="1"]', -220); pl.wait_for_timeout(300)
    if pl.locator('#pickOverlay:not(.hidden)').count():
        pl.locator('#pickLeft .beyPick:not([disabled])').first.click()
        pl.locator('#pickRight .beyPick:not([disabled])').first.click()
    pl.wait_for_timeout(1200)
    assert sql(f"select count(*) from training_battles where match_id = '{mid}'") == '1'
    assert sql(f"select p2_bey from training_battles where match_id = '{mid}'") == 'Shark Edge 3-60LF', 'bot bez decku = zrcadlo'
    pl.screenshot(path=OUT + '172_bbxst_vs_bot.png')

    # ── leader ukončí trénink → archiv ──
    go(lead, f'/t/{tid}/manage'); lead.click('[data-act=finish]')
    lead.click('[data-yes]'); lead.wait_for_selector('.tr-stamp')
    tabs = lead.locator('.t-nav a').all_inner_texts()
    assert not any('Řízení' in t for t in tabs), tabs
    assert lead.locator('.t-head a[href^="bbxst.html"]').count() == 0
    assert lead.get_attribute('.tr-back', 'href') == f'#/c/{cid}'
    assert sql(f"select status from training_matches where id = '{mid}'") == 'done', 'archiv uzavře výzvy'
    go(lead, f'/t/{tid}/manage'); lead.wait_for_selector('.tr-stamp')
    assert lead.locator('#f-bot').count() == 0, 'Řízení v archivu není'
    go(pl, f'/c/{cid}'); pl.set_viewport_size({'width': 390, 'height': 844})
    pl.wait_for_selector('.tr-past'); pl.click('.tr-past'); pl.wait_for_selector('.tr-stamp')
    pl.wait_for_selector('.tr-hist')
    pl.screenshot(path=OUT + '173_training_archive.png', full_page=True)
    pl.click('.tr-back'); pl.wait_for_selector('.tr-past')
    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    print('TRAINING BOT + ARCHIV OK')
