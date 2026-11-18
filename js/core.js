// ════════════════════════════════════════════════════════════════════
//  BBXU core – čistá turnajová logika (bez DOM, testovatelná v Node)
//  • pořadí swissu: HB → PB → PB2 → vzájemné zápasy → deterministický los
//  • párování swissu (1. kolo náhodně, pak vítězové s vítězi, bez odvet)
//  • double elimination pavouk s byes
//  • konečné umístění
// ════════════════════════════════════════════════════════════════════

// FNV-1a hash → stabilní „los“, aby se pořadí při každém načtení neměnilo
export function hashNum(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

export function makeRng(seed = Date.now()) {
  let s = (typeof seed === 'string' ? hashNum(seed) : seed) >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ────────────────────────────────────────────────────────────────────
//  POŘADÍ SWISSU
//  HB  (main) = výhry (volný los = výhra)
//  PB  (aux1) = součet vlastních bodů ze swiss her (vítěz 7, poražený své body, bye 7)
//  PB2 (aux2) = součet HB soupeřů, které jsem porazil
// ────────────────────────────────────────────────────────────────────
export function computeStandings(players, matches, { winScore = 7, salt = '' } = {}) {
  const map = new Map()
  for (const p of players) {
    map.set(p.id, { ...p, main: 0, aux1: 0, aux2: 0, wins: 0, losses: 0, byes: 0, played: 0,
                    opponents: [], beaten: [], lostTo: [] })
  }
  const swiss = matches.filter(m => m.stage === 'swiss' && m.status === 'done')
  for (const m of swiss) {
    const a = map.get(m.p1_reg), b = m.p2_reg ? map.get(m.p2_reg) : null
    if (m.is_bye || !m.p2_reg) {
      if (a) { a.main += 1; a.aux1 += winScore; a.byes += 1; a.wins += 1 }
      continue
    }
    if (!a || !b) continue
    a.played++; b.played++
    a.opponents.push(b.id); b.opponents.push(a.id)
    a.aux1 += m.p1_score; b.aux1 += m.p2_score
    const w = m.winner_reg === a.id ? a : b, l = w === a ? b : a
    w.main += 1; w.wins += 1; l.losses += 1
    w.beaten.push(l.id); l.lostTo.push(w.id)
  }
  for (const s of map.values()) s.aux2 = s.beaten.reduce((sum, id) => sum + (map.get(id)?.main || 0), 0)

  const list = [...map.values()]
  list.sort((x, y) => (y.main - x.main) || (y.aux1 - x.aux1) || (y.aux2 - x.aux2))

  // shodné bloky → minitabulka vzájemných zápasů, pak stabilní los
  const out = []
  for (let i = 0; i < list.length;) {
    let j = i + 1
    while (j < list.length && list[j].main === list[i].main && list[j].aux1 === list[i].aux1 && list[j].aux2 === list[i].aux2) j++
    const block = list.slice(i, j)
    if (block.length > 1) {
      const ids = new Set(block.map(b => b.id))
      for (const b of block) b.h2h = b.beaten.filter(id => ids.has(id)).length
      block.sort((x, y) => (y.h2h - x.h2h) || (hashNum(salt + x.id) - hashNum(salt + y.id)))
    }
    out.push(...block)
    i = j
  }
  // pořadí s dělením míst pro úplnou shodu nedává smysl – každý má své číslo
  out.forEach((s, i) => { s.rank = i + 1 })
  return out
}

// ────────────────────────────────────────────────────────────────────
//  PÁROVÁNÍ SWISSU
//  vrací { pairs: [[idA, idB], …] seřazené od nejsilnějších stolů, bye: id|null, rematches: n }
// ────────────────────────────────────────────────────────────────────
export function pairSwissRound({ players, matches, round, rng = Math.random, winScore = 7, salt = '' }) {
  const active = players.filter(p => p.status !== 'dropped')
  if (active.length < 2) throw new Error('Na párování jsou potřeba aspoň 2 hráči.')

  if (round === 1) {
    const order = shuffle(active.map(p => p.id), rng)
    const bye = order.length % 2 ? order.pop() : null
    const pairs = []
    for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]])
    return { pairs, bye, rematches: 0 }
  }

  const standings = computeStandings(active, matches, { winScore, salt })
  const played = new Set()
  for (const s of standings) for (const o of s.opponents) played.add(s.id + '|' + o)
  const hadBye = new Set(standings.filter(s => s.byes > 0).map(s => s.id))

  let pool = standings.slice()
  let bye = null
  if (pool.length % 2) {
    // volný los: nejhůř umístěný, který ho ještě neměl
    for (let i = pool.length - 1; i >= 0; i--) if (!hadBye.has(pool[i].id)) { bye = pool[i].id; break }
    if (!bye) bye = pool[pool.length - 1].id
    pool = pool.filter(p => p.id !== bye)
  }

  const rematch = (a, b) => played.has(a.id + '|' + b.id)

  // kandidáti pro hráče `a`: nejdřív stejná skupina HB (náhodně),
  // pak nejbližší nižší/vyšší skupina – v ní nejlepší PB/PB2 (shoda → náhodně)
  const candidatesFor = (a, rest) => {
    const groups = new Map()
    for (const c of rest) {
      const d = Math.abs(c.main - a.main) * 2 + (c.main > a.main ? 1 : 0)
      if (!groups.has(d)) groups.set(d, [])
      groups.get(d).push(c)
    }
    const out = []
    for (const d of [...groups.keys()].sort((x, y) => x - y)) {
      const g = groups.get(d)
      if (d === 0) { out.push(...shuffle(g, rng)); continue }
      const tiers = new Map()
      for (const c of g) { const k = c.aux1 * 10000 + c.aux2; if (!tiers.has(k)) tiers.set(k, []); tiers.get(k).push(c) }
      for (const k of [...tiers.keys()].sort((x, y) => y - x)) out.push(...shuffle(tiers.get(k), rng))
    }
    return out
  }

  let steps = 0
  const LIMIT = 200000
  const solve = (list, allowRematch) => {
    if (!list.length) return []
    if (++steps > LIMIT) return null
    const [a, ...rest] = list
    for (const c of candidatesFor(a, rest)) {
      if (!allowRematch && rematch(a, c)) continue
      const sub = solve(rest.filter(x => x !== c), allowRematch)
      if (sub) return [[a.id, c.id], ...sub]
    }
    return null
  }

  let pairs = solve(pool, false)
  if (!pairs) { steps = 0; pairs = solve(pool, true) }
  if (!pairs) throw new Error('Párování se nepodařilo.')
  const rematches = pairs.filter(([x, y]) => played.has(x + '|' + y)).length
  return { pairs, bye, rematches }
}

