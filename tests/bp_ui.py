from playwright.sync_api import sync_playwright
import http.server, threading, functools, os
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
MOCK = r"""
(() => {
  const mkChar = (uuid, props, vals) => {
    const t = new EventTarget(); t.uuid = uuid; t.properties = props
    t.readValue = async () => new DataView(new Uint8Array([1,2]).buffer)
    t.startNotifications = async () => { let i = 0; const iv = setInterval(() => { const v = vals[i++]; if (!v) return clearInterval(iv)
      t.value = new DataView(new Uint8Array(v).buffer); t.dispatchEvent(new Event('characteristicvaluechanged')) }, 60); return t }
    return t }
  const svc = { uuid: '0000ff00-0000-1000-8000-00805f9b34fb', getCharacteristics: async () => [
    mkChar('0000ff01-0000-1000-8000-00805f9b34fb', { notify: true }, [[0xa2,0x0c,0,5],[0xb0,0x0d,0,6]]),
    mkChar('00002a19-0000-1000-8000-00805f9b34fb', { read: true }, []) ] }
  const dev = new EventTarget(); dev.name = 'BEYBATTLE PASS'; dev.id = 'x1'
  dev.gatt = { connect: async () => ({ getPrimaryServices: async () => [svc] }), disconnect: () => dev.dispatchEvent(new Event('gattserverdisconnected')) }
  Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async (o) => { window.__opt = o.optionalServices.length; return dev } } })
})()
"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    pg = b.new_page(viewport={'width': 390, 'height': 844})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script(MOCK)
    pg.goto('http://127.0.0.1:8765/bp.html')
    pg.click('#connect'); pg.wait_for_timeout(600)
    pg.fill('#note', 'výstřel 1'); pg.press('#note', 'Enter')
    st = pg.text_content('#status'); cnt = pg.text_content('#count')
    log = pg.inner_text('#log')
    print('status:', st); print('count:', cnt, 'opt:', pg.evaluate('window.__opt'))
    assert 'odebírám 1' in st, st
    assert cnt == '3', cnt
    assert 'a2 0c 00 05' in log and '[0]3234' in log and 'výstřel 1' in log, log
    assert pg.evaluate("document.querySelectorAll('.hex b').length") == 3   # změněné bajty 2. zprávy: b0 0d 06
    pg.screenshot(path='/tmp/shots/bp.png', full_page=True)
    pg.click('#disconnect'); pg.wait_for_timeout(100)
    assert 'Odpojeno' in pg.text_content('#status')
    # bez Bluetooth
    p2 = b.new_page(); p2.goto('http://127.0.0.1:8765/bp.html')
    p2.evaluate("1"); 
    print('errs:', errs); assert not errs
    b.close()
print('OK')
