# BBXST – Battle Pass: tahací tlačítko, připojení (mock Web Bluetooth), síla odpalu nad +3, statistika, odpojení
# Bez DB: statický server, Supabase zablokovaný.
from playwright.sync_api import sync_playwright
import http.server, threading, functools, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
MOCK = r"""
(() => {
  let vals = [6198, 5891, 7042], total = 240
  const data = new EventTarget(); data.uuid = '55c4f002-f8eb-11ec-b939-0242ac120002'
  const emit = (arr) => { data.value = new DataView(new Uint8Array(arr).buffer); data.dispatchEvent(new Event('characteristicvaluechanged')) }
  const header = () => emit([0xa0,0x3a,0,4,129,0,0,0xe9,0x6c,total & 255,total >> 8,0x64,0x4c,4,0x51,0xc4,0xda])
  const pages = () => { const d = new Array(128).fill(0); vals.slice(-50).forEach((x,i)=>{ d[2*i]=x&255; d[2*i+1]=x>>8 })
    d[127] = d.slice(0,127).reduce((a,b)=>a+b,0) & 255; for (let i = 0; i < 8; i++) emit([0xb0+i, ...d.slice(16*i,16*i+16)]) }
  data.startNotifications = async () => data
  const cmd = { uuid: '55c4f001-f8eb-11ec-b939-0242ac120002', writeValueWithoutResponse: async (v) => { window.__cmds = (window.__cmds||[]).concat(v[0]); if (v[0] === 0x51) header(); if (v[0] === 0x74) pages() } }
  const svc = { getCharacteristic: async (u) => u.startsWith('55c4f002') ? data : cmd }
  const dev = new EventTarget(); dev.name = 'BEYBLADE_TOOL01'
  dev.gatt = { connect: async () => ({ getPrimaryService: async () => svc }), disconnect: () => dev.dispatchEvent(new Event('gattserverdisconnected')) }
  window.__launch = (rpm) => { total++; vals.push(rpm); header(); pages() }
  Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async (o) => { window.__filters = o.filters; return dev } } })
})()
"""
def drag(pg, sel, dx, dy):
    b = pg.locator(sel).bounding_box(); x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + dx / 2, y + dy / 2); pg.mouse.move(x + dx, y + dy); pg.mouse.up()
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    ctx = br.new_context(viewport={'width': 844, 'height': 390}, service_workers='block')
    ctx.route('**/*supabase.co/**', lambda r: r.abort())
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script(MOCK)
    pg.goto('http://127.0.0.1:8766/bbxst.html'); pg.wait_for_timeout(800)
    assert pg.locator('#bpBtn').is_visible()
    assert not pg.locator('#bpShot').is_visible()
    # krátký posun nic neotevře
    drag(pg, '#bpBtn', -20, 0); pg.wait_for_timeout(200)
    assert pg.locator('#jOverlay').is_hidden()
    drag(pg, '#bpBtn', -140, 0); pg.wait_for_timeout(200)
    assert 'PŘIPOJIT BATTLE PASS' in pg.inner_text('#jBox')
    pg.click('#bpGo'); pg.wait_for_timeout(900)
    assert pg.evaluate('window.__cmds') == [0x51, 0x74], pg.evaluate('window.__cmds')
    assert pg.evaluate('window.__filters[0].namePrefix') == 'BEYBLADE'
    assert 'bp-on' in pg.get_attribute('body', 'class')
    assert 'BATTLE PASS · 53 %' in pg.inner_text('#bpShot'), pg.inner_text('#bpShot')
    pg.wait_for_timeout(1500)   # overlay „připojen“
    pg.evaluate('window.__launch(8123)'); pg.wait_for_timeout(300)
    assert pg.inner_text('#bpShot').replace('\n', ' ') == '8 123 RPM', pg.inner_text('#bpShot')
    # nad +3, uprostřed
    sb_, b3 = pg.locator('#bpShot').bounding_box(), pg.locator('.center .dragBtn[data-points="3"]').bounding_box()
    assert sb_['y'] + sb_['height'] <= b3['y'] and abs((sb_['x'] + sb_['width'] / 2) - (b3['x'] + b3['width'] / 2)) < 3, (sb_, b3)
    pg.screenshot(path='/tmp/shots/bbxst_bp.png')
    pg.evaluate('window.__launch(5500)'); pg.wait_for_timeout(300)
    # statistika
    drag(pg, '#bpBtn', 0, -140); pg.wait_for_timeout(200)
    assert 'baterie ≈ 53 %' in pg.inner_text('#jBox') and 'odpalů celkem 242' in pg.inner_text('#jBox'), pg.inner_text('#jBox')
    pg.click('#bpSt'); pg.wait_for_timeout(200)
    t = pg.inner_text('#bpStats')
    assert 'DNES · 2×' in t and '8 123' in t and '5 500' in t, t
    assert 'POSLEDNÍCH 50) · 5×' in t, t
    pg.screenshot(path='/tmp/shots/bbxst_bp_stats.png')
    # živý odpal při otevřené statistice ji obnoví
    pg.evaluate('window.__launch(9000)'); pg.wait_for_timeout(300)
    assert 'DNES · 3×' in pg.inner_text('#bpStats')
    pg.click('#bpStats .qr-btn.confirm'); pg.wait_for_timeout(100)
    # odpojení
    drag(pg, '#bpBtn', -140, 0); pg.wait_for_timeout(200)
    pg.click('#bpOff'); pg.wait_for_timeout(300)
    assert 'bp-on' not in (pg.get_attribute('body', 'class') or '')
    assert not pg.locator('#bpShot').is_visible()
    # judge mód: tlačítko zůstává fialové a viditelné
    assert pg.evaluate("getComputedStyle(document.getElementById('bpBtn')).right") == '16px'
    for mode in ('judge', 'training'):
        pg.evaluate(f"document.body.classList.add('{mode}')")
        st = pg.evaluate("[getComputedStyle(bpBtn).display, getComputedStyle(bpBtn).color]")
        assert st == ['flex', 'rgb(199, 125, 255)'], (mode, st)
        pg.evaluate(f"document.body.classList.remove('{mode}')")
    print('errs:', errs); assert not errs, errs
    # bez Bluetooth (iPhone) se tlačítko neukáže
    pg2 = ctx.new_page(); pg2.goto('http://127.0.0.1:8766/bbxst.html'); pg2.wait_for_timeout(500)
    assert not pg2.locator('#bpBtn').is_visible()
    br.close()
print('OK')
