// Integrační test 29-polls-feedback.sql: ankety (zakládání, hlasování, víc možností, anonymní režim, konec)
// a dotazy / připomínky pro hlavního admina.
// Spuštění: node tests/polls.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
import pg from 'pg'
import assert from 'node:assert/strict'

const db = new pg.Client({ host: '/tmp/pg', port: 5499, user: 'postgres', database: 'bbx' })
await db.connect()
let ok = 0
const step = (s) => { ok++; console.log('✓', s) }
const sfx = Math.random().toString(36).slice(2, 6)
async function as(user, sql, params = []) {
  await db.query('reset role')
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(user ? { sub: user.id, role: 'authenticated', is_anonymous: !!user.anon } : { role: 'anon' })])
  await db.query(user ? 'set role authenticated' : 'set role anon')
  try { return (await db.query(sql, params)).rows } finally { await db.query('reset role'); await db.query("select set_config('request.jwt.claims', '', false)") }
}
async function fails(user, sql, params, re) {
  try { await as(user, sql, params) } catch (e) { if (re) assert.match(e.message, re); return }
  throw new Error('Mělo selhat: ' + sql)
}
async function newUser(nick, role = 'player', anon = false) {
  const [u] = (await db.query('insert into auth.users (is_anonymous) values ($1) returning id', [anon])).rows
  await db.query('update profiles set nick = $1, role = $2 where id = $3', [nick, role, u.id])
  return { id: u.id, nick, anon }
}
const one = async (user, id) => (await as(user, 'select poll_list($1) l', [id]))[0].l[0]

const boss = (await db.query("select id, nick from profiles where role = 'superadmin' limit 1")).rows[0]
  || await newUser('PBoss' + sfx, 'superadmin')
const admin = await newUser('PAdm' + sfx, 'admin'), org = await newUser('POrg' + sfx, 'organizer'), org2 = await newUser('POrg2' + sfx, 'organizer')
const a = await newUser('PA' + sfx), b = await newUser('PB' + sfx), judge = await newUser('PJ' + sfx, 'judge')
const host = await newUser('PHost' + sfx, 'player', true)
await db.query('insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ($1, $2, $3, $3), ($4, $5, $3, $3) on conflict do nothing',
  [`https://push.test/p-a-${sfx}`, a.id, 'x', `https://push.test/p-boss-${sfx}`, boss.id])

// ── zakládání ──
await fails(a, `select poll_create('Kdy trénink?', array['Pá','So'], false, true, 60)`, [], /organizátoři a admini/)
await fails(judge, `select poll_create('Kdy trénink?', array['Pá','So'], false, true, 60)`, [], /organizátoři a admini/)
await fails(org, `select poll_create('Kdy?', array['Pá','pá ', ''], false, true, 60)`, [], /aspoň 2/)
await fails(org, `select poll_create('Kdy trénink?', array['Pá','So'], false, true, 1)`, [], /5 minut/)
await fails(org, `select poll_create('Kdy trénink?', array['1','2','3','4','5','6','7','8','9','10','11'], false, true, 60)`, [], /10/)
const [{ poll_create: p1 }] = await as(org, `select poll_create('Kdy trénink ${sfx}?', array['Pátek', 'Sobota', 'Neděle'], false, true, 120, 'Hala Pardubice')`)
const [{ poll_create: p2 }] = await as(admin, `select poll_create('Které formáty ${sfx}?', array['3v3', 'Deathmatch', 'Fashion'], true, false, 60)`)
const push = (await db.query("select title, body, url from push_outbox where url = $1", ['#/ankety/' + p1])).rows
assert.equal(push.length, 1); assert.equal(push[0].title, '📊 Nová anketa')
step('anketu zakládá jen organizátor+, kontrola možností a délky, push všem s odběrem')

// ── seznam bez přihlášení ──
let l = await one(null, p1)
assert.equal(l.open, true); assert.equal(l.results, false); assert.equal(l.options[0].votes, null, 'výsledky skryté před hlasováním')
assert.equal(l.note, 'Hala Pardubice'); assert.equal(l.author, org.nick)
assert.deepEqual(l.options.map(o => o.label), ['Pátek', 'Sobota', 'Neděle'])
l = await one(org, p1); assert.equal(l.results, true, 'autor vidí výsledky vždy'); assert.equal(l.can_manage, true)
assert.equal((await one(org2, p1)).can_manage, false)
step('seznam: anonym čte, výsledky vidí jen autor (a kdo už hlasoval)')

// ── hlasování ──
const opt = async (pid) => (await one(org, pid)).options.map(o => o.id)
const [pa, so, ne] = await opt(p1)
await fails(null, 'select poll_vote($1, $2)', [p1, [pa]])
await fails(host, 'select poll_vote($1, $2)', [p1, [pa]], /účet/)
await fails(a, 'select poll_vote($1, $2)', [p1, [pa, so]], /jen jedna/)
const [x3] = await opt(p2)
await fails(a, 'select poll_vote($1, $2)', [p1, [x3]], /Neplatná/)
await as(a, 'select poll_vote($1, $2)', [p1, [so]])
await as(b, 'select poll_vote($1, $2)', [p1, [pa]])
await as(b, 'select poll_vote($1, $2)', [p1, [so]])          // změna hlasu
l = await one(a, p1)
assert.equal(l.results, true); assert.deepEqual(l.my, [so]); assert.equal(l.voters, 2)
assert.deepEqual(l.options.map(o => o.votes), [0, 2, 0])
assert.equal(l.options[1].who, null, 'anonymní – kdo hlasoval, nevidí nikdo')
assert.equal((await one(admin, p1)).options[1].who, null, 'ani admin')
assert.equal((await as(a, 'select poll_pending() n'))[0].n, 1, 'p2 ještě nehlasoval')
assert.equal((await as(null, 'select poll_pending() n'))[0].n, 0)
step('hlasuje jen účet, jedna možnost, změna hlasu, anonymní výsledky')

