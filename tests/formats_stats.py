# Test: založení deathmatche s pravidlem dílů, celý průběh přes testovací nástroje až po finále,
# vyhodnocení turnaje, meta žebříček a statistiky beyů na profilu.
import re, subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
def sql(q):
    return subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAc', q]).decode().strip()
def tools(page):
    page.wait_for_selector('details.card'); page.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
def shot(page, name, full=True):
    page.wait_for_timeout(400); page.screenshot(path=OUT + name + '.png', full_page=full)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
    page = c.new_page()
    page.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    page.on('dialog', lambda d: d.accept())

    page.goto(BASE + '#/login'); page.fill('input[name=email]', 'adam@test.cz'); page.fill('input[name=password]', 'x')
    page.click('#f-login button'); page.wait_for_selector('.t-card')

    # ── založení: deathmatch, díly se neopakují
    page.goto(BASE + '#/new'); page.wait_for_selector('#f-t')
    page.fill('input[name=name]', 'Deathmatch Night'); page.fill('input[name=starts_at]', '2026-12-01T18:00')
    page.check('input[name=format][value=deathmatch]')
    assert page.is_hidden('#f-rounds') and page.is_visible('#dm-hint') and page.is_hidden('#tc-card')
    assert page.is_checked('input[name=unique_parts]')
    page.fill('input[name=arena_count]', '3')
    shot(page, '70_new_deathmatch')
    page.click('#f-t button.primary'); page.wait_for_selector('.t-head')
    t_id = sql("select id from tournaments where name = 'Deathmatch Night'")
    assert sql(f"select format || '|' || unique_parts from tournaments where id = '{t_id}'") == 'deathmatch|true'

    # ── registrace s opakovaným dílem → chyba
    # (registrace přes UI je pokrytá v ui_smoke; tady stačí, že pravidlo je vidět)
    page.goto(BASE + f'#/t/{t_id}/me'); page.wait_for_selector('#f-reg')
    assert 'nesmí v decku opakovat' in page.inner_text('#f-reg')

    # ── 7 testovacích hráčů, start → 7 kol
    page.goto(BASE + f'#/t/{t_id}/manage'); tools(page)
    page.fill('#test-n', '7'); page.click('[data-act=test-players]')
    page.wait_for_function(f"document.querySelector('[data-act=start]') && !document.querySelector('[data-act=start]').disabled")
    page.wait_for_timeout(800)
    assert '7 kol' in page.inner_text('#tab'), page.inner_text('#tab')[:300]
    page.click('[data-act=start]'); page.click('.modal [data-yes]')
    page.wait_for_selector('.modal [data-ok]')   # po startu se rovnou ukáže 1. kolo
    assert sql(f"select swiss_rounds from tournaments where id = '{t_id}'") == '7'

    for r in range(1, 8):
        if r > 1: page.click('[data-act=draw]')
        page.wait_for_selector('.modal [data-ok]')
        assert f'{r}. kolo z 7' in page.inner_text('.modal'), page.inner_text('.modal')[:80]
        if r == 1:
            assert 'Každý s každým' in page.inner_text('.modal') and page.locator('[data-reroll]').count() == 0
            shot(page, '71_dm_round', full=False)
        page.click('.modal [data-ok]'); page.wait_for_timeout(600)
        page.goto(BASE + f'#/t/{t_id}/manage'); tools(page)
        page.click('[data-act=test-play]'); page.click('.modal [data-yes]')
        page.wait_for_function("document.querySelector('[data-act=test-play]')?.textContent.includes('(0)') || document.querySelector('[data-act=final2]')", timeout=60000)
        page.wait_for_timeout(500)
    pairs = sql(f"select count(*) from matches where tournament_id = '{t_id}' and not is_bye")
    assert pairs == '21', pairs
    dup = sql(f"select count(*) from (select least(p1_reg::text,p2_reg::text), greatest(p1_reg::text,p2_reg::text) from matches where tournament_id = '{t_id}' and not is_bye group by 1,2 having count(*) > 1) x")
    assert dup == '0'

    # ── co dál → finále top 2
    page.wait_for_selector('[data-act=final2]')
    assert 'Ukončit podle tabulky' in page.inner_text('#tab')
    shot(page, '72_dm_whats_next')
    page.click('[data-act=final2]'); page.wait_for_selector('.modal [data-yes]')
    assert 'BO3' in page.inner_text('.modal'); page.click('.modal [data-yes]')
    page.wait_for_function("location.hash.endsWith('/bracket')")
    page.wait_for_selector('.b-match'); page.wait_for_timeout(500)
    assert sql(f"select count(*) || '|' || max(best_of) from matches where tournament_id = '{t_id}' and stage <> 'swiss'") == '1|3'
    assert 'Finále' in page.inner_text('.tabs')
    page.goto(BASE + f'#/t/{t_id}/manage'); tools(page)
    page.click('[data-act=test-play]'); page.click('.modal [data-yes]'); page.wait_for_selector('[data-act=finish]', timeout=60000)
    page.click('[data-act=finish]'); page.wait_for_selector('.modal button.primary')
    page.locator('.modal button.primary').last.click(); page.wait_for_timeout(1500)
    assert sql(f"select status from tournaments where id = '{t_id}'") == 'finished'

    # ── vyhodnocení
    page.goto(BASE + f'#/t/{t_id}'); page.wait_for_selector('.rep-build')
    txt = page.inner_text('#tab')
    assert 'Nejhranější díly' in txt and page.locator('.rep-build').count() == 3 and page.locator('.rep-part').count() == 3
    shot(page, '73_report')

    # ── meta (testovací hráči T-… se nepočítají, data z db.test)
    page.goto(BASE + '#/meta'); page.wait_for_selector('.meta-row')
    assert not any(n.startswith('T-') for n in page.locator('.meta-name').all_inner_texts())
    shot(page, '74_meta_builds')
    page.click('#mk [data-k=bit]'); page.wait_for_timeout(800); page.wait_for_selector('.meta-row')
    shot(page, '75_meta_bits', full=False)

    # ── profil hráče se statistikou beyů
    hid = sql("select id from profiles where nick = 'Hrac1'")
    page.goto(BASE + f'#/p/{hid}'); page.wait_for_selector('#bk')
    page.locator('#bk').scroll_into_view_if_needed()
    page.click('#bk [data-k=blade]'); page.wait_for_timeout(300)
    assert page.locator('#bl .meta-row').count() >= 2
    shot(page, '76_profile_beys')
    b.close()

print('CONSOLE ERRORS:', len(errors))
for e in errors[:20]: print(' -', e[:300])
assert not errors
print('FORMATS OK')
