import { json } from '../../lib/http.js';

// =====================================================================
// GET /api/pulse — semnele „live” ale site-ului, cu cost D1 aproape zero.
//
// Pagina se simte vie cand arata numere care SE MISCĂ: câți sunt online în
// chat, câte serii/episoade există, câte vizionări s-au acumulat. Fără asta
// site-ul pare o broșură statică.
//
// Buget D1 (planul gratuit = 5M rânduri citite/zi, scrieri PICA hard):
//   Măsurat la scara maximă (1.000 serii / 1.000 useri, vezi migrarea 0028):
//   COUNT(*) pe anime_series + COUNT(*) pe users + SUM(views) pe toate
//   episoadele = 41.576 rânduri citite la FIECARE reîmprospătare a cache-ului
//   de 5 minute. Cu câteva izolate calde, doar contorul decorativ din
//   subsolul paginii mânca toată cota zilei.
//
//   Acum citește contoarele denormalizate din site_meta (întreținute de
//   admin/series + admin/episodes la adăugări/ștergeri, de register.js la
//   cont nou și de StatsDO la flush-ul de vizualizări): 4 rânduri în loc de
//   41.576. Diferența posibilă față de COUNT(*) e de câteva unități în urma
//   realității (o vizualizare încă neflush-uită din DO) — pentru un număr
//   afișat ca „câte serii există" asta e irelevant, iar economisirea nu e.
//   - online vine din ChatDO (memorie, zero D1) pe GET /state.
// =====================================================================

const CACHE_MS = 5 * 60 * 1000;
/** Contoarele din site_meta care alcătuiesc „pulse"-ul de catalog. */
export const PULSE_KEYS = ['series_total', 'episodes_total', 'users_total', 'views_total'];
const cache = { at: 0, data: null };

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
      // Pulse-ul e decorativ: o citire picată nu trebuie să strice nimic.
      if (!cache.data) cache.data = { series: 0, episodes: 0, members: 0, views: 0 };
    }
  }

  let online = 0;
  try {
    if (env.CHAT) {
      // ACELAȘI nume ca în src/routes/chat.js ('global-chat'): cu 'global' citeam
      // o instanță-fantomă, mereu goală, deci „online" era permanent 0.
      const stub = env.CHAT.get(env.CHAT.idFromName('global-chat'));
      const res = await stub.fetch('https://chat.internal/state');
      if (res.ok) {
        const data = await res.json();
        online = Array.isArray(data.online) ? data.online.length : 0;
      }
    }
  } catch { /* chat-ul poate fi indisponibil; pulse-ul continuă fără el */ }

  return json({ ...cache.data, online });
}
