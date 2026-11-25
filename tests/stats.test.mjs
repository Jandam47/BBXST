// Integrační test 36-stats.sql: počítadla, rekordy, filtry (sezóna, kraj, liga), soukromí, profil, komunitní ladder.
// Spuštění: node tests/stats.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user.id, role: 'authenticated', is_anonymous: false })])
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
const one = async (user, sql, params = []) => (await as(user, sql, params))[0]
const DECK = (b1) => JSON.stringify([
  { type: 'bx', blade: b1, ratchet: '3-60', bit: 'Flat' },
  { type: 'cx', lock: 'Wizard', main: 'Arc', assist: 'Round', ratchet: '4-55', bit: 'Low Orb' },
  { type: 'bx', blade: 'Hells Nether', bit: 'Ball' },
])
const A = await newUser('SA' + sfx), B = await newUser('SB' + sfx), C = await newUser('SC' + sfx)
const J = await newUser('SJ' + sfx, 'judge'), org = await newUser('SO' + sfx, 'organizer'), adm = await newUser('SX' + sfx, 'admin')
await db.query("update profiles set region = 'Hlavní město Praha' where id = $1", [C.id])

// turnaj v roce 2025, skončený
const [t] = await as(org, `insert into tournaments (name, swiss_rounds, top_cut, arena_count, starts_at) values ('Stats ${sfx}', 3, 0, 1, '2025-06-01') returning id`)
const reg = {}
for (const [u, b1] of [[A, 'Dran Sword'], [B, 'Wizard Rod'], [C, 'Phoenix Wing']])
  reg[u.nick] = ((await as(u, 'insert into registrations (tournament_id, nick, deck) values ($1, $2, $3) returning id', [t.id, u.nick, DECK(b1)]))[0].id)
await db.query("update tournaments set status = 'finished' where id = $1", [t.id])

let mi = 0
async function match(p1, p2, winner, finishedAt, games) {
  mi++
  const [m] = (await db.query(`insert into matches (tournament_id, stage, round, key, p1_reg, p2_reg, status, winner_reg, loser_reg, started_at, finished_at)
    values ($1, 'swiss', $2, $3, $4, $5, 'done', $6, $7, $8, $8) returning id`,
    [t.id, mi, 'S' + mi, reg[p1.nick], reg[p2.nick], reg[winner.nick], reg[(winner === p1 ? p2 : p1).nick], finishedAt])).rows
  for (const [gno, gm] of games.entries()) {
    const s1 = gm.pts.filter(x => x[0] === 1).reduce((a, x) => a + x[1], 0), s2 = gm.pts.filter(x => x[0] === 2).reduce((a, x) => a + x[1], 0)
    const [g] = (await db.query(`insert into games (match_id, game_no, p1_score, p2_score, winner_slot, judge_id, started_at, created_at)
      values ($1, $2, $3, $4, $5, $6, $7::timestamptz - make_interval(secs => $8), $7) returning id`,
      [m.id, gno + 1, s1, s2, s1 > s2 ? 1 : 2, gm.judge || null, finishedAt, gm.secs])).rows
    for (const [i, [slot, pts, fin]] of gm.pts.entries())
      await db.query('insert into points (game_id, seq, scorer_slot, pts, finish) values ($1, $2, $3, $4, $5)', [g.id, i + 1, slot, pts, fin || null])
  }
}
// A vs B: B vede 0:6, A otočí na 7:6 (tableflip), 90 s
await match(A, B, A, '2025-06-01 10:00', [{ secs: 90, judge: J.id, pts: [[2, 3, 'xtreme'], [2, 3, 'xtreme'], [1, 3, 'xtreme'], [1, 2, 'burst'], [1, 2, 'over']] }])
// A vs C: remíza, pak A 7:0 (no_time), 40 s
await match(A, C, A, '2025-06-01 11:00', [{ secs: 40, judge: J.id, pts: [[0, 0], [1, 1, 'spin'], [1, 3, 'xtreme'], [1, 3, 'xtreme']] }])
// B vs C: C 7:2, 600 s (nejdelší)
await match(B, C, C, '2025-06-01 12:00', [{ secs: 600, pts: [[1, 2, 'over'], [2, 3, 'xtreme'], [2, 2, 'burst'], [2, 2, 'over']] }])

