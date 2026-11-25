# ★ Choose wheel: oblíbené buildy a decky v profilu + vyplnění registrace podle decku / z oblíbených (35).
# Spouštět po čerstvém tests/ui-up.sh. (400 = očekávaná chyba při duplicitním buildu)
import re, subprocess, os
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
os.makedirs(OUT, exist_ok=True)
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

def ctx(b, email):
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404|status of 400', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
    pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    return pg

labels = lambda pg: pg.evaluate("[...document.querySelectorAll('.cw-sec title')].map(t => t.textContent)")
sec = lambda pg, l: pg.dispatch_event(f'.cw-sec[aria-label^="{l}"]', 'click')
# vyplní kartu beye v editoru: hodnota + opuštění pole (validace jako po výběru)
FILL = """([sel, vals]) => { const card = document.querySelector(sel)
  for (const [k, v] of Object.entries(vals)) { const i = card.querySelector(`[data-combo="${k}"] input`); i.value = v; i.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) } }"""

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    h = ctx(b, 'hrac1@test.cz')
    me = sql("select id from profiles where nick = 'Hrac1'")
    h.goto(BASE + '#/me'); h.wait_for_selector('.prof-fav')
    h.screenshot(path=OUT + '400_prof_star.png')
    h.click('.prof-fav'); h.wait_for_selector('.cw-overlay .cw-sec')
    assert labels(h) == ['Oblíbené buildy', 'Decky', 'Nový build'], labels(h)
    h.screenshot(path=OUT + '401_choose_wheel.png')

    # nový build přes kolečko
    sec(h, 'Nový build'); h.wait_for_selector('#f-fav [data-bey="0"]')
    assert h.inner_text('#f-fav legend') == 'Build'
    assert h.locator('.fav-bar').count() == 0, 'v editoru buildu lišta oblíbených není'
    h.evaluate(FILL, ['#f-fav [data-bey="0"]', {'blade': 'Dran Sword', 'ratchet': '3-60', 'bit': 'Flat'}])
    h.wait_for_selector('#f-fav .bey-card.complete')
    h.fill('#f-fav input[name=note]', 'hlavní útok')
    h.screenshot(path=OUT + '402_build_modal.png')
    h.click('#f-fav button.primary'); h.wait_for_url(re.compile(r'#/oblibene$')); h.wait_for_selector('.fav-card')
    assert 'Dran Sword 3-60F' in h.inner_text('.fav-list') and 'hlavní útok' in h.inner_text('.fav-list')
    # další dva buildy rovnou v DB
    sql(f"""insert into fav_builds (user_id, bey) values
      ('{me}', '{{"type":"cx","lock":"Wizard","main":"Arc","assist":"Round","ratchet":"4-55","bit":"Low Orb"}}'),
      ('{me}', '{{"type":"bx","blade":"Hells Nether","bit":"Ball"}}')""")
    h.reload(); h.wait_for_selector('.fav-card >> nth=2')
    names = h.eval_on_selector_all('.fav-name', 'els => els.map(e => e.textContent)')
    print('buildy:', names)
    # duplicita
    h.click('[data-act=new-build]'); h.wait_for_selector('#f-fav')
    h.evaluate(FILL, ['#f-fav [data-bey="0"]', {'blade': 'Dran Sword', 'ratchet': '3-60', 'bit': 'Flat'}])
    h.click('#f-fav button.primary'); h.wait_for_selector('text=už máš v oblíbených')
    h.click('#f-fav [data-close]')
    # úprava buildu
    h.click(f'[data-edit]'); h.wait_for_selector('#f-fav')
    assert h.input_value('#f-fav [data-combo="blade"] input') == 'Dran Sword'
    h.evaluate(FILL, ['#f-fav [data-bey="0"]', {'ratchet': '3-80'}])
    h.click('#f-fav button.primary'); h.wait_for_selector('text=Build uložený')
    h.wait_for_function("() => document.querySelector('.fav-list').textContent.includes('Dran Sword 3-80F')")
    h.screenshot(path=OUT + '403_builds.png')

    # deck: klepnutí v pořadí 3., 1., 2. build
    h.click('[data-act=new-deck]'); h.wait_for_selector('#f-fdeck [data-pick]')
    ids = h.eval_on_selector_all('[data-pick]', 'els => els.map(e => e.dataset.pick)')
    h.fill('#f-fdeck input[name=name]', 'Turnajový')
    for i in [2, 0, 1]: h.click(f'[data-pick="{ids[i]}"]')
    assert h.eval_on_selector_all('.fav-pick-it .fav-num', 'els => els.map(e => e.textContent)') == ['2', '3', '1']
    h.screenshot(path=OUT + '404_deck_modal.png')
    h.click('#f-fdeck button.primary'); h.wait_for_selector('.fav-card.deck')
    assert '?tab=decky' in h.url
    order = sql(f"select array_to_string(builds, ',') from fav_decks where user_id = '{me}'")
    assert order.split(',') == [ids[2], ids[0], ids[1]], order
    h.screenshot(path=OUT + '405_decks.png')

    # registrace: vyplnit podle decku, pak přidat z oblíbených (všechno plné → vybrat slot)
    org = sql("select id from profiles where nick = 'Org'") or sql("select id from profiles where role = 'organizer' limit 1")
    tid = sql(f"insert into tournaments (name, swiss_rounds, top_cut, arena_count, created_by) values ('Oblíbené cup', 3, 0, 2, '{org}') returning id")
    h.goto(BASE + f'#/t/{tid}'); h.wait_for_selector('#f-reg .fav-bar [data-fav=deck]')
    h.screenshot(path=OUT + '406_reg_bar.png')
    h.click('[data-fav=deck]'); h.wait_for_selector('.fav-choose [data-i]'); h.click('.fav-choose [data-i="0"]')
    h.wait_for_function("() => document.querySelectorAll('#f-reg .bey-card.complete').length === 3")
    prev = h.eval_on_selector_all('#f-reg .bey-preview b', 'els => els.map(e => e.textContent)')
    print('vyplněno:', prev)
    assert prev[0] == 'Hells Nether B' and prev[1] == 'Dran Sword 3-80F' and prev[2].startswith('Wizard Arc'), prev
    h.click('[data-fav=build]'); h.wait_for_selector('.fav-choose [data-i]')
    h.click('.fav-choose [data-i="0"]')                      # Dran Sword → všechno plné, ptá se kam
    h.wait_for_selector('text=Nahradit který beyblade?'); h.click('.fav-choose [data-i="0"]')
    h.wait_for_function("() => document.querySelector('#f-reg [data-bey=\"0\"] .bey-preview b').textContent === 'Dran Sword 3-80F'")
    # ruční úprava po vyplnění a registrace
    h.evaluate(FILL, ['#f-reg [data-bey="0"]', {'blade': 'Phoenix Wing', 'ratchet': '9-60', 'bit': 'Gear Flat'}])
    h.wait_for_function("() => document.querySelector('#f-reg [data-bey=\"0\"] .bey-preview b').textContent.startsWith('Phoenix Wing')")
    h.screenshot(path=OUT + '407_reg_filled.png')
    h.click('#f-reg button.primary'); h.wait_for_selector('text=Jsi zaregistrovaný', timeout=8000)
    reg = sql(f"select bey1 || ' | ' || bey2 || ' | ' || bey3 from registrations r join profiles p on p.id = r.user_id where r.tournament_id = '{tid}' and p.nick = 'Hrac1'")
    print('registrace:', reg)
    assert reg.startswith('Phoenix Wing') and 'Dran Sword 3-80F' in reg and 'Wizard Arc' in reg, reg

    # smazání buildu ho vyřadí z decku
    h.goto(BASE + '#/oblibene'); h.wait_for_selector('.fav-card')
    h.click(f'[data-del="{ids[2]}"]'); h.click('.modal [data-yes]'); h.wait_for_selector('text=Smazáno')
    assert sql(f"select cardinality(builds) from fav_decks where user_id = '{me}'") == '2'
    h.click('[data-tab=decky]'); h.wait_for_selector('.fav-card.deck'); assert 'jen 2 ze 3' in h.inner_text('.fav-card.deck')

    # walk-in organizátora lištu oblíbených nemá; host bez účtu taky ne
    b.close()

assert not errors, errors
print('favorites UI OK')
