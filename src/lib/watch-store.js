// =====================================================================
// watch-store.js — unde trăiește `watch_progress`: D1, Turso sau ambele.
//
// CONTEXT DE BUGET ($0, fără card, fără pay-as-you-go)
// ----------------------------------------------------
// D1 gratuit = 100.000 rows_written/zi. Proiecția pentru 500 spectatori ×
// 12 episoade × 24 minute este ~61.300 scrieri/zi, din care ~30.000 sunt
// heartbeat-urile de progres. Mutând DOAR progresul în Turso (planul
// gratuit al bazei existente `anime-uke-messages`, aceleași credențiale,
// niciun serviciu nou), proiecția D1 coboară la ~31.300/zi.
//
// TREI MODURI, comutabile fără deploy de cod (`WATCH_STORE`):
//   d1      — comportamentul istoric. Turso nici măcar nu e atins.
//   shadow  — se scrie în AMÂNDOUĂ; D1 rămâne sursa oficială (răspunsul
//             utilizatorului vine din D1). Turso e „umbra” verificată.
//             Orice diferență se MĂSOARĂ și se jurnalizează.
//   turso   — Turso e sursa oficială pentru progres. La eroare/timeout
//             se cade controlat pe D1 (progresul nu se pierde niciodată),
//             incidentul se jurnalizează, iar `watch-turso.mjs reconcile`
//             împacă rândurile rămase în urmă (regula MAX).
//
// ROLLBACK INSTANT: `WATCH_STORE=d1` (o variabilă de mediu Pages/Worker).
// Nicio migrare nu se dă înapoi, niciun rând nu se șterge. Etapa de
// ȘTERGERE/COMPACTARE a vechilor rânduri D1 NU face parte din această
// lansare — se face separat, după o perioadă de verificare.
//
// CE RĂMÂNE ÎN D1, DELIBERAT: `watched_history`, punctele, XP, gold,
// misiunile, streak-ul. Recompensa „exact o dată” se bazează pe
// `INSERT OR IGNORE INTO watched_history` + `meta.changes` în ACEEAȘI
// bază cu `users.points`. Mutarea ei ar transforma o garanție atomică
// într-un protocol distribuit — exact ce nu vrem la puncte.
//
// SEAM DE TEST: `env.__WATCH_TURSO__` (dacă există) înlocuiește driverul
// Turso cu o funcție `(statements, options) => results`. Nu e folosit în
// producție; există ca `tests/watch-store.mjs` să poată simula timeout-uri,
// erori și concurență fără rețea.
// =====================================================================

import { hasTurso, tursoPipeline } from './turso.js';

/** Buget dur per operație Turso pe calea fierbinte (heartbeat la 5 min). */
export const TURSO_TIMEOUT_MS = 2_500;
/**
 * REÎNCERCĂRI: o singură reîncercare, dar NUMAI la CITIRE.
 *
 * Scrierea este un increment (`seconds = seconds + inc`), deci NU e
 * idempotentă: dacă prima încercare a ajuns la bază și doar răspunsul s-a
 * pierdut, o reîncercare ar adăuga a doua oară aceleași secunde — timp de
 * vizionare inventat, cufere și top falsificate. Preferăm at-most-once plus
 * fallback pe D1 (progresul nu se pierde, cel mult se întârzie cu un
 * heartbeat). Vezi `tests/watch-store.mjs` → „scrierea nu se reîncearcă”.
 */
export const TURSO_RETRIES = 1;
export const TURSO_WRITE_RETRIES = 0;
/**
 * Jurnalul de incidente are buget PROPRIU, mai mic: dacă Turso e lent,
 * nu vrem ca notarea incidentului să mai adauge o dată timpul de așteptare
 * peste cererea utilizatorului. Bugetul total al unui heartbeat cu fallback
 * rămâne astfel TURSO_TIMEOUT_MS + AUDIT_TIMEOUT_MS.
 */
export const AUDIT_TIMEOUT_MS = 1_000;

/** Contoare per-izolat, citite de `/api/progress` în răspunsul de diagnostic. */
const stats = {
  writes: 0, tursoWrites: 0, tursoWriteFail: 0, tursoReadFail: 0,
  fallbacks: 0, divergences: 0, shadowChecks: 0,
};

export function watchStoreStats() {
  return { ...stats };
}

export function resetWatchStoreStats() {
  for (const key of Object.keys(stats)) stats[key] = 0;
}

