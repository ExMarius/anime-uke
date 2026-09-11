import { json, errorResponse } from '../../../lib/http.js';

// =====================================================================
// GET /api/auth/register-options
//
// Spune paginii de inregistrare daca e nevoie de cod de invitatie.
//
// De ce un endpoint separat in loc sa lasam formularul sa ghiceasca?
//   In modul bootstrap (baza de date goala) campul de cod ar fi afisat
//   desi nu exista niciun cod generat — primul admin ar ramane blocat.
//   Un singur COUNT(*) pe un tabel mic costa putin si rezolva problema.
// =====================================================================

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const res = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    const userCount = res?.n ?? 0;

    return json({
      // Prima inregistrare e libera si devine admin; dupa aceea e nevoie de cod.
      inviteRequired: userCount > 0,
      bootstrap: userCount === 0,
      userCount,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/auth/register-options esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut verifica cerințele de înregistrare');
  }
}