// víc možností + veřejné hlasování
const [f3v3, fdm, ffa] = await opt(p2)
await as(a, 'select poll_vote($1, $2)', [p2, [f3v3, fdm]])
await as(b, 'select poll_vote($1, $2)', [p2, [fdm]])
l = await one(b, p2)
assert.deepEqual(l.options.map(o => o.votes), [1, 2, 0]); assert.equal(l.voters, 2)
assert.deepEqual(l.options[1].who, [a.nick, b.nick].sort()); assert.deepEqual(l.options[0].who, [a.nick])
await as(b, 'select poll_vote($1, $2)', [p2, []])            // vzít hlas zpět
assert.equal((await one(a, p2)).voters, 1)
step('víc možností, veřejné hlasování ukáže nicky, hlas jde vzít zpět')

// ── konec ankety ──
await fails(org2, 'select poll_close($1)', [p1], /autor nebo admin/)
await fails(a, 'select poll_delete($1)', [p1], /autor nebo admin/)
await as(org, 'select poll_close($1)', [p1])
l = await one(null, p1)
assert.equal(l.open, false); assert.equal(l.results, true, 'po konci vidí výsledky všichni'); assert.deepEqual(l.options.map(o => o.votes), [0, 2, 0])
await fails(a, 'select poll_vote($1, $2)', [p1, [pa]], /skončila/)
await db.query("update polls set ends_at = now() - interval '1 minute' where id = $1", [p2])
assert.equal((await one(null, p2)).open, false, 'po čase se zavře sama')
await fails(a, 'select poll_vote($1, $2)', [p2, [ffa]], /skončila/)
const order = (await as(null, 'select poll_list() l'))[0].l.map(x => x.id)
assert.ok(order.indexOf(p1) < order.indexOf(p2), 'skončené od nejnovějšího konce')
await as(admin, 'select poll_delete($1)', [p1])
assert.equal((await as(null, 'select poll_list($1) l', [p1]))[0].l.length, 0)
assert.equal((await db.query('select count(*)::int n from poll_votes where poll_id = $1', [p1])).rows[0].n, 0)
await fails(a, 'select * from polls'); await fails(a, 'select * from poll_votes')
step('ukončení autorem / časem, smazání adminem, tabulky jen přes RPC')

// ── dotazy a připomínky ──
await fails(host, `select feedback_send('question', 'Ahoj, jak na to?')`, [], /účet/)
await fails(a, `select feedback_send('spam', 'Ahoj, jak na to?')`, [], /druh/)
await fails(a, `select feedback_send('note', 'x')`, [], /pár slov/)
const [{ feedback_send: f1 }] = await as(a, `select feedback_send('question', 'Kdy bude další turnaj ${sfx}?')`)
await as(b, `select feedback_send('note', 'Chybí mi tmavší režim ${sfx}.')`)
const pb = (await db.query("select title, user_ids from push_outbox where body = $1", [`Kdy bude další turnaj ${sfx}?`])).rows
assert.equal(pb.length, 1); assert.match(pb[0].title, new RegExp('Dotaz od ' + a.nick)); assert.ok(pb[0].user_ids.includes(boss.id))
assert.equal((await as(a, 'select feedback_mine() m'))[0].m.length, 1, 'vidím jen své')
await fails(admin, 'select feedback_inbox()', [], /hlavní admin/)
await fails(a, 'select feedback_reply($1, $2)', [f1, 'Hned.'], /hlavní admin/)
await fails(a, 'select * from feedback')
let inbox = (await as(boss, 'select feedback_inbox() i'))[0].i
assert.ok(inbox.some(x => x.id === Number(f1) && x.nick === a.nick))
const cnt0 = (await as(boss, 'select feedback_count() c'))[0].c.open
await as(boss, 'select feedback_reply($1, $2)', [f1, 'V sobotu v hale.'])
const mine = (await as(a, 'select feedback_mine() m'))[0].m[0]
assert.equal(mine.reply, 'V sobotu v hale.'); assert.equal(mine.done, true)
assert.ok((await as(a, 'select feedback_count() c'))[0].c.last_reply)
assert.equal((await as(boss, 'select feedback_count() c'))[0].c.open, cnt0 - 1)
assert.equal((await db.query("select count(*)::int n from push_outbox where url = '#/dotazy' and $1 = any(user_ids)", [a.id])).rows[0].n, 1, 'odpověď přijde autorovi')
inbox = (await as(boss, 'select feedback_inbox(false) i'))[0].i
assert.ok(!inbox.some(x => x.id === Number(f1)), 'vyřízené jen ve „Vše“')
await as(boss, 'select feedback_done($1, false)', [f1])
assert.ok((await as(boss, 'select feedback_inbox(false) i'))[0].i.some(x => x.id === Number(f1)))
for (let i = 0; i < 4; i++) await as(b, `select feedback_send('note', 'Další připomínka ${i}')`)
await fails(b, `select feedback_send('note', 'A ještě jedna')`, [], /Moc zpráv/)
step('dotazy: jen účet, soukromé, push hlavnímu adminovi, odpověď, vyřízeno, limit')

console.log(`\nPOLLS OK (${ok} kroků)`)
await db.end()
