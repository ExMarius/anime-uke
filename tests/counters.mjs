// =====================================================================
// counters.mjs — contoarele denormalizate (migrarea 0028), testate pe loc.
//
// De ce fără server: în e2e, /api/pulse are un cache de 5 minute la nivel de
// izolat, deci suita nu poate observa imediat efectul unui cont nou sau al
// unei vizualizări. Aici verificăm exact ce poate greși cineva la o
// denormalizare: cheile citite, maparea pe câmpurile răspunsului, ce se
// întâmplă când D1 pică, și forma batch-ului care resincronizează media.
//
// Rulează: node tests/counters.mjs
// =====================================================================

import { onRequestGet as pulseGet } from '../src/routes/api/pulse.js';
import { saveRating, ratingSyncStmt } from '../src/lib/ratings.js';
import { bumpMetaStmt } from '../src/lib/paging.js';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('=== CONTORARE DENORMALIZATE (0028) ===');

// ---------------------------------------------------------------------
// 1. /api/pulse citește contoarele din site_meta, nu numără tabelele
// ---------------------------------------------------------------------
const META = {
  series_total: 1000,
  episodes_total: 19788,
  users_total: 1000,
  views_total: 123456,
};

const pulseEnv = (rows = META, throwOnQuery = false) => ({
  DB: {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        bind() { return stmt; },
        async first() { return null; },
        async all() {
          if (throwOnQuery) throw new Error('D1 indisponibil');
          return { results: Object.entries(rows).map(([key, value]) => ({ key, value })) };
        },
      };
      return stmt;
    },
  },
});

{
  // Prima cerere populează cache-ul de modul (5 minute) — deci o facem o
  // singură dată, iar restul verificărilor de degradare vin pe următoarele.
  const res = await pulseGet({ env: pulseEnv(), request: new Request('https://anime-uke.test/api/pulse') });
  const body = await res.json();
  check('Pulse ia seriile din contorul series_total', body.series === 1000, JSON.stringify(body));
  check('Pulse ia episoadele din contorul episodes_total', body.episodes === 19788, JSON.stringify(body));
  check('Pulse ia membrii din contorul users_total (cheie nouă)', body.members === 1000, JSON.stringify(body));
  check('Pulse ia vizualizările din contorul views_total', body.views === 123456, JSON.stringify(body));
  check('Pulse întoarce și „online" (0 fără ChatDO)', body.online === 0, JSON.stringify(body));
}

{
  // D1 picat, dar există date în cache-ul de modul: răspunsul rămâne valid.
  const res = await pulseGet({ env: pulseEnv(META, true), request: new Request('https://anime-uke.test/api/pulse') });
  const body = await res.json();
  check('D1 picat după un succes → servește ultimele contoare, nu 500', res.status === 200 && body.series === 1000, `status=${res.status} ${JSON.stringify(body)}`);
}

// ---------------------------------------------------------------------
// 2. Verificarea SQL: se citesc EXACT cele 4 chei, dintr-o singură cerere
// ---------------------------------------------------------------------
{
  let seen = null;
  const env = {
    DB: {
      prepare(sql) {
        seen = sql;
        const stmt = {
          bind() { return stmt; },
          async all() { return { results: [] }; },
          async first() { return null; },
        };
        return stmt;
      },
    },
  };
  // GARDĂ DE COD (nu de comentarii): comentariile din pulse.js povestesc ce
  // s-a scos, deci le eliminăm înainte de verificare.
  const raw = await (await import('node:fs/promises')).readFile(new URL('../src/routes/api/pulse.js', import.meta.url), 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  check('Pulse nu mai face COUNT(*) pe tabele', !/COUNT\(\*\)/.test(code), 'a rămas un COUNT(*) în cod');
  check('Pulse nu mai însumează toate vizualizările', !/SUM\(views\)/.test(code), 'a rămas SUM(views) în cod');
  check('Cele 4 chei sunt citite într-o singură interogare',
    (code.match(/site_meta/g) || []).length === 1
    && code.includes("'series_total', 'episodes_total', 'users_total', 'views_total'"),
    `site_meta apariții=${(code.match(/site_meta/g) || []).length}`);
  void env; void seen;
}

// ---------------------------------------------------------------------
// 3. Media notelor: un singur batch, cu RETURNING, fără citire separată
// ---------------------------------------------------------------------
{
  const calls = [];
  const env = {
    DB: {
      prepare(sql) { calls.push(sql.replace(/\s+/g, ' ').trim()); return { bind: () => ({}) }; },
      async batch(stmts) {
        return [
          { meta: { changes: 1 } },
          { results: [{ average: 7.5, count: 2 }] },
        ].slice(0, stmts.length);
      },
    },
  };
  const agg = await saveRating(env, 4, 9, 8);
  check('Votul + resincronizarea mediei = un singur batch', calls.length === 2, `statement-uri=${calls.length}`);
  check('Primul statement e upsert-ul notei', /INSERT INTO series_ratings/.test(calls[0]) && /ON CONFLICT\(user_id, series_id\) DO UPDATE/.test(calls[0]));
  check('Al doilea statement resincronizează seria', /UPDATE anime_series SET/.test(calls[1]) && /RETURNING rating_avg AS average, rating_count AS count/.test(calls[1]));
  check('Media și numărul de voturi vin din RETURNING', agg.average === 7.5 && agg.count === 2, JSON.stringify(agg));
}

{
  // Statement-ul de sincronizare primește 3 parametri (2 subinterogări + id).
  const binds = [];
  const env = { DB: { prepare: () => ({ bind: (...a) => { binds.push(a); return {}; } }) } };
  ratingSyncStmt(env, 33);
  check('Sincronizarea leagă seria în toate cele 3 locuri', binds[0]?.length === 3 && binds[0].every((v) => v === 33), JSON.stringify(binds));

  const m = bumpMetaStmt(env, 'views_total', 5);
  check('Contorul se incrementează atomic (MAX(0, value + ?))', !!m && binds[1]?.[0] === 'views_total' && binds[1]?.[1] === 5 && binds[1]?.[2] === 5, JSON.stringify(binds[1]));
  check('Delta 0 nu produce statement (nimic de scris)', bumpMetaStmt(env, 'views_total', 0) === null);
}

console.log(`\nREZULTAT: ${passed} trecute, ${failed} esuate`);
process.exit(failed ? 1 : 0);
