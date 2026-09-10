import { json, errorResponse } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { getAdminLog } from '../../../lib/audit.js';

// =====================================================================
// GET /api/admin/log?limit=N — jurnalul de audit pentru actiunile admin.
// Limita implicita 100, maxima 200 (vezi getAdminLog).
// =====================================================================

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  try {
    const url = new URL(request.url);
    const log = await getAdminLog(env, url.searchParams.get('limit'));
    return json({ log });
  } catch (e) {
    console.error('GET /api/admin/log esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca jurnalul');
  }
}
