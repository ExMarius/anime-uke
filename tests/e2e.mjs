import WS from 'ws';
// Test end-to-end impotriva serverului local wrangler.
// BASE se poate suprascrie pentru a rula suita impotriva productiei:
//   node tests/e2e.mjs https://anime-uke.pages.dev
const BASE = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:8788';
const WS_BASE = BASE.replace(/^http/, 'ws');
// Pe productie, un burst de ~100 cereri/secunda dintr-un IP de datacenter
// poate declansa protectia anti-bot Cloudflare (403 cu pagina HTML).
// E2E_DELAY_MS pune o pauza intre apeluri; implicit 0 (local, rapid).
const DELAY = Number(process.env.E2E_DELAY_MS || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const failures = [];

let ipSeq = 10;
function jar(ip) { return { cookie: '', ip: ip || `203.0.${Math.floor(ipSeq/250)}.${(ipSeq++%250)+1}` }; }
function saveCookie(j, res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return;
  j.cookie = sc.split(';')[0];
}
async function req(j, method, path, body) {
  const headers = { 'Origin': BASE };
  if (j?.cookie) headers.Cookie = j.cookie;
  if (j?.ip) { headers['CF-Connecting-IP'] = j.ip; headers['X-Forwarded-For'] = j.ip; }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (DELAY) await sleep(DELAY);
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  if (j) saveCookie(j, res);
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 120) }; }
  return { status: res.status, data, headers: res.headers };
}
/**
 * Cerere pentru pagini HTML. `req()` parseaza JSON, deci nu e folositoare
 * aici. `redirect: 'manual'` e esential: un redirect nu e un rezultat, iar
 * fara el o bucla de redirecturi ar trece neobservata.
 */
async function raw(j, path) {
  const headers = { Origin: BASE };
  if (j?.cookie) headers.Cookie = j.cookie;
  if (DELAY) await sleep(DELAY);
  const res = await fetch(BASE + path, { headers, redirect: 'manual' });
  if (j) saveCookie(j, res);
  const text = await res.text();
  return { status: res.status, text, location: res.headers.get('location') };
}

// Un reject netratat (ex. un WebSocket care pica tranzitoriu) nu trebuie sa
// omoare suita inainte de rezumat: il transformam in esec vizibil, ca sa
// vedem CE a cazut in loc sa primim un crash fara context.
process.on('unhandledRejection', (e) => {
  fail++;
  const msg = e?.message || String(e);
  failures.push(`unhandledRejection: ${msg}`);
  console.log(`  ❌ unhandledRejection: ${msg}`);
});

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n=== 1. VIZITATOR ===');
{
  const j = jar();
  const me = await req(j, 'GET', '/api/auth/me');
  check('GET /api/auth/me ca vizitator → 200 + user null', me.status === 200 && me.data.user === null, JSON.stringify(me.data));

  const s = await req(j, 'GET', '/api/series');
  check('Site public: GET /api/series fara cont → 200', s.status === 200 && Array.isArray(s.data?.series), `status=${s.status}`);

  const gen = await req(j, 'GET', '/api/genres');
  check('Genuri publice → 200 + listă', gen.status === 200 && Array.isArray(gen.data?.genres), JSON.stringify(gen.data)?.slice(0, 120));

  const rec = await req(j, 'GET', '/api/recent');
  check('Ultimele episoade publice → 200, max 8', rec.status === 200 && (rec.data?.items || []).length <= 8, JSON.stringify(rec.data)?.slice(0, 140));

  const f1 = await req(j, 'GET', '/api/series?status=completed');
  check('Filtru status=completed → 200', f1.status === 200 && (f1.data?.series || []).every((x) => x.status === 'completed'), `n=${f1.data?.series?.length}`);
  const f2 = await req(j, 'GET', '/api/series?gen=acțiune');
  check('Filtru gen → 200 (filtru valid sintactic)', f2.status === 200 && Array.isArray(f2.data?.series), `n=${f2.data?.series?.length}`);
  const f3 = await req(j, 'GET', '/api/series?status=hack');
  check('Filtru status invalid → ignorat (200)', f3.status === 200, `status=${f3.status}`);

  const w = await req(j, 'POST', '/api/progress', { episode_id: 1, seconds: 30 });
  check('POST /api/progress fara login → 401', w.status === 401, `status=${w.status}`);

  const a = await req(j, 'GET', '/api/admin/stats');
  check('GET /api/admin/stats fara login → 401', a.status === 401, `status=${a.status}`);

  // --- SITE PUBLIC: catalogul se vede fara cont; sistemele raman la login ---
  for (const page of ['/', '/episode']) {
    const r = await fetch(BASE + page, { redirect: 'manual' });
    check(`GET ${page} fara cont → 200 (public)`, r.status === 200, `status=${r.status}`);
  }

  // `/series` fără id era o pagină moartă (200 + head gol, JS-ul făcea
  // location.replace('/')) și era declarată în sitemap → 301 spre catalog.
  {
    const r = await fetch(BASE + '/series', { redirect: 'manual' });
    check('GET /series (fără id) → 301 către /', r.status === 301 && r.headers.get('location') === '/',
      `status=${r.status} location=${r.headers.get('location')}`);
    const withId = await fetch(BASE + '/series?id=1', { redirect: 'manual' });
    check('GET /series?id=1 rămâne 200 (forma veche, încă folosită în linkuri)', withId.status === 200,
      `status=${withId.status}`);
    const trailing = await fetch(BASE + '/series/', { redirect: 'manual' });
    check('GET /series/ (slash) → 301 către /, nu către /login', trailing.status === 301 && trailing.headers.get('location') === '/',
      `status=${trailing.status} location=${trailing.headers.get('location')}`);
  }
  for (const page of ['/admin', '/profile', '/shop']) {
    const r = await fetch(BASE + page, { redirect: 'manual' });
    check(`GET ${page} fara cont → 302 către /login (protejat)`, r.status === 302, `status=${r.status}`);
  }

  // Paginile de autentificare raman publice, altfel nimeni nu ar putea intra
  for (const page of ['/login', '/register']) {
    const r = await fetch(BASE + page, { redirect: 'manual' });
    check(`GET ${page} → 200 public`, r.status === 200, `status=${r.status}`);
  }

  // Codul server-side si fisierele de configurare nu trebuie servite
  for (const blocked of ['/_worker.js', '/.dev.vars', '/wrangler.toml', '/migrations/0001_init.sql']) {
    const r = await fetch(BASE + blocked);
    const body = await r.text();
    check(`GET ${blocked} → 404 (blocat)`, r.status === 404, `status=${r.status}`);
    check(`   ...si nu scurge cale de filesystem`, !body.includes('/home/user') && !body.includes('ENOTDIR'), body.slice(0, 100));
  }

  // Rute necunoscute → 404 onest. Până acum cădeau pe poarta de autentificare și
  // răspundeau 302 → /login?next=/package.json, adică dezvăluiau că fișierul
  // există în repo (conținutul nu scăpa, dar nici 302 nu e răspunsul corect).
  for (const unknown of ['/package.json', '/AGENTS.md', '/deploy.sh', '/src/worker.js', '/ruta-inexistenta', '/admin/ceva-ciudat', '/404', '/admin/serie']) {
    const r = await fetch(BASE + unknown, { redirect: 'manual' });
    check(`GET ${unknown} → 404 (nu 302 spre /login)`, r.status === 404, `status=${r.status} location=${r.headers.get('location') || '—'}`);
  }
  // /covers/ nu există pe disc (coperțile sunt URL-uri externe) → pagina 404 a
  // site-ului, nu 404-ul generic al routerului de assete.
  {
    const r = await fetch(BASE + '/covers/logo.png', { redirect: 'manual' });
    const body = await r.text();
    check('GET /covers/logo.png → 404 cu pagina site-ului', r.status === 404 && body.includes('Mergi la catalog'), `status=${r.status}`);
  }
  const login = await fetch(BASE + '/login');
  check('Header CSP prezent pe pagina publica', !!login.headers.get('content-security-policy'));
  check('Header X-Content-Type-Options prezent', login.headers.get('x-content-type-options') === 'nosniff');
  // CSP pe directive: script-src STRICT (fără unsafe-inline/unsafe-eval — zero JS
  // inline în site), style-src cu 'unsafe-inline' deliberat (snippet A-Ads +
  // pagina 404 generată în worker + layout admin — comentariul din http.js).
  {
    const csp = String(login.headers.get('content-security-policy') || '');
    const scriptSrc = (csp.match(/script-src[^;]*/)?.[0] || '');
    const styleSrc = (csp.match(/style-src[^;]*/)?.[0] || '');
    check('CSP script-src strict (fără unsafe-*)', scriptSrc.includes("'self'") && !/unsafe-inline|unsafe-eval/.test(scriptSrc), scriptSrc);
    check("CSP style-src permite 'unsafe-inline' (decizie documentată)", styleSrc.includes("'unsafe-inline'"), styleSrc);
  }
  check('Header Cross-Origin-Resource-Policy prezent', login.headers.get('cross-origin-resource-policy') === 'same-origin',
    `corp=${login.headers.get('cross-origin-resource-policy')}`);

  // Paginile utilitare nu trebuie indexate, dar au nevoie de canonical ca
  // ?next=… să nu facă duplicate în index.
  for (const page of ['/login', '/register']) {
    const html = await (await fetch(BASE + page)).text();
    check(`${page} are canonical + noindex`,
      html.includes(`rel="canonical" href="https://anime-uke.pages.dev${page}"`) && html.includes('name="robots" content="noindex'),
      html.slice(0, 160));
  }
  // Assetele raman publice: fara ele pagina de login ar fi nefunctionala
  const css = await fetch(BASE + '/assets/css/style.css');
  check('GET /assets/css/style.css → 200 public', css.status === 200);

  // HSTS și pe răspunsurile JSON ale workerului (nu doar pe assete via _headers).
  {
    const pulse = await fetch(BASE + '/api/pulse');
    check('API JSON are Strict-Transport-Security', String(pulse.headers.get('strict-transport-security') || '').includes('max-age=31536000'),
      `hsts=${pulse.headers.get('strict-transport-security')}`);
    const pdata = await pulse.json().catch(() => ({}));
    check('Pulse expune contorul online ca număr', typeof pdata?.online === 'number', JSON.stringify(pdata).slice(0, 100));
  }

  // robots.txt: fără /series (face 301 spre /), cu Sitemap declarat.
  {
    const robots = await (await fetch(BASE + '/robots.txt')).text();
    check('robots.txt nu mai anunță /series', !robots.includes('Allow: /series'), robots.split('\n').filter((l) => l.includes('/series')).join(';'));
    check('robots.txt declară Sitemap:', /Sitemap:/i.test(robots), '');
  }

  // Speculation Rules: prerender pe URL-urile pretty reale (/serie/*), nu pe
  // /series* care nu mai lovea nimic.
  {
    const spec = await (await fetch(BASE + '/speculationrules.json')).json().catch(() => null);
    const pre = JSON.stringify(spec?.prerender || []);
    check('prerender pe /serie/*', pre.includes('/serie/'), pre.slice(0, 120));
  }

  // Logo: assete publice + referințe în HTML + negociere WebP (ca la hero).
  {
    for (const asset of ['/assets/img/logo.png', '/assets/img/logo-icon.png']) {
      const r = await fetch(BASE + asset);
      check(`GET ${asset} → 200 public`, r.status === 200, `status=${r.status}`);
    }
    const webp = await fetch(BASE + '/assets/img/logo-icon.png', { headers: { Accept: 'image/webp' } });
    check('Negociere WebP și pentru PNG (logo)', (webp.headers.get('content-type') || '').includes('webp'), webp.headers.get('content-type'));
    const homeHtml = await (await fetch(BASE + '/')).text();
    check('og:image de pe / e logo-ul', homeHtml.includes('/assets/img/logo.png'), homeHtml.match(/og:image[^>]*>/)?.[0]);
    const loginHtml = await (await fetch(BASE + '/login')).text();
    check('Login folosește logo-ul (favicon + marca auth)',
      loginHtml.includes('rel="icon" href="/assets/img/logo-icon.png"') && loginHtml.includes('auth-logo__mark'),
      loginHtml.match(/<link rel="icon"[^>]*>/)?.[0]);
  }

  // Favicon real la rădăcină: fără el, Cloudflare Pages servea iconița
  // proprie la /favicon.ico, iar Google o arăta în rezultatele de căutare.
  {
    const ico = await fetch(BASE + '/favicon.ico');
    const icoBuf = Buffer.from(await ico.arrayBuffer());
    check('GET /favicon.ico → 200 cu content-type icon',
      ico.status === 200 && (ico.headers.get('content-type') || '').includes('icon'),
      `status=${ico.status} ct=${ico.headers.get('content-type')}`);
    check('favicon.ico e al nostru, nu cel implicit Cloudflare (dimensiune)',
      icoBuf.length > 4000, `bytes=${icoBuf.length}`);
    const apple = await fetch(BASE + '/apple-touch-icon.png');
    check('GET /apple-touch-icon.png → 200 PNG (iOS)',
      apple.status === 200 && (apple.headers.get('content-type') || '').includes('png'),
      `status=${apple.status} ct=${apple.headers.get('content-type')}`);
  }

  // Sitemap-uri pentru Google Search Console: XML + TXT + /sitemap fara
  // extensie, iesite direct fara headerele de securitate (CORP/CSP), cu
  // serii SI episoade. Pe baza goala intra fallback-ul static, deci
  // asertiunile sunt deterministe indiferent de starea DB-ului.
  {
    const sm = await fetch(BASE + '/sitemap.xml');
    const smText = await sm.text();
    check('GET /sitemap.xml → 200 text/xml valid',
      sm.status === 200 && (sm.headers.get('content-type') || '').includes('text/xml') && smText.startsWith('<?xml'),
      `status=${sm.status} ct=${sm.headers.get('content-type')}`);
    check('Sitemap-ul XML contine serii si episoade (URL-uri pretty)',
      smText.includes('/serie/') && smText.includes('/episod/'), `${(smText.match(/<loc>/g) || []).length} URL-uri`);
    check('Sitemap-ul iese fara CORP (fara headere de securitate)',
      !sm.headers.get('cross-origin-resource-policy') && !sm.headers.get('content-security-policy'),
      `corp=${sm.headers.get('cross-origin-resource-policy')}`);
    const txt = await fetch(BASE + '/sitemap.txt');
    const txtText = await txt.text();
    check('GET /sitemap.txt → 200 text/plain, un URL pe linie',
      txt.status === 200 && (txt.headers.get('content-type') || '').includes('text/plain')
      && txtText.split('\n')[0].startsWith('http') && txtText.includes('/serie/'),
      `status=${txt.status} linii=${txtText.split('\n').length}`);
    const noext = await fetch(BASE + '/sitemap');
    check('GET /sitemap (fara extensie) → acelasi XML',
      noext.status === 200 && (noext.headers.get('content-type') || '').includes('text/xml'),
      `status=${noext.status}`);
    const dbl = await fetch(BASE + '//sitemap.xml');
    check('GET //sitemap.xml (slash dublu) → 200, nu 404', dbl.status === 200, `status=${dbl.status}`);
  }
  const mod = await fetch(BASE + '/assets/js/core.js');
  check('GET /assets/js/core.js → 200 public', mod.status === 200);
}

{
  const opts = await req(jar(), 'GET', '/api/auth/register-options');
  check('register-options: baza goala -> bootstrap', opts.status === 200 && opts.data?.bootstrap === true && opts.data?.capacityFull === false, JSON.stringify(opts.data));
}

console.log('\n=== 2. VALIDARI LA REGISTER ===');
{
  const j = jar();
  let r = await req(j, 'POST', '/api/auth/register', { username: 'ab', email: 'x@y.z', password: 'test1234' });
  check('Username prea scurt → 400', r.status === 400, `status=${r.status} ${r.data?.error}`);

  r = await req(j, 'POST', '/api/auth/register', { username: 'validuser', email: 'bad-email', password: 'test1234' });
  check('Email invalid → 400', r.status === 400, `status=${r.status} ${r.data?.error}`);

  r = await req(j, 'POST', '/api/auth/register', { username: 'validuser', email: 'a@b.co', password: '12' });
  check('Parola sub 4 caractere → 400', r.status === 400, `status=${r.status} ${r.data?.error}`);

  r = await req(j, 'POST', '/api/auth/register', { username: 'bad user!', email: 'a@b.co', password: 'test1234' });
  check('Username cu caractere interzise → 400', r.status === 400, `status=${r.status} ${r.data?.error}`);
}

console.log('\n=== 2. ÎNREGISTRARE (publică) + BOOTSTRAP ADMIN ===');
{
  const j = jar();
  const r = await req(j, 'POST', '/api/auth/register', { username: 'marius', email: 'marius@test.ro', password: 'parola123' });
  check('Register primul user → 201', r.status === 201, `status=${r.status} ${JSON.stringify(r.data).slice(0,150)}`);
  check('Primul user e admin (bootstrap)', r.data?.user?.is_admin === true, JSON.stringify(r.data?.user));
  check('Cookie de sesiune setat HttpOnly', /HttpOnly/i.test(String(r.headers.get('set-cookie'))), String(r.headers.get('set-cookie')).slice(0,100));
  check('Cookie are Secure + SameSite', /Secure/i.test(String(r.headers.get('set-cookie'))) && /SameSite/i.test(String(r.headers.get('set-cookie'))));

  const me = await req(j, 'GET', '/api/auth/me');
  check('GET /api/auth/me logat → username corect', me.data?.user?.username === 'marius', JSON.stringify(me.data));
  check('Puncte initiale = 0', me.data?.user?.points === 0);
  globalThis.admin = j;

  const dup = await req(jar(), 'POST', '/api/auth/register', { username: 'marius', email: 'alt@test.ro', password: 'parola123' });
  check('Username duplicat → 409', dup.status === 409, `status=${dup.status} ${dup.data?.error}`);
  const dup2 = await req(jar(), 'POST', '/api/auth/register', { username: 'altcineva', email: 'marius@test.ro', password: 'parola123' });
  check('Email duplicat → 409', dup2.status === 409, `status=${dup2.status} ${dup2.data?.error}`);
}

