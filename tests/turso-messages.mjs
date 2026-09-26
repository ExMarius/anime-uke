// Teste fără rețea pentru protocolul Turso și stratul de mesaje private.

import { ChatDO } from '../src/do/ChatDO.js';
import { tursoExecute, tursoPipeline, tursoPipelineUrl } from '../src/lib/turso.js';
import {
  insertPrivateMessage,
  markMessagesRead,
  messageHistory,
  messageSummaries,
} from '../src/lib/private-messages.js';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const env = {
  TURSO_DATABASE_URL: 'libsql://anime-uke-messages-example.turso.io',
  TURSO_AUTH_TOKEN: 'token-secret-care-nu-trebuie-logat',
  DB: { prepare() { throw new Error('D1 nu trebuie folosit când Turso e configurat'); } },
};

const calls = [];
const cell = (value) => value == null
  ? { type: 'null' }
  : Number.isInteger(value)
    ? { type: 'integer', value: String(value) }
    : { type: 'text', value: String(value) };
const response = (columns = [], rows = [], affected = 0, lastId = null) => ({
  columns,
  rows,
  affected,
  lastId,
});

const resultFor = (statement) => {
  if (/^INSERT INTO private_messages/i.test(statement.sql.trim())) {
    return response([], [], 1, 41);
  }
  if (/^UPDATE private_messages/i.test(statement.sql.trim())) return response([], [], 2, null);
  if (/^DELETE FROM private_messages/i.test(statement.sql.trim())) return response([], [], 1, null);
  if (/WITH relevant AS/i.test(statement.sql)) {
    return response(
      ['friend_id', 'last_message', 'last_message_at', 'last_sender_id', 'unread'],
      [[9, 'Salut', '2026-09-26 20:00:00', 9, 1]]);
  }
  if (/UNION ALL/i.test(statement.sql)) {
    return response(
      ['id', 'sender_id', 'recipient_id', 'message', 'created_at', 'read_at'],
      [[41, 7, 9, 'Salut', '2026-09-26 20:00:00', null]]);
  }
  return response(['n'], [[1]]);
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  // Ultimul pas este proba autocommit adăugată de driver, nu SQL-ul aplicației.
  const statements = body.batch.steps.slice(0, -1).map((step) => step.stmt);
  const results = statements.map((statement) => {
    calls.push({ url, init, statement });
    return resultFor(statement);
  });

  // /v3/cursor răspunde NDJSON: antetul cursorului, apoi intrările batchului.
  const entries = [{ baton: 'test-baton', base_url: null }];
  results.forEach((result, step) => {
    entries.push({
      type: 'step_begin', step,
      cols: result.columns.map((name) => ({ name, decltype: '' })),
    });
    entries.push(...result.rows.map((row) => ({ type: 'row', step, row: row.map(cell) })));
    entries.push({
      type: 'step_end', step, affected_row_count: result.affected,
      last_insert_rowid: result.lastId == null ? null : String(result.lastId),
    });
  });
  entries.push(
    { type: 'step_begin', step: results.length, cols: [] },
    { type: 'step_end', step: results.length, affected_row_count: 0, last_insert_rowid: null },
  );
  return new Response(`${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
};

try {
  check('libsql:// este normalizat la endpointul HTTPS /v3/cursor',
    tursoPipelineUrl(env.TURSO_DATABASE_URL) === 'https://anime-uke-messages-example.turso.io/v3/cursor');

  const simple = await tursoExecute(env, 'SELECT ? AS n', [7]);
  check('clientul decodează rândurile libSQL tipizate', simple.rows[0]?.n === 1, JSON.stringify(simple));
  const first = calls.at(-1);
  check('tokenul merge numai în Authorization, nu în URL/body',
    first.init.headers.Authorization === `Bearer ${env.TURSO_AUTH_TOKEN}`
      && !String(first.url).includes(env.TURSO_AUTH_TOKEN)
      && !String(first.init.body).includes(env.TURSO_AUTH_TOKEN));
  check('numerele sunt legate ca integer libSQL',
    first.statement.args[0]?.type === 'integer' && first.statement.args[0]?.value === '7',
    JSON.stringify(first.statement.args));

  const batch = await tursoPipeline(env, [
    { sql: 'INSERT INTO private_messages(sender_id, recipient_id, message) VALUES (?, ?, ?)', args: [7, 9, 'unu'] },
    { sql: 'INSERT INTO private_messages(sender_id, recipient_id, message) VALUES (?, ?, ?)', args: [7, 9, 'doi'] },
  ]);
  check('batchul v3 pentru backfill întoarce toate rezultatele',
    batch.length === 2 && batch.every((item) => item.rowsAffected === 1), JSON.stringify(batch));

  const inserted = await insertPrivateMessage(env, 7, 9, 'Salut', '2026-09-26 20:00:00');
  check('INSERT-ul DM întoarce id-ul Turso', inserted.rowsAffected === 1 && inserted.lastInsertId === 41,
    JSON.stringify(inserted));

  const summaries = await messageSummaries(env, 7, [9]);
  check('inbox-ul citește preview + unread din Turso',
    summaries[0]?.friend_id === 9 && summaries[0]?.last_message === 'Salut' && summaries[0]?.unread === 1,
    JSON.stringify(summaries));

  const history = await messageHistory(env, 7, 9, Number.MAX_SAFE_INTEGER, 100);
  check('istoricul privat este citit din Turso',
    history[0]?.id === 41 && history[0]?.message === 'Salut', JSON.stringify(history));

  const marked = await markMessagesRead(env, 7, 9);
  check('mark-as-read scrie în Turso', marked.rowsAffected === 2, JSON.stringify(marked));
  check('cu secrete Turso, nicio operație DM nu atinge D1', calls.length >= 5, `apeluri Turso=${calls.length}`);

  const socket = (userId, username) => ({
    sent: [],
    deserializeAttachment() { return { userId, username, avatar: '' }; },
    send(raw) { this.sent.push(JSON.parse(raw)); },
    close() {},
  });
  const directEnv = (acceptedAfterInsert = true) => ({
    ...env,
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (/SELECT u\.id/i.test(sql)) return { id: 9, username: 'ana', avatar: '' };
                if (/SELECT 1 AS ok/i.test(sql)) return acceptedAfterInsert ? { ok: 1 } : null;
                return null;
              },
            };
          },
        };
      },
    },
  });

  const sender = socket(7, 'marius');
  const recipient = socket(9, 'ana');
  const outsider = socket(11, 'intrus');
  const state = {
    getWebSockets() { return [sender, recipient, outsider]; },
    waitUntil() {},
  };
  const direct = new ChatDO(state, directEnv(true));
  await direct.webSocketMessage(sender, JSON.stringify({
    type: 'dm', recipient_id: 9, message: 'DM prin Turso',
  }));
  check('ChatDO persistă în Turso înainte de livrare',
    calls.some((call) => /^INSERT INTO private_messages/i.test(call.statement.sql.trim())));
  check('DM-ul Turso ajunge numai celor doi participanți',
    sender.sent.some((item) => item.type === 'dm' && item.id === 41)
      && recipient.sent.some((item) => item.type === 'dm' && item.id === 41)
      && !outsider.sent.some((item) => item.type === 'dm'),
    JSON.stringify({ sender: sender.sent, recipient: recipient.sent, outsider: outsider.sent }));

  const raceSender = socket(7, 'marius');
  const raceRecipient = socket(9, 'ana');
  const raceState = {
    getWebSockets() { return [raceSender, raceRecipient]; },
    waitUntil() {},
  };
  const beforeRace = calls.length;
  const raced = new ChatDO(raceState, directEnv(false));
  await raced.webSocketMessage(raceSender, JSON.stringify({
    type: 'dm', recipient_id: 9, message: 'Nu rămâne după unfriend',
  }));
  const raceCalls = calls.slice(beforeRace);
  check('unfriend concurent șterge DM-ul Turso și oprește livrarea',
    raceCalls.some((call) => /^DELETE FROM private_messages/i.test(call.statement.sql.trim()))
      && raceSender.sent.some((item) => item.type === 'error' && item.code === 'not_friends')
      && !raceRecipient.sent.some((item) => item.type === 'dm'),
    JSON.stringify({ sql: raceCalls.map((call) => call.statement.sql.trim().slice(0, 30)), sent: raceSender.sent }));
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\nREZULTAT: ${passed} trecute, ${failed} esuate`);
process.exit(failed ? 1 : 0);
