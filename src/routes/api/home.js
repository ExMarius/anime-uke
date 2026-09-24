import { json } from '../../lib/http.js';
import * as seriesRoute from './series.js';
import * as topRoute from './top.js';
import * as recentRoute from './recent.js';
import * as genresRoute from './genres.js';
import * as pulseRoute from './pulse.js';

// =====================================================================
// GET /api/home — toată prima pagină într-o SINGURĂ cerere.
//
// DE CE EXISTĂ (buget 0, cota gratuită = 100.000 invocări/zi):
//   index.html făcea 5 cereri separate ca să se încarce: /api/series,
//   /api/top, /api/recent, /api/genres și /api/pulse. Fiecare = o invocare
//   de Worker, deci prima pagină costa 5 din cotă pentru fiecare vizitator.
//   Aici le agregăm: aceleași date, o singură invocare, zero request-uri
//   suplimentare către D1 (sub-handlerele au deja cache-urile lor).
//
//   Se aplică aceiași parametri de catalog ca la /api/series (page, per_page,
//   sort, q, gen, status), ca pagina să poată cere „pagina 2" prin același
//   endpoint dacă vrea.
//
// Degradare parțială: dacă una din secțiunile secundare (top/recent/genuri/
// pulse) pică, răspunsul rămâne 200 cu lista goală la secțiunea respectivă —
// pagina nu trebuie să moară din cauza unui clasament. Doar catalogul
// (secțiunea principală) e obligatoriu, iar eroarea lui se propagă ca atare.
// =====================================================================

/** Body-ul JSON al unui sub-handler, sau null dacă sub-handlerul a eșuat. */
async function bodyOr(res) {
  if (!res?.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const sub = { ...context, params: {} };

  const [seriesRes, topRes, recentRes, genresRes, pulseRes] = await Promise.all([
    seriesRoute.onRequestGet(sub),
    topRoute.onRequestGet(sub),
    recentRoute.onRequestGet(sub),
    genresRoute.onRequestGet(sub),
    pulseRoute.onRequestGet(sub),
  ]);

  const series = await bodyOr(seriesRes);
  // Catalogul e miezul paginii: dacă el a picat, întoarcem exact eroarea lui.
  if (!series) return seriesRes;

  const [top, recent, genres, pulse] = await Promise.all([
    bodyOr(topRes),
    bodyOr(recentRes),
    bodyOr(genresRes),
    bodyOr(pulseRes),
  ]);

  return json(
    {
      series,
      top: top || { weekly: [], rated: [] },
      recent: recent?.items || [],
      genres: genres?.genres || [],
      pulse,
    },
    // 30 s doar în browserul propriu (navigare înapoi/înainte), fără cache
    // partajat: răspunsul conține și contorul „online", care se mișcă.
    { headers: { 'cache-control': 'private, max-age=30' } }
  );
}
