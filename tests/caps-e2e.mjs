// =====================================================================
// caps-e2e — comunitatea plină + modul „invitație".
//
// Rulează DOAR din test.sh, într-o fază separată în care dev.sh primește
// variabilele prin binding: LIMIT_USERS=4, LIMIT_SERIES=2 și
// REGISTRATION_MODE=invite. Acolo verificăm:
//   • modul invite: fără cod nu intri, cu cod da; cererile de coduri funcționează
//   • fluxul complet cerere → aprobare → cod → înregistrare
//   • plafoanele: al 5-lea utilizator și a 3-a serie sunt refuzate clar
//
// Producția nu are aceste variabile: înregistrare deschisă, plafon 1000.
// =====================================================================
const BASE = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:8788';

let pass = 0, fail = 0;
const failures = [];
let ipSeq = 10;
function jar() { return { cookie: '', ip: `203.1.${Math.floor(ipSeq/250)}.${(ipSeq++%250)+1}` }; }
function saveCookie(j, res) {
  const sc = res.headers.get('set-cookie');
  if (sc) j.cookie = sc.split(';')[0];
}
async function req(j, method, path, body) {
  const headers = { 'Origin': BASE };
  if (j?.cookie) headers.Cookie = j.cookie;
  if (j?.ip) { headers['CF-Connecting-IP'] = j.ip; headers['X-Forwarded-For'] = j.ip; }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (j) saveCookie(j, res);
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 120) }; }
  return { status: res.status, data };
}
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const codeFrom = (r) => r.data?.created?.[0]?.code;

console.log('\n=== MOD INVITAȚIE + PLAFOANE (LIMIT_USERS=4, LIMIT_SERIES=2) ===');

// 1. Bootstrap: primul cont, fara cod (doar prima inregistrare e libera).
let r = await req(jar(), 'POST', '/api/auth/register', { username: 'admin', email: 'admin@test.ro', password: 'parola123' });
check('bootstrap: primul cont intra (1/4)', r.status === 201 && r.data?.user?.is_admin === true, JSON.stringify(r.data));

// 2. În modul invite, fără cod nu mai intră nimeni.
r = await req(jar(), 'POST', '/api/auth/register', { username: 'faracod', email: 'faracod@test.ro', password: 'parola123' });
check('mod invite: fără cod → respins', r.status === 400 || r.status === 404, `status=${r.status} ${JSON.stringify(r.data)}`);

// 3. Adminul generează coduri; userul 2 și 3 intră pe cod.
const admin = jar();
r = await req(admin, 'POST', '/api/auth/login', { username: 'admin', password: 'parola123' });
check('login admin', r.status === 200, JSON.stringify(r.data));

let opts = await req(jar(), 'GET', '/api/auth/register-options');
check('register-options: mod invite + cod cerut', opts.status === 200 && opts.data?.inviteRequired === true && opts.data?.mode === 'invite', JSON.stringify(opts.data));

r = await req(admin, 'POST', '/api/admin/invites', { count: 1, note: 'test' });
const invite1 = codeFrom(r);
check('admin creează cod invitație', r.status === 201 && !!invite1, JSON.stringify(r.data));
r = await req(jar(), 'POST', '/api/auth/register', { username: 'user2', email: 'u2@test.ro', password: 'parola123', invite_code: invite1 });
check('userul 2 intră pe cod (2/4)', r.status === 201, JSON.stringify(r.data));

r = await req(admin, 'POST', '/api/admin/invites', { count: 1, note: 'test' });
r = await req(jar(), 'POST', '/api/auth/register', { username: 'user3', email: 'u3@test.ro', password: 'parola123', invite_code: codeFrom(r) });
check('userul 3 intră pe cod (3/4)', r.status === 201, JSON.stringify(r.data));

// 4. Fluxul complet al cererilor de coduri (în modul invite sunt active).
r = await req(jar(), 'POST', '/api/invite-requests', { email: 'sperant@test.ro', message: 'Vreau să intru pentru seriile rare și chatul live.' });
check('cerere de cod creată → 201 + bilet RQ', r.status === 201 && /^RQ-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(r.data?.request_code || ''), JSON.stringify(r.data));
const ticket = r.data?.request_code;

