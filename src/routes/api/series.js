import { json, errorResponse } from '../../lib/http.js';
import { parsePaging, parseQuery, parseSort, sortSql, sortOptions, escapeLike, readMeta } from '../../lib/paging.js';

// =====================================================================
// GET /api/series — lista publica a seriilor, cu cautare si paginare.
//
//   ?q=naruto      cauta in titlu (si gen)
//   ?sort=latest   latest | oldest | title | episodes
//   ?page=2        pagina (1-based)
//   ?per_page=24   cate pe pagina (max 60)
//
// DE CE PAGINARE PE SERVER
//   Inainte se returnau pana la 500 de serii odata, iar pagina principala
//   le filtra in browser. La 1000+ serii asta se rupe in doua feluri:
//   jumatate din serii nu apareau deloc (LIMIT 500), iar fiecare cerere
//   citea sute de randuri din D1. Acum o cerere citeste ~24 de randuri.
//
// DE CE episode_count E O COLOANA, NU UN SUBQUERY
//   Un COUNT(*) corelat pe episodes costa proportional cu numarul de
//   episoade ale seriei. Pentru o serie lunga (One Piece, 1100+ episoade)
//   asta insemna o scanare de index la fiecare vizualizare a listei.
//   Coloana se actualizeaza doar cand un admin adauga/sterge un episod.
// =====================================================================

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const { page, perPage, offset } = parsePaging(url);
  const q = parseQuery(url);
  const sort = parseSort(url);

  const where = [];
  const params = [];

  if (q) {
    // Cautam in titlu si gen. ESCAPE '\' e obligatoriu: fara el, un termen
    // care contine % sau _ ar fi interpretat ca sablon, nu ca literal.
    const like = `%${escapeLike(q)}%`;
    where.push(`(s.title LIKE ? ESCAPE '\\' OR s.genre LIKE ? ESCAPE '\\')`);
    params.push(like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    // Cerem perPage + 1 randuri: daca primim mai multe decat am cerut, exista
    // pagina urmatoare. Astfel aflam `has_more` fara un COUNT(*) pe tabel.
    const res = await env.DB
      .prepare(
        `SELECT s.id, s.title, s.description, s.cover_image, s.status, s.genre, s.year,
                s.episode_count, s.created_at
         FROM anime_series s
         ${whereSql}
         ORDER BY ${sortSql(sort)}
         LIMIT ? OFFSET ?`
      )
      .bind(...params, perPage + 1, offset)
      .all();

    const rows = res.results || [];
    const hasMore = rows.length > perPage;
    const series = hasMore ? rows.slice(0, perPage) : rows;

    // Totalul vine din contorul denormalizat (1 rand) cand nu se cauta.
    // La cautare numaram doar rezultatele — mult mai putine randuri decat
    // intreg tabelul, si utilizatorul chiar vrea sa vada „3 rezultate".
    let total;
    if (q) {
      const c = await env.DB
        .prepare(`SELECT COUNT(*) AS n FROM anime_series s ${whereSql}`)
        .bind(...params)
        .first();
      total = c?.n ?? 0;
    } else {
      total = await readMeta(env, 'series_total');
    }

    return json({
      series,
      page,
      per_page: perPage,
      has_more: hasMore,
      total,
      total_episodes: await readMeta(env, 'episodes_total'),
      pages: Math.max(1, Math.ceil(total / perPage)),
      q,
      sort,
      sorts: sortOptions(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/series esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca seriile');
  }
}

export async function onRequestOptions() {
  return json({ sorts: sortOptions(), max_per_page: 60 });
}

export async function onRequestPost() {
  return errorResponse(405, 'Folosește /api/admin/series pentru a adăuga o serie');
}
