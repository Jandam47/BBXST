// ════════════════════════════════════════════════════════════════
//  Připojení k Supabase + stav přihlášení
// ════════════════════════════════════════════════════════════════
import { roleLevel } from './core.js'

const cfg = window.BBX_CONFIG || {}
export const configured = !!cfg.supabaseUrl && !cfg.supabaseUrl.includes('SEM-VLOZ') && !!cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes('SEM-VLOZ')

export const sb = configured
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export const state = {
  session: null,
  user: null,
  profile: null,
  level: 0,
  isAnon: false,
  myRegs: [],           // [{id, tournament_id, nick, status}]
}

const listeners = new Set()
export const onState = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const emit = (evt) => listeners.forEach(fn => { try { fn(evt) } catch (e) { console.error(e) } })

// srozumitelné chyby
const MESSAGES = [
  [/Invalid login credentials/i, 'Špatný e-mail nebo heslo.'],
  [/Email not confirmed/i, 'Nejdřív potvrď e-mail – odkaz ti přišel do schránky.'],
  [/User already registered/i, 'Účet s tímhle e-mailem už existuje. Přihlas se.'],
  [/Password should be at least/i, 'Heslo musí mít aspoň 8 znaků.'],
  [/weak.?password|pwned|leaked/i, 'Tohle heslo je příliš slabé nebo uniklé. Zvol jiné.'],
  [/rate limit|too many requests|429/i, 'Moc pokusů najednou. Zkus to za chvíli znovu.'],
  [/Anonymous sign-ins are disabled/i, 'Registrace bez účtu není v Supabase zapnutá (viz README).'],
  [/profiles_nick_ci/i, 'Tenhle nick už někdo má.'],
  [/registrations_nick_ci/i, 'Tenhle nick je v turnaji už zaregistrovaný.'],
  [/registrations_tournament_id_user_id_key/i, 'V tomhle turnaji už registraci máš.'],
  [/profiles_nick_chk|reg_nick_chk/i, 'Nick musí mít 2–24 znaků a nesmí obsahovat < > " \' ` \\.'],
  [/Failed to fetch|NetworkError|Load failed/i, 'Nepodařilo se spojit se serverem. Zkontroluj připojení.'],
  [/JWT expired/i, 'Přihlášení vypršelo. Načti stránku znovu.'],
]
export function errMsg(e) {
  const m = e?.message || e?.error_description || String(e || 'Neznámá chyba')
  for (const [re, txt] of MESSAGES) if (re.test(m)) return txt
  return m
}

export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw error
  return data
}
export async function q(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

export async function loadProfile() {
  const u = state.user
  if (!u) { state.profile = null; state.level = 0; state.myRegs = []; return }
  const [prof, regs] = await Promise.all([
    q(sb.from('profiles').select('*').eq('id', u.id).maybeSingle()),
    rpc('my_registrations').catch(() => []),
  ])
  state.profile = prof
  state.myRegs = regs || []
  state.level = state.isAnon ? 0 : roleLevel(prof?.role)
}

function applySession(session) {
  state.session = session
  state.user = session?.user || null
  state.isAnon = !!session?.user?.is_anonymous
}

export async function initAuth() {
  if (!sb) return
  const { data } = await sb.auth.getSession()
  applySession(data.session)
  await loadProfile().catch(console.error)
  sb.auth.onAuthStateChange(async (event, session) => {
    const changed = (session?.user?.id || null) !== (state.user?.id || null) ||
                    !!session?.user?.is_anonymous !== state.isAnon
    applySession(session)
    if (changed || event === 'USER_UPDATED' || event === 'SIGNED_IN') await loadProfile().catch(console.error)
    emit(event)
  })
}

export async function refreshMe() { await loadProfile(); emit('PROFILE') }

// host = anonymní účet, vytvoří se až při první registraci do turnaje
export async function ensureSession() {
  if (state.user) return state.user
  const { data, error } = await sb.auth.signInAnonymously()
  if (error) throw error
  applySession(data.session)
  await loadProfile()
  return state.user
}

export const isLoggedIn = () => !!state.user && !state.isAnon
export const myRegFor = (tid) => state.myRegs.find(r => r.tournament_id === tid)
export const canManage = (t) => !!t && !state.isAnon && (state.level >= 3 || (state.level >= 2 && t.created_by === state.user?.id))

// ── notifikace prohlížeče ─────────────────────────────
export async function askNotify() {
  if (!('Notification' in window) || Notification.permission !== 'default') return
  try { await Notification.requestPermission() } catch {}
}
export async function systemNotify(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [120, 60, 120] })
    else new Notification(title, { body, tag })
  } catch {}
}
