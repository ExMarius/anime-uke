#!/usr/bin/env node
// =====================================================================
// audit-live.mjs — audit READ-ONLY al sitului live.
//
// De ce există: sandbox-urile de agent nu au acces de rețea la
// anime-uke.pages.dev, așa că verificările pe live rulează prin relay-ul
// din GitHub Actions (vezi AGENTS.md §3). Scriptul ăsta strânge într-un
// singur loc toate probele care altfel ar trebui scrie de mână în cmd.sh.
//
// Principii:
//   - NU scrie nimic: doar GET/HEAD, plus POST-uri pe rute de autentificare
//     cu date evident invalide (nu creează conturi, nu modifică date).
//   - Nu are credențiale, deci tot ce ține de sesiune se raportează ca
//     „neacoperit — necesită cont” (vezi secțiunea finală).
//   - Ieșire text plată, gândită să fie citită în cf-relay/last-output.txt.
//
// Rulare:  node scripts/audit-live.mjs [https://anime-uke.pages.dev]
// =====================================================================

const BASE = (process.argv[2] || 'https://anime-uke.pages.dev').replace(/\/$/, '');
const TIMEOUT_MS = 20000;
// Minificarea/bundling-ul/?v= se întâmplă DOAR în deploy.sh, deci pe local
// (dev.sh) aceste probe ar da WARN fals. Le pornim doar pe producție.
const IS_PROD = !/localhost|127\.0\.0\.1/.test(BASE);

const results = []; // { level, section, msg }
const ok = (section, msg) => results.push({ level: 'OK', section, msg });
const warn = (section, msg) => results.push({ level: 'WARN', section, msg });
const fail = (section, msg) => results.push({ level: 'FAIL', section, msg });
const info = (section, msg) => results.push({ level: 'INFO', section, msg });

/** Verifică o condiție și înregistrează OK/FAIL (sau WARN dacă e „de rău, dar nu critic”). */
function expect(section, condition, msgOk, msgBad, level = 'FAIL') {
  if (condition) ok(section, msgOk);
  else if (level === 'WARN') warn(section, msgBad);
  else if (level === 'INFO') info(section, msgBad);
  else fail(section, msgBad);
  return Boolean(condition);
}

/** GET/HEAD/POST cu cronometru. Nu aruncă erori: întoarce { error } ca să nu cadă tot auditul. */
async function req(path, { method = 'GET', headers = {}, body = null, redirect = 'manual' } = {}) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body,
      redirect,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - started;
    const text = await res.text().catch(() => '');
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text, ms };
  } catch (e) {
    return { status: 0, headers: {}, text: '', ms: Date.now() - started, error: e?.message || String(e) };
  }
}

const jsonBody = (obj) => ({ 'Content-Type': 'application/json', Origin: BASE });
const pretty = (o) => JSON.stringify(o);

