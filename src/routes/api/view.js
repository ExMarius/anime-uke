import { json, errorResponse, getClientIp } from '../../lib/http.js';
import { validatePositiveInt } from '../../lib/validate.js';
import { getSessionUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';

// =====================================================================
// POST /api/view — incrementeaza contorul de vizualizari al unui episod.
//
// NU scrie direct in D1. Trimite catre StatsDO, care buffer-izeaza si
// scrie in loturi (o data la ~20 views sau 30 secunde). Fara asta, fiecare
// deschidere de episod ar fi o scriere D1, iar cota gratuita de 100.000
// scrieri/zi pica HARD din 1 sept. 2026.
// =====================================================================

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, `view:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const id = validatePositiveInt(body.episode_id, 'ID-ul episodului');
  if (!id.ok) return errorResponse(400, id.error);

  // Verificam ca episodul exista. E o citire indexata, ieftina, si previne
  // umflarea contoarelor pentru ID-uri inventate.
  const exists = await env.DB.prepare('SELECT id FROM episodes WHERE id = ?').bind(id.value).first();
  if (!exists) return errorResponse(404, 'Episodul nu există');

  const user = await getSessionUser(request, env);
  const viewer = user ? `u${user.id}` : `ip${ip}`;

  if (!env.STATS) return json({ counted: false });

  try {
    const stub = env.STATS.get(env.STATS.idFromName('global'));
    const res = await stub.fetch('https://stats.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episode_id: id.value, viewer }),
    });
    return json(await res.json());
  } catch (e) {
    // Un contor de views picat nu trebuie sa strice pagina episodului.
    console.error('view DO esuat:', e?.message || e);
    return json({ counted: false });
  }
}

export function onRequestGet() {
  return errorResponse(405, 'Metodă nepermisă');
}