const L = (u, season = null, region = null, league = null) => one(u, 'select stats_ladder($1, $2, $3, 50) as r', [season, region, league]).then(x => x.r)
const val = (l, key, u) => l.counters[key]?.find(x => x.user === u.id)?.value ?? 0
let l = await L(C)
assert.equal(val(l, 'xtreme', A), 3); assert.equal(val(l, 'xtreme', B), 2); assert.equal(val(l, 'xtreme', C), 1)
assert.equal(val(l, 'glueless', A), 1); assert.equal(val(l, 'glueless', C), 1)
assert.equal(val(l, 'rickety', B), 2, 'B dostal burst od A i od C'); assert.equal(val(l, 'rickety', A), 0)
assert.equal(val(l, 'game_over', A), 1); assert.equal(val(l, 'breakdancer', A), 1)
assert.equal(val(l, 'tableflip', A), 1); assert.equal(val(l, 'tableflip', C), 0)
assert.equal(val(l, 'no_time', A), 1)
assert.equal(val(l, 'draws', A), 1); assert.equal(val(l, 'draws', C), 1)
assert.equal(val(l, 'streak', A), 2); assert.equal(val(l, 'streak', C), 1)
assert.equal(val(l, 'iron_law', J), 2)
assert.equal(val(l, 'no_rod', A), 1); assert.equal(val(l, 'no_rod', B), 0, 'B má Wizard Rod')
assert.equal(l.counters.xtreme[0].user, A.id); assert.equal(l.counters.xtreme[0].rank, 1)
assert.equal(l.me.xtreme.value, 1)
assert.equal(l.blitz.filter(g => g.tournament_id === t.id)[0].w_nick, A.nick)
const myTyt = l.tyt.filter(g => g.tournament_id === t.id)
assert.equal(myTyt[0].secs, 600); assert.equal(myTyt[0].w_nick, C.nick); assert.equal(myTyt[0].l_nick, B.nick)
step('počítadla a rekordy z jednoho turnaje')

assert.equal(val(await L(C, 2026), 'xtreme', A), 0, 'jiná sezóna')
assert.equal(val(await L(C, 2025), 'xtreme', A), 3)
assert.ok((await one(null, 'select stat_seasons() as r')).r.includes(2025))
const lp = await L(A, null, 'Hlavní město Praha')
assert.equal(val(lp, 'xtreme', A), 0); assert.equal(val(lp, 'xtreme', C), 1, 'kraj')
assert.equal(val(await L(A, null, null, adm.id), 'xtreme', A), 0, 'liga (jiné id) → nic')
step('filtry: sezóna, kraj, liga')

await as(B, `update profiles set privacy = '{"standings": true}' where id = auth.uid()`)
assert.equal(val(await L(A), 'xtreme', B), 0, 'skrytý hráč chybí ostatním')
assert.equal(val(await L(B), 'xtreme', B), 2, 'sám sebe vidí')
await as(B, `update profiles set privacy = '{}' where id = auth.uid()`)
assert.equal(val(await L(null), 'xtreme', B), 2, 'anon vidí ladder')
step('soukromí: Nebýt ve Standings')

const ps = (await one(null, 'select player_stat_ranks($1) as r', [A.id])).r
assert.equal(ps.values.xtreme.value, 3); assert.equal(ps.values.xtreme.rank, 1)
assert.equal(ps.blitz?.rank, 1)
const pc = (await one(null, 'select player_stat_ranks($1) as r', [C.id])).r
assert.equal(pc.tyt?.rank, 1); assert.equal((await one(null, 'select player_stat_ranks($1) as r', [B.id])).r.tyt?.rank, 1, 'T.Y.T. drží oba')
step('profil: hodnoty, pořadí a rekordy')

const [cm] = (await db.query("insert into communities (name, status, created_by) values ($1, 'approved', $2) returning id", ['Stats komunita ' + sfx, org.id])).rows
await fails(A, 'select community_stats_ladder($1)', [cm.id], /jen členové/)
const cl = (await one(adm, 'select community_stats_ladder($1) as r', [cm.id])).r
assert.equal(cl.community.id, cm.id); assert.deepEqual(cl.counters, {})
await fails(null, 'select community_stats_ladder($1)', [cm.id], /permission/)
step('komunitní ladder: jen členové / admin')

console.log(`\n${ok} kroků OK`)
await db.end()
