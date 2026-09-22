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
const PUBLIC_PAGES = new Set(['/', '/series', '/episode', '/login', '/register', '/favicon.ico', '/apple-touch-icon.png', '/robots.txt', '/sitemap.xml', '/sitemap.txt', '/sitemap', '/llms.txt', '/speculationrules.json']);

// Paginile HTML publicate în public/ (+ cele servite de routerul Pages).
// Tot ce NU e aici și nu e nici API, nici asset, e rută inexistentă și primește
// 404 — vezi poarta din handleFetch. Fără ea, /package.json sau /AGENTS.md
// cădeau pe poarta de autentificare și răspundeau 302 → /login?next=/package.json,
// adică dezvăluiau că fișierul există în repo și umpleau crawl-ul de gunoi.
const STATIC_PAGES = new Set([
  '/', '/index', '/series', '/episode', '/login', '/register', '/profile', '/shop',
  '/admin', '/admin/serii',
  '/favicon.ico', '/apple-touch-icon.png', '/robots.txt', '/sitemap.xml', '/sitemap.txt', '/sitemap',
  '/llms.txt', '/speculationrules.json',
  // Intenționat ABSENTE (primesc 404 onest de la allowlist):
  //   /404          — nu există public/404.html; intrarea veche cerea login (302)!
  //   /admin/serie  — fără id, JS-ul pornea cu seriesId=NaN și făcea apeluri invalide.
]);
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
  '/api/home',           // prima pagina intr-o singura cerere (series+top+recent+genres+pulse)
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
  return false;
}

/** Redirectioneaza catre login pastrand destinatia, ca sa revii dupa logare. */
function redirectToLogin(url, normPath) {
  const next = `${normPath || url.pathname}${url.search}`;
  const target = `/login?next=${encodeURIComponent(next)}`;
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}