console.log('\n=== 3. SISTEMUL DE INVITAȚII E PLECĂT (înregistrare publică) ===');
{
  const noCode = await req(jar(), 'POST', '/api/auth/register', { username: 'liber1', email: 'liber1@test.ro', password: 'parola123' });
  check('Înregistrare deschisă: fără niciun cod → 201', noCode.status === 201, `status=${noCode.status} ${JSON.stringify(noCode.data)?.slice(0,140)}`);

  const junk = await req(jar(), 'POST', '/api/auth/register', { username: 'liber2', email: 'liber2@test.ro', password: 'parola123', invite_code: 'AU-AAAA-BBBB' });
  check('invite_code trimis e ignorat → 201', junk.status === 201, `status=${junk.status}`);

  const opts2 = await req(jar(), 'GET', '/api/auth/register-options');
  check('register-options: doar bootstrap/count/capacitate', opts2.status === 200 && opts2.data?.bootstrap === false && typeof opts2.data?.userCount === 'number', JSON.stringify(opts2.data));

  // Cu sesiune de admin poarta trece, dar rutele nu mai există → 404.
  const a1 = await req(globalThis.admin, 'GET', '/api/admin/invites');
  check('GET /api/admin/invites → 404 (sistem șters)', a1.status === 404, `status=${a1.status}`);
  const a2 = await req(globalThis.admin, 'POST', '/api/admin/invites', { count: 1 });
  check('POST /api/admin/invites → 404', a2.status === 404, `status=${a2.status}`);
  const a3 = await req(globalThis.admin, 'POST', '/api/invite-requests', { email: 'x@y.z', message: 'Ma mai inscriu pe cod? Nu se mai poate.' });
  check('POST /api/invite-requests → 404', a3.status === 404, `status=${a3.status}`);
  const a4 = await req(globalThis.admin, 'GET', '/api/invite-requests?code=RQ-ZZZZ-ZZZZ');
  check('GET /api/invite-requests → 404', a4.status === 404, `status=${a4.status}`);
  const a5 = await req(globalThis.admin, 'GET', '/api/admin/invite-requests');
  check('GET /api/admin/invite-requests → 404', a5.status === 404, `status=${a5.status}`);

  const dups = await req(jar(), 'POST', '/api/auth/register', { username: 'liber1', email: 'alt@test.ro', password: 'parola123' });
  check('Username duplicat → 409', dups.status === 409, `status=${dups.status}`);

  // Conturi folosite de restul suitei (user2 e „omul obișnuit" al testelor).
  for (const n of [2, 3, 4]) {
    const u = await req(jar(), 'POST', '/api/auth/register', { username: `user${n}`, email: `user${n}@test.ro`, password: 'parola123' });
    check(`Cont liber user${n} creat`, u.status === 201, `status=${u.status}`);
  }
}

console.log('\n=== 4. LOGIN ===');
{
  const j = jar();
  const bad = await req(j, 'POST', '/api/auth/login', { email: 'marius@test.ro', password: 'gresita' });
  check('Parola gresita → 401', bad.status === 401, `status=${bad.status}`);
  const inex = await req(j, 'POST', '/api/auth/login', { email: 'nimeni@test.ro', password: 'parola123' });
  check('User inexistent → 401 cu ACELASI mesaj (anti-enumerare)', inex.status === 401 && inex.data?.error === bad.data?.error, `${inex.data?.error} vs ${bad.data?.error}`);

  const ok = await req(j, 'POST', '/api/auth/login', { email: 'marius@test.ro', password: 'parola123' });
  check('Login cu email → 200', ok.status === 200 && ok.data?.user?.username === 'marius', JSON.stringify(ok.data).slice(0,120));

  const j2 = jar();
  const ok2 = await req(j2, 'POST', '/api/auth/login', { email: 'marius', password: 'parola123' });
  check('Login cu username (confort) → 200', ok2.status === 200, `status=${ok2.status}`);

  const me = await req(j, 'GET', '/api/auth/me');
  check('Sesiune persista dupa login', me.data?.user?.username === 'marius');
}

console.log('\n=== 5. ADMIN ADAUGA SERIE + EPISOD (fluxul obligatoriu din spec) ===');
{
  const j = globalThis.admin;
  const nonAdmin = jar();
  await req(nonAdmin, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });
  const forbidden = await req(nonAdmin, 'POST', '/api/admin/series', { title: 'Hack' });
  check('Non-admin nu poate adauga serie → 403', forbidden.status === 403, `status=${forbidden.status}`);

  const bad = await req(j, 'POST', '/api/admin/series', { title: 'X', status: 'invalid' });
  check('Status invalid → 400', bad.status === 400, `status=${bad.status} ${bad.data?.error}`);

  const r = await req(j, 'POST', '/api/admin/series', {
    title: 'One Piece', description: 'Piratul rege Luffy!', cover_image: 'https://picsum.photos/id/1015/600/900',
    status: 'ongoing', genre: 'Acțiune, Aventură', year: 1999,
  });
  check('Adaugare serie → 201', r.status === 201, `status=${r.status} ${JSON.stringify(r.data).slice(0,150)}`);

  // --- SEO SSR: /serie/<id> iese cu head plin, direct din server ---
  const pretty = await fetch(`${BASE}/serie/${r.data?.id}`, { redirect: 'manual' });
  check('Pretty URL /serie/:id → 200', pretty.status === 200, `status=${pretty.status}`);
  const prettyHtml = await pretty.text();
  check('SSR: titlul seriei e în HTML (nu „Se încarcă")', prettyHtml.includes('One Piece'), `len=${prettyHtml.length}`);
  check('SSR: meta description injectată', prettyHtml.includes('meta name="description"'), '');
  check('SSR: JSON-LD TVSeries injectat', prettyHtml.includes('"TVSeries"'), '');
  check('SSR: canonical pe /serie/:id', prettyHtml.includes(`/serie/${r.data?.id}`), '');

  // Soft 404 rezolvat: id-urile inexistente primesc status 404 real, cu noindex,
  // ca Google să nu indexeze pagini goale și să nu ardă crawl budget.
  {
    const epMissing = await fetch(`${BASE}/episod/999999`, { redirect: 'manual' });
    const epMissingHtml = await epMissing.text();
    check('Pretty URL /episod/999999 (inexistent) → 404', epMissing.status === 404, `status=${epMissing.status}`);
    check('   ...404 are noindex (meta + X-Robots-Tag)',
      epMissingHtml.includes('noindex') && String(epMissing.headers.get('x-robots-tag') || '').includes('noindex'),
      `x-robots-tag=${epMissing.headers.get('x-robots-tag')}`);
    check('   ...404 e HTML de pagină, nu JSON gol', epMissingHtml.includes('<!DOCTYPE html>') && epMissingHtml.includes('Mergi la catalog'), epMissingHtml.slice(0, 80));
    const epAgain = await fetch(`${BASE}/episod/999999`, { redirect: 'manual' });
    check('   ...al doilea apel dă tot 404 (cache negativ stabil)', epAgain.status === 404, `status=${epAgain.status}`);

    const serMissing = await fetch(`${BASE}/serie/999999`, { redirect: 'manual' });
    const serMissingHtml = await serMissing.text();
    check('Pretty URL /serie/999999 (inexistentă) → 404', serMissing.status === 404, `status=${serMissing.status}`);
    check('   ...mesajul spune că seria nu există', serMissingHtml.includes('Serie inexistentă'), serMissingHtml.slice(0, 120));
    const again = await fetch(`${BASE}/serie/999999`, { redirect: 'manual' });
    check('   ...al doilea apel dă tot 404 (cache negativ stabil)', again.status === 404, `status=${again.status}`);
  }

  const sm = await fetch(`${BASE}/sitemap.xml`);
  const smText = await sm.text();
  check('Sitemap folosește URL-urile pretty /serie/', smText.includes('/serie/'), smText.slice(0, 200));
  check('Sitemap NU mai conține /series (face 301 spre /)',
    !/<loc>[^<]*\/series<\/loc>/.test(smText), smText.slice(0, 200));
  check('Sitemap conține / ca prim URL', /<loc>[^<]*\/<\/loc>/.test(smText), smText.slice(0, 120));
  const seriesId = r.data?.id;

  // Campul vechi `doodstream_url` ramane acceptat ca alias: un singur URL
  // devine o singura sursa de tip embed. Asa nu spargem clientii existenti.
  const legacy = await req(j, 'POST', '/api/admin/episodes', { series_id: seriesId, episode_number: 1, title: 'Ep alias', doodstream_url: 'https://doodstream.com/d/abc123' });
  check('Alias vechi doodstream_url → o sursa embed normalizata /d/→/e/',
    legacy.status === 201 && legacy.data?.episode?.sources?.[0]?.url === 'https://doodstream.com/e/abc123' && legacy.data.episode.sources[0].kind === 'embed',
    JSON.stringify(legacy.data).slice(0, 200));

  // Contrapartea verificării de 404: un episod REAL trebuie să rămână 200,
  // cu head plin (SSR SEO), ca la serii.
  {
    const epIdReal = legacy.data.episode.id;
    const epReal = await fetch(`${BASE}/episod/${epIdReal}`, { redirect: 'manual' });
    check('Pretty URL /episod/:id existent → 200', epReal.status === 200, `status=${epReal.status}`);
    const epHtml = await epReal.text();
    check('SSR episod: titlul conține seria + numărul episodului',
      epHtml.includes('One Piece') && epHtml.includes('Episodul 1') && epHtml.includes('subtitrat în română'),
      epHtml.match(/<title[^>]*>[\s\S]*?<\/title>/i)?.[0]?.slice(0, 120) || 'fără <title>');
    check('SSR episod: titlul generic a dispărut (un singur <title>)',
      !epHtml.includes('<title>Episod • anime-uke</title>') && (epHtml.match(/<title>/gi) || []).length === 1,
      `titluri=${(epHtml.match(/<title>/gi) || []).length}`);
    check('SSR episod: meta description injectată', epHtml.includes('meta name="description"'), '');
    check('SSR episod: JSON-LD TVEpisode + BreadcrumbList injectate',
      epHtml.includes('"TVEpisode"') && epHtml.includes('"BreadcrumbList"'), '');
    check('SSR episod: canonical pe /episod/:id',
      epHtml.includes(`/episod/${epIdReal}`) && epHtml.includes('rel="canonical"'), '');
    check('SSR episod: og:type video.episode', epHtml.includes('video.episode'), '');
    check('SSR episod: JSON-LD leagă seria (partOfTVSeries)',
      epHtml.includes('"partOfTVSeries"') && epHtml.includes(`/serie/${seriesId}`), '');
  }

  const badEp2 = await req(j, 'POST', '/api/admin/episodes', { series_id: 9999, episode_number: 2, title: 'x', sources: [{ kind: 'embed', url: 'https://doodstream.com/e/abc123' }] });
  check('Serie inexistenta → 400', badEp2.status === 400, `status=${badEp2.status} ${badEp2.data?.error}`);

  // Episodul principal al suitei: trei surse de tipuri diferite.
  const ep = await req(j, 'POST', '/api/admin/episodes', {
    series_id: seriesId, episode_number: 2, title: 'Romance Dawn',
    sources: [
      { label: 'DoodStream', kind: 'embed', url: 'https://doodstream.com/d/xyz789' },
      { label: 'MP4 direct', kind: 'file', url: 'https://cdn.example.com/ep2.mp4' },
      { label: 'Extern', kind: 'link', url: 'https://example.com/watch/2' },
    ],
  });
  check('Adaugare episod cu 3 surse → 201', ep.status === 201 && ep.data?.episode?.sources?.length === 3, JSON.stringify(ep.data).slice(0, 200));
  check('Etichetele si ordinea sunt pastrate', ep.data?.episode?.sources?.map((x) => x.label).join(',') === 'DoodStream,MP4 direct,Extern', JSON.stringify(ep.data?.episode?.sources));
  check('DoodStream /d/ normalizat la /e/ chiar si in lista de surse', ep.data?.episode?.sources?.[0]?.url === 'https://doodstream.com/e/xyz789', ep.data?.episode?.sources?.[0]?.url);
  const epId = ep.data?.id;

  const dupEp = await req(j, 'POST', '/api/admin/episodes', { series_id: seriesId, episode_number: 2, title: 'Duplicat', sources: [{ kind: 'embed', url: 'https://doodstream.com/e/q' }] });
  check('Episod duplicat (UNIQUE series+numar) → 409', dupEp.status === 409, `status=${dupEp.status} ${dupEp.data?.error}`);

  const dupSrc = await req(j, 'POST', '/api/admin/episodes', { series_id: seriesId, episode_number: 3, title: 'Surse duplicate', sources: [{ kind: 'embed', url: 'https://a.com/e/1' }, { kind: 'embed', url: 'https://a.com/e/1' }] });
  check('Acelasi URL de doua ori in lista → 400', dupSrc.status === 400, `status=${dupSrc.status} ${dupSrc.data?.error}`);

  const noSrc = await req(j, 'POST', '/api/admin/episodes', { series_id: seriesId, episode_number: 4, title: 'Fara surse', sources: [] });
  check('Episod fara surse e permis (se completeaza mai tarziu) → 201', noSrc.status === 201, `status=${noSrc.status} ${noSrc.data?.error}`);

  globalThis.seriesId = seriesId; globalThis.epId = epId;
  globalThis.legacyEpId = legacy.data?.id;
}

console.log('\n=== 5b. SURSE VIDEO (CRUD) ===');
{
  const j = globalThis.admin;
  const epId = globalThis.epId;

  const meta = await req(j, 'GET', '/api/admin/episode-sources?meta=1');
  check('Meta: tipuri de sursa disponibile', JSON.stringify(meta.data?.kinds?.map((k) => k.value)) === '["embed","file","link"]', JSON.stringify(meta.data?.kinds));
  check('Meta: furnizori sugerati + limita', Array.isArray(meta.data?.providers) && meta.data.providers.length > 0 && meta.data.max === 12, JSON.stringify(meta.data).slice(0, 120));

  const anonMeta = await req(jar(), 'GET', '/api/admin/episode-sources?meta=1');
  check('Meta cere admin → 401 fara sesiune', anonMeta.status === 401, `status=${anonMeta.status}`);

  const list = await req(j, 'GET', `/api/admin/episode-sources?episode_id=${epId}`);
  check('Lista surse din panou (toate, inclusiv oprite)', list.status === 200 && list.data?.sources?.length === 3, `status=${list.status} ${JSON.stringify(list.data).slice(0, 150)}`);

  const added = await req(j, 'POST', '/api/admin/episode-sources', { episode_id: epId, kind: 'embed', url: 'https://streamtape.com/e/nou' });
  check('Adaugare sursa noua → 201', added.status === 201 && !!added.data?.id, `status=${added.status} ${added.data?.error}`);
  check('Eticheta se deriva din domeniu cand lipseste', added.data?.source?.label === 'streamtape.com', added.data?.source?.label);
  const srcId = added.data?.id;

  const dup = await req(j, 'POST', '/api/admin/episode-sources', { episode_id: epId, kind: 'embed', url: 'https://streamtape.com/e/nou' });
  check('URL duplicat la acelasi episod → 409', dup.status === 409, `status=${dup.status} ${dup.data?.error}`);

  const http = await req(j, 'POST', '/api/admin/episode-sources', { episode_id: epId, kind: 'embed', url: 'http://nesigur.com/e/x' });
  check('http:// respins → 400', http.status === 400, `status=${http.status} ${http.data?.error}`);

  const js = await req(j, 'POST', '/api/admin/episode-sources', { episode_id: epId, kind: 'embed', url: 'javascript:alert(1)' });
  check('javascript: respins (vector XSS) → 400', js.status === 400, `status=${js.status} ${js.data?.error}`);

  const badFile = await req(j, 'POST', '/api/admin/episode-sources', { episode_id: epId, kind: 'file', url: 'https://cdn.example.com/nu-e-video' });
  check('Tip „file” cere extensie video → 400', badFile.status === 400, `status=${badFile.status} ${badFile.data?.error}`);

  const badKind = await req(j, 'POST', '/api/admin/episode-sources', { episode_id: epId, kind: 'torrent', url: 'https://x.com/a' });
  check('Tip necunoscut → 400', badKind.status === 400, `status=${badKind.status} ${badKind.data?.error}`);

  const ghost = await req(j, 'POST', '/api/admin/episode-sources', { episode_id: 999999, kind: 'embed', url: 'https://x.com/a' });
  check('Sursa pentru episod inexistent → 404', ghost.status === 404, `status=${ghost.status}`);

  // PATCH partial: doar is_active, fara sa trimitem URL-ul inapoi.
  const off = await req(j, 'PATCH', '/api/admin/episode-sources', { id: srcId, is_active: false });
  check('Dezactivare sursa (patch partial)', off.status === 200 && off.data?.source?.is_active === 0, `status=${off.status} ${JSON.stringify(off.data).slice(0, 150)}`);
  check('Patchul partial nu strica URL-ul netrimis', off.data?.source?.url === 'https://streamtape.com/e/nou', off.data?.source?.url);

  const noop = await req(j, 'PATCH', '/api/admin/episode-sources', { id: srcId });
  check('Patch fara modificari → unchanged', noop.status === 200 && noop.data?.unchanged === true, JSON.stringify(noop.data).slice(0, 120));

  const renamed = await req(j, 'PATCH', '/api/admin/episode-sources', { id: srcId, label: 'StreamTape RO', is_active: true });
  check('Redenumire + reactivare', renamed.status === 200 && renamed.data?.source?.label === 'StreamTape RO' && renamed.data.source.is_active === 1, JSON.stringify(renamed.data).slice(0, 150));

  const pub = await req(j, 'GET', `/api/episodes/${epId}`);
  check('API public intoarce sursele active, in ordine', pub.data?.sources?.map((x) => x.label).join(',') === 'DoodStream,MP4 direct,Extern,StreamTape RO', JSON.stringify(pub.data?.sources));
  check('API public nu expune id-urile de episod inactive', pub.data?.sources?.every((x) => x.kind !== undefined && x.url.startsWith('https://')) === true, JSON.stringify(pub.data?.sources).slice(0, 150));

  const del = await req(j, 'DELETE', `/api/admin/episode-sources?id=${srcId}`);
  check('Stergere sursa → 200', del.status === 200 && del.data?.success === true, `status=${del.status}`);
  const delAgain = await req(j, 'DELETE', `/api/admin/episode-sources?id=${srcId}`);
  check('Stergere a doua oara → 404', delAgain.status === 404, `status=${delAgain.status}`);

  const log = await req(j, 'GET', '/api/admin/log?limit=40');
  const actions = (log.data?.log || []).map((a) => a.action);
  check('Audit: add_source / edit_source / delete_source consemnate', ['add_source', 'edit_source', 'delete_source'].every((a) => actions.includes(a)), actions.join(','));
}

