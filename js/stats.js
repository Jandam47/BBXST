// ════════════════════════════════════════════════════════════════
//  Stats (36): seznam statů, názvy a vysvětlení (podle Adamovy tabulky Stats.xlsx)
//  kind 'count' = počítadlo (hodnota na hráče), 'record' = rekordní hry (Blitzkrieg / T.Y.T.)
//  community = počítá se i v komunitním ladderu (tréninky)
// ════════════════════════════════════════════════════════════════
export const STATS = [
  { key: 'breakdancer', name: 'Breakdancer', desc: 'Spin finish dané soupeřům', kind: 'count', icon: 'S', community: true },
  { key: 'game_over', name: 'Game over', desc: 'Over finish dané soupeřům', kind: 'count', icon: 'O', community: true },
  { key: 'glueless', name: 'Glueless', desc: 'Burst finish dané soupeřům', kind: 'count', icon: 'B', community: true },
  { key: 'xtreme', name: 'Xtreme hunter', desc: 'Xtreme finish dané soupeřům', kind: 'count', icon: 'X', community: true },
  { key: 'tableflip', name: 'Tableflip', desc: 'Vyhraná hra, ve které hráč prohrával o 5 a víc bodů', kind: 'count', icon: '↻', community: true },
  { key: 'no_time', name: 'No time to lose', desc: 'Vyhraná hra 7:0 – soupeř bez jediného bodu', kind: 'count', icon: '7:0', community: true },
  { key: 'blitz', name: 'Blitzkrieg', desc: 'Nejrychleji odehrané hry (z BBXST)', kind: 'record', icon: '⚡' },
  { key: 'streak', name: 'Série', desc: 'Nejdelší řada vyhraných zápasů za sebou', kind: 'count', icon: '≫' },
  { key: 'draws', name: 'King of draws', desc: 'Nejvíc remíz v soubojích', kind: 'count', icon: '=', community: true },
  { key: 'iron_law', name: 'Iron law', desc: 'Nejvíc odjudgovaných zápasů', kind: 'count', icon: '⚖' },
  { key: 'rickety', name: 'Rickety', desc: 'Kolikrát se hráčův vlastní beyblade rozpadl (dostal Burst)', kind: 'count', icon: '✕', community: true },
  { key: 'tyt', name: 'T.Y.T.', desc: 'Nejdelší hry turnajů', kind: 'record', icon: '⌛' },
  { key: 'no_rod', name: 'No rod???', desc: 'Turnaje odehrané bez Wizard Rod v decku', kind: 'count', icon: '?' },
]
export const statByKey = (k) => STATS.find(s => s.key === k)

export const fmtSecs = (s) => {
  s = Math.max(0, Math.round(Number(s) || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}
export const medal = (rank) => rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
export const thisSeason = () => new Date().getFullYear()
