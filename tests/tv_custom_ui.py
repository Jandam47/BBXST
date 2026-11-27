# Vlastní TV rozpis (okénka): ⚙ Okna na výchozí TV → přepínače → okénka se rozmístí, obsah se vejde do okna,
# ✎ Upravit = přesun / změna velikosti / zavření, video z Twitche se při překreslení nenačítá znovu,
# rozložení se pamatuje (localStorage) a „Výchozí TV rozpis“ vrátí původní TV. Po čerstvém tests/ui-up.sh.
import json, re, subprocess
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

def fits(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('.tvc-win:not(.k-video)')].map(w => {
      const b = w.querySelector('.tvc-body'), i = w.querySelector('.tvc-in')
      const s = parseFloat((i.style.transform.match(/scale\\(([\\d.]+)\\)/) || [0, 0])[1])
      const dy = parseFloat((i.style.transform.match(/translateY\\(([\\d.]+)px\\)/) || [0, 0])[1])
      return { k: w.dataset.win, s, dy, sh: i.scrollHeight, bh: b.clientHeight, ok: s > 0 && dy + i.scrollHeight * s <= b.clientHeight + 1 && i.scrollWidth <= i.clientWidth + 1 && i.offsetWidth * s <= b.clientWidth + 2 }
    })""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 1600, 'height': 900}, service_workers='block')
    c.route(re.compile(r'https://player\.twitch\.tv/.*'), lambda r: r.fulfill(status=200, content_type='text/html',
            body='<body style="margin:0;background:#6441a5;color:#fff;font:28px sans-serif;display:grid;place-items:center;height:100vh">TWITCH</body>'))
    pg = c.new_page()
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|Failed to load resource', m.text) and errors.append(m.text))

    # výchozí TV + tlačítko ⚙ Okna
    pg.goto(BASE + f'#/t/{tid}/tv'); pg.wait_for_selector('.tv-arenas')
    pg.click('[data-tvcust]'); pg.wait_for_selector('.modal .tvc-sw')
    assert pg.locator('.modal fieldset').count() == 3, 'Aréna 1, Aréna 2, Celý turnaj'
    pg.screenshot(path=OUT + 'tvc_customize.png')
    for k, a in [('arena', 1), ('decks', 1), ('queue', 1), ('feed', 1), ('arena', 2), ('video', 2), ('standings', 0), ('clock', 0), ('qr', 0), ('results', 0)]:
        pg.click(f'.modal input[data-k="{k}"][data-a="{a}"] + .tvc-tg')
    pg.wait_for_selector('.tvc-win[data-win="arena:1"]')        # přepnulo se na okénka hned při prvním zapnutí
    assert pg.locator('.tv-arenas').count() == 0
    pg.click('.modal [data-close]'); pg.wait_for_selector('.modal', state='detached')
    pg.wait_for_timeout(400)
    assert pg.locator('.tvc-win').count() == 10
    # po zavření se první okénka rozmístila do mřížky (žádné se nepřekrývá)
    rects = pg.evaluate("[...document.querySelectorAll('.tvc-win')].map(w => { const r = w.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] })")
    for i, r1 in enumerate(rects):
        for r2 in rects[i + 1:]:
            assert r1[2] <= r2[0] + 1 or r2[2] <= r1[0] + 1 or r1[3] <= r2[1] + 1 or r2[3] <= r1[1] + 1, (r1, r2)
    f = fits(pg); assert all(x['ok'] for x in f), f
    assert pg.locator('.tvc-win[data-win="qr"] svg').count() == 1
    assert pg.locator('.tvc-win[data-win="video:2"] .tvw-novideo').count() == 1
    pg.screenshot(path=OUT + 'tvc_tiled.png')

    # video na aréně 2 → iframe; překreslení ho nenačte znovu
    sql(f"insert into live_streams (tournament_id, arena, user_id, provider, channel) values ('{tid}', 2, '{judge}', 'twitch', 'bbx_pardubice') on conflict do nothing")
    pg.wait_for_selector('.tvc-win[data-win="video:2"] iframe', timeout=15000)
    assert 'channel=bbx_pardubice' in pg.get_attribute('.tvc-win[data-win="video:2"] iframe', 'src')
    fr = pg.evaluate_handle("document.querySelector('.tvc-win[data-win=\"video:2\"] iframe')")
    pg.evaluate("window.dispatchEvent(new Event('bbx:countdown-over'))"); pg.wait_for_timeout(300)
    assert pg.evaluate("(e) => e.isConnected", fr)

    # ✎ Upravit: přesun a změna velikosti okna Pořadí
    pg.click('[data-tvedit]'); pg.wait_for_selector('.tvc.editing')
    win = '.tvc-win[data-win="standings"]'
    before = pg.evaluate(f"(() => {{ const r = document.querySelector('{win}').getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }})()")
    bar = pg.locator(f'{win} .tvc-bar').bounding_box()
    pg.mouse.move(bar['x'] + 40, bar['y'] + 10); pg.mouse.down(); pg.mouse.move(bar['x'] - 160, bar['y'] - 60, steps=6); pg.mouse.up()
    rs = pg.locator(f'{win} .tvc-rs').bounding_box()
    pg.mouse.move(rs['x'] + 15, rs['y'] + 15); pg.mouse.down(); pg.mouse.move(rs['x'] + 215, rs['y'] + 135, steps=6); pg.mouse.up()
    after = pg.evaluate(f"(() => {{ const r = document.querySelector('{win}').getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }})()")
    assert abs(after[0] - (before[0] - 200)) < 3 and abs(after[1] - (before[1] - 70)) < 3, (before, after)
    assert abs(after[2] - (before[2] + 200)) < 3 and abs(after[3] - (before[3] + 120)) < 3, (before, after)
    saved = json.loads(pg.evaluate("localStorage.getItem('bbxu_tv_layout')"))
    sw = [w for w in saved['wins'] if w['k'] == 'standings'][0]
    assert abs(sw['w'] / 100 * 1600 - after[2]) < 3, sw
    f = fits(pg); assert all(x['ok'] for x in f), f
    pg.screenshot(path=OUT + 'tvc_editing.png')
    # ✕ zavře okno
    pg.click('.tvc-win[data-win="feed:1"] [data-tvclose]'); pg.wait_for_selector('.tvc-win[data-win="feed:1"]', state='detached')
    pg.keyboard.press('Escape'); pg.wait_for_selector('.tvc:not(.editing)')

    # rozložení se pamatuje i po obnovení stránky
    pg.reload(); pg.wait_for_selector('.tvc-win[data-win="standings"]')
    assert pg.locator('.tvc-win').count() == 9
    a2 = pg.evaluate(f"(() => {{ const r = document.querySelector('{win}').getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }})()")
    assert all(abs(x - y) < 3 for x, y in zip(a2, after)), (a2, after)
    # menší obrazovka: okna v %, obsah se znovu vejde
    pg.set_viewport_size({'width': 1280, 'height': 720}); pg.wait_for_timeout(500)
    f = fits(pg); assert all(x['ok'] for x in f), f

    # Výchozí TV rozpis → zpět na původní TV
    pg.click('[data-tvcust]'); pg.click('.modal [data-reset]')
    pg.wait_for_selector('.tv-arenas'); assert pg.locator('.tvc').count() == 0
    assert json.loads(pg.evaluate("localStorage.getItem('bbxu_tv_layout')"))['wins'] == []

    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    b.close()
print('TV CUSTOM OK')
