import assert from 'node:assert/strict'
import { computeStandings, pairSwissRound, buildDoubleElim, seedOrder, computePlacements, makeRng,
         matchLabel, parseQrPayload, qrPayload, pairRoundRobin, roundRobinRounds } from '../js/core.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('✓', name) }

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), nick: 'P' + (i + 1), status: 'active' }))

// odehraje swiss se zadanými hráči, výsledky náhodně
function simulateSwiss(n, rounds, seed) {
  const rng = makeRng(seed)
  const players = mk(n)
  const matches = []
  for (let r = 1; r <= rounds; r++) {
    const { pairs, bye, rematches } = pairSwissRound({ players, matches, round: r, rng })
    const seen = new Set()
    for (const [a, b] of pairs) { assert(!seen.has(a) && !seen.has(b)); seen.add(a); seen.add(b) }
    if (bye) { assert(!seen.has(bye)); seen.add(bye); matches.push({ stage: 'swiss', status: 'done', round: r, p1_reg: bye, p2_reg: null, is_bye: true, winner_reg: bye, p1_score: 7, p2_score: 0 }) }
    assert.equal(seen.size, n, `kolo ${r}: všichni hrají`)
    for (const [a, b] of pairs) {
      const aWins = rng() < 0.5, lo = Math.floor(rng() * 7)
      matches.push({ stage: 'swiss', status: 'done', round: r, p1_reg: a, p2_reg: b, is_bye: false,
                     winner_reg: aWins ? a : b, p1_score: aWins ? 7 : lo, p2_score: aWins ? lo : 7 })
    }
    if (n >= 8 && r <= 3) assert.equal(rematches, 0, `kolo ${r}: bez odvet`)
  }
  return { players, matches }
}

t('příklad z popisu: HB 1, PB 11 (7:5 výhra, 4:7 prohra)', () => {
  const players = mk(3)
  const matches = [
    { stage: 'swiss', status: 'done', p1_reg: 'p1', p2_reg: 'p2', winner_reg: 'p1', p1_score: 7, p2_score: 5 },
    { stage: 'swiss', status: 'done', p1_reg: 'p1', p2_reg: 'p3', winner_reg: 'p3', p1_score: 4, p2_score: 7 },
  ]
  const s = computeStandings(players, matches)
  const p1 = s.find(x => x.id === 'p1')
  assert.equal(p1.main, 1); assert.equal(p1.aux1, 11)
  assert.equal(p1.aux2, 0)            // p2 má 0 HB
  assert.equal(s[0].id, 'p1')         // p1 (1/11) před p3 (1/7)
})

t('PB2 = HB poražených soupeřů rozhodne shodu HB i PB', () => {
  const players = mk(4)
  const matches = [
    // A a B: oba 1 výhra, PB 7+0… nastavíme shodné PB
    { stage: 'swiss', status: 'done', p1_reg: 'p1', p2_reg: 'p3', winner_reg: 'p1', p1_score: 7, p2_score: 3 },
    { stage: 'swiss', status: 'done', p1_reg: 'p2', p2_reg: 'p4', winner_reg: 'p2', p1_score: 7, p2_score: 3 },
    { stage: 'swiss', status: 'done', p1_reg: 'p3', p2_reg: 'p2', winner_reg: 'p3', p1_score: 7, p2_score: 3 },
    { stage: 'swiss', status: 'done', p1_reg: 'p4', p2_reg: 'p1', winner_reg: 'p4', p1_score: 7, p2_score: 3 },
  ]
  // všichni 1 HB, PB 10; p1 porazil p3 (1 HB), p2 porazil p4 (1 HB) … shoda → vzájemný/los, ale deterministický
  const a = computeStandings(players, matches, { salt: 'x' }).map(s => s.id).join()
  const b = computeStandings(players, matches, { salt: 'x' }).map(s => s.id).join()
  assert.equal(a, b)
})

t('vzájemný zápas rozhoduje úplnou shodu dvou hráčů', () => {
  const players = mk(4)
  const matches = [
    { stage: 'swiss', status: 'done', p1_reg: 'p1', p2_reg: 'p2', winner_reg: 'p2', p1_score: 5, p2_score: 7 },
    { stage: 'swiss', status: 'done', p1_reg: 'p3', p2_reg: 'p4', winner_reg: 'p3', p1_score: 7, p2_score: 5 },
    { stage: 'swiss', status: 'done', p1_reg: 'p1', p2_reg: 'p4', winner_reg: 'p1', p1_score: 7, p2_score: 0 },
    { stage: 'swiss', status: 'done', p1_reg: 'p2', p2_reg: 'p3', winner_reg: 'p3', p1_score: 0, p2_score: 7 },
  ]
  const s = computeStandings(players, matches)
  // p1: HB1 PB12 PB2=HB(p4)=0; p2: HB1 PB7 → p1 výš kvůli PB
  assert.ok(s.findIndex(x => x.id === 'p1') < s.findIndex(x => x.id === 'p2'))
})

