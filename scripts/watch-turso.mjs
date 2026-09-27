#!/usr/bin/env node
// =====================================================================
// watch-turso.mjs — uneltele de etapizare pentru mutarea `watch_progress`
// din D1 în Turso. Nu atinge nimic din migrarea/backfill-ul de DM
// (`scripts/turso-migrate.mjs`) și nu șterge NIMIC — nici din D1, nici
// din Turso. Ștergerea/compactarea e o etapă separată, ulterioară.
//
//   node scripts/watch-turso.mjs backfill <export-d1.json>
//       Importă idempotent progresul din D1 în Turso. Regula de fuziune
//       este MAX(seconds): progresul e monoton, deci o rulare repetată
//       (sau una peste un heartbeat proaspăt) nu poate întoarce timpul.
//
//   node scripts/watch-turso.mjs compare <export-d1.json> [--tolerance 300]
//       Compară rând cu rând D1 și Turso și RAPORTEAZĂ: lipsă, în plus,
//       diferențe de secunde, delta maxim. Iese cu 1 dacă găsește ceva
//       peste toleranță (toleranța acoperă un heartbeat în zbor: 300s).
//
//   node scripts/watch-turso.mjs report [--hours 24]
//       Jurnalul de incidente (`watch_store_audit`): divergențe, eșecuri
//       de scriere/citire, fallback-uri. „Fallback” nu ascunde erori;
//       fiecare are un rând aici.
//
//   node scripts/watch-turso.mjs user <user_id>
//       Rândurile unui utilizator din Turso (folosit de canarul live ca
//       dovadă directă, nu prin API).
//
//   node scripts/watch-turso.mjs purge-user <user_id>
//       Șterge rândurile unui cont TEMPORAR de canar. Turso nu are
//       ON DELETE CASCADE spre `users` (tabelul e în D1), deci curățenia
//       canarului trebuie făcută explicit. NU o folosi pe conturi reale.
//
//   node scripts/watch-turso.mjs count
//       Numărul de rânduri și suma secundelor din Turso (verificare directă).
//
// Exportul D1 se face cu:
//   wrangler d1 execute DB --remote --json --command \
//     "SELECT wp.user_id, wp.episode_id, e.series_id, wp.seconds, wp.updated_at \
//        FROM watch_progress wp JOIN episodes e ON e.id = wp.episode_id"
// =====================================================================

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hasTurso, tursoExecute, tursoPipeline } from '../src/lib/turso.js';

const env = process.env;
const argv = process.argv.slice(2);
const command = argv[0] || '';
const numFlag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(argv[i + 1]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
};

/** Ieșirea `wrangler d1 execute --json` e un array de rezultate. */
export function d1Rows(parsed) {
  if (Array.isArray(parsed)) return parsed.flatMap((entry) => entry?.results || []);
  return parsed?.results || [];
}

/** Normalizare comună, ca să comparăm mere cu mere. */
export function normalizeRows(rows) {
  const out = new Map();
  for (const row of rows) {
    const userId = Number(row.user_id);
    const episodeId = Number(row.episode_id);
    if (!(userId > 0) || !(episodeId > 0)) continue;
    out.set(`${userId}:${episodeId}`, {
      userId,
      episodeId,
      seriesId: Number(row.series_id) || 0,
      seconds: Number(row.seconds) || 0,
      updatedAt: String(row.updated_at || ''),
    });
  }
  return out;
}

async function loadD1(path) {
  if (!path) throw new Error('lipsește fișierul cu exportul D1');
  return normalizeRows(d1Rows(JSON.parse(await readFile(resolve(path), 'utf8'))));
}

async function loadTurso() {
  const all = new Map();
  const PAGE = 5_000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await tursoExecute(env,
      `SELECT user_id, episode_id, series_id, seconds, updated_at
         FROM watch_progress ORDER BY user_id, episode_id LIMIT ? OFFSET ?`,
      [PAGE, offset], { timeoutMs: 30_000 });
    for (const [key, value] of normalizeRows(res.rows)) all.set(key, value);
    if (res.rows.length < PAGE) break;
  }
  return all;
}

async function backfill(path) {
  const rows = [...(await loadD1(path)).values()];
  let touched = 0;
  for (let offset = 0; offset < rows.length; offset += 50) {
    const chunk = rows.slice(offset, offset + 50);
    const results = await tursoPipeline(env, chunk.map((row) => ({
      // MAX() peste tot: idempotent și sigur dacă un heartbeat a scris deja
      // în Turso o valoare mai mare decât cea exportată din D1.
      sql: `INSERT INTO watch_progress (user_id, episode_id, series_id, seconds, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, episode_id) DO UPDATE SET
              seconds    = MAX(watch_progress.seconds, excluded.seconds),
              series_id  = MAX(watch_progress.series_id, excluded.series_id),
              updated_at = MAX(watch_progress.updated_at, excluded.updated_at)`,
      args: [row.userId, row.episodeId, row.seriesId, row.seconds, row.updatedAt || null],
    })), { timeoutMs: 30_000 });
    touched += results.reduce((sum, result) => sum + result.rowsAffected, 0);
  }
  console.log(`  ✓ backfill D1 → Turso: ${rows.length} rânduri trimise, ${touched} scrise/actualizate`);
  return rows.length;
}

