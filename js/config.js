// ════════════════════════════════════════════════════════════════
//  BBXU – nastavení připojení (sdílí ho BBXU i BBXST)
//  Hodnoty najdeš v Supabase → Project Settings → API.
//  „anon public“ klíč je veřejný – bezpečnost hlídají pravidla v databázi.
// ════════════════════════════════════════════════════════════════
window.BBX_CONFIG = {
  supabaseUrl: 'https://lilszyuzhtccizrqreyx.supabase.co/',
  supabaseAnonKey: 'sb_publishable_xkVDyRc2KR7C6WJ0m-Qlyg_OK6mgg21',
  appName: 'BBXU',
  appSub: 'Beyblade X Pardubice',
  // cesta k BBXST (stejná doména → judge je v BBXST přihlášený automaticky)
  bbxstUrl: './bbxst.html',
  // přihlášení přes Discord zapni až po nastavení v Supabase (viz README)
  discordEnabled: false,
}