/**
 * Modul efectiv. Fără credențiale Turso rămânem pe D1 indiferent de flag:
 * o configurație incompletă nu are voie să blocheze progresul userilor.
 */
export function watchStoreMode(env) {
  const raw = String(env?.WATCH_STORE || 'd1').trim().toLowerCase();
  const wanted = raw === 'shadow' || raw === 'turso' ? raw : 'd1';
  // `__WATCH_TURSO__` e seam-ul de test (vezi antetul); în producție decid
  // exclusiv credențialele reale.
  const reachable = hasTurso(env) || typeof env?.__WATCH_TURSO__ === 'function';
  if (wanted !== 'd1' && !reachable) return 'd1';
  return wanted;
}

function driver(env) {
  if (typeof env?.__WATCH_TURSO__ === 'function') return env.__WATCH_TURSO__;
  return (statements, options) => tursoPipeline(env, statements, options);
}

/** Promisiune cu termen: protejează calea fierbinte de un Turso „lent”, nu doar „picat”. */
function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * Rulează un pipeline Turso cu termen și reîncercare.
 * Aruncă (cu mesaj scurt) dacă toate încercările eșuează — apelantul decide
 * fallback-ul; NU înghițim eroarea aici.
 */
export async function tursoTry(env, statements, { timeoutMs = TURSO_TIMEOUT_MS, retries = TURSO_RETRIES, label = 'turso' } = {}) {
  const run = driver(env);
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(
        Promise.resolve(run(statements, { timeoutMs })),
        timeoutMs,
        label,
      );
    } catch (error) {
      last = error;
    }
  }
  throw last || new Error(`${label}: eroare necunoscută`);
}

/**
 * Jurnal de incident/divergență — în Turso, ca observabilitatea să nu
 * consume cota D1 pe care o economisim. Best-effort: dacă până și jurnalul
 * pică, incidentul rămâne în logul Workerului (`console.warn`), niciodată
 * ascuns complet.
 */