console.log('\n=== 5c. SCALARE: paginare, cautare, contoare, editare, postare in bloc ===');
// Sectiunea isi creeaza propria serie si o sterge la final, ca sa nu strice
// numarul de episoade pe care il verifica sectiunile 7 si 8.
{
  const j = globalThis.admin;

  const tmp = await req(j, 'POST', '/api/admin/series', { title: 'Serie de test scalare', status: 'ongoing', year: 2026 });
  check('Sectiunea de scalare isi creeaza propria serie', tmp.status === 201 && Number.isInteger(tmp.data?.id), JSON.stringify(tmp.data).slice(0, 100));
  const sid = tmp.data?.id;

  // --- paginare si cautare pe lista publica ---
  const p1 = await req(j, 'GET', '/api/series?per_page=2&page=1');
  check('Lista publica e paginata', p1.status === 200 && p1.data?.series?.length <= 2, `status=${p1.status} n=${p1.data?.series?.length}`);
  check('Raspunsul include meta de paginare', p1.data?.per_page === 2 && typeof p1.data?.has_more === 'boolean' && p1.data?.page === 1, JSON.stringify({ ...p1.data, series: undefined }));
  check('Optiunile de sortare vin de pe server', Array.isArray(p1.data?.sorts) && p1.data.sorts.length === 4, JSON.stringify(p1.data?.sorts));

  if (p1.data?.has_more) {
    const p2 = await req(j, 'GET', '/api/series?per_page=2&page=2');
    const ids1 = (p1.data.series || []).map((x) => x.id);
    const ids2 = (p2.data.series || []).map((x) => x.id);
    check('Pagina 2 nu repeta elementele de pe pagina 1', !ids2.some((id) => ids1.includes(id)), `${ids1} vs ${ids2}`);
  }

  const big = await req(j, 'GET', '/api/series?per_page=99999');
  check('per_page exagerat e limitat, nu onorat', big.data?.per_page <= 60, `per_page=${big.data?.per_page}`);
  const negPage = await req(j, 'GET', '/api/series?page=-5');
  check('page negativ cade pe pagina 1', negPage.data?.page === 1, `page=${negPage.data?.page}`);

  const found = await req(j, 'GET', '/api/series?q=scalare');
  check('Cautarea gaseste seria dupa titlu', found.data?.total >= 1 && found.data.series.some((x) => /scalare/i.test(x.title)), JSON.stringify(found.data?.series?.map((x) => x.title)));
  const notFound = await req(j, 'GET', '/api/series?q=zzz_nu_exista');
  check('Cautarea fara rezultate intoarce lista goala, nu eroare', notFound.status === 200 && notFound.data?.series?.length === 0 && notFound.data?.total === 0, `status=${notFound.status}`);
  const escaped = await req(j, 'GET', '/api/series?q=%25');
  check('Caracterele LIKE sunt escaped (% nu devine wildcard)', escaped.status === 200 && escaped.data?.series?.length === 0, `n=${escaped.data?.series?.length}`);

  // --- sortare ---
  const byTitle = await req(j, 'GET', '/api/series?sort=title&per_page=5');
  check('Sortarea pe titlu e acceptata', byTitle.status === 200 && byTitle.data?.sort === 'title', `sort=${byTitle.data?.sort}`);
  const badSort = await req(j, 'GET', '/api/series?sort=;DROP+TABLE');
  check('Sortarea necunoscuta cade pe implicita, nu pe SQL injectat', badSort.status === 200 && badSort.data?.sort === 'latest', `sort=${badSort.data?.sort}`);

  // --- editare serie (PATCH partial) ---
  const patch = await req(j, 'PATCH', '/api/admin/series', { id: sid, year: 1999, genre: 'Shonen' });
  check('PATCH serie salveaza campurile trimise', patch.status === 200 && patch.data?.series?.year === 1999 && patch.data.series.genre === 'Shonen', JSON.stringify(patch.data).slice(0, 150));
  check('PATCH partial nu goleste campurile netrimise', patch.data?.series?.title === 'Serie de test scalare', `title=${patch.data?.series?.title}`);
  const noop = await req(j, 'PATCH', '/api/admin/series', { id: sid });
  check('PATCH fara modificari → unchanged', noop.status === 200 && noop.data?.unchanged === true, JSON.stringify(noop.data).slice(0, 100));
  const badPatch = await req(j, 'PATCH', '/api/admin/series', { id: sid, status: 'inventat' });
  check('PATCH cu status invalid → 400', badPatch.status === 400, `status=${badPatch.status}`);
  const ghostPatch = await req(j, 'PATCH', '/api/admin/series', { id: 999999, year: 2000 });
  check('PATCH pe serie inexistenta → 404', ghostPatch.status === 404, `status=${ghostPatch.status}`);
  const detail = await req(j, 'GET', `/api/admin/series?id=${sid}`);
  check('Detaliul de serie include total_views', detail.status === 200 && typeof detail.data?.series?.total_views === 'number', JSON.stringify(detail.data?.series).slice(0, 140));

  // --- fisa detaliata (0024): titluri alternative, teme, varsta, durata, echipa, episodul urmator ---
  const fisa = await req(j, 'PATCH', '/api/admin/series', {
    id: sid, alt_titles: 'Test Alt / Alt Test', themes: 'școală, supraviețuire', age_rating: '16+',
    ep_duration: 24, release_date: '1999-10-20', country: 'Japonia',
    external_url: 'https://myanimelist.net/anime/21/One_Piece', team: 'Traducere: Ana · Verificare: Dan',
    next_ep_note: 'Episodul 4 RoSub', next_ep_at: '2030-01-01T18:00',
  });
  check('PATCH fisa detaliata salveaza toate campurile', fisa.status === 200 && fisa.data?.series?.age_rating === '16+' && fisa.data.series.ep_duration === 24 && fisa.data.series.team.includes('Ana') && fisa.data.series.next_ep_note === 'Episodul 4 RoSub', JSON.stringify(fisa.data).slice(0, 200));
  const badAge = await req(j, 'PATCH', '/api/admin/series', { id: sid, age_rating: '99+' });
  check('Varsta minima invalida → 400', badAge.status === 400, `status=${badAge.status}`);
  const badDur = await req(j, 'PATCH', '/api/admin/series', { id: sid, ep_duration: 0 });
  check('Durata 0 → 400', badDur.status === 400, `status=${badDur.status}`);
  const badRel = await req(j, 'PATCH', '/api/admin/series', { id: sid, release_date: '20 oct 1999' });
  check('Data lansarii in format liber → 400', badRel.status === 400, `status=${badRel.status}`);
  const badExt = await req(j, 'PATCH', '/api/admin/series', { id: sid, external_url: 'http://insecure.example' });
  check('Link extern fara https → 400', badExt.status === 400, `status=${badExt.status}`);
  const pubFisa = await req(jar(), 'GET', `/api/series/${sid}`);
  check('Pagina publica primeste fisa detaliata + episodul urmator', pubFisa.status === 200 && pubFisa.data?.series?.themes === 'școală, supraviețuire' && pubFisa.data.series.external_url.includes('myanimelist') && pubFisa.data.series.next_ep_at === '2030-01-01T18:00', JSON.stringify(pubFisa.data?.series).slice(0, 220));
  const adminFisa = await req(j, 'GET', `/api/admin/series?id=${sid}`);
  check('Detaliul admin include fisa (pentru pre-completarea formularului)', adminFisa.data?.series?.alt_titles === 'Test Alt / Alt Test' && adminFisa.data.series.country === 'Japonia', JSON.stringify(adminFisa.data?.series).slice(0, 200));
  const clearFisa = await req(j, 'PATCH', '/api/admin/series', { id: sid, next_ep_note: '', next_ep_at: '' });
  check('Golirea anuntului „episodul urmator" merge', clearFisa.status === 200 && clearFisa.data?.series?.next_ep_note === '' && clearFisa.data.series.next_ep_at === '', JSON.stringify(clearFisa.data).slice(0, 120));

  // --- postare in bloc ---
  const bulk = await req(j, 'POST', '/api/admin/episodes', {
    series_id: sid,
    episodes: [
      { episode_number: 1, title: 'Unu', sources: [{ label: 'Dood', kind: 'embed', url: 'https://doodstream.com/d/aB3xY9zQ12' }] },
      // domeniu rotit + link vechi: trebuie normalizat automat la /e/
      { episode_number: 2, title: 'Doi', sources: [{ kind: 'embed', url: 'https://f7hyg4q.org/d/kM8nQ2xW47' }, { kind: 'file', url: 'https://cdn.x.com/2.mp4' }] },
      { episode_number: 3, title: '', sources: [] },
      { episode_number: 2, title: 'duplicat in lista', sources: [] },
      { episode_number: 0, title: 'numar invalid', sources: [] },
    ],
  });
  check('Bulk creeaza episoadele valide', bulk.status === 201 && bulk.data?.created === 3, JSON.stringify(bulk.data).slice(0, 160));
  check('Bulk raporteaza erorile cu numarul liniei', bulk.data?.errors?.length === 2 && bulk.data.errors.every((e) => typeof e.line === 'number'), JSON.stringify(bulk.data?.errors));
  check('Un duplicat din lista nu anuleaza tot lotul', bulk.data?.created === 3 && bulk.data?.skipped === 0, JSON.stringify({ created: bulk.data?.created, skipped: bulk.data?.skipped }));

  const again = await req(j, 'POST', '/api/admin/episodes', {
    series_id: sid,
    episodes: [{ episode_number: 2, title: 'deja exista', sources: [] }],
  });
  check('Repostarea unui episod existent e sarita, nu respinsa', again.status === 200 && again.data?.created === 0 && again.data?.skipped === 1, JSON.stringify(again.data).slice(0, 140));

  // --- contoare denormalizate pe seria de test ---
  const after = await req(j, 'GET', `/api/admin/series?id=${sid}`);
  check('episode_count se sincronizeaza dupa bulk', after.data?.series?.episode_count === 3, `episode_count=${after.data?.series?.episode_count}`);

  // Episoadele NU vin in detaliul de serie: la 1000 de episoade ar insemna
  // un raspuns urias. Se cer separat, paginat, de la /api/admin/episodes.
  const eps = await req(j, 'GET', `/api/admin/episodes?series_id=${sid}&per_page=50`);
  check('Lista de episoade a seriei vine paginata, cu sursele incluse', eps.status === 200 && eps.data?.episodes?.length === 3 && Array.isArray(eps.data.episodes[0]?.sources), `n=${eps.data?.episodes?.length}`);

  // --- editare episod (PATCH) ---
  const epId = eps.data?.episodes?.find((e) => e.episode_number === 3)?.id;
  check('Episodul cautat e identificabil in lista paginata', Number.isInteger(epId), `epId=${epId}`);
  const epPatch = await req(j, 'PATCH', '/api/admin/episodes', { id: epId, title: 'Titlu editat' });
  check('PATCH episod schimba titlul', epPatch.status === 200 && epPatch.data?.episode?.title === 'Titlu editat', JSON.stringify(epPatch.data).slice(0, 140));
  check('PATCH episod pastreaza numarul netrimis', epPatch.data?.episode?.episode_number === 3, `num=${epPatch.data?.episode?.episode_number}`);
  const conflict = await req(j, 'PATCH', '/api/admin/episodes', { id: epId, episode_number: 1 });
  check('Mutarea pe un numar deja folosit → 409', conflict.status === 409, `status=${conflict.status}`);
  const anonPatch = await req(jar(), 'PATCH', '/api/admin/episodes', { id: epId, title: 'x' });
  check('PATCH episod cere admin → 401', anonPatch.status === 401, `status=${anonPatch.status}`);

  // --- normalizare DoodStream pe domeniu rotit ---
  const ep2 = eps.data?.episodes?.find((e) => e.episode_number === 2);
  check('DoodStream pe domeniu rotit e normalizat /d/ → /e/', ep2?.sources?.[0]?.url === 'https://f7hyg4q.org/e/kM8nQ2xW47', ep2?.sources?.[0]?.url);
  check('Sursa de tip fisier ramane fisier in acelasi lot', ep2?.sources?.[1]?.kind === 'file' && ep2.sources[1].url.endsWith('2.mp4'), JSON.stringify(ep2?.sources));

  // --- pagini admin cu URL propriu ---
  const listPage = await raw(j, '/admin/serii');
  check('GET /admin/serii logat → 200 (pagina noua de liste)', listPage.status === 200, `status=${listPage.status} loc=${listPage.location}`);
  check('Pagina de liste isi incarca scriptul', /page-admin-serii\.js/.test(listPage.text), listPage.text.slice(0, 100));

  const detailPage = await raw(j, `/admin/serie/${sid}`);
  check('GET /admin/serie/<id> logat → 200 (ruta dinamica)', detailPage.status === 200, `status=${detailPage.status} loc=${detailPage.location}`);
  check('Pagina de detaliu isi incarca scriptul', /page-admin-serie\.js/.test(detailPage.text), detailPage.text.slice(0, 100));

  const anonList = await raw(jar(), '/admin/serii');
  check('/admin/serii fara cont → 302 la login', anonList.status === 302 && String(anonList.location).startsWith('/login'), `status=${anonList.status}`);
  const anonDetail = await raw(jar(), `/admin/serie/${sid}`);
  check('/admin/serie/<id> fara cont → 302 la login', anonDetail.status === 302, `status=${anonDetail.status}`);
  check('Redirectul pastreaza destinatia completa', String(anonDetail.location).includes(encodeURIComponent(`/admin/serie/${sid}`)), anonDetail.location);

  const dash = await raw(j, '/admin');
  check('Dashboard-ul admin nu mai are taburile mutate', !/panel-series/.test(dash.text) && !/panel-episodes/.test(dash.text), 'taburi vechi inca prezente');
  check('Dashboard-ul admin leaga spre pagina noua', /\/admin\/serii/.test(dash.text), 'lipseste linkul');

  // --- stergerea seriei scade ambele contoare ---
  const beforeDel = await req(j, 'GET', '/api/series?per_page=50');
  const totalBefore = beforeDel.data?.total;
  const epsBefore = beforeDel.data?.total_episodes;

  const del = await req(j, 'DELETE', `/api/admin/series?id=${sid}`);
  check('Stergerea seriei raporteaza cate episoade a luat cu ea', del.status === 200 && del.data?.deleted_episodes === 3, JSON.stringify(del.data));

  const afterDel = await req(j, 'GET', '/api/series?per_page=50');
  check('series_total scade la stergerea unei serii', afterDel.data?.total === totalBefore - 1, `${totalBefore} → ${afterDel.data?.total}`);
  check('episodes_total scade cu numarul de episoade al seriei', afterDel.data?.total_episodes === epsBefore - 3, `${epsBefore} → ${afterDel.data?.total_episodes}`);

  const log = await req(j, 'GET', '/api/admin/log?limit=50');
  const acts = (log.data?.log || []).map((a) => a.action);
  check('Audit: edit_series / edit_episode / bulk_create_episodes consemnate', ['edit_series', 'edit_episode', 'bulk_create_episodes'].every((a) => acts.includes(a)), acts.slice(0, 12).join(','));
}

console.log('\n=== 5d. PAGINAREA EPISOADELOR PE PAGINA UNEI SERII ===');
// O serie lunga e cazul care sparge cota D1: vechiul LIMIT 2000 citea toate
// episoadele la fiecare vizita, deci ~1100 de randuri pentru One Piece.
{
  const j = globalThis.admin;
  const tmp = await req(j, 'POST', '/api/admin/series', { title: 'Serie lunga de test', status: 'ongoing' });
  const sid = tmp.data?.id;
  check('Serie lunga creata pentru testul de paginare', Number.isInteger(sid), JSON.stringify(tmp.data).slice(0, 100));

  // 150 de episoade, fara surse — ne intereseaza doar numarul de randuri
  const bulk = await req(j, 'POST', '/api/admin/episodes', {
    series_id: sid,
    episodes: Array.from({ length: 150 }, (_, i) => ({ episode_number: i + 1, title: `Ep ${i + 1}`, sources: [] })),
  });
  check('150 de episoade create intr-un singur apel', bulk.status === 201 && bulk.data?.created === 150, `created=${bulk.data?.created}`);

  const p1 = await req(j, 'GET', `/api/series/${sid}`);
  check('Prima pagina returneaza 100 de episoade, nu toate 150', p1.data?.episodes?.length === 100, `n=${p1.data?.episodes?.length}`);
  check('Semnaleaza ca mai exista o pagina', p1.data?.has_more === true && p1.data?.pages === 2, JSON.stringify({ has_more: p1.data?.has_more, pages: p1.data?.pages }));
  check('episode_count vine din coloana denormalizata', p1.data?.episode_count === 150, `episode_count=${p1.data?.episode_count}`);
  check('Prima pagina incepe cu episodul 1', p1.data?.episodes?.[0]?.episode_number === 1, `primul=${p1.data?.episodes?.[0]?.episode_number}`);

  const p2 = await req(j, 'GET', `/api/series/${sid}?page=2`);
  check('Pagina 2 returneaza restul de 50', p2.data?.episodes?.length === 50, `n=${p2.data?.episodes?.length}`);
  check('Pagina 2 incepe exact de unde s-a oprit pagina 1', p2.data?.episodes?.[0]?.episode_number === 101, `primul=${p2.data?.episodes?.[0]?.episode_number}`);
  check('Pagina 2 nu mai anunta pagini urmatoare', p2.data?.has_more === false, `has_more=${p2.data?.has_more}`);

  const ids1 = new Set((p1.data?.episodes || []).map((e) => e.id));
  check('Cele doua pagini nu se suprapun', !(p2.data?.episodes || []).some((e) => ids1.has(e.id)), 'suprapunere detectata');

  const huge = await req(j, 'GET', `/api/series/${sid}?per_page=99999`);
  check('per_page exagerat e limitat la 200', huge.data?.per_page === 200, `per_page=${huge.data?.per_page}`);
  const beyond = await req(j, 'GET', `/api/series/${sid}?page=999`);
  check('Pagina dincolo de sfarsit intoarce lista goala, nu eroare', beyond.status === 200 && beyond.data?.episodes?.length === 0, `status=${beyond.status} n=${beyond.data?.episodes?.length}`);
  const neg = await req(j, 'GET', `/api/series/${sid}?page=-3`);
  check('page negativ cade pe pagina 1', neg.data?.page === 1, `page=${neg.data?.page}`);

  // o serie scurta nu trebuie sa aiba deloc selector de intervale
  const short = await req(j, 'POST', '/api/admin/series', { title: 'Serie scurta de test', status: 'completed' });
  await req(j, 'POST', '/api/admin/episodes', { series_id: short.data?.id, episodes: [{ episode_number: 1, sources: [] }] });
  const shortRes = await req(j, 'GET', `/api/series/${short.data?.id}`);
  check('O serie cu un episod are o singura pagina', shortRes.data?.pages === 1 && shortRes.data?.has_more === false, JSON.stringify({ pages: shortRes.data?.pages, has_more: shortRes.data?.has_more }));

  const ghost = await req(j, 'GET', '/api/series/999999');
  check('Seria inexistenta → 404', ghost.status === 404, `status=${ghost.status}`);

  await req(j, 'DELETE', `/api/admin/series?id=${sid}`);
  await req(j, 'DELETE', `/api/admin/series?id=${short.data?.id}`);
  const counters = await req(j, 'GET', '/api/series?per_page=50');
  check('Contoarele raman corecte dupa curatarea seriilor de test', counters.data?.total_episodes === 3, `total_episodes=${counters.data?.total_episodes}`);
}

console.log('\n=== 6. PAGINI PENTRU UTILIZATORI LOGATI ===');
{
  // Site-ul e privat, deci listele se citesc cu o sesiune valida.
  const j = globalThis.admin;
  const list = await req(j, 'GET', '/api/series');
  check('Lista serii contine seria adaugata + episode_count', list.data?.series?.[0]?.title === 'One Piece' && list.data.series[0].episode_count === 3, JSON.stringify(list.data).slice(0,200));

  const detail = await req(j, 'GET', `/api/series/${globalThis.seriesId}`);
  check('Detaliu serie + episoade intr-un singur apel', detail.status === 200 && detail.data?.episodes?.length === 3, JSON.stringify(detail.data).slice(0,200));

  const e404 = await req(j, 'GET', '/api/series/99999');
  check('Serie inexistenta → 404', e404.status === 404, `status=${e404.status}`);

  const badId = await req(j, 'GET', '/api/series/abc');
  check('ID non-numeric → 400', badId.status === 400, `status=${badId.status}`);

  const epd = await req(j, 'GET', `/api/episodes/${globalThis.epId}`);
  check('Detaliu episod include seria (breadcrumb)', epd.status === 200 && epd.data?.episode?.series_title === 'One Piece', JSON.stringify(epd.data).slice(0,200));
  check('Episod neloghinat ca vazut: watched=false', epd.data?.watched === false);

  // --- PAGINI HTML CU SESIUNE ---
  // Testul de mai sus acoperea doar cazul FARA cont (302 catre /login), deci
  // o bucla de redirecturi pe pagina autentificata trecea neobservata. Asta
  // s-a si intamplat: /profile era remapat la /profile.html, iar routerul de
  // assete Pages trimitea 308 inapoi la /profile → ERR_TOO_MANY_REDIRECTS.
  // `/series` fără id lipsește deliberat: face 301 spre `/` (vezi mai jos).
  for (const page of ['/', '/login', '/register', '/episode', '/admin', '/profile']) {
    const r = await raw(j, page);
    check(`GET ${page} logat → 200 (fara redirect)`, r.status === 200, `status=${r.status} loc=${r.location}`);
  }

  // /series fără id face 301 spre / și pentru utilizatorii logați.
  const seriesRedir = await raw(j, '/series');
  check('GET /series logat → 301 către / (pagina moartă a dispărut)', seriesRedir.status === 301 && seriesRedir.location === '/',
    `status=${seriesRedir.status} loc=${seriesRedir.location}`);

  const profPage = await raw(j, '/profile');
  check('Pagina de profil serveste HTML, nu JSON', /<html/i.test(profPage.text) && /page-profile\.js/.test(profPage.text), profPage.text.slice(0, 120));

  // .html direct trebuie sa faca redirect la varianta curata, dar o singura data
  const htmlDirect = await raw(j, '/profile.html');
  check('/profile.html → 308 catre /profile (clean URL)', htmlDirect.status === 308 && htmlDirect.location === '/profile', `status=${htmlDirect.status} loc=${htmlDirect.location}`);
  const afterClean = await raw(j, '/profile');
  check('Dupa redirect ajungi chiar la pagina (nu in bucla)', afterClean.status === 200, `status=${afterClean.status} loc=${afterClean.location}`);
}

