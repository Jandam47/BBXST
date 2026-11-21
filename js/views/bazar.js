// ════════════════════════════════════════════════════════════════
//  Bazar – inzeráty s 1–3 fotkami (úložiště Supabase 'bazar', cesta <uid>/<náhodné>.jpg).
//  Komentáře jsou soukromé vlákno zájemce ↔ prodejce (vidí je jen prodejce a ten, kdo píše).
// ════════════════════════════════════════════════════════════════
import { sb, state, rpc, errMsg, isLoggedIn } from '../supa.js'
import { html, mount, on, toast, timeAgo, modal, busy, confirmBox, fmtDate } from '../ui.js'
import { chatTabs } from './chat.js'
import { reportModal } from '../report.js'

const BUCKET = 'bazar'
const MAX_PHOTOS = 3
const photoUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
const price = (p) => p == null ? 'Dohodou' : `${Number(p).toLocaleString('cs-CZ')} Kč`
const RULES = [
  'Prodávej jen věci kolem Beyblade – beye, díly, launchery, arény a příslušenství.',
  'Repliky a kopie označ jako repliky. Vydávat padělek za originál je podvod.',
  'Fotky musí být tvoje a ukazovat skutečný kus, který prodáváš.',
  'Obchod je jen mezi tebou a kupujícím, BBX Unity za něj neručí. Nejbezpečnější je předání osobně na akci.',
  'Mladší 15 let prodávají a kupují jen se souhlasem rodiče.',
  'Piš slušně. Nevhodné inzeráty a zprávy admin smaže, při opakování i s účtem. Cokoliv podezřelého nahlas.',
]
const RULES_KEY = 'bbxu_bazar_rules'
const rulesHtml = () => html`<details class="bz-rules"><summary>Pravidla bazaru</summary><ol>${RULES.map(r => html`<li>${r}</li>`)}</ol></details>`
const SEEN_KEY = 'bbxu_bazar_seen'
const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {} } catch { return {} } }
const markSeen = (ad, id) => { try { const s = seen(); s[ad] = Math.max(s[ad] || 0, id || 0); localStorage.setItem(SEEN_KEY, JSON.stringify(s)) } catch {} ; window.dispatchEvent(new Event('bbx:seen')) }

export async function render(main, [adId], ctx) {
  if (!isLoggedIn()) {
    return mount(main, html`${chatTabs('bazar')}<div class="empty"><h2>Bazar vidí jen přihlášení hráči</h2>
      <p class="muted">Prodávat a psát prodejcům můžou hráči s účtem.</p><a class="btn primary" href="#/login">Přihlásit se</a></div>`)
  }
  return adId ? adView(main, adId, ctx) : listView(main, ctx)
}

// ── seznam ──────────────────────────────────────────────────────
async function listView(main, ctx) {
  let list = await rpc('bazar_list')
  if (!ctx.isCurrent()) return
  let filter = 'all'
  const s = seen()
  const draw = () => {
    const rows = filter === 'mine' ? list.filter(a => a.mine) : list
    mount(main, html`
      ${chatTabs('bazar')}
      <div class="row between" style="margin-top:14px;gap:12px">
        <h1 style="margin:0">Bazar</h1>
        <button class="bz-add" data-add aria-label="Přidat inzerát" title="Přidat inzerát">+</button>
      </div>
      <div class="seg" role="tablist" style="margin-top:12px">
        <button type="button" data-f="all" class="${filter === 'all' ? 'on' : ''}">Všechny</button>
        <button type="button" data-f="mine" class="${filter === 'mine' ? 'on' : ''}">Moje (${list.filter(a => a.mine).length})</button></div>
      ${rulesHtml()}
      ${rows.length ? html`<div class="bz-grid">${rows.map(a => {
        const unread = a.last_comment && a.last_comment > (s[a.id] || 0)
        return html`<a class="bz-card ${a.status}" href="#/bazar/${a.id}">
          <div class="bz-ph"><img src="${photoUrl(a.photo)}" alt="" loading="lazy">
            ${a.status === 'sold' ? html`<span class="bz-sold">Prodáno</span>` : ''}
            ${unread ? html`<span class="bz-new" aria-label="Nový komentář">💬</span>` : ''}</div>
          <div class="bz-body">
            <div class="bz-title">${a.title}</div>
            <div class="bz-price num">${price(a.price)}</div>
            <div class="small faint ellipsis">${a.mine ? html`Tvůj inzerát${a.threads ? ` · ${a.threads} ${a.threads === 1 ? 'zájemce' : 'zájemci'}` : ''}` : html`${a.avatar || '👤'} ${a.nick}`} · ${timeAgo(a.created_at)}</div>
          </div></a>` })}</div>`
      : html`<div class="empty" style="margin-top:18px">${filter === 'mine' ? 'Zatím nic neprodáváš.' : 'Bazar je prázdný.'} Inzerát přidáš zlatým <b>+</b>.</div>`}`)
  }
  draw()
  on(main, 'click', '[data-f]', (e, b) => { filter = b.dataset.f; draw() })
  on(main, 'click', '[data-add]', () => adForm(null, (id) => { location.hash = `#/bazar/${id}` }))
}