export async function auditWatchStore(env, entry) {
  const row = {
    kind: String(entry?.kind || 'unknown'),
    user_id: Number(entry?.userId) || 0,
    episode_id: Number(entry?.episodeId) || 0,
    d1_value: Number(entry?.d1) || 0,
    turso_value: Number(entry?.turso) || 0,
    detail: String(entry?.detail || '').slice(0, 300),
  };
  console.warn(`watch-store ${row.kind}: user=${row.user_id} ep=${row.episode_id} d1=${row.d1_value} turso=${row.turso_value} ${row.detail}`);
  if (!hasTurso(env) && typeof env?.__WATCH_TURSO__ !== 'function') return false;
  try {
    await tursoTry(env, [{
      sql: `INSERT INTO watch_store_audit (kind, user_id, episode_id, d1_value, turso_value, detail)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [row.kind, row.user_id, row.episode_id, row.d1_value, row.turso_value, row.detail],
    }], { retries: 0, timeoutMs: AUDIT_TIMEOUT_MS, label: 'audit' });
    return true;
  } catch (error) {
    console.warn(`watch-store: jurnalul nu s-a putut scrie: ${error?.message || error}`);
    return false;
  }
}

// ---------------------------------------------------------------------
// SCRIERE
// ---------------------------------------------------------------------

const D1_BUMP_SQL = `INSERT INTO watch_progress (user_id, episode_id, seconds)
   VALUES (?, ?, ?)
   ON CONFLICT(user_id, episode_id)
   DO UPDATE SET seconds = seconds + ?, updated_at = datetime('now')
   RETURNING seconds`;

const TURSO_BUMP_SQL = `INSERT INTO watch_progress (user_id, episode_id, series_id, seconds, updated_at)
   VALUES (?, ?, ?, ?, datetime('now'))
   ON CONFLICT(user_id, episode_id)
   DO UPDATE SET seconds = watch_progress.seconds + excluded.seconds,
                 series_id = MAX(watch_progress.series_id, excluded.series_id),
                 updated_at = datetime('now')
   RETURNING seconds`;

async function d1Bump(env, userId, episodeId, inc) {
  const row = await env.DB.prepare(D1_BUMP_SQL).bind(userId, episodeId, inc, inc).first();
  return Number(row?.seconds) || inc;
}

async function tursoBump(env, userId, episodeId, seriesId, inc) {
  const [result] = await tursoTry(env, [{
    sql: TURSO_BUMP_SQL,
    args: [userId, episodeId, Number(seriesId) || 0, inc],
  }], { label: 'bump', retries: TURSO_WRITE_RETRIES });
  const value = Number(result?.rows?.[0]?.seconds);
  return Number.isFinite(value) && value > 0 ? value : inc;
}

/**
 * Adaugă `inc` secunde la progresul (user, episod) și întoarce totalul
 * OFICIAL, adică cel al sursei de adevăr din modul curent.
 *
 * @returns {{seconds:number, source:'d1'|'turso', fallback:boolean, shadow:null|{seconds:number, delta:number, ok:boolean}}}
 */
export async function bumpProgress(env, { userId, episodeId, seriesId = 0, inc }) {
  const mode = watchStoreMode(env);
  stats.writes++;

  if (mode === 'd1') {
    return { seconds: await d1Bump(env, userId, episodeId, inc), source: 'd1', fallback: false, shadow: null };
  }

  if (mode === 'shadow') {
    // D1 rămâne sursa oficială: se scrie ÎNTÂI și răspunsul vine de la el.
    const seconds = await d1Bump(env, userId, episodeId, inc);
    let shadow = null;
    try {
      const mirrored = await tursoBump(env, userId, episodeId, seriesId, inc);
      stats.tursoWrites++;
      stats.shadowChecks++;
      const delta = mirrored - seconds;
      shadow = { seconds: mirrored, delta, ok: delta === 0 };
      if (delta !== 0) {
        stats.divergences++;
        await auditWatchStore(env, {
          kind: 'divergence', userId, episodeId, d1: seconds, turso: mirrored,
          detail: `shadow bump delta=${delta}`,
        });
      }
    } catch (error) {
      stats.tursoWriteFail++;
      await auditWatchStore(env, {
        kind: 'turso_write_fail', userId, episodeId, d1: seconds,
        detail: String(error?.message || error).slice(0, 200),
      });
    }
    return { seconds, source: 'd1', fallback: false, shadow };
  }

  // mode === 'turso'
  try {
    const seconds = await tursoBump(env, userId, episodeId, seriesId, inc);
    stats.tursoWrites++;
    return { seconds, source: 'turso', fallback: false, shadow: null };
  } catch (error) {
    // Fallback CONTROLAT: progresul se scrie în D1 (nu se pierde), dar
    // incidentul e numărat și jurnalizat, iar rândul rămâne de reconciliat.
    stats.tursoWriteFail++;
    stats.fallbacks++;
    const seconds = await d1Bump(env, userId, episodeId, inc);
    await auditWatchStore(env, {
      kind: 'fallback', userId, episodeId, d1: seconds,
      detail: `scriere în D1 după eșec Turso: ${String(error?.message || error).slice(0, 160)}`,
    });
    return { seconds, source: 'd1', fallback: true, shadow: null };
  }
}

// ---------------------------------------------------------------------
// CITIRI
//
// În modul `turso` citirile merg în Turso, cu cădere pe D1 la eroare:
// o pagină fără bara de progres e o degradare acceptabilă, o pagină 500
// nu este. Fiecare cădere se numără (`tursoReadFail`) și se jurnalizează.
// ---------------------------------------------------------------------

async function tursoRead(env, sql, args, fallback, label) {
  try {
    const [result] = await tursoTry(env, [{ sql, args }], { label });
    return result?.rows || [];
  } catch (error) {
    stats.tursoReadFail++;
    await auditWatchStore(env, { kind: 'turso_read_fail', detail: `${label}: ${String(error?.message || error).slice(0, 160)}` });
    return fallback();
  }
}

/** Secundele acumulate pe un episod (bara de progres din pagina episodului). */
export async function episodeSeconds(env, userId, episodeId) {
  const readD1 = async () => {
    const row = await env.DB.prepare('SELECT seconds FROM watch_progress WHERE user_id = ? AND episode_id = ?')
      .bind(userId, episodeId).first();
    return [{ seconds: Number(row?.seconds) || 0 }];
  };
  if (watchStoreMode(env) !== 'turso') return Number((await readD1())[0].seconds) || 0;
  const rows = await tursoRead(env,
    'SELECT seconds FROM watch_progress WHERE user_id = ? AND episode_id = ?',
    [userId, episodeId], readD1, 'episodeSeconds');
  return Number(rows[0]?.seconds) || 0;
}

/**
 * Marcajele „văzut/în curs” pentru episoadele unei pagini de serie.
 * Bucăți de 90 și în Turso: limita de parametri e o proprietate a SQLite,
 * nu a D1 (și oricum vrem aceeași formă de interogare în ambele baze).
 */
export async function progressForEpisodes(env, userId, episodeIds) {
  const ids = (episodeIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const marks = new Map();
  if (!ids.length) return marks;

  const readD1 = async () => {
    const out = [];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const res = await env.DB.prepare(
        `SELECT episode_id, seconds FROM watch_progress
          WHERE user_id = ? AND episode_id IN (${chunk.map(() => '?').join(',')})`
      ).bind(userId, ...chunk).all();
      out.push(...(res.results || []));
    }
    return out;
  };

  let rows;
  if (watchStoreMode(env) === 'turso') {
    rows = [];
    let failed = false;
    for (let i = 0; i < ids.length && !failed; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const part = await tursoRead(env,
        `SELECT episode_id, seconds FROM watch_progress
          WHERE user_id = ? AND episode_id IN (${chunk.map(() => '?').join(',')})`,
        [userId, ...chunk],
        async () => { failed = true; return null; },
        'progressForEpisodes');
      if (part) rows.push(...part);
    }
    if (failed) rows = await readD1();
  } else {
    rows = await readD1();
  }

  for (const row of rows) marks.set(Number(row.episode_id), Number(row.seconds) || 0);
  return marks;
}

/**
 * „Continuă vizionarea”: doar (episode_id, seconds, updated_at) vin din
 * store. Titlurile, coperțile și episodul următor rămân în D1 — sunt
 * citiri pe cheie primară, ieftine, și nu duplicăm catalogul în două baze.
 */
export async function continueRows(env, userId, limit = 8) {
  const readD1 = async () => {
    const res = await env.DB.prepare(
      `SELECT episode_id, seconds, updated_at FROM watch_progress
        WHERE user_id = ? AND seconds >= 30
        ORDER BY updated_at DESC LIMIT ?`
    ).bind(userId, limit).all();
    return res.results || [];
  };
  if (watchStoreMode(env) !== 'turso') return readD1();
  return tursoRead(env,
    `SELECT episode_id, seconds, updated_at FROM watch_progress
      WHERE user_id = ? AND seconds >= 30
      ORDER BY updated_at DESC LIMIT ?`,
    [userId, limit], readD1, 'continueRows');
}

/** Secundele unui utilizator pe o serie întreagă (cuferele). */
export async function seriesSeconds(env, userId, seriesId) {
  const readD1 = async () => {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(wp.seconds), 0) AS total
         FROM watch_progress wp
         JOIN episodes e ON e.id = wp.episode_id
        WHERE wp.user_id = ? AND e.series_id = ?`
    ).bind(userId, seriesId).first();
    return [{ total: Number(row?.total) || 0 }];
  };
  if (watchStoreMode(env) !== 'turso') return Number((await readD1())[0].total) || 0;
  const rows = await tursoRead(env,
    'SELECT COALESCE(SUM(seconds), 0) AS total FROM watch_progress WHERE user_id = ? AND series_id = ?',
    [userId, seriesId], readD1, 'seriesSeconds');
  return Number(rows[0]?.total) || 0;
}

/**
 * Agregatul topului săptămânal (id serie, spectatori, secunde).
 * Întoarce `null` în modurile d1/shadow: acolo topul rămâne interogarea
 * D1 existentă, cu JOIN-urile ei. În modul `turso` agregăm în Turso
 * (de asta există `series_id` denormalizat) și lăsăm titlurile pe seama D1.
 */
export async function weeklyAggregate(env) {
  if (watchStoreMode(env) !== 'turso') return null;
  const rows = await tursoRead(env,
    `SELECT series_id AS id, COUNT(DISTINCT user_id) AS watchers, SUM(seconds) AS seconds
       FROM watch_progress
      WHERE updated_at >= datetime('now', '-7 days') AND series_id > 0
      GROUP BY series_id
      ORDER BY watchers DESC, seconds DESC
      LIMIT 5`,
    [], async () => null, 'weeklyAggregate');
  if (!rows) return null; // eșec Turso → apelantul folosește calea D1
  return rows.map((row) => ({
    id: Number(row.id), watchers: Number(row.watchers) || 0, seconds: Number(row.seconds) || 0,
  }));
}
