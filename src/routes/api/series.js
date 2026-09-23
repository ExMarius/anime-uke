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
//
// DE CE rating_avg/rating_count SUNT IN LISTA (adăugate 2026-09-23)
//   Cardurile arată „★ 8.7 (12)" doar dacă nota vine o dată cu catalogul.
//   Alternativa (o cerere per card) ar fi însemnat 24 de invocări în plus
//   pentru fiecare vizită — exact ce a scos /api/home. Coloanele sunt
//   denormalizate pe serie (migrarea 0028), deci vin din ACELAȘI rând citit
//   oricum: zero rânduri în plus din D1, zero cereri în plus din browser.
// =====================================================================

// Pragul pana la care numarăm rezultatele unei cautari. Un COUNT(*) exact pe
// LIKE '%termen%' scaneaza tot catalogul (masurat: 1013 randuri la 1013 serii),
// asa ca il limitam si raportam „500+" — vezi comentariul din onRequestGet.
const TOTAL_CAP = 500;

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

  // --- filtre de catalog (modelul site-urilor de anime: genuri, status, an) ---
  const genRaw = String(url.searchParams.get('gen') || '').trim().slice(0, 40);
  if (genRaw) {
    where.push(`s.genre LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLike(genRaw)}%`);
  }
  const statusRaw = String(url.searchParams.get('status') || '');
  if (statusRaw === 'ongoing' || statusRaw === 'completed') {
    where.push('s.status = ?');
    params.push(statusRaw);
  }
  const yearRaw = Number(url.searchParams.get('year'));
  if (Number.isInteger(yearRaw) && yearRaw >= 1950 && yearRaw <= 2100) {
    where.push('s.year = ?');
    params.push(yearRaw);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    // Cerem perPage + 1 randuri: daca primim mai multe decat am cerut, exista
    // pagina urmatoare. Astfel aflam `has_more` fara un COUNT(*) pe tabel.
    const res = await env.DB
      .prepare(
        `SELECT s.id, s.title, s.description, s.cover_image, s.status, s.genre, s.year,
                s.episode_count, s.rating_avg, s.rating_count, s.created_at
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
    //
    // La cautare, un COUNT(*) exact ar scana tot tabelul: LIKE '%termen%' nu
    // poate folosi indexul, deci costul creste cu marimea catalogului. Masurat
    // pe 1013 serii: 1013 randuri citite pe cautare, fata de 25 cat costa o
    // pagina obisnuita. La 1000 de utilizatori/zi cu doua cautari fiecare, doar
    // asta ar manca aproape jumatate din plafonul gratuit de 5M randuri/zi.
    //
    // De aceea: daca rezultatele incap in pagina, totalul e exact si GRATUIT
    // (offset + ce am primit). Daca nu incap, numarăm doar pana la un prag si
    // il raportam ca „500+" — al 501-lea rezultat nu e informatie utila pentru
    // cine cauta, dar scanarea lui costa la fel de mult ca tot catalogul.
    let total;
    let totalCapped = false;
    if (!q) {
      total = await readMeta(env, 'series_total');
    } else if (!hasMore) {
      total = offset + rows.length;
    } else {
      const c = await env.DB
        .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM anime_series s ${whereSql} LIMIT ${TOTAL_CAP})`)
        .bind(...params)
        .first();
      total = c?.n ?? 0;
      totalCapped = total >= TOTAL_CAP;
    }

    return json({
      series,
      page,
      per_page: perPage,
      has_more: hasMore,
      total,
      total_capped: totalCapped,
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
