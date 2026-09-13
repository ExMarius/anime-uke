import { json } from '../../lib/http.js';

// =====================================================================
// GET /api/pulse — semnele „live” ale site-ului, cu cost D1 aproape zero.
//
// Pagina se simte vie cand arata numere care SE MISCĂ: câți sunt online în
// chat, câte serii/episoade există, câte vizionări s-au acumulat. Fără asta
// site-ul pare o broșură statică.
//
// Buget D1 (planul gratuit = 5M rânduri citite/zi, scrieri PICA hard):
//   - un singur SELECT cu subinterogări COUNT, țintit de indexuri;
//   - ținut în cache la nivel de izolat 5 minute — la 1000 de vizitatori/zi
//     Costs ~kilobytes din cotă, nu milioane.
//   - „online” vine din ChatDO (memorie, zero D1) pe GET /state.
// =====================================================================

const CACHE_MS = 5 * 60 * 1000;
const cache = { at: 0, data: null };

export async function onRequestGet(context) {
  const { env } = context;

  const now = Date.now();
  if (!cache.data || now - cache.at > CACHE_MS) {
    try {
      const row = await env.DB
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM anime_series)                        AS series,
             (SELECT COUNT(*) FROM episodes)                            AS episodes,
             (SELECT COUNT(*) FROM users)                               AS members,
             (SELECT COALESCE(SUM(views), 0) FROM episodes)             AS views`
        )
        .first();
      cache.data = {
        series: row?.series || 0,
        episodes: row?.episodes || 0,
        members: row?.members || 0,
        views: row?.views || 0,
      };
      cache.at = now;
    } catch {
      // Pulse-ul e decorativ: o citire picată nu trebuie să strice nimic.
      if (!cache.data) cache.data = { series: 0, episodes: 0, members: 0, views: 0 };
    }
  }

  let online = 0;
  try {
    if (env.CHAT) {
      const stub = env.CHAT.get(env.CHAT.idFromName('global'));
      const res = await stub.fetch('https://chat.internal/state');
      if (res.ok) {
        const data = await res.json();
        online = Array.isArray(data.online) ? data.online.length : 0;
      }
    }
  } catch { /* chat-ul poate fi indisponibil; pulse-ul continuă fără el */ }

  return json({ ...cache.data, online });
}