function compareMaps(d1, turso, tolerance) {
  const missing = [];   // în D1, lipsă în Turso
  const extra = [];     // în Turso, absent în D1 (normal după cutover)
  const differing = [];
  let maxDelta = 0;

  for (const [key, row] of d1) {
    const other = turso.get(key);
    if (!other) { missing.push(row); continue; }
    const delta = other.seconds - row.seconds;
    if (delta !== 0) {
      maxDelta = Math.max(maxDelta, Math.abs(delta));
      if (Math.abs(delta) > tolerance) differing.push({ ...row, turso: other.seconds, delta });
    }
  }
  for (const [key, row] of turso) if (!d1.has(key)) extra.push(row);
  return { missing, extra, differing, maxDelta };
}

async function compare(path, tolerance) {
  const d1 = await loadD1(path);
  const turso = await loadTurso();
  const { missing, extra, differing, maxDelta } = compareMaps(d1, turso, tolerance);

  console.log(`  D1:    ${d1.size} rânduri`);
  console.log(`  Turso: ${turso.size} rânduri`);
  console.log(`  lipsă în Turso:      ${missing.length}`);
  console.log(`  doar în Turso:       ${extra.length} (normal după cutover: scrieri noi)`);
  console.log(`  diferențe > ${tolerance}s:     ${differing.length}`);
  console.log(`  delta maxim observat: ${maxDelta}s`);
  for (const row of [...missing.slice(0, 5), ...differing.slice(0, 5)]) {
    console.log(`    · user=${row.userId} ep=${row.episodeId} d1=${row.seconds} turso=${row.turso ?? '—'}`);
  }
  const bad = missing.length > 0 || differing.length > 0;
  console.log(bad ? '  ✗ D1 și Turso NU coincid' : '  ✓ D1 și Turso coincid (în limita toleranței)');
  return !bad;
}

async function report(hours) {
  const res = await tursoExecute(env,
    `SELECT kind, COUNT(*) AS n, MAX(created_at) AS last
       FROM watch_store_audit
      WHERE created_at >= datetime('now', ?)
      GROUP BY kind ORDER BY n DESC`,
    [`-${hours} hours`], { timeoutMs: 20_000 });
  if (!res.rows.length) {
    console.log(`  ✓ niciun incident jurnalizat în ultimele ${hours} ore`);
    return true;
  }
  for (const row of res.rows) console.log(`  · ${row.kind}: ${row.n} (ultimul: ${row.last})`);
  const last = await tursoExecute(env,
    `SELECT kind, user_id, episode_id, d1_value, turso_value, detail, created_at
       FROM watch_store_audit ORDER BY id DESC LIMIT 10`, [], { timeoutMs: 20_000 });
  console.log('  ultimele 10 intrări:');
  for (const row of last.rows) {
    console.log(`    ${row.created_at} ${row.kind} user=${row.user_id} ep=${row.episode_id} d1=${row.d1_value} turso=${row.turso_value} ${row.detail}`);
  }
  return true;
}

async function count() {
  const res = await tursoExecute(env,
    `SELECT COUNT(*) AS n, COALESCE(SUM(seconds), 0) AS secunde,
            COUNT(DISTINCT user_id) AS useri
       FROM watch_progress`, [], { timeoutMs: 20_000 });
  const row = res.rows[0] || {};
  console.log(`  Turso watch_progress: ${row.n} rânduri · ${row.useri} utilizatori · ${row.secunde} secunde`);
  return true;
}

async function userRows(id) {
  const res = await tursoExecute(env,
    `SELECT user_id, episode_id, series_id, seconds, updated_at
       FROM watch_progress WHERE user_id = ? ORDER BY episode_id`,
    [Number(id) || 0], { timeoutMs: 20_000 });
  if (!res.rows.length) { console.log(`  (niciun rând în Turso pentru user ${id})`); return false; }
  for (const row of res.rows) {
    console.log(`  user=${row.user_id} ep=${row.episode_id} serie=${row.series_id} secunde=${row.seconds} (${row.updated_at})`);
  }
  return true;
}

async function purgeUser(id) {
  const res = await tursoExecute(env, 'DELETE FROM watch_progress WHERE user_id = ?',
    [Number(id) || 0], { timeoutMs: 20_000 });
  console.log(`  ✓ șterse ${res.rowsAffected} rânduri de canar din Turso (user ${id})`);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (!hasTurso(env)) throw new Error('Lipsesc TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');
    let ok = true;
    if (command === 'backfill') await backfill(argv[1]);
    else if (command === 'compare') ok = await compare(argv[1], numFlag('tolerance', 300));
    else if (command === 'report') ok = await report(numFlag('hours', 24));
    else if (command === 'count') ok = await count();
    else if (command === 'user') ok = await userRows(argv[1]);
    else if (command === 'purge-user') ok = await purgeUser(argv[1]);
    else throw new Error(`comandă necunoscută: "${command}" (backfill|compare|report|count|user|purge-user)`);
    if (!ok) process.exit(1);
  } catch (error) {
    console.error(`  ✗ watch-turso ${command}: ${error.message}`);
    process.exit(1);
  }
}

export { backfill, compare, compareMaps, report, count, userRows, purgeUser };
