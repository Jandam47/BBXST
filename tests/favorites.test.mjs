// Integrační test 35-favorites.sql: oblíbené buildy a decky.
// Spuštění: node tests/favorites.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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
async function newUser(nick, anon = false) {
  const [u] = (await db.query('insert into auth.users (is_anonymous) values ($1) returning id', [anon])).rows
  const user = { id: u.id, nick, anon }
  if (!anon) await as(user, 'update profiles set nick = $1 where id = auth.uid()', [nick])
  return user
}
const A = await newUser('FA' + sfx), B = await newUser('FB' + sfx), H = await newUser('FH' + sfx, true)
const ins = (u, bey, note = null) => as(u, 'insert into fav_builds (bey, note) values ($1, $2) returning id, name, bey', [JSON.stringify(bey), note])

// ── buildy ──
const [b1] = await ins(A, { type: 'bx', blade: 'dran sword', ratchet: '3-60', bit: 'flat' }, '  hlavní útok  ')
assert.equal(b1.name, 'Dran Sword 3-60F'); assert.equal(b1.bey.blade, 'Dran Sword', 'díly se normalizují')
const [b2] = await ins(A, { type: 'cx', lock: 'Wizard', main: 'Arc', assist: 'Round', ratchet: '4-55', bit: 'Low Orb' })
const [b3] = await ins(A, { type: 'bx', blade: 'Hells Nether', bit: 'Ball' })
const [b4] = await ins(A, { type: 'bx', blade: 'Phoenix Wing', ratchet: '9-60', bit: 'Gear Flat' })
assert.equal((await as(A, 'select note from fav_builds where id = $1', [b1.id]))[0].note, 'hlavní útok')
await fails(A, 'insert into fav_builds (bey) values ($1)', [JSON.stringify({ type: 'bx', blade: 'Dran Sword', ratchet: '3-60', bit: 'Flat' })], /už máš/)
await fails(A, 'insert into fav_builds (bey) values ($1)', [JSON.stringify({ type: 'bx', blade: 'Nesmysl', ratchet: '3-60', bit: 'Flat' })], /blade/i)
await fails(H, 'insert into fav_builds (bey) values ($1)', [JSON.stringify({ type: 'bx', blade: 'Dran Sword', ratchet: '3-60', bit: 'Flat' })], /row-level/)
await fails(null, 'select * from fav_builds', [], /permission/)
// cizí vlastník se podvrhnout nedá
const [bx] = await as(B, 'insert into fav_builds (user_id, bey) values ($1, $2) returning user_id', [A.id, JSON.stringify({ type: 'bx', blade: 'Dran Sword', ratchet: '3-60', bit: 'Flat' })]).catch(() => [{ user_id: 'chyba' }])
assert.notEqual(bx.user_id, A.id)
assert.equal((await as(B, 'select count(*)::int c from fav_builds'))[0].c, bx.user_id === B.id ? 1 : 0, 'B vidí jen svoje')
assert.equal((await as(B, 'update fav_builds set note = $1 where id = $2 returning id', ['x', b1.id])).length, 0, 'cizí build nezmění')
// úprava buildu přepočítá název
const [u1] = await as(A, 'update fav_builds set bey = $1 where id = $2 returning name', [JSON.stringify({ type: 'bx', blade: 'Dran Sword', ratchet: '3-80', bit: 'Flat' }), b1.id])
assert.equal(u1.name, 'Dran Sword 3-80F')
step('buildy: normalizace, název z DB, duplicity, jen vlastní, ne host')

// ── decky ──
const [d1] = await as(A, 'insert into fav_decks (name, builds) values ($1, $2) returning id, builds', ['  Turnaj  ', [b1.id, b2.id, b3.id]])
assert.equal((await as(A, 'select name from fav_decks where id = $1', [d1.id]))[0].name, 'Turnaj')
await fails(A, 'insert into fav_decks (name, builds) values ($1, $2)', ['X', [b1.id, b1.id]], /dvakrát/)
await fails(A, 'insert into fav_decks (name, builds) values ($1, $2)', ['X', []], /1–10/)
await fails(A, 'insert into fav_decks (name, builds) values ($1, $2)', ['', [b1.id]], /1–40/)
await fails(B, 'insert into fav_decks (name, builds) values ($1, $2)', ['Cizí', [b1.id]], /jen tvoje/)
const [d2] = await as(A, 'insert into fav_decks (name, builds) values ($1, $2) returning id', ['Jen jeden', [b4.id]])
// smazání buildu: z decku zmizí, prázdný deck se smaže
await as(A, 'delete from fav_builds where id = $1', [b2.id])
assert.deepEqual((await as(A, 'select builds from fav_decks where id = $1', [d1.id]))[0].builds, [b1.id, b3.id])
await as(A, 'delete from fav_builds where id = $1', [b4.id])
assert.equal((await as(A, 'select count(*)::int c from fav_decks where id = $1', [d2.id]))[0].c, 0)
step('decky: název, bez opakování, jen vlastní buildy, mazání buildu')

// ── limity a smazání účtu ──
await db.query(`insert into fav_builds (user_id, bey) select $1, jsonb_build_object('type','bx','blade','Dran Sword','ratchet', r, 'bit','Flat')
  from (select name r from bey_parts where category = 'ratchet' and name <> '3-80' limit 58) x`, [A.id])
const n = (await as(A, 'select count(*)::int c from fav_builds'))[0].c
if (n >= 60) await fails(A, 'insert into fav_builds (bey) values ($1)', [JSON.stringify({ type: 'bx', blade: 'Hells Nether', ratchet: '3-60', bit: 'Flat' })], /60/)
await db.query('delete from auth.users where id = $1', [A.id])
assert.equal((await db.query('select count(*)::int c from fav_builds where user_id = $1', [A.id])).rows[0].c, 0)
step('limit 60 buildů, smazání účtu smaže oblíbené')

console.log(`\n${ok} kroků OK`)
await db.end()