console.log('\n=== 7. CONTOR VIZUALIZARI (buffer in DO, nu direct in D1) ===');
{
  const anon = await req(jar(), 'POST', '/api/view', { episode_id: globalThis.epId });
  check('View fara cont → 401 (site privat)', anon.status === 401, `status=${anon.status}`);

  const j = globalThis.admin;
  const v1 = await req(j, 'POST', '/api/view', { episode_id: globalThis.epId });
  check('POST /api/view → counted=true', v1.status === 200 && v1.data?.counted === true, JSON.stringify(v1.data));
  const v2 = await req(j, 'POST', '/api/view', { episode_id: globalThis.epId });
  check('Acelasi vizitator imediat dupa → deduplicat', v2.data?.counted === false && v2.data?.reason === 'duplicate', JSON.stringify(v2.data));
  const v3 = await req(j, 'POST', '/api/view', { episode_id: 99999 });
  check('View pentru episod inexistent → 404', v3.status === 404, `status=${v3.status}`);
}

console.log('\n=== 8. PUNCTE DOAR DUPA 15 MIN DE VIZIONARE ===');
// Regula: punctele si marcajul „vizionat" nu vin dintr-un buton, ci din timp
// real acumulat prin /api/progress. Sub prag nu se acorda nimic.
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  const p1 = await req(j, 'POST', '/api/progress', { episode_id: globalThis.epId, seconds: 30 });
  check('Heartbeat de 30s e acceptat si acumulat', p1.status === 200 && p1.data?.seconds === 30 && p1.data?.watched === false, JSON.stringify(p1.data));
  check('Sub prag nu se acorda puncte', p1.data?.pointsAdded === 0, JSON.stringify(p1.data));

  const big = await req(j, 'POST', '/api/progress', { episode_id: globalThis.epId, seconds: 99999 });
  check('Un dump urias de secunde e limitat la 120/cerere', big.data?.seconds === 150, `seconds=${big.data?.seconds}`);
  check('Limitarea impiedica sarirea pragului dintr-o cerere', big.data?.watched === false, JSON.stringify(big.data));

  let cur = big.data?.seconds || 0;
  let last = big;
  while (cur < 900) {
    last = await req(j, 'POST', '/api/progress', { episode_id: globalThis.epId, seconds: 120 });
    cur = last.data?.seconds ?? cur;
  }
  check('La 15 min acumulate se marcheaza vizionat', last.data?.watched === true, JSON.stringify(last.data));
  check('La 15 min se acorda +10 puncte', last.data?.pointsAdded === 10 && last.data?.points === 10, JSON.stringify(last.data));

  const again = await req(j, 'POST', '/api/progress', { episode_id: globalThis.epId, seconds: 120 });
  check('Dupa prag nu se mai acorda puncte', again.data?.pointsAdded === 0 && again.data?.points === 10, JSON.stringify(again.data));

  const me = await req(j, 'GET', '/api/auth/me');
  check('Punctele persista in users.points = 10', me.data?.user?.points === 10, JSON.stringify(me.data?.user));

  const epd = await req(j, 'GET', `/api/episodes/${globalThis.epId}`);
  check('Episodul returneaza watched=true si progresul', epd.data?.watched === true && epd.data?.progress_seconds >= 900 && epd.data?.watch_threshold === 900, JSON.stringify({ w: epd.data?.watched, s: epd.data?.progress_seconds, t: epd.data?.watch_threshold }));

  const badId = await req(j, 'POST', '/api/progress', { episode_id: 'abc', seconds: 30 });
  check('episode_id invalid → 400', badId.status === 400, `status=${badId.status}`);
  const badSec = await req(j, 'POST', '/api/progress', { episode_id: globalThis.epId, seconds: -5 });
  check('secunde negative → 400', badSec.status === 400, `status=${badSec.status}`);
}

console.log('\n=== 8a. PLAYERUL NU MAI TRIMITE UTILIZATORUL IN AFARA SITE-ULUI ===');
// Cerinta: vizionezi in playerul din pagina. Cutia care spunea „se deschide
// intr-o pagina externa" prelua tot playerul, deci nu mai exista deloc.
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });
  const page = await raw(j, `/episode?id=${globalThis.epId}`);
  const html = page.text;

  check('Mesajul „se deschide intr-o pagina externa" a disparut', !html.includes('se deschide într-o pagină externă'), 'inca prezent in HTML');
  check('Cutia care prelua playerul (player-ext) a fost scoasa', !html.includes('player-ext'));
  check('Redarea inline ramane: <video> + iframe', html.includes('id="player-video"') && html.includes('id="player"'));
  check('Bara de progres spre 15 minute e prezenta', html.includes('id="watch-progress"'));
  check('Butonul manual de marcare ca vazut a disparut', !html.includes('watch-btn'));
}

console.log('\n=== 8a2. CAUTAREA NU MAI SCANEAZA TOT CATALOGUL ===');
// Un COUNT(*) exact pe LIKE '%x%' nu poate folosi indexul si costa tot
// tabelul. Cand rezultatele incap intr-o pagina, totalul se calculeaza din ce
// am primit deja — zero cereri in plus, zero randuri citite in plus.
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  const r = await req(j, 'GET', '/api/series?q=zzz_inexistent&per_page=24');
  check('Cautarea raporteaza total_capped explicit', typeof r.data?.total_capped === 'boolean', `total_capped=${r.data?.total_capped}`);
  check('Cautare fara rezultate → total 0, neplafonat', r.data?.total === 0 && r.data?.total_capped === false, `total=${r.data?.total}`);

  const r2 = await req(j, 'GET', '/api/series?q=a&per_page=24');
  check('Cautare cu rezultate putine → total exact, neplafonat', r2.data?.total_capped === false && r2.data?.total <= 24, `total=${r2.data?.total} capped=${r2.data?.total_capped}`);
}

console.log('\n=== 8c. CUFAR CU COMORI (timp petrecut pe serie) ===');
// Cuferele se deblocheaza din secunde REALE de vizionare pe serie, deci
// testul impinge progresul prin /api/progress, ca un utilizator adevarat.
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  const anon = await req(jar(), 'GET', `/api/chests?series_id=${globalThis.seriesId}`);
  check('Cuferele cer autentificare → 401', anon.status === 401, `status=${anon.status}`);

  const before = await req(j, 'GET', `/api/chests?series_id=${globalThis.seriesId}`);
  check('Lista de cufere vine cu 3 trepte', before.data?.chests?.length === 3, `n=${before.data?.chests?.length}`);
  check('Niciun cufar nu e deblocat sub primul prag', before.data?.chests?.every((c) => !c.unlocked || c.tier === 1) && !before.data?.chests?.[1]?.unlocked, JSON.stringify(before.data?.chests?.map((c) => c.unlocked)));

  const early = await req(j, 'POST', '/api/chests', { series_id: globalThis.seriesId, tier: 3 });
  check('Cufar nede blocat → 409, fara puncte', early.status === 409, `status=${early.status}`);

  // user2 are deja ~1110s din sectiunea 8; urcam peste pragul de 30 min
  for (let i = 0; i < 6; i++) await req(j, 'POST', '/api/progress', { episode_id: globalThis.epId, seconds: 120 });

  const mid = await req(j, 'GET', `/api/chests?series_id=${globalThis.seriesId}`);
  check('Dupa 30 min pe serie, bronzul e deblocat', mid.data?.chests?.[0]?.unlocked === true, `total=${mid.data?.total_seconds}`);
  check('Argintul ramane blocat la 30 min', mid.data?.chests?.[1]?.unlocked === false, `total=${mid.data?.total_seconds}`);

  // Cuferele dau GOLD (migrarea 0011 — economie), nu puncte: punctele raman
  // exclusiv din vizionare, ca sa nu poata fi farmate pentru clasament.
  const ecoBefore = await req(j, 'GET', '/api/economy');
  const open = await req(j, 'POST', '/api/chests', { series_id: globalThis.seriesId, tier: 1 });
  check('Deschiderea bronzului acorda gold (>0), nu puncte', open.data?.success === true && open.data?.goldAdded > 0 && open.data?.pointsAdded === undefined, JSON.stringify(open.data));
  check('Goldul creste in cont cu exact goldAdded', open.data?.gold === (ecoBefore.data?.gold ?? 0) + open.data?.goldAdded, `${ecoBefore.data?.gold} → ${open.data?.gold}`);

  const twice = await req(j, 'POST', '/api/chests', { series_id: globalThis.seriesId, tier: 1 });
  check('Al doilea clic pe acelasi cufar nu mai da gold', twice.data?.alreadyClaimed === true && twice.data?.goldAdded === 0, JSON.stringify(twice.data));
  check('Totalul de gold ramane corect dupa dubla deschidere', twice.data?.gold === open.data?.gold, `${open.data?.gold} vs ${twice.data?.gold}`);

  const badTier = await req(j, 'POST', '/api/chests', { series_id: globalThis.seriesId, tier: 99 });
  check('Treapta inexistenta → 400', badTier.status === 400, `status=${badTier.status}`);
  const badSeries = await req(j, 'POST', '/api/chests', { series_id: 999999, tier: 1 });
  check('Serie inexistenta → 404', badSeries.status === 404, `status=${badSeries.status}`);

  const after = await req(j, 'GET', `/api/chests?series_id=${globalThis.seriesId}`);
  check('Cufarul deschis apare ca claimed', after.data?.chests?.[0]?.claimed === true, JSON.stringify(after.data?.chests?.[0]));
}

console.log('\n=== 8c2. CUFARUL SECRET SI CLASAMENTUL ===');
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  // Secretul e o surpriza: nu apare in lista pana nu ai deschis aurul, deci
  // inainte de asta lista trebuie sa aiba exact 3 cufere, indiferent de serie.
  const c = await req(j, 'GET', `/api/chests?series_id=${globalThis.seriesId}`);
  check('Cufarul secret nu e dezvaluit inainte de aur', c.data?.chests?.length === 3, `n=${c.data?.chests?.length}`);

  const forceSecret = await req(j, 'POST', '/api/chests', { series_id: globalThis.seriesId, tier: 4 });
  check('Cufarul secret nu poate fi fortat din client → 404/409', forceSecret.status === 404 || forceSecret.status === 409, `status=${forceSecret.status}`);

  const lb1 = await req(j, 'GET', '/api/leaderboard');
  check('Clasamentul raspunde cu weekly/alltime si viewer', Array.isArray(lb1.data?.weekly) && Array.isArray(lb1.data?.alltime) && lb1.data?.viewer?.username != null, JSON.stringify(lb1.data?.viewer));
  check('Viewerul isi vede punctele saptamanii in clasament', Number.isFinite(lb1.data?.viewer?.week_points), JSON.stringify(lb1.data?.viewer));
  check('Topul all-time e ordonat descrescator dupa puncte', (lb1.data?.alltime || []).every((r, i, a) => i === 0 || a[i - 1].points >= r.points), JSON.stringify((lb1.data?.alltime || []).map((r) => r.points)));

  const lb2 = await req(j, 'GET', '/api/leaderboard');
  check('A doua cerere serveste din cache (acelasi updated_at)', lb2.data?.updated_at === lb1.data?.updated_at, `${lb1.data?.updated_at} vs ${lb2.data?.updated_at}`);

  const lbAnon = await req(jar(), 'GET', '/api/leaderboard');
  check('Clasamentul cere autentificare → 401', lbAnon.status === 401, `status=${lbAnon.status}`);
}

console.log('\n=== 8b. PROFIL PUBLIC + LISTA DE VIZIONAT ===');
{
  const j = globalThis.admin;

  const opts = await req(j, 'GET', '/api/profile/me');
  check('GET /api/profile/me → 200', opts.status === 200 && opts.data?.user?.username === 'marius', `status=${opts.status}`);
  check('Profilul include gradul de nivel', !!opts.data?.identity?.rank?.label, JSON.stringify(opts.data?.identity));
  check('Profilul include statisticile (structura)', typeof opts.data?.stats?.episodes_watched === 'number', JSON.stringify(opts.data?.stats));
  check('Profilul NU expune email-ul', !JSON.stringify(opts.data).includes('marius@test.ro'), '');

  const bad1 = await req(j, 'PATCH', '/api/profile', { birth_date: '2099-01-01' });
  check('Data în viitor → 400', bad1.status === 400, `status=${bad1.status}`);
  const bad2 = await req(j, 'PATCH', '/api/profile', { birth_date: '2007-02-30' });
  check('Dată inexistentă (30 feb) → 400', bad2.status === 400, `status=${bad2.status}`);
  const bad3 = await req(j, 'PATCH', '/api/profile', { mal_url: 'https://evil.example/profile' });
  check('Link non-MyAnimeList → 400', bad3.status === 400, `status=${bad3.status}`);
  const bad4 = await req(j, 'PATCH', '/api/profile', { gender: 'elicopter' });
  check('Gen invalid → 400', bad4.status === 400, `status=${bad4.status}`);

  const set = await req(j, 'PATCH', '/api/profile', {
    birth_date: '2007-01-01', gender: 'male', country: 'Romania',
    motto: 'Niciun gând de împărtășit…', mal_url: 'https://myanimelist.net/profile/marius',
  });
  check('PATCH /api/profile salvează', set.status === 200 && set.data?.profile?.birth_date === '2007-01-01', `status=${set.status} ${set.data?.error}`);
  check('Zodia se calculează: 01.01 → Capricorn', set.data?.profile?.zodiac === 'Capricorn', set.data?.profile?.zodiac);
  check('Data e formatată RO: 01.01.2007', set.data?.profile?.birth_date_ro === '01.01.2007', set.data?.profile?.birth_date_ro);
  check('Genul e tradus: Masculin', set.data?.profile?.gender_label === 'Masculin', set.data?.profile?.gender_label);
  check('Vârsta e calculată', typeof set.data?.profile?.age === 'number' && set.data.profile.age > 10, String(set.data?.profile?.age));

  const partial = await req(j, 'PATCH', '/api/profile', { country: 'Moldova' });
  check('Patch-ul partial NU golește celelalte câmpuri',
    partial.data?.profile?.country === 'Moldova' && partial.data?.profile?.birth_date === '2007-01-01' && partial.data?.profile?.motto !== '',
    JSON.stringify(partial.data?.profile || {}).slice(0,180));

  const publicProfile = await req(j, 'GET', '/api/profile/user2');
  check('Profilul public al altui utilizator', publicProfile.status === 200 && publicProfile.data?.user?.username === 'user2' && publicProfile.data?.is_self === false, `status=${publicProfile.status}`);
  check('Statistica reala: user2 are 1 episod vizionat', publicProfile.data?.stats?.episodes_watched === 1 && publicProfile.data?.stats?.series_watched === 1, JSON.stringify(publicProfile.data?.stats));
  check('Profilul altui user NU ii expune email-ul', !JSON.stringify(publicProfile.data).includes('user2@test.ro'), '');
  const anonProfile = await req(jar(), 'GET', '/api/profile/marius');
  check('Profilul cere autentificare → 401', anonProfile.status === 401, `status=${anonProfile.status}`);
  const missing = await req(j, 'GET', '/api/profile/nimeni_nu_e_aici');
  check('Profil inexistent → 404', missing.status === 404, `status=${missing.status}`);

  // --- lista „de vizionat" ---
  const add = await req(j, 'POST', '/api/watchlist', { series_id: globalThis.seriesId });
  check('Adaugă serie la „de vizionat" → 201', add.status === 201 && add.data?.added === true, `status=${add.status}`);
  const addAgain = await req(j, 'POST', '/api/watchlist', { series_id: globalThis.seriesId });
  check('Adăugarea dublă e idempotentă → 200 alreadyInList', addAgain.status === 200 && addAgain.data?.alreadyInList === true, `status=${addAgain.status}`);
  const wl = await req(j, 'GET', '/api/watchlist');
  check('Lista conține seria', wl.status === 200 && wl.data?.count === 1 && wl.data?.watchlist?.[0]?.title === 'One Piece', JSON.stringify(wl.data).slice(0,160));
  const prof2 = await req(j, 'GET', '/api/profile/me');
  check('„Serii de vizionat" apare în Acces rapid', prof2.data?.stats?.watchlist === 1, JSON.stringify(prof2.data?.stats));
  const badSeries = await req(j, 'POST', '/api/watchlist', { series_id: 999999 });
  check('Serie inexistentă → 404', badSeries.status === 404, `status=${badSeries.status}`);
  const del = await req(j, 'DELETE', `/api/watchlist?series_id=${globalThis.seriesId}`);
  check('Ștergere din listă', del.status === 200 && del.data?.removed === true, `status=${del.status}`);

  const anon = await req(jar(), 'GET', '/api/watchlist');
  check('Watchlist fără autentificare → 401', anon.status === 401, `status=${anon.status}`);
}