// ── detail inzerátu + soukromé komentáře ───────────────────────
async function adView(main, adId, ctx) {
  let d
  const load = async () => { d = await rpc('bazar_ad', { p_id: adId }) }
  try { await load() } catch (e) {
    if (!ctx.isCurrent()) return
    return mount(main, html`${chatTabs('bazar')}<div class="empty"><h2>${errMsg(e)}</h2><a class="btn" href="#/bazar">Zpět do bazaru</a></div>`)
  }
  if (!ctx.isCurrent()) return
  const me = state.user?.id

  const commentHtml = (c) => html`<div class="msg ${c.author_id === me ? 'own' : ''}">
    <a class="av" href="#/p/${c.author_id}">${c.avatar || '👤'}</a>
    <div class="bubble"><div class="who"><span>${c.nick}</span><time datetime="${c.created_at}">${timeAgo(c.created_at)}</time>
      ${c.author_id !== me ? html`<button class="del flag" data-report-c="${c.id}" aria-label="Nahlásit komentář" title="Nahlásit">⚑</button>` : ''}</div>
      <div class="body">${c.body}</div></div></div>`

  const draw = () => {
    const { ad, seller, mine } = d
    const threads = d.threads
    const myThread = !mine ? (threads[0]?.comments || []) : null
    mount(main, html`
      ${chatTabs('bazar')}
      <div class="row" style="margin:12px 0 8px;gap:8px"><a class="btn sm ghost" href="#/bazar" aria-label="Zpět do bazaru">←</a>
        <span class="small muted">Bazar</span></div>
      <article class="card bz-ad ${ad.status}">
        <div class="bz-gallery" role="list">${ad.photos.map((p, i) => html`<a role="listitem" href="${photoUrl(p)}" target="_blank" rel="noopener">
          <img src="${photoUrl(p)}" alt="Fotka ${i + 1} – ${ad.title}"></a>`)}</div>
        ${ad.photos.length > 1 ? html`<p class="small faint" style="margin:6px 0 0">${ad.photos.length} fotky – posuň do strany</p>` : ''}
        <div class="row between" style="gap:12px;margin-top:12px;align-items:flex-start">
          <h1 style="margin:0;font-size:24px">${ad.title}</h1>
          <div class="bz-price big num">${price(ad.price)}</div></div>
        ${ad.status === 'sold' ? html`<div class="notice small" style="margin-top:8px">Prodáno</div>` : ''}
        ${ad.description ? html`<p class="bz-desc">${ad.description}</p>` : ''}
        <p class="small muted" style="margin-top:10px">Prodává <a href="#/p/${seller.id}">${seller.avatar || '👤'} ${seller.nick}</a> · přidáno ${fmtDate(ad.created_at)}</p>
        ${mine || d.can_delete ? html`<div class="row wrap" style="gap:8px;margin-top:12px">
          ${mine ? html`<button class="btn sm" data-edit>Upravit</button>
            <button class="btn sm" data-status="${ad.status === 'active' ? 'sold' : 'active'}">${ad.status === 'active' ? 'Označit jako prodané' : 'Znovu prodávám'}</button>` : ''}
          <button class="btn sm danger" data-delete>Smazat</button></div>` : ''}
        ${!mine ? html`<button class="btn sm ghost bz-report" data-report-ad>⚑ Nahlásit inzerát</button>` : ''}
      </article>

      <h2 style="margin-top:20px">${mine ? 'Zprávy od zájemců' : 'Napsat prodejci'}</h2>
      <p class="small muted bz-private">🔒 ${mine ? 'Každý zájemce vidí jen svoje zprávy a tvoje odpovědi jemu.' : 'Komentář uvidí jen prodejce – ostatní ho nevidí.'}</p>
      ${mine ? (threads.length ? html`<div class="stack">${threads.map(t => html`<div class="card bz-thread">
          <div class="row" style="gap:8px;margin-bottom:8px"><b>${t.buyer.avatar || '👤'} ${t.buyer.nick}</b><span class="small faint">${timeAgo(t.last)}</span></div>
          <div class="bz-log">${t.comments.map(commentHtml)}</div>
          <form class="chat-form" data-reply="${t.buyer.id}"><textarea class="input" name="body" rows="1" maxlength="1000" required placeholder="Odpovědět ${t.buyer.nick}…" aria-label="Odpověď"></textarea>
            <button class="btn primary">Poslat</button></form></div>`)}</div>`
        : html`<div class="empty small">Zatím se nikdo neozval.</div>`)
      : html`${myThread.length ? html`<div class="card bz-thread"><div class="bz-log">${myThread.map(commentHtml)}</div></div>` : ''}
        ${ad.status === 'active' ? html`<form class="chat-form" data-reply="" style="margin-top:10px"><textarea class="input" name="body" rows="1" maxlength="1000" required placeholder="Zeptej se prodejce…" aria-label="Komentář pro prodejce"></textarea>
          <button class="btn primary">Poslat</button></form>` : html`<p class="small muted">Inzerát je prodaný – psát už nejde.</p>`}`}`)
    const lastId = Math.max(0, ...threads.flatMap(t => t.comments.map(c => c.id)))
    markSeen(adId, lastId)
  }
  draw()

  const ch = sb.channel('bazar-' + adId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bazar_comments', filter: `ad_id=eq.${adId}` }, async () => {
      try { await load(); draw() } catch {}
    })
    .subscribe()

  on(main, 'keydown', '.chat-form textarea', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit() }
  })
  on(main, 'submit', '[data-reply]', async (e, f) => {
    e.preventDefault()
    const body = f.body.value.trim()
    if (!body) return
    busy(f.querySelector('button'), async () => {
      try { await rpc('bazar_comment', { p_ad: adId, p_body: body, p_buyer: f.dataset.reply || null }); await load(); draw() }
      catch (err) { toast(errMsg(err), 'err') }
    })
  })
  on(main, 'click', '[data-edit]', () => adForm(d.ad, async () => { await load(); draw() }))
  on(main, 'click', '[data-report-ad]', () => reportModal('bazar_ad', adId))
  on(main, 'click', '[data-report-c]', (e, b) => reportModal('bazar_comment', b.dataset.reportC))
  on(main, 'click', '[data-status]', async (e, b) => {
    busy(b, async () => { try { await rpc('bazar_set_status', { p_id: adId, p_status: b.dataset.status }); await load(); draw() } catch (err) { toast(errMsg(err), 'err') } })
  })
  on(main, 'click', '[data-delete]', async () => {
    if (!await confirmBox('Smazat inzerát i s fotkami a komentáři?', { ok: 'Smazat', danger: true })) return
    try {
      const photos = await rpc('bazar_delete', { p_id: adId })
      if (photos?.length) await sb.storage.from(BUCKET).remove(photos).catch(() => {})
      toast('Inzerát je smazaný.', 'ok'); location.hash = '#/bazar'
    } catch (err) { toast(errMsg(err), 'err') }
  })
  return () => sb.removeChannel(ch)
}

