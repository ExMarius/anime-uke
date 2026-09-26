#!/usr/bin/env node
// Verifică direct în Turso DM-ul canarului live și îl șterge înainte ca
// conturile temporare să dispară din D1. Nu afișează URL-ul sau tokenul.

import { hasTurso, tursoExecute } from '../src/lib/turso.js';

const env = process.env;
const [aRaw, bRaw, text = ''] = process.argv.slice(2);
const a = Number(aRaw);
const b = Number(bRaw);

if (!hasTurso(env)) {
  console.error('  ✗ credențialele Turso lipsesc din relay');
  process.exit(1);
}
if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < 1 || !text) {
  console.log('  ⏭ dovada Turso sărită (canarul de prietenie nu a creat ambele conturi)');
  process.exit(0);
}

try {
  const found = await tursoExecute(env,
    `SELECT COUNT(*) AS n
       FROM private_messages
      WHERE message = ?
        AND ((sender_id = ? AND recipient_id = ?)
          OR (sender_id = ? AND recipient_id = ?))`,
    [text, a, b, b, a]);
  const count = Number(found.rows[0]?.n) || 0;
  console.log(`  ${count === 1 ? '✓' : '✗'} DM canar găsit direct în Turso: ${count}`);

  await tursoExecute(env,
    `DELETE FROM private_messages
      WHERE sender_id IN (?, ?) OR recipient_id IN (?, ?)`,
    [a, b, a, b]);
  const left = await tursoExecute(env,
    `SELECT COUNT(*) AS n FROM private_messages
      WHERE sender_id IN (?, ?) OR recipient_id IN (?, ?)`,
    [a, b, a, b]);
  const remaining = Number(left.rows[0]?.n) || 0;
  console.log(`  ${remaining === 0 ? '✓' : '✗'} urme DM canar rămase în Turso: ${remaining}`);
  process.exit(count === 1 && remaining === 0 ? 0 : 1);
} catch (error) {
  console.error(`  ✗ verificare Turso eșuată: ${error.message}`);
  process.exit(1);
}
