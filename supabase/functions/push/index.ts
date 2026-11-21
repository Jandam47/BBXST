// ════════════════════════════════════════════════════════════════
//  Edge Function `push` – rozešle jednu zprávu z push_outbox na zařízení (Web Push, VAPID).
//  Volá ji databáze přes pg_net (bbx_push v 20-push.sql) s hlavičkou x-bbx-secret.
//  Nastavení čte ze soukromé tabulky bbx_settings (service role): push_secret, vapid_public, vapid_private,
//  vapid_subject. Ze secrets jen automatické SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY.
//  Nasazení: verify_jwt = false (ověřuje se sdílené heslo z bbx_settings).
// ════════════════════════════════════════════════════════════════
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string) => Deno.env.get(k) ?? ''

const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
let cfg: Record<string, string> | null = null
async function settings(): Promise<Record<string, string>> {
  if (cfg) return cfg
  const { data } = await sb.from('bbx_settings').select('key,value').in('key', ['push_secret', 'vapid_public', 'vapid_private', 'vapid_subject'])
  const v: Record<string, string> = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  if (v.push_secret) cfg = v          // bez nastavení necachovat – může se doplnit později
  return v
}

Deno.serve(async (req) => {
  const c = await settings()
  if (req.method !== 'POST' || !c.push_secret || req.headers.get('x-bbx-secret') !== c.push_secret) {
    return new Response('forbidden', { status: 403 })
  }
  const { id } = await req.json().catch(() => ({}))
  if (!id) return new Response('missing id', { status: 400 })

  const { data: msg, error } = await sb.from('push_outbox').select('*').eq('id', id).single()
  if (error || !msg) return new Response('not found', { status: 404 })
  if (msg.sent_at) return new Response('already sent', { status: 200 })

  const { data: subs } = await sb.from('push_subscriptions').select('*').in('user_id', msg.user_ids)
  webpush.setVapidDetails(c.vapid_subject || 'https://bbxu.cz', c.vapid_public, c.vapid_private)
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag })

  let sent = 0, failed = 0
  const gone: string[] = []
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' })
      sent++
    } catch (e) {
      failed++
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) gone.push(s.endpoint)       // odběr už neplatí
      else console.error('push', code, (e as Error).message)
    }
  }))
  if (gone.length) await sb.from('push_subscriptions').delete().in('endpoint', gone)
  await sb.from('push_outbox').update({ sent_at: new Date().toISOString(), sent, failed }).eq('id', id)
  return new Response(JSON.stringify({ sent, failed, removed: gone.length }), { headers: { 'content-type': 'application/json' } })
})
