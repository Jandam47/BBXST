// Integrační test nového chatu a bazaru (17-chat-bazar.sql).
// Spuštění: node tests/chat.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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
async function newUser(nick, role = null, anon = false) {
  const [u] = (await db.query('insert into auth.users (is_anonymous) values ($1) returning id', [anon])).rows
  const user = { id: u.id, anon, nick }
  if (nick && !anon) await as(user, 'update profiles set nick = $1 where id = auth.uid()', [nick])
  if (role) await db.query('update profiles set role = $1 where id = $2', [role, u.id])
  return user
}
const one = async (user, fn, args = []) => (await as(user, `select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args))[0].r
const nap = () => new Promise(r => setTimeout(r, 1100))
const say = (user, room, body) => as(user, 'insert into chat_messages (room_id, body) values ($1, $2) returning id, created_at', [room, body])
const roomsOf = async (user) => (await one(user, 'chat_room_list')).map(r => r.id)

const boss = await newUser('XBoss' + sfx, 'superadmin')
const org = await newUser('XOrg' + sfx, 'organizer')
const p1 = await newUser('XPa' + sfx), p2 = await newUser('XPb' + sfx), out = await newUser('XOut' + sfx)
const anon = await newUser(null, null, true)

// ── místnosti ──────────────────────────────────────────────────────
const fixed = (await db.query(`select id, name, kind from chat_rooms where id in ('volny','info','turnaje','prodeje') order by id`)).rows
assert.deepEqual(fixed.map(r => [r.id, r.name, r.kind]), [['info', 'Obecné informace', 'info'], ['volny', 'Zkušební chat', 'test']])
const t = (await db.query(`insert into tournaments (kind, name, starts_at, swiss_rounds, top_cut, created_by)
                           values ('tournament', 'Chat Cup ${sfx}', '2026-12-05 10:00+01', 3, 0, $1) returning id`, [org.id])).rows[0]
let tr = (await db.query('select name, kind from chat_rooms where id = $1', ['t-' + t.id])).rows[0]
assert.deepEqual(tr, { name: `05.12.2026 Chat Cup ${sfx}`, kind: 'info_t' })
await db.query('update tournaments set name = $1 where id = $2', ['Chat Open ' + sfx, t.id])
assert.equal((await db.query('select name from chat_rooms where id = $1', ['t-' + t.id])).rows[0].name, `05.12.2026 Chat Open ${sfx}`)
const ev = (await db.query(`insert into tournaments (kind, event_type, name, swiss_rounds, top_cut, created_by)
                            values ('event', 'training', 'Trénink ${sfx}', 1, 0, $1) returning id`, [org.id])).rows[0]
assert.equal((await db.query('select count(*)::int n from chat_rooms where id = $1', ['t-' + ev.id])).rows[0].n, 0, 'akce místnost nemá')
step('místnosti: Zkušební chat, Obecné informace, místnost turnaje s datem (přejmenuje se s turnajem), akce bez místnosti')

// ── přístup: zkušební / info ────────────────────────────────────────
const anonRooms = await roomsOf(null)
assert.ok(anonRooms.includes('info') && anonRooms.includes('t-' + t.id) && !anonRooms.includes('volny'), 'nepřihlášený vidí jen info')
assert.ok((await roomsOf(anon)).every(r => r === 'info' || r.startsWith('t-')), 'host bez účtu vidí jen info')
await say(p1, 'volny', 'ahoj')
assert.equal((await as(null, "select count(*)::int n from chat_messages where room_id = 'volny'"))[0].n, 0, 'nepřihlášený zkušební nečte')
await nap(); await fails(anon, "insert into chat_messages (room_id, body) values ('volny', 'x')", [], /row-level|Psát/)
await nap(); await fails(p1, "insert into chat_messages (room_id, body) values ('info', 'x')", [], /row-level/)
await nap(); await fails(p1, 'insert into chat_messages (room_id, body) values ($1, $2)', ['t-' + t.id, 'x'], /row-level/)
await say(org, 't-' + t.id, 'Prezence od 9:30')
await new Promise(r => setTimeout(r, 1100))
await say(boss, 'info', 'Vítejte')
assert.equal((await as(null, 'select body from chat_messages where room_id = $1', ['t-' + t.id]))[0].body, 'Prezence od 9:30')
step('zkušební jen s účtem; info čte každý, píše organizátor / admin')

// ── stav chatu k turnaji: uzavřený / schovaný / smazaný ──
const tr2 = 't-' + t.id
await fails(p1, 'select chat_room_state($1,$2)', [tr2, 'closed'], /organizátor akce nebo admin/)
const org2 = await newUser('XOrg2' + sfx, 'organizer')
await fails(org2, 'select chat_room_state($1,$2)', [tr2, 'closed'], /organizátor akce nebo admin/)   // cizí organizátor
await as(org, 'select chat_room_state($1,$2)', [tr2, 'closed'])
await nap(); await fails(org, 'insert into chat_messages (room_id, body) values ($1, $2)', [tr2, 'x'], /row-level/)
assert.ok((await roomsOf(null)).includes(tr2), 'uzavřený jde číst')
await as(boss, 'select chat_room_state($1,$2)', [tr2, 'hidden'])
assert.ok(!(await roomsOf(null)).includes(tr2) && !(await roomsOf(p1)).includes(tr2) && !(await roomsOf(org2)).includes(tr2), 'schovaný nevidí ostatní')
assert.ok((await roomsOf(org)).includes(tr2) && (await roomsOf(boss)).includes(tr2), 'schovaný vidí organizátor akce a admin')
assert.equal((await as(p1, 'select count(*)::int n from chat_messages where room_id = $1', [tr2]))[0].n, 0)
await as(org, 'select chat_room_state($1,$2)', [tr2, 'active'])
await nap(); await say(org, tr2, 'znovu otevřeno')
await db.query('update tournaments set name = $1 where id = $2', ['Chat Final ' + sfx, t.id])
await as(org, 'select chat_room_state($1,$2)', [tr2, 'delete'])
assert.equal((await db.query('select count(*)::int n from chat_rooms where id = $1', [tr2])).rows[0].n, 0)
await db.query('update tournaments set name = $1 where id = $2', ['Chat Final 2 ' + sfx, t.id])
assert.equal((await db.query('select count(*)::int n from chat_rooms where id = $1', [tr2])).rows[0].n, 0, 'úprava turnaje smazaný chat nevrátí')
step('chat k turnaji: uzavřít (jen číst) / schovat (organizátor akce + admin) / znovu otevřít / smazat')

// ── komunitní chat ─────────────────────────────────────────────────
const cid = await one(org, 'community_create', ['Chat klub ' + sfx])
assert.ok(!(await roomsOf(org)).includes('c-' + cid), 'neschválená komunita chat nemá')
await as(boss, 'select community_review($1, true)', [cid])
const croom = 'c-' + cid
await as(p1, 'select community_join($1)', [cid]); await as(org, 'select community_decide($1,$2,true)', [cid, p1.id])
await as(org, "select community_set_role($1,$2,'sub')", [cid, p1.id])
await as(p2, 'select community_join($1)', [cid]); await as(p1, 'select community_decide($1,$2,true)', [cid, p2.id])
assert.ok((await roomsOf(p2)).includes(croom)); assert.ok(!(await roomsOf(out)).includes(croom))
await say(p2, croom, 'stará zpráva')
await nap(); await fails(out, 'insert into chat_messages (room_id, body) values ($1, $2)', [croom, 'x'], /row-level/)
assert.equal((await as(out, 'select count(*)::int n from chat_messages where room_id = $1', [croom]))[0].n, 0)
step('komunitní chat: místnost po schválení, čtou a píšou jen členové')

await fails(p2, 'select chat_guest_invite($1,$2,$3,$4)', [croom, out.id, 30, false], /leader nebo zástupce/)
await fails(p1, 'select chat_guest_invite($1,$2,$3,$4)', [croom, p2.id, 30, false], /člen komunity/)
await fails(p1, 'select chat_guest_invite($1,$2,$3,$4)', [croom, out.id, 0, false], /1 minutu/)
await new Promise(r => setTimeout(r, 1100))
await as(p1, 'select chat_guest_invite($1,$2,$3,$4)', [croom, out.id, 30, false])     // zástupce, bez starých zpráv
await new Promise(r => setTimeout(r, 20))
await say(p2, croom, 'nová zpráva')
let vis = (await as(out, 'select body from chat_messages where room_id = $1 order by id', [croom])).map(r => r.body)
assert.deepEqual(vis, ['nová zpráva'], 'host bez historie vidí jen nové')
const lst = (await one(out, 'chat_room_list')).find(r => r.id === croom)
assert.ok(lst && lst.guest_until && lst.can_write && lst.last.body === 'nová zpráva')
await say(out, croom, 'díky za pozvání')
assert.equal((await one(org, 'chat_room_info', [croom])).guests.length, 1)
await as(org, 'select chat_guest_invite($1,$2,$3,$4)', [croom, out.id, 60, true])      // znovu, s historií
vis = (await as(out, 'select body from chat_messages where room_id = $1 order by id', [croom])).map(r => r.body)
assert.ok(vis.includes('stará zpráva'), 's historií vidí i staré')
await db.query(`update chat_guests set until = now() - interval '1 second' where user_id = $1`, [out.id])
assert.ok(!(await roomsOf(out)).includes(croom), 'po vypršení místnost zmizí')
await nap(); await fails(out, 'insert into chat_messages (room_id, body) values ($1, $2)', [croom, 'x'], /row-level/)
await fails(out, 'select chat_room_info($1)', [croom], /přístup/)
// mazání: zástupce smaže cizí zprávu ve své komunitě
const [m] = await say(p2, croom, 'smaž mě')
await as(p1, 'delete from chat_messages where id = $1', [m.id])
assert.equal((await db.query('select count(*)::int n from chat_messages where id = $1', [m.id])).rows[0].n, 0)
step('hosté: zve leader/zástupce na X minut, bez / s historií, po vypršení přístup zmizí; zástupce moderuje')

// ── bazar ──────────────────────────────────────────────────────────
await fails(anon, 'select bazar_list()', [], /přihlášení/)
await fails(p1, 'select bazar_save($1,$2,$3,$4,$5)', [null, 'Dran Sword', 250, null, []], /1 až 3 fotky/)
await fails(p1, 'select bazar_save($1,$2,$3,$4,$5)', [null, 'Dran Sword', 250, null, [`${p2.id}/a.jpg`]], /Neplatná fotka/)
await fails(p1, 'select bazar_save($1,$2,$3,$4,$5)', [null, 'Dran Sword', 250, null, ['a', 'b', 'c', 'd'].map(x => `${p1.id}/${x}.jpg`)], /1 až 3/)
const ad = await one(p1, 'bazar_save', [null, 'Dran Sword 3-60F', 250, 'Nový, nerozbalený', [`${p1.id}/x1.jpg`, `${p1.id}/x2.jpg`]])
await fails(p2, 'select bazar_save($1,$2,$3,$4,$5)', [ad, 'Hack', 1, null, [`${p2.id}/y.jpg`]], /svůj inzerát/)
assert.ok((await one(p2, 'bazar_list')).some(a => a.id === ad && a.price === 250 && !a.mine))
await fails(p1, 'select bazar_comment($1,$2)', [ad, 'sám sobě'], /zájemce/)
await as(p2, 'select bazar_comment($1,$2)', [ad, 'Dám 200?'])
await new Promise(r => setTimeout(r, 1100))
await as(out, 'select bazar_comment($1,$2)', [ad, 'Beru za 250'])
await new Promise(r => setTimeout(r, 1100))
await as(p1, 'select bazar_comment($1,$2,$3)', [ad, 'Za 230 ano', p2.id])
const seller = await one(p1, 'bazar_ad', [ad])
assert.equal(seller.threads.length, 2, 'prodejce vidí obě vlákna')
const b2 = await one(p2, 'bazar_ad', [ad])
assert.equal(b2.threads.length, 1); assert.deepEqual(b2.threads[0].comments.map(c => c.body), ['Dám 200?', 'Za 230 ano'])
const bo = await one(out, 'bazar_ad', [ad])
assert.deepEqual(bo.threads[0].comments.map(c => c.body), ['Beru za 250'], 'zájemce nevidí cizí vlákno')
assert.deepEqual((await as(out, 'select body from bazar_comments where ad_id = $1', [ad])).map(r => r.body), ['Beru za 250'], 'RLS: jen vlastní vlákno')
assert.equal((await as(p1, 'select count(*)::int n from bazar_comments where ad_id = $1', [ad]))[0].n, 3)
await as(p1, "select bazar_set_status($1, 'sold')", [ad])
await fails(p2, 'select bazar_comment($1,$2)', [ad, 'ještě?'], /prodaný/)
await fails(p2, 'select bazar_delete($1)', [ad], /svůj inzerát/)
const photos = await one(boss, 'bazar_delete', [ad])
assert.equal(photos.length, 2)
step('bazar: 1–3 fotky ve vlastní složce, soukromá vlákna zájemce ↔ prodejce, prodáno, smazání (admin)')

await db.end()
console.log(`${ok} kroků prošlo`)
