// Doplní testovací data pro proklikání UI (spouštět po db.test.mjs)
import pg from 'pg'
import { pairSwissRound, makeRng } from '../js/core.js'
const db = new pg.Client({ host: '/tmp/pg', port: 5499, user: 'postgres', database: 'bbx' })
await db.connect()
const Q = async (s, p) => (await db.query(s, p)).rows
const rng = makeRng(7)

await Q(`update auth.users u set email = lower(p.nick) || '@test.cz' from profiles p where p.id = u.id and p.nick is not null`)
const org = (await Q(`select id from profiles where nick = 'Org'`))[0].id
const players = await Q(`select id, nick from profiles where nick like 'Hrac%' order by nick`)

const bx = (blade, ratchet, bit) => ({ type: 'bx', blade, ratchet, bit })
const beys = [[bx('Dran Sword', '3-60', 'Flat'), bx('Hells Scythe', '4-60', 'Taper'), bx('Wizard Arrow', '4-80', 'Ball')],
              [bx('Shark Edge', '3-60', 'Low Flat'), bx('Leon Claw', '5-60', 'Point'), bx('Knight Shield', '3-80', 'Needle')],
              [bx('Phoenix Wing', '9-60', 'Gear Flat'), { type: 'cx', lock: 'Dran', main: 'Brave', assist: 'Slash', ratchet: '6-60', bit: 'Vortex' }, bx('Tyranno Beat', '4-70', 'Quake')]]
async function tournament(name, extra) {
  const t = (await Q(`insert into tournaments (name, created_by, location, starts_at, description, swiss_rounds, top_cut, arena_count)
                       values ($1, $2, 'Klub Deskovka, Pardubice', now() + $3::interval, $4, 4, 4, 3) returning *`,
                     [name, org, extra.when, extra.desc || null]))[0]
  const regs = []
  for (const [i, p] of players.slice(0, extra.n).entries()) {
    const b = beys[i % 3]
    regs.push((await Q(`insert into registrations (tournament_id, user_id, nick, deck) values ($1,$2,$3,$4) returning id`,
                       [t.id, p.id, p.nick, JSON.stringify(b)]))[0].id)
  }
  return { t, regs }
}

await tournament('Zimní Pardubice Open', { when: '10 days', n: 5, desc: 'Startovné 100 Kč. Formát 3on3, swiss 4 kola + top 4.\nPřezůvky s sebou.' })
await Q(`insert into tournaments (kind, name, created_by, location, starts_at) values ('event', 'Páteční trénink', $1, 'DDM Pardubice', now() + interval '3 days')`, [org])

// běžící turnaj: 2. kolo, část zápasů dohraná
const { t, regs } = await tournament('Listopadový Cup', { when: '-2 hours', n: 9 })
await Q(`update tournaments set status = 'swiss', started_at = now() where id = $1`, [t.id])
const ps = regs.map(id => ({ id, status: 'active' }))
let matches = []
for (const round of [1, 2]) {
  const { pairs, bye } = pairSwissRound({ players: ps, matches, round, rng })
  const payload = [...pairs.map(([p1, p2]) => ({ p1, p2 })), ...(bye ? [{ p1: bye, p2: null }] : [])]
  await Q(`select create_swiss_round($1, $2, $3)`, [t.id, round, JSON.stringify(payload)])
  const open = await Q(`select * from matches where tournament_id = $1 and round = $2 and status <> 'done' order by pos`, [t.id, round])
  for (const [i, m] of open.entries()) {
    if (round === 2 && i >= 1) { if (i === 1) await Q(`update matches set status = 'live' where id = $1`, [m.id]); continue }
    const w = rng() < .5, lo = Math.floor(rng() * 7)
    await Q(`select submit_game($1,$2,$3)`, [m.id, w ? 7 : lo, w ? lo : 7])
  }
  matches = await Q(`select * from matches where tournament_id = $1`, [t.id])
}
await Q(`insert into arena_judges (tournament_id, arena, judge_id) select $1, 1, id from profiles where nick = 'Judge'`, [t.id])
await Q(`insert into chat_messages (room_id, user_id, nick, avatar, body) select 'volny', id, nick, avatar, 'Kdo jede v sobotu na Open?' from profiles where nick = 'Hrac2'`)
console.log('seed ok', t.id)
await db.end()
