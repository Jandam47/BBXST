// Integrační test schématu: celý turnaj od registrace po ukončení, s reálnými rolemi.
// Spuštění: node tests/db.test.mjs  (potřebuje lokální Postgres se stubem Supabase)
import pg from 'pg'
import assert from 'node:assert/strict'
import { pairSwissRound, computeStandings, buildDoubleElim, computePlacements, makeRng } from '../js/core.js'

const db = new pg.Client({ host: '/tmp/pg', port: 5499, user: 'postgres', database: 'bbx' })
await db.connect()
const rng = makeRng(42)
let ok = 0
const step = (s) => { ok++; console.log('✓', s) }

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
  if (nick && !anon) await as(user, 'update profiles set nick = $1, region = $2 where id = auth.uid()', [nick, 'Pardubický'])
  return user
}

// ── uživatelé a role ───────────────────────────────────────────────
const adam = await newUser('Adam')
await as(null, "update profiles set role = 'superadmin' where id = $1", [adam.id])
const org = await newUser('Org'), judge = await newUser('Judge'), admin2 = await newUser('Admin2')
await as(adam, 'select set_user_role($1, $2)', [admin2.id, 'admin'])
await as(admin2, 'select set_user_role($1, $2)', [org.id, 'organizer'])
await as(admin2, 'select set_user_role($1, $2)', [judge.id, 'judge'])
await fails(admin2, 'select set_user_role($1, $2)', [org.id, 'admin'], /nemůžeš/)
await fails(org, 'select set_user_role($1, $2)', [judge.id, 'organizer'], /jen admin/)
await fails(judge, "update profiles set role = 'admin' where id = auth.uid()", [], /admin/)
await fails(judge, 'update profiles set rating = 3000 where id = auth.uid()', [], /Rating/)
step('role: hlavní admin → admin → organizátor/judge, ochrana proti samopovýšení')

const players = []
for (let i = 1; i <= 9; i++) players.push(await newUser('Hrac' + i))
const guest = await newUser(null, true), guest2 = await newUser(null, true)
await fails(guest, "update profiles set nick = 'Hostik' where id = auth.uid()", [], /Host/)
step('host nemůže zabrat nick v profilu')

// ── turnaj ─────────────────────────────────────────────────────────
await fails(players[0], "insert into tournaments (name) values ('Fake')", [], /row-level/)
const [t] = await as(org, `insert into tournaments (name, swiss_rounds, top_cut, arena_count, status, current_round)
                           values ('Pardubice Cup', 3, 4, 2, 'finished', 99) returning *`)
assert.equal(t.status, 'registration'); assert.equal(t.current_round, 0)
step('organizátor založí turnaj (stav nejde podvrhnout)')

