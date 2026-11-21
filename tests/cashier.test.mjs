// Integrační test 28-cashier.sql: funkce pokladník, vstupné u turnaje, zápis zaplaceno.
// Spuštění: node tests/cashier.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
import pg from 'pg'
import assert from 'node:assert/strict'

const db = new pg.Client({ host: '/tmp/pg', port: 5499, user: 'postgres', database: 'bbx' })
await db.connect()
let ok = 0
const step = (s) => { ok++; console.log('✓', s) }
const sfx = Math.random().toString(36).slice(2, 6)
async function as(user, sql, params = []) {
  await db.query('reset role')
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(user ? { sub: user.id, role: 'authenticated' } : { role: 'anon' })])
  await db.query(user ? 'set role authenticated' : 'set role anon')
  try { return (await db.query(sql, params)).rows } finally { await db.query('reset role'); await db.query("select set_config('request.jwt.claims', '', false)") }
}
async function fails(user, sql, params, re) {
  try { await as(user, sql, params) } catch (e) { if (re) assert.match(e.message, re); return }
  throw new Error('Mělo selhat: ' + sql)
}
async function newUser(nick, role = 'player') {
  const [u] = (await db.query('insert into auth.users (is_anonymous) values (false) returning id')).rows
  await db.query('update profiles set nick = $1, role = $2 where id = $3', [nick, role, u.id])
  return { id: u.id, nick }
}

const admin = await newUser('CAdm' + sfx, 'admin'), org = await newUser('COrg' + sfx, 'organizer')
const kasa = await newUser('CKasa' + sfx), a = await newUser('CA' + sfx), judge = await newUser('CJ' + sfx, 'judge')

// funkce pokladník: jen admin, sám si ji nedá
await fails(kasa, 'update profiles set cashier = true where id = auth.uid()', [], /pokladník/)
await fails(org, 'select set_cashier($1, true)', [kasa.id], /admin/)
await as(admin, 'select set_cashier($1, true)', [kasa.id])
assert.equal((await db.query('select cashier from profiles where id = $1', [kasa.id])).rows[0].cashier, true)
const list = await as(org, 'select * from cashier_list()')
assert.ok(list.some(x => x.id === kasa.id)); assert.ok(!list.some(x => x.id === a.id))
assert.equal((await as(a, 'select * from cashier_list()')).length, 0, 'hráč seznam pokladníků nevidí')
step('pokladník: přiděluje jen admin, organizátor ho vidí v seznamu')

// vstupné u turnaje
await fails(org, `insert into tournaments (kind, name, swiss_rounds, top_cut, fee, entry_fee) values ('tournament', 'Kasa ${sfx}', 3, 0, true, 100)`, [], /kdo bude vybírat/)
await fails(org, `insert into tournaments (kind, name, swiss_rounds, top_cut, fee, cashiers) values ('tournament', 'Kasa ${sfx}', 3, 0, true, $1)`, [[a.id]], /pokladník nebo organizátor/)
const [t] = await as(org, `insert into tournaments (kind, name, swiss_rounds, top_cut, fee, entry_fee, cashiers) values ('tournament', 'Kasa ${sfx}', 3, 0, true, 150, $1) returning id, cashiers`, [[kasa.id, org.id]])
assert.equal(t.cashiers.length, 2)
const [t0] = await as(org, `insert into tournaments (kind, name, swiss_rounds, top_cut, fee, entry_fee, cashiers) values ('tournament', 'Free ${sfx}', 3, 0, false, 50, $1) returning id, entry_fee, cashiers`, [[kasa.id]])
assert.equal(t0.entry_fee, null); assert.deepEqual(t0.cashiers, [])
step('turnaj: vstupné potřebuje pokladníka nebo organizátora, bez vstupného se pole vynulují')

// registrace a zaplaceno
const deck = '[{"type":"bx","blade":"Dran Sword","ratchet":"3-60","bit":"Flat"},{"type":"bx","blade":"Hells Scythe","ratchet":"4-60","bit":"Taper"},{"type":"bx","blade":"Wizard Arrow","ratchet":"4-80","bit":"Ball"}]'
const [ra] = await as(a, 'insert into registrations (tournament_id, user_id, nick, deck) values ($1, auth.uid(), $2, $3) returning id', [t.id, a.nick, deck])
await as(a, 'update registrations set paid_at = now() where id = $1', [ra.id])     // tiše se zahodí
assert.equal((await db.query('select paid_at from registrations where id = $1', [ra.id])).rows[0].paid_at, null)
await fails(a, 'select pay_set($1, $2, true)', [t.id, ra.id], /pokladník/)
await fails(judge, 'select pay_set($1, $2, true)', [t.id, ra.id], /pokladník/)
const r1 = (await as(kasa, 'select pay_set($1, $2, true) r', [t.id, ra.id]))[0].r
assert.ok(r1.paid_at)
const pl = await as(org, 'select * from pay_list($1)', [t.id])
assert.equal(pl.find(x => x.reg === ra.id).paid_by_nick, kasa.nick)
assert.equal((await as(judge, 'select * from pay_list($1)', [t.id])).length, 0, 'judge vstupné nevidí')
assert.ok((await as(a, 'select paid_at from my_registration($1)', [t.id]))[0].paid_at, 'hráč vidí zaplaceno')
await fails(a, 'select paid_at from registrations where id = $1', [ra.id], /permission/)
await as(org, 'select pay_set($1, $2, false)', [t.id, ra.id])
assert.equal((await db.query('select paid_at from registrations where id = $1', [ra.id])).rows[0].paid_at, null)
await fails(kasa, 'select pay_set($1, $2, true)', [t0.id, ra.id], /nemá/)
// pokladník načte QR vstupenky
const tok = (await db.query('select qr_token from registrations where id = $1', [ra.id])).rows[0].qr_token
assert.equal((await as(kasa, 'select checkin_lookup($1, $2) r', [t.id, tok]))[0].r, ra.id)
// odebrání funkce → do seznamu nejde přidat, už vybraný v turnaji zůstává
await as(admin, 'select set_cashier($1, false)', [kasa.id])
await fails(org, `insert into tournaments (kind, name, swiss_rounds, top_cut, fee, cashiers) values ('tournament', 'Kasa2 ${sfx}', 3, 0, true, $1)`, [[kasa.id]], /pokladník nebo organizátor/)
await as(org, 'update tournaments set entry_fee = 200 where id = $1', [t.id])
step('zaplaceno: zapisuje pokladník / organizátor, hráč vidí na vstupence, judge ani hráč zapsat nemůžou')

await db.end()
console.log(`${ok} kroků prošlo`)
