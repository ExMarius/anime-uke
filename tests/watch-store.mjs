// =====================================================================
// watch-store.mjs — mutarea `watch_progress` în Turso, testată pe baze
// SQLite REALE (aceleași migrări ca producția), fără rețea.
//
// Ce acoperă (cerințele etapei):
//   · retry — citirile se reîncearcă, scrierile NU (increment = risc de
//     dublare); ambele comportamente sunt verificate explicit
//   · cereri concurente pe același (user, episod)
//   · timeout Turso pe calea fierbinte
//   · fallback controlat pe D1 + jurnalizarea incidentului (nu ascundem)
//   · recompensă exact o dată (puncte) chiar cu progresul în Turso
//   · cufere, topuri și „Continuă vizionarea” citite din Turso
//   · comparația D1/Turso (aceeași funcție folosită de scripts/watch-turso.mjs)
//
// Rulează: node tests/watch-store.mjs
// =====================================================================

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bumpProgress, continueRows, episodeSeconds, progressForEpisodes,
  resetWatchStoreStats, seriesSeconds, watchStoreMode, watchStoreStats,
  weeklyAggregate, TURSO_TIMEOUT_MS, AUDIT_TIMEOUT_MS,
} from '../src/lib/watch-store.js';
import { compareMaps, normalizeRows } from '../scripts/watch-turso.mjs';
import { onRequestPost as progressPost } from '../src/routes/api/progress.js';
import { onRequestGet as continueGet } from '../src/routes/api/continue.js';
import { onRequestGet as topGet } from '../src/routes/api/top.js';
import { onRequestGet as chestsGet } from '../src/routes/api/chests.js';
import { signJWT } from '../src/lib/jwt.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ---------------------------------------------------------------------
// D1 fals, dar cu SQLite real: aceleași migrări, aceeași semantică de
// RETURNING / meta.changes. Un „mock” care întoarce obiecte inventate ar
// fi validat testul, nu codul.
// ---------------------------------------------------------------------
function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(ROOT, 'migrations', file), 'utf8'));
  }
  const wrap = (sql, args) => {
    const stmt = db.prepare(sql);
    const returning = /RETURNING/i.test(sql);
    const select = /^\s*SELECT/i.test(sql);
    if (select || returning) {
      const rows = stmt.all(...args);
      return { results: rows, meta: { changes: rows.length } };
    }
    const info = stmt.run(...args);
    return { results: [], meta: { changes: Number(info.changes) || 0, last_row_id: Number(info.lastInsertRowid) || 0 } };
  };
  const prepare = (sql) => {
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },
      async first() { return wrap(sql, args).results[0] ?? null; },
      async all() { return wrap(sql, args); },
      async run() { return wrap(sql, args); },
      _exec() { return wrap(sql, args); },
    };
    return api;
  };
  return {
    raw: db,
    prepare,
    async batch(stmts) { return stmts.map((s) => s._exec()); },
  };
}

// ---------------------------------------------------------------------
// „Turso” fals: tot SQLite real, cu migrările din turso/migrations, plus
// injectoare de defect (eșec, lentoare) pentru scenariile de rezistență.
// ---------------------------------------------------------------------
function makeTurso() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(join(ROOT, 'turso/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(ROOT, 'turso/migrations', file), 'utf8'));
  }
  const state = { calls: 0, failFirst: 0, delayMs: 0, down: false, sql: [] };
  const driver = async (statements) => {
    state.calls++;
    state.sql.push(statements.map((s) => s.sql.replace(/\s+/g, ' ').trim()));
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    if (state.down) throw new Error('Turso: conexiune refuzată');
    if (state.failFirst > 0) { state.failFirst--; throw new Error('Turso: eroare tranzitorie'); }
    return statements.map(({ sql, args }) => {
      const stmt = db.prepare(sql);
      if (/^\s*SELECT/i.test(sql) || /RETURNING/i.test(sql)) {
        return { rows: stmt.all(...args), rowsAffected: 0, lastInsertId: 0 };
      }
      const info = stmt.run(...args);
      return { rows: [], rowsAffected: Number(info.changes) || 0, lastInsertId: Number(info.lastInsertRowid) || 0 };
    });
  };
  return { db, state, driver };
}

