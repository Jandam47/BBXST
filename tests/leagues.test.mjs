// Integrační test 22-leagues.sql: ligy, správci a organizátoři, ligové turnaje, bodování a bilance.
// Spuštění: node tests/leagues.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user.id, role: 'authenticated' })])
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

const boss = await newUser('LBoss' + sfx, 'superadmin')
const admin = await newUser('LAdm' + sfx, 'admin')
const mgr = await newUser('LMgr' + sfx, 'organizer')
const org = await newUser('LOrg' + sfx, 'organizer')
const org2 = await newUser('LOrh' + sfx, 'organizer')
const judge = await newUser('LJud' + sfx, 'judge')
const P = []
for (const k of 'abcdef') P.push(await newUser('LP' + k + sfx))

// ── založení ligy ──────────────────────────────────────────────────
await fails(admin, 'select league_save(null, $1)', ['Liga ' + sfx], /hlavní admin/)
const lid = await one(boss, 'league_save', [null, 'Pardubická liga ' + sfx, 'Zima 2026'])
await fails(boss, 'select league_save(null, $1)', ['pardubická LIGA ' + sfx], /už existuje/)
await fails(boss, "select league_save(null, $1, null, '{\"p1\": -1}')", ['Jiná ' + sfx], /0–100/)
const other = await one(boss, 'league_save', [null, 'Jiná liga ' + sfx])
await fails(mgr, "insert into leagues (name) values ('hack')", [], /permission/)
step('ligu zakládá jen hlavní admin')

// ── správce a organizátoři ─────────────────────────────────────────
await fails(admin, 'select league_staff_set($1, $2, $3)', [lid, mgr.id, 'manager'], /hlavní admin/)
await as(boss, 'select league_staff_set($1, $2, $3)', [lid, mgr.id, 'manager'])
await fails(boss, 'select league_staff_set($1, $2, $3)', [lid, judge.id, 'organizer'], /organizátor/)
await fails(org2, 'select league_staff_set($1, $2, $3)', [lid, org.id, 'organizer'], /správce nebo admin/)
await as(mgr, 'select league_staff_set($1, $2, $3)', [lid, org.id, 'organizer'])       // správce přidá organizátora
await fails(mgr, 'select league_staff_set($1, $2, $3)', [other, org.id, 'organizer'], /správce nebo admin/)
await fails(mgr, 'select league_staff_set($1, $2, $3)', [lid, org2.id, 'manager'], /hlavní admin/)
await as(admin, 'select league_staff_set($1, $2, $3)', [other, org2.id, 'organizer'])   // admin ve všech ligách
assert.deepEqual((await one(org, 'my_leagues')).map(l => l.id), [lid])
assert.deepEqual((await one(org2, 'my_leagues')).map(l => l.id), [other])
assert.equal((await one(admin, 'my_leagues')).length >= 2, true)
step('správce jmenuje hlavní admin, organizátory správce nebo admin')

// ── ligový turnaj ──────────────────────────────────────────────────
await fails(org2, 'insert into tournaments (name, league_id) values ($1, $2)', ['X', lid], /nemůžeš/)
await fails(org, "insert into tournaments (name, kind, league_id) values ($1, 'event', $2)", ['X', lid], /jen turnaj/)
const mk = async (user, name) => (await as(user, 'insert into tournaments (name, swiss_rounds, top_cut, league_id) values ($1, 3, 4, $2) returning id', [name, lid]))[0].id
const t1 = await mk(org, 'Liga kolo 1 ' + sfx)
const t2 = await mk(mgr, 'Liga kolo 2 ' + sfx)
const [t3] = await as(org2, 'insert into tournaments (name) values ($1) returning id', ['Neligový ' + sfx])
await fails(org2, 'update tournaments set league_id = $2 where id = $1', [t3.id, lid], /nemůžeš/)
await as(org2, 'update tournaments set league_id = $2 where id = $1', [t3.id, other])
await as(org2, 'update tournaments set name = name where id = $1', [t3.id])              // bez změny ligy projde
// odebrání organizátora → už nemůže turnaj z ligy vyřadit ani zakládat
await as(mgr, 'select league_staff_set($1, $2, null)', [lid, org.id])
await fails(org, 'update tournaments set league_id = null where id = $1', [t1], /vyřadit/)
await fails(org, 'insert into tournaments (name, league_id) values ($1, $2)', ['Y', lid], /nemůžeš/)
await as(mgr, 'select league_staff_set($1, $2, $3)', [lid, org.id, 'organizer'])
step('ligový turnaj smí založit jen správce / organizátor ligy, hlídá i úpravu')

