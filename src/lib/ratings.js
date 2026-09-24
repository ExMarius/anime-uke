// =====================================================================
// Media notelor pe serie — SURSĂ UNICĂ pentru contoarele denormalizate.
//
// De ce există: „cele mai bine notate" făcea GROUP BY pe tot tabelul de
// note la fiecare cerere (măsurat la scara maximă: 29.578 de rânduri citite
// pentru o singură afișare a primei pagini, din 5M/zi). Acum media și
// numărul de voturi stau pe rândul seriei (ca episode_count din 0005), iar
// clasamentul citește 5 rânduri dintr-un index.
//
// Regula de aur: coloanele se actualizează EXCLUSIV prin funcția de aici, în
// același batch cu votul — altfel media afișată se desincronizează de notele
// reale. Orice loc nou care scrie în series_ratings trebuie să folosească
// `ratingSyncStmt`.
//
// rating_avg se ține ROTUNJIT la o zecimală (ROUND(AVG(...), 1)), exact cum
// îl afișa site-ul înainte: altfel clasamentul s-ar putea schimba (9,44 vs
// 9,36 afișate amândouă ca 9,4, dar ordonate invers de valoarea brută).
// =====================================================================

/**
 * Statement care resincronizează media și numărul de voturi pentru o serie.
 * Se pune în același `DB.batch([...])` cu INSERT-ul votului, iar RETURNING
 * întoarce valorile proaspete, deci nu mai e nevoie de o citire separată.
 */
export function ratingSyncStmt(env, seriesId) {
  return env.DB
    .prepare(
      `UPDATE anime_series SET
         rating_avg = COALESCE(
           (SELECT ROUND(AVG(rating), 1) FROM series_ratings WHERE series_id = ?), 0
         ),
         rating_count = (SELECT COUNT(*) FROM series_ratings WHERE series_id = ?)
       WHERE id = ?
       RETURNING rating_avg AS average, rating_count AS count`
    )
    .bind(seriesId, seriesId, seriesId);
}

/** Statement-ul de vot (upsert: revotul înlocuiește nota, nu adaugă rând). */
export function ratingUpsertStmt(env, userId, seriesId, rating) {
  return env.DB
    .prepare(
      `INSERT INTO series_ratings (user_id, series_id, rating)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, series_id) DO UPDATE SET rating = excluded.rating`
    )
    .bind(userId, seriesId, rating);
}

/**
 * Salvează nota și întoarce media + numărul de voturi, într-o singură
 * rundă către D1 (un batch de două statement-uri).
 */
export async function saveRating(env, userId, seriesId, rating) {
  const results = await env.DB.batch([
    ratingUpsertStmt(env, userId, seriesId, rating),
    ratingSyncStmt(env, seriesId),
  ]);
  const row = results?.[1]?.results?.[0] || {};
  return { average: Number(row.average) || 0, count: Number(row.count) || 0 };
}
