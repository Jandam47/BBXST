// ════════════════════════════════════════════════════════════════
//  Neonové ikony (cyberpunk). Dvoubarevné: .i1 = hlavní tah (azurová),
//  .i2 = akcent (purpurová). Aktivní položka je celá žlutá (CSS).
//  Vrací důvěryhodné SVG – vkládat přes raw().
// ════════════════════════════════════════════════════════════════
const svg = (body) =>
  `<svg class="nicon" viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const ICONS = {
  // pohár s hvězdou
  trophy: svg(`<path class="i1" d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path class="i2" d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.4M17 6h2.5a2.5 2.5 0 0 1-2.6 3.4"/>
    <path class="i1" d="M12 13v3M8.5 20h7M9.5 20l.6-4h3.8l.6 4"/><path class="i2" d="m12 5.6.7 1.4 1.5.2-1.1 1 .3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1 1.5-.2z"/>`),
  // dva hráči
  users: svg(`<circle class="i1" cx="9" cy="8" r="3.2"/><path class="i1" d="M3.5 19.5c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/>
    <circle class="i2" cx="16.5" cy="9" r="2.6"/><path class="i2" d="M15.6 14.1c2.6-.3 5 1.6 5 5"/>`),
  // graf se sloupci a čarou
  meta: svg(`<path class="i1" d="M3.5 20.5h17M5.5 20.5v-4M9.5 20.5v-6M13.5 20.5v-3.5M17.5 20.5v-8"/>
    <path class="i2" d="m4.5 11 4.2-3.2 3.6 2.4 5.7-5.7M15.5 4.5h2.5V7"/>`),
  // bublina se třemi tečkami
  chat: svg(`<path class="i1" d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z"/>
    <path class="i2" d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" stroke-width="2.6"/>`),
  // vstupenka / můj status
  ticket: svg(`<path class="i1" d="M3.5 7.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v2.2a2.3 2.3 0 0 0 0 4.6v2.2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2.2a2.3 2.3 0 0 0 0-4.6z"/>
    <path class="i2" d="M14.5 7v1.5M14.5 11.2v1.6M14.5 15.5V17M7 10h4M7 13.5h3"/>`),
  // pero a papír – registrace
  pen: svg(`<path class="i1" d="M4 19.5h9M4.5 15.5l9.8-9.8a1.8 1.8 0 0 1 2.5 2.5l-9.8 9.8-3.3.8z"/>
    <path class="i2" d="m13 7 2.5 2.5M16 19.5h4"/>`),
  // klipboard – swiss / tabulka
  board: svg(`<rect class="i1" x="5" y="4.5" width="14" height="16.5" rx="1.5"/><path class="i2" d="M9 4.5V3.5h6v1M9 3.5h6v2.5H9z"/>
    <path class="i2" d="M8.2 10h.6M8.2 13.5h.6M8.2 17h.6" stroke-width="2.2"/><path class="i1" d="M11 10h5M11 13.5h5M11 17h3.5"/>`),
  // pavouk
  bracket: svg(`<path class="i1" d="M3.5 5h4.5v6H3.5M3.5 13h4.5v6H3.5M8 8h3.5v8H8"/><path class="i2" d="M11.5 12h3.5"/>
    <path class="i2" d="M15.5 9.5h5v5h-5z"/>`),
  // sloupcový graf – vyhodnocení
  bars: svg(`<path class="i1" d="M3.5 20.5h17"/><rect class="i1" x="5" y="13" width="3" height="7.5"/><rect class="i2" x="10.5" y="9" width="3" height="11.5"/>
    <rect class="i1" x="16" y="5" width="3" height="15.5"/>`),
  // váhy – judge
  scale: svg(`<path class="i1" d="M12 4v15.5M8.5 20h7M5 7.5h14M12 4.2a1 1 0 1 0 0-.4"/>
    <path class="i2" d="m6 7.5-2.8 6.2h5.6zM18 7.5l-2.8 6.2h5.6zM3.2 13.7a2.8 2 0 0 0 5.6 0M15.2 13.7a2.8 2 0 0 0 5.6 0"/>`),
  // ozubené kolo – řízení
  gear: svg(`<path class="i1" d="M10.3 3.5h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.7 1.6v1.8l1.7 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.7-1.6v-1.8L4.3 8.8 6 5.9l2.2.8 1.6-.9z"/>
    <circle class="i2" cx="12" cy="12" r="2.8"/>`),
  // hvězda – hodnocení
  star: svg(`<path class="i1" d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z"/>
    <path class="i2" d="M12 8.2v4.3M12 15v.2"/>`),
  // ramínko – fashion
  hanger: svg(`<path class="i1" d="M12 8.5 3.6 15.2a1.3 1.3 0 0 0 .8 2.3h15.2a1.3 1.3 0 0 0 .8-2.3L12 8.5z"/>
    <path class="i2" d="M10 6a2 2 0 1 1 2.6 1.9c-.4.1-.6.4-.6.8v.8"/>`),
  // televize
  // živé vysílání: bod se vlnami
  live: svg(`<circle class="i2" cx="12" cy="12" r="2.2"/><path class="i1" d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"/>`),
  // anketa: sloupce s fajfkou
  poll: svg(`<path class="i1" d="M4.5 20.5h15M7 20.5V12M12 20.5V7M17 20.5v-5"/><path class="i2" d="m14.5 6.5 1.8 1.8 3.4-3.6"/>`),
  // otazník v kruhu
  help: svg(`<circle class="i1" cx="12" cy="12" r="8.5"/><path class="i2" d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.6"/><path class="i2" d="M12 17.2h.01" stroke-width="2.4"/>`),
  // obálka s vykřičníkem
  mail: svg(`<rect class="i1" x="3.5" y="6" width="17" height="12.5" rx="1.5"/><path class="i1" d="m4 7 8 6.2L20 7"/><path class="i2" d="M18.5 2.5v3M18.5 7.6h.01"/>`),
  tv: svg(`<rect class="i1" x="3" y="6" width="18" height="12" rx="1.5"/><path class="i2" d="m8.5 2.8 3.5 3.2 3.5-3.2M8 21h8"/>`),
}

export const icon = (name) => ICONS[name] || ''
