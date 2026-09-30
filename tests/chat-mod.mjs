// =====================================================================
// chat-mod.mjs — moderarea chatului live (migrarea 0035).
//
// Chatul era singurul loc din site fara unelte de moderare: un moderator care
// vedea spam sau injurii putea doar sa priveasca. Aici verificam ca uneltele
// noi chiar functioneaza SI ca nu pot fi folosite de cine nu are dreptul.
//
// Ce ne intereseaza in mod special:
//   - dreptul vine din attachment-ul pus de ruta autentificata (`can_mod`),
//     nu din ce trimite clientul in mesaj;
//   - stergerea curata AMBELE locuri in care traieste un mesaj (bufferul
//     durabil al DO-ului si arhiva D1);
//   - sanctiunile stau in STORAGE, deci supravietuiesc evictiei DO-ului —
//     altfel un spammer ar scapa doar asteptand ca DO-ul sa adoarma.
//
// Ruleaza: node tests/chat-mod.mjs
// =====================================================================

import { ChatDO } from '../src/do/ChatDO.js';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const msgKeys = (storage) => [...storage.map.keys()].filter((k) => k.startsWith('m:'));

// --- acelasi harness ca in chat-persist (storage/state/socket/D1 false) ----
function fakeStorage(initial = new Map()) {
  const map = initial;
  const stor = {
    map,
    async put(key, value) { map.set(key, value); },
    async get(key) { return map.get(key); },
    async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k); },
    async list({ prefix = '', limit = Infinity, reverse = false } = {}) {
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
    pending: [],
    acceptWebSocket(ws) { if (!sockets.includes(ws)) sockets.push(ws); },
    getWebSockets() { return sockets; },
    waitUntil(p) { state.pending.push(Promise.resolve(p).catch(() => {})); },
  };
  return state;
}

async function settle(state) {
  for (let i = 0; i < 5; i++) {
    await Promise.allSettled(state.pending.splice(0));
    await new Promise((r) => setTimeout(r, 5));
  }
}

function fakeSocket(attachment) {
  return {
    sent: [],
    send(text) { this.sent.push(JSON.parse(text)); },
    close() { this.closed = true; },
    serializeAttachment(a) { this._att = a; },
    deserializeAttachment() { return this._att ?? attachment; },
    last(type) { return [...this.sent].reverse().find((m) => m.type === type); },
  };
}

function fakeDB(seed = []) {
  const rows = [...seed];
  const db = {
    rows,
    log: [],            // randurile de audit (admin_log)
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
        async run() {
          if (/DELETE FROM chat_messages WHERE mid/i.test(sql)) {
            const inainte = rows.length;
            for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i].mid) === String(args[0])) rows.splice(i, 1);
            return { meta: { changes: inainte - rows.length } };
          }
          if (/INSERT INTO admin_log/i.test(sql)) {
            const [admin_id, admin_name, action, target_id, details] = args;
            db.log.push({ admin_id, admin_name, action, target_id, details });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      });
      return make([]);
    },
    async batch(stmts) {
      for (const s of stmts) {
        if (/INSERT INTO chat_messages/i.test(s._sql)) {
          const [user_id, username, message, created_at, rank_label, rank_icon, staff_role, flair, name_gold, name_color, avatar, mid] = s._args;
          rows.push({ user_id, username, message, created_at, rank_label, rank_icon, staff_role, flair, name_gold, name_color, avatar, mid });
        }
      }
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return db;
}

const MEMBRU = { id: 7, username: 'marius' };
const MOD = { id: 2, username: 'moderator', can_mod: 1 };
const attFor = (u) => ({
  userId: u.id, username: u.username, can_mod: u.can_mod ? 1 : 0,
  rank_label: '', rank_icon: '', staff_role: u.can_mod ? 'moderator' : '',
});
const chat = (m) => JSON.stringify({ type: 'chat', message: m });
const mod = (o) => JSON.stringify({ type: 'mod', ...o });
/** Modul lent se comuta din panoul de admin, deci prin fetch-ul DO-ului. */
const setSlow = (id, seconds, by = MOD.username) => id.fetch(new Request('https://chat.internal/slow', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seconds, by }),
}));

function revive(storage, db, sockets = []) {
  const state = fakeState(storage, sockets);
  return { id: new ChatDO(state, { DB: db }), state };
}

/** Chat pornit cu un membru si un moderator conectati. */
async function scena() {
  const storage = fakeStorage();
  const db = fakeDB();
  const sockets = [];
  const a = revive(storage, db, sockets);
  const wsU = fakeSocket(attFor(MEMBRU));
  const wsM = fakeSocket(attFor(MOD));
  a.state.acceptWebSocket(wsU);
  a.state.acceptWebSocket(wsM);
  await a.id.onConnected(wsU, MEMBRU);
  await a.id.onConnected(wsM, MOD);
  return { storage, db, sockets, a, wsU, wsM };
}

console.log('=== CHAT: MODERARE LIVE (stergere, tacere, mod lent) ===');