// ────────────────────────────────────────────────────────────────────
//  TOP CUT – double elimination
// ────────────────────────────────────────────────────────────────────
export const DEFAULT_BO = { gf: 3, lbf: 3, lbsf: 3, wbf: 1, default: 1 }

export function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p }

export function seedOrder(n) {
  let arr = [1, 2]
  while (arr.length < n) {
    const len = arr.length * 2, next = []
    for (const s of arr) next.push(s, len + 1 - s)
    arr = next
  }
  return arr.slice(0, n)
}

// vrací kostru pavouka pro RPC create_topcut
export function buildDoubleElim(topN, bo = DEFAULT_BO) {
  const B = { ...DEFAULT_BO, ...bo }
  const N = nextPow2(Math.max(2, topN))
  if (N === 2) {
    return [{ key: 'GF', stage: 'gf', round: 1, pos: 1, best_of: B.gf, p1_seed: 1, p2_seed: 2 }]
  }
  const k = Math.log2(N)
  const ms = []
  const order = seedOrder(N)

  for (let r = 1; r <= k; r++) {
    const m = N / 2 ** r
    for (let j = 1; j <= m; j++) {
      const x = { key: `W${r}-${j}`, stage: 'wb', round: r, pos: j, best_of: r === k ? B.wbf : B.default }
      if (r === 1) { x.p1_seed = order[2 * j - 2]; x.p2_seed = order[2 * j - 1] }
      if (r < k) { x.next_win_key = `W${r + 1}-${Math.ceil(j / 2)}`; x.next_win_slot = j % 2 ? 1 : 2 }
      else { x.next_win_key = 'GF'; x.next_win_slot = 1 }
      if (r === 1) { x.next_lose_key = `L1-${Math.ceil(j / 2)}`; x.next_lose_slot = j % 2 ? 1 : 2 }
      else { x.next_lose_key = `L${2 * r - 2}-${m - j + 1}`; x.next_lose_slot = 2 }
      ms.push(x)
    }
  }

  const lbRounds = 2 * k - 2
  const lbCount = (lr) => lr % 2 ? N / 2 ** ((lr + 1) / 2 + 1) : N / 2 ** (lr / 2 + 1)
  for (let lr = 1; lr <= lbRounds; lr++) {
    const m = lbCount(lr)
    for (let j = 1; j <= m; j++) {
      const x = { key: `L${lr}-${j}`, stage: 'lb', round: lr, pos: j,
                  best_of: lr === lbRounds ? B.lbf : lr === lbRounds - 1 ? B.lbsf : B.default }
      if (lr === lbRounds) { x.next_win_key = 'GF'; x.next_win_slot = 2 }
      else if (lr % 2) { x.next_win_key = `L${lr + 1}-${j}`; x.next_win_slot = 1 }
      else { x.next_win_key = `L${lr + 1}-${Math.ceil(j / 2)}`; x.next_win_slot = j % 2 ? 1 : 2 }
      ms.push(x)
    }
  }
  ms.push({ key: 'GF', stage: 'gf', round: 1, pos: 1, best_of: B.gf })
  return ms
}