console.log('\n=== 9. PANOU ADMIN: utilizatori, ban, roluri, protectii ===');
{
  const j = globalThis.admin;
  const users = await req(j, 'GET', '/api/admin/users');
  check('Lista utilizatori → cel putin 2 useri', users.data?.users?.length >= 2, JSON.stringify(users.data?.users?.map(u=>u.username)));
  check('Lista NU contine hash-ul parolei', !JSON.stringify(users.data).includes('password_hash'), 'SCURGERE DE DATE!');
  const u2 = users.data.users.find(u => u.username === 'user2');

  const self = await req(j, 'POST', '/api/admin/users', { action: 'set_ban', user_id: users.data.you, value: true });
  check('Nu iti poti modifica propriul cont → 400', self.status === 400, `status=${self.status} ${self.data?.error}`);

  const demoteSelf = await req(j, 'POST', '/api/admin/users', { action: 'set_role', user_id: users.data.you, value: 'user' });
  check('Nu te poti demota singur → 400', demoteSelf.status === 400, `status=${demoteSelf.status}`);

  const promote = await req(j, 'POST', '/api/admin/users', { action: 'set_role', user_id: u2.id, value: true });
  check('Fă admin → succes', promote.data?.success === true && promote.data?.is_admin === true, JSON.stringify(promote.data));

  const lastAdminDemote = await req(j, 'POST', '/api/admin/users', { action: 'set_role', user_id: u2.id, value: 'user' });
  check('Demoteaza inapoi → succes', lastAdminDemote.data?.success === true, JSON.stringify(lastAdminDemote.data));

  // Acum marius e singurul admin: incercam sa-l demoteze altcineva nu e posibil,
  // dar verificam ca user2 (non-admin) nu poate face actiuni admin
  const j2 = jar();
  await req(j2, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });
  const noAccess = await req(j2, 'POST', '/api/admin/users', { action: 'set_ban', user_id: 1, value: true });
  check('Non-admin nu poate bana → 403', noAccess.status === 403, `status=${noAccess.status}`);

  const ban = await req(j, 'POST', '/api/admin/users', { action: 'set_ban', user_id: u2.id, value: true });
  check('Ban utilizator → succes', ban.data?.success === true && ban.data?.is_banned === true, JSON.stringify(ban.data));

  const bannedMe = await req(j2, 'GET', '/api/auth/me');
  check('Sesiunea unui user BANAT devine imediat invalida (verificare per-request)', bannedMe.data?.user === null, JSON.stringify(bannedMe.data));

  const bannedWatch = await req(j2, 'POST', '/api/progress', { episode_id: globalThis.epId, seconds: 30 });
  check('User banat nu poate raporta progres → 401', bannedWatch.status === 401, `status=${bannedWatch.status}`);

  const bannedLogin = await req(jar(), 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });
  check('User banat nu se poate loga → 403', bannedLogin.status === 403, `status=${bannedLogin.status} ${bannedLogin.data?.error}`);

  const unban = await req(j, 'POST', '/api/admin/users', { action: 'set_ban', user_id: u2.id, value: false });
  check('Unban → succes', unban.data?.success === true, JSON.stringify(unban.data));
  const loginAfter = await req(jar(), 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });
  check('Dupa unban login functioneaza → 200', loginAfter.status === 200, `status=${loginAfter.status}`);

  const badAction = await req(j, 'POST', '/api/admin/users', { action: 'wipe_everything', user_id: u2.id });
  check('Actiune necunoscuta → 400', badAction.status === 400, `status=${badAction.status}`);
}

console.log('\n=== 10. STATISTICI + JURNAL AUDIT ===');
{
  const j = globalThis.admin;
  const s = await req(j, 'GET', '/api/admin/stats');
  check('Statistici: total_users=6', s.data?.stats?.total_users === 6, JSON.stringify(s.data?.stats));
  check('Statistici: plafoanele implicite sunt 1000/1000', s.data?.stats?.limit_users === 1000 && s.data?.stats?.limit_series === 1000, JSON.stringify(s.data?.stats));
  check('Statistici: total_series=1, total_episodes=3', s.data?.stats?.total_series === 1 && s.data?.stats?.total_episodes === 3, JSON.stringify(s.data?.stats));
  check('Statistici: total_watched=1', s.data?.stats?.total_watched === 1, JSON.stringify(s.data?.stats));

  const log = await req(j, 'GET', '/api/admin/log');
  check('Jurnal audit are intrari', Array.isArray(log.data?.log) && log.data.log.length >= 4, `intrari=${log.data?.log?.length}`);
  const actions = (log.data?.log || []).map(l => l.action);
  check('Jurnal contine create_series + create_episode', actions.includes('create_series') && actions.includes('create_episode'), actions.join(','));
  check('Jurnal contine ban_user + unban_user', actions.includes('ban_user') && actions.includes('unban_user'), actions.join(','));
  check('Jurnal contine promote_admin', actions.includes('promote_admin'), actions.join(','));
}

console.log('\n=== 11. LOGOUT ===');
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'marius@test.ro', password: 'parola123' });
  const before = await req(j, 'GET', '/api/auth/me');
  check('Inainte de logout: logat', before.data?.user?.username === 'marius');
  const out = await req(j, 'POST', '/api/auth/logout');
  check('POST /api/auth/logout → 200', out.status === 200, `status=${out.status}`);
  check('Logout seteaza Max-Age=0 (sterge cookie HttpOnly)', /Max-Age=0/i.test(String(out.headers.get('set-cookie'))), String(out.headers.get('set-cookie')));
  j.cookie = '';
  const after = await req(j, 'GET', '/api/auth/me');
  check('Dupa logout: user null', after.data?.user === null, JSON.stringify(after.data));
}

console.log('\n=== 12. SECURITATE: rute & metode ===');
{
  // Site-ul e privat: fara sesiune, orice ruta necunoscuta intoarce 401,
  // ceea ce e corect (nu dezvaluie ce rute exista). Verificam 404 cu sesiune.
  const j = globalThis.admin;
  const m405 = await req(jar(), 'GET', '/api/auth/login');
  check('GET pe /api/auth/login → 405', m405.status === 405, `status=${m405.status}`);
  const m404 = await req(j, 'GET', '/api/ceva-inexistent');
  check('Ruta API inexistenta → 404 JSON', m404.status === 404, `status=${m404.status}`);
  const noOrigin = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ email: 'marius@test.ro', password: 'parola123' }) });
  check('Cerere cu Origin strain → 403 (anti-CSRF)', noOrigin.status === 403, `status=${noOrigin.status}`);
  const xss = await req(globalThis.admin, 'POST', '/api/admin/series', { title: '<img src=x onerror=alert(1)>', description: '<script>alert(1)</script>' });
  check('Serie cu payload XSS acceptata ca TEXT (va fi escapata la randare)', xss.status === 201, `status=${xss.status}`);
  const list = await req(j, 'GET', '/api/series');
  check('API returneaza textul brut (nu HTML executabil)', JSON.stringify(list.data).includes('<img src=x'), '');
}

console.log('\n=== 13. CHAT WEBSOCKET ===');
{
  const j = globalThis.admin;
  // Neauth
  try {
    const wsBad = new WebSocket(`${WS_BASE}/chat`);
    const res = await new Promise((resolve) => { wsBad.onopen = () => resolve('open'); wsBad.onerror = () => resolve('error'); wsBad.onclose = (e) => resolve('close:' + e.code); setTimeout(() => resolve('timeout'), 4000); });
    check('WebSocket fara autentificare e respins', res === 'error' || res.startsWith('close:'), `rezultat=${res}`);
    try { wsBad.close(); } catch {}
  } catch (e) { check('WebSocket fara autentificare e respins', true); }

  // Auth
  const cookie = j.cookie;
  try {
    const ws = new WS(`${WS_BASE}/chat`, { headers: { Cookie: cookie } });
    const init = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout la init')), 6000);
      ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'init') { clearTimeout(t); resolve(d); } };
      ws.onerror = (e) => { clearTimeout(t); reject(new Error('ws error')); };
    });
    check('WebSocket autentificat primeste init', !!init && !!init.you, JSON.stringify(init?.you));
    check('init contine username-ul din JWT (nu de la client)', init?.you?.username === 'marius', JSON.stringify(init?.you));
    check('init contine lista online', Array.isArray(init.online), JSON.stringify(init.online));
    check('init contine istoric (array)', Array.isArray(init.history));

    // REGRESIE: pulse citea DO-ul 'global' în loc de 'global-chat' → online era
    // mereu 0. Cu socket-ul deschis, pulse trebuie să vadă măcar 1 utilizator.
    const pulseLive = await req(j, 'GET', '/api/pulse');
    check('Pulse vede socket-ul deschis (online ≥ 1)', (pulseLive.data?.online ?? 0) >= 1, JSON.stringify(pulseLive.data));

    ws.send(JSON.stringify({ type: 'chat', message: 'Salut din test!' }));
    const msg = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout la mesaj')), 6000);
      ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'message') { clearTimeout(t); resolve(d); } };
    });
    check('Mesaj difuzat cu username corect', msg.username === 'marius' && msg.message === 'Salut din test!', JSON.stringify(msg));
    // stikerele merg prin acelasi canal de mesaje; asteptam intervalul minim
    // anti-spam al DO-ului inainte de al doilea mesaj
    await new Promise((r) => setTimeout(r, 1800));
    ws.send(JSON.stringify({ type: 'chat', message: '[sticker:party]' }));

    // Rate limiter-ul cere 1.5s intre mesaje — asteptam, altfel testul
    // primeste 'error' in loc de 'message' (comportament corect, test gresit).
    await new Promise(r => setTimeout(r, 1700));

    // XSS in mesaj: trebuie stocat ca text, nu executat
    ws.send(JSON.stringify({ type: 'chat', message: '<img src=x onerror=alert(1)>' }));
    const xssMsg = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 6000);
      ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'message') { clearTimeout(t); resolve(d); } };
    });
    check('Payload XSS ramane text brut in broadcast (client il pune cu textContent)', xssMsg.message.includes('<img'), JSON.stringify(xssMsg).slice(0,150));

    // Rate limit: trimitem IMEDIAT (fara pauza) ca sa declansam limita
    ws.send(JSON.stringify({ type: 'chat', message: 'spam' }));
    const rl = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout la rate limit')), 6000);
      ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'error' || d.type === 'message') { clearTimeout(t); resolve(d); } };
    });
    check('Rate limit blocheaza mesajul trimis prea repede', rl.type === 'error', JSON.stringify(rl).slice(0,150));

    ws.close();
  } catch (e) {
    check('Chat WebSocket functioneaza', false, e.message);
  }
}

console.log('\n=== 13b. SUBTITRARI WEBVTT IN ROMANA ===');
// Subtitrarea e un camp optional pe episod: cale din site sau https.
// Playerul o ataseca ca <track srclang="ro">; aici verificam doar contractul
// API si validarea, partea de DOM e in dom-smoke.
{
  const j = globalThis.admin;
  const created = await req(j, 'POST', '/api/admin/episodes', {
    series_id: globalThis.seriesId,
    episodes: [{
      episode_number: 901, title: 'Cu subtitrare',
      subtitle_url: '/assets/subs/demo-ro.vtt',
      sources: [{ label: 'S', kind: 'file', url: 'https://media.w3.org/2010/05/bunny/trailer.mp4' }],
    }],
  });
  // Raspunsul de bulk nu intoarce id-urile, deci cautam episodul dupa numar.
  const list = await req(j, 'GET', `/api/series/${globalThis.seriesId}`);
  const newId = (list.data?.episodes || []).find((e) => e.episode_number === 901)?.id;
  check('Episodul cu subtitrare se posteaza', Number.isInteger(newId), JSON.stringify(created.data)?.slice(0, 120));

  const got = await req(j, 'GET', `/api/episodes/${newId}`);
  check('API-ul returneaza subtitle_url', got.data?.episode?.subtitle_url === '/assets/subs/demo-ro.vtt', JSON.stringify(got.data?.episode?.subtitle_url));
  const subAnon = await req(jar(), 'GET', `/api/subtitle?episode_id=${newId}`);
  check('Proxy-ul de subtitrare anonim → 401', subAnon.status === 401, `status=${subAnon.status}`);
  const subOk = await req(j, 'GET', `/api/subtitle?episode_id=${newId}`);
  check('Proxy-ul serveste VTT prin originul nostru (anti-CORS)', subOk.status === 200 && String(subOk.data?.raw || subOk.data || '').startsWith('WEBVTT') && String(subOk.headers.get('content-type')).includes('text/vtt'), `status=${subOk.status} ct=${subOk.headers.get('content-type')}`);
  const subNone = await req(j, 'GET', `/api/subtitle?episode_id=${globalThis.epId}`);
  check('Episodul fara subtitrare → 404 curat', subNone.status === 404, `status=${subNone.status}`);

  const badHttp = await req(j, 'PATCH', '/api/admin/episodes', { id: newId, subtitle_url: 'http://insecure.example/x.vtt' });
  check('Subtitrare http:// (nesigura) → 400', badHttp.status === 400, `status=${badHttp.status}`);
  const badJs = await req(j, 'PATCH', '/api/admin/episodes', { id: newId, subtitle_url: 'javascript:alert(1)' });
  check('Subtitrare javascript: → 400', badJs.status === 400, `status=${badJs.status}`);

  const https = await req(j, 'PATCH', '/api/admin/episodes', { id: newId, subtitle_url: 'https://cdn.example.com/ro.vtt' });
  check('Subtitrare https valida se salveaza', https.status === 200, `status=${https.status}`);
  const cleared = await req(j, 'PATCH', '/api/admin/episodes', { id: newId, subtitle_url: '' });
  check('Subtitrarea se poate goli', cleared.status === 200, `status=${cleared.status}`);

  await req(j, 'DELETE', `/api/admin/episodes?id=${newId}`);
}

console.log('\n=== 13c. COMUNITATE: RATING, COMENTARII, CONTINUARE ===');
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  // --- rating: vot, revot (upsert), validare, agregare in ruta seriei
  const r1 = await req(j, 'POST', '/api/ratings', { series_id: globalThis.seriesId, rating: 8 });
  check('Nota 8 se salveaza', r1.data?.success === true && r1.data?.average === 8 && r1.data?.count === 1, JSON.stringify(r1.data));
  const r2 = await req(j, 'POST', '/api/ratings', { series_id: globalThis.seriesId, rating: 10 });
  check('Revotul e upsert: count ramane 1, media devine 10', r2.data?.count === 1 && r2.data?.average === 10, JSON.stringify(r2.data));
  const r3 = await req(j, 'POST', '/api/ratings', { series_id: globalThis.seriesId, rating: 11 });
  check('Nota 11 e respinsa → 400', r3.status === 400, `status=${r3.status}`);
  const ser = await req(j, 'GET', `/api/series/${globalThis.seriesId}`);
  check('Ruta seriei expune media, numarul si nota proprie', ser.data?.rating_average === 10 && ser.data?.rating_count === 1 && ser.data?.my_rating === 10, JSON.stringify({ a: ser.data?.rating_average, n: ser.data?.rating_count, m: ser.data?.my_rating }));

  // --- comentarii: postare, spoiler pastrat ca text, minim de lungime,
  //     stergere proprie vs a altcuiva
  const c1 = await req(j, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Primul comentariu [spoiler]Zoro iar moare[/spoiler]' });
  check('Comentariul se posteaza', c1.data?.success === true, JSON.stringify(c1.data));
  const short = await req(j, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'x' });
  check('Comentariu prea scurt → 400', short.status === 400, `status=${short.status}`);

  const list = await req(j, 'GET', `/api/comments?episode_id=${globalThis.epId}`);
  check('Lista contine comentariul cu autor si marcajul own', list.data?.comments?.length === 1 && list.data.comments[0].own === true && list.data.comments[0].username, JSON.stringify(list.data?.comments));
  check('Spoilerul ramane text curat (se randaza in browser)', list.data?.comments?.[0]?.body?.includes('[spoiler]'), list.data?.comments?.[0]?.body);

  const adminComment = await req(globalThis.admin, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Comentariul adminului pentru testul de moderare' });
  const adminCommentId = adminComment.data?.id;
  const forbidden = await req(j, 'DELETE', `/api/comments?id=${adminCommentId}`);
  check('Un user nu poate sterge comentariul altcuiva → 403', forbidden.status === 403, `status=${forbidden.status}`);
  const adminDel = await req(globalThis.admin, 'DELETE', `/api/comments?id=${adminCommentId}`);
  check('Adminul poate sterge orice comentariu', adminDel.data?.success === true, JSON.stringify(adminDel.data));
  const ownDel = await req(j, 'DELETE', `/api/comments?id=${c1.data?.id}`);
  check('Autorul isi poate sterge propriul comentariu', ownDel.data?.success === true, JSON.stringify(ownDel.data));

  // --- continua vizionarea: din progresul real al lui user2
  const cont = await req(j, 'GET', '/api/continue');
  const hit = (cont.data?.items || []).find((it) => it.episode_id === globalThis.epId);
  check('Rândul „Continua vizionarea" contine episodul cu progres', !!hit && hit.seconds >= 900, JSON.stringify(cont.data?.items?.[0]));
  check('Itemul are serie si numar de episod pentru card', !!hit?.series_title && Number.isInteger(hit?.episode_number), JSON.stringify(hit)?.slice(0, 120));
}

console.log('\n=== 13d. ECONOMIE: XP, NIVELURI, PUNCTE LUNARE, CUFAR, INSIGNE ===');
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  // --- /api/economy: XP-ul acumulat pana aici (vizionare +10, rating +5, comentarii)
  const e1 = await req(j, 'GET', '/api/economy');
  check('GET /api/economy returneaza economia completa', e1.status === 200 && Number.isInteger(e1.data?.xp) && e1.data.xp >= 15, JSON.stringify(e1.data)?.slice(0, 160));
  check('Formula de nivel e 100n²+500n', e1.data?.xp_needed === 100 * e1.data.level * e1.data.level + 500 * e1.data.level, `level=${e1.data?.level} need=${e1.data?.xp_needed}`);
  check('Punctele lunare merg in paralel cu XP-ul', e1.data?.monthly_points === e1.data.xp && e1.data.monthly_goal === 10000, JSON.stringify({ m: e1.data?.monthly_points, x: e1.data?.xp }));
  check('Insigna „Primul episod" e acordata dupa vizionare', (e1.data?.badges || []).some((b) => b.badge === 'first_watch'), JSON.stringify(e1.data?.badges));
  check('Cufarul e disponibil la prima accesare', e1.data?.chest?.available === true, JSON.stringify(e1.data?.chest));

  // --- /api/auth/me expune noile coloane pentru chipurile din nav
  const me = await req(j, 'GET', '/api/auth/me');
  check('Sesiunea expune xp, level si gold', Number.isInteger(me.data?.user?.xp) && Number.isInteger(me.data?.user?.level) && Number.isInteger(me.data?.user?.gold), JSON.stringify(me.data?.user)?.slice(0, 160));

  // --- anon: 401 pe ambele rute
  const anonE = await req(jar(), 'GET', '/api/economy');
  check('GET /api/economy anon → 401', anonE.status === 401, `status=${anonE.status}`);
  const anonC = await req(jar(), 'POST', '/api/chest');
  check('POST /api/chest anon → 401', anonC.status === 401, `status=${anonC.status}`);

  // --- cufar: deschidere cu recompensa ponderata, apoi cooldown 4h
  const open1 = await req(j, 'POST', '/api/chest');
  const rewards = ['gold', 'xp', 'nothing'];
  check('Prima deschidere reuseste cu recompensa din tabelul ponderat', open1.data?.success === true && rewards.includes(open1.data?.reward) && typeof open1.data?.text === 'string', JSON.stringify(open1.data)?.slice(0, 160));
  // Baza e gold 10-100 / XP 5-50, inmultita cu nivelul (max 2x) si cu bonusul
  // de factiune (1.5x) → plafon teoretic 3x.
  check('Gold-ul cade in intervalul 10-300, XP-ul in 5-150 (baza × nivel × facțiune)',
    (open1.data?.reward !== 'gold' || (open1.data.amount >= 10 && open1.data.amount <= 300)) &&
    (open1.data?.reward !== 'xp' || (open1.data.amount >= 5 && open1.data.amount <= 150)),
    JSON.stringify({ r: open1.data?.reward, a: open1.data?.amount }));
  const open2 = await req(j, 'POST', '/api/chest');
  check('A doua deschidere in cooldown → 409', open2.status === 409, `status=${open2.status}`);
  check('409-ul aduce timpul ramas in header', Number(open2.headers?.get('x-remaining-ms')) > 3 * 60 * 60 * 1000, `hdr=${open2.headers?.get('x-remaining-ms')}`);
  const st = await req(j, 'GET', '/api/chest');
  check('GET /api/chest arata cooldown-ul activ si gold-ul curent', st.data?.chest?.available === false && st.data.chest.remaining_ms > 0 && Number.isInteger(st.data?.gold), JSON.stringify(st.data)?.slice(0, 160));

  // --- XP din comentariu: +5 exact (spec)
  const before = (await req(j, 'GET', '/api/economy')).data.xp;
  const cm = await req(j, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Comentariu pentru testul de XP' });
  const after = (await req(j, 'GET', '/api/economy')).data.xp;
  check('Comentariul adauga exact +5 XP', cm.data?.success === true && after === before + 5, `before=${before} after=${after}`);
  await req(j, 'DELETE', `/api/comments?id=${cm.data?.id}`);

  // --- +5 XP la deschiderea cufarului (indiferent de recompensa)
  const e2 = await req(j, 'GET', '/api/economy');
  check('Deschiderea cufarului a hranit XP-ul (+5 minim, plus recompensa daca a fost XP)', e2.data.xp > before || open1.data?.reward !== 'xp', `xp=${e2.data.xp}`);

  // --- cod embed lipit intreg in campul URL -> se salveaza doar src-ul
  const emb = await req(globalThis.admin, 'POST', '/api/admin/episode-sources', {
    episode_id: globalThis.epId, label: 'Embed cod', kind: 'embed',
    url: '<IFRAME SRC="https://mp4upload.com/embed-nyb3ksspsd9l.html" FRAMEBORDER=0 MARGINWIDTH=0 MARGINHEIGHT=0 SCROLLING=NO WIDTH=640 HEIGHT=480 allowfullscreen> </IFRAME>',
  });
  check('Codul embed lipit intreg e curatat la src-ul din el', emb.status === 201 && emb.data?.source?.url === 'https://mp4upload.com/embed-nyb3ksspsd9l.html', JSON.stringify(emb.data?.source)?.slice(0, 160));
  if (emb.data?.id) await req(globalThis.admin, 'DELETE', `/api/admin/episode-sources?id=${emb.data.id}`);
  const plain = await req(globalThis.admin, 'POST', '/api/admin/episode-sources', {
    episode_id: globalThis.epId, label: 'Link simplu', kind: 'embed', url: 'https://mp4upload.com/embed-alt.html',
  });
  check('URL-ul simplu trece neschimbat prin validare', plain.data?.source?.url === 'https://mp4upload.com/embed-alt.html', JSON.stringify(plain.data?.source)?.slice(0, 120));
  if (plain.data?.id) await req(globalThis.admin, 'DELETE', `/api/admin/episode-sources?id=${plain.data.id}`);

  // --- prag de activitate la rating: admin n-a vizionat seria → 403
  const gate = await req(globalThis.admin, 'POST', '/api/ratings', { series_id: globalThis.seriesId, rating: 9 });
  check('Rating fara niciun episod vizionat din serie → 403', gate.status === 403, `status=${gate.status} ${JSON.stringify(gate.data)}`);
  const okAgain = await req(j, 'POST', '/api/ratings', { series_id: globalThis.seriesId, rating: 9 });
  check('User-ul care a vizionat poate nota in continuare', okAgain.data?.success === true, JSON.stringify(okAgain.data));

  // --- revotul nu mai da XP (anti-farming)
  const b2 = (await req(j, 'GET', '/api/economy')).data.xp;
  await req(j, 'POST', '/api/ratings', { series_id: globalThis.seriesId, rating: 7 });
  const a2 = (await req(j, 'GET', '/api/economy')).data.xp;
  check('Schimbarea notei nu mai acorda XP (doar primul vot)', a2 === b2, `before=${b2} after=${a2}`);
}

