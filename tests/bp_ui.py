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
  const bpData = mkChar('55c4f002-f8eb-11ec-b939-0242ac120002', { read: true, notify: true }, [])
  bpData.readValue = async () => new DataView(new Uint8Array([0xa0,0x3a,0,4,0xff,0,0,0,0x16,0x1d,0,0x35,0xb4,4,0x51,0xc4,0xda]).buffer)
  const emit = (arr) => { bpData.value = new DataView(new Uint8Array(arr).buffer); bpData.dispatchEvent(new Event('characteristicvaluechanged')) }
  const bpCmd = { uuid: '55c4f001-f8eb-11ec-b939-0242ac120002', properties: { writeWithoutResponse: true }, writeValueWithoutResponse: async (v) => {
    window.__cmds = (window.__cmds || []).concat(v[0])
    if (v[0] === 0x51) emit([0xa0,0x3a,0,4,0xd3,0,0,0x71,0x0f,3,0,0x35,0xb4,4,0x51,0xc4,0xda])
    if (v[0] === 0x74) { const d = new Array(128).fill(0); [3234,3953,5126].forEach((x,i)=>{ d[2*i]=x&255; d[2*i+1]=x>>8 })
      d[127] = d.slice(0,127).reduce((a,b)=>a+b,0) & 255
      for (let i = 0; i < 8; i++) emit([0xb0+i, ...d.slice(16*i, 16*i+16)]) } } }
  const bpSvc = { uuid: '55c4f000-f8eb-11ec-b939-0242ac120002', getCharacteristics: async () => [bpData, bpCmd] }
  const dev = new EventTarget(); dev.name = 'BEYBATTLE PASS'; dev.id = 'x1'
  dev.gatt = { connect: async () => ({ getPrimaryServices: async () => [svc, bpSvc] }), disconnect: () => dev.dispatchEvent(new Event('gattserverdisconnected')) }
  Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async (o) => { window.__opt = o.optionalServices.length; return dev } } })
})()
"""
def log_text(pg): return pg.inner_text('#log')
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
    assert 'odebírám 2' in st, st
    assert pg.evaluate('window.__cmds') == [0x51, 0x74], pg.evaluate('window.__cmds')
    shots = pg.inner_text('#shots'); head = pg.text_content('#headInfo'); print('shots:', shots.replace('\n',' '), '|', head)
    assert '3234' in shots and '3953' in shots and '5126' in shots and 'nesedí' not in log_text(pg)
    assert 'Výstřelů celkem: 3' in head and '3953' in head and 'připraveno ke' in head
    assert 'a2 0c 00 05' in log and '[0]3234' in log and 'výstřel 1' in log, log
    assert pg.evaluate("document.querySelectorAll('.hex b').length") >= 3   # změněné bajty 2. zprávy: b0 0d 06
    pg.screenshot(path='/tmp/shots/bp.png', full_page=True)
    pg.click('#disconnect'); pg.wait_for_timeout(100)
    assert 'Odpojeno' in pg.text_content('#status')
    # bez Bluetooth
    p2 = b.new_page(); p2.goto('http://127.0.0.1:8765/bp.html')
    p2.evaluate("1"); 
    print('errs:', errs); assert not errs
    b.close()
print('OK')