function makeEnv(mode, { d1 = makeD1(), turso = makeTurso() } = {}) {
  return {
    env: {
      DB: d1,
      WATCH_STORE: mode,
      JWT_SECRET: 'secret-de-test-suficient-de-lung-pentru-hs256',
      TOP_CACHE_MINUTES: '0',
      __WATCH_TURSO__: turso.driver,
    },
    d1,
    turso,
  };
}

/** Catalog minim: o serie cu două episoade + un utilizator. */
function seed(d1) {
  d1.raw.exec(`
    INSERT INTO anime_series (id, title, description, cover_image, status, genre, year)
      VALUES (1, 'Serie test', 'desc', '', 'ongoing', 'Acțiune', 2026);
    INSERT INTO episodes (id, series_id, episode_number, title) VALUES (10, 1, 1, 'Ep 1');
    INSERT INTO episodes (id, series_id, episode_number, title) VALUES (11, 1, 2, 'Ep 2');
    INSERT INTO users (id, username, email, password_hash, password_salt, points)
      VALUES (1, 'marius', 'm@test.ro', 'x', 'y', 0);
  `);
}

const d1Seconds = (d1, userId, episodeId) => d1.raw
  .prepare('SELECT seconds FROM watch_progress WHERE user_id = ? AND episode_id = ?')
  .get(userId, episodeId)?.seconds ?? null;
const tursoSeconds = (turso, userId, episodeId) => turso.db
  .prepare('SELECT seconds FROM watch_progress WHERE user_id = ? AND episode_id = ?')
  .get(userId, episodeId)?.seconds ?? null;
const auditKinds = (turso) => turso.db.prepare('SELECT kind, COUNT(*) AS n FROM watch_store_audit GROUP BY kind')
  .all().reduce((acc, row) => Object.assign(acc, { [row.kind]: Number(row.n) }), {});

// =====================================================================
console.log('\n── 1. Flagul WATCH_STORE ──');
// =====================================================================
{
  const { env } = makeEnv('d1');
  check('implicit (fără flag) rămâne d1', watchStoreMode({ DB: env.DB }) === 'd1');
  check('WATCH_STORE=shadow e recunoscut', watchStoreMode({ ...env, WATCH_STORE: 'shadow' }) === 'shadow');
  check('WATCH_STORE=turso e recunoscut', watchStoreMode({ ...env, WATCH_STORE: 'turso' }) === 'turso');
  check('valoare necunoscută → d1 (fail safe)', watchStoreMode({ ...env, WATCH_STORE: 'mysql' }) === 'd1');
  check('fără credențiale Turso, flagul turso cade pe d1',
    watchStoreMode({ DB: env.DB, WATCH_STORE: 'turso' }) === 'd1');
}

// =====================================================================
console.log('\n── 2. Etapa d1: Turso nici măcar nu e atins ──');
// =====================================================================
{
  const { env, d1, turso } = makeEnv('d1');
  seed(d1);
  const r1 = await bumpProgress(env, { userId: 1, episodeId: 10, seriesId: 1, inc: 300 });
  check('totalul vine din D1', r1.seconds === 300 && r1.source === 'd1', JSON.stringify(r1));
  check('rândul e în D1', d1Seconds(d1, 1, 10) === 300);
  check('Turso nu a primit nicio cerere', turso.state.calls === 0, String(turso.state.calls));
}