export async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);
  // Normalizeaza slash-urile duble (ex. //sitemap.xml → /sitemap.xml): unii
  // clienti construiesc URL-uri cu //, iar fara asta cadeau pe 404 deși
  // resursa exista. Tot rutarea lucreaza pe calea normalizata.
  const path = url.pathname.replace(/\/{2,}/g, '/') || '/';
  // Normalizare pentru verificările de rutare: `/series/` și `/series.html` sunt
  // aceeași pagină ca `/series`. Fără ea, `/series/` sărea peste redirectul 301
  // și ajungea la poarta de autentificare (302 → /login), iar `/profile.html`
  // primea 404 în loc de 308-ul de clean URL pe care îl dă routerul Pages.
  const norm = path.length > 1 ? path.replace(/\/+$/, '').replace(/\.html$/, '') || '/' : path;

  let response;
  try {
    // Fisierele care nu trebuie servite niciodata raspund cu 404 si pentru
    // vizitatori — un 302 catre /login ar dezvalui ca ruta exista.
    if (BLOCKED_PATHS.includes(path) || path.startsWith('/.git') || path.startsWith('/migrations')) {
      return applySecurityHeaders(jsonResponse({ error: 'Not found' }, 404));
    }

    // `/series` fără id e pagină moartă: JS-ul făcea location.replace('/'), iar
    // crawlerul vedea 200 + head gol (titlu generic, fără canonical/og) la un URL
    // declarat în sitemap. Acum trimitem 301 spre catalog (care chiar e pe `/`).
    // `/series?id=N` rămâne valabil (forma veche, folosită în linkuri).
    if (norm === '/series' && !/^\d+$/.test(url.searchParams.get('id') || '')) {
      return applySecurityHeaders(new Response(null, {
        status: 301,
        headers: { Location: '/', 'Cache-Control': 'no-store' },
      }));
    }

    // Rute necunoscute → 404 onest, înainte de poarta de autentificare.
    const isApiPath = path === '/api' || path.startsWith('/api/') || path === '/chat';
    // Fără /covers/: directorul public/covers/ nu există (coperțile sunt URL-uri
    // externe), deci îl lăsăm să cadă pe pagina 404 a site-ului, nu pe 404-ul generic.
    const isAssetPath = path.startsWith('/assets/');
    if (!isApiPath && !isAssetPath && path !== '/sitemap.xml' && path !== '/sitemap.txt' && path !== '/sitemap' && !isKnownPage(norm)) {
      return applySecurityHeaders(notFoundPage());
    }

    if (!isPublic(norm)) {
      const session = await getSessionUser(request, env);
      if (!session) {
        const isApi = path === '/api' || path.startsWith('/api/') || path === '/chat';
        response = isApi
          ? jsonResponse({ error: 'Trebuie să fii autentificat' }, 401)
          : redirectToLogin(url, path);
        return applySecurityHeaders(response);
      }
    }

    if (path === '/api' || path.startsWith('/api/') || path === '/chat') {
      response = await handleApi(request, env, ctx, path);
    } else if (path === '/sitemap.xml' || path === '/sitemap.txt' || path === '/sitemap') {
      // Sitemap-urile ies direct, FĂRĂ headerele de securitate (CORP/CSP):
      // sunt consumate de crawler-e, nu de browsere, iar varianta minimalista
      // (fara headere, text/xml) e cea care a trecut de verificarile GSC.
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
const sitemapCache = { at: 0, bodyXml: null, bodyTxt: null };

async function sitemapHandler(request, env, forPath = '/sitemap.xml') {
  const origin = canonicalOrigin(env, request);
  const now = Date.now();

  if (!sitemapCache.bodyXml || now - sitemapCache.at > SITEMAP_CACHE_MS) {
    // Prima pagina + URL-urile pretty ale seriilor si episoadelor (cele pe
    // care le indexam; canonical-ul pointeaza spre ele, deci sitemap-ul
    // trebuie sa fie coerent). Fara /login si /register (utilitare) si fara
    // /series (face 301 spre / — un URL de sitemap care redirecteaza la alt
    // URL e semnal de calitate slabă).
    let urls = null;
    try {
      const seriesRes = await env.DB.prepare('SELECT id FROM anime_series ORDER BY id DESC LIMIT 2000').all();
      const epRes = await env.DB.prepare('SELECT id FROM episodes ORDER BY id DESC LIMIT 5000').all();
      urls = ['/'];
      for (const r of seriesRes.results || []) urls.push(`/serie/${r.id}`);
      for (const r of epRes.results || []) urls.push(`/episod/${r.id}`);
      if (urls.length <= 1) throw new Error('empty');
    } catch (e) {
      console.error('sitemap D1 esuat, folosesc fallback static:', e?.message || e);
      // Fallback 100% static — garantat valid chiar daca D1 e down.
      urls = ['/', '/serie/1019', '/serie/1018', '/serie/1017', '/serie/1015', '/serie/1014',
        '/episod/4212', '/episod/4211', '/episod/4210', '/episod/4209', '/episod/4208'];
    }
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    sitemapCache.bodyXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((loc) => `  <url><loc>${esc(origin + loc)}</loc></url>`).join('\n') +
      `\n</urlset>`;
    sitemapCache.bodyTxt = urls.map((loc) => origin + loc).join('\n');
    sitemapCache.at = now;
  }

  // Varianta text (un URL pe linie) — ceruta de Google Search Console ca
  // alternativa la cea XML.
  if (forPath === '/sitemap.txt') {
    return new Response(sitemapCache.bodyTxt, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // /sitemap.xml si /sitemap (fara extensie) — acelasi XML minimalist.
  return new Response(sitemapCache.bodyXml, {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Cai care nu trebuie servite niciodata ca asset static. In productie Pages
// exclude automat `_worker.js`, dar blocam explicit ca sa nu depindem de asta
// si ca mesajele de eroare ale serverului de assete sa nu scape catre client
// (local, wrangler raspundea cu un 502 care includea calea absoluta pe disc).
const BLOCKED_PATHS = ['/_worker.js', '/.dev.vars', '/wrangler.toml'];

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
const seoCache = new Map();   // cheie -> { at, row } (row = null înseamnă „nu există”)

/** Cache la nivel de izolat: scutește D1 de aceleași citiri repetate. */
function seoCacheGet(key) {
  const hit = seoCache.get(key);
  if (hit && Date.now() - hit.at < SEO_CACHE_MS) return { hit: true, row: hit.row };
  return { hit: false, row: null };
}
function seoCacheSet(key, row) {
  if (seoCache.size > 200) seoCache.clear();
  seoCache.set(key, { at: Date.now(), row });
}

/**
 * @returns {object|null|undefined} rândul | null (nu există) | undefined (eroare D1 → shell, fără 404 fals)
 */
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
    // Cășuim și absența: scanerele lovesc aceleași id-uri inventate de multe ori.
    seoCacheSet(key, row || null);
    return row;
  } catch {
    return undefined;
  }
}

/**
 * Episodul + datele seriei lui, pentru SSR SEO pe /episod/<id>.
 *
 * O singură citire D1 (JOIN indexat pe cheia primară), cu cache 5 min în
 * izolat — inclusiv cache negativ, ca scanerele care lovesc id-uri inventate
 * să nu ardă cota gratuită. La eroare de D1 întoarce `undefined` („nu știu”):
 * pagina-shell se servește ca atare, fără 404 fals pe un episod real.
 *
 * @returns {object|null|undefined} rândul | null (nu există) | undefined (eroare D1)
 */
async function episodeForSeo(env, id) {
  const key = `e${id}`;
  const cached = seoCacheGet(key);
  if (cached.hit) return cached.row;
  try {
    const row = await env.DB
      .prepare(
        `SELECT e.id, e.series_id, e.episode_number, e.title AS ep_title, e.created_at,
                s.title AS series_title, s.description AS series_desc, s.cover_image,
                s.genre, s.year, s.status
         FROM episodes e
         JOIN anime_series s ON s.id = e.series_id
         WHERE e.id = ?`
      )
      .bind(id)
      .first();
    seoCacheSet(key, row || null);
    return row;
  } catch {
    return undefined;
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
    startDate: series.release_date || (series.year ? String(series.year) : undefined),
    inLanguage: 'ro',
    // Fisa detaliata (0024): Google foloseste alternateName pentru cautari
    // dupa titlul japonez/englez, sameAs leaga entitatea de MAL/AniList.
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

/** Injecteaza tagurile in HTML-ul paginii de serie (inlocuieste <title>). */
function injectSeriesSeo(env, request, html, series) {
  const tags = seriesSeoTags(env, request, series);
  const withTitle = html.replace(/<title>.*?<\/title>/i, '');
  return withTitle.replace(/<\/head>/i, `${tags}\n</head>`);
}

/**
 * Tagurile <head> generate pe server pentru un episod.
 *
 * Paginile de episod sunt poarta principală de trafic organic („anime X
 * episodul Y subtitrat în română”), deci titlul pune exact interogarea:
 * serie + număr episod + „subtitrat în română”. JSON-LD e TVEpisode (perechea
 * lui TVSeries de pe pagina seriei) + BreadcrumbList Acasă → Serie → Episod.
 */
function episodeSeoTags(env, request, ep) {
  const origin = canonicalOrigin(env, request);
  const canonical = `${origin}/episod/${ep.id}`;
  const epLabel = `Episodul ${ep.episode_number}`;
  const title = `${ep.series_title} — ${epLabel} subtitrat în română | Anime-Uke`;
  const epTitle = String(ep.ep_title || '').trim();
  const desc = (
    epTitle
      ? `${epLabel} „${epTitle}” din ${ep.series_title}, subtitrat în română, gratuit, pe Anime-Uke.`
      : `${epLabel} din ${ep.series_title} — anime subtitrat în română, gratuit, pe Anime-Uke.`
  ).slice(0, 160);

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TVEpisode',
        episodeNumber: ep.episode_number,
        name: `${ep.series_title} — ${epLabel}`,
        description: String(ep.series_desc || desc).slice(0, 500),
        image: ep.cover_image || undefined,
        datePublished: String(ep.created_at || '').slice(0, 10) || undefined,
        inLanguage: 'ro',
        url: canonical,
        partOfTVSeries: {
          '@type': 'TVSeries',
          name: ep.series_title,
          url: `${origin}/serie/${ep.series_id}`,
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Acasă', item: `${origin}/` },
          { '@type': 'ListItem', position: 2, name: ep.series_title, item: `${origin}/serie/${ep.series_id}` },
          { '@type': 'ListItem', position: 3, name: epLabel, item: canonical },
        ],
      },
    ],
  };

  return `  <title>${escAttr(title)}</title>
  <meta name="description" content="${escAttr(desc)}">
  <link rel="canonical" href="${escAttr(canonical)}">
  <meta property="og:title" content="${escAttr(`${ep.series_title} — ${epLabel}`)}">
  <meta property="og:description" content="${escAttr(desc)}">
  <meta property="og:type" content="video.episode">
  <meta property="og:url" content="${escAttr(canonical)}">
  <meta property="og:image" content="${escAttr(ep.cover_image || `${origin}/assets/img/hero-1.jpg`)}">
  <script type="application/ld+json">${JSON.stringify(ld)}</script>`;
}

/** Injecteaza tagurile in HTML-ul paginii de episod (inlocuieste <title>). */
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

/**
 * E calea o pagină pe care o avem într-adevăr? Se cheamă cu calea NORMALIZATĂ
 * (fără slash final și fără .html), deci aici mai verificăm doar seturile.
 */
function isKnownPage(path) {
  return STATIC_PAGES.has(path) || Boolean(assetPathFor(path));
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

    // NOTA: /assets/* nu mai ajunge aici in mod normal — public/_routes.json
    // le serveste direct din stratul static (zero invocari Functions), cu
    // headerele din public/_headers. Imaginile hero sunt referite direct ca
    // .webp din HTML/JS, deci nu mai e nevoie de negociere Accept aici.

    if (assetPath && res.status >= 300 && res.status < 400) {
      const followed = await followAssetRedirect(env, url.origin, res.headers.get('location'), request.headers);
      return followed || jsonResponse({ error: 'Not found' }, 404);
    }

    // SSR „lite": /serie/<id> iese cu head plin (titlu, descriere, JSON-LD)
    // generat din D1 — crawlerii nu trebuie sa ruleze JS ca sa inteleaga pagina.
    const serieMatch = path.match(/^\/serie\/(\d+)\/?$/);
    if (serieMatch && res.status === 200 && (res.headers.get('content-type') || '').includes('text/html')) {
      const series = await seriesForSeo(env, Number(serieMatch[1]));
      // Serie inexistentă → 404 REAL. Până aici răspundeam 200 cu shell-ul paginii
      // și lăsam JS-ul să scrie „Seria nu există": pentru Google era un soft 404
      // (pagină indexabilă, goală), iar crawl budget-ul se ducea pe id-uri inventate.
      if (series === null) return notFoundPage('Serie inexistentă', `Seria cu id-ul ${serieMatch[1]} nu există pe anime-uke.`);
      // series === undefined = eroare D1: servim shell-ul nemodificat (fără 404 fals).
      if (!series) return res;
      const html = await res.text();
      const headers = new Headers(res.headers);
      headers.delete('content-length');
      headers.delete('etag');
      return new Response(injectSeriesSeo(env, request, html, series), { status: 200, headers });
    }

    // /episod/<id>: 404 real la id inexistent + head plin (titlu, descriere,
    // canonical, og, JSON-LD TVEpisode) generat din D1 — la fel ca la serii.
    const epMatch = path.match(/^\/episod\/(\d+)\/?$/);
    if (epMatch && res.status === 200 && (res.headers.get('content-type') || '').includes('text/html')) {
      const ep = await episodeForSeo(env, Number(epMatch[1]));
      if (ep === null) return notFoundPage('Episod inexistent', `Episodul cu id-ul ${epMatch[1]} nu există pe anime-uke.`);
      // ep === undefined = eroare D1: servim shell-ul nemodificat (fără 404 fals).
      if (ep) {
        const html = await res.text();
        const headers = new Headers(res.headers);
        headers.delete('content-length');
        headers.delete('etag');
        return new Response(injectEpisodeSeo(env, request, html, ep), { status: 200, headers });
      }
    }

    // Cache-Control pentru JS/CSS vine din public/_headers (no-cache local,
    // immutable in productie — deploy.sh face inlocuirea), nu de aici:
    // assetele nu mai trec prin worker.
    return res;
  } catch (e) {
    // Nu lasam eroarea interna sa ajunga la client
    console.error('ASSETS.fetch esuat pentru', path, ':', e?.message || e);
    return jsonResponse({ error: 'Not found' }, 404);
  }
}

/**
 * Pagina 404 a sitului — HTML complet, generat aici, fără nicio dependință.
 *
 * De ce nu public/404.html + CSS + JS: o pagină de eroare trebuie să se vadă
 * corect chiar și când assetele lipsesc (deploy greșit, purge CSS agresiv) și
 * nu merita 3 cereri în plus. Stilul e inline în <style>, deci nu depinde de
 * style.css și nici de safelist-ul din purge-css.
 */
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
      // Centură și pentru header: un 404 cu conținut nu trebuie indexat.
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