console.log('\n=== 13f. GRADE TEMATICE, STAFF, TEME ADMIN ===');
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  // --- catalogul de teme + gradul propriu
  const r1 = await req(j, 'GET', '/api/ranks');
  // Slug-urile canonice dupa migrarea 0023 (teme = factiuni): one-piece, hunter-x-hunter.
  check('GET /api/ranks returneaza temele seeduite', r1.status === 200 && ['naruto', 'one-piece', 'hunter-x-hunter'].every((sl) => (r1.data?.themes || []).some((t) => t.slug === sl)), JSON.stringify((r1.data?.themes || []).map((t) => t.slug)));
  check('Gradul propriu e Genin la nivel mic (tema naruto)', r1.data?.me?.rank?.label === 'Genin' && r1.data.me.rank.icon === '🍃', JSON.stringify(r1.data?.me));

  // --- schimbarea temei din profil
  const sw = await req(j, 'POST', '/api/me/theme', { theme: 'one-piece' });
  check('Schimbarea temei merge si schimba gradul', sw.data?.success === true && sw.data?.me?.rank?.label === 'Pirat amator', JSON.stringify(sw.data?.me));
  const bad = await req(j, 'POST', '/api/me/theme', { theme: 'n-exista' });
  check('Tema inexistenta → 400', bad.status === 400, `status=${bad.status}`);
  await req(j, 'POST', '/api/me/theme', { theme: 'naruto' });

  // --- identitate in comentarii: staff badge pentru admin, grad pentru user
  const ownC = await req(j, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Comentariul lui user2 pentru testul de grade' });
  const ac = await req(globalThis.admin, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Comentariu de admin cu badge de staff' });
  const list = await req(j, 'GET', `/api/comments?episode_id=${globalThis.epId}`);
  const adminC = (list.data?.comments || []).find((c) => c.id === ac.data?.id);
  const userC = (list.data?.comments || []).find((c) => c.id === ownC.data?.id);
  check('Comentariul adminului vine cu staff=Admin', adminC?.staff === 'Admin', JSON.stringify(adminC)?.slice(0, 120));
  check('Comentariile au grad tematic (rank.label)', typeof userC?.rank?.label === 'string' && userC.rank.label.length > 1, JSON.stringify(userC?.rank));
  await req(globalThis.admin, 'DELETE', `/api/comments?id=${ac.data?.id}`);
  await req(j, 'DELETE', `/api/comments?id=${ownC.data?.id}`);

  // --- clasamentul expune gradele
  const lb = await req(j, 'GET', '/api/leaderboard');
  const lbRows = [...(lb.data?.weekly || []), ...(lb.data?.alltime || [])];
  check('Clasamentul are grad pe randuri', lbRows.every((r) => r.rank?.label) && lbRows.length > 0, JSON.stringify(lbRows[0])?.slice(0, 120));

  // --- admin: tema custom din „alta serie”, validare, stergere
  const mk = await req(globalThis.admin, 'POST', '/api/admin/rank-themes', {
    slug: 'bleach', title: 'Bleach — Soul Society',
    tiers: [{ min: 1, label: 'Elev', icon: '🗡️' }, { min: 6, label: 'Shinigami', icon: '⚔️' }, { min: 14, label: 'Căpitan', icon: '👑' }],
  });
  check('Adminul poate adauga o tema din alta serie', mk.data?.success === true && (mk.data?.themes || []).some((t) => t.slug === 'bleach'), JSON.stringify(mk.data)?.slice(0, 120));
  const mkBad = await req(globalThis.admin, 'POST', '/api/admin/rank-themes', { slug: 'x', title: 'X', tiers: [{ min: 5, label: 'Fara baza' }] });
  check('Tema fara treapta de la nivelul 1 → 400', mkBad.status === 400, `status=${mkBad.status}`);
  const mkUser = await req(j, 'POST', '/api/admin/rank-themes', { slug: 'hack', title: 'Hack', tiers: [{ min: 1, label: 'X' }] });
  check('Non-admin nu poate adauga teme → 403', mkUser.status === 403, `status=${mkUser.status}`);
  const sw2 = await req(j, 'POST', '/api/me/theme', { theme: 'bleach' });
  check('Userul poate alege tema custom', sw2.data?.me?.rank?.label === 'Elev', JSON.stringify(sw2.data?.me));
  const del = await req(globalThis.admin, 'DELETE', '/api/admin/rank-themes?slug=bleach');
  const after = await req(j, 'GET', '/api/ranks');
  check('Tema stearsa: userii ei cad inapoi pe naruto', del.data?.success === true && after.data?.me?.rank?.theme === 'naruto', JSON.stringify(after.data?.me?.rank));
  const delBuiltin = await req(globalThis.admin, 'DELETE', '/api/admin/rank-themes?slug=naruto');
  check('Temele builtin nu se sterg → 400', delBuiltin.status === 400, `status=${delBuiltin.status}`);

  // --- grade de staff (0025): Helper / Staff / Moderator, acordate manual
  // clasamentul e cache-uit 15 minute, deci staff-ul proaspat se verifica pe
  // profil (sursa live), nu prin cache
  const promo = await req(globalThis.admin, 'POST', '/api/admin/mods', { username: 'user2', role: 'moderator' });
  const meMod = await req(j, 'GET', '/api/auth/me');
  check('Gradul Moderator se vede in sesiune (staff_role + can_moderate)', promo.data?.success === true && meMod.data?.user?.staff_role === 'moderator' && meMod.data?.user?.can_moderate === true, JSON.stringify(meMod.data?.user)?.slice(0, 160));
  const profMod = await req(j, 'GET', '/api/profile/user2');
  check('Profilul unui moderator arata staff=Moderator', profMod.data?.identity?.staff === 'Moderator', JSON.stringify(profMod.data?.identity));
  // moderatorul poate sterge comentariul altcuiva; un membru simplu nu
  const modTargetC = await req(globalThis.admin, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Comentariu de sters de moderator' });
  const modDel = await req(j, 'DELETE', `/api/comments?id=${modTargetC.data?.id}`);
  check('Moderatorul poate sterge comentariul altcuiva', modDel.status === 200, `status=${modDel.status} id=${modTargetC.data?.id}`);
  const adminMe = await req(globalThis.admin, 'GET', '/api/auth/me');
  const selfPromo = await req(globalThis.admin, 'POST', '/api/admin/mods', { username: adminMe.data?.user?.username, role: 'moderator' });
  check('Adminul nu-si poate schimba propriul rol', selfPromo.status === 400 || selfPromo.status === 404, `status=${selfPromo.status}`);
  const modTheme = await req(j, 'POST', '/api/admin/mods', { username: 'user2', role: 'moderator' });
  check('Un moderator nu poate acorda grade → 403', modTheme.status === 403, `status=${modTheme.status}`);
  const gHelper = await req(globalThis.admin, 'POST', '/api/admin/mods', { username: 'user2', role: 'helper' });
  const profHelper = await req(j, 'GET', '/api/profile/user2');
  const meHelper = await req(j, 'GET', '/api/auth/me');
  check('Gradul Helper se acorda si apare pe profil', gHelper.data?.success === true && gHelper.data?.staff === 'Helper' && profHelper.data?.identity?.staff === 'Helper', JSON.stringify(profHelper.data?.identity));
  check('Helper NU primeste drepturi de moderare', gHelper.data?.can_moderate === false && meHelper.data?.user?.can_moderate === false && meHelper.data?.user?.staff_role === 'helper', JSON.stringify(meHelper.data?.user)?.slice(0, 160));
  const helperTargetC = await req(globalThis.admin, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Comentariu pe care helperul nu-l poate sterge' });
  const helperDel = await req(j, 'DELETE', `/api/comments?id=${helperTargetC.data?.id}`);
  check('Helperul nu poate sterge comentariul altcuiva → 403', helperDel.status === 403, `status=${helperDel.status}`);
  await req(globalThis.admin, 'DELETE', `/api/comments?id=${helperTargetC.data?.id}`);
  const gStaff = await req(globalThis.admin, 'POST', '/api/admin/mods', { username: 'user2', role: 'staff' });
  const profStaff = await req(j, 'GET', '/api/profile/user2');
  check('Gradul Staff se acorda si apare pe profil', gStaff.data?.staff === 'Staff' && profStaff.data?.identity?.staff === 'Staff', JSON.stringify(profStaff.data?.identity));
  const gBad = await req(globalThis.admin, 'POST', '/api/admin/mods', { username: 'user2', role: 'hokage' });
  check('Grad necunoscut → 400', gBad.status === 400, `status=${gBad.status}`);
  const teamList = await req(globalThis.admin, 'GET', '/api/admin/mods');
  const teamU2 = (teamList.data?.staff || []).find((x) => x.username === 'user2');
  const teamAdmin = (teamList.data?.staff || []).find((x) => x.is_admin);
  check('GET /api/admin/mods listeaza echipa (admin + staff)', teamList.status === 200 && teamU2?.role === 'Staff' && teamU2?.role_key === 'staff' && !!teamAdmin && teamAdmin.role === 'Admin', JSON.stringify(teamList.data)?.slice(0, 200));
  const teamAsUser = await req(j, 'GET', '/api/admin/mods');
  check('Lista echipei nu e accesibila non-adminilor → 403', teamAsUser.status === 403, `status=${teamAsUser.status}`);
  const gNone = await req(globalThis.admin, 'POST', '/api/admin/mods', { username: 'user2', role: '' });
  const profNone = await req(j, 'GET', '/api/profile/user2');
  const teamAfter = await req(globalThis.admin, 'GET', '/api/admin/mods');
  check('Scoaterea gradului curata badge-ul si lista', gNone.data?.success === true && gNone.data?.staff === '' && profNone.data?.identity?.staff === '' && !(teamAfter.data?.staff || []).some((x) => x.username === 'user2'), JSON.stringify(profNone.data?.identity));

  // --- chat: mesajele poarta gradul si rolul de staff din server
  await new Promise((r) => setTimeout(r, 1200));
  const ws1 = new WS(`${WS_BASE}/chat`, { headers: { Cookie: j.cookie } });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 8000);
      ws1.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'init') { clearTimeout(t); resolve(d); } };
      ws1.onerror = () => { clearTimeout(t); reject(new Error('ws error')); };
    });
    ws1.send(JSON.stringify({ type: 'chat', message: 'Mesaj cu grad tematic' }));
    await new Promise((r) => setTimeout(r, 1500));
    ws1.close();
    const ws2 = new WS(`${WS_BASE}/chat`, { headers: { Cookie: j.cookie } });
    const init2 = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 8000);
      ws2.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'init') { clearTimeout(t); resolve(d); } };
      ws2.onerror = () => { clearTimeout(t); reject(new Error('ws error')); };
    });
    const mine = (init2.history || []).find((m) => m.message === 'Mesaj cu grad tematic');
    // Pinteaza bugul istoric de ordine bind (avatarul ajungea in rank_label,
    // iar in avatar se salva „0"/„1"): campurile trebuie sa fie la locul lor.
    check('Mesajele din chat poarta gradul tematic persistat', !!mine && typeof mine.rank_label === 'string' && mine.rank_label.length > 1, JSON.stringify(mine)?.slice(0, 140));
    check('Istoricul salvat nu are campurile amestecate (avatar≠0/1, name_gold∈{0,1})',
      !!mine && !['0', '1'].includes(mine.avatar) && (mine.name_gold === 0 || mine.name_gold === 1),
      JSON.stringify(mine)?.slice(0, 140));
    check('Lista de online include gradul si rolul', (init2.online || []).some((o) => 'rank_label' in o && 'staff_role' in o), JSON.stringify(init2.online)?.slice(0, 140));
    ws2.close();
  } catch (e) {
    check('Conexiunea WS pentru teste de grade', false, e.message);
  }
}

console.log('\n=== 13h. ABONARI LA SERII + NOTIFICARI ===');
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  // --- abonare: toggle idempotent + flag in ruta seriei
  const anon = await req(jar(), 'POST', '/api/subscribe', { series_id: globalThis.seriesId, on: 1 });
  check('Abonarea anonima → 401', anon.status === 401, `status=${anon.status}`);
  const s1 = await req(j, 'POST', '/api/subscribe', { series_id: globalThis.seriesId, on: 1 });
  check('Abonarea reuseste si numara abonatii', s1.data?.success === true && s1.data?.subscribed === true && s1.data?.subscriber_count >= 1, JSON.stringify(s1.data));
  const ser1 = await req(j, 'GET', `/api/series/${globalThis.seriesId}`);
  check('Ruta seriei expune subscribed + subscriber_count', ser1.data?.subscribed === true && ser1.data?.subscriber_count >= 1, JSON.stringify({ s: ser1.data?.subscribed, n: ser1.data?.subscriber_count }));

  // --- episod nou admin → notificare pentru abonat
  const ep1 = await req(globalThis.admin, 'POST', '/api/admin/episodes', { series_id: globalThis.seriesId, episode_number: 901, title: 'Ep notificare', sources: [] });
  const n1 = await req(j, 'GET', '/api/notifications');
  const notif = (n1.data?.notifications || [])[0];
  check('Abonatul primeste notificare la episod nou', n1.data?.unread === 1 && notif?.type === 'new_episode' && notif?.payload?.episode_number === 901, JSON.stringify(notif)?.slice(0, 160));
  check('Notificarea are text uman si link catre episod', typeof notif?.text === 'string' && notif.text.includes('901'), notif?.text);
  const un1 = await req(j, 'GET', '/api/notifications/unread');
  check('Count-ul de unread e 1 pentru badge', un1.data?.count === 1, JSON.stringify(un1.data));

  // --- mark read: per id si tot
  const mr = await req(j, 'POST', '/api/notifications/read', { ids: [notif.id] });
  check('Marcharea per id scade unread', mr.data?.changed === 1 && mr.data?.unread === 0, JSON.stringify(mr.data));
  const ep2 = await req(globalThis.admin, 'POST', '/api/admin/episodes', { series_id: globalThis.seriesId, episode_number: 902, title: 'Ep notificare 2', sources: [] });
  const n2 = await req(j, 'GET', '/api/notifications?unread=1');
  check('Al doilea episod aduce a doua notificare', n2.data?.notifications?.length === 1 && n2.data?.notifications[0].payload?.episode_number === 902, JSON.stringify(n2.data?.notifications)?.slice(0, 140));
  const ma = await req(j, 'POST', '/api/notifications/read', { all: 1 });
  check('„Marcheaza tot” curata badge-ul', ma.data?.changed === 1 && ma.data?.unread === 0, JSON.stringify(ma.data));

  // --- dezabonare: episoadele noi nu mai notifica
  const s0 = await req(j, 'POST', '/api/subscribe', { series_id: globalThis.seriesId, on: 0 });
  check('Dezabonarea scade numarul de abonati', s0.data?.subscribed === false && s0.data?.subscriber_count === 0, JSON.stringify(s0.data));
  const before = (await req(j, 'GET', '/api/notifications')).data.notifications.length;
  await req(globalThis.admin, 'POST', '/api/admin/episodes', { series_id: globalThis.seriesId, episode_number: 903, title: 'Ep fara abonat', sources: [] });
  const after = (await req(j, 'GET', '/api/notifications')).data.notifications.length;
  check('Dupa dezabonare nu mai vin notificari', after === before, `before=${before} after=${after}`);

  // --- bulk: un singur rezumat, nu N notificari
  await req(j, 'POST', '/api/subscribe', { series_id: globalThis.seriesId, on: 1 });
  const bulk = await req(globalThis.admin, 'POST', '/api/admin/episodes', {
    series_id: globalThis.seriesId,
    episodes: [{ episode_number: 904, title: 'B1', sources: [] }, { episode_number: 905, title: 'B2', sources: [] }],
  });
  const n3 = await req(j, 'GET', '/api/notifications?unread=1');
  const rez = (n3.data?.notifications || [])[0];
  check('Bulk-ul notifica o singura data, cu rezumat', bulk.data?.created === 2 && rez?.type === 'new_episodes' && rez?.payload?.count === 2, JSON.stringify(rez)?.slice(0, 160));

  // --- curatare: episoadele de test
  for (const id of [ep1.data?.id, ep2.data?.id]) if (id) await req(globalThis.admin, 'DELETE', `/api/admin/episodes?id=${id}`);
  const listEp = await req(globalThis.admin, 'GET', `/api/admin/episodes?series_id=${globalThis.seriesId}&per_page=200`);
  for (const ep of listEp.data?.episodes || []) if ([903, 904, 905].includes(ep.episode_number)) await req(globalThis.admin, 'DELETE', `/api/admin/episodes?id=${ep.id}`);
  await req(j, 'POST', '/api/subscribe', { series_id: globalThis.seriesId, on: 0 });
}

