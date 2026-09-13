// =====================================================================
// caps-e2e — simulează „comunitatea plină" pe o bază de date curată.
//
// Rulează DOAR din test.sh, într-o fază separată în care dev.sh primește
// tavane mici prin binding (LIMIT_USERS=3, LIMIT_SERIES=2). Pe baza celor
// 3 locuri: primul cont e admin (bootstrap), iar următoarele două intră
// pe cod de invitație. A patra înscriere trebuie refuzată. La fel pentru
// catalog: 2 serii OK, a 3-a refuzată.
//
// Producția nu are aceste variabile, deci acolo tavanul e mereu 1000.
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

console.log('\n=== PLAFOANE BUGET-0 (LIMIT_USERS=3, LIMIT_SERIES=2) ===');

// 1. Bootstrap: primul cont, fara cod.
let r = await req(jar(), 'POST', '/api/auth/register', { username: 'admin', email: 'admin@test.ro', password: 'parola123' });
check('bootstrap: primul cont intra (1/3)', r.status === 201 && r.data?.user?.is_admin === true, JSON.stringify(r.data));

// 2. Adminul genereaza un cod; il foloseste userul 2.
const admin = jar();
r = await req(admin, 'POST', '/api/auth/login', { username: 'admin', password: 'parola123' });
check('login admin', r.status === 200, JSON.stringify(r.data));
r = await req(admin, 'POST', '/api/admin/invites', { count: 1, note: 'test' });
const invite1 = r.data?.created?.[0]?.code;
check('admin creeaza cod invitație', r.status === 201 && !!invite1, JSON.stringify(r.data));

r = await req(jar(), 'POST', '/api/auth/register', { username: 'user2', email: 'u2@test.ro', password: 'parola123', invite_code: invite1 });
check('userul 2 intra pe cod (2/3)', r.status === 201, JSON.stringify(r.data));

// 3. Al doilea cod pentru userul 3.
r = await req(admin, 'POST', '/api/admin/invites', { count: 1, note: 'test' });
const invite2 = r.data?.created?.[0]?.code;
r = await req(jar(), 'POST', '/api/auth/register', { username: 'user3', email: 'u3@test.ro', password: 'parola123', invite_code: invite2 });
check('userul 3 intra pe cod (3/3)', r.status === 201, JSON.stringify(r.data));

// 4. Al patrulea cont trebuie refuzat.
r = await req(admin, 'POST', '/api/admin/invites', { count: 1, note: 'test' });
const invite3 = r.data?.created?.[0]?.code;
r = await req(jar(), 'POST', '/api/auth/register', { username: 'user4', email: 'u4@test.ro', password: 'parola123', invite_code: invite3 });
check('a 4-a înscriere → 403 cu mesaj de limită', r.status === 403 && /limita de 3 de conturi/i.test(r.data?.error || ''), JSON.stringify(r.data));

// 5. register-options anunta capacitatea plina (pentru bannerul din pagină).
r = await req(jar(), 'GET', '/api/auth/register-options');
check('register-options: capacityFull=true', r.status === 200 && r.data?.capacityFull === true, JSON.stringify(r.data));

// 6. Catalogul: 2 serii OK, a 3-a refuzata.
r = await req(admin, 'POST', '/api/admin/series', { title: 'Seria unu', status: 'ongoing', year: 2026 });
check('seria 1 intra (1/2)', r.status === 201, JSON.stringify(r.data));
r = await req(admin, 'POST', '/api/admin/series', { title: 'Seria doi', status: 'ongoing', year: 2026 });
check('seria 2 intra (2/2)', r.status === 201, JSON.stringify(r.data));
r = await req(admin, 'POST', '/api/admin/series', { title: 'Seria trei', status: 'ongoing', year: 2026 });
check('a 3-a serie → 403 cu mesaj de limită', r.status === 403 && /limita de 2 de anime-uri/i.test(r.data?.error || ''), JSON.stringify(r.data));

// 7. Cu comunitatea plină, cererile de coduri se închid și ele.
r = await req(jar(), 'POST', '/api/invite-requests', { email: 'poftitor@test.ro', message: 'As vrea un cod de invitație, vă rog frumos.' });
check('Comunitate plină → cererea de cod refuzată clar', r.status === 403 && /limita de 3 de conturi/i.test(r.data?.error || ''), JSON.stringify(r.data));

// 8. Stats: plafoanele ajung la panoul admin.
r = await req(admin, 'GET', '/api/admin/stats');
check('stats: limit_users=3, limit_series=2, totaluri corecte',
  r.data?.stats?.limit_users === 3 && r.data?.stats?.limit_series === 2 && r.data?.stats?.total_users === 3,
  JSON.stringify(r.data?.stats));

console.log(`\nREZULTAT: ${pass} trecute, ${fail} esuate`);
if (fail) { console.log(failures.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
