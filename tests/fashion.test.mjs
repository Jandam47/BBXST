// Integrační test Fashion show (10-fashion.sql): přihlášky, design judge, hodnocení,
// automatický posun, tajné body, rozstřel, boss of fashion, postupné vyhlášení, achievementy.
// Spuštění: node tests/fashion.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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
  }
  try { return (await db.query(sql, params)).rows } finally { await db.query('reset role') }
}
async function fails(user, sql, params, re) {
  try { await as(user, sql, params) } catch (e) { if (re) assert.match(e.message, re); return e.message }
  throw new Error('Mělo selhat: ' + sql)
}
async function newUser(nick, anon = false) {
  const [u] = (await db.query('insert into auth.users (is_anonymous) values ($1) returning id', [anon])).rows
  const user = { id: u.id, anon, nick }
  if (nick && !anon) await as(user, 'update profiles set nick = $1 where id = auth.uid()', [nick])
  return user
}
const board = async (user, t) => (await as(user, 'select fashion_board($1) as b', [t]))[0].b
const tour = async (t) => (await db.query('select * from tournaments where id = $1', [t])).rows[0]
// posun času vyhlášení (místo čekání 15 s)
const rewind = (t, s) => db.query(`update tournaments set fashion = jsonb_set(fashion, '{reveal_at}', to_jsonb(now() - make_interval(secs => $2)))
                                    where id = $1`, [t, s])

const org = await newUser('FOrg' + sfx)
await as(null, "update profiles set role = 'organizer' where id = $1", [org.id])

const DECK = [
  { type: 'bx', blade: 'Dran Sword', ratchet: '3-60', bit: 'Flat' },
  { type: 'bx', blade: 'Dran Sword', ratchet: '3-60', bit: 'Flat' },
  { type: 'cx', lock: 'Wizard', main: 'Arc', assist: 'Round', ratchet: '4-55', bit: 'Low Orb' },
  { type: 'bx', blade: 'Hells Scythe', ratchet: '4-60', bit: 'Taper' },
]

// ── založení ───────────────────────────────────────────────────────
const [t] = await as(org, `insert into tournaments (kind, event_type, fashion_beys, name, swiss_rounds, top_cut)
                           values ('event', 'fashion', 4, 'Fashion ${sfx}', 1, 0) returning *`)
assert.equal(t.event_type, 'fashion'); assert.equal(t.fashion_beys, 4)
await fails(org, `update tournaments set fashion = '{"phase":"done"}' where id = $1`, [t.id], /ovládání/)
const [tr] = await as(org, `insert into tournaments (kind, event_type, name, swiss_rounds, top_cut) values ('event','training','Trenink ${sfx}',1,0) returning *`)
assert.equal(tr.event_type, 'training')
step('organizátor založí Fashion akci se 4 beyi (stav show nejde podvrhnout)')

// ── přihlášky ──────────────────────────────────────────────────────
const P = []
for (let i = 1; i <= 5; i++) P.push(await newUser(`FHrac${i}${sfx}`))
const host = await newUser(null, true)
await fails(P[0], `insert into registrations (tournament_id, nick, deck) values ($1, 'x', $2)`, [t.id, JSON.stringify(DECK.slice(0, 3))], /všech 4/)
for (const p of P) {
  const [r] = await as(p, `insert into registrations (tournament_id, nick, deck) values ($1, 'x', $2) returning id`, [t.id, JSON.stringify(DECK)])
  p.reg = r.id
  const [{ bey1 }] = (await db.query('select bey1 from registrations where id = $1', [r.id])).rows
  assert.equal(bey1, 'Dran Sword 3-60F')
}
const [hr] = await as(host, `insert into registrations (tournament_id, nick, deck) values ($1, 'FHost${sfx}', $2) returning id`, [t.id, JSON.stringify(DECK)])
host.reg = hr.id
await fails(org, `update tournaments set fashion_beys = 3 where id = $1`, [t.id], /nikdo nepřihlásil/)
// tréninková akce deck nemá
const [trr] = await as(P[0], `insert into registrations (tournament_id, nick, deck) values ($1, 'x', $2) returning id`, [tr.id, JSON.stringify(DECK)])
assert.equal((await db.query('select deck from registrations where id = $1', [trr.id])).rows[0].deck, null)
step('přihlášky s účtem i bez (host), deck musí mít přesně N beyů, stejné beye jsou OK')

