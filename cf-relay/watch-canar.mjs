// =====================================================================
// watch-canar.mjs — dovada LIVE că progresul de vizionare se scrie acolo
// unde spune `WATCH_STORE`, pe site-ul din producție.
//
// De ce există: mutarea lui `watch_progress` în Turso nu poate fi dovedită
// de testele locale (acolo „Turso” e un SQLite injectat). Singura dovadă
// reală e un cont care se uită efectiv la un episod pe live, iar apoi
// AMBELE baze sunt citite direct: D1 (prin wrangler, din cmd.sh) și Turso
// (prin scripts/watch-turso.mjs user <id>).
//
// Ce face, pe un cont temporar „canarw…”, șters la final de cmd.sh:
//   1. register + login (cookie HttpOnly real);
//   2. alege un episod din /api/recent;
//   3. trimite 4 heartbeat-uri × 300s = 20 de minute → trece pragul de 15
//      minute, deci verifică ȘI recompensa exact-once (a doua trecere nu
//      mai dă puncte, indiferent de baza în care stă progresul);
//   4. recitește progresul prin API: /api/episodes/:id și /api/continue;
//   5. scoate markerele __CANARW_*__ pentru verificarea din cmd.sh.
//
// Iese != 0 dacă ceva nu se confirmă, ca relay-ul să raporteze roșu.
// Rulare: node cf-relay/watch-canar.mjs [base-url]
// =====================================================================

import { randomBytes } from 'node:crypto';

const BASE = (process.argv[2] || process.env.CANAR_BASE || 'https://anime-uke.pages.dev').replace(/\/$/, '');
const HEARTBEATS = 4;
const STEP_SECONDS = 300;

let failed = 0;
const log = (...a) => console.log(...a);
const ok = (m) => log(`  ✅ ${m}`);
const bad = (m) => { failed++; log(`  ❌ ${m}`); };

const rand = randomBytes(4).toString('hex');
const user = { username: `canarw${rand}`, email: `canarw${rand}@example.com`, password: `Canar-${rand}-Aa1!` };

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      origin: BASE,
      referer: `${BASE}/`,
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const token = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('token='));
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data, cookie: token };
}

// 1. cont temporar
const reg = await req('/api/auth/register', { method: 'POST', body: user });
if (reg.status !== 200 && reg.status !== 201) {
  // Plafonul de 5 conturi/oră pe IP nu e un eșec al funcției: sărim, ca la
  // canarul de prietenie (exit 0), ca să nu dăm fals roșu.
  log(`  ⏭  register a răspuns ${reg.status} (${reg.data?.error || ''}) — sar peste canarul de progres`);
  process.exit(0);
}
const cookie = reg.cookie || (await req('/api/auth/login', { method: 'POST', body: { username: user.username, password: user.password } })).cookie;
if (!cookie) { bad('nu am obținut cookie de sesiune'); process.exit(1); }
const me = await req('/api/auth/me', { cookie });
const userId = Number(me.data?.user?.id || me.data?.id || 0);
ok(`cont canar ${user.username} (id=${userId})`);

// 2. un episod real din producție
const recent = await req('/api/recent');
const episode = (recent.data?.items || recent.data?.episodes || [])[0];
const episodeId = Number(episode?.id || 0);
if (!episodeId) { bad('nu am găsit niciun episod în /api/recent'); process.exit(1); }
ok(`episod ales: ${episodeId}`);

// 3. vizionare reală: 4 × 5 minute
let last = null;
let awarded = 0;
for (let i = 0; i < HEARTBEATS; i++) {
  last = await req('/api/progress', { method: 'POST', cookie, body: { episode_id: episodeId, seconds: STEP_SECONDS } });
  if (last.status !== 200) { bad(`heartbeat ${i + 1} a răspuns ${last.status}: ${JSON.stringify(last.data)}`); break; }
  awarded += Number(last.data?.pointsAdded) || 0;
}
const expected = HEARTBEATS * STEP_SECONDS;
if (Number(last?.data?.seconds) === expected) ok(`progres acumulat pe live: ${expected}s`);
else bad(`progres acumulat greșit: ${JSON.stringify(last?.data)}`);
if (awarded === 10) ok('recompensa s-a acordat exact o dată (10 puncte)');
else bad(`recompensă neașteptată: ${awarded} puncte`);
log(`  ℹ  store raportat de API: ${last?.data?.store || '?'}${last?.data?.fallback ? ' (FALLBACK pe D1!)' : ''}`);

// 4. citirile care contează pentru utilizator
const ep = await req(`/api/episodes/${episodeId}`, { cookie });
const epSeconds = Number(ep.data?.episode?.progress_seconds ?? ep.data?.progress_seconds ?? 0);
if (epSeconds === expected) ok('pagina episodului citește progresul corect');
else bad(`pagina episodului arată ${epSeconds}s în loc de ${expected}s`);

const cont = await req('/api/continue', { cookie });
const item = (cont.data?.items || []).find((i) => Number(i.episode_id) === episodeId);
if (item && Number(item.seconds) === expected) ok('„Continuă vizionarea” arată episodul cu secundele corecte');
else bad(`„Continuă vizionarea” nu confirmă: ${JSON.stringify(cont.data?.items || []).slice(0, 200)}`);

// 5. markere pentru verificarea directă în baze (cmd.sh)
log(`  __CANARW_USER__=${user.username}`);
log(`  __CANARW_USER_ID__=${userId}`);
log(`  __CANARW_EPISODE__=${episodeId}`);
log(`  __CANARW_SECONDS__=${expected}`);
log(`  __CANARW_STORE__=${last?.data?.store || ''}`);

process.exit(failed ? 1 : 0);
