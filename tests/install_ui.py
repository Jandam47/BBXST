# Instalace BBXU a BBXST z profilu (oddělené manifesty, karta v profilu, výzva na bbxst.html?install=1).
# Spouštět po tests/ui-up.sh.
import re, json
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
FAKE = """() => { window.__bip = { prompt() { window.__prompted = true }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  dispatchEvent(new Event('bbx:installable')) }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))

    # manifesty mají oddělenou platnost
    m1 = json.loads(pg.request.get(BASE + 'manifest.json').text()); m2 = json.loads(pg.request.get(BASE + 'bbxst.webmanifest').text())
    assert m1['scope'] == './index.html' and m2['scope'] == './bbxst.html'
    # holá adresa složky → index.html (hash zůstane)
    pg.goto(BASE + '#/help'); pg.wait_for_selector('.help-nav')
    assert pg.url.endswith('/index.html#/help'), pg.url

    # profil: karta instalace
    pg.goto(BASE + 'index.html#/login'); pg.fill('input[name=email]', 'hrac1@test.cz'); pg.fill('input[name=password]', 'x')
    pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    pg.goto(BASE + 'index.html#/me'); pg.wait_for_selector('.prof-gear')
    pg.click('.prof-gear'); pg.click('.cw-sec[aria-label^="Aplikace"]'); pg.click('.cw-sec[aria-label^="Aplikace na plochu"]')
    pg.wait_for_selector('#inst-card .inst-row')
    assert pg.locator('[data-inst=bbxu-help]').count() == 1
    pg.click('[data-inst=bbxu-help]'); assert 'Nainstalovat aplikaci' in pg.inner_text('#inst-hint')
    pg.evaluate(FAKE)
    pg.wait_for_selector('[data-inst=bbxu]')
    pg.locator('#inst-card').scroll_into_view_if_needed()
    pg.screenshot(path=OUT + '230_install_card.png')
    pg.click('[data-inst=bbxu]'); pg.wait_for_selector('#inst-card .pill.ok')
    assert pg.evaluate('window.__prompted') is True
    assert pg.get_attribute('[data-inst=bbxst]', 'href') == 'bbxst.html?install=1'

    # BBXST: výzva k instalaci jen s ?install=1
    st = c.new_page(); st.set_viewport_size({'width': 844, 'height': 390})
    st.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    st.goto(BASE + 'bbxst.html'); st.wait_for_timeout(800)
    assert st.locator('#instOverlay').count() == 0
    st.goto(BASE + 'bbxst.html?install=1'); st.wait_for_selector('#instOverlay')
    assert 'install' not in st.url
    st.wait_for_function("() => document.querySelector('#instMsg').textContent.includes('menu')", timeout=5000)
    st.screenshot(path=OUT + '231_bbxst_install_help.png')
    st.goto(BASE + 'bbxst.html?install=1'); st.wait_for_selector('#instOverlay')
    st.evaluate(FAKE)
    st.wait_for_function("() => document.querySelector('#instGo').style.display !== 'none'")
    st.screenshot(path=OUT + '232_bbxst_install.png')
    st.click('#instGo'); st.wait_for_function("() => document.querySelector('#instMsg').textContent.includes('Hotovo')")
    st.click('#instNo'); assert st.locator('#instOverlay').count() == 0
    b.close()

if errors:
    print('CHYBY:', *errors, sep='\n  '); raise SystemExit(1)
print('INSTALL UI OK')
