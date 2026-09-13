import { json, errorResponse } from '../../../lib/http.js';
import { DEFAULT_LIMIT_USERS, resolveLimit } from '../../../lib/limits.js';

// =====================================================================
// GET /api/auth/register-options
//
// Spune paginii de inregistrare daca suntem in modul bootstrap (primul
// cont devine admin) si cat de plina e comunitatea. Inregistrarea e
// deschisa: un singur COUNT(*) e tot ce-i trebuie paginii.
// =====================================================================

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const res = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    const userCount = res?.n ?? 0;
    const maxUsers = resolveLimit(env, 'LIMIT_USERS', DEFAULT_LIMIT_USERS);

    return json({
      bootstrap: userCount === 0,
      userCount,
      // Plafon atins: pagina de inregistrare anunta din timp, nu doar la submit.
      capacityFull: userCount >= maxUsers,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/auth/register-options esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut verifica cerințele de înregistrare');
  }
}