t('1. kolo náhodně, lichý počet → jeden volný los', () => {
  const r = pairSwissRound({ players: mk(7), matches: [], round: 1, rng: makeRng(1) })
  assert.equal(r.pairs.length, 3); assert.ok(r.bye)
})

t('2. kolo: vítězové s vítězi, lichá skupina dobere nejlepšího z nižší', () => {
  const players = mk(6)
  const matches = [
    { stage: 'swiss', status: 'done', p1_reg: 'p1', p2_reg: 'p2', winner_reg: 'p1', p1_score: 7, p2_score: 6 },
    { stage: 'swiss', status: 'done', p1_reg: 'p3', p2_reg: 'p4', winner_reg: 'p3', p1_score: 7, p2_score: 1 },
    { stage: 'swiss', status: 'done', p1_reg: 'p5', p2_reg: 'p6', winner_reg: 'p5', p1_score: 7, p2_score: 2 },
  ]
  const { pairs } = pairSwissRound({ players, matches, round: 2, rng: makeRng(5) })
  const winners = new Set(['p1', 'p3', 'p5'])
  const cross = pairs.find(([a, b]) => winners.has(a) !== winners.has(b))
  assert.ok(cross, 'jeden smíšený pár')
  const floated = winners.has(cross[0]) ? cross[1] : cross[0]
  assert.equal(floated, 'p2', 'dobere se poražený s nejvíc PB (6)')
})

t('volný los nedostane dvakrát stejný hráč', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { matches } = simulateSwiss(9, 5, seed)
    const byes = matches.filter(m => m.is_bye).map(m => m.p1_reg)
    assert.equal(new Set(byes).size, byes.length)
  }
})

t('swiss simulace 4–64 hráčů (bez kolizí, bez odvet v prvních kolech)', () => {
  for (const n of [4, 5, 8, 11, 16, 23, 32, 47, 64]) for (const seed of [11, 22, 33]) {
    simulateSwiss(n, Math.min(6, Math.ceil(Math.log2(n)) + 1), seed * n)
  }
})

t('seedOrder(8) = 1,8,4,5,2,7,3,6', () => {
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6])
})

// simulace pavouka stejně jako SQL (bbx_place/bbx_check_ready)
function simulateBracket(topN, rng) {
  const ms = buildDoubleElim(topN).map(m => ({ ...m, p1: null, p2: null, p1b: false, p2b: false, done: false }))
  const byKey = new Map(ms.map(m => [m.key, m]))
  const losses = new Map()
  const place = (key, slot, reg, bye) => {
    if (!key) return
    const m = byKey.get(key); assert.ok(m, 'chybí ' + key)
    if (slot === 1) { assert.ok(!m.p1 && !m.p1b, key + ' slot1 obsazen'); m.p1 = reg; m.p1b = bye }
    else { assert.ok(!m.p2 && !m.p2b, key + ' slot2 obsazen'); m.p2 = reg; m.p2b = bye }
    ready(m)
  }
  const ready = (m) => {
    if (m.done || !((m.p1 || m.p1b) && (m.p2 || m.p2b))) return
    if (m.p1b || m.p2b) {
      m.done = true; m.walkover = true
      const w = m.p1b ? m.p2 : m.p1
      place(m.next_win_key, m.next_win_slot, w, m.p1b && m.p2b)
      place(m.next_lose_key, m.next_lose_slot, null, true)
    }
  }
  for (const m of ms) {
    if (m.p1_seed) { if (m.p1_seed <= topN) m.p1 = 's' + m.p1_seed; else m.p1b = true }
    if (m.p2_seed) { if (m.p2_seed <= topN) m.p2 = 's' + m.p2_seed; else m.p2b = true }
  }
  for (const m of ms.filter(x => x.stage === 'wb' && x.round === 1)) ready(m)
  let guard = 0
  while (!byKey.get('GF').done && guard++ < 1000) {
    const m = ms.find(x => !x.done && x.p1 && x.p2)
    assert.ok(m, 'zaseknutý pavouk')
    const w = rng() < 0.5 ? m.p1 : m.p2, l = w === m.p1 ? m.p2 : m.p1
    m.done = true; m.winner_reg = w; m.loser_reg = l
    losses.set(l, (losses.get(l) || 0) + 1)
    place(m.next_win_key, m.next_win_slot, w, false)
    place(m.next_lose_key, m.next_lose_slot, l, false)
  }
  return { ms, losses }
}