// ── výsledky a bodování ────────────────────────────────────────────
const DECK = JSON.stringify([
  { type: 'bx', blade: 'dran sword', ratchet: '3-60', bit: 'flat' },
  { type: 'cx', lock: 'Wizard', main: 'Arc', assist: 'Round', ratchet: '4-55', bit: 'Low Orb' },
  { type: 'bx', blade: 'Hells Nether', bit: 'Ball' },
])
const reg = async (t, p) => (await as(p, 'insert into registrations (tournament_id, nick, deck) values ($1, $2, $3) returning id', [t, p.nick, DECK]))[0].id
// turnaj 1: a–f, top 4 = a,b,c,d (a 1., b 2., c 3., d 4.), e 5., f 6.
const R1 = {}; for (const p of P) R1[p.nick] = await reg(t1, p)
const guest = (await db.query("insert into registrations (tournament_id, user_id, nick, deck) values ($1, null, 'HostLigy', $2) returning id", [t1, DECK])).rows[0].id
const test = (await db.query("insert into registrations (tournament_id, user_id, nick, deck) values ($1, null, 'T-Bot', $2) returning id", [t1, DECK])).rows[0].id
let k = 0
const match = async (t, a, b, sa, sb, stage = 'swiss', bye = false) => db.query(
  `insert into matches (tournament_id, stage, round, pos, key, p1_reg, p2_reg, status, winner_reg, loser_reg, p1_score, p2_score, is_bye, finished_at)
   values ($1, $2, 1, $3, $4, $5, $6, 'done', $7, $8, $9, $10, $11, now())`,
  [t, stage, ++k, 'K' + k, a, b, sa > sb ? a : b, bye ? null : (sa > sb ? b : a), sa, sb, bye])
const [a, b, c, d, e, f] = P.map(p => R1[p.nick])
await match(t1, a, e, 7, 2); await match(t1, b, f, 7, 0); await match(t1, c, guest, 7, 5); await match(t1, d, test, 7, 6)
await match(t1, a, b, 7, 4, 'wb'); await match(t1, a, b, 7, 6, 'gf')
await match(t1, f, null, 7, 0, 'swiss', true)                     // volný los se do bilance nepočítá
const places = { [a]: 1, [b]: 2, [c]: 3, [d]: 4, [e]: 5, [f]: 6, [guest]: 7, [test]: 8 }
for (const [r, pl] of Object.entries(places)) await db.query('update registrations set final_place = $2, seed = $3 where id = $1', [r, pl, pl <= 4 ? pl : null])
await db.query("update tournaments set status = 'finished', finished_at = now() where id = $1", [t1])
// turnaj 2: jen a, b – bez top cutu; b 1., a 2.
const a2 = await reg(t2, P[0]), b2 = await reg(t2, P[1])
await match(t2, a2, b2, 3, 7)
await db.query('update registrations set final_place = case id when $2 then 1 else 2 end where tournament_id = $1', [t2, b2])
await db.query("update tournaments set status = 'finished', finished_at = now() where id = $1", [t2])

let L = await one(null, 'league_detail', [lid])
const row = (nick) => L.standings.find(s => s.nick === nick)
// a: t1 = 1 účast + 1 top cut + 5 = 7, t2 = 1 + 0 + 3 = 4 → 11
assert.equal(row(P[0].nick).points, 11); assert.equal(row(P[0].nick).events, 2)
assert.deepEqual([row(P[0].nick).wins, row(P[0].nick).losses, row(P[0].nick).plus, row(P[0].nick).minus], [3, 1, 24, 19])
// b: t1 = 1 + 1 + 3 = 5, t2 = 1 + 0 + 5 = 6 → 11; a má víc výher → a před b
assert.equal(row(P[1].nick).points, 11)
assert.equal(L.standings[0].nick, P[0].nick); assert.equal(L.standings[1].nick, P[1].nick)
assert.equal(row(P[2].nick).points, 1 + 1 + 2); assert.equal(row(P[3].nick).points, 1 + 1 + 1)
assert.equal(row(P[4].nick).points, 1)
assert.deepEqual([row(P[5].nick).wins, row(P[5].nick).plus], [0, 0], 'volný los se nepočítá')
assert.equal(row('HostLigy').points, 1); assert.equal(row('HostLigy').user, null)
assert.equal(row('T-Bot'), undefined, 'testovací hráč bez účtu se nepočítá')
assert.equal(row(P[0].nick).results.length, 2)
assert.equal(L.tournaments.length, 2); assert.equal(L.tournaments.find(t => t.id === t1).winner, P[0].nick)
assert.equal(L.can.edit, false); assert.equal(L.can.create, false)
assert.equal((await one(mgr, 'league_detail', [lid])).can.organizers, true)
assert.equal((await one(org, 'league_detail', [lid])).can.create, true)
step('bodování: účast, top cut, umístění; bilance V–P a body +/−')