const DECK = [
  { type: 'bx', blade: 'dran sword', ratchet: '3-60', bit: 'flat' },
  { type: 'cx', lock: 'Wizard', main: 'Arc', assist: 'Round', ratchet: '4-55', bit: 'Low Orb' },
  { type: 'bx', blade: 'Hells Nether', bit: 'Ball' },
]
const deck = () => JSON.stringify(DECK)
for (const p of players) {
  const [r] = await as(p, `insert into registrations (tournament_id, nick, deck) values ($1, 'PodvrzenyNick', $2) returning id, nick`,
                       [t.id, deck()])
  assert.equal(r.nick, p.nick, 'nick účtu se vynutí z profilu')
  p.reg = r.id
}
await fails(guest, `insert into registrations (tournament_id, nick, deck) values ($1, 'hrac1', $2)`, [t.id, deck()], /patří registrovanému/)
await fails(guest, `insert into registrations (tournament_id, nick, deck) values ($1, 'Host1', $2)`, [t.id, JSON.stringify([DECK[0], DECK[0], DECK[1]])], /jiný/)
await fails(guest, `insert into registrations (tournament_id, nick, deck) values ($1, 'Host1', $2)`, [t.id, JSON.stringify([{ ...DECK[0], blade: 'Mega Sword' }, DECK[1], DECK[2]])], /Mega Sword.*není/)
await fails(guest, `insert into registrations (tournament_id, nick, deck) values ($1, 'Host1', $2)`, [t.id, JSON.stringify([{ ...DECK[0], ratchet: '' }, DECK[1], DECK[2]])], /ratchet/i)
await fails(guest, `insert into registrations (tournament_id, nick, bey1, bey2, bey3) values ($1, 'Host1', 'a', 'b', 'c')`, [t.id], /seznamu dílů/)
const [g] = await as(guest, `insert into registrations (tournament_id, nick, deck) values ($1, 'Host1', $2) returning id`, [t.id, deck()])
guest.reg = g.id
{
  const [row] = await as(null, 'select bey1, bey2, bey3, deck from registrations where id = $1', [guest.reg])
  assert.deepEqual([row.bey1, row.bey2, row.bey3], ['Dran Sword 3-60F', 'Wizard Arc R4-55LO', 'Hells Nether B'])
  assert.equal(row.deck[0].blade, 'Dran Sword')   // normalizace na oficiální název
  assert.equal(row.deck[2].ratchet, undefined)    // integrovaný ratchet
  const [{ c }] = await as(null, `select compose_bey($1) c`, [JSON.stringify({ type: 'cx', lock: 'Knight', main: 'Fortress', over: 'Guard', assist: 'Vertical', ratchet: '8-70', bit: 'Under Needle' })])
  assert.equal(c, 'Knight Fortress GV8-70UN')
  const [{ c: c2 }] = await as(null, `select compose_bey($1) c`, [JSON.stringify({ type: 'cx', lock: 'Pegasus', main: 'Blast', assist: 'Assault', bit: 'Turbo' })])
  assert.equal(c2, 'Pegasus Blast ATr')
  const [{ c: c3 }] = await as(null, `select compose_bey($1) c`, [JSON.stringify({ type: 'bx', blade: 'Scythe Incendio', ratchet: '3-80', bit: 'disc ball' })])
  assert.equal(c3, 'Hells Scythe 3-80DB')
}
await as(guest, `update registrations set deck = $2 where id = $1`, [guest.reg, JSON.stringify([{ ...DECK[0], blade: 'Shark Edge' }, DECK[1], DECK[2]])])
assert.equal((await as(null, 'select bey1 from registrations where id = $1', [guest.reg]))[0].bey1, 'Shark Edge 3-60F')
await as(guest, `update registrations set bey1 = 'Fake Bey' where id = $1`, [guest.reg])   // název beye nejde podvrhnout
assert.equal((await as(null, 'select bey1 from registrations where id = $1', [guest.reg]))[0].bey1, 'Shark Edge 3-60F')
await fails(guest, `update registrations set seed = 1 where id = $1`, [guest.reg], /upravit/)
const walkin = (await as(org, 'select add_walkin($1, $2, $3) as id', [t.id, 'Walkin', deck()]))[0].id
assert.ok((await as(players[0], 'select count(*)::int c from bey_parts'))[0].c > 150)
await fails(players[0], "insert into bey_parts (category, name) values ('bit','Hack')", [], /row-level/)
await as(adam, "insert into bey_parts (category, name, abbr) values ('bit','Testovací Bit','TB')")
step('registrace: účty, host, kontrola nicku a beyů, úprava, walk-in')

await fails(players[0], 'select qr_token from registrations limit 1', [], /permission denied/)
await fails(players[0], 'select bey1 from registrations limit 1', [], /permission denied/)
const masked = await as(players[0], 'select * from tournament_players($1)', [t.id])
assert.equal(masked.length, 11)
assert.ok(masked.find(r => r.id === players[0].reg).bey1, 'své beye vidím')
assert.equal(masked.find(r => r.id === players[1].reg).bey1, null, 'cizí ne')
assert.ok((await as(judge, 'select * from tournament_players($1)', [t.id])).every(r => r.bey1))
const [mine] = await as(players[0], 'select * from my_registration($1)', [t.id])
assert.ok(mine.qr_token)
step('QR token a beyblady jsou skryté, judge je vidí')

// ── swiss ──────────────────────────────────────────────────────────
await fails(players[0], 'select start_tournament($1)', [t.id], /nemůžeš/)
await as(org, 'select start_tournament($1)', [t.id])
await fails(guest2, `insert into registrations (tournament_id, nick, deck) values ($1, 'Pozde', $2)`, [t.id, deck()], /uzavřená/)
await fails(guest, `update registrations set deck = $2 where id = $1`, [guest.reg, deck()], /uzavřená/)