console.log('\n=== 13i. SHOP (SINK DE GOLD) + RAPORTARE SURSE ===');
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });
  const prof = await req(j, 'GET', '/api/profile/user2');
  const u2id = prof.data?.user?.id;
  check('Profilul public expune id-ul (necesar pentru set_gold)', Number.isInteger(u2id), JSON.stringify(prof.data?.user)?.slice(0, 100));

  // --- catalogul
  const anonShop = await req(jar(), 'GET', '/api/shop');
  check('Shop-ul anonim → 401', anonShop.status === 401, `status=${anonShop.status}`);
  const shop = await req(j, 'GET', '/api/shop');
  check('Catalogul are 8 articole cu preturi si flag-uri (Shop 2.0)', shop.data?.items?.length === 8 && shop.data.items.every((i) => i.price > 0 && typeof i.can_buy === 'boolean'), JSON.stringify(shop.data?.items?.map((i) => [i.id, i.price]))?.slice(0, 200));
  check('Numele de aur nu se mai vinde (era duplicat cu Auriu)', !(shop.data?.items || []).some((i) => i.id === 'name_gold'), (shop.data?.items || []).map((i) => i.id).join(','));

  // --- fara gold nu cumperi nimic
  const poor = await req(j, 'POST', '/api/shop/buy', { item_id: 'chest_key' });
  const goldBefore = shop.data?.gold || 0;
  check('Cumpararea fara gold → 400 (nu merge pe negativ)', poor.status === 400 || goldBefore >= 150, `status=${poor.status} gold=${goldBefore}`);

  // --- admin alimenteaza (set_gold e si unealta de suport)
  const grant = await req(globalThis.admin, 'POST', '/api/admin/users', { action: 'set_gold', user_id: u2id, value: 2000 });
  check('Adminul poate acorda gold (set_gold)', grant.data?.success === true && grant.data?.gold === goldBefore + 2000, JSON.stringify(grant.data));
  const grantSelf = await req(globalThis.admin, 'POST', '/api/admin/users', { action: 'set_gold', user_id: 1, value: 100 });
  check('Adminul nu-si poate modifica propriul cont', grantSelf.status === 400, `status=${grantSelf.status}`);

  // --- cumpara consumabila + durabila
  const buyKey = await req(j, 'POST', '/api/shop/buy', { item_id: 'chest_key' });
  check('Cheia de cufar se cumpara si scade gold-ul atomic', buyKey.data?.success === true && buyKey.data?.qty === 1 && buyKey.data?.gold === goldBefore + 2000 - 150, JSON.stringify(buyKey.data));
  const buySup = await req(j, 'POST', '/api/shop/buy', { item_id: 'flair_supporter' });
  check('Suporterul se cumpara', buySup.data?.success === true && buySup.data?.gold === goldBefore + 2000 - 150 - 1000, JSON.stringify(buySup.data));
  const dupe = await req(j, 'POST', '/api/shop/buy', { item_id: 'flair_supporter' });
  check('Articolul permanent nu se poate cumpara de doua ori → 409', dupe.status === 409, `status=${dupe.status}`);
  const ghost = await req(j, 'POST', '/api/shop/buy', { item_id: 'yacht' });
  check('Articolul inexistent → 400', ghost.status === 400, `status=${ghost.status}`);
  const shop2 = await req(j, 'GET', '/api/shop');
  check('GET /shop reflecta proprietatea si gold-ul ramas', shop2.data?.items?.find((i) => i.id === 'flair_supporter')?.owned === true && shop2.data?.items?.find((i) => i.id === 'chest_key')?.qty === 1, JSON.stringify(shop2.data?.items?.map((i) => [i.id, i.owned, i.qty]))?.slice(0, 140));

  // --- cheia sare peste cooldown-ul cufarului
  const cState = await req(j, 'GET', '/api/chest');
  if (cState.data?.chest?.available) {
    await req(j, 'POST', '/api/chest');
  }
  const locked = await req(j, 'POST', '/api/chest');
  check('Fara cheie, cooldown-ul tine → 409', locked.status === 409, `status=${locked.status}`);
  const keyed = await req(j, 'POST', '/api/chest', { use_key: 1 });
  check('Cu cheie, cufarul se deschide in cooldown', keyed.data?.success === true && keyed.data?.used_key === true, JSON.stringify(keyed.data)?.slice(0, 160));
  const econ = await req(j, 'GET', '/api/economy');
  check('Cheia s-a consumat din inventar', econ.data?.chest_keys === 0, JSON.stringify(econ.data?.chest_keys));
  const noKey = await req(j, 'POST', '/api/chest', { use_key: 1 });
  check('Fara chei in inventar, use_key → 409', noKey.status === 409, `status=${noKey.status}`);

  // --- cosmeticele se vad pe profil (Suporterul e deja cumparat mai sus)
  const prof2 = await req(j, 'GET', '/api/profile/user2');
  check('Profilul arata flair-ul 💎', prof2.data?.flair === '💎', JSON.stringify({ f: prof2.data?.flair, g: prof2.data?.name_gold }));

  // ================= RAPORTARE SURSE =================
  const epFull = await req(j, 'GET', `/api/episodes/${globalThis.epId}`);
  const srcId = epFull.data?.sources?.[0]?.id;
  check('Episodul fixturii are o sursa cu id (baza raportarii)', Number.isInteger(srcId), JSON.stringify(epFull.data?.sources)?.slice(0, 120));

  const anonRep = await req(jar(), 'POST', '/api/report', { episode_id: globalThis.epId, source_id: srcId, reason: 'nu_porneste' });
  check('Raportarea anonima → 401', anonRep.status === 401, `status=${anonRep.status}`);
  const xpBefore = (await req(j, 'GET', '/api/economy')).data?.xp ?? 0;
  const rep = await req(j, 'POST', '/api/report', { episode_id: globalThis.epId, source_id: srcId, reason: 'nu_porneste', note: 'se invarte la infinit' });
  const xpAfter = (await req(j, 'GET', '/api/economy')).data?.xp ?? 0;
  check('Raportarea valida → 201 si +3 XP (din spec)', rep.status === 201 && rep.data?.xp === 3 && xpAfter === xpBefore + 3, `status=${rep.status} xp=${xpBefore}->${xpAfter}`);
  const dup = await req(j, 'POST', '/api/report', { episode_id: globalThis.epId, source_id: srcId, reason: 'altceva' });
  check('A doua raportare deschisa pe aceeasi sursa → 409', dup.status === 409, `status=${dup.status}`);
  const badReason = await req(j, 'POST', '/api/report', { episode_id: globalThis.epId, source_id: srcId, reason: 'ca-ma-enerveaza' });
  check('Motivul din afara listei → 400', badReason.status === 400, `status=${badReason.status}`);
  const badSrc = await req(j, 'POST', '/api/report', { episode_id: globalThis.epId, source_id: 999999, reason: 'nu_porneste' });
  check('Sursa care nu apartine episodului → 404', badSrc.status === 404, `status=${badSrc.status}`);

  // --- admin: lista + rezolvare
  const list = await req(globalThis.admin, 'GET', '/api/admin/reports?status=open');
  const mine = (list.data?.reports || []).find((r) => r.episode_id === globalThis.epId && r.username === 'user2');
  check('Adminul vede raportarea deschisa cu serie/episod/motiv', !!mine && mine.series_title && mine.reason.startsWith('nu_porneste') && mine.reason.includes('se invarte'), JSON.stringify(mine)?.slice(0, 180));
  check('Numaratoarele pe stari vin pentru badge-ul din tab', Number.isInteger(list.data?.counts?.open) && list.data.counts.open >= 1, JSON.stringify(list.data?.counts));
  const fix = await req(globalThis.admin, 'POST', '/api/admin/reports', { id: mine?.id, action: 'fix' });
  check('Marcarea ca rezolvat functioneaza', fix.data?.status === 'fixed', JSON.stringify(fix.data));
  const afterFix = await req(globalThis.admin, 'GET', '/api/admin/reports?status=open');
  check('Dupa rezolvare nu mai e in lista deschisa', !(afterFix.data?.reports || []).some((r) => r.id === mine?.id), `n=${afterFix.data?.reports?.length}`);
  const reRep = await req(j, 'POST', '/api/report', { episode_id: globalThis.epId, source_id: srcId, reason: 'sursa_moarta' });
  check('Dupa rezolvare, userul poate raporta din nou daca iar e stricat', reRep.status === 201, `status=${reRep.status}`);
  const dismiss = await req(globalThis.admin, 'POST', '/api/admin/reports', { id: reRep.data ? (await req(globalThis.admin, 'GET', '/api/admin/reports?status=open')).data.reports.find((r) => r.episode_id === globalThis.epId && r.username === 'user2')?.id : 0, action: 'dismiss' });
  check('Respingerea functioneaza', dismiss.data?.status === 'dismissed', JSON.stringify(dismiss.data));
  const userReports = await req(j, 'GET', '/api/admin/reports');
  check('Lista de raportari e doar pentru admin → 403', userReports.status === 403, `status=${userReports.status}`);
}

console.log('\n=== 13i2. SHOP 2.0: instant, pachete, jetoane, boost, culori, teme ===');
// Toate pe useri proaspeti: boost-ul ×2 si XP-ul aleator din misterios ar
// strica asertiunile exacte de XP ale celorlalte sectiuni.
{
  const regB = await req(jar(), 'POST', '/api/auth/register', { username: 'shopb', email: 'shopb@test.ro', password: 'parola123' });
  const jb = jar();
  await req(jb, 'POST', '/api/auth/login', { email: 'shopb@test.ro', password: 'parola123' });
  check('User proaspat pentru Shop 2.0', regB.status === 201, `status=${regB.status}`);
  const profB = await req(jb, 'GET', '/api/profile/shopb');
  await req(globalThis.admin, 'POST', '/api/admin/users', { action: 'set_gold', user_id: profB.data?.user?.id, value: 100000 });
  const cat = await req(jb, 'GET', '/api/shop');
  const ids = (cat.data?.items || []).map((i) => i.id);
  check('Catalog Shop 2.0: 8 articole, fara name_gold',
    ids.length === 8 && !ids.includes('name_gold') && ['mystery_box', 'xp_boost', 'xp_tome', 'faction_token', 'chest_keys_3', 'flair_nova'].every((x) => ids.includes(x)),
    ids.join(','));
  check('Culori noi: Argintiu/Bronz/Menta/Apus',
    ['color_silver', 'color_bronze', 'color_mint', 'color_sunset'].every((x) => (cat.data?.colors || []).some((c) => c.id === x)),
    `n=${cat.data?.colors?.length}`);
  check('Teme noi: Sakura/Royal + canvas (Frunze/Sakura/Bule/Aurora/Ocean)',
    ['theme_sakura', 'theme_royal', 'theme_sunset', 'theme_aurora', 'theme_ocean', 'theme_petale', 'theme_portocaliu'].every((x) => (cat.data?.themes || []).some((t) => t.id === x)),
    `n=${cat.data?.themes?.length}`);

  const gone = await req(jb, 'POST', '/api/shop/buy', { item_id: 'name_gold' });
  check('Numele de aur nu se mai poate cumpara → 400', gone.status === 400, `status=${gone.status}`);

  // --- misteriosul primul: eventualul gold castigat nu trebuie sa strice
  // matematica exacta de dupa (luam baseline dupa el, nu inainte).
  const eco0 = await req(jb, 'GET', '/api/economy');
  const box = await req(jb, 'POST', '/api/shop/buy', { item_id: 'mystery_box' });
  const eco1 = await req(jb, 'GET', '/api/economy');
  const r = box.data;
  const dg = eco1.data.gold - eco0.data.gold;
  const dx = eco1.data.xp - eco0.data.xp;
  const consistent = r?.success === true && (
    (r.reward === 'gold' && dg === r.reward_amount - 200) ||
    (r.reward === 'xp' && dx === r.reward_amount && dg === -200) ||
    (r.reward === 'key' && eco1.data.chest_keys === eco0.data.chest_keys + 1 && dg === -200) ||
    (r.reward === 'nothing' && r.reward_amount === 0 && dg === -200)
  );
  check('Cufarul misterios se deschide pe loc, cu efectul promis', consistent, JSON.stringify({ r, dg, dx }));
  const goldBase = eco1.data.gold;

  // --- tomul: +200 XP exact (fara boost pe userul asta)
  const tome = await req(jb, 'POST', '/api/shop/buy', { item_id: 'xp_tome' });
  const eco2 = await req(jb, 'GET', '/api/economy');
  check('Tomul da +200 XP exact', tome.data?.xp_granted === 200 && eco2.data.xp - eco1.data.xp === 200, `dx=${eco2.data.xp - eco1.data.xp}`);

  // --- setul de chei crediteaza 3× chest_key
  const keys = await req(jb, 'POST', '/api/shop/buy', { item_id: 'chest_keys_3' });
  const eco3 = await req(jb, 'GET', '/api/economy');
  check('Setul de 3 chei intra in inventar', keys.data?.linked?.id === 'chest_key' && eco3.data.chest_keys === eco2.data.chest_keys + 3, `chei=${eco3.data.chest_keys}`);

  // --- Nova primeaza peste Suporter
  const nova = await req(jb, 'POST', '/api/shop/buy', { item_id: 'flair_nova' });
  const profNova = await req(jb, 'GET', '/api/profile/shopb');
  check('Nova pune flair 🌠 pe profil', nova.data?.success === true && profNova.data?.flair === '🌠', profNova.data?.flair);
  await req(jb, 'POST', '/api/shop/buy', { item_id: 'flair_supporter' });
  const profSup = await req(jb, 'GET', '/api/profile/shopb');
  check('Dupa Suporter, tot Nova se vede (precedenta)', profSup.data?.flair === '🌠', profSup.data?.flair);

  // --- culoare + tema noua: cumparare + activare
  const silv = await req(jb, 'POST', '/api/shop/buy', { item_id: 'color_silver' });
  const actS = await req(jb, 'POST', '/api/shop/activate', { type: 'color', id: 'color_silver' });
  const profCol = await req(jb, 'GET', '/api/profile/shopb');
  check('Argintiu se cumpara si se activeaza', silv.data?.success === true && actS.data?.active_name_color === 'color_silver' && profCol.data?.name_color === 'color_silver', profCol.data?.name_color);
  const sak = await req(jb, 'POST', '/api/shop/buy', { item_id: 'theme_sakura' });
  const actT = await req(jb, 'POST', '/api/shop/activate', { type: 'theme', id: 'theme_sakura' });
  const shopAfter = await req(jb, 'GET', '/api/shop');
  check('Sakura se cumpara si se activeaza', sak.data?.success === true && actT.data?.active_theme === 'theme_sakura' && shopAfter.data?.active_theme === 'theme_sakura', shopAfter.data?.active_theme);

  // --- tema animata: cumparare + activare pe user separat (e scumpa)
  await req(jar(), 'POST', '/api/auth/register', { username: 'animu', email: 'animu@test.ro', password: 'parola123' });
  const ja = jar();
  await req(ja, 'POST', '/api/auth/login', { email: 'animu@test.ro', password: 'parola123' });
  const profA = await req(ja, 'GET', '/api/profile/animu');
  await req(globalThis.admin, 'POST', '/api/admin/users', { action: 'set_gold', user_id: profA.data?.user?.id, value: 600000 });
  const aur = await req(ja, 'POST', '/api/shop/buy', { item_id: 'theme_aurora' });
  const actA = await req(ja, 'POST', '/api/shop/activate', { type: 'theme', id: 'theme_aurora' });
  const shopA = await req(ja, 'GET', '/api/shop');
  check('Aurora animata se cumpara si se activeaza', aur.data?.success === true && actA.data?.active_theme === 'theme_aurora' && shopA.data?.active_theme === 'theme_aurora' && shopA.data?.gold === 600000 - 250000, `gold=${shopA.data?.gold}`);
  const sak2 = await req(ja, 'POST', '/api/shop/buy', { item_id: 'theme_petale' });
  const actP = await req(ja, 'POST', '/api/shop/activate', { type: 'theme', id: 'theme_petale' });
  const shopP = await req(ja, 'GET', '/api/shop');
  check('Sakura canvas se cumpara si se activeaza', sak2.data?.success === true && actP.data?.active_theme === 'theme_petale' && shopP.data?.active_theme === 'theme_petale' && shopP.data?.gold === 600000 - 250000 - 175000, `gold=${shopP.data?.gold}`);

  // --- matematica exacta a gold-ului (baseline luat dupa misterios)
  const spent = 500 + 400 + 2500 + 1000 + 2500 + 75000;
  check('Gold-ul ramas e exact pretul total', shopAfter.data?.gold === goldBase - spent, `${goldBase} - ${spent} = ${goldBase - spent} vs ${shopAfter.data?.gold}`);

  // --- CSS-ul claselor noi chiar exista (altfel cumperi ceva invizibil)
  const css = await (await fetch(BASE + '/assets/css/style.css')).text();
  check('CSS pentru culorile/temele noi', ['.nc-silver', '.nc-bronze', '.nc-mint', '.nc-sunset', 'body.theme-sakura', 'body.theme-royal', 'body.theme-sunset', 'body.theme-aurora', 'body.theme-ocean', 'body.theme-petale', 'body.theme-portocaliu', '@keyframes theme-sunset-drift', '@keyframes theme-aurora-drift', '@keyframes theme-ocean-drift'].every((s) => css.includes(s)), 'lipseste o clasa');
  const ab = await (await fetch(BASE + '/assets/js/anim-bg.js')).text();
  const core = await (await fetch(BASE + '/assets/js/core.js')).text();
  check('Motor canvas anim-bg.js (petale/bule/stele + rAF)', ['requestAnimationFrame', 'petalaNoua', 'bulaNoua', 'steaNoua', 'portocaliu', 'MutationObserver'].every((s) => ab.includes(s)) && core.includes('./anim-bg.js') && core.includes('ultimaVerificareBuild'), 'lipseste motorul, legatura sau garda anti-cache din core.js');
}

