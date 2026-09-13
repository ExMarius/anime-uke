// =====================================================================
// caps-e2e — „comunitatea plină" pe o bază de date curată.
//
// Rulează DOAR din test.sh, într-o fază separată în care dev.sh primește
// tavane mici prin binding (LIMIT_USERS=4, LIMIT_SERIES=2). Înregistrarea
// e deschisă: 4 conturi intră liber, al 5-lea e refuzat clar. Catalogul:
// 2 serii, a 3-a refuzată.
//
// Producția nu are aceste variabile: tavanul e 1000/1000.
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
  return { status: res.status, data, raw: text };
}
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n=== PLAFOANE BUGET-0 (LIMIT_USERS=4, LIMIT_SERIES=2) ===');

let r = await req(jar(), 'POST', '/api/auth/register', { username: 'admin', email: 'admin@test.ro', password: 'parola123' });
check('bootstrap: primul cont intra (1/4)', r.status === 201 && r.data?.user?.is_admin === true, JSON.stringify(r.data));

for (const n of [2, 3, 4]) {
  r = await req(jar(), 'POST', '/api/auth/register', { username: `user${n}`, email: `u${n}@test.ro`, password: 'parola123' });
  check(`înregistrare liberă ${n}/4`, r.status === 201, JSON.stringify(r.data));
}

r = await req(jar(), 'POST', '/api/auth/register', { username: 'user5', email: 'u5@test.ro', password: 'parola123' });
check('a 5-a înscriere → 403 cu mesaj de limită', r.status === 403 && /limita de 4 de conturi/i.test(r.data?.error || ''), JSON.stringify(r.data));

let opts = await req(jar(), 'GET', '/api/auth/register-options');
check('register-options: capacityFull=true', opts.status === 200 && opts.data?.capacityFull === true, JSON.stringify(opts.data));

const admin = jar();
r = await req(admin, 'POST', '/api/auth/login', { username: 'admin', password: 'parola123' });
check('login admin', r.status === 200, JSON.stringify(r.data));

r = await req(admin, 'POST', '/api/admin/series', { title: 'Seria unu', status: 'ongoing', year: 2026 });
check('seria 1 intră (1/2)', r.status === 201, JSON.stringify(r.data));
r = await req(admin, 'POST', '/api/admin/series', { title: 'Seria doi', status: 'ongoing', year: 2026 });
check('seria 2 intră (2/2)', r.status === 201, JSON.stringify(r.data));
r = await req(admin, 'POST', '/api/admin/series', { title: 'Seria trei', status: 'ongoing', year: 2026 });
check('a 3-a serie → 403 cu mesaj de limită', r.status === 403 && /limita de 2 de anime-uri/i.test(r.data?.error || ''), JSON.stringify(r.data));

r = await req(admin, 'GET', '/api/admin/stats');
check('stats: limit_users=4, limit_series=2, totaluri corecte',
  r.data?.stats?.limit_users === 4 && r.data?.stats?.limit_series === 2 && r.data?.stats?.total_users === 4,
  JSON.stringify(r.data?.stats));

// ---------------------------------------------------------------------
// Originea canonica: cu CANONICAL_ORIGIN setat (binding de test), sitemap-ul
// si canonicele pointeaza spre domeniul declarat, nu spre originea cererii.
// ---------------------------------------------------------------------
{
  const sm = await fetch(`${BASE}/sitemap.xml`);
  const smText = await sm.text();
  check('sitemap folosește CANONICAL_ORIGIN', smText.includes('https://anime-uke.test/serie/'), smText.slice(0, 140));

  const sr = await fetch(`${BASE}/serie/1`);
  const srText = await sr.text();
  check('canonical + og:url folosesc CANONICAL_ORIGIN', srText.includes('https://anime-uke.test/serie/1'), srText.slice(0, 140));
}

console.log(`\nREZULTAT: ${pass} trecute, ${fail} esuate`);
if (fail) { console.log(failures.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
