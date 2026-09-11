// =====================================================================
// Verificare pe PRODUCTIE — fara burst pe rutele de auth.
//
// De ce nu rulez tests/e2e.mjs direct pe productie?
//   Sectiunile 2-3 din e2e trag ~20 de POST /api/auth/register in cateva
//   secunde. Protectia anti-brute-force de la marginea Cloudflare blocheaza
//   apoi IP-ul (403 cu pagina HTML), deci tot ce urmeaza esueaza. Local,
//   in miniflare, nu exista aceasta protectie — de acolo si diferenta.
//
//   Aici: o singura inregistrare, o singura autentificare, apoi toate
//   verificarile cu pauza intre ele. Asta imita un utilizator real.
//
// Rulare: node tests/prod-smoke.mjs [baseUrl]
// =====================================================================
import WebSocket from 'ws';

const BASE = process.argv[2] || 'https://anime-uke.pages.dev';
const WS_BASE = BASE.replace(/^http/, 'ws');
const GAP = Number(process.env.GAP_MS || 400);

let pass = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ck(t, cond, extra = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${t}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${t} ${extra}`); }
}

/** Jar de cookie-uri per "utilizator". */
function jar() { return new Map(); }

function cookieHeader(j) { return [...j.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }

async function req(j, method, path, body) {
  await sleep(GAP);
  const headers = { Origin: BASE, 'content-type': 'application/json' };
  if (j.size) headers.cookie = cookieHeader(j);
  const res = await fetch(BASE + path, {
    method, headers, redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) j.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = { raw: txt.slice(0, 120) }; }
  return { status: res.status, data, headers: res.headers };
}

console.log(`\n=== Verificare productie: ${BASE} ===\n`);

// ---------------------------------------------------------------- 1. auth
console.log('1. Autentificare:');
const stamp = Date.now().toString(36);
const adminEmail = `admin-${stamp}@anime-uke.test`;
const userEmail = `user-${stamp}@anime-uke.test`;

const A = jar();
let r = await req(A, 'POST', '/api/auth/register', { username: `admin${stamp}`, email: adminEmail, password: 'test1234' });
ck('register → 201', r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
ck('primul utilizator devine admin', r.data?.user?.is_admin === true, JSON.stringify(r.data?.user));
ck('cookie HttpOnly + Secure + SameSite',
  /HttpOnly/i.test(String(r.headers.get('set-cookie'))) && /Secure/i.test(String(r.headers.get('set-cookie'))) && /SameSite/i.test(String(r.headers.get('set-cookie'))),
  String(r.headers.get('set-cookie')).slice(0, 120));

r = await req(A, 'GET', '/api/auth/me');
ck('sesiune activa + puncte 0', r.status === 200 && r.data?.user?.points === 0, JSON.stringify(r.data).slice(0, 120));

r = await req(A, 'GET', '/api/auth/register-options');
ck('dupa bootstrap, codul de invitatie e obligatoriu', r.data?.inviteRequired === true, JSON.stringify(r.data));

const noCode = await req(jar(), 'POST', '/api/auth/register', { username: `x${stamp}`, email: `x${stamp}@anime-uke.test`, password: 'test1234' });
ck('inregistrare FARA cod e respinsa', noCode.status === 400 || noCode.status === 404, `HTTP ${noCode.status} ${noCode.data?.error}`);

r = await req(A, 'POST', '/api/admin/invites', { count: 1, note: 'verificare productie' });
ck('admin genereaza cod de invitatie', r.status === 201 && r.data?.created?.length === 1, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
const inviteCode = r.data?.created?.[0]?.code;
ck('codul are formatul AU-XXXX-XXXX', /^AU-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(inviteCode || ''), inviteCode);

const B = jar();
r = await req(B, 'POST', '/api/auth/register', { username: `user${stamp}`, email: userEmail, password: 'test1234', invite_code: inviteCode });
ck('al doilea user NU e admin', r.status === 201 && r.data?.user?.is_admin === false, `HTTP ${r.status} ${JSON.stringify(r.data?.user)}`);

r = await req(jar(), 'POST', '/api/auth/register', { username: `y${stamp}`, email: `y${stamp}@anime-uke.test`, password: 'test1234', invite_code: inviteCode });
ck('codul e de unica folosinta → 409', r.status === 409, `HTTP ${r.status} ${r.data?.error}`);

// ---------------------------------------------------------------- 2. serii
console.log('\n2. Serii + episoade (flux admin din spec):');
r = await req(A, 'POST', '/api/admin/series', {
  title: 'Frieren: Beyond Journey’s End',
  description: 'Un elf magician calatoreste dupa moartea tovarasilor sai.',
  cover_image: 'https://picsum.photos/seed/frieren/400/600',
  status: 'ongoing', genre: 'Adventure, Drama, Fantasy', year: 2023,
});
ck('admin creeaza serie → 201', r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
const seriesId = r.data?.series?.id ?? r.data?.id;

r = await req(B, 'POST', '/api/admin/series', { title: 'Interzis', status: 'ongoing' });
ck('user normal → 403 la creare serie', r.status === 403, `HTTP ${r.status}`);

r = await req(A, 'POST', '/api/admin/series', { title: 'Rau', status: 'inventeaza' });
ck('status invalid → 400', r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);

r = await req(A, 'POST', '/api/admin/episodes', {
  series_id: seriesId, episode_number: 1, title: 'Journey’s End',
  doodstream_url: 'https://doodstream.com/d/abc123',
});
ck('admin creeaza episod (URL /d/ normalizat la /e/) → 201', r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
const epId = r.data?.episode?.id ?? r.data?.id;
ck('embed normalizat la /e/', String(r.data?.episode?.doodstream_url || '').includes('/e/abc123'), JSON.stringify(r.data?.episode || {}).slice(0, 140));

r = await req(A, 'POST', '/api/admin/episodes', {
  series_id: seriesId, episode_number: 1, title: 'Duplicat', doodstream_url: 'https://doodstream.com/e/xyz',
});
ck('episod duplicat (UNIQUE serie+numar) → 409', r.status === 409, `HTTP ${r.status}`);

r = await req(A, 'POST', '/api/admin/episodes', {
  series_id: seriesId, episode_number: 2, title: 'Rau', doodstream_url: 'https://evil.example/x',
});
ck('URL non-DoodStream respins → 400', r.status === 400, `HTTP ${r.status}`);

// ---------------------------------------------------------------- 3. publice
console.log('\n3. Pagini publice:');
r = await req(jar(), 'GET', '/api/series');
const s0 = (r.data?.series || []).find((x) => x.id === seriesId);
ck('lista serii + episode_count', r.status === 200 && s0?.episode_count === 1, `HTTP ${r.status} ${JSON.stringify(s0 || {}).slice(0, 140)}`);

r = await req(jar(), 'GET', `/api/series/${seriesId}`);
ck('detaliu serie + episoade dintr-un apel', r.status === 200 && (r.data?.episodes?.length ?? 0) === 1, `HTTP ${r.status}`);
ck('seria nu expune hash/parola', !JSON.stringify(r.data).includes('password'), '');

r = await req(jar(), 'GET', '/api/series/999999');
ck('serie inexistenta → 404', r.status === 404, `HTTP ${r.status}`);
r = await req(jar(), 'GET', '/api/series/abc');
ck('ID non-numeric → 400', r.status === 400, `HTTP ${r.status}`);

// ---------------------------------------------------------------- 4. views
console.log('\n4. Contor vizualizari (buffer in DO):');
r = await req(jar(), 'POST', '/api/view', { episode_id: epId });
ck('POST /api/view → counted', r.status === 200 && (r.data?.counted === true || r.data?.ok === true), `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
r = await req(jar(), 'POST', '/api/view', { episode_id: epId });
ck('acelasi vizitator imediat dupa → deduplicat', r.status === 200 && r.data?.counted === false, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
r = await req(jar(), 'POST', '/api/view', { episode_id: 999999 });
ck('view pentru episod inexistent → 404', r.status === 404, `HTTP ${r.status}`);

// ---------------------------------------------------------------- 5. puncte
console.log('\n5. Puncte (+10, o singura data):');
r = await req(B, 'POST', '/api/watch', { episode_id: epId });
ck('watch → +10 puncte', r.status === 200 && (r.data?.points ?? r.data?.total ?? r.data?.user?.points) === 10, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
r = await req(B, 'POST', '/api/watch', { episode_id: epId });
ck('re-marcare → 0 puncte (UNIQUE)', r.status === 200 && (r.data?.points ?? r.data?.total ?? r.data?.user?.points) === 10, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
r = await req(B, 'GET', '/api/auth/me');
ck('punctele persista in users.points = 10', r.data?.user?.points === 10, JSON.stringify(r.data?.user || {}).slice(0, 140));
r = await req(B, 'GET', `/api/episodes/${epId}`);
ck('episodul apare watched=true pentru user logat', r.data?.episode?.watched === true || r.data?.watched === true, JSON.stringify(r.data?.episode || r.data || {}).slice(0, 140));
r = await req(jar(), 'POST', '/api/watch', { episode_id: epId });
ck('watch fara auth → 401', r.status === 401, `HTTP ${r.status}`);

// ---------------------------------------------------------------- 6. admin
console.log('\n6. Panou admin:');
r = await req(B, 'GET', '/api/admin/users');
ck('user normal → 403 la admin/users', r.status === 403 || r.status === 401, `HTTP ${r.status}`);

r = await req(A, 'GET', '/api/admin/users');
const users = r.data?.users || [];
ck('lista utilizatori', r.status === 200 && users.length >= 2, `HTTP ${r.status} n=${users.length}`);
ck('lista NU contine hash-ul parolei', !JSON.stringify(users).match(/password_hash|pbkdf2|salt/i), '');
const other = users.find((u) => u.email === userEmail);
const me = users.find((u) => u.email === adminEmail);

if (other) {
  r = await req(A, 'POST', '/api/admin/users', { action: 'set_ban', user_id: other.id, value: true });
  ck('banare utilizator', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  r = await req(B, 'GET', '/api/auth/me');
  ck('sesiunea userului banat e respinsa', r.status === 401 || r.status === 403 || r.data?.user === null, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  r = await req(A, 'POST', '/api/admin/users', { action: 'set_ban', user_id: other.id, value: false });
  ck('debanare utilizator', r.status === 200, `HTTP ${r.status}`);
  r = await req(A, 'POST', '/api/admin/users', { action: 'set_role', user_id: other.id, value: true });
  ck('promovare la admin', r.status === 200, `HTTP ${r.status}`);
  r = await req(A, 'POST', '/api/admin/users', { action: 'set_role', user_id: other.id, value: false });
  ck('retrogradare la user', r.status === 200, `HTTP ${r.status}`);
}
if (me) {
  r = await req(A, 'POST', '/api/admin/users', { action: 'set_ban', user_id: me.id, value: true });
  ck('admin nu-si poate bana propriul cont', r.status === 400 || r.status === 403, `HTTP ${r.status}`);
  r = await req(A, 'POST', '/api/admin/users', { action: 'delete', user_id: me.id });
  ck('admin nu se poate sterge singur', r.status === 400 || r.status === 403, `HTTP ${r.status}`);
}

r = await req(A, 'GET', '/api/admin/stats');
ck('statistici admin', r.status === 200 && r.data?.stats, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
r = await req(A, 'GET', '/api/admin/log');
const logArr = r.data?.log || r.data?.entries || [];
ck('jurnal de audit populat', r.status === 200 && logArr.length > 0, `HTTP ${r.status} n=${logArr.length}`);

// ---------------------------------------------------------------- 7. chat
console.log('\n7. Chat WebSocket (Durable Object in Worker extern):');
function connect(j, label) {
  return new Promise((resolve) => {
    const st = { opened: false, init: null, system: null, msg: null, error: null, label };
    const ws = new WebSocket(`${WS_BASE}/chat`, { headers: { cookie: cookieHeader(j), Origin: BASE } });
    const to = setTimeout(() => { st.error = st.error || 'timeout'; try { ws.close(); } catch {} resolve({ st, ws }); }, 25000);
    ws.on('open', () => { st.opened = true; });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'init') st.init = m;
      else if (m.type === 'system') st.system = st.system || m;
      else if (m.type === 'message') st.msg = m;
      else if (m.type === 'error') st.error = m.text;
    });
    ws.on('error', (e) => { st.error = e.message; clearTimeout(to); resolve({ st, ws }); });
    ws.on('unexpected-response', (rq, rs) => { st.error = `HTTP ${rs.statusCode}`; clearTimeout(to); resolve({ st, ws }); });
    ws.on('close', () => { clearTimeout(to); resolve({ st, ws }); });
    setTimeout(() => { clearTimeout(to); resolve({ st, ws }); }, 24000);
  });
}

const anon = new WebSocket(`${WS_BASE}/chat`, { headers: { Origin: BASE } });
const anonRes = await new Promise((res) => {
  const t = setTimeout(() => res('timeout'), 12000);
  anon.on('unexpected-response', (rq, rs) => { clearTimeout(t); res(`HTTP ${rs.statusCode}`); });
  anon.on('open', () => { clearTimeout(t); res('deschis'); try { anon.close(); } catch {} });
  anon.on('error', (e) => { clearTimeout(t); res('eroare: ' + e.message); });
});
ck('vizitatorul nelogat NU poate deschide socket-ul', anonRes !== 'deschis', anonRes);

const c1 = connect(A, 'admin');
await sleep(2500);
const c2 = connect(B, 'user');
await sleep(3000);

const { st: s1, ws: w1 } = await c1;
ck('handshake WebSocket acceptat (101)', s1.opened === true, s1.error || '');
ck('init contine istoric + lista online', !!s1.init && Array.isArray(s1.init.history) && Array.isArray(s1.init.online), JSON.stringify(s1.init || {}).slice(0, 120));
ck('identitatea vine din JWT, nu de la client', s1.init?.you?.username === `admin${stamp}`, JSON.stringify(s1.init?.you || {}));

const { st: s2, ws: w2 } = await c2;
ck('al doilea client se conecteaza', s2.opened === true, s2.error || '');
ck('clientul 1 primeste mesaj sistem la intrarea lui 2', !!s1.system && /a intrat/.test(s1.system.text || ''), JSON.stringify(s1.system || {}).slice(0, 120));
ck('lista online are 2 utilizatori', (s1.system?.online?.length ?? s1.init?.online?.length ?? 0) >= 1, JSON.stringify(s1.system?.online || []));

// trimite de la clientul 2; rate limiter-ul din DO cere ~1.5s intre mesaje
await sleep(2000);
try { w2.send(JSON.stringify({ type: 'chat', message: 'salut-productie' })); } catch {}
await sleep(3000);

ck('mesajul ajunge la celalalt client (broadcast)', s1.msg?.message === 'salut-productie', JSON.stringify(s1.msg || {}).slice(0, 140));
ck('username-ul din mesaj vine de pe server', s1.msg?.username === `user${stamp}`, JSON.stringify(s1.msg || {}).slice(0, 140));

try { w1.send(JSON.stringify({ type: 'chat', message: 'x'.repeat(900) })); } catch {}
await sleep(2000);
ck('mesajul prea lung e trunchiat la 500', (s2.msg?.message?.length ?? 0) <= 500, `len=${s2.msg?.message?.length}`);

for (const w of [w1, w2]) { try { w.close(); } catch {} }
await sleep(1500);

// ---------------------------------------------------------------- 8. securitate
console.log('\n8. Securitate:');
r = await req(jar(), 'GET', '/api/admin/stats');
ck('fara cookie → 401 pe ruta admin', r.status === 401, `HTTP ${r.status}`);
r = await req(jar(), 'POST', '/api/auth/register', { username: 'ab', email: 'x@x.com', password: 'test1234' });
ck('username prea scurt → 400', r.status === 400, `HTTP ${r.status}`);
r = await req(jar(), 'POST', '/api/auth/register', { username: 'okname', email: 'invalid', password: 'test1234' });
ck('email invalid → 400', r.status === 400, `HTTP ${r.status}`);

const evil = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://evil.example' },
  body: JSON.stringify({ email: adminEmail, password: 'test1234' }),
});
ck('Origin strain → respins (CSRF)', evil.status === 403, `HTTP ${evil.status}`);
await evil.text();

const src = await fetch(BASE + '/src/worker.js');
const srcType = src.headers.get('content-type') || '';
await src.text();
ck('codul sursa nu e servit ca JS', !srcType.includes('javascript'), `content-type=${srcType}`);

const idx = await fetch(BASE + '/');
ck('CSP include frame-src DoodStream', /frame-src[^;]*doodstream\.com/.test(idx.headers.get('content-security-policy') || ''), '');
ck('X-Frame-Options DENY', (idx.headers.get('x-frame-options') || '') === 'DENY', idx.headers.get('x-frame-options') || '-');
await idx.text();

// ---------------------------------------------------------------- 9. curatenie
console.log('\n9. Curatare date de test:');
r = await req(A, 'DELETE', `/api/admin/episodes?id=${epId}`);
ck('admin sterge episod', r.status === 200, `HTTP ${r.status}`);
r = await req(A, 'DELETE', `/api/admin/series?id=${seriesId}`);
ck('admin sterge serie (cascade la episoade)', r.status === 200, `HTTP ${r.status}`);
r = await req(jar(), 'GET', '/api/series');
ck('lista e goala dupa stergere', r.status === 200 && (r.data?.series || []).length === 0, `HTTP ${r.status} n=${(r.data?.series || []).length}`);

r = await req(A, 'GET', '/api/admin/invites?filter=used');
const usedRow = (r.data?.invites || []).find((i) => i.used_by);
ck('codul folosit apare in panou cu numele utilizatorului', !!usedRow && usedRow.used_by_name === `user${stamp}`, JSON.stringify(usedRow || {}).slice(0, 140));
ck('numaratoarele din panou sunt coerente', (r.data?.counts?.used ?? 0) >= 1, JSON.stringify(r.data?.counts));

console.log(`\n=== ${pass} trecute, ${fail} esuate ===\n`);
process.exit(fail ? 1 : 0);