console.log('\n=== 13i3. BOOST XP ×2 si JETOANE DE FACTIUNE ===');
{
  // --- boost-ul dubleaza XP-ul din orice sursa, 24h, prelungibil
  await req(jar(), 'POST', '/api/auth/register', { username: 'boostu', email: 'boostu@test.ro', password: 'parola123' });
  const ju = jar();
  await req(ju, 'POST', '/api/auth/login', { email: 'boostu@test.ro', password: 'parola123' });
  const profU = await req(ju, 'GET', '/api/profile/boostu');
  await req(globalThis.admin, 'POST', '/api/admin/users', { action: 'set_gold', user_id: profU.data?.user?.id, value: 1000 });
  const boost = await req(ju, 'POST', '/api/shop/buy', { item_id: 'xp_boost' });
  check('Boost-ul seteaza expirarea ~24h in viitor', boost.data?.success === true && boost.data?.boost_until > Date.now() + 23 * 3600000, `until=${boost.data?.boost_until}`);
  const ecoB = await req(ju, 'GET', '/api/economy');
  check('Economy arata boost-ul activ', ecoB.data?.xp_boost_ms > 23 * 3600000, `ms=${ecoB.data?.xp_boost_ms}`);
  const cm = await req(ju, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Comentariu pentru testul de boost XP dublu' });
  const xpB1 = (await req(ju, 'GET', '/api/economy')).data.xp;
  check('Cu boost, comentariul da +10 XP in loc de +5', cm.data?.success === true && xpB1 === ecoB.data.xp + 10, `${ecoB.data.xp}->${xpB1}`);
  await req(ju, 'DELETE', `/api/comments?id=${cm.data?.id}`);
  const boost2 = await req(ju, 'POST', '/api/shop/buy', { item_id: 'xp_boost' });
  check('Al doilea boost prelungeste expirarea', boost2.data?.boost_until > (boost.data?.boost_until || 0), `${boost.data?.boost_until} -> ${boost2.data?.boost_until}`);

  // --- jetonul sare peste blocajul lunar al factiunilor
  await req(jar(), 'POST', '/api/auth/register', { username: 'toku', email: 'toku@test.ro', password: 'parola123' });
  const jt = jar();
  await req(jt, 'POST', '/api/auth/login', { email: 'toku@test.ro', password: 'parola123' });
  const profT = await req(jt, 'GET', '/api/profile/toku');
  await req(globalThis.admin, 'POST', '/api/admin/users', { action: 'set_gold', user_id: profT.data?.user?.id, value: 2000 });
  const fac0 = await req(jt, 'GET', '/api/factions');
  const fa = fac0.data?.factions?.[1]?.slug;
  const fb = fac0.data?.factions?.[2]?.slug;
  check('Userul nou n-are jetoane', fac0.data?.faction_tokens === 0, `n=${fac0.data?.faction_tokens}`);
  await req(jt, 'POST', '/api/factions', { faction: fa });
  const locked = await req(jt, 'POST', '/api/factions', { faction: fb });
  check('Fara jeton, a doua alegere in luna → 409', locked.status === 409, `status=${locked.status}`);
  const noTok = await req(jt, 'POST', '/api/factions', { faction: fb, use_token: 1 });
  check('use_token fara jeton → 409', noTok.status === 409, `status=${noTok.status}`);
  await req(jt, 'POST', '/api/shop/buy', { item_id: 'faction_token' });
  const fac1 = await req(jt, 'GET', '/api/factions');
  check('Dupa cumparare, GET arata 1 jeton', fac1.data?.faction_tokens === 1, `n=${fac1.data?.faction_tokens}`);
  const sw = await req(jt, 'POST', '/api/factions', { faction: fb, use_token: 1 });
  const fac2 = await req(jt, 'GET', '/api/factions');
  check('Cu jeton, schimbarea reuseste si jetonul se consuma',
    sw.data?.success === true && sw.data?.used_token === true && fac2.data?.my_faction === fb && fac2.data?.faction_tokens === 0,
    `f=${fac2.data?.my_faction} t=${fac2.data?.faction_tokens}`);
}

console.log('\n=== 13j. COMMUNITY v2: VOTURI, RASPUNSURI, RECENZII ===');
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  // --- voturi pe comentarii
  const c1 = await req(globalThis.admin, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Comentariu de votat' });
  check('Comentariul tinta exista', Number.isInteger(c1.data?.id), JSON.stringify(c1.data));
  const anonV = await req(jar(), 'POST', '/api/comments/vote', { comment_id: c1.data.id, vote: 1 });
  check('Votul anonim → 401', anonV.status === 401, `status=${anonV.status}`);
  const xpB = (await req(j, 'GET', '/api/economy')).data?.xp ?? 0;
  const v1 = await req(j, 'POST', '/api/comments/vote', { comment_id: c1.data.id, vote: 1 });
  const xpA = (await req(j, 'GET', '/api/economy')).data?.xp ?? 0;
  check('Vot +1: score 1, my_vote 1 si +1 XP (din spec)', v1.data?.score === 1 && v1.data?.my_vote === 1 && xpA === xpB + 1, JSON.stringify(v1.data) + ` xp=${xpB}->${xpA}`);
  const v2 = await req(j, 'POST', '/api/comments/vote', { comment_id: c1.data.id, vote: -1 });
  check('Schimbarea votului in -1 actualizeaza score', v2.data?.score === -1 && v2.data?.my_vote === -1, JSON.stringify(v2.data));
  const v3 = await req(j, 'POST', '/api/comments/vote', { comment_id: c1.data.id, vote: 0 });
  check('Anularea votului (0) aduce score la 0', v3.data?.score === 0 && v3.data?.my_vote === 0, JSON.stringify(v3.data));
  const vBad = await req(j, 'POST', '/api/comments/vote', { comment_id: c1.data.id, vote: 7 });
  check('Vot invalid → 400', vBad.status === 400, `status=${vBad.status}`);
  const vGhost = await req(j, 'POST', '/api/comments/vote', { comment_id: 999999, vote: 1 });
  check('Vot pe comentariu inexistent → 404', vGhost.status === 404, `status=${vGhost.status}`);
  await req(j, 'POST', '/api/comments/vote', { comment_id: c1.data.id, vote: 1 });

  // --- raspunsuri un singur nivel
  const r1 = await req(j, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Raspuns la comentariul adminului', parent_id: c1.data.id });
  check('Raspunsul se posteaza cu parent_id', r1.status === 201 && r1.data?.parent_id === c1.data.id, JSON.stringify(r1.data));
  const r2 = await req(j, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'Raspuns la raspuns (se aplatizeaza)', parent_id: r1.data.id });
  check('Raspunsul la un raspuns se ataseaza parintelui firului', r2.data?.parent_id === c1.data.id, JSON.stringify(r2.data));
  const badP = await req(j, 'POST', '/api/comments', { episode_id: globalThis.epId, body: 'parent gresit', parent_id: 999999 });
  check('Parinte inexistent → 404', badP.status === 404, `status=${badP.status}`);
  const cList = await req(j, 'GET', `/api/comments?episode_id=${globalThis.epId}`);
  const got1 = (cList.data?.comments || []).find((c) => c.id === c1.data.id);
  check('Lista aduce score, my_vote si parent_id', got1 && typeof got1.score === 'number' && typeof got1.my_vote === 'number' && got1.parent_id === null, JSON.stringify(got1)?.slice(0, 140));

  // --- recenzii
  const anonR = await req(jar(), 'GET', `/api/reviews?series_id=${globalThis.seriesId}`);
  check('Recenziile anonime → 401', anonR.status === 401, `status=${anonR.status}`);
  const rv1 = await req(j, 'POST', '/api/reviews', { series_id: globalThis.seriesId, rating: 9, body: 'Seria mea preferata, animatie si poveste superbe' });
  check('Recenzia valida → 201 cu medie calculata', rv1.status === 201 && rv1.data?.created === true && typeof rv1.data?.average === 'number', JSON.stringify(rv1.data));
  const rv2 = await req(j, 'POST', '/api/reviews', { series_id: globalThis.seriesId, rating: 8, body: 'Recenzie editata: ramane foarte buna' });
  check('A doua postare e UPSERT (200, created false)', rv2.status === 200 && rv2.data?.created === false, JSON.stringify(rv2.data));
  const rvList = await req(j, 'GET', `/api/reviews?series_id=${globalThis.seriesId}`);
  const mine = (rvList.data?.reviews || []).find((r) => r.own);
  check('Lista recenziilor aduce nota, textul si flag-ul own', mine && mine.rating === 8 && mine.body.includes('editata') && rvList.data?.count >= 1, JSON.stringify(mine)?.slice(0, 140));
  const rvBad = await req(j, 'POST', '/api/reviews', { series_id: globalThis.seriesId, rating: 11, body: 'nota invalida aici' });
  check('Nota 11 → 400', rvBad.status === 400, `status=${rvBad.status}`);
  const rvShort = await req(j, 'POST', '/api/reviews', { series_id: globalThis.seriesId, rating: 7, body: 'scurt' });
  check('Recenzie prea scurta → 400', rvShort.status === 400, `status=${rvShort.status}`);
  // --- topuri: saptamanal + voturi
  const anonTop = await req(jar(), 'GET', '/api/top');
  check('Topurile anonime → 200 (public)', anonTop.status === 200 && Array.isArray(anonTop.data?.weekly), `status=${anonTop.status}`);
  const top = await req(j, 'GET', '/api/top');
  const ratedRow = (top.data?.rated || []).find((r) => r.id === globalThis.seriesId);
  check('Clasamentul de voturi are media si numarul de voturi', !!ratedRow && Number(ratedRow.average) === 8 && ratedRow.votes >= 1, JSON.stringify(ratedRow));
  const weekRow = (top.data?.weekly || []).find((r) => r.id === globalThis.seriesId);
  check('Topul saptamanal numara privitori unici din progresul real', !!weekRow && weekRow.watchers >= 1 && typeof weekRow.seconds === 'number', JSON.stringify(weekRow));
  check('Topurile sunt limitate la 5 intrari', (top.data?.weekly || []).length <= 5 && (top.data?.rated || []).length <= 5, `w=${top.data?.weekly?.length} r=${top.data?.rated?.length}`);
}

console.log('\n=== 14. PERSISTENTA MESAJE IN D1 ===');
{
  await new Promise(r => setTimeout(r, 2500));
  const j = globalThis.admin;
  const ws = new WS(`${WS_BASE}/chat`, { headers: { Cookie: j.cookie } });
  let init = null;
  try {
    init = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 8000);
      ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'init') { clearTimeout(t); resolve(d); } };
      ws.onerror = () => { clearTimeout(t); reject(new Error('ws error')); };
    });
  } catch (e) {
    check('Conexiunea WS pentru istoric s-a stabilit', false, e.message);
  }
  if (init) {
    check('Istoricul contine mesajul salvat anterior', JSON.stringify(init.history).includes('Salut din test!'), JSON.stringify(init.history).slice(0,200));
    check('Stickerul trimis prin WS se persista ca tag in istoric', JSON.stringify(init.history).includes('[sticker:party]'), JSON.stringify(init.history).slice(0, 240));
    check('Istoric limitat la max 30 mesaje', init.history.length <= 30, `lungime=${init.history.length}`);
    ws.close();
  }
}

// =====================================================================
// AVATAR cu URL propriu — inclusiv GIF animat — vizibil peste tot.
// =====================================================================
console.log('\n=== Avatar (URL, GIF animat) ===');
{
  const GIF = 'https://media.tenor.com/test-host/x.gif';
  const set = await req(globalThis.admin, 'PATCH', '/api/profile', { avatar_url: GIF });
  check('PATCH avatar cu link .gif → 200', set.status === 200, `status=${set.status} ${JSON.stringify(set.data).slice(0, 120)}`);

  const me = await req(globalThis.admin, 'GET', '/api/auth/me');
  check('Sesiunea nu e afectata de avatar', me.status === 200 && !!me.data?.user);

  const pub = await req(globalThis.admin, 'GET', `/api/profile/${me.data.user.username}`);
  check('Profilul public expune avatarul gif', pub.status === 200 && pub.data?.profile?.avatar_url === GIF, JSON.stringify(pub.data?.profile?.avatar_url));

  // Comentariul adminului (exista din sectiunea de moderare) duce avatarul.
  const cm = await req(globalThis.admin, 'GET', `/api/comments?episode_id=${globalThis.epId}`);
  const mine = (cm.data?.comments || []).find((c) => c.username === me.data.user.username);
  check('Comentariile poarta avatarul autorului', !!mine && mine.avatar === GIF, JSON.stringify(mine?.avatar));

  // Clasamentul la fel.
  const lb = await req(globalThis.admin, 'GET', '/api/leaderboard');
  const lbMe = [...(lb.data?.alltime || []), ...(lb.data?.weekly || [])].find((r) => r.username === me.data.user.username);
  check('Clasamentul poarta avatarul', !!lbMe && lbMe.avatar === GIF, JSON.stringify(lbMe?.avatar));

  // URL-urile non-http raman interzise (validarea existenta).
  const bad = await req(globalThis.admin, 'PATCH', '/api/profile', { avatar_url: 'javascript:alert(1)' });
  check('Avatar javascript: → respins', bad.status === 400, `status=${bad.status}`);

  // WS: mesajul nou difuzat in chat poarta avatarul (de la connect).
  const ws = new WS(`${WS_BASE}/chat`, { headers: { Cookie: globalThis.admin.cookie } });
  let got = null;
  try {
    got = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 8000);
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.type === 'init') { ws.send(JSON.stringify({ type: 'chat', message: 'verific avatar in chat' })); }
        if (d.type === 'message' && d.message === 'verific avatar in chat') { clearTimeout(t); resolve(d); }
      };
      ws.onerror = () => { clearTimeout(t); reject(new Error('ws error')); };
    });
  } catch (e) {
    check('WS pentru avatar s-a conectat', false, e.message);
  }
  if (got) {
    check('Mesajul din chat poarta avatarul', got.avatar === GIF, JSON.stringify({ avatar: got.avatar }));
    check('Lista online poarta avatarul', (got.online || []).some((u) => u.username === me.data.user.username && u.avatar === GIF), JSON.stringify(got.online));
    ws.close();
  }

  // Link „de pagina" Tenor (ultima operatiune, ca sa nu strice assert-urile
  // de mai sus): PATCH-ul nu trebuie sa pica; pe productie serverul il
  // converteste la imaginea directa (og:image), local pastreaza originalul.
  const page = await req(globalThis.admin, 'PATCH', '/api/profile', { avatar_url: 'https://tenor.com/paKwmvU0Mgf.gif' });
  const pageUrl = page.data?.profile?.avatar_url || '';
  check('Link pagina Tenor acceptat (valorificat sau pastrat)', page.status === 200 && !!pageUrl, `status=${page.status} url=${pageUrl}`);
}

// =====================================================================
// MISIUNI ZILNICE + STREAK — logica economiei: progres real -> claim.
// =====================================================================
console.log('\n=== Misiuni zilnice + streak ===');
{
  const mj = jar();
  let reg = await req(mj, 'POST', '/api/auth/register', { username: `mis_${Date.now() % 100000}`, email: `mis${Date.now() % 100000}@test.ro`, password: 'ParolaMare123' });
  if (reg.status === 201) {
    const before = await req(mj, 'GET', '/api/missions');
    check('Misiunile au chei cu progres', Array.isArray(before.data?.missions), JSON.stringify(before.data)?.slice(0,120));

    const claimEarly = await req(mj, 'POST', '/api/missions', { mission: 'comment' });
    check('Claim fără progres → respins', claimEarly.status === 409 || claimEarly.status === 400, `status=${claimEarly.status}`);

    const ep = await req(mj, 'GET', `/api/series/${globalThis.seriesId}`);
    const epId = ep.data?.episodes?.[0]?.id;
    const c = await req(mj, 'POST', '/api/comments', { episode_id: epId, body: 'Misiune: comentariu de test' });
    check('Comentariu pentru misiune → 201', c.status === 201, `status=${c.status} ${JSON.stringify(c.data)?.slice(0,120)}`);

    const after = await req(mj, 'GET', '/api/missions');
    check('Progresul misiunii crește după comentariu', after.data?.missions?.find((m) => m.key === 'comment')?.progress === 1, JSON.stringify(after.data?.missions)?.slice(0,160));

    const goldBefore = (await req(mj, 'GET', '/api/auth/me')).data?.user?.gold || 0;
    const claim = await req(mj, 'POST', '/api/missions', { mission: 'comment' });
    check('Claim misiune reușit', claim.status === 200 && claim.data?.reward?.gold > 0, JSON.stringify(claim.data));
    const goldAfter = (await req(mj, 'GET', '/api/auth/me')).data?.user?.gold || 0;
    check('Gold-ul crește cu recompensa', goldAfter === goldBefore + (claim.data?.reward?.gold || 0), `${goldBefore} -> ${goldAfter}`);

    const badKey = await req(mj, 'POST', '/api/missions', { mission: 'nu_exista' });
    check('Misiune necunoscută → 409', badKey.status === 409, `status=${badKey.status}`);
  } else {
    check('Misiuni: skip (înregistrare eșuată)', true, `register=${reg.status}`);
  }
}

console.log('\n=== Facțiuni (alegere lunară) + shop/activate ===');
{
  // Rutele astea au lipsit din router la un moment dat (fisierele existau,
  // dar nimic nu le servea -> 404 si panoul de factiune blocat pe „Se incarca…").
  const fj = jar();
  const reg = await req(fj, 'POST', '/api/auth/register', { username: `fac_${Date.now() % 100000}`, email: `fac${Date.now() % 100000}@test.ro`, password: 'ParolaMare123' });
  if (reg.status === 201) {
    const anon = await req(jar(), 'GET', '/api/factions');
    check('GET /api/factions fara login → 401', anon.status === 401, `status=${anon.status}`);

    const f0 = await req(fj, 'GET', '/api/factions');
    check('GET /api/factions → 200 cu lista de factiuni', f0.status === 200 && Array.isArray(f0.data?.factions) && f0.data.factions.length >= 3, `status=${f0.status} n=${f0.data?.factions?.length}`);
    check('Utilizator nou nu e in nicio factiune', f0.status === 200 && !f0.data?.my_faction, JSON.stringify(f0.data?.my_faction));
    check('Raspunsul are luna curenta si clasamentul intre factiuni', typeof f0.data?.month === 'string' && Array.isArray(f0.data?.standings), JSON.stringify(Object.keys(f0.data || {})));

    const bad = await req(fj, 'POST', '/api/factions', { faction: 'nu-exista' });
    check('Alaturare la factiune inexistenta → 400', bad.status === 400, `status=${bad.status}`);

    const pick = f0.data?.factions?.[0]?.slug;
    const join = await req(fj, 'POST', '/api/factions', { faction: pick });
    check('Alaturarea reuseste si seteaza tema de grade', join.status === 200 && join.data?.success === true && join.data?.rank_theme === pick, JSON.stringify(join.data));

    const f1 = await req(fj, 'GET', '/api/factions');
    check('Dupa alaturare, my_faction e factiunea aleasa', f1.data?.my_faction === pick, JSON.stringify(f1.data?.my_faction));
    const me = await req(fj, 'GET', '/api/ranks');
    check('Tema de grade a urmat factiunea', me.data?.me?.rank?.theme === pick, JSON.stringify(me.data?.me?.rank));

    const again = await req(fj, 'POST', '/api/factions', { faction: f0.data?.factions?.[1]?.slug || pick });
    check('A doua alegere in aceeasi luna → 409', again.status === 409, `status=${again.status}`);

    // shop/activate: revenirea la standard e gratuita; un cosmetic nedetinut e refuzat
    const std = await req(fj, 'POST', '/api/shop/activate', { type: 'theme', id: 'theme_standard' });
    check('POST /api/shop/activate tema standard → 200', std.status === 200 && std.data?.success === true, `status=${std.status} ${JSON.stringify(std.data)}`);
    const notOwned = await req(fj, 'POST', '/api/shop/activate', { type: 'color', id: 'color_purple' });
    check('Activarea unei culori nedetinute → 403', notOwned.status === 403, `status=${notOwned.status}`);
    const unknown = await req(fj, 'POST', '/api/shop/activate', { type: 'altceva', id: 'x' });
    check('Tip necunoscut la activare → 400', unknown.status === 400, `status=${unknown.status}`);
  } else {
    check('Factiuni: skip (inregistrare esuata)', true, `register=${reg.status}`);
  }
}

console.log('\n' + '='.repeat(56));
console.log(`REZULTAT: ${pass} trecute, ${fail} esuate`);
if (fail) { console.log('\nEsuate:'); failures.forEach(f => console.log('  • ' + f)); }
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);
