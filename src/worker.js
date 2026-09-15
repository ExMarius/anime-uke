import { matchRoute } from './router.js';
import { SECURITY_HEADERS } from './lib/http.js';
import { getSessionUser } from './lib/session.js';

const API_404 = { error: 'Endpoint inexistent' };

const PUBLIC_PAGES = new Set(['/', '/series', '/episode', '/login', '/register', '/favicon.ico', '/robots.txt', '/sitemap.xml', '/sitemap.txt', '/llms.txt', '/speculationrules.json']);

const STATIC_PAGES = new Set([
  '/', '/index', '/series', '/episode', '/login', '/register', '/profile', '/shop',
  '/admin', '/admin/serii', '/admin/serie', '/404',
  '/favicon.ico', '/robots.txt', '/llms.txt', '/speculationrules.json',
]);
function isPublicPage(path) {
  if (PUBLIC_PAGES.has(path)) return true;
  if (path.startsWith('/serie/') || path.startsWith('/episod/')) return true;
  return false;
}
const PUBLIC_API = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/register-options',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/top',
  '/api/pulse',
  '/api/genres',
  '/api/recent',
  '/api/comments',
  '/api/subtitle',
]);
function isPublicApi(path) {
  if (PUBLIC_API.has(path)) return true;
  if (path === '/api/series' || path.startsWith('/api/series/')) return true;
  if (path.startsWith('/api/episodes/')) return true;
  return false;
}

function isPublic(path) {
  if (isPublicPage(path)) return true;
  if (isPublicApi(path)) return true;
  if (path.startsWith('/assets/')) return true;
  return false;
}

function redirectToLogin(url) {
  const next = `${url.pathname}${url.search}`;
  const target = `/login?next=${encodeURIComponent(next)}`;
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}