// běžící turnaj se nepočítá
const t4 = await mk(org, 'Liga kolo 3 ' + sfx)
await reg(t4, P[2])
L = await one(null, 'league_detail', [lid])
assert.equal(row(P[2].nick).events, 1)
const list = await one(null, 'league_list')
const ll = list.find(x => x.id === lid)
assert.equal(ll.tournaments, 3); assert.equal(ll.finished, 2); assert.equal(ll.leader.nick, P[0].nick); assert.equal(ll.manager.nick, mgr.nick)
const pl = await one(null, 'player_leagues', [P[1].id])
assert.equal(pl.standings[0].rank, 2); assert.equal(pl.standings[0].points, 11)
const roles = await one(mgr, 'player_leagues', [org.id])
const rl = roles.roles.find(r => r.league === lid)
assert.equal(rl.role, 'organizer'); assert.equal(rl.can_org, true); assert.equal(rl.can_mgr, false)
const tl = await as(null, 'select league from tournament_list() where id = $1', [t1])
assert.equal(tl[0].league, 'Pardubická liga ' + sfx)
step('přehled lig, umístění v profilu, název ligy v seznamu turnajů')

// ── kraj (38): ligový turnaj = kraj ligy, změna kraje ligy přepíše její turnaje ──
assert.equal((await as(null, 'select region from tournament_list() where id = $1', [t1]))[0].region, null)
await as(boss, 'select league_save($1, $2, $3, null, true, $4)', [lid, 'Pardubická liga ' + sfx, 'Zima 2026', 'Pardubický'])
assert.equal((await one(null, 'league_detail', [lid])).league.region, 'Pardubický')
assert.equal((await db.query('select region from tournaments where id = $1', [t1])).rows[0].region, 'Pardubický', 'turnaje ligy převezmou kraj')
const tR = await mk(org, 'Krajový ' + sfx)
assert.equal((await db.query('select region from tournaments where id = $1', [tR])).rows[0].region, 'Pardubický')
await as(org, "update tournaments set region = 'Zlínský' where id = $1", [tR])
assert.equal((await db.query('select region from tournaments where id = $1', [tR])).rows[0].region, 'Pardubický', 'ligový turnaj kraj nezmění')
const [tF] = await as(org2, "insert into tournaments (name, region) values ($1, 'Zlínský') returning id, region", ['Volný ' + sfx])
assert.equal(tF.region, 'Zlínský')
await fails(org2, "insert into tournaments (name, region) values ($1, 'Mordor')", ['Špatný ' + sfx], /region/)
await fails(boss, 'select league_save(null, $1, null, null, true, $2)', ['Kraj ' + sfx, 'Mordor'], /region/)
assert.equal((await one(null, 'league_list')).find(x => x.id === lid).region, 'Pardubický')
assert.equal((await as(null, 'select region from tournament_list() where id = $1', [tR]))[0].region, 'Pardubický')
step('kraj: liga s krajem, ligové turnaje ho převezmou, neplatný kraj neprojde')

// vlastní bodování a archiv
await as(boss, "select league_save($1, $2, null, '{\"p1\": 10, \"participation\": 0}', false)", [lid, 'Pardubická liga ' + sfx])
L = await one(null, 'league_detail', [lid])
assert.equal(row(P[0].nick).points, 1 + 10 + 3, 'a: 0+1+10 a 0+0+3')
assert.equal(row(P[4].nick).points, 0)
assert.equal((await one(org, 'my_leagues')).length, 0, 'do archivované ligy se nezakládá')
await fails(org, 'insert into tournaments (name, league_id) values ($1, $2)', ['Z', lid], /nemůžeš/)
await as(boss, 'select league_delete($1)', [lid])
assert.equal((await db.query('select league_id from tournaments where id = $1', [t1])).rows[0].league_id, null)
assert.equal(await one(null, 'league_detail', [lid]), null)
step('vlastní bodování, archiv, smazání ligy (turnaje zůstanou)')

await db.end()
console.log(`\n${ok} kroků OK`)
