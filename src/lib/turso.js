// =====================================================================
// Client Turso pentru runtime-uri edge (Cloudflare Workers).
//
// Baza `turso://` nouă folosește protocolul Hrana v3. Driverul oficial
// @tursodatabase/serverless este inclus local pentru ca buildul Pages fără
// `npm install` să-l poată rezolva; folosește numai fetch și funcționează în
// Pages/Workers, precum și în scripturile Node de deploy.
// Tokenul vine exclusiv din bindingul secret TURSO_AUTH_TOKEN și nu este
// inclus niciodată în erori sau loguri.
// =====================================================================

import { Session } from '../vendor/turso-serverless.js';

const DEFAULT_TIMEOUT_MS = 8_000;
const sessions = new WeakMap();

function credential(value, name) {
  let raw = String(value || '').trim();
  // Acceptăm defensiv și valoarea copiată ca linie .env în GitHub Secrets.
  const assignment = raw.match(new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*([\\s\\S]*)$`, 'i'));
  if (assignment) raw = assignment[1].trim();
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith("'") && raw.endsWith("'")))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

export function hasTurso(env) {
  return !!(credential(env?.TURSO_DATABASE_URL, 'TURSO_DATABASE_URL')
    && credential(env?.TURSO_AUTH_TOKEN, 'TURSO_AUTH_TOKEN'));
}

export function tursoBaseUrl(value) {
  const raw = credential(value, 'TURSO_DATABASE_URL');
  if (!raw) throw new Error('TURSO_DATABASE_URL lipsește');

  // Dashboardul/CLI-ul poate furniza libsql:// sau turso://, iar driverul
  // normalizează aceste scheme la HTTPS. Curățăm și un endpoint lipit manual.
  const http = raw
    .replace(/^libsql:/i, 'https:')
    .replace(/^turso:/i, 'https:')
    .replace(/^wss?:/i, 'https:');
  const url = new URL(http);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Protocol Turso invalid');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname
    .replace(/\/v[23]\/(?:pipeline|cursor)\/?$/i, '')
    .replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

// Păstrat ca reper explicit/testabil: interogările driverului merg prin cursor v3.
export function tursoPipelineUrl(value) {
  return `${tursoBaseUrl(value)}/v3/cursor`;
}

function safeErrorMessage(error) {
  const message = String(error?.message || error || 'eroare necunoscută');
  // Un server nu ar trebui să repete Authorization, dar nu propagăm niciun
  // șir lung care ar putea fi un token reflectat într-un răspuns de eroare.
  return message.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').slice(0, 300);
}

function stateFor(env) {
  const url = tursoBaseUrl(env?.TURSO_DATABASE_URL);
  const authToken = credential(env?.TURSO_AUTH_TOKEN, 'TURSO_AUTH_TOKEN');
  if (!authToken) throw new Error('TURSO_AUTH_TOKEN lipsește');

  // Un singur stream per env/isolate, serializat ca să nu amestecăm batonul
  // Hrana între cereri concurente. Driverul păstrează conexiunea HTTP eficient.
  if (env && (typeof env === 'object' || typeof env === 'function')) {
    const current = sessions.get(env);
    if (current?.url === url && current?.authToken === authToken) return current;
    const state = {
      url,
      authToken,
      session: new Session({ url, authToken, defaultQueryTimeout: DEFAULT_TIMEOUT_MS }),
      tail: Promise.resolve(),
    };
    sessions.set(env, state);
    return state;
  }
  return {
    url,
    authToken,
    session: new Session({ url, authToken, defaultQueryTimeout: DEFAULT_TIMEOUT_MS }),
    tail: Promise.resolve(),
  };
}

async function withSession(env, task) {
  const state = stateFor(env);
  const previous = state.tail;
  let release;
  state.tail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await task(state.session);
  } catch (error) {
    throw new Error(`Turso: ${safeErrorMessage(error)}`);
  } finally {
    release();
  }
}

function normalizeRow(row, columns) {
  if (Array.isArray(row)) {
    return Object.fromEntries(columns.map((name, index) => [name, row[index]]));
  }
  if (row && typeof row === 'object') return { ...row };
  return {};
}

function normalizeResult(result = {}) {
  const columns = Array.isArray(result.columns) ? result.columns : [];
  const last = result.lastInsertRowid;
  return {
    rows: (Array.isArray(result.rows) ? result.rows : []).map((row) => normalizeRow(row, columns)),
    rowsAffected: Number(result.rowsAffected) || 0,
    lastInsertId: last == null ? 0 : Number(last),
  };
}

export async function tursoPipeline(env, statements, options = {}) {
  if (!hasTurso(env)) throw new Error('Credențialele Turso lipsesc');
  const list = Array.isArray(statements) ? statements.map((statement) => ({
    sql: String(statement?.sql || ''),
    args: Array.isArray(statement?.args) ? statement.args : [],
  })) : [];
  if (!list.length) return [];

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  return withSession(env, async (session) => {
    if (list.length === 1) {
      const result = await session.execute(list[0].sql, list[0].args, false, { queryTimeout: timeoutMs });
      return [normalizeResult(result)];
    }
    // Fără mod tranzacțional: fiecare statement rămâne idempotent/autocommit,
    // aceeași semantică folosită de backfill-ul pe bucăți.
    const results = await session.batch(list, undefined, { queryTimeout: timeoutMs });
    return results.map(normalizeResult);
  });
}

export async function tursoExecute(env, sql, args = [], options = {}) {
  const [result] = await tursoPipeline(env, [{ sql, args }], options);
  return result;
}