// ── design judge ───────────────────────────────────────────────────
const J = []
for (let i = 1; i <= 3; i++) J.push(await newUser(`FJudge${i}${sfx}`))
await fails(host, 'select fashion_judge_join($1)', [t.id], /přihlášený svým účtem/)
await fails(P[0], 'select fashion_judge_join($1)', [t.id], /přihlášený do soutěže/)
await fails(J[0], 'select fashion_judge_join($1)', [tr.id], /není Fashion/)
for (const j of J) await as(j, 'select fashion_judge_join($1)', [t.id])
const extra = await newUser('FExtra' + sfx)
await as(extra, 'select fashion_judge_join($1)', [t.id])
await fails(extra, `insert into registrations (tournament_id, nick, deck) values ($1, 'x', $2)`, [t.id, JSON.stringify(DECK)], /design judge/)
await as(extra, 'select fashion_judge_leave($1)', [t.id])
let b = await board(null, t.id)
assert.equal(b.judges.length, 3)
assert.equal(b.players.length, 6)
assert.equal(b.players[0].beys, null, 'beye cizích hráčů před startem nejsou vidět')
const own = (await board(P[1], t.id)).players.find(p => p.id === P[1].reg)
assert.equal(own.beys.length, 4)
step('design judge jen s účtem a mimo soutěž; před startem vidí beye jen majitel')

// ── start ──────────────────────────────────────────────────────────
await fails(P[0], 'select fashion_start($1)', [t.id], /nemůžeš řídit/)
await as(org, 'select fashion_start($1)', [t.id])
let tt = await tour(t.id)
assert.equal(tt.status, 'show'); assert.equal(tt.fashion.phase, 'scoring')
await fails(J[0], 'select fashion_judge_leave($1)', [t.id], /Po startu/)
await fails(host, `insert into registrations (tournament_id, nick, deck) values ($1, 'Pozde', $2)`, [t.id, JSON.stringify(DECK)], /uzavřená/)
b = await board(null, t.id)
const order = b.players.map(p => p.id)
assert.deepEqual(b.players.map(p => p.seed), [1, 2, 3, 4, 5, 6])
assert.equal(tt.fashion.current, order[0])
assert.ok(b.players.every(p => p.beys.length === 4), 'po startu jsou beye vidět všem')
step('start zamíchá pořadí a vyvolá prvního, registrace i judge se uzavřou')

// ── hodnocení ──────────────────────────────────────────────────────
// body (design, harmony, cosplay, uniq, extra) – hráči podle pořadí; 0 a 1 budou mít shodu na 1. místě
const plan = [
  [10, 5, 5, 3, 1],   // 24
  [10, 5, 5, 3, 1],   // 24
  [8, 4, 3, 2, 0],    // 17
  [8, 4, 3, 2, 0],    // 17
  [5, 2, 1, 1, 0],    // 9
  [2, 1, 0, 0, 0],    // 3
]
const rate = (j, reg, s) => as(j, 'select fashion_rate($1,$2,$3,$4,$5,$6,$7)', [t.id, reg, ...s])
await fails(J[0], 'select fashion_rate($1,$2,$3,$4,$5,$6,$7)', [t.id, order[1], ...plan[1]], /ještě nebyl vyvolaný/)
await fails(P[0], 'select fashion_rate($1,$2,$3,$4,$5,$6,$7)', [t.id, order[0], ...plan[0]], /design judge/)
await fails(J[0], 'select fashion_rate($1,$2,$3,$4,$5,$6,$7)', [t.id, order[0], 11, 5, 5, 3, 1], /check/)
await rate(J[0], order[0], [1, 1, 1, 1, 0])
await rate(J[0], order[0], plan[0])      // přepsání vlastního hodnocení
await rate(J[1], order[0], plan[0])
b = await board(P[0], t.id)
assert.equal(b.players[0].rated_by.length, 2)
assert.equal(b.players[0].score, null, 'body jsou tajné')
assert.equal((await board(J[0], t.id)).players[0].my_score.design, 10, 'judge vidí svoje hodnocení')
assert.equal((await tour(t.id)).fashion.current, order[0], 'čeká se na posledního judge')
await rate(J[2], order[0], plan[0])
assert.equal((await tour(t.id)).fashion.current, order[1], 'po všech judgích se vyvolá další')
step('hodnocení: jen judge, jen vyvolaní, rozsahy bodů, tajné body, automatický posun')

// organizátor může vyvolat dalšího dřív; zapomenutého hráče jde dohodnotit
await as(org, 'select fashion_next($1)', [t.id])
assert.equal((await tour(t.id)).fashion.current, order[2])
for (const j of J) await rate(j, order[1], plan[1])     // dohodnocení dřívějšího hráče posun nespustí
assert.equal((await tour(t.id)).fashion.current, order[2])
for (let i = 2; i < 6; i++) {
  if (i < 5) await fails(org, 'select fashion_finish($1)', [t.id], /všichni hráči/)
  for (const j of J) await rate(j, order[i], plan[i])
}
tt = await tour(t.id)
assert.equal(tt.fashion.current, order[5]); assert.equal(tt.fashion.last, true)
step('organizátor vyvolá dalšího dřív, zapomenutý hráč jde dohodnotit, poslední zůstane vyvolaný')

