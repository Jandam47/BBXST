// Integrační test 27-live.sql: decky pro diváky (až po startu), sledování hráčů a push sledujícím.
// Spuštění: node tests/live.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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
  try { return (await db.query(sql, params)).rows } finally { await db.query('reset role') }
}
async function fails(user, sql, params, re) {
  try { await as(user, sql, params) } catch (e) { if (re) assert.match(e.message, re); return }
  throw new Error('Mělo selhat: ' + sql)
}
async function newUser(nick, anon = false) {
  const [u] = (await db.query('insert into auth.users (is_anonymous) values ($1) returning id', [anon])).rows
  const user = { id: u.id, nick }
  if (!anon) await as(user, 'update profiles set nick = $1 where id = auth.uid()', [nick])
  return user
}
let mark = 0
const since = async () => { mark = Number((await db.query('select coalesce(max(id),0) m from push_outbox')).rows[0].m) }
const sentTo = async (user) => (await db.query('select title, body, url from push_outbox where id > $1 and $2 = any(user_ids) order by id', [mark, user.id])).rows

const org = await newUser('LOrg' + sfx), a = await newUser('LA' + sfx), b = await newUser('LB' + sfx)
const fan = await newUser('LFan' + sfx), host = await newUser('LHost' + sfx, true)
await db.query("update profiles set role = 'organizer' where id = $1", [org.id])
await as(fan, 'select push_subscribe($1,$2,$3)', [`https://push.example/${fan.id}`, 'key', 'auth'])
const t = (await db.query(`insert into tournaments (kind, name, swiss_rounds, top_cut, created_by) values ('tournament', 'Live Cup ${sfx}', 3, 0, $1) returning id`, [org.id])).rows[0]
const deck = '[{"type":"bx","blade":"Dran Sword","ratchet":"3-60","bit":"Flat"},{"type":"bx","blade":"Hells Scythe","ratchet":"4-60","bit":"Taper"},{"type":"bx","blade":"Wizard Arrow","ratchet":"4-80","bit":"Ball"}]'
const ra = (await db.query('insert into registrations (tournament_id, user_id, nick, deck) values ($1,$2,$3,$4) returning id', [t.id, a.id, a.nick, deck])).rows[0].id
const rb = (await db.query('insert into registrations (tournament_id, user_id, nick, deck) values ($1,$2,$3,$4) returning id', [t.id, b.id, b.nick, deck])).rows[0].id

// decky: před startem nic, po startu všem (i bez přihlášení)
assert.equal((await as(null, 'select * from live_decks($1)', [t.id])).length, 0, 'před startem decky skryté')
await db.query("update tournaments set status = 'swiss', current_round = 1 where id = $1", [t.id])
const decks = await as(null, 'select * from live_decks($1)', [t.id])
assert.equal(decks.length, 2)
assert.deepEqual(decks.find(x => x.reg === ra).beys, ['Dran Sword 3-60F', 'Hells Scythe 4-60T', 'Wizard Arrow 4-80B'])
step('live_decks: před startem prázdné, po startu decky všech hráčů i bez přihlášení')

// sledování: jen účet, vlastní seznam
await fails(host, 'select live_follow_set($1, true)', [ra], /účet|nick/)
await fails(null, 'select live_follow_set($1, true)', [ra], /permission/)
await as(fan, 'select live_follow_set($1, true)', [ra])
await as(fan, 'select live_follow_set($1, true)', [ra])           // podruhé nic nezdvojí
assert.deepEqual((await as(fan, 'select live_follow_list($1) r', [t.id])).map(x => x.r), [ra])
assert.equal((await as(a, 'select live_follow_list($1) r', [t.id])).length, 0)
await fails(fan, 'select * from live_follows', [], /permission/)
step('sledování: jen s účtem, bez duplicit, každý vidí jen svoje')

// push: zápas na aréně a výsledek sledujícímu (akci dělá „systém“, ne divák – jinak by si ji bbx_push nepošle sám sobě)
await db.query("select set_config('request.jwt.claims', '', false)")
await since()
const m = (await db.query(`insert into matches (tournament_id, key, stage, round, pos, p1_reg, p2_reg, arena, status) values ($1, 's1-1', 'swiss', 1, 1, $2, $3, 3, 'pending') returning id`, [t.id, ra, rb])).rows[0].id
const call = (await sentTo(fan))[0]
assert.equal(call?.title, `Aréna 3: ${a.nick} vs ${b.nick}`); assert.equal(call.url, `#/t/${t.id}/live`)
await since()
await db.query(`update matches set status = 'done', winner_reg = $2, p1_score = 4, p2_score = 7, finished_at = now() where id = $1`, [m, rb])
assert.equal((await sentTo(fan))[0]?.title, `${b.nick} porazil ${a.nick} 7:4`)
// odhlášení ze sledování → nic
await as(fan, 'select live_follow_set($1, false)', [ra])
await db.query("select set_config('request.jwt.claims', '', false)")
await since()
await db.query(`insert into matches (tournament_id, key, stage, round, pos, p1_reg, p2_reg, arena, status) values ($1, 's2-1', 'swiss', 2, 1, $2, $3, 1, 'pending')`, [t.id, ra, rb])
assert.equal((await sentTo(fan)).length, 0)
step('push sledujícímu: zápas na aréně, výsledek; po zrušení sledování nic')

