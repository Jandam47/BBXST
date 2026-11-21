// Integrační test push notifikací (20-push.sql): odběry a které události zapíšou zprávu do push_outbox.
// (Odeslání přes pg_net a Edge Function se lokálně netestuje – bez pg_net se jen zapíše outbox.)
// Spuštění: node tests/push.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
import pg from 'pg'
import assert from 'node:assert/strict'

const db = new pg.Client({ host: '/tmp/pg', port: 5499, user: 'postgres', database: 'bbx' })
await db.connect()
let ok = 0
const step = (s) => { ok++; console.log('✓', s) }
const sfx = Math.random().toString(36).slice(2, 6)
const nap = () => new Promise(r => setTimeout(r, 1100))
async function as(user, sql, params = []) {
  await db.query('reset role')
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user.id, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return (await db.query(sql, params)).rows } finally { await db.query('reset role') }
}
async function fails(user, sql, params, re) {
  try { await as(user, sql, params) } catch (e) { if (re) assert.match(e.message, re); return }
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
let mark = 0
const since = async () => { mark = Number((await db.query('select coalesce(max(id),0) m from push_outbox')).rows[0].m) }
const sentTo = async (user) => (await db.query('select title, body, url from push_outbox where id > $1 and $2 = any(user_ids) order by id', [mark, user.id])).rows

const adm = await newUser('PAdm' + sfx, 'admin'), org = await newUser('POrg' + sfx, 'organizer')
const a = await newUser('PA' + sfx), b = await newUser('PB' + sfx), quiet = await newUser('PQ' + sfx)
for (const u of [adm, org, a, b]) await as(u, 'select push_subscribe($1,$2,$3)', [`https://push.example/${u.id}`, 'key', 'auth'])
await fails(a, 'select push_subscribe($1,$2,$3)', ['http://evil', 'k', 'a'], /Neplatný/)
assert.deepEqual(await one(a, 'push_status', [`https://push.example/${a.id}`]), { this_device: true, devices: 1 })
await fails(a, 'select * from push_subscriptions', [], /permission/)
step('odběr: uložení, stav zařízení, tabulka není čitelná z klienta')

// bazar: zájemce → prodejce, odpověď → zájemce; autor sám sobě nic
await since()
const ad = await one(a, 'bazar_save', [null, 'Leon Claw', 150, null, [`${a.id}/p.jpg`]])
await as(b, 'select bazar_comment($1,$2)', [ad, 'Beru!'])
assert.equal((await sentTo(a))[0]?.title, `PB${sfx} ti napsal v bazaru`)
assert.equal((await sentTo(b)).length, 0, 'autor sám sobě nic')
await nap(); await as(a, 'select bazar_comment($1,$2,$3)', [ad, 'Platí', b.id])
assert.equal((await sentTo(b))[0]?.url, `#/bazar/${ad}`)
// bez odběru se nic nezapíše
const ad2 = await one(quiet, 'bazar_save', [null, 'Tichý', 1, null, [`${quiet.id}/x.jpg`]])
await since(); await nap(); await as(b, 'select bazar_comment($1,$2)', [ad2, 'Haló'])
assert.equal((await db.query('select count(*)::int n from push_outbox where id > $1', [mark])).rows[0].n, 0)
step('bazar: zpráva přijde druhé straně, autorovi ani hráči bez upozornění nic')

// turnaj: info k turnaji přihlášeným, start, aréna
const t = (await db.query(`insert into tournaments (kind, name, swiss_rounds, top_cut, created_by) values ('tournament', 'Push Cup ${sfx}', 3, 0, $1) returning id`, [org.id])).rows[0]
const deck = '[{"type":"bx","blade":"Dran Sword","ratchet":"3-60","bit":"Flat"},{"type":"bx","blade":"Hells Scythe","ratchet":"4-60","bit":"Taper"},{"type":"bx","blade":"Wizard Arrow","ratchet":"4-80","bit":"Ball"}]'
const ra = (await db.query('insert into registrations (tournament_id, user_id, nick, deck) values ($1,$2,$3,$4) returning id', [t.id, a.id, a.nick, deck])).rows[0].id
const rb = (await db.query('insert into registrations (tournament_id, user_id, nick, deck) values ($1,$2,$3,$4) returning id', [t.id, b.id, b.nick, deck])).rows[0].id
await since(); await nap()
await as(org, 'insert into chat_messages (room_id, body) values ($1, $2)', ['t-' + t.id, 'Prezence od 9:30'])
assert.equal((await sentTo(a))[0]?.title, `📢 ${(await db.query('select name from chat_rooms where id = $1', ['t-' + t.id])).rows[0].name}`)
assert.equal((await sentTo(adm)).length, 0, 'info k turnaji jen přihlášeným')
await since(); await nap()
await as(adm, "insert into chat_messages (room_id, body) values ('info', 'Nová sezóna')")
assert.ok((await sentTo(a)).length && (await sentTo(org)).length && !(await sentTo(adm)).length, 'obecné info všem s upozorněním kromě autora')
await since()
await db.query("update tournaments set status = 'swiss', current_round = 1 where id = $1", [t.id])
assert.equal((await sentTo(a))[0]?.title, 'Turnaj začal')
await db.query(`insert into matches (tournament_id, key, stage, round, pos, p1_reg, p2_reg, arena, status) values ($1, 's1-1', 'swiss', 1, 1, $2, $3, 2, 'pending')`, [t.id, ra, rb])
const ma = (await sentTo(a)).find(x => x.title.startsWith('Aréna'))
assert.equal(ma.title, 'Aréna 2 – tvůj zápas'); assert.match(ma.body, new RegExp(`Hraješ proti PB${sfx}`))
step('turnaj: info k turnaji přihlášeným, obecné info všem, start turnaje, zápas na aréně oběma hráčům')

// nahlášení → admini
await since()
const [m] = await as(b, "insert into chat_messages (room_id, body) values ('volny', 'spam spam') returning id")
await as(a, 'select report_create($1,$2,$3)', ['chat_message', String(m.id), 'spam'])
assert.equal((await sentTo(adm))[0]?.title, 'Nové nahlášení'); assert.equal((await sentTo(org)).length, 0)
await as(a, 'select push_unsubscribe($1)', [`https://push.example/${a.id}`])
assert.equal((await one(a, 'push_status', ['https://push.example/x'])).devices, 0)
step('nahlášení přijde adminům; odhlášení odběru')

await db.end()
console.log(`${ok} kroků prošlo`)
