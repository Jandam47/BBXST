// Integrační test 23-meetings.sql: meeting osobně / online a akce viditelné jen organizátorům.
// Spuštění: node tests/meetings.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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


const org = await newUser('MOrg' + sfx, 'organizer')
const org2 = await newUser('MOrh' + sfx, 'organizer')
const judge = await newUser('MJud' + sfx, 'judge')
const pl = await newUser('MPl' + sfx)

// meeting pro všechny, online s odkazem
const [m1] = await as(org, `insert into tournaments (name, kind, event_type, meeting_mode, location) values ($1, 'event', 'meeting', 'online', 'https://meet.example/x') returning id, meeting_mode, visibility`, ['Porada ' + sfx])
assert.equal(m1.meeting_mode, 'online'); assert.equal(m1.visibility, 'all')
const [m0] = await as(org, `insert into tournaments (name, kind, event_type) values ($1, 'event', 'meeting') returning meeting_mode`, ['Sraz ' + sfx])
assert.equal(m0.meeting_mode, 'live', 'výchozí způsob je osobně')
await fails(org, `insert into tournaments (name, kind, event_type, meeting_mode) values ('X', 'event', 'meeting', 'tv')`, [], /meeting_mode/)
// jinde se viditelnost i způsob vynulují
const [tr] = await as(org, `insert into tournaments (name, kind, event_type, visibility, meeting_mode) values ($1, 'event', 'training', 'staff', 'online') returning visibility, meeting_mode`, ['Trénink ' + sfx])
assert.deepEqual([tr.visibility, tr.meeting_mode], ['all', null])
step('meeting: způsob osobně / online, viditelnost jen u meetingu')

// meeting jen pro organizátory
const [ms] = await as(org, `insert into tournaments (name, kind, event_type, visibility) values ($1, 'event', 'meeting', 'staff') returning id`, ['Org porada ' + sfx])
const sees = async (u) => (await as(u, 'select count(*)::int n from tournaments where id = $1', [ms.id]))[0].n === 1
const lists = async (u) => (await as(u, 'select count(*)::int n from tournament_list() where id = $1', [ms.id]))[0].n === 1
assert.equal(await sees(org), true); assert.equal(await sees(org2), true)
assert.equal(await sees(pl), false); assert.equal(await sees(judge), false); assert.equal(await sees(null), false)
assert.equal(await lists(org2), true); assert.equal(await lists(pl), false); assert.equal(await lists(null), false)
assert.equal(await lists(pl), false)
assert.equal((await as(pl, 'select count(*)::int n from tournament_list() where id = $1', [m1.id]))[0].n, 1, 'veřejný meeting vidí každý')
await fails(pl, 'insert into registrations (tournament_id, nick) values ($1, $2)', [ms.id, pl.nick], /neexistuje/)
await as(org2, 'insert into registrations (tournament_id, nick) values ($1, $2)', [ms.id, org2.nick])
await as(pl, 'insert into registrations (tournament_id, nick) values ($1, $2)', [m1.id, pl.nick])
step('meeting jen pro organizátory: hráč, judge ani host ho nevidí a nepřihlásí se')

// zakladatel vidí svoji akci, i když by funkci ztratil
await db.query("update profiles set role = 'player' where id = $1", [org.id])
assert.equal(await sees(org), true)
step('zakladatel vidí svoji skrytou akci vždy')

await db.end()
console.log(`\n${ok} kroků OK`)
