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
// Site public: catalogul si episoadele se pot viziona fara cont. Ce rămâne
// in spatele porții: tot ce e personal sau comunitar (progres, puncte, chat,
// comentarii de scris, ratinguri, cufere, shop, profil, admin).
const PUBLIC_PAGES = new Set(['/', '/series', '/episode', '/login', '/register', '/favicon.ico', '/robots.txt', '/sitemap.xml']);
function isPublicPage(path) {
  if (PUBLIC_PAGES.has(path)) return true;
  // URL-urile pretty de catalog: publice (site public).
  if (path.startsWith('/serie/') || path.startsWith('/episod/')) return true;
  return false;
}
const PUBLIC_API = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/register-options',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/top',            // clasamente publice (agregari anonime)
  '/api/pulse',          // doar un contor agregat („N online”), fara date personale
  '/api/genres',         // lista de genuri pentru filtre (zero date personale)
  '/api/recent',         // ultimele episoade adaugate (date de catalog)
  '/api/comments',       // citirea comentariilor; scrierea isi cere singura sesiune
  '/api/subtitle',       // subtitrarile, pentru vizionarea fara cont
]);
function isPublicApi(path) {
  if (PUBLIC_API.has(path)) return true;
  // Detaliul seriei (cu episoade) si sursele episodului: publice, ca sa
  // mearga vizionarea fara cont. Nu expun decat continut de catalog.
  if (path === '/api/series' || path.startsWith('/api/series/')) return true;
  if (path.startsWith('/api/episodes/')) return true;
  return false;
}

