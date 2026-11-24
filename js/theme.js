// ════════════════════════════════════════════════════════════════
//  Vzhled: „neon“ (výchozí cyberpunk) nebo „mono“ = bez neonů, černobílý
//  Volba je v localStorage tohoto zařízení; index.html ji nastaví ještě před vykreslením.
// ════════════════════════════════════════════════════════════════
const KEY = 'bbxu_theme'
export const THEMES = [
  ['neon', 'Neon', 'Barevný cyberpunk – azurová, purpurová, žlutá.'],
  ['mono', 'Bez neonů', 'Černobílý a šedý, bez svícení. Pro ty, kdo nemají rádi barvy.'],
]
export const getTheme = () => { try { return localStorage.getItem(KEY) === 'mono' ? 'mono' : 'neon' } catch { return 'neon' } }
export function applyTheme(t = getTheme()) {
  const root = document.documentElement
  if (t === 'mono') root.dataset.theme = 'mono'; else delete root.dataset.theme
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'mono' ? '#000000' : '#0a1030')
}
export function setTheme(t) {
  try { if (t === 'mono') localStorage.setItem(KEY, 'mono'); else localStorage.removeItem(KEY) } catch {}
  applyTheme(t)
}
