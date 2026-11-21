// Integrační test 24-judge-count.sql: počítadlo odjudgovaných zápasů na profilu.
// Spuštění: node tests/judge-count.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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



const judge = await newUser('JJud' + sfx, 'judge')
const [t] = (await db.query("insert into tournaments (name) values ($1) returning id", ['Judge test ' + sfx])).rows
const DECK = JSON.stringify([
  { type: 'bx', blade: 'dran sword', ratchet: '3-60', bit: 'flat' },
  { type: 'cx', lock: 'Wizard', main: 'Arc', assist: 'Round', ratchet: '4-55', bit: 'Low Orb' },
  { type: 'bx', blade: 'Hells Nether', bit: 'Ball' },
])
const reg = async (nick, user = null) => (await db.query('insert into registrations (tournament_id, user_id, nick, deck) values ($1, $2, $3, $4) returning id', [t.id, user, nick, DECK])).rows[0].id
const a = await newUser('JA' + sfx), b = await newUser('JB' + sfx)
const ra = await reg(a.nick, a.id), rb = await reg(b.nick, b.id), t1 = await reg('T-Jedna'), t2 = await reg('T-Dva')
let k = 0
const match = async (p1, p2, games) => {
  const [m] = (await db.query(`insert into matches (tournament_id, stage, round, pos, key, p1_reg, p2_reg, status, winner_reg, loser_reg, p1_score, p2_score)
    values ($1, 'swiss', 1, $2, $3, $4, $5, 'done', $4, $5, 7, 3) returning id`, [t.id, ++k, 'J' + k, p1, p2])).rows
  for (let i = 0; i < games; i++) await db.query('insert into games (match_id, game_no, p1_score, p2_score, winner_slot, judge_id) values ($1, $2, 7, 3, 1, $3)', [m.id, i + 1, judge.id])
}
const cnt = async () => (await as(null, 'select player_judged($1) r', [judge.id]))[0].r
assert.deepEqual(await cnt(), { matches: 0, tournaments: 0 })
await match(t1, t2, 1)
assert.equal((await cnt()).matches, 0, 'zápas jen testovacích hráčů se nepočítá')
await match(ra, rb, 3)
await match(ra, t1, 1)
assert.deepEqual(await cnt(), { matches: 2, tournaments: 1 }, 'BO3 = jeden zápas, hráč proti testovacímu se počítá')
step('počítají se zápasy, ne hry; testovací zápasy ne')
await db.query("update tournaments set status = 'canceled' where id = $1", [t.id])
assert.equal((await cnt()).matches, 0)
step('zrušený turnaj se nepočítá')
await db.end()
console.log(`\n${ok} kroků OK`)
