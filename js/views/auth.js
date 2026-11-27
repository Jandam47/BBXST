// ════════════════════════════════════════════════════════════════
//  Přihlášení, registrace účtu, převod hosta na účet, nový profil
// ════════════════════════════════════════════════════════════════
import { sb, state, errMsg, refreshMe, isLoggedIn, q, authProviders } from '../supa.js'
import { html, raw, mount, on, formData, toast, modal, busy, confirmBox, AVATARS } from '../ui.js'
import { REGIONS } from '../core.js'

const cfg = window.BBX_CONFIG
const redirectTo = () => location.origin + location.pathname.replace(/index\.html$/, '')  // stejná adresa jako v povolených v Supabase
const DISCORD_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><path d="M19.6 5.3A17 17 0 0 0 15.4 4l-.5 1a15.7 15.7 0 0 0-4.8 0l-.5-1a17 17 0 0 0-4.2 1.3C2.7 9.3 2 13.2 2.3 17a17 17 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.7-.8l.4-.3a12.2 12.2 0 0 0 10.4 0l.4.3-1.7.8 1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.3-2.3-11.7zM9.3 14.7c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9.9 1.9 2.1-.8 2.1-1.9 2.1zm5.4 0c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9.9 1.9 2.1-.8 2.1-1.9 2.1z"/></svg>'

const regionOptions = (sel) => html`<option value="">Vyber kraj…</option>${REGIONS.map(r => html`<option ${r === sel ? 'selected' : ''}>${r}</option>`)}`

export async function render(main, [mode]) {
  if (isLoggedIn()) { location.hash = '#/me'; return }
  mode = mode === 'signup' ? 'signup' : mode === 'forgot' ? 'forgot' : 'login'
  const discord = !!cfg.discordEnabled || !!(await authProviders()).discord
  const guestNote = state.isAnon
    ? html`<div class="notice" style="margin-bottom:16px">Teď jsi tu jako host. Když si založíš účet, tvoje dosavadní registrace a výsledky zůstanou u tebe.</div>`
    : ''

  mount(main, html`
    <div class="auth">
      <div class="auth-hero">
        <img class="logo-hero" src="icons/bbxunity.webp" alt="BBX Unity" width="600" height="503">
        <p>Turnaje, registrace a výsledky Beyblade X na jednom místě.</p>
      </div>
      ${guestNote}
      <div class="seg" role="tablist">
        <button class="${mode === 'login' ? 'on' : ''}" data-mode="login">Přihlásit</button>
        <button class="${mode === 'signup' ? 'on' : ''}" data-mode="signup">Založit účet</button>
      </div>
      <div class="card" style="margin-top:12px">
        ${mode === 'login' ? html`
          <form class="stack" id="f-login">
            <label class="f"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="email" required></label>
            <label class="f"><span>Heslo</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
            <button class="btn primary block">Přihlásit</button>
            <a class="small muted" href="#/login/forgot">Zapomněl jsem heslo</a>
          </form>` : ''}
        ${mode === 'signup' ? html`
          <form class="stack" id="f-signup">
            <label class="f"><span>Nick</span><input class="input" name="nick" minlength="2" maxlength="24" required autocomplete="nickname">
              <div class="hint">Pod tímhle jménem budeš ve všech turnajích.</div></label>
            <label class="f"><span>Kraj</span><select class="input" name="region" required>${regionOptions()}</select></label>
            <label class="f"><span>E-mail</span><input class="input" name="email" type="email" autocomplete="email" required></label>
            ${state.isAnon ? html`<div class="hint">Po potvrzení e-mailu si nastavíš heslo.</div>` : html`
            <label class="f"><span>Heslo</span><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required>
              <div class="hint">Aspoň 8 znaků. Heslo se ukládá jen jako šifrovaný otisk – nevidí ho nikdo, ani admin.</div></label>`}
            <button class="btn primary block">${state.isAnon ? 'Převést na účet' : 'Založit účet'}</button>
          </form>` : ''}
        ${mode === 'forgot' ? html`
          <form class="stack" id="f-forgot">
            <p class="muted">Pošleme ti odkaz pro nastavení nového hesla.</p>
            <label class="f"><span>E-mail</span><input class="input" name="email" type="email" required></label>
            <button class="btn primary block">Poslat odkaz</button>
          </form>` : ''}
        ${discord && mode !== 'forgot' ? html`
          <div class="or">nebo</div>
          <button class="btn discord block" data-act="discord">${raw(DISCORD_SVG)}${state.isAnon ? 'Převést na účet přes Discord' : 'Pokračovat přes Discord'}</button>
          ${state.isAnon ? html`<div class="hint" style="text-align:center">Tvoje registrace jako hosta zůstanou u tebe.</div>` : ''}` : ''}
      </div>
      <div class="or">nebo</div>
      <a class="btn ghost block" href="#/">Pokračovat bez účtu</a>
      <p class="hint" style="text-align:center">Bez účtu se do turnaje zaregistruješ jen nickem, ale tvoje výsledky se nebudou sčítat do profilu.</p>
    </div>`)

  on(main, 'click', '[data-mode]', (e, b) => { location.hash = '#/login/' + b.dataset.mode })
  on(main, 'click', '[data-act=discord]', async () => {
    // host: připojit Discord k anonymnímu účtu (registrace zůstanou); když to Supabase nedovolí, běžné přihlášení
    let taken = false
    try { taken = !!sessionStorage.getItem('bbxu_discord_taken') } catch {}
    if (state.isAnon && !taken) {
      const { error } = await sb.auth.linkIdentity({ provider: 'discord', options: { redirectTo: redirectTo() } })
      if (!error) return
      console.warn('linkIdentity', error)
      if (!await confirmBox('Převést hosta na účet přes Discord teď nejde. Přihlásit se přes Discord i tak? Registrace z režimu hosta pak zůstanou u hosta.', { ok: 'Přihlásit přes Discord' })) return
    }
    const { error } = await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: redirectTo() } })
    if (error) toast(errMsg(error), 'err')
  })

  on(main, 'submit', '#f-login', async (e, f) => {
    e.preventDefault()
    const d = formData(f)
    await busy(f.querySelector('button'), async () => {
      const { error } = await sb.auth.signInWithPassword({ email: d.email.trim(), password: d.password })
      if (error) return toast(errMsg(error), 'err')
      toast('Vítej zpátky!', 'ok')
      const back = sessionStorage.getItem('bbx_after_login'); sessionStorage.removeItem('bbx_after_login')
      location.hash = back || '#/'
    })
  })

  on(main, 'submit', '#f-signup', async (e, f) => {
    e.preventDefault()
    const d = formData(f)
    const nick = d.nick.trim()
    await busy(f.querySelector('button'), async () => {
      // je nick volný?
      const taken = await q(sb.from('profiles').select('id').ilike('nick', nick.replace(/[%_]/g, '\\$&')).limit(1))
      if (taken.length) return toast('Tenhle nick už někdo má.', 'err')
      const { data: nickOk } = await sb.rpc('nick_allowed', { p_nick: nick })   // zakázaná slova (45)
      if (nickOk === false) return toast('Nick obsahuje nevhodné slovo. Zvol jiný.', 'err')

      if (state.isAnon) {
        // host → plný účet (zachová historii)
        const { error } = await sb.auth.updateUser({ email: d.email.trim(), data: { nick, region: d.region, needs_password: true } },
                                                   { emailRedirectTo: redirectTo() })
        if (error) return toast(errMsg(error), 'err')
        mount(main, html`<div class="auth"><div class="card stack">
          <h2 style="margin:0">Mrkni do e-mailu</h2>
          <p>Poslali jsme potvrzovací odkaz na <b>${d.email}</b>. Po kliknutí si nastavíš heslo a tvoje dosavadní turnaje se přenesou do účtu.</p>
          <a class="btn block" href="#/">Zpět na turnaje</a></div></div>`)
        return
      }
      const { data, error } = await sb.auth.signUp({
        email: d.email.trim(), password: d.password,
        options: { data: { nick, region: d.region }, emailRedirectTo: redirectTo() },
      })
      if (error) return toast(errMsg(error), 'err')
      if (!data.session) {
        mount(main, html`<div class="auth"><div class="card stack">
          <h2 style="margin:0">Mrkni do e-mailu</h2>
          <p>Poslali jsme ti potvrzovací odkaz na <b>${d.email}</b>. Po kliknutí se automaticky přihlásíš.</p>
          <a class="btn block" href="#/">Zatím na turnaje</a></div></div>`)
      } else {
        toast('Účet je hotový!', 'ok'); location.hash = '#/me'
      }
    })
  })

  on(main, 'submit', '#f-forgot', async (e, f) => {
    e.preventDefault()
    await busy(f.querySelector('button'), async () => {
      const { error } = await sb.auth.resetPasswordForEmail(formData(f).email.trim(), { redirectTo: redirectTo() })
      if (error) return toast(errMsg(error), 'err')
      toast('Odkaz je na cestě – zkontroluj e-mail.', 'ok', 7000)
    })
  })
}

