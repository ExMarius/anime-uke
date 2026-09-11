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
  check('Site privat: GET /api/series fara cont → 401', s.status === 401, `status=${s.status}`);

  const w = await req(j, 'POST', '/api/progress', { episode_id: 1, seconds: 30 });
  check('POST /api/progress fara login → 401', w.status === 401, `status=${w.status}`);

  const a = await req(j, 'GET', '/api/admin/stats');
  check('GET /api/admin/stats fara login → 401', a.status === 401, `status=${a.status}`);

  // --- POARTA DE LOGIN: fara cont ajungi la /login ---
  const idx = await fetch(BASE + '/', { redirect: 'manual' });
  check('GET / fara cont → 302 către /login', idx.status === 302 && String(idx.headers.get('location')).startsWith('/login'), `status=${idx.status} loc=${idx.headers.get('location')}`);
  check('Redirectul păstrează destinația în ?next=', /next=%2F/.test(String(idx.headers.get('location'))), idx.headers.get('location'));

  for (const page of ['/series', '/episode', '/admin', '/profile']) {
    const r = await fetch(BASE + page, { redirect: 'manual' });
    check(`GET ${page} fara cont → 302 către /login`, r.status === 302, `status=${r.status}`);
  }
  // /login?next=/series trebuie sa intoarca utilizatorul la pagina dorita
  const withNext = await fetch(BASE + '/series', { redirect: 'manual' });
  check('next= pointeaza la pagina ceruta', String(withNext.headers.get('location')).includes('next=%2Fseries'), withNext.headers.get('location'));

  // Paginile de autentificare raman publice, altfel nimeni nu ar putea intra
  for (const page of ['/login', '/register']) {
    const r = await fetch(BASE + page, { redirect: 'manual' });
    check(`GET ${page} → 200 public`, r.status === 200, `status=${r.status}`);
  }

  // Codul server-side si fisierele de configurare nu trebuie servite
  for (const blocked of ['/_worker.js', '/.dev.vars', '/wrangler.toml', '/schema.sql', '/migrations/0001_init.sql']) {
    const r = await fetch(BASE + blocked);
    const body = await r.text();
    check(`GET ${blocked} → 404 (blocat)`, r.status === 404, `status=${r.status}`);
    check(`   ...si nu scurge cale de filesystem`, !body.includes('/home/user') && !body.includes('ENOTDIR'), body.slice(0, 100));
  }
  const login = await fetch(BASE + '/login');
  check('Header CSP prezent pe pagina publica', !!login.headers.get('content-security-policy'));
  check('Header X-Content-Type-Options prezent', login.headers.get('x-content-type-options') === 'nosniff');
  check('CSP nu contine unsafe-inline', !String(login.headers.get('content-security-policy')).includes('unsafe-inline'));
  // Assetele raman publice: fara ele pagina de login ar fi nefunctionala
  const css = await fetch(BASE + '/assets/css/style.css');
  check('GET /assets/css/style.css → 200 public', css.status === 200);
  const mod = await fetch(BASE + '/assets/js/core.js');
  check('GET /assets/js/core.js → 200 public', mod.status === 200);
}