r = await req(jar(), 'GET', `/api/invite-requests?code=${encodeURIComponent(ticket)}`);
check('verificare bilet → pending', r.status === 200 && r.data?.status === 'pending' && r.data?.invite_code === undefined, JSON.stringify(r.data));

const dup = await req(jar(), 'POST', '/api/invite-requests', { email: 'sperant@test.ro', message: 'A doua cerere cu acelasi email ar trebui refuzata.' });
check('email duplicat în așteptare → 409', dup.status === 409, `status=${dup.status}`);

let lst = await req(admin, 'GET', '/api/admin/invite-requests');
const mine = (lst.data?.requests || []).find((x) => x.email === 'sperant@test.ro');
check('cererea apare în lista admin (pending)', !!mine && mine.status === 'pending', JSON.stringify(lst.data)?.slice(0, 200));

const appr = await req(admin, 'POST', '/api/admin/invite-requests', { id: mine?.id, action: 'approve' });
check('aprobare → cod generat automat', appr.status === 200 && /^AU-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(appr.data?.invite_code || ''), JSON.stringify(appr.data));

r = await req(jar(), 'GET', `/api/invite-requests?code=${encodeURIComponent(ticket)}`);
check('biletul arată codul după aprobare', r.data?.status === 'approved' && r.data?.invite_code === appr.data?.invite_code, JSON.stringify(r.data));

const rej2 = await req(admin, 'POST', '/api/admin/invite-requests', { id: mine?.id, action: 'approve' });
check('a doua decizie pe aceeași cerere → 409', rej2.status === 409, `status=${rej2.status}`);

// 5. Codul din cerere chiar funcționează la înregistrare (4/4).
r = await req(jar(), 'POST', '/api/auth/register', { username: 'cerutul', email: 'cerut@test.ro', password: 'parola123', invite_code: appr.data?.invite_code });
check('înregistrare cu codul din cerere (4/4)', r.status === 201, JSON.stringify(r.data));

// 6. Plafonul: al 5-lea utilizator e refuzat, cu sau fără cod.
r = await req(admin, 'POST', '/api/admin/invites', { count: 1, note: 'test' });
const spare = codeFrom(r);
r = await req(jar(), 'POST', '/api/auth/register', { username: 'user5', email: 'u5@test.ro', password: 'parola123', invite_code: spare });
check('a 5-a înscriere → 403 cu mesaj de limită', r.status === 403 && /limita de 4 de conturi/i.test(r.data?.error || ''), JSON.stringify(r.data));

r = await req(jar(), 'POST', '/api/invite-requests', { email: 'poftitor@test.ro', message: 'As vrea un cod de invitație, vă rog frumos.' });
check('comunitate plină → cererea de cod refuzată clar', r.status === 403 && /limita de 4 de conturi/i.test(r.data?.error || ''), JSON.stringify(r.data));

opts = await req(jar(), 'GET', '/api/auth/register-options');
check('register-options: capacityFull=true', opts.status === 200 && opts.data?.capacityFull === true, JSON.stringify(opts.data));

// 7. Plafonul catalogului: 2 serii OK, a 3-a refuzată.
r = await req(admin, 'POST', '/api/admin/series', { title: 'Seria unu', status: 'ongoing', year: 2026 });
check('seria 1 intră (1/2)', r.status === 201, JSON.stringify(r.data));
r = await req(admin, 'POST', '/api/admin/series', { title: 'Seria doi', status: 'ongoing', year: 2026 });
check('seria 2 intră (2/2)', r.status === 201, JSON.stringify(r.data));
r = await req(admin, 'POST', '/api/admin/series', { title: 'Seria trei', status: 'ongoing', year: 2026 });
check('a 3-a serie → 403 cu mesaj de limită', r.status === 403 && /limita de 2 de anime-uri/i.test(r.data?.error || ''), JSON.stringify(r.data));

// 8. Stats: plafoanele ajung la panoul admin.
r = await req(admin, 'GET', '/api/admin/stats');
check('stats: limit_users=4, limit_series=2, totaluri corecte',
  r.data?.stats?.limit_users === 4 && r.data?.stats?.limit_series === 2 && r.data?.stats?.total_users === 4,
  JSON.stringify(r.data?.stats));

console.log(`\nREZULTAT: ${pass} trecute, ${fail} esuate`);
if (fail) { console.log(failures.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
