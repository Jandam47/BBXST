// Lokální napodobenina Supabase pro test v prohlížeči:
//  • statické soubory BBXU
//  • /rest/v1  → PostgREST (localhost:3300)
//  • /auth/v1  → jednoduché přihlášení (e-mail bez hesla, anonymní host), JWT HS256
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SECRET = 'bbxu-local-test-secret-0123456789abcdef'
const PORT = 8080
const db = new pg.Client({ host: '/tmp/pg', port: 5499, user: 'postgres', database: 'bbx' })
await db.connect()

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const jwt = (claims) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims)
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const decode = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url')) } catch { return null } }
export const ANON_KEY = jwt({ role: 'anon', iss: 'test', exp: 4102444800 })

const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, is_anonymous: !!u.is_anonymous,
  user_metadata: u.raw_user_meta_data || {}, app_metadata: { provider: u.is_anonymous ? 'anonymous' : 'email' }, created_at: new Date().toISOString() })
const session = (u) => {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24
  return { access_token: jwt({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, is_anonymous: !!u.is_anonymous, exp }),
           token_type: 'bearer', expires_in: 86400, expires_at: exp, refresh_token: 'r-' + u.id, user: userJson(u) }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const body = (req) => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => r(s)) })
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)) }

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end() }

  if (url.pathname.startsWith('/rest/v1/')) {
    const data = ['GET', 'HEAD'].includes(req.method) ? undefined : await body(req)
    const headers = { ...req.headers }; delete headers.host
    const r = http.request({ host: 'localhost', port: 3300, path: req.url.replace('/rest/v1', ''), method: req.method, headers }, pr => {
      res.writeHead(pr.statusCode, { ...pr.headers, 'access-control-allow-origin': '*' }); pr.pipe(res)
    })
    r.on('error', e => send(res, 502, { message: e.message }))
    return r.end(data)
  }

  // /storage/v1 → jednoduché úložiště v /tmp/bbx-storage (bazar): upload, veřejné čtení, mazání
  if (url.pathname.startsWith('/storage/v1/')) {
    const STORE = '/tmp/bbx-storage'
    const rest = decodeURIComponent(url.pathname.slice('/storage/v1/'.length))
    if (rest.includes('..')) return send(res, 400, { message: 'bad path' })
    if (req.method === 'GET' && rest.startsWith('object/public/')) {
      const f = path.join(STORE, rest.slice('object/public/'.length))
      if (!fs.existsSync(f)) return send(res, 404, { message: 'not found' })
      res.writeHead(200, { 'content-type': 'image/jpeg', 'access-control-allow-origin': '*' }); return res.end(fs.readFileSync(f))
    }
    if (req.method === 'POST' && rest.startsWith('object/')) {
      const chunks = []; for await (const c of req) chunks.push(c)
      let buf = Buffer.concat(chunks)
      const ct = req.headers['content-type'] || ''
      if (ct.startsWith('multipart/form-data')) {          // supabase-js posílá Blob jako FormData
        const boundary = '--' + ct.split('boundary=')[1]
        const parts = buf.toString('latin1').split(boundary).filter(x => x.includes('\r\n\r\n'))
        const file = parts.find(x => /filename=|name=""/.test(x)) || parts[parts.length - 1]
        const body = file.slice(file.indexOf('\r\n\r\n') + 4, file.lastIndexOf('\r\n'))
        buf = Buffer.from(body, 'latin1')
      }
      const key = rest.slice('object/'.length)
      fs.mkdirSync(path.dirname(path.join(STORE, key)), { recursive: true })
      fs.writeFileSync(path.join(STORE, key), buf)
      return send(res, 200, { Key: key, Id: key })
    }
    if (req.method === 'DELETE' && rest.startsWith('object/')) {
      const bucket = rest.slice('object/'.length).replace(/\/$/, '')
      const b = JSON.parse((await body(req)) || '{}')
      for (const pfx of b.prefixes || []) { try { fs.unlinkSync(path.join(STORE, bucket, pfx)) } catch {} }
      return send(res, 200, (b.prefixes || []).map(name => ({ name })))
    }
    return send(res, 404, { message: 'not found' })
  }

  if (url.pathname.startsWith('/auth/v1/')) {
    const ep = url.pathname.slice(9)
    const b = req.method === 'POST' || req.method === 'PUT' ? JSON.parse((await body(req)) || '{}') : {}
    const auth = decode((req.headers.authorization || '').replace('Bearer ', ''))
    try {
      if (ep === 'signup' && !b.email) {           // anonymní host
        const u = (await db.query('insert into auth.users (is_anonymous) values (true) returning *')).rows[0]
        return send(res, 200, session(u))
      }
      if (ep === 'token' && url.searchParams.get('grant_type') === 'password') {
        const u = (await db.query('select * from auth.users where lower(email) = lower($1)', [b.email])).rows[0]
        if (!u) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' })
        return send(res, 200, session(u))
      }
      if (ep === 'token' && url.searchParams.get('grant_type') === 'refresh_token') {
        const u = (await db.query('select * from auth.users where id = $1', [String(b.refresh_token).slice(2)])).rows[0]
        return send(res, 200, session(u))
      }
      if (ep === 'user' && auth?.sub) {
        const u = (await db.query('select * from auth.users where id = $1', [auth.sub])).rows[0]
        return send(res, 200, userJson(u))
      }
      if (ep === 'logout') { res.writeHead(204, { 'access-control-allow-origin': '*' }); return res.end() }
    } catch (e) { return send(res, 500, { msg: e.message }) }
    return send(res, 404, { msg: 'not implemented in test server: ' + ep })
  }

  if (url.pathname.startsWith('/realtime/')) { res.writeHead(404); return res.end() }

  // testovací config
  if (url.pathname === '/js/config.js') {
    res.writeHead(200, { 'content-type': MIME['.js'] })
    const real = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8')
    return res.end(real.replace(/supabaseUrl: '[^']*'/, `supabaseUrl: 'http://localhost:${PORT}'`).replace(/supabaseAnonKey: '[^']*'/, `supabaseAnonKey: '${ANON_KEY}'`))
  }
  let f = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404') }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(f).pipe(res)
}).listen(PORT, () => console.log('UI test server on', PORT))