// =====================================================================
console.log('\n── 3. Etapa shadow: dual-write, D1 sursa oficială ──');
// =====================================================================
{
  const { env, d1, turso } = makeEnv('shadow');
  seed(d1);
  resetWatchStoreStats();
  const r1 = await bumpProgress(env, { userId: 1, episodeId: 10, seriesId: 1, inc: 300 });
  const r2 = await bumpProgress(env, { userId: 1, episodeId: 10, seriesId: 1, inc: 300 });
  check('răspunsul rămâne al lui D1', r2.source === 'd1' && r2.seconds === 600);
  check('umbra Turso are aceeași valoare', tursoSeconds(turso, 1, 10) === 600);
  check('delta raportat este 0', r1.shadow?.delta === 0 && r2.shadow?.delta === 0);
  check('series_id se denormalizează în Turso',
    turso.db.prepare('SELECT series_id FROM watch_progress WHERE user_id=1 AND episode_id=10').get().series_id === 1);

  // Divergență provocată: cineva atinge Turso pe lângă aplicație.
  turso.db.exec('UPDATE watch_progress SET seconds = 999 WHERE user_id = 1 AND episode_id = 10');
  const r3 = await bumpProgress(env, { userId: 1, episodeId: 10, seriesId: 1, inc: 60 });
  check('divergența este DETECTATĂ, nu ascunsă', r3.shadow.delta !== 0 && !r3.shadow.ok, JSON.stringify(r3.shadow));
  check('divergența e jurnalizată în watch_store_audit', (auditKinds(turso).divergence || 0) === 1, JSON.stringify(auditKinds(turso)));
  check('utilizatorul primește tot valoarea D1', r3.seconds === 660);
  check('contoarele interne numără divergența', watchStoreStats().divergences === 1);

  // Turso căzut în shadow: D1 merge mai departe, incidentul se notează.
  turso.state.down = true;
  const r4 = await bumpProgress(env, { userId: 1, episodeId: 11, seriesId: 1, inc: 120 });
  turso.state.down = false;
  check('shadow: căderea Turso NU afectează utilizatorul', r4.seconds === 120 && r4.source === 'd1');
  check('shadow: eșecul de scriere e numărat', watchStoreStats().tursoWriteFail === 1);
}

// =====================================================================
console.log('\n── 4. Etapa turso: sursa oficială, D1 neatins ──');
// =====================================================================
{
  const { env, d1, turso } = makeEnv('turso');
  seed(d1);
  const r1 = await bumpProgress(env, { userId: 1, episodeId: 10, seriesId: 1, inc: 300 });
  const r2 = await bumpProgress(env, { userId: 1, episodeId: 10, seriesId: 1, inc: 300 });
  check('totalul vine din Turso', r2.source === 'turso' && r2.seconds === 600, JSON.stringify(r2));
  check('D1 nu mai primește scrieri de progres', d1Seconds(d1, 1, 10) === null);
  check('prima scriere a returnat incrementul', r1.seconds === 300);

  check('citirea unui episod vine din Turso', await episodeSeconds(env, 1, 10) === 600);
  const marks = await progressForEpisodes(env, 1, [10, 11]);
  check('marcajele paginii de serie vin din Turso', marks.get(10) === 600 && !marks.has(11));
  check('cuferele însumează pe serie fără JOIN între baze', await seriesSeconds(env, 1, 1) === 600);
  const cont = await continueRows(env, 1, 8);
  check('„Continuă vizionarea” citește din Turso', cont.length === 1 && Number(cont[0].episode_id) === 10);
  const agg = await weeklyAggregate(env);
  check('topul săptămânal se agregă în Turso', agg.length === 1 && agg[0].id === 1 && agg[0].watchers === 1, JSON.stringify(agg));
}

