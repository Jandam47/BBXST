# Komunikace (29): záložka → kolečko (Chat, Ankety, Nápověda, Dotazy), ankety (založení, hlasování, víc možností,
# anonymní / veřejné, ukončení) a dotazy a připomínky (hráč → hlavní admin → odpověď). Spouštět po čerstvém tests/ui-up.sh.
import re, subprocess, os
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
os.makedirs(OUT, exist_ok=True)
errors = []
def sql(q):
    out = subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAqc', q]).decode().strip()
    return out.splitlines()[0].strip() if out else out

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

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── záložka Komunikace → kolečko ──
    h1 = ctx(b, 'hrac1@test.cz')
    tab = h1.locator('.tabbar a[data-tab=chat]')
    assert tab.inner_text().endswith('Komunikace')
    tab.click(); h1.wait_for_selector('.cw-overlay .cw-sec')
    assert h1.inner_text('.cw-title') == 'Komunikace'
    labels = h1.evaluate("[...document.querySelectorAll('.cw-sec title')].map(t => t.textContent)")
    assert labels == ['Chat', 'Ankety', 'Nápověda', 'Dotazy a připomínky'], labels
    h1.screenshot(path=OUT + '300_comm_wheel.png')
    url0 = h1.url
    h1.click('.cw-center'); h1.wait_for_selector('.cw-overlay', state='detached')
    assert h1.url == url0 and h1.locator('.t-card').count() > 0, 'kolečko je nad stránkou, po zavření zůstane, kde byl'
    tab.click(); h1.wait_for_selector('.cw-overlay .cw-sec')       # znovu klepnutí = znovu kolečko
    h1.click('.cw-sec[data-i="0"]'); h1.wait_for_url(re.compile(r'#/chat$')); h1.wait_for_selector('.chat-room')
    assert h1.locator('.comm-tabs').count() == 0 and h1.inner_text('h1') == 'Chat'
    assert 'Bazar' not in h1.inner_text('main')
    tab.click(); h1.wait_for_selector('.cw-overlay .cw-sec'); h1.click('.cw-sec[data-i="2"]'); h1.wait_for_url(re.compile(r'#/help$'))
    # adresa #/komunikace (odkaz) – kolečko, po zavření hlavní stránka
    h1.goto(BASE + '#/komunikace'); h1.wait_for_selector('.cw-overlay .cw-sec'); h1.keyboard.press('Escape')
    h1.wait_for_url(re.compile(r'#/$')); h1.wait_for_selector('.t-card')

    # ── hráč anketu nezaloží ──
    go(h1, '/ankety', '.comm-h')
    assert h1.locator('[data-new]').count() == 0

    # ── organizátor založí 2 ankety ──
    org = ctx(b, 'org@test.cz')
    go(org, '/ankety', '[data-new]')
    org.click('[data-new]'); org.wait_for_selector('#f-poll')
    org.fill('#f-poll input[name=question]', 'Kdy uděláme další trénink?')
    org.fill('#f-poll textarea[name=note]', 'Hala Pardubice, od 16:00.')
    org.locator('#f-poll input[name=opt]').nth(0).fill('Pátek')
    org.locator('#f-poll input[name=opt]').nth(1).fill('Sobota')
    org.locator('#f-poll input[name=opt]').nth(1).press('Enter')         # Enter = další řádek
    assert org.locator('#f-poll input[name=opt]').count() == 3
    org.locator('#f-poll input[name=opt]').nth(2).fill('Neděle')
    org.select_option('#f-poll select[name=dur]', '180')
    assert org.is_checked('#f-poll input[name=anonymous]') and not org.is_checked('#f-poll input[name=multi]')
    org.screenshot(path=OUT + '301_poll_form.png')
    org.click('#f-poll button.primary'); org.wait_for_url(re.compile(r'#/ankety/[0-9a-f-]{36}$'))
    p1 = org.url.split('/')[-1]
    org.wait_for_selector('.poll [data-ballot]')   # i autor nejdřív hlasuje
    assert sql(f"select multi::text || anonymous::text from polls where id = '{p1}'") == 'falsetrue'
    assert re.match(r'zbývá (2 h 59 min|3 h)$', org.inner_text('.poll-st')), org.inner_text('.poll-st')
    go(org, '/ankety', '[data-new]')
    org.click('[data-new]'); org.wait_for_selector('#f-poll')
    org.fill('#f-poll input[name=question]', 'Jaké formáty chcete?')
    org.locator('#f-poll input[name=opt]').nth(0).fill('Klasika 3v3')
    org.locator('#f-poll input[name=opt]').nth(1).fill('Deathmatch')
    org.click('#f-poll [data-add]'); org.locator('#f-poll input[name=opt]').nth(2).fill('Fashion')
    org.check('#f-poll input[name=multi]'); org.uncheck('#f-poll input[name=anonymous]')
    org.select_option('#f-poll select[name=dur]', '0'); org.wait_for_selector('#f-poll [data-custom]:not([hidden])')
    org.fill('#f-poll input[name=until]', sql("select to_char(now() at time zone 'Europe/Prague' + interval '2 days', 'YYYY-MM-DD\"T\"HH24:MI')"))
    org.click('#f-poll button.primary'); org.wait_for_url(re.compile(r'#/ankety/[0-9a-f-]{36}$'))
    p2 = org.url.split('/')[-1]
    assert sql(f"select multi::text || anonymous::text from polls where id = '{p2}'") == 'truefalse'

    # ── hráč hlasuje ──
    go(h1, '/ankety', '.poll [data-ballot]')
    assert h1.locator('.poll').count() == 2
    card = h1.locator(f'.poll[data-poll="{p1}"]')
    assert 'Výsledky uvidíš' not in card.inner_text()
    card.locator('.poll-opt-in:has-text("Sobota")').click()
    card.locator('button.primary').click(); h1.wait_for_selector(f'.poll[data-poll="{p1}"] .poll-res li.mine')
    assert 'Sobota' in h1.inner_text(f'.poll[data-poll="{p1}"] li.mine')
    card2 = h1.locator(f'.poll[data-poll="{p2}"]')
    card2.locator('.poll-opt-in:has-text("Klasika")').click(); card2.locator('.poll-opt-in:has-text("Fashion")').click()
    card2.locator('button.primary').click(); h1.wait_for_selector(f'.poll[data-poll="{p2}"] .poll-res li.mine >> nth=1')
    assert 'Hrac1' in h1.inner_text(f'.poll[data-poll="{p2}"] .poll-who'), 'veřejné hlasování ukáže nick'
    assert h1.locator(f'.poll[data-poll="{p1}"] .poll-who').count() == 0, 'anonymní neukáže nikoho'
    h1.screenshot(path=OUT + '302_polls_voted.png', full_page=True)
    # změna hlasu
    h1.locator(f'.poll[data-poll="{p1}"] [data-edit]').click()
    h1.locator(f'.poll[data-poll="{p1}"] .poll-opt-in:has-text("Neděle")').click()
    h1.locator(f'.poll[data-poll="{p1}"] button.primary').click(); h1.wait_for_selector(f'.poll[data-poll="{p1}"] li.mine:has-text("Neděle")')
    assert sql(f"select count(*) from poll_votes where poll_id = '{p1}'") == '1'

    # ── nepřihlášený: vidí ankety, výsledky až po konci ──
    an = ctx(b)
    go(an, f'/ankety/{p1}', '.poll')
    assert 'Hlasovat můžou hráči s účtem' in an.inner_text('.poll') and an.locator('.poll-num').count() == 0
    org.goto(BASE + f'#/ankety/{p1}'); org.wait_for_selector('[data-close]')
    org.click('.poll [data-close]'); org.click('[data-yes]'); org.wait_for_selector('.poll.ended')
    an.reload(); an.wait_for_selector('.poll.ended .poll-num')
    assert 'Neděle' in an.inner_text('.poll-res li.win')
    an.screenshot(path=OUT + '303_poll_ended.png')

    # ── odznak: hráč 2 má 1 anketu bez hlasu ──
    h2 = ctx(b, 'hrac2@test.cz')
    h2.wait_for_selector('.tabbar a[data-tab=chat] .nbadge')
    h2.click('.tabbar a[data-tab=chat]'); h2.wait_for_selector('.cw-overlay .cw-sec')
    assert h2.text_content('.cw-sec[data-i="1"] .cw-badge').strip() == '1', 'Ankety: 1 bez hlasu'
    assert h2.locator('.cw-sec[data-i="2"] .cw-badge').count() == 0
    h2.screenshot(path=OUT + '306_comm_wheel_badges.png')
    h2.keyboard.press('Escape')

    # ── dotazy a připomínky ──
    go(h1, '/dotazy', '#f-fb')
    assert 'soukromá' in h1.inner_text('.fb-lead')
    h1.click('[data-kind=note]')
    h1.fill('#f-fb textarea', 'Šlo by přidat tmavší TV rozpis?'); h1.click('#f-fb button.primary')
    h1.wait_for_selector('.fb-item >> text=tmavší TV rozpis')
    assert sql("select kind from feedback where body like 'Šlo by přidat tmavší%'") == 'note'
    h1.screenshot(path=OUT + '304_feedback_player.png', full_page=True)
    go(h2, '/dotazy', '#f-fb')
    assert 'tmavší' not in h2.inner_text('main'), 'cizí dotaz není vidět'

    adam = ctx(b, 'adam@test.cz')
    adam.wait_for_selector('.tabbar a[data-tab=chat] .nbadge')
    adam.click('.tabbar a[data-tab=chat]'); adam.wait_for_selector('.cw-overlay .cw-sec')
    assert adam.text_content('.cw-sec[data-i="3"] .cw-badge').strip() == '1', 'schránka: 1 nevyřízený dotaz'
    adam.keyboard.press('Escape')
    go(adam, '/dotazy', '.fb-item')
    it = adam.locator('.fb-item:has-text("tmavší TV rozpis")')
    assert 'Hrac1' in it.inner_text()
    it.locator('textarea').fill('Dobrý nápad, přidám to.'); it.locator('button.primary').click()
    adam.wait_for_selector('.empty >> text=Nic nečeká')
    adam.click('[data-all="1"]'); adam.wait_for_selector('.fb-item.done .fb-reply')
    adam.screenshot(path=OUT + '305_feedback_inbox.png', full_page=True)

    go(h1, '/dotazy', '.fb-reply')
    assert 'Dobrý nápad' in h1.inner_text('.fb-reply') and h1.locator('.fb-newtag').count() == 1

    # ── „přečteno“ platí i v jiném prohlížeči (30) ──
    sql("insert into chat_messages (room_id, user_id, nick, body) select 'volny', id, nick, 'Nová zpráva pro test' from profiles where nick = 'Org'")
    def chat_badge(pg):
        pg.click('.tabbar a[data-tab=chat]'); pg.wait_for_selector('.cw-overlay .cw-sec')
        n = pg.locator('.cw-sec[data-i="0"] .cw-badge').count()
        pg.keyboard.press('Escape'); pg.wait_for_selector('.cw-overlay', state='detached')
        return n
    h3 = ctx(b, 'hrac3@test.cz'); h3.wait_for_timeout(1500)
    assert chat_badge(h3) == 1
    go(h3, '/chat', '.chat-room.test'); h3.click('.chat-room.test'); h3.wait_for_selector('#f-chat')
    h3.wait_for_timeout(1500)                                                   # odeslání „přečteno“ na server
    assert sql("select count(*) from user_seen s join profiles p on p.id = s.user_id where p.nick = 'Hrac3' and s.key = 'chat:volny'") == '1'
    h3b = ctx(b, 'hrac3@test.cz'); h3b.wait_for_timeout(1500)                    # jiný prohlížeč, prázdný localStorage
    go(h3b, '/chat', '.chat-room.test')
    assert h3b.locator('.chat-room.test .chat-dot').count() == 0, 'zpráva přečtená jinde nesvítí'
    # (ostatní místnosti mohly být nepřečtené už v seedu – kontroluje se jen Zkušební chat)
    # odpověď na dotaz přečtená jinde
    h1b = ctx(b, 'hrac1@test.cz'); h1b.wait_for_timeout(1500)
    go(h1b, '/dotazy', '.fb-reply')
    assert h1b.locator('.fb-newtag').count() == 0, 'odpověď už viděl v jiném prohlížeči'

    print('CONSOLE ERRORS:', len(errors), errors[:5])
    assert not errors
    print('KOMUNIKACE OK')
