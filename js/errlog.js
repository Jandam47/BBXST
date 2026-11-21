// ════════════════════════════════════════════════════════════════
//  Hlášení chyb z telefonů → client_errors (21). Admini je vidí v profilu.
//  Stejný kód používá i BBXST (klasický <script>, globální window.bbxErrLog).
// ════════════════════════════════════════════════════════════════
const IGNORE = /ResizeObserver loop|^Script error\.?$|Failed to fetch|NetworkError|Load failed|network|AbortError|The user aborted|Kamera|NotAllowedError|NotFoundError: Requested device/i
const MAX = 10                       // nejvýš 10 hlášení za otevření stránky
const sent = new Set()
let count = 0, version = null

async function appVersion() {
  if (version) return version
  try { version = (await caches.keys()).find(k => k.startsWith('bbxu-')) || '' } catch { version = '' }
  return version
}

export function installErrorLog(sb, app = 'bbxu') {
  if (!sb || window.__bbxErrLog) return
  const report = async (message, stack) => {
    message = String(message || '').slice(0, 500)
    if (!message || IGNORE.test(message) || count >= MAX) return
    const key = message + '|' + String(stack || '').split('\n')[1]
    if (sent.has(key)) return
    sent.add(key); count++
    try {
      await sb.rpc('log_client_error', {
        p_app: app, p_message: message, p_stack: stack ? String(stack).slice(0, 4000) : null,
        p_url: (location.pathname.split('/').pop() || 'index.html') + location.hash.replace(/[0-9a-f-]{36}/gi, ':id').slice(0, 200),
        p_ua: navigator.userAgent.slice(0, 300), p_version: await appVersion(),
      })
    } catch {}
  }
  window.__bbxErrLog = report
  window.addEventListener('error', e => {
    if (e.target && e.target !== window) return          // nenačtený obrázek / skript – to není chyba kódu
    report(e.message || e.error?.message, e.error?.stack || `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`)
  })
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason
    report(r?.message || String(r), r?.stack)
  })
}

// zachycená chyba, kterou stejně chceme vidět (např. stránka se nenačetla)
export function logError(err, where = '') {
  window.__bbxErrLog?.((where ? where + ': ' : '') + (err?.message || String(err)), err?.stack)
}