export async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const norm = path.length > 1 ? path.replace(/\/+$/, '').replace(/\.html$/, '') || '/' : path;

  let response;
  try {
    if (BLOCKED_PATHS.includes(path) || path.startsWith('/.git') || path.startsWith('/migrations')) {
      return applySecurityHeaders(jsonResponse({ error: 'Not found' }, 404));
    }

    if (norm === '/series' && !/^\d+$/.test(url.searchParams.get('id') || '')) {
      return applySecurityHeaders(new Response(null, {
        status: 301,
        headers: { Location: '/', 'Cache-Control': 'no-store' },
      }));
    }

    const isApiPath = path === '/api' || path.startsWith('/api/') || path === '/chat';
    const isAssetPath = path.startsWith('/assets/') || path.startsWith('/covers/');
    if (!isApiPath && !isAssetPath && path !== '/sitemap.xml' && path !== '/sitemap.txt' && !isKnownPage(norm)) {
      return applySecurityHeaders(notFoundPage());
    }

    if (!isPublic(norm)) {
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
    } else if (path === '/sitemap.xml' || path === '/sitemap.txt') {
      // Sitemap-ul trebuie sa fie citibil de Googlebot fara restrictii CORP/CSP.
      response = await sitemapHandler(request, env, path);
      return response;
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
    const allowed = allowedMethods(path);
    return new Response(JSON.stringify({ error: 'Metodă nepermisă' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: allowed.join(', ') },
    });
  }
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

const SITEMAP_CACHE_MS = 60 * 60 * 1000;
const sitemapCache = { at: 0, bodyXml: null, bodyTxt: null, body: null };

async function sitemapHandler(request, env, forPath = '/sitemap.xml') {
  const origin = canonicalOrigin(env, request);
  const now = Date.now();

  if (!sitemapCache.bodyXml || now - sitemapCache.at > SITEMAP_CACHE_MS) {
    let urls = ['/'];
    try {
      const seriesRes = await env.DB.prepare('SELECT id FROM anime_series ORDER BY id DESC LIMIT 2000').all();
      for (const r of seriesRes.results || []) urls.push(`/serie/${r.id}`);
      const epRes = await env.DB.prepare('SELECT id FROM episodes ORDER BY id DESC LIMIT 5000').all();
      for (const r of epRes.results || []) urls.push(`/episod/${r.id}`);
    } catch (e) {
      console.error('sitemap D1 esuat:', e?.message || e);
      // fallback hardcodat ca sa nu fie niciodata gol pentru Google
      urls = ['/', '/serie/1019', '/serie/1018', '/serie/1017', '/serie/1015', '/serie/1014', '/episod/4212', '/episod/4211', '/episod/4210', '/episod/4209', '/episod/4208'];
    }
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    sitemapCache.bodyXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((loc) => `  <url><loc>${esc(origin + loc)}</loc></url>`).join('\n') +
      `\n</urlset>\n`;
    sitemapCache.bodyTxt = urls.map((loc) => origin + loc).join('\n') + '\n';
    sitemapCache.at = now;
  }

  if (forPath === '/sitemap.txt') {
    return new Response(sitemapCache.bodyTxt, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return new Response(sitemapCache.bodyXml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

const BLOCKED_PATHS = ['/_worker.js', '/.dev.vars', '/wrangler.toml'];

const DYNAMIC_PAGES = [
  { re: /^\/admin\/serie\/\d+\/?$/, asset: '/admin/serie' },
  { re: /^\/serie\/\d+\/?$/, asset: '/series' },
  { re: /^\/episod\/\d+\/?$/, asset: '/episode' },
];

const SEO_CACHE_MS = 5 * 60 * 1000;

function canonicalOrigin(env, request) {
  const raw = String(env.CANONICAL_ORIGIN || '').trim();
  return raw.startsWith('http') ? raw.replace(/\/+$/, '') : new URL(request.url).origin;
}
const seoCache = new Map();

function seoCacheGet(key) {
  const hit = seoCache.get(key);
  if (hit && Date.now() - hit.at < SEO_CACHE_MS) return { hit: true, row: hit.row };
  return { hit: false, row: null };
}
function seoCacheSet(key, row) {
  if (seoCache.size > 300) seoCache.clear();
  seoCache.set(key, { at: Date.now(), row });
}

async function seriesForSeo(env, id) {
  const key = `s${id}`;
  const cached = seoCacheGet(key);
  if (cached.hit) return cached.row;
  try {
    const row = await env.DB
      .prepare(
        `SELECT id, title, description, cover_image, status, genre, year, episode_count,
                alt_titles, release_date, country, ep_duration, age_rating, external_url
         FROM anime_series WHERE id = ?`
      )
      .bind(id)
      .first();
    seoCacheSet(key, row || null);
    return row;
  } catch {
    return null;
  }
}

async function episodeForSeo(env, id) {
  const key = `ep${id}`;
  const cached = seoCacheGet(key);
  if (cached.hit) return cached.row;
  try {
    const row = await env.DB
      .prepare(
        `SELECT e.id, e.series_id, e.episode_number, e.title as ep_title,
                s.title as series_title, s.description as series_desc, s.cover_image, s.genre
         FROM episodes e JOIN anime_series s ON s.id = e.series_id WHERE e.id = ?`
      )
      .bind(id)
      .first();
    seoCacheSet(key, row || null);
    return row;
  } catch {
    return null;
  }
}

async function episodeExists(env, id) {
  const ep = await episodeForSeo(env, id);
  return Boolean(ep);
}

function escAttr(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
    startDate: series.release_date || (series.year ? String(series.year) : undefined),
    inLanguage: 'ro',
    alternateName: series.alt_titles
      ? String(series.alt_titles).split('/').map((t) => t.trim()).filter(Boolean)
      : undefined,
    countryOfOrigin: series.country ? { '@type': 'Country', name: series.country } : undefined,
    contentRating: series.age_rating || undefined,
    sameAs: series.external_url || undefined,
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

function episodeSeoTags(env, request, ep) {
  const origin = canonicalOrigin(env, request);
  const canonical = `${origin}/episod/${ep.id}`;
  const epNum = ep.episode_number;
  const seriesTitle = ep.series_title;
  const title = `${seriesTitle} Episodul ${epNum} Subtitrat în Română — Anime ro sub | Anime-Uke`;
  const desc = `${seriesTitle} episodul ${epNum} subtitrat în română, tradus ro sub, online gratuit pe Anime-Uke. ${String(ep.series_desc || '').slice(0, 80)}`.slice(0, 160);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TVEpisode',
    name: `${seriesTitle} Episodul ${epNum}`,
    episodeNumber: epNum,
    partOfSeries: { '@type': 'TVSeries', name: seriesTitle },
    description: desc,
    image: ep.cover_image || undefined,
    inLanguage: 'ro',
    url: canonical,
  };
  return `  <title>${escAttr(title)}</title>
  <meta name="description" content="${escAttr(desc)}">
  <link rel="canonical" href="${escAttr(canonical)}">
  <meta property="og:title" content="${escAttr(`${seriesTitle} Episodul ${epNum} — anime ro sub`)}">
  <meta property="og:description" content="${escAttr(desc)}">
  <meta property="og:type" content="video.episode">
  <meta property="og:url" content="${escAttr(canonical)}">
  <meta property="og:image" content="${escAttr(ep.cover_image || `${origin}/assets/img/hero-1.jpg`)}">
  <script type="application/ld+json">${JSON.stringify(ld)}</script>`;
}

function injectSeriesSeo(env, request, html, series) {
  const tags = seriesSeoTags(env, request, series);
  const withTitle = html.replace(/<title>.*?<\/title>/i, '');
  return withTitle.replace(/<\/head>/i, `${tags}\n</head>`);
}

function injectEpisodeSeo(env, request, html, ep) {
  const tags = episodeSeoTags(env, request, ep);
  const withTitle = html.replace(/<title>.*?<\/title>/i, '');
  return withTitle.replace(/<\/head>/i, `${tags}\n</head>`);
}

function assetPathFor(path) {
  for (const rule of DYNAMIC_PAGES) {
    if (rule.re.test(path)) return rule.asset;
  }
  return null;
}

function isKnownPage(path) {
  return STATIC_PAGES.has(path) || Boolean(assetPathFor(path));
}

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

  const assetPath = assetPathFor(path);
  const assetRequest = assetPath
    ? new Request(new URL(assetPath, url.origin).toString(), { method: 'GET', headers: request.headers })
    : request;

  try {
    const res = await env.ASSETS.fetch(assetRequest);

    if (res.status === 200) {
      const m = /^\/assets\/img\/.+\.(jpg|jpeg|png)$/i.exec(path);
      const acceptsWebp = (request.headers.get('accept') || '').includes('image/webp');
      if (m && acceptsWebp) {
        const webpUrl = new URL(path.replace(/\.(jpg|jpeg|png)$/i, '.webp'), url.origin);
        const webpRes = await env.ASSETS.fetch(new Request(webpUrl.toString(), { method: 'GET', headers: request.headers }));
        if (webpRes.status === 200 && (webpRes.headers.get('content-type') || '').includes('webp')) {
          return webpRes;
        }
      }
    }

    if (assetPath && res.status >= 300 && res.status < 400) {
      const followed = await followAssetRedirect(env, url.origin, res.headers.get('location'), request.headers);
      return followed || jsonResponse({ error: 'Not found' }, 404);
    }

    const serieMatch = path.match(/^\/serie\/(\d+)\/?$/);
    if (serieMatch && res.status === 200 && (res.headers.get('content-type') || '').includes('text/html')) {
      const series = await seriesForSeo(env, Number(serieMatch[1]));
      if (!series) return notFoundPage('Serie inexistentă', `Seria cu id-ul ${serieMatch[1]} nu există pe anime-uke.`);
      const html = await res.text();
      const headers = new Headers(res.headers);
      headers.delete('content-length');
      headers.delete('etag');
      return new Response(injectSeriesSeo(env, request, html, series), { status: 200, headers });
    }

    const epMatch = path.match(/^\/episod\/(\d+)\/?$/);
    if (epMatch && res.status === 200 && (res.headers.get('content-type') || '').includes('text/html')) {
      const ep = await episodeForSeo(env, Number(epMatch[1]));
      if (!ep) return notFoundPage('Episod inexistent', `Episodul cu id-ul ${epMatch[1]} nu există pe anime-uke.`);
      const html = await res.text();
      const headers = new Headers(res.headers);
      headers.delete('content-length');
      headers.delete('etag');
      return new Response(injectEpisodeSeo(env, request, html, ep), { status: 200, headers });
    }

    const versioned = path.startsWith('/assets/') && url.searchParams.has('v');
    if (versioned && res.status === 200) {
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return statusOverride(res, 200, headers);
    }

    return res;
  } catch (e) {
    console.error('ASSETS.fetch esuat pentru', path, ':', e?.message || e);
    return jsonResponse({ error: 'Not found' }, 404);
  }
}

function statusOverride(res, status, headers) {
  const h = new Headers(headers || res.headers);
  h.delete('content-length');
  h.delete('etag');
  return new Response(res.body, { status, statusText: res.statusText, headers: h });
}

function notFoundPage(title = 'Pagină inexistentă', message = 'Pagina cerută nu există pe anime-uke.') {
  const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0c0709">
  <meta name="robots" content="noindex, follow">
  <title>404 — ${title} • anime-uke</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%23dc143c'/><text x='50' y='70' font-size='58' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>鬼</text></svg>">
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 2rem 1rem;
           color: #f5eff1; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif; line-height: 1.55; background: #0c0709; }
    .nf { width: min(430px, 100%); padding: 2.4rem 2rem; text-align: center; border-radius: 22px;
          border: 1px solid rgba(220,20,60,.16); background: linear-gradient(165deg, #1a1114 0%, #120b0e 100%);
          box-shadow: 0 18px 50px -12px rgba(0,0,0,.85); position: relative; overflow: hidden; }
    .nf::before { content: ""; position: absolute; top: 0; inset-inline: 0; height: 3px;
                  background: linear-gradient(135deg, #dc143c 0%, #8b0a20 100%); }
    .nf__mark { display: grid; place-items: center; width: 58px; height: 58px; margin: 0 auto .9rem; border-radius: 17px;
                font-size: 1.7rem; color: #fff; background: linear-gradient(135deg, #dc143c 0%, #8b0a20 100%);
                box-shadow: 0 10px 30px -8px rgba(220,20,60,.38); }
    .nf__code { margin: 0; font-size: 3rem; font-weight: 900; letter-spacing: -.04em; color: #f4284f; line-height: 1; }
    .nf__title { margin: .45rem 0 .5rem; font-size: 1.22rem; font-weight: 800; }
    .nf__text { margin: 0 0 1.6rem; color: #a2939a; font-size: .92rem; }
    .nf a.btn { display: inline-block; padding: .62rem 1.05rem; border-radius: 12px; text-decoration: none;
                font-weight: 700; font-size: .92rem; margin: .2rem; }
    .btn--accent { background: linear-gradient(135deg, #dc143c 0%, #8b0a20 100%); color: #fff; }
    .btn--ghost { border: 1px solid rgba(255,255,255,.07); color: #a2939a; }
  </style>
</head>
<body>
  <main class="nf">
    <div class="nf__mark">鬼</div>
    <p class="nf__code">404</p>
    <h1 class="nf__title">${title}</h1>
    <p class="nf__text">${message}</p>
    <p>
      <a class="btn btn--accent" href="/">Mergi la catalog</a>
      <a class="btn btn--ghost" href="/login">Autentificare</a>
    </p>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, follow',
    },
  });
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function applySecurityHeaders(response) {
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
