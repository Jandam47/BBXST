// Integrační test 21-checkin-errors-backup.sql: prezence, chyby z telefonů, záloha, vzájemná bilance.
// Spuštění: node tests/extras.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
import pg from 'pg'
import assert from 'node:assert/strict'

const db = new pg.Client({ host: '/tmp/pg', port: 5499, user: 'postgres', database: 'bbx' })
await db.connect()
let ok = 0
const step = (s) => { ok++; console.log('✓', s) }
const sfx = Math.random().toString(36).slice(2, 6)

async function as(user, sql, params = []) {
  await db.query('reset role')
  if (user) {
    await db.query("select set_config('request.jwt.claims', $1, false)",
      [JSON.stringify({ sub: user.id, role: 'authenticated', is_anonymous: !!user.anon })])
    await db.query('set role authenticated')
  } else {
    await db.query("select set_config('request.jwt.claims', '', false)")
    await db.query('set role anon')
  }
  try { return (await db.query(sql, params)).rows } finally { await db.query('reset role') }
}
async function fails(user, sql, params, re) {
  try { await as(user, sql, params) } catch (e) { if (re) assert.match(e.message, re); return e.message }
  throw new Error('Mělo selhat: ' + sql)
}
async function newUser(nick, role = null) {
  const [u] = (await db.query('insert into auth.users (is_anonymous) values (false) returning id')).rows
  const user = { id: u.id, nick }
  await as(user, 'update profiles set nick = $1 where id = auth.uid()', [nick])
  if (role) await db.query('update profiles set role = $1 where id = $2', [role, u.id])
  return user
}
const one = async (user, fn, args = []) => (await as(user, `select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args))[0].r

const DECK = JSON.stringify([
  { type: 'bx', blade: 'dran sword', ratchet: '3-60', bit: 'flat' },
  { type: 'cx', lock: 'Wizard', main: 'Arc', assist: 'Round', ratchet: '4-55', bit: 'Low Orb' },
  { type: 'bx', blade: 'Hells Nether', bit: 'Ball' },
])
const boss = await newUser('XBoss' + sfx, 'superadmin')
const admin = await newUser('XAdm' + sfx, 'admin')
const org = await newUser('XOrg' + sfx, 'organizer')
const judge = await newUser('XJud' + sfx, 'judge')
const ps = []
for (const k of ['a', 'b', 'c', 'd']) ps.push(await newUser('XP' + k + sfx))

// ── prezence ───────────────────────────────────────────────────────
const [t] = await as(org, `insert into tournaments (name, swiss_rounds, top_cut, arena_count) values ('Prezence ${sfx}', 3, 0, 1) returning id`)
for (const p of ps) {
  const [r] = await as(p, 'insert into registrations (tournament_id, nick, deck) values ($1, $2, $3) returning id', [t.id, p.nick, DECK])
  p.reg = r.id
}
const tok = async (p) => (await as(p, 'select qr_token, checked_in_at from my_registration($1)', [t.id]))[0]
const a0 = await tok(ps[0])
assert.equal(a0.checked_in_at, null)
// hráč si prezenci nepodvrhne
await as(ps[0], 'update registrations set checked_in_at = now() where id = $1', [ps[0].reg])
assert.equal((await tok(ps[0])).checked_in_at, null)
await fails(ps[1], 'select checkin($1, $2)', [t.id, a0.qr_token], /judge nebo organizátor/)
let r = await one(judge, 'checkin', [t.id, a0.qr_token])
assert.equal(r.nick, ps[0].nick); assert.equal(r.already, false)
r = await one(org, 'checkin', [t.id, a0.qr_token])
assert.equal(r.already, true)
assert.ok((await tok(ps[0])).checked_in_at, 'vstupenka ukáže prezenci')
await fails(org, 'select checkin($1, $2)', [t.id, '00000000-0000-0000-0000-000000000000'], /nepatří/)
await as(org, 'select checkin($1, null, $2)', [t.id, ps[1].reg])
await as(org, 'select checkin($1, null, $2, true)', [t.id, ps[2].reg])
await as(org, 'select checkin($1, null, $2, false)', [t.id, ps[2].reg])
let list = await as(org, 'select * from checkin_list($1)', [t.id])
assert.equal(list.filter(x => x.checked_in_at).length, 2)
assert.equal((await as(ps[0], 'select * from checkin_list($1)', [t.id])).length, 0, 'hráč seznam nevidí')
step('prezence: sken vstupenky, odškrtnutí, hráč ji nepodvrhne')

// kontrola registrací (25): QR → registrace, změna beybladů kontrolu zruší
assert.equal(await one(org, 'checkin_lookup', [t.id, a0.qr_token]), ps[0].reg)
await fails(ps[1], 'select checkin_lookup($1, $2)', [t.id, a0.qr_token], /judge nebo organizátor/)
await as(ps[1], 'update registrations set deck = $2 where id = $1', [ps[1].reg, DECK.replace('"flat"', '"Ball"')])
assert.equal((await db.query('select checked_in_at from registrations where id = $1', [ps[1].reg])).rows[0].checked_in_at, null, 'jiné beyblady = znovu kontrolovat')
await as(org, 'select checkin($1, null, $2)', [t.id, ps[1].reg])
step('kontrola registrací: dohledání podle QR, změna decku kontrolu zruší')

await fails(judge, 'select drop_noshows($1)', [t.id], /nemůžeš/)
assert.equal(await one(org, 'drop_noshows', [t.id]), 2)
const st = (await db.query('select nick, status from registrations where tournament_id = $1 order by nick', [t.id])).rows
assert.deepEqual(st.map(x => x.status).sort(), ['active', 'active', 'dropped', 'dropped'])
await as(org, 'select start_tournament($1)', [t.id])
await fails(org, 'select drop_noshows($1)', [t.id], /už běží/)
step('před startem odstoupí hráči bez prezence')

// ── chyby z telefonů ───────────────────────────────────────────────
await as(null, "select log_client_error('bbxst', 'TypeError: x is undefined', 'TypeError\n at foo (bbxst.html:10)', 'bbxst.html', 'UA', 'bbxu-v41')")
await as(null, "select log_client_error('bbxst', 'TypeError: x is undefined', 'TypeError\n at foo (bbxst.html:10)', 'bbxst.html', 'UA', 'bbxu-v41')")
await as(ps[0], "select log_client_error('bbxu', 'Chyba v profilu', null, '#/me', 'UA', 'bbxu-v41')")
await as(ps[0], "select log_client_error('jine', 'nic', null, null, null, null)")
await fails(ps[0], 'select client_error_list()', [], /admini/)
await fails(ps[0], 'select * from client_errors', [], /permission/)
let errs = await one(admin, 'client_error_list')
const te = errs.find(e => e.app === 'bbxst')
assert.equal(te.count, 2, 'stejná chyba se jen počítá')
assert.equal(errs.find(e => e.app === 'bbxu').user.nick, ps[0].nick)
assert.equal(errs.length, 2, 'neznámá aplikace se neuloží')
assert.equal(await one(admin, 'client_error_count'), 2); assert.equal(await one(org, 'client_error_count'), 0)
assert.equal(await one(admin, 'client_error_resolve', [te.id]), 1)
assert.equal(await one(admin, 'client_error_count'), 1)
await as(null, "select log_client_error('bbxst', 'TypeError: x is undefined', 'TypeError\n at foo (bbxst.html:10)', 'bbxst.html', 'UA', 'bbxu-v41')")
assert.equal(await one(admin, 'client_error_count'), 2, 'vyřešená chyba se znovu objeví jako nová')
await as(admin, 'select client_error_resolve()')
assert.equal(await one(admin, 'client_error_count'), 0)
step('chyby z telefonů: uložení i bez účtu, počítání, seznam pro adminy')

// ── záloha ─────────────────────────────────────────────────────────
await fails(admin, 'select export_backup()', [], /hlavní admin/)
assert.equal(await one(admin, 'backup_status'), null)
const bk = await one(boss, 'export_backup')
assert.equal(bk.app, 'BBXU')
assert.ok(bk.tables.tournaments.some(x => x.id === t.id))
assert.ok(bk.tables.registrations.length >= 4)
assert.ok(!('bbx_settings' in bk.tables) && !('push_subscriptions' in bk.tables), 'tajné tabulky v záloze nejsou')
assert.equal(bk.counts.tournaments, bk.tables.tournaments.length)
assert.ok(await one(boss, 'backup_status'), 'čas poslední zálohy')
step('záloha: jen hlavní admin, bez tajných nastavení')

// ── vzájemná bilance ───────────────────────────────────────────────
const [A, B] = [ps[0], ps[1]]
const mk = async (i, winA, s1, s2) => db.query(`insert into matches (tournament_id, stage, round, pos, key, p1_reg, p2_reg, status, winner_reg, loser_reg,
    p1_score, p2_score, finished_at) values ($1, 'swiss', $2, 1, $3, $4, $5, 'done', $6, $7, $8, $9, now() - make_interval(mins => $2))`,
  [t.id, i, 'H' + i, A.reg, B.reg, winA ? A.reg : B.reg, winA ? B.reg : A.reg, s1, s2])
await db.query('delete from matches where tournament_id = $1', [t.id])
await mk(1, true, 7, 3); await mk(2, true, 7, 5); await mk(3, false, 2, 7)
let h = await one(B, 'player_h2h', [A.id])
assert.deepEqual([h.vs_me.wins, h.vs_me.losses], [1, 2], 'B proti A: 1 výhra, 2 prohry')
assert.equal(h.vs_me.recent.length, 3)
assert.equal(h.vs_me.recent[0].won, false); assert.equal(h.vs_me.recent[0].my, 3); assert.equal(h.vs_me.recent[0].opp, 7)
assert.equal(h.opponents[0].nick, B.nick); assert.equal(h.opponents[0].wins, 2)
h = await one(A, 'player_h2h', [A.id])
assert.equal(h.vs_me, null, 'sám proti sobě nic')
h = await one(null, 'player_h2h', [A.id])
assert.equal(h.vs_me, null); assert.equal(h.opponents.length, 1)
step('vzájemná bilance a nejčastější soupeři')

// ── soukromí (34) ──────────────────────────────────────────────────
const inList = async (u, who) => (await as(u, 'select id from players_list()')).some(r => r.id === who.id)
assert.ok(await inList(B, A))
await as(A, `update profiles set privacy = '{"h2h": true, "beys": true, "standings": true}' where id = auth.uid()`)
h = await one(B, 'player_h2h', [A.id])
assert.equal(h.opponents.length, 0); assert.deepEqual([h.vs_me.wins, h.vs_me.losses, h.vs_me.recent.length], [0, 0, 0], 'skrytá bilance')
assert.equal((await one(null, 'player_h2h', [A.id])).opponents.length, 0)
assert.equal((await one(A, 'player_h2h', [A.id])).opponents.length, 1, 'sám sebe vidí')
assert.ok(!(await inList(B, A)), 've Standings ho ostatní nevidí'); assert.ok(await inList(A, A), 'sám sebe ano')
assert.ok(!(await inList(null, A)))
await fails(A, `update profiles set privacy = '[1]' where id = auth.uid()`, [], /privacy/)
await as(B, `update profiles set privacy = '{}' where id = '${A.id}'`)
assert.equal((await db.query('select privacy->>$2 as v from profiles where id = $1', [A.id, 'h2h'])).rows[0].v, 'true', 'cizí soukromí nikdo nezmění')
await as(A, `update profiles set privacy = '{}' where id = auth.uid()`)
assert.equal((await one(B, 'player_h2h', [A.id])).opponents.length, 1); assert.ok(await inList(B, A))
step('soukromí: skrytá bilance, statistiky a Standings, vlastník vidí vše')

// ── počty pro Správu (34) ──────────────────────────────────────────
assert.equal(await one(org, 'admin_counts'), null)
let ac = await one(admin, 'admin_counts')
assert.equal(ac.requests, 0); assert.equal(ac.backup_at, null); assert.ok('reports' in ac && 'errors' in ac)
await as(null, "select log_client_error('bbxu', 'Error: správa', null, 'index.html', 'UA', 'v1')")
assert.equal((await one(admin, 'admin_counts')).errors, ac.errors + 1)
ac = await one(boss, 'admin_counts')
assert.ok(ac.backup_at, 'hlavní admin vidí čas zálohy')
await fails(null, 'select admin_counts()', [], /permission/)
step('admin_counts: jen admin 3+, žádosti a záloha jen hlavní admin')

await db.end()
console.log(`\n${ok} kroků OK`)