// lidský popis zápasu
export function matchLabel(m, topN) {
  if (m.stage === 'swiss') return `Swiss · kolo ${m.round}`
  if (m.stage === 'gf') return 'Grand finále'
  const N = nextPow2(Math.max(2, topN || 2)); const k = Math.log2(N)
  if (m.stage === 'wb') {
    if (m.round === k) return 'Finále winners'
    if (m.round === k - 1) return 'Semifinále winners'
    return `Winners · kolo ${m.round}`
  }
  const lbR = 2 * k - 2
  if (m.round === lbR) return 'Finále losers (o 3. místo)'
  if (m.round === lbR - 1) return 'Semifinále losers (o 4. místo)'
  return `Losers · kolo ${m.round}`
}

// ────────────────────────────────────────────────────────────────────
//  KONEČNÉ UMÍSTĚNÍ
//  top cut: 1/2 z GF, 3 = poražený z LB finále, 4 = z LB semifinále,
//  dál poražení v LB kolech (sdílené místo), zbytek podle swissu
// ────────────────────────────────────────────────────────────────────
export function computePlacements({ players, matches, topN, winScore = 7, salt = '' }) {
  const standings = computeStandings(players, matches, { winScore, salt })
  const swissRank = new Map(standings.map(s => [s.id, s.rank]))
  const placed = new Map()
  const bracket = matches.filter(m => m.stage !== 'swiss')

  if (bracket.length) {
    const gf = bracket.find(m => m.stage === 'gf')
    if (gf && gf.status === 'done') {
      if (gf.winner_reg) placed.set(gf.winner_reg, 1)
      if (gf.loser_reg) placed.set(gf.loser_reg, 2)
    }
    const lbRounds = [...new Set(bracket.filter(m => m.stage === 'lb').map(m => m.round))].sort((a, b) => b - a)
    for (const r of lbRounds) {
      const losers = bracket.filter(m => m.stage === 'lb' && m.round === r && m.loser_reg && !placed.has(m.loser_reg))
                            .map(m => m.loser_reg)
                            .sort((a, b) => (swissRank.get(a) || 999) - (swissRank.get(b) || 999))
      const place = placed.size + 1
      for (const id of losers) placed.set(id, place)
    }
    // N=2 (jen GF) nebo nedohraný pavouk – zbytek top cutu podle seedu
    const seeded = players.filter(p => p.seed && !placed.has(p.id)).sort((a, b) => a.seed - b.seed)
    for (const p of seeded) placed.set(p.id, placed.size + 1)
  }

  let next = placed.size + 1
  for (const s of standings) if (!placed.has(s.id)) placed.set(s.id, next++)
  return [...placed.entries()].map(([reg, place]) => ({ reg, place })).sort((a, b) => a.place - b.place)
}

export const REGIONS = ['Hlavní město Praha', 'Středočeský', 'Jihočeský', 'Plzeňský', 'Karlovarský', 'Ústecký',
  'Liberecký', 'Královéhradecký', 'Pardubický', 'Vysočina', 'Jihomoravský', 'Olomoucký', 'Zlínský',
  'Moravskoslezský', 'Zahraničí']

export const ROLES = [
  { key: 'player', level: 0, label: 'Hráč' },
  { key: 'judge', level: 1, label: 'Judge' },
  { key: 'organizer', level: 2, label: 'Organizátor' },
  { key: 'admin', level: 3, label: 'Admin' },
  { key: 'superadmin', level: 4, label: 'Hlavní admin' },
]
export const roleLevel = (r) => (ROLES.find(x => x.key === r) || ROLES[0]).level

// QR: BBXU1|<tournament_id>|<qr_token>
export const qrPayload = (tournamentId, token) => `BBXU1|${tournamentId}|${token}`
export function parseQrPayload(text) {
  const m = /^BBXU1\|([0-9a-f-]{36})\|([0-9a-f-]{36})$/i.exec(String(text || '').trim())
  return m ? { tournamentId: m[1], token: m[2] } : null
}