// ── video z arény (46): kameraman, vysílání, převzetí, ukončení ──
{
  const judge = await newUser('LJudge' + sfx), cam = await newUser('LCam' + sfx), adm = await newUser('LAdm' + sfx)
  await db.query("update profiles set role = 'judge' where id = $1", [judge.id])
  await db.query("update profiles set role = 'admin' where id = $1", [adm.id])
  assert.equal((await as(judge, 'select live_video_me() r'))[0].r, true, 'judge má kameramana automaticky')
  assert.equal((await as(cam, 'select live_video_me() r'))[0].r, false, 'hráč ne')
  await fails(cam, "select live_video_start($1, 1, 'kanal_cam')", [t.id], /kameraman/)
  await fails(cam, "update profiles set camera = true where id = auth.uid()", [], /admin/)
  await fails(judge, 'select set_camera($1, true)', [cam.id], /admin/)
  await as(adm, 'select set_camera($1, true)', [cam.id])
  assert.equal((await as(cam, 'select live_video_me() r'))[0].r, true)
  await as(adm, 'select set_camera($1, false)', [judge.id])
  assert.equal((await as(judge, 'select live_video_me() r'))[0].r, false, 'judgovi jde odebrat')
  await as(adm, 'select set_camera($1, true)', [judge.id])
  assert.equal((await db.query('select camera from profiles where id = $1', [judge.id])).rows[0].camera, null, 'zpět na výchozí podle role')
  await fails(judge, "select live_video_start($1, 9, 'kanal')", [t.id], /aréna/)
  await fails(judge, "select live_video_start($1, 1, 'https://example.com/x')", [t.id], /Twitchi/)
  // odkazy: Twitch kanál / twitch.tv / YouTube
  const parse = async (u) => (await db.query('select provider, channel from bbx_parse_stream($1)', [u])).rows[0]
  assert.deepEqual(await parse('BBX_Pardubice'), { provider: 'twitch', channel: 'bbx_pardubice' })
  assert.deepEqual(await parse('https://www.twitch.tv/BBX_Pardubice?sr=a'), { provider: 'twitch', channel: 'bbx_pardubice' })
  assert.deepEqual(await parse('m.twitch.tv/adam47'), { provider: 'twitch', channel: 'adam47' })
  assert.deepEqual(await parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), { provider: 'youtube', channel: 'dQw4w9WgXcQ' })
  assert.deepEqual(await parse('https://youtu.be/dQw4w9WgXcQ'), { provider: 'youtube', channel: 'dQw4w9WgXcQ' })
  assert.deepEqual(await parse('https://youtube.com/live/dQw4w9WgXcQ?si=x'), { provider: 'youtube', channel: 'dQw4w9WgXcQ' })
  // vysílání: start, seznam (i anon), převzetí, ukončení organizátorem
  assert.deepEqual((await as(judge, "select live_video_start($1, 1, 'twitch.tv/JudgeCam') r", [t.id]))[0].r, { provider: 'twitch', channel: 'judgecam' })
  let list = await as(null, 'select * from live_video_list($1)', [t.id])
  assert.equal(list.length, 1); assert.equal(list[0].nick, judge.nick); assert.equal(list[0].channel, 'judgecam'); assert.equal(list[0].can_stop, false)
  assert.equal((await as(judge, 'select * from live_video_list($1)', [t.id]))[0].mine, true)
  await as(judge, "select live_video_start($1, 2, 'JudgeCam')", [t.id])           // jeden telefon = jedna aréna
  list = await as(null, 'select * from live_video_list($1)', [t.id])
  assert.deepEqual(list.map(x => x.arena), [2])
  await as(cam, "select live_video_start($1, 2, 'https://youtu.be/dQw4w9WgXcQ')", [t.id])   // převzetí
  list = await as(null, 'select * from live_video_list($1)', [t.id])
  assert.equal(list[0].nick, cam.nick); assert.equal(list[0].provider, 'youtube')
  await fails(null, "select live_video_start($1, 1, 'x_anon')", [t.id], /permission/)
  await as(a, 'select live_video_stop($1, 2)', [t.id])            // cizí hráč nic nezmění
  assert.equal((await as(null, 'select * from live_video_list($1)', [t.id])).length, 1)
  assert.equal((await as(org, 'select * from live_video_list($1)', [t.id]))[0].can_stop, true)
  await as(org, 'select live_video_stop($1, 2)', [t.id])
  assert.equal((await as(null, 'select * from live_video_list($1)', [t.id])).length, 0)
  await fails(cam, 'select * from live_streams', [], /permission/)
  step('video z arény: kameraman (judge auto, admin přidělí / odebere), Twitch / YouTube odkazy, převzetí, ukončení')
}

await db.end()
console.log(`${ok} kroků prošlo`)
