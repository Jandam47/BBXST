# Prezence (sken vstupenky z obrázku, ruční odškrtnutí, odebrání chybějících při startu), hlášení chyb
# z BBXU i BBXST, chyby a záloha v profilu admina, nápověda, vzájemná bilance.
# Spouštět po čerstvém tests/ui-up.sh.
import re, subprocess, os, json, base64
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
os.makedirs(OUT, exist_ok=True)
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

def ctx(b, email=None, w=390, h=844):
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block', accept_downloads=True)
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404|Testovací chyba', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: 'Testovací chyba' not in str(e) and errors.append('PAGEERROR ' + str(e)))
    if email:
        pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
        pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    else:
        pg.goto(BASE + '#/'); pg.wait_for_timeout(600)
    return pg

def go(page, h, sel):
    page.goto(BASE + '#' + h); page.wait_for_selector(sel)

tid = sql("select id from tournaments where name = 'Zimní Pardubice Open'")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])

    # ── vstupenka bez prezence ──
    h1 = ctx(b, 'hrac1@test.cz')
    go(h1, f'/t/{tid}', '.pass .pass-checkin')
    assert 'ukaž QR' in h1.inner_text('.pass-checkin')
    tok = sql(f"select qr_token from registrations where tournament_id = '{tid}' and nick = 'Hrac1'")

    # ── organizátor: Řízení bez karty prezence, start blokovaný ──
    org = ctx(b, 'org@test.cz')
    go(org, f'/t/{tid}/manage', '[data-act=start]')
    assert org.locator('.ci-card').count() == 0
    assert org.is_disabled('[data-act=start]') and org.locator('[data-act=start-unchecked]').count() == 1
    assert 'Zkontrolováno 0 z 5' in org.inner_text('.notice.warn')

    # ── Hráči: panel kontroly, sken vstupenky z obrázku → kontrola hráče ──
    go(org, f'/t/{tid}/players', '.rc-panel')
    assert org.locator('.li.rc-wait').count() == 5
    org.screenshot(path=OUT + '200_check_list.png')
    png = org.evaluate("""async (txt) => { const { qrPng } = await import('./js/ui.js'); return qrPng(txt, 8) }""", f'BBXU1|{tid}|{tok}')
    data = base64.b64decode(png.split(',', 1)[1])
    # vstupenka na jiný turnaj
    other = sql("select id from tournaments where name = 'Listopadový Cup'")
    png2 = org.evaluate("""async (txt) => { const { qrPng } = await import('./js/ui.js'); return qrPng(txt, 8) }""", f'BBXU1|{other}|{tok}')
    org.click('[data-rc=scan]'); org.wait_for_selector('#ci-reader'); org.wait_for_timeout(1500)
    org.set_input_files('#ci-file', files=[{'name': 'q2.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(png2.split(',', 1)[1])}])
    org.wait_for_selector('.ci-last.err >> text=jiný turnaj')
    org.wait_for_timeout(300)
    org.set_input_files('#ci-file', files=[{'name': 'qr.png', 'mimeType': 'image/png', 'buffer': data}])
    org.wait_for_selector('.rc-head:has-text("Hrac1")')
    assert org.locator('.rc-bey').count() == 3 and org.is_disabled('[data-rc=ok]')
    org.locator('.rc-bey').nth(0).click(); org.locator('.rc-bey').nth(1).click()
    assert org.is_disabled('[data-rc=ok]'), 'potvrdit jde až po všech třech'
    org.locator('.rc-bey').nth(2).click()
    org.screenshot(path=OUT + '201_check_modal.png')
    org.click('[data-rc=ok]'); org.wait_for_selector('.li.rc-ok:has-text("Hrac1")')

    # ── ručně z listu: Hrac2 zkontrolovat, Hrac3 vyřadit ──
    org.locator('.li.rc-row:has-text("Hrac2")').click(); org.wait_for_selector('.rc-head:has-text("Hrac2")')
    for i in range(3): org.locator('.rc-bey').nth(i).click()
    org.click('[data-rc=ok]'); org.wait_for_selector('.li.rc-ok:has-text("Hrac2")')
    org.locator('.li.rc-row:has-text("Hrac3")').click(); org.wait_for_selector('.rc-head:has-text("Hrac3")')
    org.click('[data-rc=drop]'); org.wait_for_selector('.li.rc-out:has-text("Hrac3")')
    # ⋯ menu jde pořád otevřít (dlouhé beyblady ho už nevytlačí)
    org.locator('.li:has-text("Hrac4") [data-menu]').click(); org.wait_for_selector('.modal h2:has-text("Hrac4")')
    org.click('.modal [data-close]'); org.wait_for_selector('.modal', state='detached')
    assert sql(f"select count(*) from registrations where tournament_id = '{tid}' and checked_in_at is not null") == '2'
    assert 'zkontrolováno 2' in org.inner_text('.rc-legend') and 'vyřazeno 1' in org.inner_text('.rc-legend')
    org.screenshot(path=OUT + '202_check_states.png')

    # ── vstupenka hráče ukáže kontrolu ──
    h1.reload(); h1.wait_for_selector('.pass-checkin.on')
    h1.locator('.pass').screenshot(path=OUT + '203_ticket_checkin.png')

    # ── start bez kontroly (Hrac4, Hrac5 nezkontrolovaní) ──
    go(org, f'/t/{tid}/manage', '[data-act=start-unchecked]')
    assert org.is_disabled('[data-act=start]')
    org.locator('[data-act=start-unchecked]').scroll_into_view_if_needed()
    org.screenshot(path=OUT + '204_start_unchecked.png')
    org.click('[data-act=start-unchecked]'); org.wait_for_selector('.modal [data-yes]')
    assert 'bez kontroly' in org.inner_text('.modal')
    org.click('.modal [data-yes]')
    org.wait_for_selector('.modal h2 >> text=1. kolo')
    assert 'Hrac3' not in org.inner_text('.modal'), 'vyřazený hráč se nepáruje'
    org.click('.modal button.primary')
    org.wait_for_function("() => !document.querySelector('.modal')")
    assert sql(f"select status from tournaments where id = '{tid}'") == 'swiss'
    assert sql(f"select count(*) from matches where tournament_id = '{tid}'") == '2', 'čtyři hráči = 2 zápasy'

    # ── hlášení chyb ──
    h1.evaluate("setTimeout(() => { throw new Error('Testovací chyba BBXU') })")
    h1.wait_for_timeout(1200)
    assert sql("select count(*) from client_errors where app = 'bbxu' and message like '%Testovací chyba BBXU%'") == '1'
    st = ctx(b, None, 844, 390)
    st.goto(BASE + 'bbxst.html'); st.wait_for_timeout(1500)
    st.evaluate("setTimeout(() => { throw new Error('Testovací chyba BBXST') })")
    st.evaluate("() => { Promise.reject(new Error('Testovací chyba BBXST async')); return 1 }")
    st.wait_for_timeout(1500)
    assert sql("select count(*) from client_errors where app = 'bbxst'") == '2', sql("select string_agg(message, ' | ') from client_errors")

    # ── admin: chyby + záloha ──
    adm = ctx(b, 'adam@test.cz')
    adm.wait_for_selector('.banner-call.backup')
    adm.screenshot(path=OUT + '205_backup_banner.png', clip={'x': 0, 'y': 0, 'width': 390, 'height': 300})
    adm.click('.banner-call.backup'); adm.wait_for_selector('#admin-bk .backup-card.due')   # banner → rovnou záloha
    adm.click('.modal [data-close]'); adm.wait_for_selector('.admin-strip')
    assert 'chyb' in adm.inner_text('.admin-strip') and 'záloh' in adm.inner_text('.admin-strip')
    adm.click('.admin-strip'); adm.wait_for_selector('.cw-overlay .cw-sec')
    adm.dispatch_event('.cw-sec[aria-label^="Chyby"]', 'click'); adm.wait_for_selector('#admin-err .err-row')
    assert 'Testovací chyba BBXST' in adm.inner_text('#admin-err') and 'BBXST' in adm.inner_text('#admin-err')
    adm.screenshot(path=OUT + '206_admin_errors.png')
    adm.locator('#admin-err [data-eok]').first.click()
    adm.wait_for_function("() => document.querySelectorAll('#admin-err .err-row').length === 2")
    adm.click('.modal [data-close]')
    adm.click('.prof-gear'); adm.dispatch_event('.cw-sec[aria-label^="Správa"]', 'click'); adm.dispatch_event('.cw-sec[aria-label^="Záloha"]', 'click')
    adm.wait_for_selector('#admin-bk .backup-card.due')
    adm.screenshot(path=OUT + '207_backup_card.png')
    with adm.expect_download() as dl:
        adm.click('#admin-bk [data-backup]')
    path = dl.value.path()
    bk = json.load(open(path))
    assert bk['app'] == 'BBXU' and any(t['id'] == tid for t in bk['tables']['tournaments'])
    assert 'bbx_settings' not in bk['tables']
    adm.wait_for_selector('#admin-bk .backup-card:not(.due)')
    go(adm, '/', '.t-card')
    adm.wait_for_timeout(500)
    assert not adm.is_visible('.banner-call.backup'), 'po záloze banner zmizí'

    # ── nápověda ──
    h1.click('.help-btn') if h1.url.endswith('#/') else go(h1, '/', '.help-btn')
    go(h1, '/', '.help-btn'); h1.click('.help-btn'); h1.wait_for_selector('.help-nav')
    h1.screenshot(path=OUT + '208_help.png')
    h1.click('.help-nav [data-k=points]'); h1.wait_for_selector('#h-points[open] .help-pts')
    h1.wait_for_timeout(500)
    h1.screenshot(path=OUT + '209_help_points.png')
    go(h1, '/help?k=judge', '#h-judge[open]')
    assert 'PASS JUDGE' in h1.inner_text('#h-judge')

    # ── vzájemná bilance ──
    h3 = ctx(b, 'hrac3@test.cz')
    u1 = sql("select id from profiles where nick = 'Hrac1'")
    go(h3, f'/p/{u1}', '.h2h')
    w, l = sql(f"""select count(*) filter (where w.user_id = (select id from profiles where nick='Hrac3')) || ':' || count(*) filter (where w.user_id = '{u1}')
        from matches m join registrations a on a.id = m.p1_reg join registrations c on c.id = m.p2_reg join registrations w on w.id = m.winner_reg
        where m.status = 'done' and not m.is_bye and a.nick in ('Hrac1','Hrac3') and c.nick in ('Hrac1','Hrac3')""").split(':')
    txt = h3.inner_text('.h2h-score')
    assert txt.startswith(f'{w}') and f':{l}' in txt.replace('\n', ''), (txt, w, l)
    assert h3.locator('.h2h-opp.is-me').count() == 1
    h3.locator('.h2h').scroll_into_view_if_needed()
    h3.screenshot(path=OUT + '210_h2h.png')
    h3.locator('.h2h-opp').first.scroll_into_view_if_needed()
    h3.screenshot(path=OUT + '211_h2h_opponents.png')

    b.close()

if errors:
    print('CHYBY V KONZOLI:', *errors, sep='\n  ')
    raise SystemExit(1)
print('checkin_ui OK')