// ---------------------------------------------------------------------
// 1. Fiecare mesaj primeste un identificator stabil, in ambele locuri.
// ---------------------------------------------------------------------
{
  const { storage, db, a, wsU } = await scena();
  await a.id.webSocketMessage(wsU, chat('primul mesaj'));

  const salvat = storage.map.get(msgKeys(storage)[0]);
  check('Mesajul salvat are mid', !!salvat?.mid, JSON.stringify(salvat)?.slice(0, 120));
  const difuzat = wsU.last('message');
  check('Mesajul difuzat poarta acelasi mid', difuzat?.mid === salvat?.mid, `${difuzat?.mid} vs ${salvat?.mid}`);

  await a.id.flush();
  check('Arhiva D1 pastreaza mid-ul (coloana din 0035)',
    db.rows.at(-1)?.mid === salvat.mid, JSON.stringify(db.rows.at(-1))?.slice(0, 140));
}

// ---------------------------------------------------------------------
// 2. Stergerea: din bufferul durabil SI din arhiva.
// ---------------------------------------------------------------------
{
  const { storage, db, a, wsU, wsM } = await scena();
  await a.id.webSocketMessage(wsU, chat('mesaj de sters'));
  const mid = storage.map.get(msgKeys(storage)[0]).mid;

  await a.id.webSocketMessage(wsM, mod({ action: 'delete', mid }));
  check('Stergerea scoate mesajul din bufferul durabil', msgKeys(storage).length === 0,
    `chei ramase=${msgKeys(storage).length}`);
  const ev = wsU.last('deleted');
  check('Toata lumea primeste anuntul de stergere', ev?.mid === mid && ev?.by === MOD.username, JSON.stringify(ev));

  // Acelasi scenariu, dar cu mesajul ajuns deja in arhiva. Trimitem de pe o
  // instanta noua: contorul de rate limit traieste in memorie, iar doua
  // mesaje la rand de la acelasi user ar fi oprite ca „prea repede".
  const c = revive(storage, db, [wsU, wsM]);
  await c.id.webSocketMessage(wsU, chat('mesaj arhivat'));
  const mid2 = storage.map.get(msgKeys(storage)[0]).mid;
  await c.id.flush();
  check('Pregatire: mesajul e in arhiva', db.rows.some((r) => r.mid === mid2), `randuri=${db.rows.length}`);
  await c.id.webSocketMessage(wsM, mod({ action: 'delete', mid: mid2 }));
  check('Stergerea curata si arhiva D1', !db.rows.some((r) => r.mid === mid2), JSON.stringify(db.rows.map((r) => r.mid)));

  await settle(a.state);
  await settle(c.state);
  check('Stergerea intra in jurnalul de audit',
    db.log.some((l) => l.action === 'chat_delete' && l.admin_id === MOD.id), JSON.stringify(db.log));
}

// ---------------------------------------------------------------------
// 3. Fara drept de moderare, comenzile nu fac nimic.
// ---------------------------------------------------------------------
{
  const { storage, a, wsU } = await scena();
  await a.id.webSocketMessage(wsU, chat('mesajul meu'));
  const mid = storage.map.get(msgKeys(storage)[0]).mid;

  await a.id.webSocketMessage(wsU, mod({ action: 'delete', mid }));
  check('Un membru obisnuit nu poate sterge mesaje', msgKeys(storage).length === 1,
    `chei ramase=${msgKeys(storage).length}`);
  check('  ...si primeste refuz explicit', wsU.last('error')?.scope === 'mod', JSON.stringify(wsU.last('error')));

  await a.id.webSocketMessage(wsU, mod({ action: 'mute', user_id: 99, minutes: 15 }));
  check('Un membru obisnuit nu poate reduce pe nimeni la tacere',
    Object.keys((await a.id.modState()).mutes).length === 0, JSON.stringify((await a.id.modState()).mutes));
}

// ---------------------------------------------------------------------
// 4. Reducerea la tacere chiar opreste scrisul — si tine dupa evictie.
// ---------------------------------------------------------------------
{
  const { storage, db, sockets, a, wsU, wsM } = await scena();
  await a.id.webSocketMessage(wsM, mod({ action: 'mute', user_id: MEMBRU.id, minutes: 15 }));

  const inainte = msgKeys(storage).length;
  await a.id.webSocketMessage(wsU, chat('incerc sa scriu'));
  check('Cel redus la tacere nu mai poate trimite mesaje', msgKeys(storage).length === inainte,
    `chei=${msgKeys(storage).length}`);
  check('  ...si afla de ce (mesaj cu minutele ramase)',
    /minute/.test(wsU.last('error')?.text || ''), JSON.stringify(wsU.last('error')));
  check('Chatul anunta sanctiunea tuturor',
    /nu mai poate scrie 15 minute/.test(wsM.last('system')?.text || ''), JSON.stringify(wsM.last('system')));

  // EVICTIE: instanta noua peste acelasi storage.
  const b = revive(storage, db, sockets);
  const dupa = msgKeys(storage).length;
  await b.id.webSocketMessage(wsU, chat('incerc din nou dupa evictie'));
  check('Sanctiunea supravietuieste evictiei DO-ului (e in storage, nu in memorie)',
    msgKeys(storage).length === dupa, `chei=${msgKeys(storage).length}`);

  // Acelasi buton ridica sanctiunea: serverul comuta singur.
  await b.id.webSocketMessage(wsM, mod({ action: 'mute', user_id: MEMBRU.id, minutes: 15 }));
  await b.id.webSocketMessage(wsU, chat('acum pot scrie'));
  check('Al doilea apel pe acelasi buton ridica tacerea',
    [...storage.map.values()].some((m) => m?.message === 'acum pot scrie'), `chei=${msgKeys(storage).length}`);
}

