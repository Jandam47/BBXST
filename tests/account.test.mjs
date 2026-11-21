// Integrační test smazání účtu a nahlašování (19-account-reports.sql).
// Spuštění: node tests/account.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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
async function newUser(nick, role = null, anon = false) {
  const [u] = (await db.query('insert into auth.users (is_anonymous) values ($1) returning id', [anon])).rows
  const user = { id: u.id, anon, nick }
  if (nick && !anon) await as(user, 'update profiles set nick = $1 where id = auth.uid()', [nick])
  if (role) await db.query('update profiles set role = $1 where id = $2', [role, u.id])
  return user
}
const one = async (user, fn, args = []) => (await as(user, `select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args))[0].r

const boss = await newUser('ABoss' + sfx, 'superadmin')
const admin = await newUser('AAdm' + sfx, 'admin')
const org = await newUser('AOrg' + sfx, 'organizer')
const p1 = await newUser('APa' + sfx), p2 = await newUser('APb' + sfx)

// ── nahlášení ──────────────────────────────────────────────────────
const [m] = await as(p2, "insert into chat_messages (room_id, body) values ('volny', 'Kupte si levné V-bucks!!!') returning id")
await fails(p2, 'select report_create($1,$2,$3)', ['chat_message', String(m.id), 'spam'], /Vlastní zprávu/)
await as(p1, 'select report_create($1,$2,$3,$4)', ['chat_message', String(m.id), 'spam', 'reklama'])
await as(p1, 'select report_create($1,$2,$3)', ['chat_message', String(m.id), 'spam'])          // podruhé nic nepřidá
await as(org, 'select report_create($1,$2,$3)', ['chat_message', String(m.id), 'nevhodne'])
await fails(p1, 'select report_list()', [], /admini/)
await fails(org, 'select report_list()', [], /admini/)
let list = await one(admin, 'report_list')
const rep = list.find(r => r.target === String(m.id))
assert.equal(rep.count, 2); assert.equal(rep.snapshot.body, 'Kupte si levné V-bucks!!!'); assert.equal(rep.exists, true)
assert.equal(await one(admin, 'report_count'), list.length); assert.equal(await one(p1, 'report_count'), 0)
await as(admin, 'select report_resolve($1, true)', [rep.id])
assert.equal((await db.query('select count(*)::int n from chat_messages where id = $1', [m.id])).rows[0].n, 0, 'zpráva smazaná')
assert.ok(!(await one(admin, 'report_list')).some(r => r.target === String(m.id)), 'vyřízené zmizí')
assert.equal((await db.query("select count(*)::int n from reports where target = $1 and status = 'done' and action = 'deleted'", [String(m.id)])).rows[0].n, 2)

const ad = await one(p2, 'bazar_save', [null, 'Podezřelý inzerát', 10, 'pošli zálohu', [`${p2.id}/q.jpg`]])
await as(p1, 'select report_create($1,$2,$3)', ['bazar_ad', ad, 'podvod'])
await as(p1, 'select bazar_comment($1,$2)', [ad, 'Je to originál?'])
const cm = (await db.query('select id from bazar_comments where ad_id = $1', [ad])).rows[0].id
await fails(org, 'select report_create($1,$2,$3)', ['bazar_comment', String(cm), 'spam'], /neexistuje/)   // cizí vlákno nevidí
await as(p2, 'select report_create($1,$2,$3)', ['bazar_comment', String(cm), 'urazky'])
list = await one(boss, 'report_list')
const adRep = list.find(r => r.kind === 'bazar_ad' && r.target === ad)
assert.deepEqual(adRep.snapshot.photos, [`${p2.id}/q.jpg`])
const photos = await one(boss, 'report_resolve', [adRep.id, true])
assert.deepEqual(photos, [`${p2.id}/q.jpg`], 'vrátí fotky smazaného inzerátu')
const cRep = (await one(boss, 'report_list')).find(r => r.kind === 'bazar_comment')
assert.equal(cRep.exists, false, 'komentář zmizel s inzerátem')
await as(boss, 'select report_resolve($1, false)', [cRep.id])
step('nahlášení: zpráva / inzerát / komentář, jen co vidím, admini řeší (smazat / ponechat), kopie obsahu')

// ── smazání účtu ───────────────────────────────────────────────────
const t = (await db.query(`insert into tournaments (kind, name, swiss_rounds, top_cut, created_by, status)
                           values ('tournament', 'Del Cup ${sfx}', 3, 0, $1, 'finished') returning id`, [org.id])).rows[0]
await db.query(`insert into registrations (tournament_id, user_id, nick, deck, final_place) values ($1, $2, $3,
  '[{"type":"bx","blade":"Dran Sword","ratchet":"3-60","bit":"Flat"},{"type":"bx","blade":"Hells Scythe","ratchet":"4-60","bit":"Taper"},{"type":"bx","blade":"Wizard Arrow","ratchet":"4-80","bit":"Ball"}]', 1)`,
  [t.id, p1.id, p1.nick])
const had = (await db.query('select count(*)::int n from registrations where user_id = $1', [p1.id])).rows[0].n
await nap()
await as(p1, "insert into chat_messages (room_id, body) values ('volny', 'sbohem')")
await as(p1, 'select bazar_save($1,$2,$3,$4,$5)', [null, 'Můj bey', 100, null, [`${p1.id}/a.jpg`, `${p1.id}/b.jpg`]])
assert.deepEqual((await one(p1, 'bazar_my_photos')).sort(), [`${p1.id}/a.jpg`, `${p1.id}/b.jpg`])
await fails(p1, 'select delete_my_account($1)', ['nekdo'], /přesně svůj nick/)
await fails(boss, 'select delete_my_account($1)', [boss.nick], /Hlavní admin/)
const cid = await one(org, 'community_create', ['Del klub ' + sfx])
await fails(org, 'select delete_my_account($1)', [org.nick], /leader komunity/)
await as(p1, 'select delete_my_account($1)', [p1.nick.toUpperCase()])
assert.equal((await db.query('select count(*)::int n from auth.users where id = $1', [p1.id])).rows[0].n, 0)
assert.equal((await db.query('select count(*)::int n from profiles where id = $1', [p1.id])).rows[0].n, 0)
assert.equal((await db.query("select count(*)::int n from chat_messages where body = 'sbohem'")).rows[0].n, 0)
assert.equal((await db.query('select count(*)::int n from bazar_ads where user_id = $1', [p1.id])).rows[0].n, 0)
assert.equal(had, 1)
{
  const r = (await db.query('select nick, user_id, final_place from registrations where tournament_id = $1', [t.id])).rows[0]
  assert.match(r.nick, /^Smazaný hráč [0-9A-F]{4}$/); assert.equal(r.user_id, null); assert.equal(r.final_place, 1)
}
step('smazání účtu: potvrzení nickem, ne hlavní admin ani leader komunity, zprávy a bazar pryč, výsledky anonymně')

await db.end()
console.log(`${ok} kroků prošlo`)
