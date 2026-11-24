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
    if sel.endswith('[data-combo="bit"]'):   # bit = kolečko s hledáním
        page.click(sel + ' input'); page.wait_for_selector('.bw-dial')
        page.fill('.bw-q', text); page.keyboard.press('Enter'); page.wait_for_selector('.bw-dial', state='detached'); return
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
    # ── kolečko bitů ──
    B = '[data-bey="2"] [data-combo="bit"]'
    assert pg.get_attribute(B + ' input', 'readonly') is not None, 'bit se vybírá na kolečku'
    combo(pg, '[data-bey="2"] [data-combo="blade"]', 'shark ed')
    pg.click('[data-bey="2"] [data-combo="ratchet"] input'); pg.click('.rw-k[data-t="1"]'); pg.click('.rw-k[data-h="60"]')
    pg.click(B + ' input'); pg.wait_for_selector('.bw-dial')
    nbits = int(sql("select count(*) from bey_parts where category = 'bit' and active"))
    assert pg.locator('.bw-k').count() == nbits, (pg.locator('.bw-k').count(), nbits)
    assert pg.locator('.bw-k.off').count() == 0, 'bez hledání svítí všechny'
    assert 'zkratk' in pg.inner_text('.bw-tip')
    rows = [pg.locator(f'.bw-k.r{i}').count() for i in (1, 2, 3)]
    assert sum(rows) == nbits and rows[0] < rows[1] < rows[2] and rows[0] >= 10, rows
    pg.screenshot(path=OUT + '292_bw_dial.png')
    pg.fill('.bw-q', 'g')
    lit = pg.evaluate("[...document.querySelectorAll('.bw-k:not(.off)')].map(b => b.dataset.ab)")
    assert pg.locator('.bw-k.off').count() > 20, lit
    assert 'GB' in lit and 'F' not in lit and 'G' in lit, lit
    assert pg.inner_text('.bw-best b') == 'Glide', pg.inner_text('.bw-best')
    pg.fill('.bw-q', 'lf'); pg.wait_for_timeout(300); assert pg.inner_text('.bw-best b') == 'Low Flat'
    assert pg.locator('.bw-k:not(.off)').count() == 1
    pg.screenshot(path=OUT + '293_bw_search.png')
    pg.fill('.bw-q', 'xyzq'); assert 'nic' in pg.inner_text('.bw-best')
    pg.fill('.bw-q', ''); pg.click('.bw-k[data-bit="Low Flat"]'); pg.wait_for_selector('.bw-dial', state='detached')
    assert pg.input_value(B + ' input') == 'Low Flat'
    assert pg.inner_text('[data-bey="2"] .bey-preview') == '→ Shark Edge 1-60LF', pg.inner_text('[data-bey="2"] .bey-preview')
    # znovu: aktuální bit zvýrazněný; písmeno na poli rovnou hledá; tlačítko uprostřed vezme shodu
    pg.click(B + ' input'); pg.wait_for_selector('.bw-k.on[data-bit="Low Flat"]'); pg.click('[data-bw-back]')
    pg.wait_for_selector('.bw-dial', state='detached'); assert pg.input_value(B + ' input') == 'Low Flat'
    pg.focus(B + ' input'); pg.keyboard.press('r'); pg.wait_for_selector('.bw-dial')
    assert pg.input_value('.bw-q') == 'r'
    pg.keyboard.type('a'); pg.click('[data-bw-best]'); pg.wait_for_selector('.bw-dial', state='detached')
    assert pg.input_value(B + ' input') == 'Rubber Accel'
    # Turbo z kolečka bitů → ratchet pryč
    pg.click(B + ' input'); pg.fill('.bw-q', 'tr'); pg.keyboard.press('Enter'); pg.wait_for_selector('.bw-dial', state='detached')
    assert pg.input_value(B + ' input') == 'Turbo' and pg.input_value('[data-bey="2"] [data-combo="ratchet"] input') == ''
    # Esc zavře jen kolečko
    pg.click(B + ' input'); pg.wait_for_selector('.bw-dial'); pg.keyboard.press('Escape'); pg.wait_for_selector('.bw-dial', state='detached')
    assert pg.input_value(B + ' input') == 'Turbo'
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