// ---------------------------------------------------------------------
// 5. Limitele sanctiunilor: durata din lista, fara auto-mute, staff protejat.
// ---------------------------------------------------------------------
{
  const { a, wsM, wsU, sockets, storage, db } = await scena();
  await a.id.webSocketMessage(wsM, mod({ action: 'mute', user_id: MEMBRU.id, minutes: 999 }));
  check('Durata neprevazuta e refuzata', Object.keys((await a.id.modState()).mutes).length === 0,
    JSON.stringify(wsM.last('error')));

  await a.id.webSocketMessage(wsM, mod({ action: 'mute', user_id: MOD.id, minutes: 15 }));
  check('Moderatorul nu se poate reduce la tacere pe sine',
    Object.keys((await a.id.modState()).mutes).length === 0, JSON.stringify(wsM.last('error')));

  // al doilea moderator, conectat
  const wsM2 = fakeSocket(attFor({ id: 3, username: 'admin2', can_mod: 1 }));
  sockets.push(wsM2);
  await a.id.webSocketMessage(wsM, mod({ action: 'mute', user_id: 3, minutes: 15 }));
  check('Staff-ul nu se modereaza intre ei din chat',
    Object.keys((await a.id.modState()).mutes).length === 0, JSON.stringify(wsM.last('error')));

  // 'slow' nu mai e comanda de chat (a plecat in panoul de admin): trebuie
  // sa fie tratata ca orice actiune necunoscuta, nu sa mai aiba efect.
  await a.id.webSocketMessage(wsM, mod({ action: 'slow', seconds: 30 }));
  check('Comanda veche de mod lent prin chat nu mai are efect',
    (await a.id.modState()).slow === 0, String((await a.id.modState()).slow));

  await a.id.webSocketMessage(wsM, mod({ action: 'necunoscuta' }));
  check('Actiunea necunoscuta primeste eroare, nu efect',
    /necunoscut/i.test(wsM.last('error')?.text || ''), JSON.stringify(wsM.last('error')));

  void wsU; void storage; void db;
}

// ---------------------------------------------------------------------
// 6. Mod lent: impus tuturor, dar nu si staff-ului care modereaza.
// ---------------------------------------------------------------------
{
  const { storage, a, wsU, wsM } = await scena();
  const r10 = await setSlow(a.id, 10);
  check('Modul lent se seteaza din panoul de admin (fetch intern)', r10.status === 200, `status=${r10.status}`);
  check('  ...si se anunta tuturor in chat', (wsU.last('slow')?.seconds) === 10, JSON.stringify(wsU.last('slow')));

  await a.id.webSocketMessage(wsU, chat('primul'));
  const dupaPrimul = msgKeys(storage).length;
  await a.id.webSocketMessage(wsU, chat('al doilea imediat'));
  check('Al doilea mesaj prea rapid e oprit de modul lent',
    msgKeys(storage).length === dupaPrimul, `chei=${msgKeys(storage).length}`);
  check('  ...cu motivul corect (nu „prea repede" generic)',
    /Mod lent/.test(wsU.last('error')?.text || ''), JSON.stringify(wsU.last('error')));

  await setSlow(a.id, 0);
  check('Modul lent se poate opri', (await a.id.modState()).slow === 0, String((await a.id.modState()).slow));

  const rBad = await setSlow(a.id, 9999);
  check('Interval peste plafon → 400, fara efect',
    rBad.status === 400 && (await a.id.modState()).slow === 0, `status=${rBad.status}`);
  void wsM;
}

// ---------------------------------------------------------------------
// 7. Starea de moderare ajunge la client odata cu istoricul.
// ---------------------------------------------------------------------
{
  const { storage, db, sockets, a, wsM } = await scena();
  await setSlow(a.id, 10);
  await a.id.webSocketMessage(wsM, mod({ action: 'mute', user_id: MEMBRU.id, minutes: 5 }));

  const b = revive(storage, db, sockets);
  const wsNou = fakeSocket(attFor(MOD));
  b.state.acceptWebSocket(wsNou);
  await b.id.onConnected(wsNou, MOD);
  const init = wsNou.last('init');
  check('init trimite modul lent activ', init?.slow === 10, JSON.stringify(init?.slow));
  check('Sanctiunea e in storage dupa reconectare', !!(await b.id.modState()).mutes[MEMBRU.id],
    JSON.stringify((await b.id.modState()).mutes));
  check('init spune daca ai drept de moderare', init?.you?.can_mod === 1, JSON.stringify(init?.you));
}

console.log('\n' + '='.repeat(56));
console.log(`REZULTAT: ${passed} trecute, ${failed} esuate`);
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);
