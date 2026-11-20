# Celý zkušební turnaj přes testovací nástroje: 16 hráčů → 4 kola swiss → top 4 → ukončení.
import re
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8080/'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block').new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.goto(BASE + '#/login'); pg.fill('input[name=email]', 'adam@test.cz'); pg.fill('input[name=password]', 'x')
    pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    pg.goto(BASE + '#/new'); pg.wait_for_selector('#f-t')
    pg.fill('input[name=name]', 'Zkušební turnaj 16'); pg.fill('input[name=starts_at]', '2026-12-01T10:00')
    pg.select_option('#top-preset', '4'); pg.fill('input[name=arena_count]', '4')
    pg.click('#f-t button.primary'); pg.wait_for_selector('.tabs >> text=Řízení')
    pg.click('.tabs >> text=Řízení'); pg.wait_for_selector('summary >> text=Testovací')
    pg.click('summary >> text=Testovací'); pg.click('[data-act=test-players]')
    pg.wait_for_selector('.tabs >> text=Hráči (16)', timeout=20000)
    pg.screenshot(path='/tmp/shots/40_test_players.png', full_page=True)
    pg.click('[data-act=start]'); pg.click('[data-yes]'); pg.wait_for_selector('[data-ok]')
    pg.click('[data-ok]'); pg.wait_for_selector('.standings')
    for rnd in range(1, 5):
        pg.click('.tabs >> text=Řízení'); pg.wait_for_selector('summary >> text=Testovací')
        pg.click('summary >> text=Testovací'); pg.click('[data-act=test-play]'); pg.click('[data-yes]')
        pg.wait_for_selector('text=Dohráno', timeout=20000); pg.wait_for_timeout(800)
        if rnd < 4:
            pg.click('[data-act=draw]'); pg.wait_for_selector('[data-ok]'); pg.click('[data-ok]'); pg.wait_for_selector('.standings')
    pg.wait_for_selector('[data-act=topcut]'); pg.screenshot(path='/tmp/shots/41_before_topcut.png', full_page=True)
    pg.click('[data-act=topcut]'); pg.click('[data-yes]'); pg.wait_for_selector('.b-match')
    for _ in range(8):
        pg.click('.tabs >> text=Řízení'); pg.wait_for_selector('summary >> text=Testovací')
        if pg.locator('[data-act=finish]').count(): break
        pg.click('summary >> text=Testovací')
        if pg.is_disabled('[data-act=test-play]'): break
        pg.click('[data-act=test-play]'); pg.click('[data-yes]'); pg.wait_for_selector('text=Dohráno', timeout=20000); pg.wait_for_timeout(800)
    pg.click('[data-act=finish]'); pg.wait_for_selector('[data-ok]'); pg.click('[data-ok]')
    pg.wait_for_selector('[data-chat=closed]'); pg.screenshot(path='/tmp/shots/41_finish_chat.png')
    pg.click('[data-chat=closed]'); pg.wait_for_selector('[data-chat]', state='detached')
    pg.wait_for_selector('.notice >> text=ukončený'); pg.click('.tabs >> text=Top cut'); pg.wait_for_selector('.place.p1')
    pg.screenshot(path='/tmp/shots/42_finished.png', full_page=True)
    print('podium:', pg.inner_text('.list').replace('\n', ' | '))
    b.close()
print('ERRORS', errors)
