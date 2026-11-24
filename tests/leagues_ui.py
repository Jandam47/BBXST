# Ligy: založení hlavním adminem, správce, ligový turnaj v editoru, tabulka s bilancí, profil, nápověda.
# Spouštět po čerstvém tests/ui-up.sh.
import re, subprocess, os, json
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

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── hlavní admin založí ligu ──
    adm = ctx(b, 'adam@test.cz')
    adm.click('.tabbar a[data-tab=players]'); adm.wait_for_selector('.cw-overlay .cw-sec')
    adm.click('.cw-sec[data-i="2"]'); adm.wait_for_selector('[data-act=new]')     # kolečko Hráči → Ligy
    adm.click('[data-act=new]'); adm.wait_for_selector('#f-league')
    adm.fill('#f-league [name=name]', 'Pardubická liga – zima 2026')
    adm.fill('#f-league [name=description]', 'Ligové turnaje v Pardubicích od listopadu do února. Nejlepší tři dostanou pohár.')
    adm.screenshot(path=OUT + '220_league_form.png')
    adm.click('#f-league button.primary'); adm.wait_for_selector('.lg-head h1')
    lid = adm.url.split('#/l/')[1]
    assert sql(f"select name from leagues where id = '{lid}'") == 'Pardubická liga – zima 2026'
    assert 'Tabulka se naplní' in adm.inner_text('#lg-body')

    # ── správce ligy ──
    adm.click('[data-tab=staff]'); adm.click('[data-act=add-staff]'); adm.wait_for_selector('#f-staff')
    adm.select_option('#f-staff [name=user]', label='Org')
    adm.select_option('#f-staff [name=role]', 'manager')
    adm.click('#f-staff button.primary'); adm.wait_for_selector('.li:has-text("Org") >> text=Správce ligy')
    adm.screenshot(path=OUT + '221_league_staff.png')

    # skončený turnaj do ligy (jako by ho zařadil správce)
    sql(f"update tournaments set league_id = '{lid}' where name = 'Pardubice Cup'")

    # ── organizátor zařadí turnaj do ligy v editoru ──
    org = ctx(b, 'org@test.cz')
    zid = sql("select id from tournaments where name = 'Zimní Pardubice Open'")
    go(org, f'/t/{zid}/edit', '.lg-pick select')
    org.select_option('.lg-pick select', lid)
    org.locator('.lg-pick').scroll_into_view_if_needed()
    org.screenshot(path=OUT + '222_editor_league.png')
    org.click('#f-t button.primary.block'); org.wait_for_selector(f'.t-head .lg-tag[href="#/l/{lid}"]')
    assert sql(f"select league_id from tournaments where id = '{zid}'") == lid
    go(org, '/', '.t-card .lg-tag')
    org.screenshot(path=OUT + '223_home_league_tag.png', clip={'x': 0, 'y': 0, 'width': 390, 'height': 600})
    # nový turnaj z ligy má ligu předvybranou
    go(org, f'/l/{lid}', '.lg-head')
    org.click(f'a[href="#/new?league={lid}"]'); org.wait_for_selector('.lg-pick select')
    assert org.eval_on_selector('.lg-pick select', 'e => e.value') == lid

    # ── tabulka ──
    h1 = ctx(b, 'hrac1@test.cz')
    go(h1, f'/l/{lid}', '.lg-row')
    data = json.loads(sql(f"select league_detail('{lid}')::text"))
    top = data['standings'][0]
    first = h1.locator('.lg-row').first
    assert top['nick'] in first.inner_text() and str(top['points']) in first.locator('.lg-pts').inner_text()
    assert h1.locator('.lg-row').count() == len(data['standings'])
    assert f"+{top['plus']}" in first.inner_text() and f"−{top['minus']}" in first.inner_text()
    h1.screenshot(path=OUT + '224_league_table.png')
    me = h1.locator('.lg-row.is-me')
    if me.count():
        me.locator('summary').click(); me.locator('.lg-res').first.wait_for()
        me.scroll_into_view_if_needed()
        h1.screenshot(path=OUT + '225_league_row_open.png')
    h1.click('[data-tab=events]'); h1.wait_for_selector('#lg-body .li:has-text("Pardubice Cup")')
    assert 'Zimní Pardubice Open' in h1.inner_text('#lg-body')
    assert h1.locator('[data-tab=staff]').count() == 0, 'hráč správu nevidí'
    go(h1, '/leagues', '.lg-card')
    h1.screenshot(path=OUT + '226_league_list.png')

    # ── profil: umístění v lize ──
    u1 = sql("select id from profiles where nick = 'Hrac1'")
    if sql(f"select count(*) from registrations r join tournaments t on t.id = r.tournament_id where t.name = 'Pardubice Cup' and r.user_id = '{u1}'") != '0':
        go(h1, '/me', '.lg-badge')
        assert 'Pardubická liga' in h1.inner_text('.lg-badges')
        h1.screenshot(path=OUT + '227_profile_league.png', clip={'x': 0, 'y': 0, 'width': 390, 'height': 420})

    # ── admin v profilu organizátora vidí ligové role ──
    uo = sql("select id from profiles where nick = 'Org'")
    go(adm, f'/p/{uo}', '.lg-roles select')
    assert adm.eval_on_selector('.lg-roles select', 'e => e.value') == 'manager'
    adm.select_option('.lg-roles select', 'organizer'); adm.wait_for_selector('.toast')
    assert sql(f"select role from league_staff where user_id = '{uo}'") == 'organizer'
    adm.locator('.lg-roles').scroll_into_view_if_needed()
    adm.screenshot(path=OUT + '228_profile_league_roles.png')
    # hráč v profilu jiného hráče ligové role nevidí
    go(h1, f'/p/{uo}', '.prof-head')
    assert h1.locator('.lg-roles').count() == 0

    # ── nápověda ──
    go(h1, '/help?k=league', '#h-league[open] .help-pts')
    h1.screenshot(path=OUT + '229_help_league.png')

    b.close()

if errors:
    print('CHYBY V KONZOLI:', *errors, sep='\n  ')
    raise SystemExit(1)
print('LEAGUES UI OK')
