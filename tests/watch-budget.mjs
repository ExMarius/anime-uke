#!/usr/bin/env node
// Gărzi pentru scenariul buget $0: 500 spectatori × 12 episoade/zi.
// Nu face trafic; verifică sincronizarea lotului client/server și marja zilnică.

import { readFileSync } from 'node:fs';

let ok = 0;
let bad = 0;
function check(name, condition, detail = '') {
  if (condition) { ok++; console.log(`  ✓ ${name}`); }
  else { bad++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const client = readFileSync(new URL('../public/assets/js/page-episode.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/routes/api/progress.js', import.meta.url), 'utf8');
const missions = readFileSync(new URL('../src/lib/missions.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/lib/watch-store.js', import.meta.url), 'utf8');

const number = (source, name) => Number(source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`))?.[1]);
const sendMs = number(client, 'HEARTBEAT_SEND_MS');
const sendCap = number(client, 'SEND_CAP');
const maxIncrement = number(server, 'MAX_INCREMENT');

check('heartbeat-ul este lotizat la 5 minute', sendMs === 300_000, String(sendMs));
check('SEND_CAP coincide cu intervalul în secunde', sendCap === sendMs / 1000, `${sendCap} vs ${sendMs / 1000}`);
check('limita serverului coincide cu SEND_CAP', maxIncrement === sendCap, `${maxIncrement} vs ${sendCap}`);
check('misiunea îndeplinită devine no-op în D1', /WHERE progress < \?/.test(missions));
check('streak-ul deja atins azi evită UPDATE-ul', /if \(row\?\.last_day === today\)[\s\S]{0,160}return/.test(missions));

// Rollback-ul trebuie să rămână o schimbare de variabilă, nu de cod.
check('WATCH_STORE implicit este d1 (rollback instant)', /WATCH_STORE \|\| 'd1'/.test(store));
check('modul necunoscut cade pe d1', /wanted !== 'd1' && !reachable\) return 'd1'/.test(store));
check('scrierile nu se reîncearcă (increment neidempotent)', /TURSO_WRITE_RETRIES = 0/.test(store));
check('recompensele rămân în D1', /watched_history/.test(readFileSync(new URL('../src/routes/api/progress.js', import.meta.url), 'utf8')));

const watchers = 500;
const episodes = watchers * 12;
const heartbeats = Math.ceil((24 * 60) / sendCap);
const d1Writes = episodes * heartbeats + episodes * 5 + watchers * 2 + Math.ceil(episodes / 20);
const workerRequests = watchers * 2 + episodes * (3 + heartbeats);
const doRequests = episodes * (2 + heartbeats);
check('proiecția D1 păstrează minimum 20% marjă', d1Writes <= 80_000, `${d1Writes}/100000`);
// Ținta etapei: heartbeat-urile (30.000/zi) pleacă din D1 în Turso.
const heartbeatWrites = episodes * heartbeats;
const d1AfterCutover = d1Writes - heartbeatWrites;
check('proiecția D1 înainte de mutare ≈ 61.300', Math.abs(d1Writes - 61_300) <= 100, String(d1Writes));
check('proiecția D1 cu WATCH_STORE=turso ≈ 31.300', Math.abs(d1AfterCutover - 31_300) <= 100, String(d1AfterCutover));
check('mutarea scade D1 cu ~30.000 scrieri/zi', heartbeatWrites === 30_000, String(heartbeatWrites));
check('proiecția Worker păstrează minimum 20% marjă', workerRequests <= 80_000, `${workerRequests}/100000`);
check('proiecția DO păstrează minimum 20% marjă', doRequests <= 80_000, `${doRequests}/100000`);

console.log(`\nwatch-budget: ${ok} verzi, ${bad} roșii · D1=${d1Writes} (turso: ${d1AfterCutover}) Worker=${workerRequests} DO=${doRequests}`);
if (bad) process.exit(1);
