# Živě – video z arény (46): judge přiřadí svůj kanál na Twitchi k aréně, divák bez přihlášení vidí
# přehrávač v kartě arény (iframe ve vrstvě nad kartou – po překreslení se nenačítá znovu),
# organizátor vysílání ukončí, admin judgovi funkci kameraman odebere. Twitch / YouTube se tu
# nenačítají (bez sítě) – kontroluje se adresa přehrávače a jeho poloha. Po čerstvém tests/ui-up.sh.
import re, subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    lines = [l for l in out.splitlines() if l.strip()]
    return lines[-1].strip() if lines else ''

tid = sql("select id from tournaments where name = 'Listopadový Cup'")
sql(f"update tournaments set arena_count = 2 where id = '{tid}'")
judge = sql("select id from profiles where nick = 'Judge'")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def ctx(email=None, w=390, h=844):
        c = b.new_context(viewport={'width': w, 'height': h}, service_workers='block')
        c.route(re.compile(r'https://(player\.twitch\.tv|www\.youtube-nocookie\.com)/.*'),
                lambda route: route.fulfill(status=200, content_type='text/html', body='<body style="margin:0;background:#6441a5;color:#fff;font:20px sans-serif;display:grid;place-items:center;height:100vh">PŘEHRÁVAČ</body>'))
        pg = c.new_page()
        pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|Failed to load resource', m.text) and errors.append(m.text))
        if email:
            pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
            pg.click('#f-login button'); pg.wait_for_selector('.t-card')
        return pg

    # hráč bez funkce tlačítko Vysílat nemá
    h = ctx('hrac1@test.cz')
    h.goto(BASE + f'#/t/{tid}/live'); h.wait_for_selector('.lv-arena'); h.wait_for_timeout(800)
    assert h.locator('[data-cast]').count() == 0

    # judge: Vysílat → kanál → aréna 1
    j = ctx('judge@test.cz')
    j.goto(BASE + f'#/t/{tid}/live'); j.wait_for_selector('[data-cast]')
    j.click('[data-cast]'); j.wait_for_selector('[data-cast-arena="1"]')
    j.click('[data-cast-arena="1"]'); j.wait_for_selector('.toast')       # bez kanálu chyba
    assert sql(f"select count(*) from live_streams where tournament_id = '{tid}'") == '0'
    j.fill('#cast-url', 'example.com/nic'); j.click('[data-cast-arena="1"]')
    j.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Twitchi'))")
    j.fill('#cast-url', 'https://www.twitch.tv/BBX_Pardubice'); j.screenshot(path=OUT + 'lv_cast_pick.png')
    j.click('[data-cast-arena="1"]'); j.wait_for_selector('.modal', state='detached')
    j.wait_for_selector('[data-cast]:has-text("Vysíláš arénu 1")')
    assert sql(f"select provider || ':' || channel from live_streams where tournament_id = '{tid}' and arena = 1") == 'twitch:bbx_pardubice'

    # divák bez přihlášení (PC): přehrávač nad kartou arény 1
    v = ctx(None, 1280, 800)
    v.goto(BASE + f'#/t/{tid}/live'); v.wait_for_selector('.lv-arena[data-arena="1"] .lv-vbox')
    v.wait_for_selector('.lv-vfloat iframe')
    src = v.get_attribute('.lv-vfloat iframe', 'src')
    assert src.startswith('https://player.twitch.tv/?channel=bbx_pardubice&parent=localhost'), src
    def placed():
        r1 = v.evaluate("(() => { const r = document.querySelector('.lv-arena[data-arena=\"1\"] .lv-vbox').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round) })()")
        r2 = v.evaluate("(() => { const r = document.querySelector('.lv-vfloat').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round) })()")
        return r1, r2
    r1, r2 = placed(); assert r1 == r2 and r1[2] > 200, (r1, r2)
    assert 'Judge' in v.inner_text('.lv-arena[data-arena="1"] .lv-vcap')
    assert v.locator('.lv-arena[data-arena="1"] [data-vstop]').count() == 0, 'divák ✕ nemá'
    v.wait_for_timeout(600); v.screenshot(path=OUT + 'lv_viewer.png')
    # překreslení (nová data) přehrávač nenačte znovu, po scrollu sedí na místě
    f1 = v.evaluate_handle("document.querySelector('.lv-vfloat iframe')")
    v.evaluate("window.dispatchEvent(new Event('bbx:countdown-over'))"); v.wait_for_timeout(400)
    assert v.evaluate("(e) => e.isConnected", f1), 'iframe přežil překreslení'
    v.mouse.wheel(0, 300); v.wait_for_timeout(300)
    r1, r2 = placed(); assert r1 == r2, (r1, r2)
    # Video vyp / zap
    v.click('[data-video]'); v.wait_for_selector('.lv-voff')
    assert v.locator('.lv-vfloat').count() == 0
    v.click('.lv-voff'); v.wait_for_selector('.lv-vfloat iframe')

    # mobil na výšku: divák vidí přehrávač v kartě
    m = ctx(None, 390, 844)
    m.goto(BASE + f'#/t/{tid}/live'); m.wait_for_selector('.lv-vfloat iframe'); m.wait_for_timeout(600)
    m.screenshot(path=OUT + 'lv_viewer_mobile.png')

    # organizátor vysílání ukončí ✕
    o = ctx('org@test.cz', 1280, 800)
    o.goto(BASE + f'#/t/{tid}/live'); o.wait_for_selector('.lv-arena[data-arena="1"] [data-vstop]')
    o.click('.lv-arena[data-arena="1"] [data-vstop]'); o.click('.modal [data-yes]')
    o.wait_for_function("!document.querySelector('.lv-vbox')")
    assert o.locator('.lv-vfloat').count() == 0
    assert sql(f"select count(*) from live_streams where tournament_id = '{tid}'") == '0'
    v.wait_for_timeout(10500)
    assert v.locator('.lv-vfloat').count() == 0, 'divákovi video zmizí (polling 10 s)'

    # kameraman: znovu vysílat (kanál si BBXU pamatuje) a sám ukončit
    j.reload(); j.wait_for_selector('[data-cast]')
    j.click('[data-cast]'); assert j.input_value('#cast-url') == 'https://www.twitch.tv/BBX_Pardubice'
    j.click('[data-cast-arena="2"]'); j.wait_for_selector('[data-cast]:has-text("Vysíláš arénu 2")')
    j.click('[data-cast]'); j.click('.modal [data-stop]'); j.wait_for_selector('[data-cast]:has-text("Vysílat")')
    assert sql(f"select count(*) from live_streams where tournament_id = '{tid}'") == '0'

    # admin odebere judgovi funkci → tlačítko zmizí
    sql(f"update profiles set camera = false where id = '{judge}'")
    j.reload(); j.wait_for_selector('.lv-arena'); j.wait_for_timeout(1000)
    assert j.locator('[data-cast]').count() == 0
    sql(f"update profiles set camera = null where id = '{judge}'")

    # odchod ze Živě uklidí vrstvu s přehrávači
    sql(f"insert into live_streams (tournament_id, arena, user_id, provider, channel) values ('{tid}', 1, '{judge}', 'youtube', 'dQw4w9WgXcQ')")
    v.reload(); v.wait_for_selector('.lv-vfloat iframe')
    assert 'youtube-nocookie.com/embed/dQw4w9WgXcQ' in v.get_attribute('.lv-vfloat iframe', 'src')
    v.goto(BASE + f'#/t/{tid}'); v.wait_for_timeout(600)
    assert v.locator('.lv-vlayer').count() == 0

    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    b.close()
print('LIVE VIDEO OK')
