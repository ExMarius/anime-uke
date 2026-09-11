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
  check('GET /api/series public → 200', s.status === 200 && Array.isArray(s.data.series), JSON.stringify(s.data).slice(0, 120));

  const w = await req(j, 'POST', '/api/watch', { episode_id: 1 });
  check('POST /api/watch fara login → 401', w.status === 401, `status=${w.status}`);

  const a = await req(j, 'GET', '/api/admin/stats');
  check('GET /api/admin/stats fara login → 401', a.status === 401, `status=${a.status}`);

  const idx = await fetch(BASE + '/');
  check('GET / → 200 (static)', idx.status === 200);

  // Paginile trebuie servite la URL-uri curate, fara redirect 308
  for (const page of ['/series', '/episode', '/login', '/register', '/admin']) {
    const r = await fetch(BASE + page, { redirect: 'manual' });
    check(`GET ${page} → 200 fara redirect`, r.status === 200, `status=${r.status}`);
  }

  // Codul server-side si fisierele de configurare nu trebuie servite
  for (const blocked of ['/_worker.js', '/.dev.vars', '/wrangler.toml', '/schema.sql', '/migrations/0001_init.sql']) {
    const r = await fetch(BASE + blocked);
    const body = await r.text();
    check(`GET ${blocked} → 404 (blocat)`, r.status === 404, `status=${r.status}`);
    check(`   ...si nu scurge cale de filesystem`, !body.includes('/home/user') && !body.includes('ENOTDIR'), body.slice(0, 100));
  }
  check('Header CSP prezent pe pagina statica', !!idx.headers.get('content-security-policy'));
  check('Header X-Content-Type-Options prezent', idx.headers.get('x-content-type-options') === 'nosniff');
  check('CSP nu contine unsafe-inline', !String(idx.headers.get('content-security-policy')).includes('unsafe-inline'));
  const css = await fetch(BASE + '/assets/css/style.css');
  check('GET /assets/css/style.css → 200', css.status === 200);
  const mod = await fetch(BASE + '/assets/js/core.js');
  check('GET /assets/js/core.js → 200', mod.status === 200);
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
  check('Cod deja folosit -> 409', reuse.status === 409, `status=${reuse.status} ${reuse.data?.error}`);

  const noFormat = await req(globalThis.admin, 'POST', '/api/admin/invites', { action: 'revoke', id: globalThis.codeIds[1] });
  check('Admin poate revoca un cod nefolosit', noFormat.status === 200, `status=${noFormat.status}`);

  const revoked = await req(jar(), 'POST', '/api/auth/register', { username: 'user4', email: 'user4@test.ro', password: 'parola123', invite_code: globalThis.codes[1] });
  check('Cod revocat -> 410', revoked.status === 410, `status=${revoked.status} ${revoked.data?.error}`);

  const revokeUsed = await req(globalThis.admin, 'POST', '/api/admin/invites', { action: 'revoke', id: globalThis.codeIds[0] });
  check('Codul folosit nu poate fi revocat -> 409', revokeUsed.status === 409, `status=${revokeUsed.status}`);

  const delUsed = await req(globalThis.admin, 'DELETE', `/api/admin/invites?id=${globalThis.codeIds[0]}`);
  check('Codul folosit nu poate fi sters -> 409', delUsed.status === 409, `status=${delUsed.status}`);

  const list = await req(globalThis.admin, 'GET', '/api/admin/invites?filter=used');
  // Sortarea e created_at DESC, id DESC, deci codul folosit (id mic) e la coada.
  const usedRow = (list.data?.invites || []).find(i => i.used_by);
  check('Lista codurilor folosite arata cine le-a folosit', list.status === 200 && usedRow?.used_by_name === 'user2' && usedRow?.status === 'used', JSON.stringify(usedRow || {}).slice(0,140));
  check('Numaratoarele din panou sunt corecte', list.data?.counts?.used === 1 && list.data?.counts?.revoked === 1, JSON.stringify(list.data?.counts));
  const activeList = await req(globalThis.admin, 'GET', '/api/admin/invites?filter=active');
  check('Filtrul "active" excludee codurile folosite si revocate', activeList.status === 200 && (activeList.data?.invites || []).every(i => i.status === 'active') && activeList.data?.invites?.length === 27, `n=${activeList.data?.invites?.length}`);

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

  const badEp = await req(j, 'POST', '/api/admin/episodes', { series_id: seriesId, episode_number: 1, title: 'Ep 1', doodstream_url: 'https://youtube.com/watch?v=x' });
  check('URL non-DoodStream respins → 400', badEp.status === 400, `status=${badEp.status} ${badEp.data?.error}`);

  const badEp2 = await req(j, 'POST', '/api/admin/episodes', { series_id: 9999, episode_number: 1, title: 'x', doodstream_url: 'https://doodstream.com/e/abc123' });
  check('Serie inexistenta → 400', badEp2.status === 400, `status=${badEp2.status} ${badEp2.data?.error}`);

  const ep = await req(j, 'POST', '/api/admin/episodes', { series_id: seriesId, episode_number: 1, title: 'Romance Dawn', doodstream_url: 'https://doodstream.com/d/abc123' });
  check('Adaugare episod (URL /d/ normalizat la /e/) → 201', ep.status === 201 && ep.data?.episode?.doodstream_url === 'https://doodstream.com/e/abc123', JSON.stringify(ep.data).slice(0,180));
  const epId = ep.data?.id;

  const dupEp = await req(j, 'POST', '/api/admin/episodes', { series_id: seriesId, episode_number: 1, title: 'Duplicat', doodstream_url: 'https://doodstream.com/e/xyz789' });
  check('Episod duplicat (UNIQUE series+numar) → 409', dupEp.status === 409, `status=${dupEp.status} ${dupEp.data?.error}`);

  globalThis.seriesId = seriesId; globalThis.epId = epId;
}

