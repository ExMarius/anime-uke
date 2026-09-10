import { matchRoute } from './router.js';
import { SECURITY_HEADERS } from './lib/http.js';

// =====================================================================
// Handlerul principal (Advanced Mode).
//
// Ordine: API/WS mai intii, apoi assete statice prin env.ASSETS.
// Header-ele de securitate se aplica pe TOATE raspunsurile, inclusiv pe
// cele statice — in v1 paginile HTML nu aveau niciun header de securitate.
// =====================================================================

const API_404 = { error: 'Endpoint inexistent' };

export async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  let response;
  try {
    if (path === '/api' || path.startsWith('/api/') || path === '/chat') {
      response = await handleApi(request, env, ctx, path);
    } else {
      response = await serveStatic(request, env);
    }
  } catch (e) {
    console.error('Eroare neasteptata:', e?.message || e, e?.stack || '');
    response = jsonResponse({ error: 'Eroare internă a serverului' }, 500);
  }

  return applySecurityHeaders(response);
}

async function handleApi(request, env, ctx, path) {
  const match = matchRoute(request.method, path);

  if (!match) return jsonResponse(API_404, 404);

  if (!match.handler) {
    // Ruta exista, metoda nu. Spunem clientului ce metode sunt acceptate.
    const allowed = allowedMethods(path);
    return new Response(JSON.stringify({ error: 'Metodă nepermisă' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: allowed.join(', ') },
    });
  }

  // Context identic cu cel din Pages Functions, ca rutele sa nu se schimbe.
  const context = {
    request,
    env,
    params: match.params,
    waitUntil: (p) => ctx?.waitUntil?.(p),
    data: {},
    next: async () => serveStatic(request, env),
  };

  return await match.handler(context);
}

function allowedMethods(path) {
  const found = new Set();
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const match = matchRoute(m, path);
    if (match?.handler) found.add(m);
  }
  return [...found];
}

// Cai care nu trebuie servite niciodata ca asset static. In productie Pages
// exclude automat `_worker.js`, dar blocam explicit ca sa nu depindem de asta
// si ca mesajele de eroare ale serverului de assete sa nu scape catre client
// (local, wrangler raspundea cu un 502 care includea calea absoluta pe disc).
const BLOCKED_PATHS = ['/_worker.js', '/.dev.vars', '/wrangler.toml', '/schema.sql'];

async function serveStatic(request, env) {
  const path = new URL(request.url).pathname;

  if (BLOCKED_PATHS.includes(path) || path.startsWith('/.git') || path.startsWith('/migrations')) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  if (!env.ASSETS?.fetch) {
    return jsonResponse({ error: 'Assetele statice nu sunt disponibile' }, 500);
  }

  try {
    return await env.ASSETS.fetch(request);
  } catch (e) {
    // Nu lasam eroarea interna sa ajunga la client
    console.error('ASSETS.fetch esuat pentru', path, ':', e?.message || e);
    return jsonResponse({ error: 'Not found' }, 404);
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function applySecurityHeaders(response) {
  // Raspunsul de upgrade WebSocket (101) nu accepta header-e suplimentare
  // in mod uzual; il lasam neatins ca sa nu stricam handshake-ul.
  if (response.status === 101) return response;

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