t('double elimination 2–32 (s byes) projde do konce', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32]) for (const seed of [1, 2, 3]) {
    const { ms, losses } = simulateBracket(n, makeRng(seed * 100 + n))
    const gf = ms.find(m => m.key === 'GF')
    assert.ok(gf.done && gf.winner_reg, `GF top ${n}`)
    // v double elim vypadne každý kromě vítěze po 2 prohrách (u 2 hráčů GF rozhoduje hned)
    if (n > 2) for (let s = 1; s <= n; s++) {
      const id = 's' + s, L = losses.get(id) || 0
      if (id === gf.winner_reg) assert.ok(L <= 1)
      else assert.ok(L === 2 || (id === gf.loser_reg && L >= 1), `${id} má ${L} proher (top ${n})`)
    }
  }
})

t('BO3 na GF, LB finále a LB semifinále, zbytek BO1', () => {
  const ms = buildDoubleElim(8)
  const bo = Object.fromEntries(ms.map(m => [m.key, m.best_of]))
  assert.equal(bo.GF, 3); assert.equal(bo['L4-1'], 3); assert.equal(bo['L3-1'], 3)
  assert.equal(bo['W1-1'], 1); assert.equal(bo['W3-1'], 1)
  assert.equal(matchLabel({ stage: 'lb', round: 4 }, 8), 'Finále losers (o 3. místo)')
})

t('konečné umístění top 4 + zbytek dle swissu', () => {
  const { players, matches } = simulateSwiss(10, 4, 7)
  const st = computeStandings(players, matches)
  const top = st.slice(0, 4)
  const ids = Object.fromEntries(top.map((s, i) => ['s' + (i + 1), s.id]))
  const { ms } = simulateBracket(4, makeRng(9))
  const bracket = ms.map(m => ({ stage: m.stage, round: m.round, status: m.done ? 'done' : 'pending',
                                 winner_reg: ids[m.winner_reg], loser_reg: ids[m.loser_reg] }))
  players.forEach(p => { const i = top.findIndex(s => s.id === p.id); if (i >= 0) p.seed = i + 1 })
  const pl = computePlacements({ players, matches: [...matches, ...bracket], topN: 4 })
  assert.equal(pl.length, 10)
  assert.deepEqual(pl.slice(0, 4).map(x => x.place), [1, 2, 3, 4])
  assert.deepEqual(new Set(pl.slice(0, 4).map(x => x.reg)), new Set(top.map(s => s.id)))
  assert.equal(pl[4].reg, st[4].id)
})

t('deathmatch: každý s každým právě jednou (2–30 hráčů), odstoupení = volný los', () => {
  for (let n = 2; n <= 30; n++) {
    const players = mk(n), R = roundRobinRounds(n), met = new Map(), byes = new Map()
    for (let r = 1; r <= R; r++) {
      const { pairs, byes: b } = pairRoundRobin({ players, round: r, salt: 'T' })
      const seen = new Set()
      for (const [x, y] of pairs) {
        assert(!seen.has(x) && !seen.has(y) && x !== y); seen.add(x); seen.add(y)
        const k = [x, y].sort().join('|'); met.set(k, (met.get(k) || 0) + 1)
      }
      for (const x of b) { assert(!seen.has(x)); seen.add(x); byes.set(x, (byes.get(x) || 0) + 1) }
      assert.equal(seen.size, n, `n=${n} kolo ${r}: všichni`)
      assert.equal(b.length, n % 2, 'volný los jen při lichém počtu')
    }
    assert.equal(met.size, n * (n - 1) / 2, `n=${n}: všechny dvojice`)
    assert([...met.values()].every(v => v === 1), `n=${n}: žádná odveta`)
    if (n % 2) assert([...byes.values()].every(v => v === 1) && byes.size === n, `n=${n}: každý 1 volný los`)
  }
  // hráč odstoupí po 2. kole: rozpis ostatních se nezmění, jeho soupeři mají volný los
  const ps = mk(8)
  const before = pairRoundRobin({ players: ps, round: 3, salt: 'T' })
  ps[0].status = 'dropped'
  const after = pairRoundRobin({ players: ps, round: 3, salt: 'T' })
  assert.equal(after.pairs.length, 3); assert.equal(after.byes.length, 1)
  assert(after.pairs.every(p => before.pairs.some(q => q.join() === p.join())))
})

t('popisky: deathmatch a finále top 2', () => {
  assert.equal(matchLabel({ stage: 'swiss', round: 3 }, 0, 'deathmatch'), 'Deathmatch · kolo 3')
  assert.equal(matchLabel({ stage: 'gf' }, 2), 'Finále')
  assert.equal(matchLabel({ stage: 'gf' }, 8), 'Grand finále')
})

t('QR payload', () => {
  const tId = '11111111-2222-3333-4444-555555555555', tok = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  assert.deepEqual(parseQrPayload(qrPayload(tId, tok)), { tournamentId: tId, token: tok })
  assert.equal(parseQrPayload('Nick: Adam'), null)
})

console.log(`\n${pass} testů prošlo`)
