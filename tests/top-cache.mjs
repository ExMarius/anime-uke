// =====================================================================
// top-cache.mjs — cache-ul de o oră al topului săptămânal, testat pe loc.
//
// De ce un test separat, fără server: suita e2e rulează cu
// TOP_CACHE_MINUTES=0 (altfel topul ar fi înghețat o oră și testele n-ar mai
// vedea progresul scris de ele), deci calea „cerere servită din cache" NU ar
// fi acoperită de nicio verificare. Aici o acoperim exact: importăm handlerul
// și îi dăm un D1 fals, care numără interogările.
//
// Rulează: node tests/top-cache.mjs
// =====================================================================

import { cacheMinutes, onRequestGet } from '../src/routes/api/top.js';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const WEEKLY_ROW = [{ id: 7, title: 'Serie din cache', cover_image: '', watchers: 3, seconds: 900 }];
const RATED_ROW = [{ id: 7, title: 'Serie din cache', cover_image: '', average: 9.5, votes: 4 }];

/**
 * D1 fals: ține minte ce interogări s-au cerut și răspunde după tiparul SQL.
 * Suficient pentru top.js: citirea/scrierea cache-ului + cele două clasamente.
 */
function fakeDB({ cacheRow = null, failCacheRead = false } = {}) {
  const calls = { weekly: 0, rated: 0, cacheRead: 0, cacheWrite: 0, sql: [] };
  const db = {
    prepare(sql) {
      calls.sql.push(sql.replace(/\s+/g, ' ').trim());
      const stmt = {
        _args: [],
        bind(...a) { stmt._args = a; return stmt; },
        async first() {
          if (/leaderboard_cache/.test(sql)) {
            calls.cacheRead++;
            if (failCacheRead) throw new Error('D1 picat la citire');
            return cacheRow && cacheRow.fresh
              ? { value: JSON.stringify(cacheRow.value) }
              : null;
          }
          if (/COUNT\(\*\)/.test(sql)) return { n: 1 };
          return null;
        },
        async all() {
          if (/watch_progress/.test(sql)) { calls.weekly++; return { results: WEEKLY_ROW }; }
          if (/FROM anime_series/.test(sql)) { calls.rated++; return { results: RATED_ROW }; }
          return { results: [] };
        },
        async run() {
          if (/leaderboard_cache/.test(sql)) {
            calls.cacheWrite++;
            const written = JSON.parse(stmt._args[1]);
            // Ce s-a scris devine cache-ul „proaspăt" pentru următoarea cerere.
            cacheRow = { fresh: true, value: written };
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db, TOP_CACHE_MINUTES: undefined }, calls, getCache: () => cacheRow };
}

const get = (env) => onRequestGet({ env, request: new Request('https://anime-uke.test/api/top') });

console.log('=== CACHE TOP SĂPTĂMÂNAL ===');

// 1. Prima cerere: cache gol → recalculează și scrie.
{
  const t = fakeDB();
  const res = await get(t.env);
  const body = await res.json();
  check('Prima cerere calculează topul din progresul real', t.calls.weekly === 1, `weekly=${t.calls.weekly}`);
  check('Prima cerere scrie rezultatul în cache', t.calls.cacheWrite === 1, `writes=${t.calls.cacheWrite}`);
  check('Răspunsul are ambele clasamente', body.weekly?.[0]?.watchers === 3 && body.rated?.[0]?.votes === 4, JSON.stringify(body));
}

// 2. A doua cerere: cache proaspăt → NU mai recalculează.
{
  const t = fakeDB({ cacheRow: { fresh: true, value: WEEKLY_ROW } });
  const res = await get(t.env);
  const body = await res.json();
  check('Cererea din cache nu mai atinge watch_progress', t.calls.weekly === 0, `weekly=${t.calls.weekly}`);
  check('Cererea din cache întoarce exact ce era în cache', body.weekly?.[0]?.title === 'Serie din cache', JSON.stringify(body.weekly));
  check('Cererea din cache citește un singur rând', t.calls.cacheRead === 1, `reads=${t.calls.cacheRead}`);
  check('Cererea din cache nu rescrie cache-ul', t.calls.cacheWrite === 0, `writes=${t.calls.cacheWrite}`);
  check('Clasamentul de voturi se ia mereu proaspăt din index', t.calls.rated === 1, `rated=${t.calls.rated}`);
}

// 3. TOP_CACHE_MINUTES=0 → ignoră cache-ul (ce folosesc testele și dev-ul).
{
  const t = fakeDB({ cacheRow: { fresh: true, value: WEEKLY_ROW } });
  t.env.TOP_CACHE_MINUTES = '0';
  const res = await get(t.env);
  const body = await res.json();
  check('Cu TOP_CACHE_MINUTES=0 topul se recalculează', t.calls.weekly === 1, `weekly=${t.calls.weekly}`);
  check('...și rezultatul nu vine din cache', body.weekly?.[0]?.watchers === 3 && t.calls.cacheRead === 0, `reads=${t.calls.cacheRead}`);
}

// 4. Cache-ul e o optimizare: dacă D1 pică la citire, răspunsul rămâne corect.
{
  const t = fakeDB({ failCacheRead: true });
  const res = await get(t.env);
  const body = await res.json();
  check('Cache picat → răspunsul se calculează, nu crapă', res.status === 200 && t.calls.weekly === 1, `status=${res.status}`);
  check('...și pagina primește date reale', body.weekly?.length === 1, JSON.stringify(body));
}

// 5. Cache-ul vechi (o oră depășită) nu se folosește.
{
  // `fresh: false` = rândul nu satisface condiția de timp din SQL.
  const t = fakeDB({ cacheRow: { fresh: false, value: WEEKLY_ROW } });
  await get(t.env);
  check('Cache expirat → recalcul', t.calls.weekly === 1, `weekly=${t.calls.weekly}`);
}

// 6. Minutele de cache: implicit 60, configurabile, invalidul cade pe implicit.
{
  check('Implicit: 60 de minute', cacheMinutes({}) === 60, String(cacheMinutes({})));
  check('Configurabil prin mediu', cacheMinutes({ TOP_CACHE_MINUTES: '15' }) === 15);
  check('Valoare invalidă → implicit', cacheMinutes({ TOP_CACHE_MINUTES: 'abc' }) === 60);
  check('Negativ → implicit (nu „cache infinit")', cacheMinutes({ TOP_CACHE_MINUTES: '-5' }) === 60);
}

console.log(`\nREZULTAT: ${passed} trecute, ${failed} esuate`);
process.exit(failed ? 1 : 0);
