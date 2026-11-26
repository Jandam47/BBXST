# Výzva na tréninku (43): vyskakovací okno Přijmout / Odmítnout v BBXU i BBXST, odkaz z notifikace (?vyzva=),
# Přijmout z notifikace (bbxst.html?training=…&accept=1), odmítnutí na pozadí klíčem (training_decline_token).
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


def phone(b, email):
    c = b.new_context(viewport={'width': 915, 'height': 412}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
    pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    return pg

def sql_last(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[-1].strip() if out else out

def as_user(u, q):
    return sql_last(f"""select set_config('request.jwt.claims', '{{"sub":"{u}","role":"authenticated"}}', true); set local role authenticated; {q}""")

u1 = sql("select id from profiles where nick = 'Hrac1'"); u2 = sql("select id from profiles where nick = 'Hrac2'")
cid = sql(f"""insert into communities (name, status, created_by) values ('Výzvy', 'approved', '{u1}') returning id""")
sql(f"""insert into community_members (community_id, user_id, role, status) values ('{cid}', '{u1}', 'leader', 'active'), ('{cid}', '{u2}', 'member', 'active')""")
tid = sql(f"""insert into tournaments (kind, event_type, community_id, name, swiss_rounds, top_cut, created_by, rated)
              values ('event', 'community', '{cid}', 'Výzvový trénink', 1, 0, '{u1}', false) returning id""")
D = json.dumps([{"type": "bx", "blade": "Dran Sword", "ratchet": "3-60", "bit": "Flat"}])
regs = {}
for u in (u1, u2):
    regs[u] = sql_last(f"""select set_config('request.jwt.claims', '{{"sub":"{u}","role":"authenticated"}}', true);
            insert into registrations (tournament_id, user_id, nick, deck) values ('{tid}', '{u}', (select nick from profiles where id = '{u}'), '{D}') returning id""")
challenge = lambda: as_user(u1, f"select training_challenge('{tid}', '{regs[u2]}')")
status = lambda m: sql(f"select status from training_matches where id = '{m}'")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = phone(b, 'hrac2@test.cz')

    # 1) BBXU: okno výzvy po startu aplikace → Odmítnout
    m1 = challenge()
    c.goto(BASE + 'index.html#/'); c.reload(); c.wait_for_selector('.modal .ch-pop')
    assert 'Hrac1' in c.inner_text('.ch-pop')
    c.screenshot(path=OUT + '400_bbxu_challenge_popup.png')
    c.click('.ch-pop [data-ch=no]'); c.wait_for_selector('.modal .ch-pop', state='detached')
    assert status(m1) == 'declined'

    # 2) odkaz z notifikace (#/t/<id>/me?vyzva=) → okno → Přijmout → BBXST se zápasem
    m2 = challenge()
    c.goto(BASE + f'index.html#/t/{tid}/me?vyzva={m2}'); c.reload(); c.wait_for_selector('.modal .ch-pop')
    c.click('.ch-pop [data-ch=yes]'); c.wait_for_url(re.compile(r'bbxst\.html'))
    c.wait_for_selector('body.training.has-tmatch')
    assert status(m2) == 'active'
    assert c.inner_text('#player2Info .nick') == 'Hrac1'
    as_user(u1, f"select training_end('{m2}')")

    # 3) BBXST: okno výzvy samo vyskočí → ODMÍTNOUT
    m3 = challenge()
    c.goto(BASE + 'bbxst.html'); c.wait_for_selector('#jChNo')
    c.screenshot(path=OUT + '401_bbxst_challenge_popup.png')
    c.click('#jChNo'); c.wait_for_timeout(800)
    assert status(m3) == 'declined'

    # 4) Přijmout z notifikace = bbxst.html?training=…&accept=1 → bez dalšího ptaní rovnou zápas
    m4 = challenge()
    c.goto(BASE + f'bbxst.html?training={m4}&accept=1'); c.wait_for_selector('body.training.has-tmatch')
    assert status(m4) == 'active'
    assert c.locator('#jChYes').count() == 0 or c.is_hidden('#jOverlay'), 'žádné další okno'
    as_user(u1, f"select training_end('{m4}')")

    # 5) Odmítnout z notifikace na pozadí: anonymní volání REST s jednorázovým klíčem (jako service worker)
    m5 = challenge()
    tok = sql(f"select action_token from training_matches where id = '{m5}'")
    ok = c.evaluate("""async ([m, t]) => { const k = window.BBX_CONFIG || {}; const cfg = await (await fetch('js/config.js')).text();
        const url = cfg.match(/supabaseUrl:\\s*'([^']+)'/)[1], key = cfg.match(/supabaseAnonKey:\\s*'([^']+)'/)[1];
        const r = await fetch(url + '/rest/v1/rpc/training_decline_token', { method: 'POST',
          headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_match: m, p_token: t }) });
        return [r.status, await r.json()] }""", [m5, tok])
    print('decline REST:', ok)
    assert ok[1] is True and status(m5) == 'declined'
    b.close()

print('CONSOLE ERRORS:', len(errors))
for e in errors[:10]: print(' -', e[:300])
assert not errors
print('CHALLENGE OK')
