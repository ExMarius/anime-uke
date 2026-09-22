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
import * as pulseRoute from './routes/api/pulse.js';
import * as progressRoute from './routes/api/progress.js';
import * as chestsRoute from './routes/api/chests.js';
import * as leaderboardRoute from './routes/api/leaderboard.js';
import * as ratingsRoute from './routes/api/ratings.js';
import * as commentsRoute from './routes/api/comments.js';
import * as continueRoute from './routes/api/continue.js';
import * as chestRoute from './routes/api/chest.js';
import * as economyRoute from './routes/api/economy.js';
import * as missionsRoute from './routes/api/missions.js';
import * as ranksRoute from './routes/api/ranks.js';
import * as meThemeRoute from './routes/api/me-theme.js';
import * as adminRankThemesRoute from './routes/api/admin/rank-themes.js';
import * as adminModsRoute from './routes/api/admin/mods.js';
import * as subscribeRoute from './routes/api/subscribe.js';
import * as shopRoute from './routes/api/shop.js';
import * as shopBuyRoute from './routes/api/shop-buy.js';
import * as shopActivateRoute from './routes/api/shop-activate.js';
import * as factionsRoute from './routes/api/factions.js';
import * as reportRoute from './routes/api/report.js';
import * as subtitleRoute from './routes/api/subtitle.js';
import * as genresRoute from './routes/api/genres.js';
import * as recentRoute from './routes/api/recent.js';
import * as homeRoute from './routes/api/home.js';
import * as commentsVoteRoute from './routes/api/comments-vote.js';
import * as reviewsRoute from './routes/api/reviews.js';
import * as topRoute from './routes/api/top.js';
import * as adminReportsRoute from './routes/api/admin/reports.js';
import * as notificationsRoute from './routes/api/notifications.js';
import * as notifUnreadRoute from './routes/api/notifications-unread.js';
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
  { method: 'GET', path: '/api/missions', mod: missionsRoute },
  { method: 'POST', path: '/api/missions', mod: missionsRoute },
  { method: 'GET', path: '/api/ranks', mod: ranksRoute },
  { method: 'POST', path: '/api/me/theme', mod: meThemeRoute },
  { method: '*', path: '/api/admin/rank-themes', mod: adminRankThemesRoute },
  { method: '*', path: '/api/admin/mods', mod: adminModsRoute },
  { method: 'POST', path: '/api/subscribe', mod: subscribeRoute },
  { method: 'GET', path: '/api/shop', mod: shopRoute },
  { method: 'POST', path: '/api/shop/buy', mod: shopBuyRoute },
  { method: 'POST', path: '/api/report', mod: reportRoute },
  { method: 'GET', path: '/api/subtitle', mod: subtitleRoute },
  { method: 'GET', path: '/api/genres', mod: genresRoute },
  { method: 'GET', path: '/api/recent', mod: recentRoute },
  { method: 'GET', path: '/api/home', mod: homeRoute },
  { method: 'POST', path: '/api/comments/vote', mod: commentsVoteRoute },
  { method: 'GET', path: '/api/reviews', mod: reviewsRoute },
  { method: 'POST', path: '/api/reviews', mod: reviewsRoute },
  { method: 'GET', path: '/api/top', mod: topRoute },
  { method: 'GET', path: '/api/admin/reports', mod: adminReportsRoute },
  { method: 'POST', path: '/api/admin/reports', mod: adminReportsRoute },
  { method: 'GET', path: '/api/notifications/unread', mod: notifUnreadRoute },
  { method: 'GET', path: '/api/pulse', mod: pulseRoute },
  // --- facțiuni (alegere lunară, reputație, clasament între facțiuni) ---
  { method: 'GET', path: '/api/factions', mod: factionsRoute },
  { method: 'POST', path: '/api/factions', mod: factionsRoute },
  // Activarea unei culori de nume / teme de site deja cumpărate din shop.
  { method: 'POST', path: '/api/shop/activate', mod: shopActivateRoute },
  { method: 'POST', path: '/api/notifications/read', mod: notificationsRoute },
  { method: 'GET', path: '/api/notifications', mod: notificationsRoute },
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