async function main() {
  console.log(`AUDIT LIVE — ${BASE}`);
  console.log(`data: ${new Date().toISOString()}`);

  // -------------------------------------------------------------------
  // 1. Pagini publice + SEO on-page
  // -------------------------------------------------------------------
  const S1 = '1. Pagini + SEO';
  const publicPages = ['/', '/login', '/register'];
  const home = await req('/');
  if (home.error) fail(S1, `site-ul nu răspunde: ${home.error}`);
  expect(S1, home.status === 200, `/ → 200 (${home.ms} ms)`, `/ → ${home.status} (așteptat 200)`);

  for (const p of publicPages) {
    const r = p === '/' ? home : await req(p);
    const title = (r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
    const desc = (r.text.match(/<meta[^>]+name=["']description["'][^>]*>/i) || [])[0] || '';
    const descLen = (desc.match(/content=["']([\s\S]*?)["']/i) || [])[1]?.trim().length || 0;
    const canon = (r.text.match(/<link[^>]+rel=["']canonical["'][^>]*>/i) || [])[0] || '';
    const ogCount = (r.text.match(/property=["']og:/g) || []).length;
    const unversioned = (r.text.match(/assets\/(?:css|js)\/[A-Za-z0-9_.-]+\.(?:css|js)(?!\?v=)/g) || []).length;
    info(S1, `${p} → ${r.status} · ${r.ms} ms · title „${title.slice(0, 60)}” (${title.length} car.)`);
    expect(S1, r.status === 200, `${p} răspunde 200`, `${p} → ${r.status}`, 'FAIL');
    expect(S1, title.length >= 10 && title.length <= 70, `${p} title are lungime sănătoasă (${title.length})`, `${p} title prea scurt/lung: ${title.length} car.`, 'WARN');
    expect(S1, descLen >= 70, `${p} meta description ${descLen} car.`, `${p} meta description ${descLen} car. (recomandat ≥ 70)`, 'WARN');
    expect(S1, /rel=["']canonical["']/.test(canon), `${p} are canonical`, `${p} NU are canonical`, 'WARN');
    const noindex = /name=["']robots["'][^>]*noindex/i.test(r.text);
    if (noindex) {
      info(S1, `${p} e marcat noindex (pagină utilitară) — og:* nu sunt necesare`);
    } else {
      expect(S1, ogCount >= 3, `${p} are ${ogCount} taguri og:*`, `${p} are doar ${ogCount} taguri og:*`, 'WARN');
    }
    expect(S1, /<html[^>]+lang=["']ro/i.test(r.text), `${p} are lang="ro"`, `${p} NU are lang="ro"`, 'WARN');
    expect(S1, unversioned === 0, `${p} are toate assetele versionate (?v=)`, `${p} are ${unversioned} assete fără ?v= (risc de cache vechi)`, 'WARN');
  }

  // /series fără id e pagină moartă (JS-ul trimitea pe /): trebuie 301 spre catalog.
  for (const p of ['/series', '/series/']) {
    const r = await req(p);
    expect(S1, r.status === 301 && (r.headers.location || '') === '/', `${p} → 301 către /`, `${p} → ${r.status} ${r.headers.location || ''} (așteptat 301 → /)`, 'FAIL');
  }

  // Seriile reale: le luăm din API-ul public, apoi verificăm SSR-ul pe URL-urile pretty.
  const seriesRes = await req('/api/series?limit=5');
  let seriesIds = [];
  try {
    const j = JSON.parse(seriesRes.text);
    seriesIds = (j.series || j.items || j.results || j || []).map((s) => s.id).filter(Boolean).slice(0, 3);
  } catch { /* rămâne gol */ }
  if (seriesIds.length === 0) warn(S1, `nu am putut citi id-urile seriilor din /api/series (${seriesRes.status})`);

  const episodeRes = await req('/api/recent?limit=5');
  let episodeIds = [];
  try {
    const j = JSON.parse(episodeRes.text);
    episodeIds = (j.episodes || j.items || j || []).map((e) => e.id).filter(Boolean).slice(0, 2);
  } catch { /* rămâne gol */ }

  for (const id of seriesIds) {
    const r = await req(`/serie/${id}`);
    const hasLd = /application\/ld\+json/.test(r.text);
    const title = (r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
    info(S1, `/serie/${id} → ${r.status} · ${r.ms} ms · title „${title.slice(0, 60)}”`);
    expect(S1, r.status === 200, `/serie/${id} → 200`, `/serie/${id} → ${r.status}`, 'FAIL');
    expect(S1, hasLd, `/serie/${id} are JSON-LD (SEO)`, `/serie/${id} NU are JSON-LD`, 'WARN');
    expect(S1, /property=["']og:type["'][^>]*video/.test(r.text), `/serie/${id} are og:type video.*`, `/serie/${id} nu are og:type video.*`, 'WARN');
  }
  for (const id of episodeIds) {
    const r = await req(`/episod/${id}`);
    const hasLd = /application\/ld\+json/.test(r.text);
    const title = (r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
    info(S1, `/episod/${id} → ${r.status} · ${r.ms} ms · title „${title.slice(0, 60)}”`);
    expect(S1, r.status === 200, `/episod/${id} → 200`, `/episod/${id} → ${r.status}`, 'FAIL');
    expect(S1, hasLd, `/episod/${id} are JSON-LD (SEO)`, `/episod/${id} NU are JSON-LD`, 'WARN');
    expect(S1, /"TVEpisode"/.test(r.text), `/episod/${id} are JSON-LD TVEpisode`, `/episod/${id} nu are TVEpisode`, 'WARN');
    expect(S1, /property=["']og:type["'][^>]*video\.episode/.test(r.text), `/episod/${id} are og:type video.episode`, `/episod/${id} nu are og:type video.episode`, 'WARN');
  }

  // -------------------------------------------------------------------
  // 2. Pagini protejate → redirect la login (nu 200, nu 500)
  // -------------------------------------------------------------------
  const S2 = '2. Protecție pagini';
  for (const p of ['/profile', '/shop', '/admin', '/admin/serii', '/admin/serie/1']) {
    const r = await req(p);
    const loc = r.headers.location || '';
    const good = r.status === 302 && loc.startsWith('/login') && loc.includes('next=');
    expect(S2, good, `${p} → 302 ${loc}`, `${p} → ${r.status} ${loc}(așteptat 302 spre /login?next=…)`, 'FAIL');
  }

  // -------------------------------------------------------------------
  // 3. Fișiere care nu trebuie servite niciodată
  // -------------------------------------------------------------------
  const S3 = '3. Fișiere blocate';
  const blocked = ['/.git/config', '/migrations/0001_init.sql', '/.dev.vars', '/.dev.vars.example', '/wrangler.toml', '/wrangler.prod.toml', '/deploy.sh', '/dev.sh', '/test.sh', '/package.json', '/schema.sql', '/src/worker.js', '/AGENTS.md', '/cf-relay/cmd.sh', '/node_modules/.package-lock.json'];
  // Doar 3 căi sunt în BLOCKED_PATHS (/_worker.js, /.dev.vars, /wrangler.toml).
  // Restul fișierelor din repo NU sunt în public/, deci cad pe poarta de auth și
  // răspund 302 → /login: conținutul nu scapă, dar statusul dezvăluie că ruta
  // „există" și murdărește crawl-ul. Raportăm separat cele două cazuri.
  for (const p of blocked) {
    const r = await req(p);
    if (r.status === 200) fail(S3, `${p} → 200 (!!! se servește conținut din repo)`);
    else if (r.status === 404 || r.status === 403) ok(S3, `${p} → ${r.status} (blocat corect)`);
    else warn(S3, `${p} → ${r.status} ${r.headers.location || ''} — nu e în BLOCKED_PATHS; conținutul nu scapă, dar un 404 ar fi mai curat`);
  }

  // -------------------------------------------------------------------
  // 4. robots.txt / sitemap.xml / llms.txt
  // -------------------------------------------------------------------
  const S4 = '4. SEO extern';
  const robots = await req('/robots.txt');
  const sitemap = await req('/sitemap.xml');
  const llms = await req('/llms.txt');
  expect(S4, robots.status === 200, 'robots.txt → 200', `robots.txt → ${robots.status}`, 'WARN');
  expect(S4, /sitemap/i.test(robots.text), 'robots.txt declară Sitemap:', 'robots.txt NU declară Sitemap:', 'WARN');
  expect(S4, sitemap.status === 200 && sitemap.text.startsWith('<?xml'), 'sitemap.xml → 200 și e XML', `sitemap.xml → ${sitemap.status}, începe cu „${sitemap.text.slice(0, 40)}”`, 'FAIL');
  const urls = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(S4, urls.length >= 2, `sitemap are ${urls.length} URL-uri`, `sitemap are doar ${urls.length} URL-uri`, 'WARN');
  expect(S4, urls.every((u) => u.startsWith(BASE)), 'toate URL-urile din sitemap folosesc originea canonică', `sitemap conține alte origini: ${urls.filter((u) => !u.startsWith(BASE)).slice(0, 3).join(' ')}`, 'WARN');
  expect(S4, urls.length === new Set(urls).size, 'sitemap fără duplicate', `sitemap are duplicate (${urls.length} vs ${new Set(urls).size} unice)`, 'WARN');
  expect(S4, !urls.some((u) => u.replace(/\/$/, '').endsWith('/series')),
    'sitemap nu conține /series (ruta face 301 spre /)', `sitemap conține /series, care face 301 → / (semnal de calitate slabă): ${urls.join(' ')}`, 'FAIL');
  expect(S4, urls.some((u) => u.includes('/episod/')),
    'sitemap include episoade (poarta de trafic organic)', 'sitemap fără episoade — doar prima pagină + serii', 'WARN');
  expect(S4, !sitemap.headers['cross-origin-resource-policy'] && !sitemap.headers['content-security-policy'],
    'sitemap iese fără CORP/CSP (curat pentru crawler-e)', `sitemap are corp=${sitemap.headers['cross-origin-resource-policy'] || '—'}`, 'WARN');
  const sitemapTxt = await req('/sitemap.txt');
  expect(S4, sitemapTxt.status === 200 && /text\/plain/.test(sitemapTxt.headers['content-type'] || ''),
    '/sitemap.txt → 200 text/plain (alternativa din Search Console)', `/sitemap.txt → ${sitemapTxt.status}`, 'WARN');
  info(S4, `sitemap: ${urls.length} URL-uri · primele 3: ${urls.slice(0, 3).join(' ')}`);
  expect(S4, llms.status === 200 && llms.text.length > 50, `llms.txt → 200 (${llms.text.length} car.)`, `llms.txt → ${llms.status}`, 'WARN');
  const spec = await req('/speculationrules.json');
  expect(S4, spec.status === 200, 'speculationrules.json → 200', `speculationrules.json → ${spec.status}`, 'WARN');

  // -------------------------------------------------------------------
  // 5. API — publice vs protejate, 404/405
  // -------------------------------------------------------------------
  const S5 = '5. API';
  const publicApi = ['/api/series', '/api/top', '/api/pulse', '/api/genres', '/api/recent', '/api/home', '/api/auth/me', '/api/auth/register-options', '/api/comments?episode_id=1'];
  for (const p of publicApi) {
    const r = await req(p);
    expect(S5, r.status === 200, `${p} → 200 (public)`, `${p} → ${r.status} (așteptat 200)`, 'FAIL');
  }
  // /api/home = prima pagină într-o singură invocare de Worker (buget 0).
  {
    const r = await req('/api/home');
    let agg = null;
    try { agg = JSON.parse(r.text); } catch { /* nu e JSON */ }
    expect(S5, !!agg?.series && !!agg?.top && Array.isArray(agg?.recent) && Array.isArray(agg?.genres) && typeof agg?.pulse?.views === 'number',
      `/api/home agregă catalog + top + recent + genuri + pulse (${r.ms} ms)`,
      `/api/home nu conține toate secțiunile: ${Object.keys(agg || {}).join(', ') || r.text.slice(0, 80)}`, 'FAIL');
  }
  const protectedApi = ['/api/admin/stats', '/api/admin/users', '/api/admin/series', '/api/admin/episodes', '/api/admin/log', '/api/admin/reports', '/api/admin/mods', '/api/admin/rank-themes', '/api/admin/episode-sources', '/api/leaderboard', '/api/factions', '/api/economy', '/api/shop', '/api/missions', '/api/notifications', '/api/watchlist', '/api/profile', '/api/continue', '/api/ranks', '/api/chests'];
  for (const p of protectedApi) {
    const r = await req(p);
    expect(S5, r.status === 401, `${p} → 401 (protejat)`, `${p} → ${r.status} (așteptat 401 — altfel expune date)`, 'FAIL');
  }
  const notFound = await req('/api/ceva-care-nu-exista');
  expect(S5, notFound.status === 404 || notFound.status === 401,
    `/api/ceva-care-nu-exista → ${notFound.status} (nu dezvăluie tabela de rute)`,
    `/api/ceva-care-nu-exista → ${notFound.status}`, 'WARN');
  const wrongMethod = await req('/api/top', { method: 'DELETE' });
  expect(S5, wrongMethod.status === 405 && (wrongMethod.headers.allow || '').length > 0, `metodă greșită → 405 cu Allow: ${wrongMethod.headers.allow}`, `metodă greșită → ${wrongMethod.status} (Allow: ${wrongMethod.headers.allow || '—'})`, 'WARN');

  // -------------------------------------------------------------------
  // 6. CSRF / origină străină / validare
  // -------------------------------------------------------------------
  const S6 = '6. CSRF + validare';
  const evil = 'https://evil.example';
  const crossRegister = await req('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: evil },
    body: pretty({ username: 'auditcsrf', email: 'audit@example.com', password: 'parola12345' }),
  });
  expect(S6, crossRegister.status === 403, `register cu Origin străin → 403`, `register cu Origin străin → ${crossRegister.status} (CSRF deschis!)`, 'FAIL');
  const crossLogin = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: evil },
    body: pretty({ username: 'nimeni', password: 'gresit' }),
  });
  expect(S6, crossLogin.status === 403, `login cu Origin străin → 403`, `login cu Origin străin → ${crossLogin.status}`, 'FAIL');
  const noOrigin = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: pretty({ username: 'nimeni', password: 'gresit' }),
  });
  expect(S6, noOrigin.status === 401, `login fără Origin (curl) → 401, nu blochează navigarea`, `login fără Origin → ${noOrigin.status}`, 'WARN');
  const badRegister = await req('/api/auth/register', {
    method: 'POST',
    headers: jsonBody(),
    body: pretty({ username: '', email: 'nu-e-email', password: '1' }),
  });
  expect(S6, badRegister.status === 400, `register cu date invalide → 400`, `register cu date invalide → ${badRegister.status} (așteptat 400)`, 'FAIL');
  const sqli = await req(`/api/series/${encodeURIComponent("1' OR '1'='1")}`);
  expect(S6, sqli.status === 400 || sqli.status === 404, `id cu ghilimele în /api/series/:id → ${sqli.status} (validat)`, `id cu ghilimele → ${sqli.status} (${sqli.text.slice(0, 80)})`, 'WARN');

  // -------------------------------------------------------------------
  // 7. Rate limiting la login (protecție brute-force)
  // -------------------------------------------------------------------
  const S7 = '7. Rate limit';
  // login.js: RATE_LIMIT = 10 la 5 minute, pe IP. Folosim un username inexistent
  // ca să nu atingem conturi reale; după test IP-ul rămâne în fereastră ~5 minute
  // (runner-ul e efemer, deci fără impact pentru utilizatori).
  const user = `audit_bruteforce_${Date.now().toString(36)}`;
  const statuses = [];
  for (let i = 0; i < 13; i++) {
    const r = await req('/api/auth/login', { method: 'POST', headers: jsonBody(), body: pretty({ username: user, password: 'incercare-gresita' }) });
    statuses.push(r.status);
  }
  info(S7, `13 login-uri eșuate consecutive (user inexistent) → ${statuses.join(', ')}`);
  expect(S7, statuses.includes(429),
    `rate limit la login activ: primul 429 la încercarea ${statuses.indexOf(429) + 1}`,
    '13 login-uri eșuate consecutive, niciun 429 — rate limiting nu funcționează!', 'FAIL');

  // register.js: 5/oră/IP. Trimitem doar cereri invalide (username gol), deci nu
  // se creează niciun cont — dar IP-ul rămâne blocat o oră la înregistrări.
  const rlRegister = [];
  for (let i = 0; i < 7; i++) {
    const r = await req('/api/auth/register', { method: 'POST', headers: jsonBody(), body: pretty({ username: '', email: 'x', password: 'y' }) });
    rlRegister.push(r.status);
  }
  info(S7, `7 register-uri invalide consecutive → ${rlRegister.join(', ')} (limita din cod: 5/oră/IP)`);
  expect(S7, rlRegister.includes(429), 'rate limit la register activ', 'niciun 429 la 7 register-uri consecutive', 'WARN');

  // -------------------------------------------------------------------
  // 8. Headere de securitate + cookie
  // -------------------------------------------------------------------
  const S8 = '8. Securitate';
  const h = home.headers;
  const csp = h['content-security-policy'] || '';
  expect(S8, csp.length > 0, 'CSP prezent', 'LIPSEȘTE Content-Security-Policy', 'FAIL');
  // script-src STRICT (fără unsafe-*): style-src are 'unsafe-inline' deliberat
  // (snippet A-Ads + pagina 404 din worker — vezi comentariul din src/lib/http.js).
  const scriptSrc = (csp.match(/script-src[^;]*/)?.[0] || '');
  expect(S8, scriptSrc && !/unsafe-inline|unsafe-eval/.test(scriptSrc), `script-src strict (${scriptSrc})`, `script-src permite unsafe-*: ${scriptSrc}`, 'FAIL');
  expect(S8, /frame-ancestors\s+'none'/.test(csp), "CSP are frame-ancestors 'none'", 'CSP fără frame-ancestors', 'WARN');
  const hsts = h['strict-transport-security'] || '';
  expect(S8, /max-age=(\d+)/.test(hsts) && Number(hsts.match(/max-age=(\d+)/)[1]) >= 31536000, `HSTS ${hsts}`, `HSTS slab/lipsă: „${hsts}”`, 'WARN');
  for (const [name, wanted] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['referrer-policy', 'strict-origin-when-cross-origin'], ['cross-origin-opener-policy', 'same-origin']]) {
    expect(S8, (h[name] || '') === wanted, `${name}: ${h[name]}`, `${name}: „${h[name] || 'LIPSEȘTE'}” (așteptat ${wanted})`, 'WARN');
  }
  expect(S8, Boolean(h['permissions-policy']), `permissions-policy: ${(h['permissions-policy'] || '').slice(0, 60)}`, 'lipsește permissions-policy', 'WARN');
  expect(S8, Boolean(h['cross-origin-resource-policy'] || h['cross-origin-embedder-policy']), 'CORP/COEP prezent', 'lipsește Cross-Origin-Resource-Policy (nu e critic, dar izolează assetele)', 'WARN');

  const logout = await req('/api/auth/logout', { method: 'POST', headers: jsonBody() });
  const setCookie = logout.headers['set-cookie'] || '';
  info(S8, `logout fără sesiune → ${logout.status}; Set-Cookie: ${setCookie.slice(0, 90) || '—'}`);
  if (setCookie) {
    expect(S8, /HttpOnly/i.test(setCookie), 'cookie HttpOnly', 'cookie FĂRĂ HttpOnly', 'FAIL');
    expect(S8, /Secure/i.test(setCookie), 'cookie Secure', 'cookie FĂRĂ Secure', 'FAIL');
    expect(S8, /SameSite=(Lax|Strict)/i.test(setCookie), 'cookie SameSite', 'cookie FĂRĂ SameSite', 'FAIL');
  }
  const cors = await req('/api/auth/me', { headers: { Origin: evil } });
  expect(S8, !cors.headers['access-control-allow-origin'], 'fără Access-Control-Allow-Origin (nu deschidem API-ul către alte origini)', `ACAO prezent: ${cors.headers['access-control-allow-origin']}`, 'WARN');

  // -------------------------------------------------------------------
  // 9. Assete, compresie, cache, imagini
  // -------------------------------------------------------------------
  const S9 = '9. Assete + performanță';
  const assets = ['/assets/css/style.css', '/assets/css/page-episode.css', '/assets/css/page-user.css', '/assets/css/page-admin.css', '/assets/js/core.js', '/assets/js/chat.js', '/assets/js/page-index.js', '/assets/js/page-series.js', '/assets/js/page-episode.js', '/assets/js/page-profile.js', '/assets/js/page-shop.js', '/assets/js/page-admin.js'];
  let jsTotal = 0;
  // Pe producție cerem assetele exact ca browserul: cu ?v=<commitul> scos din
  // HTML-ul paginii principale. Altfel am măsura alt regim de cache decât cel real.
  const v = IS_PROD ? `?v=${(home.text.match(/assets\/js\/[A-Za-z0-9_.-]+\.js\?v=([A-Za-z0-9._-]+)/)?.[1]) || 'audit'}` : '';
  info(S9, IS_PROD ? `cere assetele cu ${v.slice(0, 24)} (versiunea din HTML-ul live)` : 'mod local: assetele se cer fără ?v= (așa le servește dev.sh)');
  for (const a of assets) {
    const r = await req(`${a}${v}`, { headers: { 'Accept-Encoding': 'br, gzip' } });
    if (r.status !== 200) { warn(S9, `${a} → ${r.status} (lipsește sau e purgat greșit)`); continue; }
    const enc = r.headers['content-encoding'] || 'identity';
    const raw = Number(r.headers['content-length'] || r.text.length || 0);
    if (a.endsWith('.js')) jsTotal += raw;
    const cache = r.headers['cache-control'] || '—';
    const minified = a.endsWith('.js') || a.endsWith('.css') ? !/\n\s*\n/.test(r.text.slice(0, 4000)) : true;
    info(S9, `${a} → 200 · ${raw} B · enc=${enc} · cache=${cache}`);
    expect(S9, enc !== 'identity', `${a} e comprimat (${enc})`, `${a} se servește necomprimat (identity)`, 'WARN');
    // Cu ?v= workerul trebuie să dea immutable 1 an; fără, no-cache din _headers.
    const wantImmutable = IS_PROD;
    expect(S9, wantImmutable ? /immutable/.test(cache) : /no-cache/.test(cache),
      `${a} are Cache-Control: ${cache}`, `${a} are Cache-Control: ${cache} (așteptat ${wantImmutable ? 'immutable (are ?v=)' : 'no-cache'})`, 'WARN');
    if (IS_PROD) expect(S9, minified, `${a} e minificat`, `${a} NU pare minificat (deploy.sh nu l-a procesat?)`, 'WARN');
  }
  info(S9, `total JS servit (${assets.filter((a) => a.endsWith('.js')).length} fișiere): ${(jsTotal / 1024).toFixed(1)} KB (comprimat) — fără framework, e sănătos sub ~300 KB`);
  expect(S9, jsTotal < 400 * 1024, `buget JS ok: ${(jsTotal / 1024).toFixed(0)} KB`, `JS prea greu: ${(jsTotal / 1024).toFixed(0)} KB`, 'WARN');

  // Code splitting (runda 3): bundle-ul de pagină NU mai are tot codul în el —
  // core-ul comun vine dintr-un chunk separat (nume cu hash de conținut), iar
  // chat.js e cerut abia la nevoie (import dinamic). Verificăm pe build-ul
  // PUBLICAT că graful de chunk-uri chiar există și se servește corect: dacă
  // un chunk lipsește sau e blocat de cache-ul greșit, pagina rămâne fără JS.
  const entry = await req(`/assets/js/page-index.js${v}`, { headers: { 'Accept-Encoding': 'br, gzip' } });
  const statice = [...entry.text.matchAll(/from\s*"\.\/(c-[\w-]+\.js)"/g)].map((m) => m[1]);
  const dinamice = [...new Set([...entry.text.matchAll(/import\(\s*"\.\/(c-[\w-]+\.js)"\s*\)/g)].map((m) => m[1]))];
  expect(S9, statice.length >= 1,
    `bundle-ul paginii își ia codul comun din ${statice.length} chunk-uri separate (${statice.join(', ') || '—'})`,
    'page-index.js nu importă niciun chunk — code splitting-ul nu e activ în build-ul publicat', 'WARN');
  expect(S9, dinamice.length >= 1,
    `chat.js e amânat: ${dinamice.join(', ') || '—'} se cere doar la nevoie`,
    'niciun chunk amânat: chat.js a intrat înapoi pe calea critică (fiecare vizitator îl descarcă degeaba)', 'WARN');

  let eagerBytes = Number(entry.headers['content-length'] || entry.text.length || 0);
  for (const c of [...new Set([...statice, ...dinamice])]) {
    const r = await req(`/assets/js/${c}${v}`, { headers: { 'Accept-Encoding': 'br, gzip' } });
    const bytes = Number(r.headers['content-length'] || r.text.length || 0);
    if (statice.includes(c)) eagerBytes += bytes;
    const cache = r.headers['cache-control'] || '—';
    info(S9, `chunk ${c} → ${r.status} · ${bytes} B · enc=${r.headers['content-encoding'] || 'identity'} · cache=${cache} · ${statice.includes(c) ? 'cale critică' : 'amânat'}`);
    expect(S9, r.status === 200, `chunk-ul ${c} se servește (${r.status})`, `chunk-ul ${c} → ${r.status}: bundle-ul publicat e rupt`, 'FAIL');
    // Numele chunk-ului E hash-ul conținutului, deci cache-ul imutabil e corect
    // chiar fără ?v= (importurile din bundle sunt relative, fără query).
    expect(S9, /immutable/.test(cache),
      `chunk-ul ${c} are cache imutabil (${cache})`, `chunk-ul ${c} are cache „${cache}” (așteptat immutable)`, 'WARN');
    expect(S9, !/\n\s*\n/.test(r.text.slice(0, 4000)),
      `chunk-ul ${c} e minificat`, `chunk-ul ${c} NU pare minificat`, 'WARN');
  }
  info(S9, `cale critică JS (prima pagină, comprimat): ${(eagerBytes / 1024).toFixed(1)} KB = entry + ${statice.length} chunk-uri statice; chat-ul (${dinamice.join(', ')}) e în afara ei`);
  expect(S9, eagerBytes < 40 * 1024,
    `JS pe calea critică: ${(eagerBytes / 1024).toFixed(1)} KB comprimat`,
    `JS pe calea critică prea greu: ${(eagerBytes / 1024).toFixed(1)} KB`, 'WARN');

  // Imaginile: pagina referă direct .webp (comis în repo), deci nu mai există
  // negociere Accept pe server — un .jpg ar însemna două cereri și o invocare
  // de Worker în plus pentru fiecare imagine.
  const imgWebp = await req('/assets/img/hero-1.webp');
  const imgJpg = await req('/assets/img/hero-1.jpg');
  info(S9, `hero-1.webp → ${imgWebp.status} ${imgWebp.headers['content-type']} (${imgWebp.headers['content-length'] || imgWebp.text.length} B) · hero-1.jpg (rezervă browsere vechi) → ${imgJpg.status}`);
  expect(S9, imgWebp.status === 200 && /webp/i.test(imgWebp.headers['content-type'] || ''),
    'imaginea .webp se servește direct (fără negociere pe server)',
    `hero-1.webp → ${imgWebp.status} ${imgWebp.headers['content-type'] || '—'}`, 'WARN');
  expect(S9, /max-age=2592000/.test(imgWebp.headers['cache-control'] || ''), `imaginile au cache lung (${imgWebp.headers['cache-control']})`, `imaginile au cache: „${imgWebp.headers['cache-control'] || '—'}”`, 'WARN');
  expect(S9, imgWebp.text.length < imgJpg.text.length, `WebP mai mic decât JPEG (${imgWebp.text.length} vs ${imgJpg.text.length} B)`, `WebP NU e mai mic decât JPEG (${imgWebp.text.length} vs ${imgJpg.text.length} B)`, 'WARN');

  // Dovada că prima pagină nu mai cheltuie 5 invocări de Worker: pagina și
  // asset-urile vin din stratul static (public/_routes.json), iar API-ul e
  // agregat într-o singură cerere (/api/home). Aici verificăm doar ce se vede
  // din exterior: headerele nu se dublează (semnul trecerii prin worker).
  const staticCss = await req('/assets/css/style.css');
  const cc = staticCss.headers['cache-control'] || '';
  const doubled = (cc.match(/no-cache/g) || []).length > 1;
  expect(S9, !doubled, `assetul static e servit direct din Pages (Cache-Control: ${cc})`,
    `Cache-Control dublat („${cc}”) — assetul trece și prin worker: _routes.json nu e aplicat`, 'WARN');
  expect(S9, (home.text.match(/assets\/img\/hero-1\.webp/g) || []).length >= 1,
    'prima pagină referă direct .webp', 'prima pagină nu referă .webp (mai există negociere pe server?)', 'WARN');
  expect(S9, !/assets\/img\/hero-1\.jpg/.test(home.text.replace(/og:image[^>]*/g, '').replace(/twitter:image[^>]*/g, '')),
    'prima pagină nu cere .jpg-ul hero (doar og:image îl folosește, pentru crawlere)',
    'prima pagină încarcă și .jpg-ul hero — o cerere în plus degeaba', 'WARN');

  const homeEnc = home.headers['content-encoding'] || 'identity';
  expect(S9, homeEnc !== 'identity', `HTML comprimat (${homeEnc})`, 'HTML necomprimat', 'WARN');
  info(S9, `timpi: / ${home.ms} ms · /series ${(await req('/series')).ms} ms · /api/series ${seriesRes.ms} ms`);

  // -------------------------------------------------------------------
  // 10. Scurgeri de secrete în bundle-urile publice
  // -------------------------------------------------------------------
  const S10 = '10. Scurgeri';
  const patterns = [
    [/CLOUDFLARE_API_TOKEN/gi, 'CLOUDFLARE_API_TOKEN'],
    [/BEGIN [A-Z ]*PRIVATE KEY/g, 'cheie privată'],
    [/JWT_SECRET\s*[:=]\s*["'][^"']{8,}/g, 'JWT_SECRET cu valoare'],
    [/database_id\s*=\s*["'][0-9a-f-]{36}/gi, 'database_id D1'],
    [/["'][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}["']/gi, 'UUID hardcodat'],
    [/password\s*[:=]\s*["'][^"']{6,}["']/gi, 'parolă hardcodată'],
  ];
  let hits = 0;
  for (const a of assets.filter((x) => x.endsWith('.js'))) {
    const r = await req(a);
    if (r.status !== 200) continue;
    for (const [re, label] of patterns) {
      const m = r.text.match(re);
      if (m) { fail(S10, `${a} conține ${label} (${m.length}×): ${String(m[0]).slice(0, 60)}`); hits += 1; }
    }
  }
  expect(S10, hits === 0, `niciun secret/UUID hardcodat în cele ${assets.filter((x) => x.endsWith('.js')).length} bundle-uri JS`, `${hits} posibile scurgeri`, 'FAIL');

  // -------------------------------------------------------------------
  // 11. Chat (WebSocket) + diverse
  // -------------------------------------------------------------------
  const S11 = '11. Chat + diverse';
  const chatNoUpgrade = await req('/chat');
  expect(S11, chatNoUpgrade.status >= 400 && chatNoUpgrade.status < 500, `/chat fără upgrade → ${chatNoUpgrade.status} (refuz curat)`, `/chat fără upgrade → ${chatNoUpgrade.status}`, 'WARN');
  const chatCross = await req('/chat', { headers: { Origin: evil, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'ZGVtbw==' } });
  info(S11, `/chat cu Origin străin + upgrade → ${chatCross.status}`);
  expect(S11, chatCross.status !== 101, 'chat-ul nu acceptă upgrade de pe altă origine', 'chat-ul a acceptat upgrade cross-origin (101)', 'FAIL');
  // Favicon propriu la rădăcină: fără el, Pages servea iconița Cloudflare la
  // /favicon.ico, iar Google o arăta în rezultatele de căutare. Cea implicită
  // e minusculă (~1 KB), a noastră are 15 KB — dimensiunea o deosebește.
  const favicon = await req('/favicon.ico');
  const favCt = favicon.headers['content-type'] || '';
  const favLen = Number(favicon.headers['content-length'] || favicon.text.length || 0);
  expect(S11, favicon.status === 200 && /icon/i.test(favCt),
    `/favicon.ico → 200 ${favCt} (${favLen} B)`,
    `/favicon.ico → ${favicon.status} ${favCt} (fără favicon propriu, Pages servește iconița Cloudflare)`, 'FAIL');
  expect(S11, favLen > 4000,
    `favicon.ico e al nostru (${favLen} B, nu cel implicit Cloudflare)`,
    `favicon.ico suspect de mic (${favLen} B) — poate e cel implicit Cloudflare`, 'WARN');
  const appleIcon = await req('/apple-touch-icon.png');
  expect(S11, appleIcon.status === 200 && /png/.test(appleIcon.headers['content-type'] || ''),
    '/apple-touch-icon.png → 200 PNG (iOS)', `/apple-touch-icon.png → ${appleIcon.status}`, 'WARN');
  for (const p of ['/login', '/register']) {
    const r = await req(p);
    expect(S11, /name=["']robots["'][^>]*noindex/i.test(r.text), `${p} are noindex (pagină utilitară)`, `${p} NU are noindex`, 'WARN');
  }
  const missingSerie = await req('/serie/99999999');
  const missingEp = await req('/episod/99999999');
  expect(S11, missingSerie.status === 404, '/serie/99999999 → 404', `/serie inexistentă → ${missingSerie.status} (soft 404: Google indexează o pagină goală, crawlerul pierde buget)`, 'FAIL');
  expect(S11, /noindex/i.test(missingSerie.text) && /noindex/i.test(missingSerie.headers['x-robots-tag'] || ''),
    '404-ul de serie are noindex (meta + X-Robots-Tag)', `404-ul de serie n-are noindex (meta/X-Robots-Tag: ${missingSerie.headers['x-robots-tag'] || '—'})`, 'WARN');
  expect(S11, missingEp.status === 404, '/episod/99999999 → 404', `/episod inexistent → ${missingEp.status} (soft 404)`, 'FAIL');
  const trailingSlash = await req('/series/');
  info(S11, `/series/ → ${trailingSlash.status} ${trailingSlash.headers.location || ''}`);

  // -------------------------------------------------------------------
  // Raport
  // -------------------------------------------------------------------
  const counts = { OK: 0, WARN: 0, FAIL: 0, INFO: 0 };
  for (const r of results) counts[r.level]++;

  console.log('\n════════════ DETALII ════════════');
  let lastSection = '';
  for (const r of results) {
    if (r.section !== lastSection) { console.log(`\n── ${r.section} ──`); lastSection = r.section; }
    const mark = r.level === 'OK' ? '✅' : r.level === 'WARN' ? '⚠️ ' : r.level === 'FAIL' ? '❌' : 'ℹ️ ';
    console.log(`  ${mark} ${r.msg}`);
  }

  const problems = results.filter((r) => r.level === 'FAIL' || r.level === 'WARN');
  console.log('\n════════════ PROBLEME (prioritizate) ════════════');
  if (problems.length === 0) console.log('  (niciuna — auditul a trecut curat)');
  for (const level of ['FAIL', 'WARN']) {
    const list = problems.filter((r) => r.level === level);
    if (!list.length) continue;
    console.log(`\n  ${level === 'FAIL' ? '🔴 de reparat' : '🟡 de verificat'} (${list.length}):`);
    for (const r of list) console.log(`   • [${r.section}] ${r.msg}`);
  }

  console.log('\n════════════ NEACOPERIT FĂRĂ CONT ════════════');
  console.log('  Auditul rulează fără credențiale, deci NU probează: fluxul de login real,');
  console.log('  drepturile helper/staff/moderator, cumpărăturile din shop, cuferele, misiunile,');
  console.log('  alegerea de facțiune, comentariile/review-urile ca user, panoul admin, chat-ul autentificat.');
  console.log('  Acestea sunt acoperite local de ./test.sh — e2e (API) + dom-smoke (pagini) + caps (plafoane).');

  console.log(`\n════════════ TOTAL ════════════\n  ✅ ${counts.OK}   🟡 ${counts.WARN}   🔴 ${counts.FAIL}   ℹ️ ${counts.INFO}`);
  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('audit căzut:', e); process.exitCode = 2; });
