// =====================================================================
// Router — inlocuieste rutarea automata din directorul functions/.
//
// DE CE ADVANCED MODE (`_worker.js`) SI NU `functions/`:
// Am testat empiric toate variantele — Pages Functions NU poate exporta
// clase Durable Object din bundle-ul generat:
//   "Your Worker depends on the following Durable Objects, which are not
//    exported in your entrypoint file"
// Am incercat: clase in src/ (esec), re-export in functions/_do.js (esec),
// re-export intr-un modul de ruta functions/chat.js (esec), cu wrangler 3
// si cu wrangler 4 (acelasi rezultat). Deci chat-ul prin Durable Objects
// impune Advanced Mode. Asta explica si de ce chat-ul din v1 nu functiona.
//
// Avantaj bonus: controlam explicit si header-ele de securitate pentru
// assetele statice, nu doar pentru raspunsurile API.
//
// Semnatura handlerelor e IDENTICA cu cea din Pages Functions
// ({ request, env, params, waitUntil }), deci modulele de rute au ramas
// neschimbate la mutare.
// =====================================================================

import * as seriesList from './routes/api/series.js';
import * as seriesById from './routes/api/series/by-id.js';
import * as episodeById from './routes/api/episodes/by-id.js';
import * as viewRoute from './routes/api/view.js';
import * as progressRoute from './routes/api/progress.js';
import * as chestsRoute from './routes/api/chests.js';
import * as leaderboardRoute from './routes/api/leaderboard.js';
import * as ratingsRoute from './routes/api/ratings.js';
import * as commentsRoute from './routes/api/comments.js';
import * as continueRoute from './routes/api/continue.js';
import * as chestRoute from './routes/api/chest.js';
import * as economyRoute from './routes/api/economy.js';
import * as registerRoute from './routes/api/auth/register.js';
import * as loginRoute from './routes/api/auth/login.js';
import * as logoutRoute from './routes/api/auth/logout.js';
import * as meRoute from './routes/api/auth/me.js';
import * as registerOptions from './routes/api/auth/register-options.js';
import * as adminStats from './routes/api/admin/stats.js';
import * as adminSeries from './routes/api/admin/series.js';
import * as adminEpisodes from './routes/api/admin/episodes.js';
import * as adminEpisodeSources from './routes/api/admin/episode-sources.js';
import * as adminUsers from './routes/api/admin/users.js';
import * as adminLog from './routes/api/admin/log.js';
import * as adminInvites from './routes/api/admin/invites.js';
import * as chatRoute from './routes/chat.js';
import * as profileRoute from './routes/api/profile.js';
import * as watchlistRoute from './routes/api/watchlist.js';

const ROUTES = [
  // --- publice ---
  { method: 'GET', path: '/api/series', mod: seriesList },
  { method: 'GET', path: '/api/series/:id', mod: seriesById },
  { method: 'GET', path: '/api/episodes/:id', mod: episodeById },

  // --- auth ---
  { method: 'POST', path: '/api/auth/register', mod: registerRoute },
  { method: 'POST', path: '/api/auth/login', mod: loginRoute },
  { method: 'POST', path: '/api/auth/logout', mod: logoutRoute },
  { method: 'GET', path: '/api/auth/me', mod: meRoute },
  { method: 'GET', path: '/api/auth/register-options', mod: registerOptions },

  // --- puncte / vizionari ---
  { method: 'POST', path: '/api/progress', mod: progressRoute },
  { method: '*', path: '/api/chests', mod: chestsRoute },
  { method: 'GET', path: '/api/leaderboard', mod: leaderboardRoute },
  { method: 'POST', path: '/api/ratings', mod: ratingsRoute },
  { method: '*', path: '/api/comments', mod: commentsRoute },
  { method: 'GET', path: '/api/continue', mod: continueRoute },
  { method: '*', path: '/api/chest', mod: chestRoute },
  { method: 'GET', path: '/api/economy', mod: economyRoute },
  { method: 'POST', path: '/api/view', mod: viewRoute },

  // --- profil + lista „de vizionat" ---
  { method: 'GET', path: '/api/profile/:username', mod: profileRoute },
  { method: 'PATCH', path: '/api/profile', mod: profileRoute },
  { method: '*', path: '/api/watchlist', mod: watchlistRoute },

  // --- admin ---
  { method: 'GET', path: '/api/admin/stats', mod: adminStats },
  { method: 'GET', path: '/api/admin/log', mod: adminLog },
  { method: '*', path: '/api/admin/series', mod: adminSeries },
  { method: '*', path: '/api/admin/episodes', mod: adminEpisodes },
  // Sursele video ale unui episod. E ruta separat pentru ca un episod poate
  // avea mai multe surse si ele se editeaza independent de episod.
  { method: '*', path: '/api/admin/episode-sources', mod: adminEpisodeSources },
  { method: '*', path: '/api/admin/users', mod: adminUsers },
  { method: '*', path: '/api/admin/invites', mod: adminInvites },

  // --- chat (WebSocket + fallback pentru lista online) ---
  { method: '*', path: '/chat', mod: chatRoute },
];

/** Compileaza un pattern („/api/series/:id") intr-un regex cu grupuri numite. */
function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

const COMPILED = ROUTES.map((r) => ({ ...r, ...compile(r.path) }));

const METHOD_MAP = {
  GET: 'onRequestGet',
  POST: 'onRequestPost',
  PUT: 'onRequestPut',
  PATCH: 'onRequestPatch',
  DELETE: 'onRequestDelete',
  OPTIONS: 'onRequestOptions',
};

/**
 * @returns {{handler: Function, params: object}|null}
 *          null = ruta nu e API (se serveste static din env.ASSETS)
 */
export function matchRoute(method, pathname) {
  for (const route of COMPILED) {
    const m = route.regex.exec(pathname);
    if (!m) continue;

    const params = {};
    route.keys.forEach((key, i) => {
      try { params[key] = decodeURIComponent(m[i + 1]); } catch { params[key] = m[i + 1]; }
    });

    const named = METHOD_MAP[method];
    const handler = (named && route.mod[named]) || route.mod.onRequest;

    // Ruta exista dar metoda nu e suportata
    if (!handler) return { handler: null, params, matchedPath: route.path };

    return { handler, params, matchedPath: route.path };
  }
  return null;
}
