// =====================================================================
// chat-persist.mjs — chatul trebuie să supraviețuiască EVICȚIEI DO-ului.
//
// Bug-ul din producție (raportat de proprietar: „nu se salvează mesajele, nici
// stikerele"): ChatDO ținea mesajele într-un buffer IN MEMORIE și le scria în
// D1 la 10 mesaje sau la alarma de 15s. Cu WebSocket Hibernation API, Cloudflare
// poate evacua DO-ul oricând (asta e ideea: nu plătești durată cât e idle), iar
// la trezire constructorul rulează din nou — bufferul e gol.
//
//   mesaj → broadcast (toți îl văd) → buffer în memorie → evicție → alarma
//   sună pe un DO cu bufferul gol → flush() nu are ce scrie → mesajul e PIERDUT
//
// Local (miniflare) DO-ul nu e evacuat niciodată, deci suitele treceau. Aici
// simulăm exact evicția: instanță nouă peste ACELAȘI storage, ca la trezire.
//
// Rulează: node tests/chat-persist.mjs
// =====================================================================

import { ChatDO } from '../src/do/ChatDO.js';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const tick = (n = 6) => new Promise((r) => setTimeout(r, n));

/** Câte MESAJЕ sunt în bufferul durabil (nu contoarele interne ale DO-ului). */
const msgKeys = (storage) => [...storage.map.keys()].filter((k) => k.startsWith('m:')).length;

