# „Založ akci“: kolečko podle práv, meeting osobně / online s viditelností, předvolby editoru.
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

def labels(pg):
    return [x.split(' – ')[0] for x in pg.eval_on_selector_all('.cw-sec', 'els => els.map(e => e.getAttribute("aria-label"))')]

sql("insert into leagues (name) values ('Pardubická liga') on conflict do nothing")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # hráč bez práv tlačítko nemá
    h1 = ctx(b, 'hrac1@test.cz')
    assert h1.locator('[data-act=create]').count() == 0

    # organizátor: Casual, Fashion, Turnaje
    org = ctx(b, 'org@test.cz')
    org.click('[data-act=create]'); org.wait_for_selector('.cw-wheel')
    assert labels(org) == ['Casual', 'Fashion', 'Turnaje'], labels(org)
    org.wait_for_timeout(300); org.screenshot(path=OUT + '240_wheel_root.png')
    org.click('.cw-sec[aria-label^="Casual"]'); org.wait_for_function("() => document.querySelector('.cw-title').textContent === 'Casual'")
    assert labels(org) == ['Casual trénink', 'Meeting'], labels(org)   # Org nevede komunitu → trénink rovnou casual
    org.wait_for_timeout(300); org.screenshot(path=OUT + '241_wheel_casual.png')
    org.click('.cw-center')                                    # zpět
    org.wait_for_function("() => document.querySelector('.cw-title').textContent === 'Co chceš založit?'")
    org.click('.cw-sec[aria-label^="Turnaje"]'); org.wait_for_function("() => document.querySelector('.cw-title').textContent === 'Turnaje'")
    assert labels(org) == ['Deathmatch', 'Klasika 3v3'], 'Org nemá ligu'
    org.click('.cw-sec[aria-label="Deathmatch"]'); org.wait_for_selector('#f-t')
    assert org.inner_text('h1') == 'Nový turnaj · Deathmatch'
    assert org.get_attribute('input[type=hidden][name=format]', 'value') == 'deathmatch' and org.locator('#tc-card').is_hidden()
    assert org.locator('input[type=radio][name=format]').count() == 0 and org.locator('.lg-pick').count() == 0, 'formát se už nepřepíná'
    org.locator('.format-fixed').scroll_into_view_if_needed(); org.screenshot(path=OUT + '246_format_fixed.png')

    # meeting online jen pro organizátory
    org.goto(BASE + '#/'); org.wait_for_selector('[data-act=create]')
    org.click('[data-act=create]'); org.click('.cw-sec[aria-label^="Casual"]'); org.click('.cw-sec[aria-label^="Meeting"]')
    org.wait_for_function("() => document.querySelector('.cw-title').textContent.includes('Meeting')")
    assert labels(org) == ['Meeting osobně', 'Meeting online']
    org.wait_for_timeout(300); org.screenshot(path=OUT + '242_wheel_meeting.png')
    org.click('.cw-sec[aria-label="Meeting online"]'); org.wait_for_selector('#f-meet')
    assert org.inner_text('h1') == 'Nový meeting · online' and 'Odkaz' in org.inner_text('#f-loc')
    assert org.locator('#f-max').is_hidden() and org.locator('input[type=radio][name=event_type]').count() == 0
    org.fill('[name=name]', 'Porada organizátorů')
    org.fill('[name=starts_at]', '2026-12-03T19:00')
    org.fill('[name=location]', 'discord.gg/bbx')
    org.click('.seg-opt:has-text("Organizátoři")')
    org.screenshot(path=OUT + '243_meeting_form.png', full_page=True)
    assert org.eval_on_selector('[name=location]', 'e => e.checkValidity()') is False, 'odkaz bez https neprojde'
    org.fill('[name=location]', 'https://discord.gg/bbx')
    org.click('#f-t button.primary.block'); org.wait_for_selector('.t-head .meet-link')
    assert 'Jen pro organizátory' in org.inner_text('.t-head') and 'Meeting · online' in org.inner_text('.t-head')
    mid = sql("select id from tournaments where name = 'Porada organizátorů'")
    assert sql(f"select event_type || '/' || meeting_mode || '/' || visibility from tournaments where id = '{mid}'") == 'meeting/online/staff'
    org.screenshot(path=OUT + '244_meeting_detail.png', clip={'x': 0, 'y': 0, 'width': 390, 'height': 520})
    org.goto(BASE + '#/'); org.wait_for_selector('.t-card:has-text("Porada organizátorů") .vis-tag')

    # hráč skrytý meeting nevidí
    h1.goto(BASE + '#/'); h1.reload(); h1.wait_for_selector('.t-card')
    h1.click('.tabs [data-f=all]')
    assert 'Porada organizátorů' not in h1.inner_text('#t-list')
    h1.goto(BASE + f'#/t/{mid}'); h1.wait_for_timeout(1200)
    assert h1.locator('.t-head').count() == 0

    # hlavní admin: 3v3 liga
    adm = ctx(b, 'adam@test.cz')
    adm.click('[data-act=create]'); adm.click('.cw-sec[aria-label^="Turnaje"]')
    adm.wait_for_function("() => document.querySelector('.cw-title').textContent === 'Turnaje'")
    assert labels(adm)[:2] == ['Deathmatch', 'Klasika 3v3'] and labels(adm)[2].startswith('3v3 liga'), labels(adm)
    adm.wait_for_timeout(300); adm.screenshot(path=OUT + '245_wheel_tourney.png')
    assert adm.get_attribute('.cw-sec:nth-of-type(3)', 'aria-label') == '3v3 liga · Pardubická liga', 'jediná liga = rovnou ona'
    sql("insert into leagues (name) values ('Hradecká liga') on conflict do nothing")
    adm.goto(BASE + '#/players'); adm.goto(BASE + '#/'); adm.wait_for_selector('[data-act=create]')
    adm.click('[data-act=create]'); adm.click('.cw-sec[aria-label^="Turnaje"]'); adm.click('.cw-sec[aria-label^="3v3 liga"]')
    adm.wait_for_function("() => document.querySelector('.cw-title').textContent.includes('3v3 liga')")
    assert labels(adm) == ['Hradecká liga', 'Pardubická liga'], labels(adm)
    adm.click('.cw-sec[aria-label="Pardubická liga"]'); adm.wait_for_selector('.format-fixed')
    lid = sql("select id from leagues where name = 'Pardubická liga'")
    assert adm.get_attribute('input[type=hidden][name=league_id]', 'value') == lid and adm.inner_text('h1') == 'Nový ligový turnaj'
    assert 'Pardubická liga' in adm.inner_text('.format-fixed')
    adm.fill('[name=name]', 'Liga kolo 1'); adm.fill('[name=starts_at]', '2026-12-06T10:00')
    adm.select_option('#f-t [name=region]', 'Pardubický')
    adm.click('#f-t button.primary.block'); adm.wait_for_selector('.t-head .lg-tag')
    assert sql("select format || '/' || (league_id = '" + lid + "') from tournaments where name = 'Liga kolo 1'") == 'swiss/true'
    # Esc zavře kolečko
    adm.goto(BASE + '#/'); adm.wait_for_selector('[data-act=create]')
    adm.click('[data-act=create]'); adm.wait_for_selector('.cw-overlay')
    adm.keyboard.press('Escape'); assert adm.locator('.cw-overlay').count() == 0
    b.close()

if errors:
    print('CHYBY V KONZOLI:', *errors, sep='\n  '); raise SystemExit(1)
print('CREATE WHEEL UI OK')