// =====================================================================
console.log('\n── 5. Retry, timeout, fallback ──');
// =====================================================================
{
  const { env, d1, turso } = makeEnv('turso');
  seed(d1);
  resetWatchStoreStats();

  // (a) CITIRE: o eroare tranzitorie se reîncearcă și reușește.
  await bumpProgress(env, { userId: 1, episodeId: 10, seriesId: 1, inc: 300 });
  turso.state.failFirst = 1;
  const seconds = await episodeSeconds(env, 1, 10);
  check('citirea se reîncearcă după o eroare tranzitorie', seconds === 300, String(seconds));
  check('reîncercarea reușită nu produce fallback', watchStoreStats().tursoReadFail === 0);

  // (b) SCRIERE: NU se reîncearcă (incrementul nu e idempotent) — cade pe D1.
  turso.state.failFirst = 1;
  const w = await bumpProgress(env, { userId: 1, episodeId: 11, seriesId: 1, inc: 120 });
  check('scrierea nu se reîncearcă: cade direct pe D1', w.fallback === true && w.source === 'd1', JSON.stringify(w));
  check('scrierea nu s-a aplicat de două ori în Turso', tursoSeconds(turso, 1, 11) === null);
  check('progresul NU s-a pierdut (e în D1)', d1Seconds(d1, 1, 11) === 120);
  check('fallback-ul e jurnalizat', (auditKinds(turso).fallback || 0) === 1, JSON.stringify(auditKinds(turso)));

  // (c) TIMEOUT: Turso răspunde, dar prea târziu pentru calea fierbinte.
  turso.state.delayMs = TURSO_TIMEOUT_MS + 200;
  const started = Date.now();
  const t = await bumpProgress(env, { userId: 1, episodeId: 11, seriesId: 1, inc: 60 });
  const elapsed = Date.now() - started;
  turso.state.delayMs = 0;
  check('timeout-ul Turso duce la fallback pe D1', t.fallback === true && t.seconds === 180, JSON.stringify(t));
  // Bugetul maxim al unui heartbeat cu Turso lent: termenul operației +
  // termenul (mai scurt) al jurnalului. Fără plafonul din audit, un Turso
  // lent ar dubla timpul de așteptare al utilizatorului.
  check('timeout-ul se oprește la bugetul declarat',
    elapsed < TURSO_TIMEOUT_MS + AUDIT_TIMEOUT_MS + 500, `${elapsed}ms`);
  check('incidentele de scriere sunt numărate', watchStoreStats().tursoWriteFail === 2, JSON.stringify(watchStoreStats()));

  // (d) CITIRE cu Turso complet căzut: răspunsul vine din D1, nu o eroare 500.
  turso.state.down = true;
  const fallbackRead = await episodeSeconds(env, 1, 11);
  const fallbackCont = await continueRows(env, 1, 8);
  const fallbackAgg = await weeklyAggregate(env);
  turso.state.down = false;
  check('citirea cade pe D1 când Turso nu răspunde', fallbackRead === 180, String(fallbackRead));
  check('„Continuă vizionarea” cade pe D1', fallbackCont.length === 1 && Number(fallbackCont[0].episode_id) === 11);
  check('topul semnalează că trebuie recalculat din D1', fallbackAgg === null);
  check('eșecurile de citire sunt numărate', watchStoreStats().tursoReadFail >= 3, JSON.stringify(watchStoreStats()));
}

// =====================================================================
console.log('\n── 6. Cereri concurente pe același (user, episod) ──');
// =====================================================================
for (const mode of ['d1', 'shadow', 'turso']) {
  const { env, d1, turso } = makeEnv(mode);
  seed(d1);
  const results = await Promise.all(Array.from({ length: 5 }, () =>
    bumpProgress(env, { userId: 1, episodeId: 10, seriesId: 1, inc: 60 })));
  const store = mode === 'turso' ? tursoSeconds(turso, 1, 10) : d1Seconds(d1, 1, 10);
  check(`${mode}: 5 heartbeat-uri concurente = 300s, fără pierderi`, store === 300, String(store));
  check(`${mode}: fiecare răspuns e un total crescător distinct`,
    new Set(results.map((r) => r.seconds)).size === 5, JSON.stringify(results.map((r) => r.seconds)));
  if (mode === 'shadow') {
    check('shadow: umbra ajunge la aceeași valoare', tursoSeconds(turso, 1, 10) === 300);
  }
}

// =====================================================================
console.log('\n── 7. Recompensă exact o dată, cu progresul în Turso ──');
// =====================================================================
async function postProgress(env, userId, episodeId, seconds) {
  const token = await signJWT({ id: userId }, env.JWT_SECRET, 3600);
  const request = new Request('https://anime-uke.test/api/progress', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://anime-uke.test',
      Cookie: `token=${token}`,
    },
    body: JSON.stringify({ episode_id: episodeId, seconds }),
  });
  const response = await progressPost({ request, env });
  return { status: response.status, body: await response.json() };
}