// ---------------------------------------------------------------------
// Storage fals, în stilul API-ului DO (put/get/list/delete + alarme).
// Obiectul se partajează între „instanțe" (evicție = instanță nouă, storage
// același — ca la trezirea unui DO real).
// ---------------------------------------------------------------------
function fakeStorage(initial = new Map()) {
  const map = initial;
  const stor = {
    map,
    calls: { put: 0, list: 0, delete: 0, get: 0 },
    async put(key, value) { stor.calls.put++; map.set(key, value); },
    async get(key) { stor.calls.get++; return map.get(key); },
    async delete(keys) {
      stor.calls.delete++;
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
    async list({ prefix = '', limit = Infinity, reverse = false } = {}) {
      stor.calls.list++;
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const picked = reverse ? keys.reverse() : keys;
      const out = new Map();
      for (const k of picked.slice(0, limit)) out.set(k, map.get(k));
      return out;
    },
    _alarm: null,
    async getAlarm() { return stor._alarm; },
    async setAlarm(t) { stor._alarm = t; },
  };
  return stor;
}

function fakeState(storage, sockets = []) {
  const state = {
    storage,
    sockets,
    pending: [],      // promisiunile din waitUntil (ca să putem aștepta finalizarea)
    acceptWebSocket(ws) { if (!sockets.includes(ws)) sockets.push(ws); },
    getWebSockets() { return sockets; },
    waitUntil(p) { state.pending.push(Promise.resolve(p).catch(() => {})); },
  };
  return state;
}

/** Așteaptă ca toate promisiunile din waitUntil să se termine (flush-uri). */
async function settle(state) {
  for (let i = 0; i < 5; i++) {
    await Promise.allSettled(state.pending.splice(0));
    await tick(5);
  }
}

function fakeSocket(attachment) {
  return {
    sent: [],
    closed: false,
    send(text) { this.sent.push(JSON.parse(text)); },
    close() { this.closed = true; },
    serializeAttachment(a) { this._att = a; },
    deserializeAttachment() { return this._att ?? attachment; },
  };
}

/** D1 fals: înregistrează rândurile scrise și servește istoricul la citire. */
function fakeDB(seed = []) {
  const rows = [...seed];
  const db = {
    rows,
    writes: 0,
    failures: 0,
    failMode: false,
    // bind() întoarce un statement NOU (ca în D1 real): dacă ar muta același
    // obiect, toate rândurile dintr-un batch ar primi ultimii parametri —
    // exact bug-ul care a făcut testul de mai jos să pară că pierde mesaje.
    prepare(sql) {
      const make = (args) => ({
        _sql: sql,
        _args: args,
        bind(...a) { return make(a); },
        async all() {
          if (/SELECT[\s\S]*FROM chat_messages/i.test(sql)) {
            return { results: [...rows].slice(-Number(args[0] || 30)).reverse() };
          }
          return { results: [] };
        },
        async run() { return { meta: { changes: 1 } }; },
      });
      return make([]);
    },
    async batch(stmts) {
      if (db.failMode) { db.failures++; throw new Error('D1 indisponibil'); }
      for (const s of stmts) {
        if (/INSERT INTO chat_messages/i.test(s._sql)) {
          const [user_id, username, message, created_at, rank_label, rank_icon, staff_role, flair, name_gold, name_color, avatar] = s._args;
          rows.push({ user_id, username, message, created_at, rank_label, rank_icon, staff_role, flair, name_gold, name_color, avatar });
          db.writes++;
        } else if (/DELETE FROM chat_messages/i.test(s._sql)) {
          rows.splice(0, Math.max(0, rows.length - 500));
        }
      }
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return db;
}

const USER = { id: 7, username: 'marius' };
// Forma pe care o pune handleUpgrade în attachment (userId, nu id!) — altfel
// webSocketMessage închide socketul cu „Sesiune invalida" și nu testăm nimic.
const ATT = { userId: USER.id, username: USER.username, rank_label: '', rank_icon: '', staff_role: '' };
const msg = (m) => JSON.stringify({ type: 'chat', message: m });

/** Simulează „evicția + trezirea": instanță nouă peste același storage. */
function revive(storage, db, sockets = []) {
  const state = fakeState(storage, sockets);
  return { id: new ChatDO(state, { DB: db }), state };
}

// ---------------------------------------------------------------------
console.log('=== CHAT: DURABILITATE LA EVICȚIA DO-ULUI ===');

// 1. Evicție DUPĂ un singur mesaj (cazul cel mai frecvent pe un site mic):
//    alarma de flush nu apucă să ruleze înainte de evacuare.
{
  const storage = fakeStorage();
  const db = fakeDB();
  const a = revive(storage, db);
  const ws1 = fakeSocket({ ...ATT });
  a.state.acceptWebSocket(ws1);
  await a.id.onConnected(ws1, USER);
  await a.id.webSocketMessage(ws1, msg('salut din chat'));

  check('Mesajul se scrie durabil ÎNAINTE de orice flush (nu doar în memorie)',
    msgKeys(storage) >= 1, `chei de mesaj în storage=${msgKeys(storage)}`);

  // evicție: instanță nouă, storage-ul rămâne
  const b = revive(storage, db);
  const ws2 = fakeSocket({ ...ATT });
  b.state.acceptWebSocket(ws2);
  await b.id.onConnected(ws2, USER);
  const init = ws2.sent.find((m) => m.type === 'init');
  const areMesajul = (init?.history || []).some((m) => m.message === 'salut din chat');
  check('După evicție, la reconectare mesajul e în istoric (nu dispare)', areMesajul,
    JSON.stringify((init?.history || []).map((m) => m.message)));

  await settle(b.state);
  check('Recuperarea scrie mesajul și în arhiva D1 (fără să aștepte 10 mesaje)',
    db.rows.some((r) => r.message === 'salut din chat'), `rânduri D1=${db.rows.length}`);
  check('După un flush reușit, bufferul durabil se golește', msgKeys(storage) === 0,
    `chei rămase=${msgKeys(storage)}`);
}

// 2. Stikerele urmează exact același drum (sunt mesaje cu tag).
{
  const storage = fakeStorage();
  const db = fakeDB();
  const a = revive(storage, db);
  const ws = fakeSocket({ ...ATT });
  a.state.acceptWebSocket(ws);
  await a.id.onConnected(ws, USER);
  await a.id.webSocketMessage(ws, msg('[sticker:salut]'));

  const b = revive(storage, db);
  const ws2 = fakeSocket({ ...ATT });
  b.state.acceptWebSocket(ws2);
  await b.id.onConnected(ws2, USER);
  const hist = ws2.sent.find((m) => m.type === 'init')?.history || [];
  check('Stickerul supraviețuiește evicției (e în istoric după reconectare)',
    hist.some((m) => m.message === '[sticker:salut]'), JSON.stringify(hist.map((m) => m.message)));
  await settle(b.state);
  check('Stickerul ajunge și în arhiva D1', db.rows.some((r) => r.message === '[sticker:salut]'));
}

// 3. D1 picat NU pierde mesajele: rămân în bufferul durabil și se scriu mai târziu.
{
  const storage = fakeStorage();
  const db = fakeDB();
  db.failMode = true;
  const a = revive(storage, db);
  const ws = fakeSocket({ ...ATT });
  const wsAlt = fakeSocket({ ...ATT, userId: 8, username: 'ana' });
  a.state.acceptWebSocket(ws);
  a.state.acceptWebSocket(wsAlt);
  await a.id.onConnected(ws, USER);
  await a.id.webSocketMessage(ws, msg('scris cat timp D1 e jos'));
  await a.id.webSocketMessage(wsAlt, msg('[sticker:lol]'));
  await settle(a.state);

  check('Când D1 pică, mesajele rămân în bufferul durabil', msgKeys(storage) === 2,
    `chei=${msgKeys(storage)} (${[...storage.map.keys()].join(',')})`);

  db.failMode = false;
  const b = revive(storage, db);
  const ws2 = fakeSocket({ ...ATT });
  b.state.acceptWebSocket(ws2);
  await b.id.onConnected(ws2, USER);
  await settle(b.state);
  check('Când D1 revine, mesajele se scriu automat (catch-up)',
    db.rows.length === 2 && msgKeys(storage) === 0, `D1=${db.rows.length} storage=${msgKeys(storage)}`);
}

// 4. Istoricul complet: ce e în D1 (arhivă) + ce e încă în buffer se combină,
//    fără dubluri, când bufferul are doar câteva mesaje.
{
  const seed = Array.from({ length: 5 }, (_, i) => ({
    user_id: 1, username: 'altul', message: `vechi ${i + 1}`, created_at: `2026-09-20 10:0${i}:00`,
    rank_label: '', rank_icon: '', staff_role: '', flair: '', name_gold: 0, name_color: '', avatar: '',
  }));
  const storage = fakeStorage();
  const db = fakeDB(seed);
  const a = revive(storage, db);
  const ws = fakeSocket({ ...ATT });
  a.state.acceptWebSocket(ws);
  await a.id.onConnected(ws, USER);
  await a.id.webSocketMessage(ws, msg('nou, încă neflush-uit'));

  const b = revive(storage, db);
  const ws2 = fakeSocket({ ...ATT });
  b.state.acceptWebSocket(ws2);
  await b.id.onConnected(ws2, USER);
  const hist = ws2.sent.find((m) => m.type === 'init')?.history || [];
  check('Istoricul combină arhiva D1 cu bufferul durabil', hist.length === 6,
    `lungime=${hist.length}: ${hist.map((m) => m.message).join(' | ')}`);
  check('Mesajele vechi rămân în ordine cronologică',
    hist[0]?.message === 'vechi 1' && hist.at(-1)?.message === 'nou, încă neflush-uit',
    hist.map((m) => m.message).join(' > '));
  check('Fără dubluri între arhivă și buffer',
    new Set(hist.map((m) => `${m.created_at}|${m.user_id}|${m.message}`)).size === hist.length);
}

// 5. Plafonul de 30 de mesaje la conectare (cerința din spec).
{
  const storage = fakeStorage();
  const db = fakeDB();
  const a = revive(storage, db);
  const ws = fakeSocket({ ...ATT });
  a.state.acceptWebSocket(ws);
  await a.id.onConnected(ws, USER);
  for (let i = 1; i <= 40; i++) {
    const wsI = fakeSocket({ ...ATT, userId: 100 + i, username: `user${i}` });
    a.state.acceptWebSocket(wsI);
    await a.id.webSocketMessage(wsI, msg(`mesaj ${i}`));
  }

  await settle(a.state);
  if (process.env.DEBUG_CHAT) {
    console.log('   [debug] storage:', [...storage.map.keys()].join(','),
      '\n   [debug] D1:', db.rows.map((r) => r.message).join(','));
  }
  const b = revive(storage, db);
  const ws2 = fakeSocket({ ...ATT });
  b.state.acceptWebSocket(ws2);
  await b.id.onConnected(ws2, USER);
  await settle(b.state);
  const hist = ws2.sent.find((m) => m.type === 'init')?.history || [];
  check('Istoricul de la conectare e limitat la 30', hist.length === 30, `lungime=${hist.length}: ${hist.map(m=>m.message).join(' ')}`);
  check('Se păstrează cele mai RECENTE 30', hist.at(-1)?.message === 'mesaj 40' && hist[0]?.message === 'mesaj 11',
    `${hist[0]?.message} … ${hist.at(-1)?.message}`);
}

// 6. Alarma de flush e programată (DO-ul nu poate rămâne cu buffer nesalvat).
{
  const storage = fakeStorage();
  const db = fakeDB();
  const a = revive(storage, db);
  const ws = fakeSocket({ ...ATT });
  a.state.acceptWebSocket(ws);
  await a.id.onConnected(ws, USER);
  await a.id.webSocketMessage(ws, msg('un singur mesaj'));
  await settle(a.state);
  check('După un mesaj rămâne o alarmă de flush programată', typeof storage._alarm === 'number',
    `alarm=${storage._alarm}`);
}

console.log(`\nREZULTAT: ${passed} trecute, ${failed} esuate`);
process.exit(failed ? 1 : 0);
