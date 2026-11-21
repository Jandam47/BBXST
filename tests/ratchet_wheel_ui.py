# Kolečko ratchetů v editoru decku BBXU: registrace do turnaje a přidání hráče bez telefonu (Řízení).
# Spouštět po čerstvém tests/ui-up.sh.
import re, subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

def combo(page, sel, text):
    page.click(sel + ' input'); page.fill(sel + ' input', text)
    page.wait_for_selector(sel + ' .combo-list:not([hidden]) li'); page.keyboard.press('Enter')

def login(page, email):
    page.goto(BASE + '#/login'); page.fill('input[name=email]', email); page.fill('input[name=password]', 'x')
    page.click('#f-login button'); page.wait_for_function("location.hash === '#/'"); page.wait_for_selector('.t-card')

tid = sql("select id from tournaments where name = 'Zimní Pardubice Open'")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.goto(BASE + f'#/t/{tid}'); pg.wait_for_selector('#f-reg [data-deck]')
    R = '[data-bey="0"] [data-combo="ratchet"]'
    assert pg.get_attribute(R + ' input', 'readonly') is not None, 'ratchet se nepíše, vybírá se na kolečku'
    combo(pg, '[data-bey="0"] [data-combo="blade"]', 'dran sw')
    combo(pg, '[data-bey="0"] [data-combo="bit"]', 'flat')
    pg.click(R + ' input'); pg.wait_for_selector('.rw-dial')
    assert pg.locator('.rw-specials .rw-sp').count() == 2, 'Turbo a Operate'
    # 0 zubů neexistuje? zkontroluj, že nedostupné kombinace jsou zakázané
    pg.click('.rw-k[data-t="3"]')
    dis = pg.evaluate("[...document.querySelectorAll('.rw-k.h')].filter(b => b.disabled).map(b => b.dataset.h)")
    have = sql("select string_agg(split_part(name, '-', 2), ',') from bey_parts where category = 'ratchet' and name like '3-%'").split(',')
    assert not set(dis) & set(have), (dis, have)
    pg.screenshot(path=OUT + '290_rw_dial.png')
    pg.click('.rw-k[data-h="60"]'); pg.wait_for_selector('.rw-dial', state='detached')
    assert pg.input_value(R + ' input') == '3-60'
    assert pg.inner_text('[data-bey="0"] .bey-preview') == '→ Dran Sword 3-60F', pg.inner_text('[data-bey="0"] .bey-preview')
    # znovu otevřít: předvyplněné 3-60, změna jen výšky přes Použít
    pg.click(R + ' input'); pg.wait_for_selector('.rw-k.t.on[data-t="3"]')
    pg.click('.rw-k[data-h="80"]'); pg.click('[data-rw-ok]'); pg.wait_for_selector('.rw-dial', state='detached')
    assert pg.input_value(R + ' input') == '3-80'
    # Turbo = ratchet v bitu
    pg.click(R + ' input'); pg.click('.rw-sp[data-sp="Turbo"]'); pg.wait_for_selector('.rw-dial', state='detached')
    assert pg.input_value('[data-bey="0"] [data-combo="bit"] input') == 'Turbo'
    assert pg.input_value(R + ' input') == ''
    assert pg.inner_text('[data-bey="0"] .bey-preview') == '→ Dran Sword Tr', pg.inner_text('[data-bey="0"] .bey-preview')
    assert 'Turbo' in pg.get_attribute(R + ' input', 'placeholder')
    # zpět na normální ratchet → Turbo zmizí
    pg.click(R + ' input'); pg.click('.rw-k[data-t="5"]'); pg.click('.rw-k[data-h="60"]'); pg.wait_for_selector('.rw-dial', state='detached')
    assert pg.input_value('[data-bey="0"] [data-combo="bit"] input') == '', 'normální ratchet ruší Turbo'
    # Esc zavře jen kolečko
    pg.click(R + ' input'); pg.wait_for_selector('.rw-dial'); pg.keyboard.press('Escape'); pg.wait_for_selector('.rw-dial', state='detached')
    assert pg.input_value(R + ' input') == '5-60'
    # integrovaný blade → kolečko se neotevře
    combo(pg, '[data-bey="1"] [data-combo="blade"]', 'nether')
    assert pg.is_disabled('[data-bey="1"] [data-combo="ratchet"] input')
    c.close()

    # ── Řízení: hráč bez telefonu ──
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    login(pg, 'adam@test.cz')
    pg.goto(BASE + f'#/t/{tid}/manage'); pg.wait_for_selector('[data-act=walkin]')
    pg.click('[data-act=walkin]'); pg.wait_for_selector('#f-walkin [data-deck]')
    pg.fill('#f-walkin input[name=nick]', 'Bezmobilu')
    beys = [('dran sw', '3', '60', 'flat'), ('wizard rod', '9', '60', 'ball'), ('shark ed', '1', '60', 'low flat')]
    for i, (bl, t, h, bit) in enumerate(beys):
        combo(pg, f'#f-walkin [data-bey="{i}"] [data-combo="blade"]', bl)
        pg.click(f'#f-walkin [data-bey="{i}"] [data-combo="ratchet"] input'); pg.wait_for_selector('.rw-dial')
        if i == 0: pg.screenshot(path=OUT + '291_rw_walkin.png')
        pg.click(f'.rw-k[data-t="{t}"]'); pg.click(f'.rw-k[data-h="{h}"]'); pg.wait_for_selector('.rw-dial', state='detached')
        combo(pg, f'#f-walkin [data-bey="{i}"] [data-combo="bit"]', bit)
    # Esc v kolečku nezavře okno s hráčem
    pg.click('#f-walkin [data-bey="0"] [data-combo="ratchet"] input'); pg.wait_for_selector('.rw-dial'); pg.keyboard.press('Escape')
    pg.wait_for_selector('.rw-dial', state='detached'); assert pg.locator('#f-walkin').count() == 1
    pg.click('#f-walkin > button.primary'); pg.wait_for_selector('#f-walkin', state='detached')
    deck = sql(f"select deck::text from registrations where tournament_id = '{tid}' and nick = 'Bezmobilu'")
    assert '"3-60"' in deck and '"9-60"' in deck and '"1-60"' in deck, deck
    c.close(); b.close()

if errors: print(*errors, sep='\n'); raise SystemExit(1)
print('RATCHET WHEEL OK')