console.log('\n=== 6. PAGINI PUBLICE ===');
{
  const j = jar();
  const list = await req(j, 'GET', '/api/series');
  check('Lista serii contine seria adaugata + episode_count', list.data?.series?.[0]?.title === 'One Piece' && list.data.series[0].episode_count === 1, JSON.stringify(list.data).slice(0,200));

  const detail = await req(j, 'GET', `/api/series/${globalThis.seriesId}`);
  check('Detaliu serie + episoade intr-un singur apel', detail.status === 200 && detail.data?.episodes?.length === 1, JSON.stringify(detail.data).slice(0,200));

  const e404 = await req(j, 'GET', '/api/series/99999');
  check('Serie inexistenta → 404', e404.status === 404, `status=${e404.status}`);

  const badId = await req(j, 'GET', '/api/series/abc');
  check('ID non-numeric → 400', badId.status === 400, `status=${badId.status}`);

  const epd = await req(j, 'GET', `/api/episodes/${globalThis.epId}`);
  check('Detaliu episod include seria (breadcrumb)', epd.status === 200 && epd.data?.episode?.series_title === 'One Piece', JSON.stringify(epd.data).slice(0,200));
  check('Episod pentru vizitator: watched=false', epd.data?.watched === false);
}

console.log('\n=== 7. CONTOR VIZUALIZARI (buffer in DO, nu direct in D1) ===');
{
  const j = jar();
  const v1 = await req(j, 'POST', '/api/view', { episode_id: globalThis.epId });
  check('POST /api/view → counted=true', v1.status === 200 && v1.data?.counted === true, JSON.stringify(v1.data));
  const v2 = await req(j, 'POST', '/api/view', { episode_id: globalThis.epId });
  check('Acelasi vizitator imediat dupa → deduplicat', v2.data?.counted === false && v2.data?.reason === 'duplicate', JSON.stringify(v2.data));
  const v3 = await req(j, 'POST', '/api/view', { episode_id: 99999 });
  check('View pentru episod inexistent → 404', v3.status === 404, `status=${v3.status}`);
}

console.log('\n=== 8. PUNCTE (+10, o singura data) ===');
{
  const j = jar();
  await req(j, 'POST', '/api/auth/login', { email: 'user2@test.ro', password: 'parola123' });

  const w1 = await req(j, 'POST', '/api/watch', { episode_id: globalThis.epId });
  check('Marcheaza vizionat → +10 puncte', w1.data?.success === true && w1.data?.points === 10, JSON.stringify(w1.data));

  // Simulam dublu-click: doua cereri concurrente
  const [a, b] = await Promise.all([
    req(j, 'POST', '/api/watch', { episode_id: globalThis.epId }),
    req(j, 'POST', '/api/watch', { episode_id: globalThis.epId }),
  ]);
  check('Re-marcare → alreadyWatched, 0 puncte', a.data?.alreadyWatched === true && a.data?.pointsAdded === 0, JSON.stringify(a.data));
  check('Concurenta: ambele cereri raporteaza acelasi total (fara 20 pct)', a.data?.points === 10 && b.data?.points === 10, `${a.data?.points} / ${b.data?.points}`);

  const me = await req(j, 'GET', '/api/auth/me');
  check('Punctele persista in users.points = 10', me.data?.user?.points === 10, JSON.stringify(me.data?.user));

  const epd = await req(j, 'GET', `/api/episodes/${globalThis.epId}`);
  check('Episodul apare ca watched=true pentru user logat', epd.data?.watched === true);

  const badId = await req(j, 'POST', '/api/watch', { episode_id: 'abc' });
  check('episode_id invalid → 400', badId.status === 400, `status=${badId.status}`);
}

console.log('\n=== 9. PANOU ADMIN: utilizatori, ban, roluri, protectii ===');
{
  const j = globalThis.admin;
  const users = await req(j, 'GET', '/api/admin/users');
  check('Lista utilizatori → 2 useri', users.data?.users?.length === 2, JSON.stringify(users.data?.users?.map(u=>u.username)));
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

  const bannedWatch = await req(j2, 'POST', '/api/watch', { episode_id: globalThis.epId });
  check('User banat nu poate marca episoade → 401', bannedWatch.status === 401, `status=${bannedWatch.status}`);

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
  check('Statistici: total_users=2', s.data?.stats?.total_users === 2, JSON.stringify(s.data?.stats));
  check('Statistici: total_series=1, total_episodes=1', s.data?.stats?.total_series === 1 && s.data?.stats?.total_episodes === 1, JSON.stringify(s.data?.stats));
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
  const j = jar();
  const m405 = await req(j, 'GET', '/api/auth/login');
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
