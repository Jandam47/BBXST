# Odznak nepřečtených, nahlášení + řešení adminem, upozornění v profilu, smazání účtu, sdílení výsledků.
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

def ctx(b, email=None):
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block', accept_downloads=True)
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    if email:
        pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
        pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    else:
        pg.goto(BASE + '#/'); pg.wait_for_timeout(600)
    return pg

def go(page, h, sel):
    page.goto(BASE + '#' + h); page.wait_for_selector(sel)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── odznak nepřečtených ──
    h1 = ctx(b, 'hrac1@test.cz')
    go(h1, '/chat/volny', '.chat-log')                     # přečte, co tam je
    h1.wait_for_timeout(400)
    go(h1, '/', '.t-card')
    sql(f"insert into chat_messages (room_id, user_id, nick, avatar, body) select 'volny', id, nick, avatar, 'Kupte si levné V-bucks na mém webu!' from profiles where nick = 'Hrac2'")
    h1.reload(); h1.wait_for_selector('.tabbar a[data-tab=chat] .nbadge')
    assert h1.inner_text('.tabbar a[data-tab=chat] .nbadge') == '1'
    h1.screenshot(path=OUT + '192_unread_badge.png', clip={'x': 0, 'y': 700, 'width': 390, 'height': 144})
    go(h1, '/chat/volny', '.msg .body >> text=V-bucks')
    h1.wait_for_selector('.tabbar a[data-tab=chat] .nbadge', state='detached')

    # ── nahlášení zprávy ──
    h1.locator('.msg:has-text("V-bucks") [data-report]').click(); h1.wait_for_selector('#f-rep')
    h1.check('#f-rep input[value=spam]'); h1.fill('#f-rep input[name=note]', 'reklama')
    h1.screenshot(path=OUT + '193_report_modal.png')
    h1.click('#f-rep button.danger'); h1.wait_for_selector('#f-rep', state='detached')
    assert sql("select count(*) from reports where status = 'open' and kind = 'chat_message'") == '1'

    # ── admin vyřeší v profilu ──
    adm = ctx(b, 'adam@test.cz')
    go(adm, '/me', '#admin-rep .rep-card')
    assert 'V-bucks' in adm.inner_text('#admin-rep') and 'Spam' in adm.inner_text('#admin-rep')
    adm.locator('#admin-rep').scroll_into_view_if_needed()
    adm.screenshot(path=OUT + '194_admin_reports.png')
    adm.click('#admin-rep [data-rdel]'); adm.wait_for_selector('#admin-rep .empty')
    assert sql("select count(*) from chat_messages where body like 'Kupte si levné%'") == '0'

    # ── upozornění v profilu ──
    go(h1, '/me', '#push-card h3')
    assert 'Upozornění na telefonu' in h1.inner_text('#push-card')
    h1.locator('#push-card').scroll_into_view_if_needed()
    h1.screenshot(path=OUT + '195_push_card.png')

    # ── smazání účtu ──
    h9 = ctx(b, 'hrac9@test.cz')
    uid = sql("select id from profiles where nick = 'Hrac9'")
    go(h9, '/me', '[data-act=delete-account]')
    h9.click('[data-act=delete-account]'); h9.wait_for_selector('#f-del')
    h9.fill('#f-del input[name=nick]', 'hrac9')
    h9.screenshot(path=OUT + '196_delete_account.png')
    h9.click('#f-del button.danger'); h9.wait_for_url(re.compile(r'#/$')); h9.wait_for_timeout(800)
    assert sql(f"select count(*) from profiles where id = '{uid}'") == '0'
    assert sql(f"select count(*) from auth.users where id = '{uid}'") == '0'

    # ── sdílení výsledků ──
    tid = sql("select id from tournaments where status = 'finished' and kind = 'tournament' limit 1")
    an = ctx(b)
    go(an, f'/t/{tid}', '[data-share]')
    an.click('[data-share]'); an.wait_for_selector('.share-img')
    an.wait_for_function("document.querySelector('.share-img').naturalWidth === 1080")
    with an.expect_download() as dl: an.click('a[download]')
    assert dl.value.suggested_filename.endswith('.png')
    an.click('.share-text summary'); assert '🏆' in an.inner_text('.share-text pre')

    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    print('EXTRAS OK')