const regs = async () => (await as(org, 'select * from tournament_players($1)', [t.id])).map(r => ({ id: r.id, nick: r.nick, status: r.status, seed: r.seed }))
const allMatches = async () => as(null, 'select * from matches where tournament_id = $1 order by stage, round, pos', [t.id])

function fakePoints(p1s, p2s, m) {
  // rozpad skóre na souboje 1–3 body (poslední bod se ořízne na 7 stejně jako BBXST)
  const pts = []
  let a = 0, b = 0
  while (a < p1s || b < p2s) {
    const side = (a < p1s && (b >= p2s || rng() < 0.5)) ? 1 : 2
    const left = side === 1 ? p1s - a : p2s - b
    const v = Math.min(left, 1 + Math.floor(rng() * 3))
    if (side === 1) a += v; else b += v
    pts.push({ slot: side, pts: v, p1_bey: m.p1.beys[pts.length % 3], p2_bey: m.p2.beys[pts.length % 3] })
  }
  return pts
}

async function playMatch(matchId) {
  let res
  do {
    const [{ j: m }] = await as(judge, 'select judge_get_match($1) as j', [matchId])
    const p1win = rng() < 0.5, lo = Math.floor(rng() * 7)
    const s1 = p1win ? 7 : lo, s2 = p1win ? lo : 7
    const cid = crypto.randomUUID()
    ;[{ r: res }] = await as(judge, 'select submit_game($1,$2,$3,$4,$5) as r', [matchId, s1, s2, JSON.stringify(fakePoints(s1, s2, m)), cid])
    // dvojí odeslání stejné hry (offline fronta) se nezapočítá
    const [{ r: dup }] = await as(judge, 'select submit_game($1,$2,$3,$4,$5) as r', [matchId, s1, s2, '[]', cid])
    assert.equal(dup.duplicate, true)
  } while (!res.match_done)
}

for (let round = 1; round <= 3; round++) {
  const ps = await regs(), ms = await allMatches()
  const { pairs, bye } = pairSwissRound({ players: ps, matches: ms, round, rng })
  const payload = pairs.map(([a, b]) => ({ p1: a, p2: b }))
  if (bye) payload.push({ p1: bye, p2: null })
  if (round === 2) await fails(org, 'select create_swiss_round($1, $2, $3)', [t.id, 3, JSON.stringify(payload)], /Čekám kolo/)
  await as(org, 'select create_swiss_round($1, $2, $3)', [t.id, round, JSON.stringify(payload)])
  if (round === 1) {
    await fails(org, 'select create_swiss_round($1, $2, $3)', [t.id, 2, JSON.stringify(payload)], /dohrajte/)
    const sm = (await allMatches()).find(m => m.stage === 'swiss' && !m.is_bye)
    await fails(players[0], 'select submit_game($1, 7, 0)', [sm.id], /judge/)
    await fails(judge, 'select submit_game($1, 7, 7)', [sm.id], /Neplatné/)
    await fails(judge, 'select submit_game($1, 7, 3, $2)', [sm.id, JSON.stringify([{ slot: 1, pts: 3 }])], /nesedí/)
    assert.equal((await as(players[0], `update matches set winner_reg = p1_reg where id = $1 returning id`, [sm.id])).length, 0)
    await fails(org, `update matches set winner_reg = p1_reg where id = $1`, [sm.id], /arena|Ručně/)
    await as(org, `update matches set arena = 2 where id = $1`, [sm.id])
    // judge najde zápas přes QR obou hráčů
    const tokP1 = (await db.query('select qr_token from registrations where id = $1', [sm.p1_reg])).rows[0].qr_token
    const tokP2 = (await db.query('select qr_token from registrations where id = $1', [sm.p2_reg])).rows[0].qr_token
    const [{ j: a }] = await as(judge, 'select judge_lookup_qr($1) as j', [tokP1])
    const [{ j: b }] = await as(judge, 'select judge_lookup_qr($1) as j', [tokP2])
    const [{ j: found }] = await as(judge, 'select judge_find_match($1, $2) as j', [b.reg, a.reg])
    assert.equal(found.id, sm.id)
    await fails(players[0], 'select judge_lookup_qr($1)', [tokP1], /judge/)
    const [{ j: q }] = await as(judge, 'select judge_arena_queue($1, 1) as j', [t.id])
    assert.ok(q.length >= 1 && q.every(m => m.arena === 1))
    await as(judge, 'select start_match($1)', [sm.id])
  }
  for (const m of (await allMatches()).filter(m => m.stage === 'swiss' && m.round === round && m.status !== 'done')) await playMatch(m.id)
}
await fails(org, 'select create_swiss_round($1, $2, $3)', [t.id, 4, '[]'], /Všechna swiss/)
const swissMs = (await allMatches()).filter(m => m.stage === 'swiss')
const byes = swissMs.filter(m => m.is_bye).map(m => m.p1_reg)
assert.equal(byes.length, 3); assert.equal(new Set(byes).size, 3)
step('swiss 3 kola × 11 hráčů: párování, volné losy, QR vyhledání, validace skóre, ochrana zápasů')

