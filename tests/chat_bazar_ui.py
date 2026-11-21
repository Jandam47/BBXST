# Nový chat (Zkušební, Info k turnaji, Komunitní s hosty) a bazar (fotky, soukromé komentáře) v Chrome.
# Spouštět po čerstvém tests/ui-up.sh.
import re, io, subprocess, os
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
os.makedirs(OUT, exist_ok=True)
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

def photo(color, text):
    im = Image.new('RGB', (1600, 1200), color); d = ImageDraw.Draw(im)
    d.ellipse((500, 300, 1100, 900), outline='white', width=40); d.text((60, 60), text, fill='white')
    b = io.BytesIO(); im.save(b, 'PNG'); return {'name': text + '.png', 'mimeType': 'image/png', 'buffer': b.getvalue()}

def ctx(b, email=None, w=390, h=844):
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block')
    pg = c.new_page()
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    if email:
        pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
        pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    else:
        pg.goto(BASE + '#/'); pg.wait_for_timeout(800)
    return pg

def go(page, h, sel):
    page.goto(BASE + '#' + h); page.wait_for_selector(sel)

u1 = sql("select id from profiles where nick = 'Hrac1'"); u2 = sql("select id from profiles where nick = 'Hrac2'")
cid = sql(f"insert into communities (name, status, created_by) values ('Chat klub', 'approved', '{u1}') returning id")
sql(f"insert into community_members (community_id, user_id, role, status) values ('{cid}', '{u1}', 'leader', 'active'), ('{cid}', '{u2}', 'member', 'active')")
troom = 't-' + sql("select id from tournaments where kind = 'tournament' order by starts_at desc limit 1")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── nepřihlášený: jen Info k turnaji ──
    an = ctx(b)
    go(an, '/chat', '.chat-room')
    txt = an.inner_text('main')
    assert 'Info k turnaji' in txt and 'Obecné informace' in txt and 'Zkušební chat' not in txt and 'Komunitní chat' not in txt
    go(an, '/bazar', 'h2'); assert 'jen přihlášení' in an.inner_text('main')

    # ── organizátor napíše info k turnaji ──
    org = ctx(b, 'org@test.cz')
    go(org, f'/chat/{troom}', '#f-chat')
    org.fill('#f-chat textarea', 'Prezence od 9:30, start v 10:00.'); org.keyboard.press('Enter')
    org.wait_for_selector('.msg.own >> text=Prezence od 9:30')

    # ── organizátor akce: uzavřít / schovat / znovu otevřít ──
    org.click('[data-state=closed]'); org.wait_for_selector('.chat-note.state')
    assert org.locator('#f-chat').count() == 0 and 'uzavřený' in org.inner_text('.chat-note')
    org.screenshot(path=OUT + '188_chat_closed_manage.png')
    org.click('[data-state=hidden]'); org.wait_for_selector('[data-state=active]')
    assert sql(f"select state from chat_rooms where id = '{troom}'") == 'hidden'
    go(an, '/chat', '.chat-room'); assert troom not in an.inner_html('main'), 'schovaný nepřihlášený nevidí'
    go(org, '/chat', '.chat-state.hidden')
    go(org, f'/chat/{troom}', '[data-state=active]'); org.click('[data-state=active]'); org.wait_for_selector('#f-chat')

    # ── hráč: přehled, zkušební chat, info jen ke čtení ──
    h1 = ctx(b, 'hrac1@test.cz')
    go(h1, '/chat', '.chat-room.test')
    assert h1.locator('.chat-room.community').count() == 1
    h1.screenshot(path=OUT + '180_chat_rooms.png', full_page=True)
    h1.click('.chat-room.test'); h1.wait_for_selector('#f-chat')
    h1.fill('#f-chat textarea', 'Zkouším nový chat'); h1.keyboard.press('Enter'); h1.wait_for_selector('.msg.own >> text=Zkouším')
    go(h1, f'/chat/{troom}', '.chat-log .msg')
    assert h1.locator('#f-chat').count() == 0 and 'jen organizátoři a admini' in h1.inner_text('.chat-note')
    h1.screenshot(path=OUT + '181_chat_info_room.png')

    # ── komunitní chat: leader pozve hosta na 15 min bez starých zpráv ──
    go(h1, f'/chat/c-{cid}', '#f-chat')
    h1.wait_for_timeout(1100)       # limit 1 zpráva / s
    h1.fill('#f-chat textarea', 'Stará zpráva jen pro členy'); h1.keyboard.press('Enter'); h1.wait_for_selector('.msg.own >> text=Stará zpráva')
    h1.click('[data-guests]'); h1.wait_for_selector('#f-guest')
    h1.fill('#f-guest input[name=who]', 'Hrac3'); h1.click('[data-min="15"]')
    assert h1.input_value('#f-guest input[name=who]') == 'Hrac3' and h1.input_value('#f-guest input[name=mins]') == '15'
    h1.screenshot(path=OUT + '182_chat_invite_guest.png')
    h1.click('#f-guest button.primary'); h1.wait_for_selector('[data-unguest]')
    h1.click('.modal [data-close]')
    h1.wait_for_timeout(1100)
    h1.fill('#f-chat textarea', 'Vítej, hoste!'); h1.keyboard.press('Enter'); h1.wait_for_selector('.msg.own >> text=Vítej')

    h3 = ctx(b, 'hrac3@test.cz')
    go(h3, '/chat', '.chat-room.community')
    assert 'Host do' in h3.inner_text('.chat-room.community')
    h3.click('.chat-room.community'); h3.wait_for_selector('.chat-log .msg')
    msgs = h3.locator('.chat-log .msg .body').all_inner_texts()
    assert sql("select count(*) from chat_messages where room_id = 'volny' and body like 'Stará%'") == '0', 'zpráva jen do jedné místnosti'
    assert msgs == ['Vítej, hoste!'], msgs
    assert 'jako host' in h3.inner_text('.chat-note')
    h3.screenshot(path=OUT + '183_chat_guest_view.png')

    # ── bazar: zlaté +, fotky, vystavení ──
    go(h1, '/bazar', '[data-add]')
    h1.click('[data-add]'); h1.wait_for_selector('#f-ad')
    h1.fill('#f-ad input[name=title]', 'Dran Sword 3-60F – nový')
    h1.fill('#f-ad input[name=price]', '250')
    h1.fill('#f-ad textarea[name=description]', 'Nerozbalený, předání na turnaji.')
    h1.set_input_files('#ph-in', [photo('#123456', 'front'), photo('#552244', 'back')])
    h1.check('#f-ad input[name=rules]')
    h1.wait_for_selector('.bz-thumb img >> nth=1')
    h1.screenshot(path=OUT + '184_bazar_form.png')
    h1.click('#f-ad button.primary'); h1.wait_for_url(re.compile(r'#/bazar/[0-9a-f-]{36}$'))
    h1.wait_for_selector('.bz-gallery img')
    h1.wait_for_function("[...document.querySelectorAll('.bz-gallery img')].every(i => i.complete && i.naturalWidth > 0)")
    ad = h1.url.split('/')[-1]
    assert sql(f"select array_length(photos, 1) from bazar_ads where id = '{ad}'") == '2'
    assert os.path.getsize(f"/tmp/bbx-storage/bazar/{sql(f'select photos[1] from bazar_ads where id = {chr(39)}{ad}{chr(39)}')}") < 1_000_000

    # ── zájemci píšou – každý vidí jen svoje vlákno ──
    h2 = ctx(b, 'hrac2@test.cz')
    go(h2, '/bazar', '.bz-card'); h2.screenshot(path=OUT + '185_bazar_list.png')
    h2.click('.bz-card'); h2.wait_for_selector('[data-reply]')
    assert 'uvidí jen prodejce' in h2.inner_text('.bz-private')
    h2.fill('[data-reply] textarea', 'Dám 200?'); h2.keyboard.press('Enter'); h2.wait_for_selector('.bz-thread >> text=Dám 200?')
    go(h3, f'/bazar/{ad}', '[data-reply]')
    h3.fill('[data-reply] textarea', 'Beru za 250'); h3.keyboard.press('Enter'); h3.wait_for_selector('.bz-thread >> text=Beru za 250')
    assert 'Dám 200?' not in h3.inner_text('main'), 'cizí vlákno není vidět'
    h1.reload(); h1.wait_for_selector('.bz-thread >> nth=1')
    assert h1.locator('.bz-thread').count() == 2
    h1.wait_for_timeout(1100)
    h1.locator('.bz-thread:has-text("Hrac2") [data-reply] textarea').fill('Za 230 ano')
    h1.locator('.bz-thread:has-text("Hrac2") [data-reply] textarea').press('Enter')
    h1.wait_for_selector('.bz-thread >> text=Za 230 ano')
    h1.screenshot(path=OUT + '186_bazar_seller.png', full_page=True)
    h2.reload(); h2.wait_for_selector('.bz-thread >> text=Za 230 ano')   # lokálně bez realtime
    h2.screenshot(path=OUT + '187_bazar_buyer.png', full_page=True)
    assert 'Beru za 250' not in h2.inner_text('main')

    # prodáno + smazání
    h1.click('[data-status="sold"]'); h1.wait_for_selector('.bz-ad.sold')
    h1.click('[data-delete]'); h1.click('[data-yes]'); h1.wait_for_url(re.compile(r'#/bazar$'))
    assert sql(f"select count(*) from bazar_ads where id = '{ad}'") == '0'

    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    print('CHAT + BAZAR OK')
