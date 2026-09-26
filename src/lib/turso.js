// =====================================================================
// Client Turso/libSQL minimal pentru runtime-uri edge (Cloudflare Workers).
//
// Folosim protocolul oficial SQL over HTTP în locul unui SDK greu: un singur
// POST /v2/pipeline, cu parametri tipizați. Tokenul vine exclusiv din bindingul
// secret TURSO_AUTH_TOKEN și nu este inclus niciodată în erori sau loguri.
// =====================================================================

const DEFAULT_TIMEOUT_MS = 8_000;

export function hasTurso(env) {
  return !!(String(env?.TURSO_DATABASE_URL || '').trim()
    && String(env?.TURSO_AUTH_TOKEN || '').trim());
}

export function tursoPipelineUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('TURSO_DATABASE_URL lipsește');

  // Dashboardul/CLI-ul poate furniza libsql://, iar endpointul HTTP cere
  // https://. Acceptăm și formele mai noi turso:// / wss://.
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
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v2\/pipeline$/i.test(path) ? path : `${path}/v2/pipeline`;
  return url.toString();
}

export function tursoArg(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  if (typeof value === 'bigint') return { type: 'integer', value: String(value) };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Parametru SQL numeric invalid');
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value };
  }
  return { type: 'text', value: String(value) };
}

function decodeCell(cell) {
  if (cell === null || cell === undefined) return null;
  // Celulele din `rows` sunt Value-uri tipizate. `last_insert_rowid` este însă
  // serializat de protocol ca string/număr simplu, în funcție de versiune.
  if (typeof cell === 'string' || typeof cell === 'number') return cell;
  if (cell.type === 'null') return null;
  if (cell.type === 'integer') {
    const n = Number(cell.value);
    return Number.isSafeInteger(n) ? n : String(cell.value);
  }
  if (cell.type === 'float') return Number(cell.value);
  if (cell.type === 'blob') return cell.base64 || '';
  return cell.value ?? null;
}

function safeErrorMessage(error) {
  const message = String(error?.message || error || 'eroare necunoscută');
  // Un server nu ar trebui să repete Authorization, dar nu propagăm niciun
  // șir lung care ar putea fi un token reflectat într-un răspuns de eroare.
  return message.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').slice(0, 300);
}

export async function tursoPipeline(env, statements, options = {}) {
  if (!hasTurso(env)) throw new Error('Credențialele Turso lipsesc');
  const list = Array.isArray(statements) ? statements : [];
  if (!list.length) return [];

  const requests = list.map((statement) => ({
    type: 'execute',
    stmt: {
      sql: String(statement.sql || ''),
      ...(Array.isArray(statement.args) && statement.args.length
        ? { args: statement.args.map(tursoArg) }
        : {}),
    },
  }));
  requests.push({ type: 'close' });

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  let response;
  try {
    response = await fetch(tursoPipelineUrl(env.TURSO_DATABASE_URL), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(env.TURSO_AUTH_TOKEN).trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`Turso indisponibil: ${safeErrorMessage(error)}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Turso a răspuns HTTP ${response.status} fără JSON valid`);
  }
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(`Turso a refuzat cererea: ${safeErrorMessage(detail)}`);
  }

  const results = Array.isArray(payload?.results) ? payload.results.slice(0, list.length) : [];
  if (results.length !== list.length) throw new Error('Răspuns Turso incomplet');

  return results.map((item) => {
    if (item?.type !== 'ok' || item?.response?.type !== 'execute') {
      const detail = item?.error?.message || item?.error || 'execuție SQL eșuată';
      throw new Error(`Turso SQL: ${safeErrorMessage(detail)}`);
    }
    const result = item.response.result || {};
    const columns = (result.cols || []).map((column) => column.name);
    const rows = (result.rows || []).map((row) => Object.fromEntries(
      columns.map((name, index) => [name, decodeCell(row[index])])
    ));
    const last = decodeCell(result.last_insert_rowid);
    return {
      rows,
      rowsAffected: Number(result.affected_row_count) || 0,
      lastInsertId: last == null ? 0 : Number(last),
    };
  });
}

export async function tursoExecute(env, sql, args = [], options = {}) {
  const [result] = await tursoPipeline(env, [{ sql, args }], options);
  return result;
}