// ── top cut ────────────────────────────────────────────────────────
const ps = await regs()
const standings = computeStandings(ps, await allMatches(), { salt: t.id })
const top = standings.slice(0, 4)
await as(org, 'select create_topcut($1, $2, $3, $4, $5)', [t.id, 4, JSON.stringify({ gf: 3, lbf: 3, lbsf: 3 }),
  JSON.stringify(top.map((s, i) => ({ reg: s.id, seed: i + 1 }))), JSON.stringify(buildDoubleElim(4))])
let guard = 0
while (guard++ < 30) {
  const ready = (await allMatches()).filter(m => m.stage !== 'swiss' && m.status !== 'done' && m.p1_reg && m.p2_reg)
  if (!ready.length) break
  for (const m of ready) assert.ok(m.arena, 'připravený zápas má arénu')
  await playMatch(ready[0].id)
}
// oprava výsledku: vrátit poslední odehraný zápas WB1 není možné, pokud navazující začal; GF jde vrátit vždy
{
  const ms = await allMatches()
  const w1 = ms.find(m => m.key === 'W1-1')
  await fails(org, 'select reset_match($1)', [w1.id], /Navazující/)
  const g0 = ms.find(m => m.key === 'GF')
  const ratingBefore = (await db.query('select sum(rating)::int s from profiles')).rows[0].s
  await as(org, 'select reset_match($1)', [g0.id])
  const after = (await allMatches()).find(m => m.key === 'GF')
  assert.equal(after.status, 'pending'); assert.equal(after.p1_wins + after.p2_wins, 0)
  assert.equal((await db.query('select count(*)::int c from games where match_id = $1', [g0.id])).rows[0].c, 0)
  assert.equal((await db.query('select sum(rating)::int s from profiles')).rows[0].s, ratingBefore)
  await fails(players[0], 'select reset_match($1)', [g0.id], /nemůžeš/)
  await playMatch(g0.id)
}
const gf = (await allMatches()).find(m => m.key === 'GF')
assert.equal(gf.status, 'done'); assert.equal(gf.best_of, 3); assert.ok(Math.max(gf.p1_wins, gf.p2_wins) === 2)
step('top 4 double elimination až po BO3 grand finále + oprava výsledku')