{
  const { env, d1, turso } = makeEnv('turso');
  seed(d1);
  // 15 minute = pragul; trimitem 3 × 300s, apoi încă 3 heartbeat-uri.
  const responses = [];
  for (let i = 0; i < 6; i++) responses.push(await postProgress(env, 1, 10, 300));
  const awarded = responses.filter((r) => r.body.pointsAdded > 0);
  const points = d1.raw.prepare('SELECT points FROM users WHERE id = 1').get().points;
  const history = d1.raw.prepare('SELECT COUNT(*) AS n FROM watched_history WHERE user_id = 1').get().n;
  check('punctele se acordă o singură dată', awarded.length === 1, JSON.stringify(responses.map((r) => r.body.pointsAdded)));
  check('users.points = 10 (nu 20, nu 60)', points === 10, String(points));
  check('watched_history are exact un rând', Number(history) === 1, String(history));
  check('marcajul „vizionat” apare la pragul de 15 minute', responses[2].body.watched === true);
  check('răspunsul spune din ce bază vine totalul', responses[5].body.store === 'turso');
  check('progresul total e în Turso', tursoSeconds(turso, 1, 10) === 1800);
  check('D1 nu are rânduri de progres', d1Seconds(d1, 1, 10) === null);

  // Aceeași garanție când Turso pică exact la trecerea pragului.
  const second = makeEnv('turso');
  seed(second.d1);
  await postProgress(second.env, 1, 10, 300);
  await postProgress(second.env, 1, 10, 300);
  second.turso.state.down = true;
  const during = await postProgress(second.env, 1, 10, 300);
  second.turso.state.down = false;
  const after = await postProgress(second.env, 1, 10, 300);
  const pts = second.d1.raw.prepare('SELECT points FROM users WHERE id = 1').get().points;
  check('fallback în timpul pragului: răspunsul rămâne 200', during.status === 200 && during.body.fallback === true);
  check('fallback + revenire: tot 10 puncte, o singură dată', pts === 10, `${pts} · ${JSON.stringify([during.body.pointsAdded, after.body.pointsAdded])}`);
}

// Recompensă unică și în shadow (etapa în care D1 e sursa oficială).
{
  const { env, d1, turso } = makeEnv('shadow');
  seed(d1);
  for (let i = 0; i < 4; i++) await postProgress(env, 1, 10, 300);
  const points = d1.raw.prepare('SELECT points FROM users WHERE id = 1').get().points;
  check('shadow: 10 puncte, o singură dată', points === 10, String(points));
  check('shadow: D1 și Turso au același total', d1Seconds(d1, 1, 10) === 1200 && tursoSeconds(turso, 1, 10) === 1200);
}

// =====================================================================
console.log('\n── 8. Cufere, topuri și „Continuă vizionarea” prin handlerele reale ──');
// =====================================================================
async function authedGet(env, url, userId = 1) {
  const token = await signJWT({ id: userId }, env.JWT_SECRET, 3600);
  return new Request(url, { headers: { Cookie: `token=${token}` } });
}

{
  const { env, d1, turso } = makeEnv('turso');
  seed(d1);
  // 40 de minute pe episodul 10 și 20 pe 11 (primul cufăr cere 30 min/serie).
  for (let i = 0; i < 8; i++) await postProgress(env, 1, 10, 300);
  for (let i = 0; i < 4; i++) await postProgress(env, 1, 11, 300);

  const cont = await continueGet({ request: await authedGet(env, 'https://anime-uke.test/api/continue'), env });
  const contBody = await cont.json();
  check('„Continuă vizionarea” întoarce ambele episoade', contBody.items.length === 2, JSON.stringify(contBody.items.map((i) => i.episode_id)));
  check('cel mai recent episod e primul', Number(contBody.items[0].episode_id) === 11);
  check('metadatele (titlu serie, următorul episod) vin din D1',
    contBody.items[1].series_title === 'Serie test' && Number(contBody.items[1].next_episode_id) === 11,
    JSON.stringify(contBody.items[1]));

  const chests = await chestsGet({ request: await authedGet(env, 'https://anime-uke.test/api/chests?series_id=1'), env });
  const chestBody = await chests.json();
  check("cuferele văd secundele din Turso", chestBody.total_seconds === 3600, JSON.stringify(chestBody.total_seconds));
  check('primul cufăr e deblocat de timpul din Turso', chestBody.chests[0].unlocked === true);

  const top = await topGet({ request: new Request('https://anime-uke.test/api/top'), env });
  const topBody = await top.json();
  check('topul săptămânal se construiește din Turso + titluri din D1',
    topBody.weekly.length === 1 && topBody.weekly[0].title === 'Serie test' && topBody.weekly[0].seconds === 3600,
    JSON.stringify(topBody.weekly));

  // Turso căzut → topul cade pe interogarea D1 (care, în modul turso, nu mai
  // are rânduri): răspunsul rămâne valid, nu o eroare.
  turso.state.down = true;
  const topDown = await topGet({ request: new Request('https://anime-uke.test/api/top'), env });
  turso.state.down = false;
  check('topul răspunde 200 și cu Turso căzut', topDown.status === 200);
}

