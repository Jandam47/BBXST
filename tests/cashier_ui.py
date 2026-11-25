# Pokladník a vstupné (28): admin dá funkci Pokladník, organizátor zapne vstupné a vybere pokladníka,
# organizátor zaškrtne platbu při kontrole registrace, pokladník vidí jen vstupné a zapisuje platby, vstupenka hráče.
# Spouštět po čerstvém tests/ui-up.sh.
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
    pg.on('console', lambda m: m.type == 'error' and not re.search(r'realtime|websocket|WebSocket|404', m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto(BASE + '#/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'x')
    pg.click('#f-login button'); pg.wait_for_selector('.t-card')
    return pg

def go(page, h, sel):
    page.goto(BASE + '#' + h); page.wait_for_selector(sel)

tid = sql("select id from tournaments where name = 'Zimní Pardubice Open'")
kasa = sql("select id from profiles where nick = 'Hrac9'")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── admin: funkce Pokladník v profilu ──
    adm = ctx(b, 'adam@test.cz')
    go(adm, f'/p/{kasa}', '[data-cashier]')
    adm.check('[data-cashier]'); adm.click('[data-yes]')
    adm.wait_for_selector('.pill.cash')
    assert sql(f"select cashier from profiles where id = '{kasa}'") == 't'

    # ── organizátor: vstupné v editoru turnaje ──
    org = ctx(b, 'org@test.cz')
    go(org, f'/t/{tid}/edit', '#f-t')
    assert org.is_hidden('#fee-opts')
    org.check('[name=fee]')
    assert org.is_checked('.cash-opt.org input'), 'organizátor je předvybraný'
    org.fill('[name=entry_fee]', '150')
    assert org.locator('.cash-opt:has-text("Hrac9")').count() == 1
    org.click('.cash-opt:has-text("Hrac9")')
    org.locator('.fee-card').screenshot(path=OUT + '310_fee_editor.png')
    org.select_option('#f-t [name=region]', 'Pardubický')
    org.click('#f-t button.primary.block'); org.wait_for_selector('.t-head .fee-tag')
    assert '150 Kč' in org.inner_text('.fee-tag')
    assert sql(f"select fee || ':' || entry_fee || ':' || cardinality(cashiers) from tournaments where id = '{tid}'") == 'true:150:2'

    # ── organizátor: kontrola registrace s platbou ──
    go(org, f'/t/{tid}/players', '.rc-panel .pay-sum')
    assert 'zaplaceno 0 /' in org.inner_text('.pay-sum')
    org.click('[data-check]:has-text("Hrac1")'); org.wait_for_selector('.modal .pay-check')
    org.check('.modal [data-pay]'); org.wait_for_selector('.modal .pay-check.on')
    org.screenshot(path=OUT + '311_check_pay.png')
    org.click('.modal [data-close]'); org.wait_for_selector('.pay-tag.on')
    assert 'vybráno 150 Kč' in org.inner_text('.pay-sum')
    # Řízení: upozornění na nezaplacené
    go(org, f'/t/{tid}/manage', '[data-act=start]')
    assert 'nezaplatilo' in org.inner_text('main')

    # ── pokladník: jen vstupné ──
    k = ctx(b, 'hrac9@test.cz')
    go(k, f'/t/{tid}/players', '.rc-panel')
    assert 'Vstupné' in k.inner_text('.rc-panel h3')
    assert k.locator('.pay-row').count() >= 5
    k.click('[data-check]:has-text("Hrac2")'); k.wait_for_selector('.modal .pay-check')
    assert k.locator('.modal [data-bey]').count() == 0, 'pokladník beyblady nekontroluje'
    k.check('.modal [data-pay]'); k.wait_for_selector('.modal .pay-check.on')
    k.click('.modal [data-close]'); k.wait_for_selector('.pay-row.rc-ok:has-text("Hrac2")')
    k.screenshot(path=OUT + '312_cashier_list.png', full_page=True)
    assert sql(f"select count(*) from registrations where tournament_id = '{tid}' and paid_at is not null") == '2'
    assert sql(f"select p.nick from registrations r join profiles p on p.id = r.paid_by where r.tournament_id = '{tid}' and r.nick = 'Hrac2'") == 'Hrac9'

    # ── hráč: vstupenka ──
    h1 = ctx(b, 'hrac1@test.cz')
    go(h1, f'/t/{tid}', '.pass')
    assert 'Vstupné zaplaceno' in h1.inner_text('.pass')
    h3 = ctx(b, 'hrac3@test.cz')
    go(h3, f'/t/{tid}', '.pass')
    assert '150 Kč zaplať' in h3.inner_text('.pass')
    # běžný hráč vstupné ostatních nevidí
    go(h3, f'/t/{tid}/players', '.list')
    assert h3.locator('.pay-tag').count() == 0
    b.close()

if errors: print(*errors, sep='\n'); raise SystemExit(1)
print('CASHIER UI OK')