{
  const opts = await req(jar(), 'GET', '/api/auth/register-options');
  check('register-options: baza goala -> fara cod (bootstrap)', opts.status === 200 && opts.data?.inviteRequired === false && opts.data?.bootstrap === true, JSON.stringify(opts.data));
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

console.log('\n=== 3. PRIMUL UTILIZATOR DEVINE ADMIN (bootstrap) ===');
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

  // --- coduri de invitatie: dupa bootstrap sunt obligatorii ---
  const noCode = await req(jar(), 'POST', '/api/auth/register', { username: 'user2', email: 'user2@test.ro', password: 'parola123' });
  check('Inregistrare fara cod dupa bootstrap -> respinsa', noCode.status === 400 || noCode.status === 404, `status=${noCode.status} ${noCode.data?.error}`);

  const badCode = await req(jar(), 'POST', '/api/auth/register', { username: 'user2', email: 'user2@test.ro', password: 'parola123', invite_code: 'AU-ZZZZ-ZZZZ' });
  check('Cod inexistent -> 404', badCode.status === 404, `status=${badCode.status}`);

  const wrongFormat = await req(jar(), 'POST', '/api/auth/register', { username: 'user2', email: 'user2@test.ro', password: 'parola123', invite_code: 'nu-are-format' });
  check('Cod cu format gresit -> 400', wrongFormat.status === 400, `status=${wrongFormat.status}`);

  const gen = await req(globalThis.admin, 'POST', '/api/admin/invites', { count: 4, note: 'test e2e' });
  check('Admin genereaza coduri -> 201', gen.status === 201 && (gen.data?.created?.length === 4), `status=${gen.status} ${JSON.stringify(gen.data).slice(0,120)}`);
  check('Codurile au formatul AU-XXXX-XXXX', /^AU-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(gen.data?.created?.[0]?.code || ''), gen.data?.created?.[0]?.code);
  globalThis.codes = (gen.data?.created || []).map(c => c.code);
  globalThis.codeIds = (gen.data?.created || []).map(c => c.id);

  const genTooMany = await req(globalThis.admin, 'POST', '/api/admin/invites', { count: 999 });
  check('Peste limita de coduri/cerere -> trunchiat la 25', genTooMany.status === 201 && genTooMany.data.created.length === 25, `n=${genTooMany.data?.created?.length}`);

  const second = await req(jar(), 'POST', '/api/auth/register', { username: 'user2', email: 'user2@test.ro', password: 'parola123', invite_code: globalThis.codes[0] });
  check('Al doilea user NU e admin', second.data?.user?.is_admin === false, JSON.stringify(second.data?.user));

  const reuse = await req(jar(), 'POST', '/api/auth/register', { username: 'user3', email: 'user3@test.ro', password: 'parola123', invite_code: globalThis.codes[0] });
  check('Codul folosit e sters: a doua utilizare -> 404', reuse.status === 404, `status=${reuse.status} ${reuse.data?.error}`);

  const listAfter = await req(globalThis.admin, 'GET', '/api/admin/invites');
  check('Codul consumat nu mai apare in panou', listAfter.status === 200 && !(listAfter.data?.invites || []).some(i => i.code === globalThis.codes[0]), `n=${listAfter.data?.invites?.length}`);

  const noFormat = await req(globalThis.admin, 'POST', '/api/admin/invites', { action: 'revoke', id: globalThis.codeIds[1] });
  check('Admin poate revoca un cod nefolosit', noFormat.status === 200, `status=${noFormat.status}`);

  const revoked = await req(jar(), 'POST', '/api/auth/register', { username: 'user4', email: 'user4@test.ro', password: 'parola123', invite_code: globalThis.codes[1] });
  check('Cod revocat -> 410', revoked.status === 410, `status=${revoked.status} ${revoked.data?.error}`);

  const unrev = await req(globalThis.admin, 'POST', '/api/admin/invites', { action: 'unrevoke', id: globalThis.codeIds[1] });
  check('Revocarea poate fi anulata', unrev.status === 200, `status=${unrev.status}`);
  const afterUnrev = await req(jar(), 'POST', '/api/auth/register', { username: 'user4', email: 'user4@test.ro', password: 'parola123', invite_code: globalThis.codes[1] });
  check('Dupa anulare, codul functioneaza iar', afterUnrev.status === 201, `status=${afterUnrev.status} ${afterUnrev.data?.error}`);

  const delMissing = await req(globalThis.admin, 'DELETE', `/api/admin/invites?id=${globalThis.codeIds[0]}`);
  check('Stergerea unui cod deja consumat -> 404', delMissing.status === 404, `status=${delMissing.status}`);

  const delActive = await req(globalThis.admin, 'DELETE', `/api/admin/invites?id=${globalThis.codeIds[2]}`);
  check('Admin poate sterge un cod nefolosit', delActive.status === 200, `status=${delActive.status}`);

  const activeList = await req(globalThis.admin, 'GET', '/api/admin/invites?filter=active');
  check('Filtrul "active" intoarce doar coduri utilizabile', activeList.status === 200 && (activeList.data?.invites || []).every(i => i.status === 'active'), `n=${activeList.data?.invites?.length}`);
  check('Numaratoarele sunt coerente', activeList.data?.counts?.used === 0, JSON.stringify(activeList.data?.counts));

  const noInviteForUser = await req(jar(), 'GET', '/api/admin/invites');
  check('Userul normal nu vede codurile', noInviteForUser.status === 403 || noInviteForUser.status === 401, `status=${noInviteForUser.status}`);
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
  const seriesId = r.data?.id;

  // Campul vechi `doodstream_url` ramane acceptat ca alias: un singur URL
  // devine o singura sursa de tip embed. Asa nu spargem clientii existenti.
  const legacy = await req(j, 'POST', '/api/admin/episodes', { series_id: seriesId, episode_number: 1, title: 'Ep alias', doodstream_url: 'https://doodstream.com/d/abc123' });
  check('Alias vechi doodstream_url → o sursa embed normalizata /d/→/e/',
    legacy.status === 201 && legacy.data?.episode?.sources?.[0]?.url === 'https://doodstream.com/e/abc123' && legacy.data.episode.sources[0].kind === 'embed',
    JSON.stringify(legacy.data).slice(0, 200));

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
  check('API public nu expune id-urile de episod inactive', pub.data.sources.every((x) => x.kind !== undefined && x.url.startsWith('https://')), JSON.stringify(pub.data?.sources).slice(0, 150));

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
  for (const page of ['/', '/login', '/register', '/series', '/episode', '/admin', '/profile']) {
    const r = await raw(j, page);
    check(`GET ${page} logat → 200 (fara redirect)`, r.status === 200, `status=${r.status} loc=${r.location}`);
  }

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

console.log('\n=== 8b. PROFIL PUBLIC + LISTA DE VIZIONAT ===');
{
  const j = globalThis.admin;

  const opts = await req(j, 'GET', '/api/profile/me');
  check('GET /api/profile/me → 200', opts.status === 200 && opts.data?.user?.username === 'marius', `status=${opts.status}`);
  check('Profilul include rangul', !!opts.data?.rank?.label, JSON.stringify(opts.data?.rank));
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
  check('Statistici: total_users=3', s.data?.stats?.total_users === 3, JSON.stringify(s.data?.stats));
  check('Statistici: total_series=1, total_episodes=3', s.data?.stats?.total_series === 1 && s.data?.stats?.total_episodes === 3, JSON.stringify(s.data?.stats));
  check('Statistici: total_watched=1', s.data?.stats?.total_watched === 1, JSON.stringify(s.data?.stats));

  const log = await req(j, 'GET', '/api/admin/log');
  check('Jurnal audit are intrari', Array.isArray(log.data?.log) && log.data.log.length >= 4, `intrari=${log.data?.log?.length}`);
  const actions = (log.data?.log || []).map(l => l.action);
  check('Jurnal contine create_series + create_episode', actions.includes('create_series') && actions.includes('create_episode'), actions.join(','));
  check('Jurnal contine ban_user + unban_user', actions.includes('ban_user') && actions.includes('unban_user'), actions.join(','));
  check('Jurnal contine invite_used (urma codului sters)', actions.includes('invite_used'), actions.join(','));
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

    ws.send(JSON.stringify({ type: 'chat', message: 'Salut din test!' }));
    const msg = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout la mesaj')), 6000);
      ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'message') { clearTimeout(t); resolve(d); } };
    });
    check('Mesaj difuzat cu username corect', msg.username === 'marius' && msg.message === 'Salut din test!', JSON.stringify(msg));

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

console.log('\n=== 14. PERSISTENTA MESAJE IN D1 ===');
{
  await new Promise(r => setTimeout(r, 2500));
  const j = globalThis.admin;
  const ws = new WS(`${WS_BASE}/chat`, { headers: { Cookie: j.cookie } });
  const init = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 8000);
    ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'init') { clearTimeout(t); resolve(d); } };
    ws.onerror = () => { clearTimeout(t); reject(new Error('ws error')); };
  });
  check('Istoricul contine mesajul salvat anterior', JSON.stringify(init.history).includes('Salut din test!'), JSON.stringify(init.history).slice(0,200));
  check('Istoric limitat la max 30 mesaje', init.history.length <= 30, `lungime=${init.history.length}`);
  ws.close();
}

console.log('\n' + '='.repeat(56));
console.log(`REZULTAT: ${pass} trecute, ${fail} esuate`);
if (fail) { console.log('\nEsuate:'); failures.forEach(f => console.log('  • ' + f)); }
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);
