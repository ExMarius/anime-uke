// =====================================================================
// chat-d1.mjs — chatul ajunge EFECTIV in baza de date?
//
// De ce exista, separat de tests/chat-persist.mjs:
//
//   chat-persist.mjs simuleaza evictia DO-ului cu o baza FALSA — verifica
//   logica (buffer durabil, catch-up, istoric fara dubluri). Dar o baza
//   falsa nu se plange de SQL greșit: bug-ul real de producție
//   („10 values for 11 columns”, 11 coloane dar 10 parametri) a trecut prin
//   TOATE testele pentru ca nimeni nu se uita in tabelul adevarat. Mesajele
//   se scriau... in storage-ul DO-ului, iar D1 ramanea vesnic gol.
//
//   Suita asta scrie un mesaj pe chatul LOCAL, apoi deschide FISIERUL SQLite
//   al D1-ului din .wrangler/state si cauta randul. Nimic nu poate pacali
//   verificarea: ori randul e acolo, ori nu e.
//
// Cum forteaza scrierea in D1 fara sa astepte alarma de 15 secunde:
//   reconectarea. La fiecare conectare, ChatDO face „catch-up": scrie in D1
//   tot ce e in bufferul durabil (vezi onConnected). Deci: mesaj -> inchid
//   socketul -> ma reconectez -> citesc tabelul.
//
// Ruleaza pe serverul local (test.sh il porneste in faza 1).
// =====================================================================

import WS from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:8788';
const WS_BASE = BASE.replace(/^http/, 'ws');
const ROOT = new URL('..', import.meta.url).pathname;

let pass = 0, fail = 0;
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// --------------------------------------------------------------- D1 pe disc
/** Cel mai nou fisier SQLite al D1-ului local (miniflare il tine in state). */
function gasesteBaza() {
  const dir = join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const fisiere = readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!fisiere.length) throw new Error(`nu am gasit nicio baza SQLite in ${dir}`);
  return fisiere[0].f;
}

function numaraMesaje(mesaj) {
  const db = new DatabaseSync(gasesteBaza(), { readOnly: true });
  try {
    const r = db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE message = ?').get(mesaj);
    return Number(r?.n ?? 0);
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------ HTTP/WS
const IP_TEST = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;   // rate limitul e per IP
async function api(path, body, cookie) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      'CF-Connecting-IP': IP_TEST,
      'X-Forwarded-For': IP_TEST,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  let data = null;
  try { data = await res.json(); } catch { /* ignoram */ }
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : '' };
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WS(`${WS_BASE}/chat`, { headers: { Cookie: cookie } });
    const primite = [];
    ws.on('message', (buf) => {
      try {
        const m = JSON.parse(buf.toString());
        primite.push(m);
        if (m.type === 'init') resolve({ ws, primite });
      } catch { /* ignoram */ }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('timeout la conectarea pe /chat')), 10_000);
  });
}

// --------------------------------------------------------------------- run
console.log('=== CHAT: ajunge mesajul in tabelul D1 (fisier real) ===');

const rnd = Math.random().toString(36).slice(2, 8);
const user = { username: `d1test${rnd}`, email: `d1test${rnd}@example.com`, password: `Test-${rnd}-Aa1!` };
const mesaj = `d1-verificare-${Date.now()}`;
const sticker = '[sticker:salut]';

const reg = await api('/api/auth/register', user);
check('cont de test creat pentru verificarea D1', reg.status === 201, JSON.stringify(reg.data).slice(0, 120));
if (reg.status !== 201) { console.log(`\nREZULTAT: ${pass} trecute, ${fail} esuate`); process.exit(1); }

const login = await api('/api/auth/login', { username: user.username, password: user.password });
check('login reușit (cookie de sesiune)', login.status === 200 && !!login.cookie, `status ${login.status}`);

const a = await connect(login.cookie);
a.ws.send(JSON.stringify({ type: 'chat', message: mesaj }));
await sleep(2000);   // rate limitul DO-ului: 1,5s intre mesaje
a.ws.send(JSON.stringify({ type: 'chat', message: sticker }));
await sleep(1000);
a.ws.close();
await sleep(300);

const b = await connect(login.cookie);   // reconectarea declanseaza catch-up-ul
await sleep(1500);
b.ws.close();

const nMesaj = numaraMesaje(mesaj);
const nSticker = numaraMesaje(sticker);
check('mesajul e scris in chat_messages (citit din fișierul SQLite)', nMesaj === 1, `rânduri gasite: ${nMesaj}`);
check('stickerul e scris in chat_messages', nSticker >= 1, `rânduri gasite: ${nSticker}`);
check('fara dubluri in tabel (un rând per mesaj)', nMesaj === 1 && nSticker === 1,
  `mesaj=${nMesaj} sticker=${nSticker}`);

// Coloanele se scriu in ORDINEA corecta? Bug-ul istoric amesteca avatarul cu
// gradul („avatarul ajungea in rank_label”). Verificam pe rândul de test.
{
  const db = new DatabaseSync(gasesteBaza(), { readOnly: true });
  try {
    const row = db.prepare('SELECT username, rank_label, name_gold, avatar FROM chat_messages WHERE message = ?').get(mesaj);
    check('username-ul e pe coloana lui', row?.username === user.username, JSON.stringify(row));
    // Bug istoric: parametrii erau legați într-o altă ordine, iar avatarul
    // ajungea în rank_label (și invers), deci istoricul arăta aiurea.
    check('rank_label și avatar nu se amestecă (cont nou: gradul real, avatar gol)',
      !!row?.rank_label && row.rank_label !== '0' && row.rank_label !== '1' && row.avatar === '',
      JSON.stringify(row));
    check('name_gold e 0/1, nu un șir din altă coloană',
      row?.name_gold === 0 || row?.name_gold === 1, JSON.stringify(row));
  } finally {
    db.close();
  }
}

console.log(`\nREZULTAT: ${pass} trecute, ${fail} esuate`);
if (fail) console.log(`Esecuri: ${failures.join(' · ')}`);
process.exit(fail ? 1 : 0);