// ── formulář: co prodávám, za kolik, fotky ─────────────────────
// fotka se zmenší na max 1280 px a uloží jako JPEG (do 1 MB)
async function shrink(file) {
  const img = await new Promise((res, rej) => {
    const url = URL.createObjectURL(file), i = new Image()
    i.onload = () => { URL.revokeObjectURL(url); res(i) }; i.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Tohle není obrázek.')) }
    i.src = url
  })
  for (const [max, q] of [[1280, 0.82], [1024, 0.75], [800, 0.7]]) {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q))
    if (blob && blob.size <= 1000000) return blob
  }
  throw new Error('Fotka je moc velká.')
}
const rid = () => (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '')

function adForm(ad, done) {
  // fotky: { path } = už nahraná, { blob, url } = nová (nahraje se při uložení)
  let photos = (ad?.photos || []).map(path => ({ path, url: photoUrl(path) }))
  const removed = []
  const { box, close } = modal(html`
    <h2>${ad ? 'Upravit inzerát' : 'Nový inzerát'}</h2>
    <form id="f-ad" class="stack" style="margin-top:10px">
      <label class="f"><span>Co prodávám</span><input class="input" name="title" maxlength="80" required value="${ad?.title || ''}" placeholder="Např. Dran Sword 3-60F, nový"></label>
      <label class="f"><span>Za kolik (Kč) – prázdné = dohodou</span><input class="input" name="price" type="number" min="0" max="1000000" inputmode="numeric" value="${ad?.price ?? ''}"></label>
      <label class="f"><span>Popis (nepovinné)</span><textarea class="input" name="description" maxlength="1000" placeholder="Stav, předání, výměna…">${ad?.description || ''}</textarea></label>
      <div class="f"><span>Fotky (1–${MAX_PHOTOS})</span><div class="bz-photos" id="ph"></div>
        <input type="file" id="ph-in" accept="image/*" multiple hidden></div>
      ${ad ? '' : html`${rulesHtml()}<label class="check"><input type="checkbox" name="rules" required ${localStorage.getItem(RULES_KEY) ? 'checked' : ''}> Souhlasím s pravidly bazaru</label>`}
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn ghost" data-close>Zrušit</button>
        <button class="btn primary">${ad ? 'Uložit' : 'Vystavit'}</button></div>
    </form>`)
  const ph = box.querySelector('#ph'), input = box.querySelector('#ph-in')
  const drawPhotos = () => mount(ph, html`${photos.map((p, i) => html`<div class="bz-thumb"><img src="${p.url}" alt="Fotka ${i + 1}">
      <button type="button" data-rm="${i}" aria-label="Odebrat fotku">✕</button></div>`)}
    ${photos.length < MAX_PHOTOS ? html`<button type="button" class="bz-thumb add" data-pick aria-label="Přidat fotku">＋<small>fotka</small></button>` : ''}`)
  drawPhotos()
  on(box, 'click', '[data-pick]', () => input.click())
  on(box, 'click', '[data-rm]', (e, b) => {
    const [p] = photos.splice(Number(b.dataset.rm), 1)
    if (p.path) removed.push(p.path); else URL.revokeObjectURL(p.url)
    drawPhotos()
  })
  input.addEventListener('change', async () => {
    const files = [...input.files].slice(0, MAX_PHOTOS - photos.length)
    input.value = ''
    for (const f of files) {
      try { const blob = await shrink(f); photos.push({ blob, url: URL.createObjectURL(blob) }) }
      catch (err) { toast(err.message, 'err') }
    }
    drawPhotos()
  })
  on(box, 'submit', '#f-ad', (e, f) => {
    e.preventDefault()
    if (!photos.length) return toast('Přidej aspoň jednu fotku.', 'err')
    if (!ad) { try { localStorage.setItem(RULES_KEY, '1') } catch {} }
    busy(f.querySelector('button.primary'), async () => {
      const uploaded = []
      try {
        const paths = []
        for (const p of photos) {
          if (p.path) { paths.push(p.path); continue }
          const path = `${state.user.id}/${rid()}.jpg`
          const { error } = await sb.storage.from(BUCKET).upload(path, p.blob, { contentType: 'image/jpeg', upsert: false })
          if (error) throw error
          uploaded.push(path); paths.push(path)
        }
        const priceVal = f.price.value === '' ? null : Number(f.price.value)
        const id = await rpc('bazar_save', { p_id: ad?.id || null, p_title: f.title.value, p_price: priceVal,
                                             p_description: f.description.value, p_photos: paths })
        if (removed.length) await sb.storage.from(BUCKET).remove(removed).catch(() => {})
        toast(ad ? 'Inzerát je upravený.' : 'Inzerát je vystavený.', 'ok')
        close(); done?.(id)
      } catch (err) {
        if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded).catch(() => {})
        toast(errMsg(err), 'err')
      }
    })
  })
}
