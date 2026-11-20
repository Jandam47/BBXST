# Proklikání BBXU v Chrome (mobil 390×844) proti lokálnímu testovacímu backendu.
import sys, re, time
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
import os; os.makedirs(OUT, exist_ok=True)
errors = []

def shot(page, name):
    page.wait_for_timeout(500)
    page.screenshot(path=OUT + name + '.png', full_page=True)

def login(page, email):
    page.goto(BASE + '#/login')
    page.fill('input[name=email]', email)
    page.fill('input[name=password]', 'x')
    page.click('#f-login button')
    page.wait_for_function("location.hash === '#/'")
    page.wait_for_selector('.t-card')

def run(only=None):
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        def ctx():
            c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
            pg = c.new_page()
            pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
            pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
            return c, pg

        # ── host ──
        c, page = ctx()
        page.goto(BASE); page.wait_for_selector('.t-card'); shot(page, '01_home_guest')
        page.click('text=Zimní Pardubice Open'); page.wait_for_selector('#f-reg [data-deck]')
        page.fill('input[name=nick]', 'Hostovic')
        def pick(bey, key, text, choose=None):
            sel = f'[data-bey="{bey}"] [data-combo="{key}"]'
            page.click(sel + ' input'); page.fill(sel + ' input', text)
            page.wait_for_selector(sel + ' .combo-list:not([hidden]) li')
            if choose: page.click(sel + f' .combo-list li >> text={choose}')
            else: page.keyboard.press('Enter')
        # bey 1: BX – psaní a Enter na první návrh; zkratka bitu
        pick(0, 'blade', 'dran sw'); pick(0, 'ratchet', '360'); pick(0, 'bit', 'GF')
        assert page.inner_text('[data-bey="0"] .bey-preview') == '→ Dran Sword 3-60GF', page.inner_text('[data-bey="0"] .bey-preview')
        # bey 2: CX s výběrem myší
        page.click('[data-bey="1"] [data-type-btn=cx]')
        pick(1, 'lock', 'wiz', 'Wizard'); pick(1, 'main', 'ar', 'Arc'); pick(1, 'assist', 'rou'); pick(1, 'ratchet', '4-55'); pick(1, 'bit', 'low o')
        # bey 3: integrovaný ratchet → pole ratchet se zamkne
        pick(2, 'blade', 'nether'); pick(2, 'bit', 'ball', 'Ball')
        assert page.is_disabled('[data-bey="2"] [data-combo="ratchet"] input')
        page.click('[data-bey="2"] [data-combo="bit"] input'); page.fill('[data-bey="2"] [data-combo="bit"] input', 'b')
        page.wait_for_selector('[data-bey="2"] .combo-list:not([hidden]) li'); shot(page, '02b_combo_open')
        page.keyboard.press('Escape'); page.fill('[data-bey="2"] [data-combo="bit"] input', 'Ball'); page.click('input[name=nick]')
        page.wait_for_timeout(300); shot(page, '02_reg_form')
        page.click('#f-reg button.primary'); page.wait_for_selector('[data-c=guest]'); shot(page, '03_guest_prompt')
        page.click('[data-c=guest]'); page.wait_for_selector('.pass'); shot(page, '04_pass_guest')
        txt = page.inner_text('.pass-beys')
        assert 'Dran Sword 3-60GF' in txt and 'Wizard Arc R4-55LO' in txt and 'Hells Nether B' in txt, txt
        page.click('text=Upravit beyblady'); page.wait_for_selector('#f-reg [data-deck]')
        assert page.input_value('[data-bey="1"] [data-combo="lock"] input') == 'Wizard'
        # neexistující díl → červené pole a chyba
        page.fill('[data-bey="0"] [data-combo="blade"] input', 'Mega Sword'); page.click('input[name=nick]'); page.wait_for_timeout(250)
        page.click('#f-reg button.primary'); page.wait_for_selector('.toast.err')
        assert page.locator('[data-bey="0"] [data-combo="blade"].bad').count() == 1
        pick(0, 'blade', 'shark', 'Shark Edge'); page.click('#f-reg button.primary'); page.wait_for_selector('.pass-beys >> text=Shark Edge 3-60GF')
        page.goto(BASE + '#/me'); page.wait_for_selector('h1'); shot(page, '05_me_guest')
        c.close()

        # ── hráč ──
        c, page = ctx()
        login(page, 'hrac1@test.cz'); shot(page, '06_home_player')
        page.click('text=Listopadový Cup'); page.wait_for_selector('.pass'); shot(page, '07_pass_running')
        page.click('.tabs >> text=Swiss'); page.wait_for_selector('.standings'); shot(page, '08_swiss')
        page.goto(BASE + '#/'); page.wait_for_selector('.t-card')
        page.click('.tabs >> text=Odehrané'); page.click('text=Pardubice Cup'); page.wait_for_selector('.tabs')
        page.click('.tabs >> text=Top cut'); page.wait_for_selector('.b-match'); shot(page, '09_bracket')
        assert page.locator('.tabs >> text=Hráči').count() == 0, 'po startu bez záložky Hráči'
        page.goto(BASE + '#/me'); page.wait_for_selector('.stats'); shot(page, '11_profile')
        page.click('text=Upravit profil'); page.wait_for_selector('#f-prof'); page.click('[data-av="🦈"]'); page.click('#f-prof button.primary')
        page.wait_for_selector('.prof-head .av >> text=🦈')
        page.goto(BASE + '#/players'); page.wait_for_selector('.list'); shot(page, '12_players')
        page.goto(BASE + '#/chat'); page.wait_for_selector('.list'); shot(page, '13_chat_rooms')
        page.click('.chat-room.test'); page.wait_for_selector('.chat-log')
        page.fill('#f-chat textarea', 'Já jedu!'); page.keyboard.press('Enter'); page.wait_for_selector('.msg.own >> text=Já jedu!'); shot(page, '14_chat_room')
        c.close()

        # ── organizátor ──
        c, page = ctx()
        login(page, 'org@test.cz')
        page.click('text=Listopadový Cup'); page.wait_for_selector('.tabs >> text=Řízení')
        page.click('.tabs >> text=Řízení'); page.wait_for_selector('text=Rozehrané'); shot(page, '15_manage_swiss')
        page.click('[data-result] >> nth=0'); page.wait_for_selector('#f-res')
        page.fill('input[name=s1]', '7'); page.fill('input[name=s2]', '4'); page.click('#f-res button'); page.wait_for_selector('#f-res', state='detached'); page.wait_for_timeout(500)
        # dohraj zbytek kola ručně
        for _ in range(8):
            if page.locator('[data-result]').count() == 0: break
            page.click('[data-result] >> nth=0'); page.wait_for_selector('#f-res')
            page.fill('input[name=s1]', '3'); page.fill('input[name=s2]', '7'); page.click('#f-res button'); page.wait_for_selector('#f-res', state='detached'); page.wait_for_timeout(500)
        page.click('[data-act=draw]'); page.wait_for_selector('[data-ok]'); shot(page, '16_draw_preview')
        page.click('[data-reroll]'); page.click('[data-ok]'); page.wait_for_selector('.standings'); shot(page, '17_round3')
        page.goto(BASE + '#/new'); page.wait_for_selector('#f-t'); shot(page, '18_new_tournament')
        page.fill('input[name=name]', 'Testovací turnaj'); page.fill('input[name=starts_at]', '2026-12-12T10:00')
        page.select_option('#top-preset', 'custom'); page.fill('input[name=top_custom]', '6')
        page.click('#f-t button.primary'); page.wait_for_selector('.t-head h1 >> text=Testovací turnaj'); shot(page, '19_new_created')
        page.goto(BASE + '#/t/' + page.evaluate("(()=>{return null})()") if False else BASE + '#/')
        c.close()

        # ── judge + TV ──
        c, page = ctx()
        login(page, 'judge@test.cz')
        page.click('text=Listopadový Cup'); page.click('.tabs >> text=Judge menu'); page.wait_for_selector('.arena-card')
        assert page.locator('[data-claim]').count() == 0, 'arény se už nezabírají'
        shot(page, '20_judge')
        page.goto(page.url.replace('/judge', '/tv')); page.wait_for_selector('.tv-arena'); page.set_viewport_size({'width': 1280, 'height': 720}); shot(page, '21_tv')
        c.close()

        # ── admin: role ──
        c, page = ctx()
        login(page, 'admin2@test.cz')
        page.goto(BASE + '#/players'); page.click('text=Hrac3'); page.wait_for_selector('.roles')
        page.on('dialog', lambda d: d.accept())
        page.check('[data-role=judge]'); page.wait_for_selector('[data-yes]'); page.click('[data-yes]'); page.wait_for_selector('.pill.role >> text=Judge'); shot(page, '22_roles')
        c.close()
        b.close()

run()
print('CONSOLE ERRORS:', len(errors))
for e in errors[:30]: print(' -', e[:300])