// ── rozstřel o 1. místo ────────────────────────────────────────────
await as(org, 'select fashion_finish($1)', [t.id])
tt = await tour(t.id)
assert.equal(tt.fashion.phase, 'tiebreak')
assert.deepEqual([...tt.fashion.tie].sort(), [order[0], order[1]].sort())
await fails(J[0], 'select fashion_vote($1,$2)', [t.id, order[2]], /shodou/)
await as(J[0], 'select fashion_vote($1,$2)', [t.id, order[0]])
await as(J[1], 'select fashion_vote($1,$2)', [t.id, order[1]])
assert.equal((await board(null, t.id)).voted.length, 2)
// třetí judge nehlasuje – organizátor uzavře → shoda 1:1 → boss
await as(org, 'select fashion_close_vote($1)', [t.id])
tt = await tour(t.id)
assert.equal(tt.fashion.phase, 'boss')
const boss = J.find(j => j.id === tt.fashion.boss)
assert.ok(boss, 'boss je jeden z judgů')
const notBoss = J.find(j => j !== boss)
await fails(notBoss, 'select fashion_boss_pick($1,$2)', [t.id, order[1]], /boss of fashion/)
await as(boss, 'select fashion_boss_pick($1,$2)', [t.id, order[1]])
tt = await tour(t.id)
assert.equal(tt.status, 'finished'); assert.equal(tt.fashion.phase, 'done')
step('shoda na 1. místě → rozstřel, znovu shoda → boss of fashion vybere vítěze')

// ── postupné vyhlášení ─────────────────────────────────────────────
const places = async () => Object.fromEntries((await board(null, t.id)).players.map(p => [p.id, p.place]))
let pl = await places()
assert.equal(pl[order[4]], 5); assert.equal(pl[order[5]], 6)
assert.equal(pl[order[2]], null); assert.equal(pl[order[1]], null)
await rewind(t.id, 6)
pl = await places()
assert.equal(pl[order[2]], 3); assert.equal(pl[order[3]], 3, 'shoda na 3. místě = dělené místo')
assert.equal(pl[order[0]], null)
await rewind(t.id, 11)
pl = await places()
assert.equal(pl[order[0]], 2); assert.equal(pl[order[1]], null)
assert.equal((await board(null, t.id)).players[0].score, null)
await rewind(t.id, 16)
const fb = await board(null, t.id)
pl = Object.fromEntries(fb.players.map(p => [p.id, p.place]))
assert.equal(pl[order[1]], 1)
assert.equal(fb.players.find(p => p.id === order[0]).score.total, 72)
assert.equal(fb.players.find(p => p.id === order[2]).score.total, 51)
step('vyhlášení: 4.+ hned, 3. / 2. / 1. postupně, body až na konci; dělené 3. místo')

// ── achievementy ───────────────────────────────────────────────────
const winner = P.find(p => p.reg === order[1]) || host
if (winner !== host) {
  const ach = (await as(null, 'select player_achievements($1) as a', [winner.id]))[0].a
  assert.equal(ach.length, 1); assert.equal(ach[0].place, 1)
}
const stats = (await as(null, 'select player_stats($1) as s', [winner.id]))[0].s
assert.equal(stats.record.titles, 0, 'fashion se nepočítá do turnajových titulů')
step('achievementy 1.–3. místa v profilu, tituly z turnajů zůstávají zvlášť')

// ── odstoupení během show ──────────────────────────────────────────
const [t2] = await as(org, `insert into tournaments (kind, event_type, fashion_beys, name, swiss_rounds, top_cut)
                            values ('event', 'fashion', 1, 'Fashion2 ${sfx}', 1, 0) returning *`)
for (const p of P.slice(0, 3)) await as(p, `insert into registrations (tournament_id, nick, deck) values ($1, 'x', $2)`, [t2.id, JSON.stringify(DECK.slice(0, 1))])
await as(J[0], 'select fashion_judge_join($1)', [t2.id])
await fails(org, `select finish_tournament($1, '[]')`, [t2.id], /vyhlášením/)
await as(org, 'select fashion_start($1)', [t2.id])
let b2 = await board(null, t2.id)
const o2 = b2.players.map(p => p.id)
await as(org, 'select fashion_drop($1,$2)', [t2.id, o2[0]])
assert.equal((await tour(t2.id)).fashion.current, o2[1], 'vyřazený vyvolaný → další')
await as(J[0], 'select fashion_rate($1,$2,1,1,1,1,0)', [t2.id, o2[1]])
assert.equal((await tour(t2.id)).fashion.current, o2[2])
await as(J[0], 'select fashion_rate($1,$2,9,1,1,1,0)', [t2.id, o2[2]])
await as(org, 'select fashion_finish($1)', [t2.id])
await rewind(t2.id, 16)
b2 = await board(null, t2.id)
assert.deepEqual(b2.players.map(p => p.place), [null, 2, 1])
step('vyřazený hráč se přeskočí a nemá umístění; bez shody rovnou výsledky')

console.log(`\n${ok} kroků prošlo`)
await db.end()
