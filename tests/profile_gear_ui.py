# Profil → ozubené kolečko (nastavení): Profil (upravit, heslo, odhlásit, smazání účtu ve 2 krocích + nick)
# a Aplikace (upozornění, instalace, nápověda). Spouštět po čerstvém tests/ui-up.sh.
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
    return pg

labels = lambda pg: pg.evaluate("[...document.querySelectorAll('.cw-sec title')].map(t => t.textContent)")
sec = lambda pg, l: pg.dispatch_event(f'.cw-sec[aria-label^="{l}"]', 'click')

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    h = ctx(b, 'hrac1@test.cz')
    h.goto(BASE + '#/me'); h.wait_for_selector('.prof-gear')
    # pod jménem už žádná tlačítka, karty upozornění / instalace / smazání jsou pryč
    for s in ['[data-act=edit]', '[data-act=logout]', '#push-card', '#inst-card', '[data-act=delete-account]', '.danger-zone']:
        assert h.locator(s).count() == 0, s
    h.screenshot(path=OUT + '300_profile_gear.png')

    h.click('.prof-gear'); h.wait_for_selector('.cw-overlay .cw-sec')
    top = labels(h)
    assert top[0] == 'Profil' and 'Aplikace' in top and 'Správa' not in top, top
    tk = sql("select count(*) from registrations r join tournaments t on t.id = r.tournament_id join profiles p on p.id = r.user_id where p.nick = 'Hrac1' and r.status = 'active' and t.kind = 'tournament' and t.status in ('registration','swiss','topcut')")
    assert ('Vstupenka' in top) == (tk != '0'), (top, tk)
    h.screenshot(path=OUT + '301_settings_wheel.png')
    sec(h, 'Profil'); h.wait_for_function("() => document.querySelector('.cw-title').textContent === 'Profil'")
    assert labels(h) == ['Upravit profil', 'Změnit heslo', 'Sdílet profil', 'Soukromí', 'Odhlásit', 'Smazání účtu'], labels(h)
    h.screenshot(path=OUT + '302_settings_profil.png')
    sec(h, 'Smazání'); assert labels(h) == ['Smazat účet natrvalo'], labels(h)
    h.screenshot(path=OUT + '303_settings_delete.png')
    sec(h, 'Smazat účet natrvalo'); h.wait_for_selector('#f-del')
    h.fill('#f-del input[name=nick]', 'spatne'); h.click('#f-del button.danger'); h.wait_for_timeout(400)
    assert sql("select count(*) from profiles where nick = 'Hrac1'") == '1'   # špatný nick nic nesmaže
    h.click('#f-del [data-close]'); h.wait_for_selector('#f-del', state='detached')

    # upravit profil
    h.click('.prof-gear'); sec(h, 'Profil'); sec(h, 'Upravit'); h.wait_for_selector('#f-prof')
    h.keyboard.press('Escape')
    h.wait_for_selector('#f-prof', state='detached')

    # aplikace
    h.click('.prof-gear'); sec(h, 'Aplikace')
    assert labels(h) == ['Upozornění na telefonu', 'Aplikace na plochu', 'Vzhled', 'Nápověda'], labels(h)
    h.screenshot(path=OUT + '304_settings_app.png')
    sec(h, 'Upozornění'); h.wait_for_selector('#push-card h3'); h.screenshot(path=OUT + '305_settings_push.png')
    h.click('.modal [data-close]'); h.wait_for_selector('#push-card', state='detached')
    h.click('.prof-gear'); sec(h, 'Aplikace'); sec(h, 'Aplikace na plochu'); h.wait_for_selector('#inst-card .inst-row')
    h.screenshot(path=OUT + '306_settings_install.png')
    h.click('.modal [data-close]')
    h.click('.prof-gear'); sec(h, 'Aplikace'); sec(h, 'Nápověda'); h.wait_for_selector('.help-nav')

    # sdílet profil
    h.goto(BASE + '#/me'); h.wait_for_selector('.prof-gear')
    h.click('.prof-gear'); sec(h, 'Profil'); sec(h, 'Sdílet'); h.wait_for_selector('.tk-qr svg')
    me = sql("select id from profiles where nick = 'Hrac1'")
    assert h.input_value('.modal input[readonly]').endswith('#/p/' + me)
    h.screenshot(path=OUT + '307_share.png'); h.click('.modal [data-close]')

    # soukromí: skrýt soupeře a Standings → Hrac2 je nevidí
    h.click('.prof-gear'); sec(h, 'Profil'); sec(h, 'Soukromí'); h.wait_for_selector('[data-priv=h2h]')
    h.check('[data-priv=h2h]'); h.wait_for_selector('text=Skryto před ostatními')
    h.check('[data-priv=standings]'); h.wait_for_timeout(600)
    h.screenshot(path=OUT + '308_privacy.png'); h.click('.modal [data-close]')
    assert sql("select (privacy->>'h2h') || (privacy->>'standings') from profiles where nick = 'Hrac1'") == 'truetrue'
    h2 = ctx(b, 'hrac2@test.cz')
    h2.goto(BASE + f'#/p/{me}'); h2.wait_for_selector('.prof-head'); h2.wait_for_timeout(500)
    assert h2.locator('.h2h-opp').count() == 0 and h2.locator('.h2h').count() == 0
    h2.goto(BASE + '#/players'); h2.wait_for_selector('#pl .li')
    assert 'Hrac1' not in h2.inner_text('#pl')
    h.goto(BASE + '#/players'); h.wait_for_selector('#pl .li')
    assert 'ostatní tě tu nevidí' in h.inner_text('#pl')
    h.goto(BASE + '#/me'); h.wait_for_selector('.prof-gear')
    h.click('.prof-gear'); sec(h, 'Profil'); sec(h, 'Soukromí'); h.wait_for_selector('[data-priv=h2h]')
    h.uncheck('[data-priv=h2h]'); h.wait_for_timeout(500); h.uncheck('[data-priv=standings]'); h.wait_for_timeout(500)
    h.click('.modal [data-close]')
    assert sql("select privacy::text from profiles where nick = 'Hrac1'") == '{}'

    # vstupenka (když je hráč v turnaji)
    if tk != '0':
        h.click('.prof-gear'); sec(h, 'Vstupenka')
        if h.locator('.cw-overlay').count(): h.dispatch_event('.cw-sec[data-i="0"]', 'click')
        h.wait_for_selector('.tk-qr svg'); h.screenshot(path=OUT + '309_ticket.png'); h.click('.modal [data-close]')

    # vzhled bez neonů: přepnout, přežije reload, lišta dole zůstane přilepená
    h.goto(BASE + '#/me'); h.wait_for_selector('.prof-gear')
    h.click('.prof-gear'); sec(h, 'Aplikace'); sec(h, 'Vzhled'); h.wait_for_selector('[data-theme-k=mono]')
    h.click('[data-theme-k=mono]'); h.wait_for_selector('[data-theme-k=mono].on')
    assert h.evaluate("document.documentElement.dataset.theme") == 'mono'
    h.screenshot(path=OUT + '312_theme_sheet.png'); h.click('.modal [data-close]')
    h.reload(); h.wait_for_selector('.prof-gear')
    assert h.evaluate("document.documentElement.dataset.theme") == 'mono'
    assert h.evaluate("getComputedStyle(document.querySelector('.prof-gear .nicon .i1')).stroke") == 'rgb(207, 207, 207)'
    h.screenshot(path=OUT + '313_mono_profile.png')
    y0 = h.evaluate("document.querySelector('.tabbar').getBoundingClientRect().top")
    h.mouse.wheel(0, 900); h.wait_for_timeout(300)
    assert h.evaluate("document.querySelector('.tabbar').getBoundingClientRect().top") == y0, 'tabbar musí zůstat dole'
    h.goto(BASE + '#/'); h.wait_for_selector('.t-card'); h.screenshot(path=OUT + '314_mono_home.png')
    tid = sql("select id from tournaments where status = 'finished' and kind = 'tournament' limit 1")
    h.goto(BASE + f'#/t/{tid}'); h.wait_for_selector('.tabs'); h.wait_for_timeout(500); h.screenshot(path=OUT + '315_mono_tournament.png')
    h.click('.tabbar a[data-tab=chat]'); h.wait_for_selector('.cw-overlay .cw-sec'); h.screenshot(path=OUT + '316_mono_wheel.png')
    h.keyboard.press('Escape')
    h.goto(BASE + '#/me'); h.wait_for_selector('.prof-gear')
    h.click('.prof-gear'); sec(h, 'Aplikace'); sec(h, 'Vzhled')
    assert h.locator('[data-theme-k]').count() == 5
    for k, stroke in [('synth', 'rgb(255, 122, 61)'), ('toxic', 'rgb(57, 255, 136)'), ('ronin', 'rgb(255, 59, 78)')]:
        h.click(f'[data-theme-k={k}]'); h.wait_for_selector(f'[data-theme-k={k}].on')
        assert h.evaluate("document.documentElement.dataset.theme") == k
        assert h.evaluate("getComputedStyle(document.querySelector('.prof-gear .nicon .i1')).stroke") == stroke, k
    h.screenshot(path=OUT + '317_theme_sheet_all.png')
    h.click('.modal [data-close]')
    for k in ['synth', 'toxic', 'ronin']:
        h.evaluate(f"localStorage.setItem('bbxu_theme', '{k}')")
        for path, sel, name in [('#/', '.t-card', 'home'), (f'#/t/{tid}', '.tabs', 'tour'), ('#/me', '.prof-gear', 'me')]:
            h.goto(BASE + path); h.reload(); h.wait_for_selector(sel); h.wait_for_timeout(400)
            assert h.evaluate("document.documentElement.dataset.theme") == k
            h.screenshot(path=OUT + f'32x_{k}_{name}.png')
    h.click('.prof-gear'); sec(h, 'Aplikace'); sec(h, 'Vzhled'); h.click('[data-theme-k=neon]')
    assert h.evaluate("document.documentElement.dataset.theme") is None
    h.click('.modal [data-close]')

    # cizí profil nemá kolečko
    other = sql("select id from profiles where nick = 'Hrac2'")
    h.goto(BASE + f'#/p/{other}'); h.wait_for_selector('.prof-head')
    assert h.locator('.prof-gear').count() == 0

    # admin: Správa + Lidé s funkcí
    a = ctx(b, 'adam@test.cz')
    a.goto(BASE + '#/me'); a.wait_for_selector('.prof-gear')
    a.click('.prof-gear'); a.wait_for_selector('.cw-overlay .cw-sec')
    assert 'Správa' in labels(a)
    sec(a, 'Správa')
    assert labels(a) == ['Žádosti ke schválení', 'Nahlášený obsah', 'Chyby z telefonů', 'Záloha dat', 'Lidé s funkcí', 'Zakázaná slova'], labels(a)
    a.screenshot(path=OUT + '310_admin_wheel.png')
    sec(a, 'Lidé s funkcí'); a.wait_for_selector('.modal h3')
    assert 'Org' in a.inner_text('.modal') or 'Organizátor' in a.inner_text('.modal')
    a.fill('#st-q', 'hrac'); a.wait_for_selector('#st-r .li')
    a.screenshot(path=OUT + '311_staff.png'); a.click('.modal [data-close]')
    # zakázaná slova (45): seznam, přidat / odebrat, vyzkoušet
    a.click('.prof-gear'); a.wait_for_selector('.cw-overlay:not(.closing) .cw-sec'); sec(a, 'Správa'); sec(a, 'Zakázaná slova')
    a.wait_for_selector('.bw-word'); assert a.locator('.bw-word').count() > 20
    a.fill('#bw-add [name=word]', 'Blbec'); a.click('#bw-add button'); a.wait_for_selector('[data-del="blbec"]')
    a.fill('#bw-test', 'Ty blbec a k0k0t'); a.wait_for_function("document.querySelector('#bw-res').textContent.includes('*****')")
    assert 'odmítne' in a.inner_text('#bw-res') and 'Ty ***** a *****' in a.inner_text('#bw-res'), a.inner_text('#bw-res')
    a.screenshot(path=OUT + '312_banned_words.png')
    a.click('[data-del="blbec"]'); a.wait_for_selector('[data-del="blbec"]', state='detached')
    a.click('.modal [data-close]')
    o = ctx(b, 'org@test.cz'); o.goto(BASE + '#/me'); o.wait_for_selector('.prof-gear')
    o.click('.prof-gear'); o.wait_for_selector('.cw-overlay .cw-sec'); assert 'Správa' not in labels(o)
    assert o.locator('.admin-strip').count() == 0

    # odhlášení
    h.goto(BASE + '#/me'); h.wait_for_selector('.prof-gear')
    h.click('.prof-gear'); sec(h, 'Profil'); sec(h, 'Odhlásit'); h.wait_for_url(re.compile(r'#/$'))
    h.wait_for_selector('text=Odhlášeno')
    b.close()

assert not errors, errors
print('profile gear OK')
