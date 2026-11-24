// ════════════════════════════════════════════════════════════════
//  Vzhled aplikace: neon (výchozí cyberpunk), synth, toxic, ronin, mono (bez neonů).
//  Barvy jsou v css/bbxu.css jako proměnné (html[data-theme=…]); tady jen seznam, náhled a přepnutí.
//  Volba je v localStorage tohoto zařízení; index.html ji nastaví ještě před vykreslením.
// ════════════════════════════════════════════════════════════════
const KEY = 'bbxu_theme'
// [klíč, název, popis, náhled [pozadí, barva 1, barva 2, zvýraznění], barva lišty prohlížeče]
export const THEMES = [
  ['neon', 'Neon', 'Původní cyberpunk – azurová, purpurová a žlutá.', ['#03050b', '#00e5ff', '#ff2bd6', '#ffe41f'], '#0a1030'],
  ['synth', 'Synthwave', 'Fialová noc a oranžový západ slunce.', ['#0d0518', '#ff7a3d', '#c34bff', '#ffd23f'], '#130822'],
  ['toxic', 'Toxic', 'Kyselá zelená a tyrkysová jako z laborky.', ['#020a05', '#39ff88', '#00d1c1', '#d4ff2a'], '#05110a'],
  ['ronin', 'Ronin', 'Rudá, žhavě oranžová a zlatá.', ['#0b0304', '#ff3b4e', '#ff8a3d', '#ffc94a'], '#120507'],
  ['mono', 'Bez neonů', 'Černobílý a šedý, nic nesvítí. Pro ty, kdo nemají rádi barvy.', ['#000', '#e8e8e8', '#8a8a8a', '#fff'], '#000000'],
]
const byKey = (k) => THEMES.find(t => t[0] === k)
export const getTheme = () => { try { return byKey(localStorage.getItem(KEY))?.[0] || 'neon' } catch { return 'neon' } }
export function applyTheme(t = getTheme()) {
  const th = byKey(t) || THEMES[0], root = document.documentElement
  if (th[0] === 'neon') delete root.dataset.theme; else root.dataset.theme = th[0]
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', th[4])
}
export function setTheme(t) {
  try { if (t && t !== 'neon' && byKey(t)) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY) } catch {}
  applyTheme(t)
}
