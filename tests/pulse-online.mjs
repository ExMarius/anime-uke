// =====================================================================
// pulse-online.mjs — contorul „online” nu mai întreabă ChatDO la fiecare
// cerere. Fără server: un CHAT fals numără fetch-urile.
//
// De ce: /api/pulse e pe calea fierbinte (și în /api/home). Fiecare apel
// era 1 request de Durable Object, cotă 100.000/zi. Contorul e decorativ,
// deci 60 s de cache ajung. ONLINE_CACHE_MS=0 (dev.sh) păstrează citirea
// live, ca regresia „online mereu 0” să rămână vizibilă în e2e.
//
// Rulează: node tests/pulse-online.mjs
// =====================================================================

import {
  onRequestGet,
  onlineCacheMs,
  resetPulseCache,
  ONLINE_CACHE_MS_DEFAULT,
} from '../src/routes/api/pulse.js';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

function fakeEnv({ online = 2, fail = false, ttl, name = 'global-chat' } = {}) {
  const calls = { fetch: 0, name: null };
  const env = {
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async all() {
            return {
              results: [
                { key: 'series_total', value: 3 },
                { key: 'episodes_total', value: 4 },
                { key: 'users_total', value: 5 },
                { key: 'views_total', value: 6 },
              ],
            };
          },
        };
      },
    },
    CHAT: {
      idFromName(n) {
        calls.name = n;
        return `id-${n}`;
      },
      get(id) {
        return {
          async fetch() {
            calls.fetch++;
            if (fail) throw new Error('DO picat');
            if (id !== `id-${name}`) return new Response('{}', { status: 500 });
            return Response.json({ online: Array.from({ length: online }, (_, i) => ({ id: i })) });
          },
        };
      },
    },
  };
  if (ttl !== undefined) env.ONLINE_CACHE_MS = ttl;
  return { env, calls };
}

const get = (env, waitUntil) => onRequestGet({
  env,
  waitUntil,
  request: new Request('https://anime-uke.test/api/pulse'),
});

console.log('=== PULSE: cache pe contorul online ===');

{
  check('implicit 60 s', onlineCacheMs({}) === ONLINE_CACHE_MS_DEFAULT);
  check('șir gol = implicit', onlineCacheMs({ ONLINE_CACHE_MS: '' }) === ONLINE_CACHE_MS_DEFAULT);
  check('0 explicit rămâne 0', onlineCacheMs({ ONLINE_CACHE_MS: '0' }) === 0);
  check('invalid cade pe implicit', onlineCacheMs({ ONLINE_CACHE_MS: 'nu' }) === ONLINE_CACHE_MS_DEFAULT);
  check('negativ cade pe implicit', onlineCacheMs({ ONLINE_CACHE_MS: -5 }) === ONLINE_CACHE_MS_DEFAULT);
}

resetPulseCache();
{
  const t = fakeEnv({ online: 4 });
  const a = await (await get(t.env)).json();
  const b = await (await get(t.env)).json();
  check('prima cerere întreabă ChatDO', t.calls.fetch === 1, `fetch=${t.calls.fetch}`);
  check('a doua cerere în fereastra de 60 s NU mai întreabă ChatDO', t.calls.fetch === 1, `fetch=${t.calls.fetch}`);
  check('online e numărul de socket-uri', a.online === 4 && b.online === 4, JSON.stringify(a));
  check('instanța citită e global-chat (nu global)', t.calls.name === 'global-chat', t.calls.name);
  check('contoarele D1 rămân în răspuns', a.series === 3 && a.members === 5 && a.views === 6, JSON.stringify(a));
}

resetPulseCache();
{
  const t = fakeEnv({ online: 1, ttl: '0' });
  await get(t.env);
  await get(t.env);
  check('ONLINE_CACHE_MS=0 întreabă DO-ul de fiecare dată', t.calls.fetch === 2, `fetch=${t.calls.fetch}`);
  check('și tot pe global-chat', t.calls.name === 'global-chat', t.calls.name);
}

resetPulseCache();
{
  const t = fakeEnv({ fail: true });
  const a = await (await get(t.env)).json();
  await get(t.env);
  check('DO picat: 200 și online 0', a.online === 0, JSON.stringify(a));
  check('eșecul nu se memorează (următoarea cerere reîncearcă)', t.calls.fetch === 2, `fetch=${t.calls.fetch}`);
}

resetPulseCache();
{
  let waited = 0;
  const t = fakeEnv({ online: 2 });
  await get(t.env, (p) => { waited++; return p; });
  check('scrierea în cache-ul de margine e dată lui waitUntil', waited === 1, `waited=${waited}`);
}

// Izolat nou: memoria e goală, dar marginea (caches.default) încă are valoarea.
resetPulseCache();
{
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(key) {
        const hit = store.get(String(key));
        return hit ? new Response(hit) : undefined;
      },
      async put(key, res) {
        store.set(String(key), await res.text());
      },
    },
  };
  try {
    const t = fakeEnv({ online: 7 });
    const a = await (await get(t.env)).json();
    check('prima cerere umple și marginea', t.calls.fetch === 1 && a.online === 7 && store.size === 1,
      `fetch=${t.calls.fetch} store=${store.size}`);

    resetPulseCache();
    const t2 = fakeEnv({ online: 1 });
    const b = await (await get(t2.env)).json();
    check('izolat nou: citește marginea, nu mai întreabă DO-ul', t2.calls.fetch === 0 && b.online === 7,
      `fetch=${t2.calls.fetch} online=${b.online}`);
  } finally {
    delete globalThis.caches;
    resetPulseCache();
  }
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} trecute, ${failed} picate`);
process.exit(failed ? 1 : 0);
