#!/usr/bin/env node
// Aplică migrările Turso și importă idempotent istoricul DM vechi din D1.
// Credențialele vin numai din environment (GitHub Actions Secrets).

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hasTurso, tursoExecute, tursoPipeline } from '../src/lib/turso.js';

const env = process.env;
const migrationDir = resolve('turso/migrations');
const backfillIndex = process.argv.indexOf('--backfill');
const backfillFile = backfillIndex >= 0 ? process.argv[backfillIndex + 1] : '';

export function splitSql(source) {
  const statements = [];
  let current = '';
  let quote = '';
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') { lineComment = false; current += char; }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (!quote && char === '-' && next === '-') { lineComment = true; i++; continue; }
    if (!quote && char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) { current += next; i++; }
        else quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue; }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function d1Rows(parsed) {
  if (Array.isArray(parsed)) return parsed.flatMap((entry) => entry?.results || []);
  return parsed?.results || [];
}

async function migrate() {
  if (!hasTurso(env)) throw new Error('Lipsesc TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');

  await tursoExecute(env,
    `CREATE TABLE IF NOT EXISTS _anime_uke_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`);
  const appliedResult = await tursoExecute(env, 'SELECT name FROM _anime_uke_migrations');
  const applied = new Set(appliedResult.rows.map((row) => row.name));
  const files = (await readdir(migrationDir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();

  for (const name of files) {
    if (applied.has(name)) {
      console.log(`  = Turso ${name}: deja aplicată`);
      continue;
    }
    const sql = await readFile(resolve(migrationDir, name), 'utf8');
    const statements = splitSql(sql);
    // Nu punem BEGIN/COMMIT într-un pipeline simplu: protocolul execută toate
    // cererile chiar dacă una intermediară eșuează, deci COMMIT-ul și marcajul
    // de migrare ar putea trece peste o eroare. Instrucțiunile de schemă sunt
    // idempotente; le executăm secvențial și marcăm migrarea numai la final.
    for (const statement of statements) {
      await tursoExecute(env, statement, [], { timeoutMs: 20_000 });
    }
    await tursoExecute(env,
      'INSERT INTO _anime_uke_migrations (name) VALUES (?)', [name], { timeoutMs: 20_000 });
    console.log(`  + Turso ${name}: aplicată (${statements.length} instrucțiuni)`);
  }
}

async function backfill(path) {
  if (!path) return;
  const parsed = JSON.parse(await readFile(resolve(path), 'utf8'));
  const rows = d1Rows(parsed)
    .filter((row) => Number(row.id) > 0)
    .sort((a, b) => Number(a.id) - Number(b.id));
  let imported = 0;

  for (let offset = 0; offset < rows.length; offset += 50) {
    const chunk = rows.slice(offset, offset + 50);
    const results = await tursoPipeline(env, chunk.map((row) => ({
      sql: `INSERT OR IGNORE INTO private_messages
              (sender_id, recipient_id, message, created_at, read_at, legacy_d1_id)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [row.sender_id, row.recipient_id, row.message, row.created_at, row.read_at, row.id],
    })), { timeoutMs: 20_000 });
    imported += results.reduce((sum, result) => sum + result.rowsAffected, 0);
  }
  console.log(`  ✓ backfill D1 → Turso: ${imported} noi / ${rows.length} găsite`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await migrate();
    await backfill(backfillFile);
    const count = await tursoExecute(env, 'SELECT COUNT(*) AS n FROM private_messages');
    console.log(`  ✓ Turso pregătit: ${Number(count.rows[0]?.n) || 0} mesaje private`);
  } catch (error) {
    console.error(`  ✗ migrare Turso eșuată: ${error.message}`);
    process.exit(1);
  }
}
