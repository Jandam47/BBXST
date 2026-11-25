// Integrační test komunit a komunitního tréninku (13-communities.sql).
// Spuštění: node tests/community.test.mjs  (po tests/reset_db.sh nebo tests/ui-up.sh)
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
async function newUser(nick, role = null, anon = false) {
  const [u] = (await db.query('insert into auth.users (is_anonymous) values ($1) returning id', [anon])).rows
  const user = { id: u.id, anon, nick }
  if (nick && !anon) await as(user, 'update profiles set nick = $1 where id = auth.uid()', [nick])
  if (role) await db.query('update profiles set role = $1 where id = $2', [role, u.id])
  return user
}
const one = async (user, fn, args = []) => (await as(user, `select ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args))[0].r

const boss = await newUser('CBoss' + sfx, 'superadmin')
const org = await newUser('COrg' + sfx, 'organizer')
const pl = []; for (let i = 1; i <= 5; i++) pl.push(await newUser(`CPl${i}${sfx}`))
const outsider = await newUser('COut' + sfx)
const guest = await newUser(null, null, true)

// ── založení a schválení ──────────────────────────────────────────
await fails(pl[0], 'select community_create($1)', ['Pardubice ' + sfx], /organizátoři/)
const cid = await one(org, 'community_create', ['Pardubice ' + sfx, 'Pardubická komunita', 'Pardubický kraj'])
await fails(org, 'select community_create($1)', ['pardubice ' + sfx], /už existuje/)
let list = await one(pl[0], 'community_list')
assert.ok(!list.some(c => c.id === cid), 'neschválená komunita není vidět ostatním')
assert.equal((await one(org, 'community_list')).find(c => c.id === cid).status, 'pending')
await fails(pl[0], 'select community_join($1)', [cid], /schválená/)
await fails(org, 'select admin_requests()', [], /hlavního admina/)
const req = await one(boss, 'admin_requests')
assert.ok(req.communities.some(c => c.id === cid))
await fails(org, 'select community_review($1, true)', [cid], /hlavní admin/)
await as(boss, 'select community_review($1, true)', [cid])
await fails(boss, 'select community_review($1, true)', [cid], /vyřízená/)
assert.ok((await one(pl[0], 'community_list')).some(c => c.id === cid))
step('organizátor založí komunitu, hlavní admin ji schválí, pak je vidět všem')

// ── členové ───────────────────────────────────────────────────────
await fails(guest, 'select community_join($1)', [cid], /účet/)
for (const p of pl) await as(p, 'select community_join($1)', [cid])
let d = await one(pl[0], 'community_detail', [cid])
assert.equal(d.members.length, 1); assert.equal(d.pending, null, 'žádosti vidí jen leader')
d = await one(org, 'community_detail', [cid])
assert.equal(d.pending.length, 5)
await fails(pl[0], 'select community_decide($1,$2,true)', [cid, pl[1].id], /leader/)
await as(org, 'select community_decide($1,$2,true)', [cid, pl[0].id])
await fails(pl[0], 'select community_set_role($1,$2,$3)', [cid, pl[0].id, 'sub'], /leader komunity/)
await as(org, 'select community_set_role($1,$2,$3)', [cid, pl[0].id, 'sub'])
await as(pl[0], 'select community_decide($1,$2,true)', [cid, pl[1].id])       // zástupce přijímá
await as(pl[0], 'select community_decide($1,$2,true)', [cid, pl[2].id])
await as(pl[0], 'select community_decide($1,$2,true)', [cid, pl[3].id])
await as(pl[0], 'select community_decide($1,$2,false)', [cid, pl[4].id])      // zamítnutí
d = await one(org, 'community_detail', [cid])
assert.deepEqual(d.members.map(m => m.role), ['leader', 'sub', 'member', 'member', 'member'])
assert.equal(d.pending.length, 0)
await fails(pl[0], 'select community_kick($1,$2)', [cid, org.id], /nemůžeš/)
await fails(org, 'select community_leave($1)', [cid], /Leader/)
const prof = await one(null, 'player_communities', [pl[0].id])
assert.deepEqual(prof, [{ id: cid, name: 'Pardubice ' + sfx, role: 'sub' }])
step('žádosti o členství schvaluje leader i zástupce, zástupce jmenuje jen leader, role v profilu')

// ── komunitní trénink ─────────────────────────────────────────────
await fails(pl[1], 'select community_training_create($1,$2)', [cid, 'Trénink'], /leader nebo zástupce/)
await fails(org, `insert into tournaments (kind, event_type, community_id, name, swiss_rounds, top_cut) values ('event','community',$1,'X',1,0)`, [cid], /stránce komunity/)
const tid = await one(pl[0], 'community_training_create', [cid, 'Středeční trénink ' + sfx, null, 'Klub', null])
const t = (await db.query('select * from tournaments where id = $1', [tid])).rows[0]
assert.equal(t.event_type, 'community'); assert.equal(t.rated, false); assert.equal(t.created_by, pl[0].id)
assert.equal(await one(pl[0], 'bbx_can_manage', [tid]).catch(() => true), true)
const reg = async (u, deck = null) => (await as(u, `insert into registrations (tournament_id, nick, deck) values ($1,'x',$2) returning id`, [tid, deck && JSON.stringify(deck)]))[0].id
const DECK = [{ type: 'bx', blade: 'Dran Sword', ratchet: '3-60', bit: 'Flat' }, { type: 'bx', blade: 'Dran Sword', ratchet: '3-60', bit: 'Flat' }]
await fails(outsider, `insert into registrations (tournament_id, nick) values ($1,'x')`, [tid], /členové komunity a pozvaní/)
await fails(guest, `insert into registrations (tournament_id, nick) values ($1,'Host')`, [tid], /účtem/)
const r0 = await reg(pl[0], DECK)
const r1 = await reg(pl[1])
const r2 = await reg(pl[2], [{ type: 'bx', blade: 'Hells Scythe', ratchet: '4-60', bit: 'Taper' }])
await fails(pl[1], 'select training_invite($1,$2)', [tid, outsider.id], /leader nebo zástupce/)
await as(org, 'select training_invite($1,$2)', [tid, outsider.id])
assert.equal((await one(outsider, 'my_training_invites')).length, 1)
const rOut = await reg(outsider, DECK)
assert.equal((await one(outsider, 'my_training_invites')).length, 0)
// jen jeden otevřený trénink
const tid2 = await one(org, 'community_training_create', [cid, 'Jiný trénink ' + sfx])
await fails(pl[1], `insert into registrations (tournament_id, nick) values ($1,'x')`, [tid2], /jiný trénink/)
// deck: opakované díly OK, max 3
await as(pl[1], `update registrations set deck = $1 where id = $2`, [JSON.stringify([...DECK, DECK[0]]), r1])
await fails(pl[1], `update registrations set deck = $1 where id = $2`, [JSON.stringify([...DECK, ...DECK]), r1], /1 až 3/)
let b = await one(pl[1], 'training_board', [tid])
assert.equal(b.players.length, 4); assert.equal(b.players.find(p => p.nick === 'COut' + sfx).guest, true)
step('trénink zakládá leader/zástupce; členové se přidají, pozvaný hráč taky; jen jeden trénink naráz')

// ── výzva a souboje ───────────────────────────────────────────────
const mid = await one(pl[1], 'training_challenge', [tid, r0])
assert.equal(await one(pl[1], 'training_challenge', [tid, r0]), mid, 'stejná dvojice = stejná výzva')
await fails(pl[1], 'select training_respond($1, true)', [mid], /vyzvaný/)
await fails(pl[2], 'select training_state($1)', [mid], /tvoje/)
await fails(pl[1], `select training_battle($1, gen_random_uuid(), 1, 2, 'burst', 0, 0)`, [mid], /aktivní/)
await as(pl[0], 'select training_respond($1, true)', [mid])
let st = await one(pl[0], 'training_state', [mid])
assert.equal(st.status, 'active'); assert.equal(st.me, 2); assert.equal(st.settings.mode, '3v3'); assert.equal(st.settings.win, 7)
assert.equal(st.settings.lineup.p1.length, 3); assert.equal(st.settings.lineup.p2[0].name, 'Dran Sword 3-60F')
// nastavení: do 5 bodů, 1v1
st = await one(pl[1], 'training_setup', [mid, JSON.stringify({ mode: '1v1', win: 5 })])
assert.equal(st.win, 5)
await fails(pl[1], 'select training_setup($1,$2)', [mid, JSON.stringify({ mode: '2v2' })], /mód/)
// oba zapisují; dedupe přes client_id
const cl = '11111111-1111-4111-8111-' + sfx.padEnd(12, '0').slice(0, 12).replace(/[^0-9a-f]/g, 'a')
await as(pl[1], `select training_battle($1, $2, 1, 3, null, 0, 0)`, [mid, cl])
await as(pl[1], `select training_battle($1, $2, 1, 3, null, 0, 0)`, [mid, cl])     // podruhé nic
await as(pl[0], `select training_battle($1, gen_random_uuid(), 2, 2, 'over', 0, 0)`, [mid])
await as(pl[0], `select training_battle($1, gen_random_uuid(), 0, 0, null, 0, 0)`, [mid])
st = await as(pl[1], `select training_battle($1, gen_random_uuid(), 1, 3, null, 0, 0) as r`, [mid]).then(r => r[0].r)
assert.deepEqual(st.game, { no: 1, s1: 5, s2: 2 }, 'xtreme se ořízne na 5 bodů')
st = await as(pl[1], `select training_battle($1, gen_random_uuid(), 2, 1, null, 0, 0) as r`, [mid]).then(r => r[0].r)
assert.deepEqual(st.game, { no: 2, s1: 0, s2: 1 }, 'po dosažení 5 začne další hra')
st = await one(pl[0], 'training_undo', [mid])
assert.deepEqual(st.game, { no: 1, s1: 5, s2: 2 })
// neomezeně
await as(pl[0], 'select training_setup($1,$2)', [mid, JSON.stringify({ win: null })])
{ const g0 = (await one(pl[0], 'training_state', [mid])).game.no
  const ts = await one(pl[0], 'training_setup', [mid, JSON.stringify({ tourney: true })])
  assert.equal(ts.tourney, true); assert.equal(ts.win, null)
  assert.equal((await one(pl[1], 'training_state', [mid])).game.no, g0, 'tournament mode nezačíná novou hru')
  assert.equal((await one(pl[1], 'training_setup', [mid, JSON.stringify({ win: null })])).tourney, true, 'zůstane zapnutý') }
st = await as(pl[0], `select training_battle($1, gen_random_uuid(), 1, 3, 'xtreme', 0, 0) as r`, [mid]).then(r => r[0].r)
assert.deepEqual(st.game, { no: 2, s1: 3, s2: 0 })
st = await as(pl[0], `select training_battle($1, gen_random_uuid(), 1, 3, 'xtreme', 0, 0) as r`, [mid]).then(r => r[0].r)
st = await as(pl[0], `select training_battle($1, gen_random_uuid(), 1, 3, 'xtreme', 0, 0) as r`, [mid]).then(r => r[0].r)
assert.deepEqual(st.game, { no: 2, s1: 9, s2: 0 }, 'neomezeně = bez konce hry')
// změna sestavy: p1 jiný bey
await as(pl[0], 'select training_setup($1,$2)', [mid, JSON.stringify({ lineup: { p1: [{ type: 'bx', blade: 'Hells Scythe', ratchet: '4-60', bit: 'Taper' }] } })])
await as(pl[0], `select training_battle($1, gen_random_uuid(), 2, 2, 'burst', 0, 0)`, [mid])
const bat = (await db.query('select p1_bey, p2_bey, finish, p1_parts from training_battles where match_id = $1 order by seq desc limit 1', [mid])).rows[0]
assert.equal(bat.p1_bey, 'Hells Scythe 4-60T'); assert.equal(bat.p2_bey, 'Dran Sword 3-60F'); assert.equal(bat.finish, 'burst')
assert.equal(bat.p1_parts.blade, 'Hells Scythe')
step('výzva → potvrzení → oba zapisují souboje, body na hru (5) i neomezeně, undo, změna sestavy')

// ── historie, comba, meta komunity ────────────────────────────────
const h = await one(pl[0], 'training_history', [tid])
assert.equal(h.matches.length, 1); assert.equal(h.matches[0].opponent, 'CPl2' + sfx)
assert.equal(h.totals.battles, 8)
const mineC = await one(pl[1], 'training_combos', [tid, 'me'])
const allC = await one(pl[1], 'training_combos', [tid, 'all'])
assert.ok(mineC.length >= 1 && allC.length >= mineC.length)
assert.ok(allC[0].win_rate >= allC[allC.length - 1].win_rate, 'seřazeno podle úspěšnosti')
const meta = await one(null, 'community_meta', [cid, 'build', 1])
assert.ok(meta.some(r => r.name === 'Dran Sword 3-60F'))
const metaBlade = await one(null, 'community_meta', [cid, 'blade', 1])
assert.ok(metaBlade.some(r => r.name === 'Hells Scythe'))
// tréninky se nepočítají do turnajové mety ani profilu
assert.ok(!(await one(null, 'meta_ranking', ['build', 1])).some(r => r.name === 'Hells Scythe 4-60T' && r.tournaments === 0))
step('historie dvojice, comba (moje / celý trénink), meta komunity z tréninků')

// ── boti ───────────────────────────────────────────────────────────
await fails(pl[1], 'select training_bot_create($1)', [tid], /leader nebo zástupce/)
const bot = await one(pl[0], 'training_bot_create', [tid, null])
const bot2 = await one(pl[0], 'training_bot_create', [tid, 'bot'])
const botNicks = (await db.query('select nick, is_bot, user_id from registrations where id = any($1) order by nick', [[bot, bot2]])).rows
assert.deepEqual(botNicks.map(r => r.nick), ['BOT', 'bot 2']); assert.ok(botNicks.every(r => r.is_bot && !r.user_id))
const myReg1 = (await db.query('select id from registrations where tournament_id = $1 and user_id = $2', [tid, pl[1].id])).rows[0].id
await as(pl[1], 'update registrations set is_bot = true where id = $1', [myReg1])
assert.equal((await db.query('select is_bot from registrations where id = $1', [myReg1])).rows[0].is_bot, false, 'is_bot nastaví jen RPC')
assert.ok((await one(pl[1], 'my_training')).players.some(x => x.reg === bot && x.bot === true))
const bm = await one(pl[1], 'training_challenge', [tid, bot])
const bst = await one(pl[1], 'training_state', [bm])
assert.equal(bst.status, 'active', 'bot přijme hned')
assert.deepEqual(bst.settings.lineup.p2.map(x => x.name), bst.settings.lineup.p1.map(x => x.name), 'bot bez decku = zrcadlo')
await as(pl[1], 'select training_battle($1,$2,$3,$4,$5,$6,$7)', [bm, crypto.randomUUID(), 2, 3, 'xtreme', 0, 0])
assert.equal((await one(pl[1], 'training_state', [bm])).game.s2, 3)
const bc = await one(null, 'training_combos', [tid, 'all'])
assert.ok(bc.some(r => r.nick === 'BOT' && r.user_id === null && r.wins === 1))
const bm2 = await one(pl[1], 'training_challenge', [tid, bot2])
await as(pl[0], 'select training_bot_remove($1)', [bot])
assert.equal((await one(pl[1], 'training_state', [bm])).status, 'done')
assert.ok(!(await one(pl[1], 'my_training')).players.some(x => x.reg === bot), 'odebraný bot zmizí')
assert.ok((await one(null, 'training_history', [tid, 'all'])).matches.some(m => m.p2 === 'BOT'), 'historie zůstane')
step('bot: založí leader/zástupce, přijme výzvu hned, zrcadlová sestava, odebrání nechá historii')

// ── konec ─────────────────────────────────────────────────────────
await as(pl[0], 'select training_end($1)', [mid])
assert.equal((await one(pl[0], 'training_state', [mid])).status, 'done')
assert.ok(await one(pl[2], 'my_training'))
await as(pl[0], `select finish_tournament($1, '[]')`, [tid])           // zástupce ukončí trénink
assert.equal(await one(pl[2], 'my_training'), null)
assert.equal((await one(pl[1], 'training_state', [bm2])).status, 'canceled', 'archiv uzavře rozehrané výzvy')
await fails(pl[1], 'select training_setup($1,$2)', [bm2, JSON.stringify({ win: 3 })], /archiv|aktivní/)
await fails(pl[0], 'select training_bot_create($1)', [tid], /skončil/)
await as(pl[1], `insert into registrations (tournament_id, nick) values ($1,'x')`, [tid2])  // teď už může na jiný
step('dvojici ukončí hráč, trénink leader/zástupce; pak jde hráč na další trénink')

// ── po skončení: historie celého tréninku, comba podle majitele, historie v komunitě ──
const hAll = await one(null, 'training_history', [tid, 'all'])
assert.equal(hAll.scope, 'all'); assert.ok(hAll.totals.battles > 0 && hAll.matches[0].p1 && hAll.matches[0].p2)
assert.equal(hAll.totals.battles, hAll.matches.reduce((n, m) => n + m.battles.length, 0))
const ownC = await one(null, 'training_combos', [tid, 'all'])
assert.ok(ownC.every(r => r.nick), 'combo má majitele (bot bez účtu)')
const keys = ownC.map(r => r.bey + '|' + r.user_id + '|' + r.nick)
assert.equal(new Set(keys).size, keys.length, 'stejný bey u dvou hráčů = dva řádky')
const det = await one(pl[0], 'community_detail', [cid])
const past = det.trainings.find(t => t.id === tid)
assert.equal(past.status, 'finished'); assert.ok(past.finished_at && past.battles > 0)
step('skončený trénink: historie celého tréninku, comba podle majitele, historie tréninků v komunitě')

// ── standings komunitního tréninku (31) ──
const stg = await one(pl[1], 'community_standings', [cid])
assert.equal(stg.community.id, cid); assert.ok(Number(stg.trainings) >= 1)
assert.ok(stg.players.length >= 2 && stg.players.every(p => p.user_id), 'jen hráči s účtem, bez botů')
const truth = (await db.query(`select r.user_id, count(*)::int n from public.bbx_training_battles(null, $1) x
  join registrations r on r.id = x.reg_id where not r.is_bot and r.user_id is not null group by r.user_id`, [cid])).rows
for (const t of truth) assert.equal(stg.players.find(p => p.user_id === t.user_id).battles, t.n)
for (const p of stg.players) assert.equal(p.battles, p.wins + p.draws + p.losses)
assert.ok(stg.players.every((p, i, a) => !i || a[i - 1].wins >= p.wins), 'řazení podle výher')
assert.equal((await one(pl[1], 'community_standings', [cid, new Date(Date.now() + 864e5).toISOString()])).players.length, 0, 'filtr období')
await fails(outsider, 'select community_standings($1)', [cid], /členové/)
await fails(null, 'select community_standings($1)', [cid])
assert.ok((await one(boss, 'community_standings', [cid])).players.length, 'admin vidí')
step('standings z tréninků: jen členové, jen účty, počty sedí, filtr období')

// ── komunitní stats ladder (36) ──
const csl = await one(pl[1], 'community_stats_ladder', [cid])
const xt = (await db.query(`select r.user_id, count(*)::int n from public.bbx_training_battles(null, $1) x join registrations r on r.id = x.reg_id
  where not r.is_bot and r.user_id is not null and x.result = 1 and x.finish = 'xtreme' group by r.user_id`, [cid])).rows
for (const t of xt) assert.equal(csl.counters.xtreme.find(x => x.user === t.user_id).value, t.n)
const dr = (await db.query(`select count(*)::int n from public.bbx_training_battles(null, $1) x join registrations r on r.id = x.reg_id
  where not r.is_bot and r.user_id is not null and x.result = 0`, [cid])).rows[0].n
assert.equal((csl.counters.draws || []).reduce((a, x) => a + x.value, 0), dr)
assert.ok(csl.seasons.includes(new Date().getFullYear()))
assert.deepEqual((await one(pl[1], 'community_stats_ladder', [cid, 1999])).counters, {})
await fails(outsider, 'select community_stats_ladder($1)', [cid], /členové/)
step('komunitní stats ladder: endy a remízy z tréninků, sezóna, jen členové')

// ── zamítnutí ─────────────────────────────────────────────────────
const cid2 = await one(org, 'community_create', ['Druhá ' + sfx])
await as(boss, 'select community_review($1, false, $2)', [cid2, 'Duplicitní'])
const mine = (await one(org, 'community_list')).find(c => c.id === cid2)
assert.equal(mine.status, 'rejected'); assert.equal(mine.review_note, 'Duplicitní')
await as(org, 'select community_delete($1)', [cid2])
await fails(org, 'select community_delete($1)', [cid], /hlavní admin/)
step('zamítnutá žádost s důvodem, zakladatel ji smaže; schválenou maže jen hlavní admin')

console.log(`\n${ok} kroků prošlo`)
await db.end()
