// ════════════════════════════════════════════════════════════════
//  BBXU – nastavení připojení (sdílí ho BBXU i BBXST)
//  Hodnoty najdeš v Supabase → Project Settings → API.
//  „anon public“ klíč je veřejný – bezpečnost hlídají pravidla v databázi.
// ════════════════════════════════════════════════════════════════
window.BBX_CONFIG = {
  supabaseUrl: 'https://SEM-VLOZ-PROJEKT.supabase.co',
  supabaseAnonKey: 'SEM-VLOZ-ANON-KEY',
  appName: 'BBXU',
  appSub: 'Beyblade X Pardubice',
  // cesta k BBXST (stejná doména → judge je v BBXST přihlášený automaticky)
  bbxstUrl: './bbxst.html',
  // přihlášení přes Discord zapni až po nastavení v Supabase (viz README)
  discordEnabled: false,
}
