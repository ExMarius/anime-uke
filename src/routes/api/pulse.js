import { json } from '../../lib/http.js';

// =====================================================================
// GET /api/pulse — semnele „live” ale site-ului, cu cost D1 aproape zero.
//
// Pagina se simte vie cand arata numere care SE MISCA: cati sunt online in
// chat, cate serii/episoade exista, cate vizionari s-au acumulat. Fara asta
// site-ul pare o brosura statica.
//
// Buget D1 (planul gratuit = 5M randuri citite/zi, scrieri PICA hard):
//   Masurat la scara maxima (1.000 serii / 1.000 useri, vezi migrarea 0028):
//   COUNT(*) pe anime_series + COUNT(*) pe users + SUM(views) pe toate
//   episoadele = 41.576 randuri citite la FIECARE reimprospatare a cache-ului
//   de 5 minute. Cu cateva izolate calde, doar contorul decorativ din
//   subsolul paginii manca toata cota zilei.
//
//   Acum citeste contoarele denormalizate din site_meta (intretinute de
//   admin/series + admin/episodes la adaugari/stergeri, de register.js la
//   cont nou si de StatsDO la flush-ul de vizualizari): 4 randuri in loc de
//   41.576. Diferenta posibila fata de COUNT(*) e de cateva unitati in urma
//   realitatii (o vizualizare inca neflush-uita din DO) — pentru un numar
//   afisat ca „cate serii exista" asta e irelevant, iar economisirea nu e.
//
//   online vine din ChatDO (memorie, zero D1) pe GET /state, dar NU la
//   fiecare cerere. Un tab deschis intreaba /api/pulse la 90 s, iar fiecare
//   apel era 1 request de Durable Object (cota 100.000/zi). Contorul e
//   decorativ: 60 s de intarziere nu se vad. Cache in izolat + pe margine
//   (caches.default, partajat intre izolatele aceluiasi centru). In dev si
//   in teste ONLINE_CACHE_MS=0, ca socket-ul deschis sa se vada imediat
//   (regresia online mereu 0: idFromName('global') in loc de 'global-chat').
// =====================================================================

const CACHE_MS = 5 * 60 * 1000;
/** Contoarele din site_meta care alcatuiesc „pulse"-ul de catalog. */
export const PULSE_KEYS = ['series_total', 'episodes_total', 'users_total', 'views_total'];
const cache = { at: 0, data: null };

/** Cat tinem „cati sunt online” fara sa mai intrebam ChatDO. */
export const ONLINE_CACHE_MS_DEFAULT = 60_000;
const ONLINE_EDGE_KEY = 'https://pulse-cache.anime-uke.internal/online';

export function onlineCacheMs(env) {
  const raw = env?.ONLINE_CACHE_MS;
  if (raw === undefined || raw === null || raw === '') return ONLINE_CACHE_MS_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : ONLINE_CACHE_MS_DEFAULT;
}

let onlineMem = { at: 0, n: 0, has: false };

/** Goleste cache-urile modulului. Folosit de teste; nu e o ruta. */
export function resetPulseCache() {
  cache.at = 0;
  cache.data = null;
  onlineMem = { at: 0, n: 0, has: false };
}

/** null = nu stim (DO picat sau lipsa). 0 e un raspuns valid, nu o eroare. */
async function fetchOnline(env) {
  if (!env?.CHAT) return null;
  // ACELASI nume ca in src/routes/chat.js ('global-chat'): cu 'global' citeam
  // o instanta-fantoma, mereu goala, deci „online" era permanent 0.
  const stub = env.CHAT.get(env.CHAT.idFromName('global-chat'));
  const res = await stub.fetch('https://chat.internal/state');
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data.online) ? data.online.length : 0;
}

async function readEdgeOnline(ttl) {
  try {
    if (typeof caches === 'undefined' || !caches?.default) return null;
    const hit = await caches.default.match(ONLINE_EDGE_KEY);
    if (!hit) return null;
    const body = await hit.json();
    const n = Number(body?.n);
    const at = Number(body?.at);
    if (!Number.isFinite(n) || n < 0 || !Number.isFinite(at)) return null;
    if (Date.now() - at >= ttl) return null;
    return n;
  } catch {
    return null;
  }
}

async function writeEdgeOnline(n, ttl) {
  try {
    if (typeof caches === 'undefined' || !caches?.default) return;
    const res = new Response(JSON.stringify({ n, at: Date.now() }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${Math.max(1, Math.ceil(ttl / 1000))}`,
      },
    });
    await caches.default.put(ONLINE_EDGE_KEY, res);
  } catch { /* marginea e un bonus; izolatul are deja valoarea */ }
}

async function readOnline(env, waitUntil) {
  const ttl = onlineCacheMs(env);
  if (ttl === 0) {
    try {
      const n = await fetchOnline(env);
      return n ?? 0;
    } catch {
      return onlineMem.has ? onlineMem.n : 0;
    }
  }

  const now = Date.now();
  if (onlineMem.has && now - onlineMem.at < ttl) return onlineMem.n;

  const edge = await readEdgeOnline(ttl);
  if (edge !== null) {
    onlineMem = { at: now, n: edge, has: true };
    return edge;
  }

  let n = null;
  try {
    n = await fetchOnline(env);
  } catch { /* DO indisponibil */ }
  // Nu memoram esecul: urmatoarea cerere reincearca. Un 0 real (nimeni in
  // chat) e un raspuns bun si se tine, ca sa nu intrebam DO-ul degeaba.
  if (n === null) return onlineMem.has ? onlineMem.n : 0;

  onlineMem = { at: now, n, has: true };
  const write = writeEdgeOnline(n, ttl);
  if (typeof waitUntil === 'function') {
    try { waitUntil(write); }
    catch { await write; }
  } else {
    await write;
  }
  return n;
}

export async function onRequestGet(context) {
  const { env } = context;

  const now = Date.now();
  if (!cache.data || now - cache.at > CACHE_MS) {
    try {
      const res = await env.DB
        .prepare(
          `SELECT key, value FROM site_meta
            WHERE key IN ('series_total', 'episodes_total', 'users_total', 'views_total')`
        )
        .all();
      const c = {};
      for (const r of res.results || []) c[r.key] = Number(r.value) || 0;
      cache.data = {
        series: c.series_total || 0,
        episodes: c.episodes_total || 0,
        members: c.users_total || 0,
        views: c.views_total || 0,
      };
      cache.at = now;
    } catch {
      // Pulse-ul e decorativ: o citire picata nu trebuie sa strice nimic.
      if (!cache.data) cache.data = { series: 0, episodes: 0, members: 0, views: 0 };
    }
  }

  let online = 0;
  try {
    online = await readOnline(env, context.waitUntil);
  } catch { /* chat-ul poate fi indisponibil; pulse-ul continua fara el */ }

  return json({ ...cache.data, online });
}