// po prvním přihlášení přes Discord, nebo když nick obsadil někdo jiný
export function onboardingModal() {
  const p = state.profile || {}
  const md = state.user?.user_metadata || {}
  const needsPw = !!md.needs_password
  modal(html`
    <h2>Dokonči svůj profil</h2>
    <form class="stack" id="f-onb">
      <label class="f"><span>Nick</span><input class="input" name="nick" minlength="2" maxlength="24" required value="${p.nick || md.nick || ''}"></label>
      <label class="f"><span>Kraj</span><select class="input" name="region" required>${regionOptions(p.region || md.region)}</select></label>
      ${needsPw ? html`<label class="f"><span>Heslo</span><input class="input" name="password" type="password" minlength="8" required autocomplete="new-password"></label>` : ''}
      <button class="btn primary block">Uložit</button>
    </form>`, {
    dismissable: false,
    onMount: (box, close) => on(box, 'submit', '#f-onb', async (e, f) => {
      e.preventDefault()
      const d = formData(f)
      await busy(f.querySelector('button'), async () => {
        try {
          if (needsPw) {
            const { error } = await sb.auth.updateUser({ password: d.password, data: { needs_password: false } })
            if (error) throw error
          }
          await q(sb.from('profiles').update({ nick: d.nick.trim(), region: d.region }).eq('id', state.user.id))
          await refreshMe(); close(); toast('Profil uložen.', 'ok')
        } catch (err) { toast(errMsg(err), 'err') }
      })
    }),
  })
}

export function newPasswordModal() {
  modal(html`
    <h2>Nové heslo</h2>
    <form class="stack" id="f-np">
      <label class="f"><span>Heslo</span><input class="input" name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <button class="btn primary block">Uložit heslo</button>
    </form>`, {
    onMount: (box, close) => on(box, 'submit', '#f-np', async (e, f) => {
      e.preventDefault()
      await busy(f.querySelector('button'), async () => {
        const { error } = await sb.auth.updateUser({ password: formData(f).password })
        if (error) return toast(errMsg(error), 'err')
        close(); toast('Heslo změněno.', 'ok')
      })
    }),
  })
}

export function avatarPicker(current) {
  return html`<div class="emoji-grid">${AVATARS.map(a => html`<button type="button" class="${a === current ? 'on' : ''}" data-av="${a}" aria-label="Avatar ${a}">${a}</button>`)}</div>`
}