function isPublic(path) {
  if (isPublicPage(path)) return true;
  if (isPublicApi(path)) return true;
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
    } else if (path === '/sitemap.xml') {
      response = await sitemapHandler(request, env);
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

// =====================================================================
// SITEMAP — partea „site real”, nu jucărie: motoarele de căutare primesc
// o hartă validă a catalogului. E publică (roboții nu au cont), dar nu
// expune nimic sensitiv: doar URL-uri canoinice.
//
// Buget: un singur SELECT indexat (id + updated_at), ținut în cache la
// nivel de izolat 1 oră — cost D1 neglijabil indiferent de trafic.
// =====================================================================
const SITEMAP_CACHE_MS = 60 * 60 * 1000;
const sitemapCache = { at: 0, body: null };

async function sitemapHandler(request, env) {
  const origin = canonicalOrigin(env, request);
  const now = Date.now();

  if (!sitemapCache.body || now - sitemapCache.at > SITEMAP_CACHE_MS) {
    let urls = ['/', '/login', '/register'];
    try {
      const res = await env.DB
        .prepare('SELECT id FROM anime_series ORDER BY id DESC LIMIT 2000')
        .all();
      // URL-urile pretty — cele pe care le indexam (canonical-ul din pagina
      // pointeaza spre ele, deci sitemap-ul trebuie sa fie coerent).
      for (const r of res.results || []) urls.push(`/serie/${r.id}`);
    } catch (e) {
      console.error('sitemap D1 esuat:', e?.message || e);
    }
    const esc = (s) => s.replace(/&/g, '&amp;');
    sitemapCache.body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${esc(origin + u)}</loc></url>`).join('\n') +
      `\n</urlset>\n`;
    sitemapCache.at = now;
  }

  return new Response(sitemapCache.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
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
  // URL-uri prietenoase pentru SEO (modelul site-urilor de anime):
  // /serie/1014 in loc de /series?id=1014. Same pagina, adresa citibila.
  { re: /^\/serie\/\d+\/?$/, asset: '/series' },
  { re: /^\/episod\/\d+\/?$/, asset: '/episode' },
];

// ---------------------------------------------------------------------
// SSR „lite" pentru /serie/<id>: crawlerii (Google) si share-urile sociale
// primesc HTML cu titlul, descrierea si datele structurate ale seriei,
// fara sa depinda de rularea JS-ului. Cost: 1 citire D1 per serie, tinuta
// in cache 5 minute in izolat — un crawler rabdator citeste o singura
// data indiferent cate pagini acceseaza.
// ---------------------------------------------------------------------
const SEO_CACHE_MS = 5 * 60 * 1000;

/**
 * Originea canonica pentru SEO (canonical, og:url, sitemap).
 * Implicit originea cererii (ex. pages.dev). Cand ownerul adauga un domeniu
 * propriu (gratuit DigitalPlat sau .ro platit), seteaza variabila
 * CANONICAL_ORIGIN (ex. https://anime-uke.dpdns.org) in configurarea Pages —
 * si TOATE referintele SEO comuta odata, fara modificari de cod.
 */
function canonicalOrigin(env, request) {
  const raw = String(env.CANONICAL_ORIGIN || '').trim();
  return raw.startsWith('http') ? raw.replace(/\/+$/, '') : new URL(request.url).origin;
}
const seoCache = new Map();   // id -> { at, row }

async function seriesForSeo(env, id) {
  const now = Date.now();
  const hit = seoCache.get(id);
  if (hit && now - hit.at < SEO_CACHE_MS) return hit.row;
  try {
    const row = await env.DB
      .prepare(
        `SELECT id, title, description, cover_image, status, genre, year, episode_count
         FROM anime_series WHERE id = ?`
      )
      .bind(id)
      .first();
    if (row) {
      if (seoCache.size > 200) seoCache.clear();
      seoCache.set(id, { at: now, row });
    }
    return row;
  } catch {
    return null;
  }
}

function escAttr(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Tagurile <head> generate pe server pentru o serie. */
function seriesSeoTags(env, request, series) {
  const origin = canonicalOrigin(env, request);
  const canonical = `${origin}/serie/${series.id}`;
  const title = `${series.title} — Anime subtitrat în română online | Anime-Uke`;
  const desc = String(series.description || '').trim().slice(0, 160)
    || `${series.title} — anime subtitrat în română, gratuit, pe Anime-Uke.`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    name: series.title,
    description: String(series.description || '').slice(0, 500) || undefined,
    image: series.cover_image || undefined,
    genre: series.genre ? String(series.genre).split(',').map((g) => g.trim()).filter(Boolean) : undefined,
    numberOfEpisodes: series.episode_count || undefined,
    startDate: series.year ? String(series.year) : undefined,
    inLanguage: 'ro',
  };

  return `  <title>${escAttr(title)}</title>
  <meta name="description" content="${escAttr(desc)}">
  <link rel="canonical" href="${escAttr(canonical)}">
  <meta property="og:title" content="${escAttr(series.title)}">
  <meta property="og:description" content="${escAttr(desc)}">
  <meta property="og:type" content="video.tv_show">
  <meta property="og:url" content="${escAttr(canonical)}">
  <meta property="og:image" content="${escAttr(series.cover_image || `${origin}/assets/img/hero-1.jpg`)}">
  <script type="application/ld+json">${JSON.stringify(ld)}</script>`;
}

/** Injecteaza tagurile in HTML-ul paginii de serie (inlocuieste <title>). */
function injectSeriesSeo(env, request, html, series) {
  const tags = seriesSeoTags(env, request, series);
  const withTitle = html.replace(/<title>.*?<\/title>/i, '');
  return withTitle.replace(/<\/head>/i, `${tags}\n</head>`);
}

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

    // SSR „lite": /serie/<id> iese cu head plin (titlu, descriere, JSON-LD)
    // generat din D1 — crawlerii nu trebuie sa ruleze JS ca sa inteleaga pagina.
    const serieMatch = path.match(/^\/serie\/(\d+)\/?$/);
    if (serieMatch && res.status === 200 && (res.headers.get('content-type') || '').includes('text/html')) {
      const series = await seriesForSeo(env, Number(serieMatch[1]));
      if (series) {
        const html = await res.text();
        const headers = new Headers(res.headers);
        headers.delete('content-length');
        headers.delete('etag');
        return new Response(injectSeriesSeo(env, request, html, series), { status: 200, headers });
      }
    }

    // Cache: JS/CSS-ul cerut CU ?v=<commit> e versionat la deploy → poate fi
    // „immutable" 1 an. Fara ?v= (ex. importurile relative dintre modulele
    // /assets/js) lasam regula din _headers (no-cache + ETag → 304 ieftin):
    // asa un deploy nu lasa module vechi blocate in cache un an. Coperțile
    // /covers/* nu au regula in _headers → o saptamana e echilibrul bun:
    // vizitatorii recurenți nu le redescarcă, iar un inlocuit se propagă repede.
    const versioned = path.startsWith('/assets/') && url.searchParams.has('v');
    const covers = path.startsWith('/covers/');
    if ((versioned || covers) && res.status === 200) {
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', versioned
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=604800');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
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
