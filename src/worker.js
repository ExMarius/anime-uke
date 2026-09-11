import { matchRoute } from './router.js';
import { SECURITY_HEADERS } from './lib/http.js';
import { getSessionUser } from './lib/session.js';

// =====================================================================
// Handlerul principal (Advanced Mode).
//
// Ordine: API/WS mai intii, apoi assete statice prin env.ASSETS.
// Header-ele de securitate se aplica pe TOATE raspunsurile, inclusiv pe
// cele statice — in v1 paginile HTML nu aveau niciun header de securitate.
// =====================================================================

const API_404 = { error: 'Endpoint inexistent' };

// =====================================================================
// POARTA DE AUTENTIFICARE
//
// Site-ul e privat: un vizitator fara cont ajunge direct la /login.
// Publice raman doar paginile de autentificare, assetele statice si
// endpoint-urile de auth — altfel nimeni nu s-ar putea loga.
//
// Cost: o citire D1 per request poarta. La 1000 de utilizatori zilnici
// cu ~50 de request-uri fiecare inseamna ~50.000 de randuri citite/zi,
// adica 1% din cota gratuita de 5.000.000.
// =====================================================================
const PUBLIC_PAGES = new Set(['/login', '/register', '/favicon.ico']);
const PUBLIC_API = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/register-options',
  '/api/auth/logout',
  '/api/auth/me',
]);

function isPublic(path) {
  if (PUBLIC_PAGES.has(path)) return true;
  if (PUBLIC_API.has(path)) return true;
  if (path.startsWith('/assets/')) return true;   // CSS/JS/imagini, fara date
  // Coperțile servite de site. Nu contin date despre utilizatori, iar a le
  // tine în spatele porții ar însemna un dus-întors de cookie pentru fiecare
  // imagine de pe pagina de login și din orice context fără sesiune.
  if (path.startsWith('/covers/')) return true;
  return false;
}

/** Redirectioneaza catre login pastrand destinatia, ca sa revii dupa logare. */
function redirectToLogin(url) {
  const next = `${url.pathname}${url.search}`;
  const target = `/login?next=${encodeURIComponent(next)}`;
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}

export async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  let response;
  try {
    // Fisierele care nu trebuie servite niciodata raspund cu 404 si pentru
    // vizitatori — un 302 catre /login ar dezvalui ca ruta exista.
    if (BLOCKED_PATHS.includes(path) || path.startsWith('/.git') || path.startsWith('/migrations')) {
      return applySecurityHeaders(jsonResponse({ error: 'Not found' }, 404));
    }

    if (!isPublic(path)) {
      const session = await getSessionUser(request, env);
      if (!session) {
        const isApi = path === '/api' || path.startsWith('/api/') || path === '/chat';
        response = isApi
          ? jsonResponse({ error: 'Trebuie să fii autentificat' }, 401)
          : redirectToLogin(url);
        return applySecurityHeaders(response);
      }
    }

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

/**
 * Pagini al caror URL contine un parametru de cale.
 *
 * `/admin/serie/123` serveste continutul lui `public/admin/serie.html`, iar
 * JavaScript-ul citeste id-ul din `location.pathname`. Astfel URL-ul ramane
 * curat si poate fi pus in bookmark sau trimis, fara sa fie nevoie de un
 * fisier fizic pentru fiecare serie.
 *
 * ATENTIE: aici se serveste un asset la o ALTA cale decat cea ceruta, exact
 * situatia care a produs bucla de la /profile. De aceea raspunsurile de
 * redirect nu sunt pasate clientului — vezi followAssetRedirect().
 */
const DYNAMIC_PAGES = [
  { re: /^\/admin\/serie\/\d+\/?$/, asset: '/admin/serie' },
];

function assetPathFor(path) {
  for (const rule of DYNAMIC_PAGES) {
    if (rule.re.test(path)) return rule.asset;
  }
  return null;
}

/**
 * Urmareste un singur redirect intern de la routerul de assete.
 *
 * Routerul Pages aplica „clean URLs": pentru /admin/serie.html raspunde cu
 * 308 catre /admin/serie. Daca am pasa redirectul acela browserului in timp
 * ce el ceruse /admin/serie/123, am obtine o bucla. Il rezolvam aici, in
 * interiorul workerului, iar daca si al doilea raspuns e un redirect ne
 * oprim — mai bine un 404 onest decat o bucla infinita.
 */
async function followAssetRedirect(env, origin, location, headers) {
  if (!location) return null;
  const target = new URL(location, origin);
  const res = await env.ASSETS.fetch(new Request(target.toString(), { method: 'GET', headers }));
  if (res.status >= 300 && res.status < 400) return null;
  return res;
}

async function serveStatic(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (BLOCKED_PATHS.includes(path) || path.startsWith('/.git') || path.startsWith('/migrations')) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  if (!env.ASSETS?.fetch) {
    return jsonResponse({ error: 'Assetele statice nu sunt disponibile' }, 500);
  }

  // Pentru caile obisnuite NU remapam nimic: routerul de assete Pages stie
  // deja sa serveasca profile.html la /profile. O remapare /profile ->
  // /profile.html ar inchide o bucla infinita (ERR_TOO_MANY_REDIRECTS).
  const assetPath = assetPathFor(path);
  const assetRequest = assetPath
    ? new Request(new URL(assetPath, url.origin).toString(), { method: 'GET', headers: request.headers })
    : request;

  try {
    const res = await env.ASSETS.fetch(assetRequest);

    if (assetPath && res.status >= 300 && res.status < 400) {
      const followed = await followAssetRedirect(env, url.origin, res.headers.get('location'), request.headers);
      return followed || jsonResponse({ error: 'Not found' }, 404);
    }
    return res;
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
