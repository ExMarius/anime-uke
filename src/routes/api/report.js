// POST /api/report — {episode_id, source_id, reason}
// „Sursa nu merge" de la privitori e semnalul cel mai ieftin si mai rapid
// ca o sursa s-a stricat. Recompensa: +3 XP (din spec). Dedup-ul e facut
// de indexul partial unic din DB (o raportare deschisa per user+sursa),
// deci nu platim citiri pentru verificare.
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { validatePositiveInt } from '../../lib/validate.js';
import { addActivity } from '../../lib/xp.js';

const REASONS = {
  nu_porneste: 'Nu pornește',
  se_intrerupe: 'Se întrerupe',
  audio_sync: 'Audio nesincronizat',
  sursa_moarta: 'Sursa e moartă',
  altceva: 'Altceva',
};

export { REASONS };

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const rl = await checkRateLimit(env, `report:${gate.user.id}`, 10, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const ep = validatePositiveInt(body.episode_id, 'Episodul');
  if (!ep.ok) return errorResponse(400, ep.error);
  const src = validatePositiveInt(body.source_id, 'Sursa');
  if (!src.ok) return errorResponse(400, src.error);
  const reasonKey = String(body.reason || '').slice(0, 20);
  if (!REASONS[reasonKey]) return errorResponse(400, 'Motiv necunoscut');
  const note = String(body.note || '').trim().slice(0, 200);

  // Sursa trebuie sa existe si sa apartina episodului — altfel oricine
  // poate umple tabelul cu randuri fara sens.
  const source = await env.DB
    .prepare('SELECT id FROM episode_sources WHERE id = ? AND episode_id = ?')
    .bind(src.value, ep.value)
    .first();
  if (!source) return errorResponse(404, 'Sursa nu există pentru acest episod');

  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    await env.DB
      .prepare(
        `INSERT INTO source_reports (user_id, episode_id, source_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(gate.user.id, ep.value, src.value, note ? `${reasonKey}: ${note}` : reasonKey, stamp)
      .run();
  } catch (e) {
    if (String(e?.message || e).includes('UNIQUE')) {
      return errorResponse(409, 'Ai raportat deja această sursă — mersi, o avem pe listă!');
    }
    throw e;
  }

  await addActivity(env, gate.user.id, 3);
  return json({ success: true, xp: 3, reason_label: REASONS[reasonKey] }, { status: 201 });
}
