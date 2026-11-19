# Test: Můj Status (aréna, pořadí v aréně, průběžné pořadí), Judge menu (kdo řídí, uvolnění
# organizátorem), obsazení volných arén v Řízení a TV rozpis po arénách.
import re, subprocess
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8080/'
OUT = '/tmp/shots/'
errors = []
def sql(q):
    return subprocess.check_output(['psql', '-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-d', 'bbx', '-tAc', q]).decode().strip()

t_id = sql("select id from tournaments where name = 'Listopadový Cup'")
judge = sql("select id from profiles where nick = 'Judge'")
# všechny otevřené zápasy na arénu 1 (pořadí podle pos), první rozehraný s judgem a skóre
sql(f"""update matches set arena = 1, wave = pos, status = 'pending', judge_id = null, live_p1 = null, live_p2 = null
        where tournament_id = '{t_id}' and status <> 'done' and p1_reg is not null and p2_reg is not null""")
first = sql(f"select id from matches where tournament_id = '{t_id}' and status <> 'done' and p2_reg is not null order by pos limit 1")
sql(f"update matches set status = 'live', judge_id = '{judge}', live_p1 = 3, live_p2 = 2 where id = '{first}'")
open_n = int(sql(f"select count(*) from matches where tournament_id = '{t_id}' and status <> 'done' and p2_reg is not null"))
assert open_n >= 3, open_n
# hráč s účtem ve 2. čekajícím zápase
third = sql(f"""select m.id || '|' || p.nick from matches m join registrations r on r.id in (m.p1_reg, m.p2_reg)
                join profiles p on p.id = r.user_id
                where m.tournament_id = '{t_id}' and m.status = 'pending' and m.p2_reg is not null and r.user_id is not null
                order by m.pos limit 1""")
m3, nick = third.split('|')

def ctx(b, email, w=390, h=844):
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block')
    page = c.new_page()
    page.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    page.goto(BASE + '#/login'); page.fill('input[name=email]', email); page.fill('input[name=password]', 'x')
    page.click('#f-login button'); page.wait_for_selector('.t-card')
    return c, page

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── Můj Status hráče
    c, page = ctx(b, nick.lower() + '@test.cz')
    page.goto(BASE + f'#/t/{t_id}/me'); page.wait_for_selector('.pass-queue')
    assert 'Můj Status' in page.inner_text('.tabs')
    assert page.inner_text('.pass-arena .big') == '1'
    rows = page.locator('.pass-queue li')
    assert rows.count() == open_n, rows.count()
    assert page.locator('.pass-queue li.mine').count() == 1
    assert '3:2' in page.inner_text('.pass-queue li.live')
    assert page.locator('.pass-stand').count() == 1
    page.screenshot(path=OUT + '80_my_status.png', full_page=True)
    c.close()

    # ── Řízení: obsadit volné arény
    c, page = ctx(b, 'org@test.cz')
    page.goto(BASE + f'#/t/{t_id}/manage'); page.wait_for_selector('[data-act=rebalance]')
    page.screenshot(path=OUT + '81_manage_rebalance.png', full_page=True)
    page.click('[data-act=rebalance]'); page.wait_for_timeout(1200)
    arenas = int(sql(f"select count(distinct arena) from matches where tournament_id = '{t_id}' and status <> 'done' and p2_reg is not null"))
    assert arenas > 1, arenas
    assert sql(f"select arena from matches where id = '{first}'") == '1', 'rozehraný zůstává'

    # ── Judge menu: kdo řídí, organizátor uvolní judge
    page.goto(BASE + f'#/t/{t_id}/judge'); page.wait_for_selector('.arena-card')
    assert 'Judge menu' in page.inner_text('.tabs')
    card1 = page.locator(".arena-card:has(.arena-no:text-is('1'))")
    assert 'Judge: Judge' in card1.inner_text() and page.locator('[data-claim]').count() == 0
    page.screenshot(path=OUT + '82_judge_menu.png', full_page=True)
    card1.locator('[data-release]').click(); page.click('.modal [data-yes]'); page.wait_for_timeout(1000)
    assert sql(f"select coalesce(judge_id::text, '-') || '|' || status || '|' || live_p1 from matches where id = '{first}'") == '-|live|3'
    page.wait_for_selector(".arena-card.free")
    assert 'Rozehráno' in page.inner_text('.arena-card.free')
    c.close()

    # ── pauza: organizátor vyhlásí, hráč i TV vidí odpočet
    c, page = ctx(b, 'org@test.cz')
    page.goto(BASE + f'#/t/{t_id}/manage'); page.wait_for_selector('[data-act=pause]')
    page.fill('#pause-min', '7'); page.click('[data-act=pause]'); page.wait_for_selector('.pause-banner')
    assert sql(f"select pause_until > now() + interval '6 minutes' from tournaments where id = '{t_id}'") == 't'
    page.wait_for_selector('[data-act=pause-end]')
    page.screenshot(path=OUT + '84_manage_pause.png', full_page=True)
    c.close()
    c, page = ctx(b, nick.lower() + '@test.cz')
    page.goto(BASE + f'#/t/{t_id}/me'); page.wait_for_selector('.pause-banner')
    assert 'Pořadatel vyhlásil pauzu' in page.inner_text('.pause-banner') and re.match(r'^[67]:\d\d$', page.inner_text('.pb-time'))
    page.screenshot(path=OUT + '85_status_pause.png')
    c.close()
    c, page = ctx(b, 'org@test.cz', 1280, 720)
    page.goto(BASE + f'#/t/{t_id}/tv'); page.wait_for_selector('.tv-pause')
    page.wait_for_timeout(600); page.screenshot(path=OUT + '86_tv_pause.png')
    page.goto(BASE + f'#/t/{t_id}/manage'); page.wait_for_selector('[data-act=pause-end]'); page.click('[data-act=pause-end]')
    page.wait_for_selector('[data-act=pause]')
    assert sql(f"select pause_until is null from tournaments where id = '{t_id}'") == 't'
    c.close()

    # ── TV rozpis
    c, page = ctx(b, 'org@test.cz', 1280, 720)
    page.goto(BASE + f'#/t/{t_id}/tv'); page.wait_for_selector('.tv-arena')
    assert page.locator('.tv-arena').count() == int(sql(f"select arena_count from tournaments where id = '{t_id}'"))
    assert '3:2' in page.inner_text(".tv-arena:has(.tv-ano:has-text('1')) .tv-now").replace(' ', '').replace('\n', '')
    page.wait_for_timeout(500); page.screenshot(path=OUT + '83_tv.png')
    c.close()
    b.close()

print('CONSOLE ERRORS:', len(errors))
for e in errors[:20]: print(' -', e[:300])
assert not errors
print('ARENAS OK')
