import { json, errorResponse } from '../../../lib/http.js';
import { validatePositiveInt } from '../../../lib/validate.js';
import { parsePaging, DEFAULT_EPISODES_PER_PAGE, MAX_EPISODES_PER_PAGE } from '../../../lib/paging.js';
import { requireUser } from '../../../lib/session.js';

// =====================================================================
// GET /api/series/:id — detaliile seriei + o PAGINA de episoade.
//
// De ce doua decizii aparent contradictorii (combinat intr-un raspuns,
// dar paginat):
//
//   1. Seria si episoadele vin impreuna ca sa economisim o invocare
//      Workers. Cota gratuita e de 100.000 de cereri/zi, iar in v1 pagina
//      seriei facea doua apeluri.
//
//   2. Episoadele SUNT paginate. Vechiul `LIMIT 2000` citea toate
//      episoadele la fiecare vizita: pentru o serie lunga (One Piece are
//      peste 1100) asta inseamna ~1100 randuri citite din D1 per vizita.
//      La 1000 DAU, daca doar o cincime dintre vizitatori deschid o serie
//      lunga, se duc ~220.000 de randuri/zi pe o singura pagina — iar
//      plafonul gratuit e de 5 milioane. Cu 100 pe pagina coboara de
//      zece ori.
//
// `episode_count` vine din coloana denormalizata de pe anime_series, deci
// frontend-ul poate desena selectorul de intervale fara niciun COUNT(*).
// =====================================================================

export async function onRequestGet(context) {
  const { env, params, request } = context;

  const id = validatePositiveInt(params.id, 'ID-ul seriei');
  if (!id.ok) return errorResponse(400, id.error);

  const url = new URL(request.url);
  const { page, perPage, offset } = parsePaging(
    url, DEFAULT_EPISODES_PER_PAGE, MAX_EPISODES_PER_PAGE
  );

  try {
    // Cere un rand in plus fata de pagina: daca vin perPage+1, mai exista o
    // pagina urmatoare. E mult mai ieftin decat un COUNT(*) pe episoade.
    const [seriesRes, episodesRes] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, title, description, cover_image, status, genre, year,
                episode_count, created_at
         FROM anime_series WHERE id = ?`
      ).bind(id.value),
      env.DB.prepare(
        `SELECT id, episode_number, title, views, created_at
         FROM episodes WHERE series_id = ?
         ORDER BY episode_number ASC
         LIMIT ? OFFSET ?`
      ).bind(id.value, perPage + 1, offset),
    ]);

    const series = seriesRes.results?.[0];
    if (!series) return errorResponse(404, 'Seria nu există');

    const rows = episodesRes.results || [];
    const hasMore = rows.length > perPage;
    const episodes = hasMore ? rows.slice(0, perPage) : rows;

    // episode_count e denormalizat, deci poate fi 0 pe o serie proaspat
    // migrata daca contorul nu a fost sincronizat. Il corectam din ce am
    // vazut efectiv, ca selectorul de intervale sa nu minta.
    const total = Math.max(Number(series.episode_count) || 0, offset + episodes.length);

    // Ratingul comunitatii: media si numarul de voturi se citesc pe indexul
    // de serie (randuri putine), iar nota proprie doar cand exista sesiune.
    const agg = await env.DB
      .prepare('SELECT AVG(rating) AS avg, COUNT(*) AS n FROM series_ratings WHERE series_id = ?')
      .bind(id.value)
      .first();
    let myRating = 0;
    let subscribed = false;
    const gate = await requireUser(request, env);
    if (!gate.response) {
      const mine = await env.DB
        .prepare('SELECT rating FROM series_ratings WHERE user_id = ? AND series_id = ?')
        .bind(gate.user.id, id.value)
        .first();
      myRating = mine?.rating || 0;
      // abonarea: un singur read pe indexul PK, doar cu sesiune
      const sub = await env.DB
        .prepare('SELECT 1 AS x FROM series_subscriptions WHERE user_id = ? AND series_id = ?')
        .bind(gate.user.id, id.value)
        .first();
      subscribed = !!sub;
    }
    const sc = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM series_subscriptions WHERE series_id = ?')
      .bind(id.value)
      .first();

    return json({
      series,
      episodes,
      page,
      per_page: perPage,
      has_more: hasMore,
      pages: Math.max(1, Math.ceil(total / perPage)),
      episode_count: total,
      rating_average: Math.round((agg?.avg || 0) * 10) / 10,
      rating_count: agg?.n || 0,
      my_rating: myRating,
      subscribed,
      subscriber_count: sc?.n || 0,
    });
  } catch (e) {
    console.error('GET /api/series/:id esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca seria');
  }
}