// =====================================================================
console.log('\n── 9. Comparația D1 ↔ Turso (backfill verificat) ──');
// =====================================================================
{
  const d1Rows = normalizeRows([
    { user_id: 1, episode_id: 10, series_id: 1, seconds: 600, updated_at: '2026-09-27 10:00:00' },
    { user_id: 1, episode_id: 11, series_id: 1, seconds: 300, updated_at: '2026-09-27 10:05:00' },
    { user_id: 2, episode_id: 10, series_id: 1, seconds: 120, updated_at: '2026-09-27 10:06:00' },
  ]);
  const identic = normalizeRows([
    { user_id: 1, episode_id: 10, series_id: 1, seconds: 600 },
    { user_id: 1, episode_id: 11, series_id: 1, seconds: 300 },
    { user_id: 2, episode_id: 10, series_id: 1, seconds: 120 },
  ]);
  const egal = compareMaps(d1Rows, identic, 0);
  check('baze identice → zero diferențe', egal.missing.length === 0 && egal.differing.length === 0 && egal.extra.length === 0);

  const stricat = normalizeRows([
    { user_id: 1, episode_id: 10, series_id: 1, seconds: 600 },
    { user_id: 2, episode_id: 10, series_id: 1, seconds: 100 },
    { user_id: 3, episode_id: 10, series_id: 1, seconds: 60 },
  ]);
  const diff = compareMaps(d1Rows, stricat, 0);
  check('rând lipsă în Turso este raportat', diff.missing.length === 1 && diff.missing[0].episodeId === 11);
  check('rând doar în Turso este raportat', diff.extra.length === 1 && diff.extra[0].userId === 3);
  check('diferența de secunde este raportată cu delta', diff.differing.length === 1 && diff.differing[0].delta === -20);
  check('delta maxim este măsurat', diff.maxDelta === 20, String(diff.maxDelta));
  const tolerat = compareMaps(d1Rows, stricat, 300);
  check('toleranța (un heartbeat în zbor) nu ascunde rândurile lipsă',
    tolerat.differing.length === 0 && tolerat.missing.length === 1);
}

// =====================================================================
console.log('\n── 10. Bugetul: cât scade D1 ──');
// =====================================================================
{
  // Proiecția din README/bench: 500 × 12 episoade × 24 min, heartbeat 300s.
  const watchers = 500;
  const episodes = watchers * 12;
  const heartbeats = Math.ceil(24 / 5); // episod de 24 min, lot de 5 min
  const heartbeatWrites = episodes * heartbeats;
  const rest = episodes * 5 + watchers * 2 + Math.ceil(episodes / 20);
  check('heartbeat-urile sunt ~30.000 scrieri/zi', heartbeatWrites === 30_000, String(heartbeatWrites));
  check('D1 după mutare ≈ 31.300/zi', Math.abs((rest) - 31_300) <= 100, String(rest));
  check('D1 înainte ≈ 61.300/zi', Math.abs(heartbeatWrites + rest - 61_300) <= 100, String(heartbeatWrites + rest));
}

console.log(`\nwatch-store: ${passed} verzi, ${failed} roșii`);
if (failed) process.exit(1);