// top cut s byes (6 hráčů → pavouk 8) na druhém turnaji
const [t2] = await as(org, `insert into tournaments (name, swiss_rounds, top_cut, arena_count) values ('Bye Cup', 1, 6, 3) returning *`)
for (const p of players.slice(0, 7)) await as(p, `insert into registrations (tournament_id, nick, deck) values ($1,'x',$2)`, [t2.id, deck()])
await as(org, 'select start_tournament($1)', [t2.id])
{
  const ps2 = (await as(org, 'select * from tournament_players($1)', [t2.id]))
  const { pairs, bye } = pairSwissRound({ players: ps2, matches: [], round: 1, rng })
  await as(org, 'select create_swiss_round($1, 1, $2)', [t2.id, JSON.stringify([...pairs.map(([a, b]) => ({ p1: a, p2: b })), { p1: bye, p2: null }])])
  for (const m of (await as(null, "select id from matches where tournament_id = $1 and status <> 'done'", [t2.id]))) await playMatch(m.id)
  const st = computeStandings(ps2, await as(null, 'select * from matches where tournament_id = $1', [t2.id]))
  await as(org, 'select create_topcut($1, 6, null, $2, $3)', [t2.id, JSON.stringify(st.slice(0, 6).map((s, i) => ({ reg: s.id, seed: i + 1 }))), JSON.stringify(buildDoubleElim(6))])
  const walk = await as(null, "select key, status, is_bye from matches where tournament_id = $1 and stage <> 'swiss' and is_bye", [t2.id])
  assert.ok(walk.length >= 2, 'seedy 1 a 2 postoupily přes bye')
  let gg = 0
  while (gg++ < 40) {
    const ready = await as(null, "select id from matches where tournament_id = $1 and stage <> 'swiss' and status <> 'done' and p1_reg is not null and p2_reg is not null", [t2.id])
    if (!ready.length) break
    await playMatch(ready[0].id)
  }
  assert.equal((await as(null, "select status from matches where tournament_id = $1 and key = 'GF'", [t2.id]))[0].status, 'done')
}
step('top 6 s byes (kontumace se propíšou do loser bracketu)')

// ── ukončení ───────────────────────────────────────────────────────
const all = await allMatches()
const withSeeds = (await regs())
const placements = computePlacements({ players: withSeeds, matches: all, topN: 4, salt: t.id })
await fails(judge, 'select finish_tournament($1, $2)', [t.id, JSON.stringify(placements)], /nemůžeš/)
await as(org, 'select finish_tournament($1, $2)', [t.id, JSON.stringify(placements)])
const winner = placements[0].reg
assert.equal((await db.query('select final_place from registrations where id = $1', [winner])).rows[0].final_place, 1)
const pub = await as(guest2, 'select * from tournament_players($1)', [t.id])
assert.ok(pub.every(r => r.bey1), 'po skončení beyblady vidí všichni')
step('ukončení turnaje, umístění uloženo, beyblady zveřejněny')

const someone = players.find(p => p.reg === winner) || players[0]
const [{ s: stats }] = await as(guest2, 'select player_stats($1) as s', [someone.id])
assert.ok(stats.tournaments.length >= 1 && stats.recent.length >= 1 && stats.beys.length >= 1 && stats.rating.length >= 1)
assert.ok(stats.record.wins + stats.record.losses > 0)
const list = await as(null, 'select * from players_list()')
assert.ok(list.length >= 12 && !list.some(p => p.nick === null))
step('statistiky hráče (historie, beyblady, rating) a seznam hráčů')

// ── chat ───────────────────────────────────────────────────────────
await as(players[0], "insert into chat_messages (room_id, body, nick) values ('volny', 'Ahoj!', 'Podvrh')")
const [msg] = await as(null, "select * from chat_messages where room_id = 'volny'")
assert.equal(msg.nick, 'Hrac1')
await fails(guest, "insert into chat_messages (room_id, body) values ('volny', 'spam')", [], /row-level|přihlášení/)
assert.equal((await as(players[1], 'delete from chat_messages where id = $1 returning id', [msg.id])).length, 0)
assert.equal((await as(admin2, 'delete from chat_messages where id = $1 returning id', [msg.id])).length, 1)
step('chat: nick z profilu, host nepíše, mazání jen vlastní / admin')

// ── arény ──────────────────────────────────────────────────────────
const [t3] = await as(org, `insert into tournaments (name, arena_count) values ('Arena test', 2) returning id`)
await as(judge, 'insert into arena_judges (tournament_id, arena) values ($1, 1)', [t3.id])
await fails(players[0], 'insert into arena_judges (tournament_id, arena) values ($1, 2)', [t3.id], /row-level/)
await fails(judge, 'insert into arena_judges (tournament_id, arena) values ($1, 5)', [t3.id], /row-level/)
step('judge si zabere arénu, hráč ne')

console.log(`\n${ok} kroků prošlo`)
await db.end()
