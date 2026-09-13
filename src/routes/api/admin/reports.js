// /api/admin/reports — lista de raportari + rezolvare
//   GET  ?status=open|fixed|dismissed|all  (default: open)
//   POST {id, action: 'fix' | 'dismiss' | 'reopen'}
import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { validatePositiveInt } from '../../../lib/validate.js';
import { logAdminAction } from '../../../lib/audit.js';
import { REASONS } from '../report.js';

const STATUSES = ['open', 'fixed', 'dismissed'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'open';
  const where = STATUSES.includes(status) ? 'WHERE r.status = ?' : '';
  const stmt = env.DB.prepare(
    `SELECT r.id, r.episode_id, r.source_id, r.reason, r.status, r.created_at, r.resolved_at,
            u.username, e.episode_number, e.title AS episode_title,
            s.id AS series_id, s.title AS series_title, src.label AS source_label, src.url AS source_url
     FROM source_reports r
     JOIN users u ON u.id = r.user_id
     JOIN episodes e ON e.id = r.episode_id
     JOIN anime_series s ON s.id = e.series_id
     LEFT JOIN episode_sources src ON src.id = r.source_id
     ${where}
     ORDER BY r.id DESC LIMIT 200`
  );
  const res = status === 'all' || !where ? await stmt.all() : await stmt.bind(status).all();

  const counts = await env.DB
    .prepare('SELECT status, COUNT(*) AS n FROM source_reports GROUP BY status')
    .all();
  const byStatus = { open: 0, fixed: 0, dismissed: 0 };
  for (const c of counts.results || []) byStatus[c.status] = c.n;

  return json({ reports: res.results || [], counts: byStatus, reasons: REASONS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  const rl = await checkRateLimit(env, `admin-reports:${gate.user.id}`, 120, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const id = validatePositiveInt(body.id, 'Raportarea');
  if (!id.ok) return errorResponse(400, id.error);

  const action = String(body.action || '');
  const next = action === 'fix' ? 'fixed' : action === 'dismiss' ? 'dismissed' : action === 'reopen' ? 'open' : null;
  if (!next) return errorResponse(400, 'Acțiune necunoscută');

  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const res = await env.DB
    .prepare('UPDATE source_reports SET status = ?, resolved_at = ? WHERE id = ?')
    .bind(next, next === 'open' ? null : stamp, id.value)
    .run();
  if (!res.meta?.changes) return errorResponse(404, 'Raportarea nu există');

  await logAdminAction(env, gate.user, `report_${action}`, 'report', id.value, next);
  return json({ success: true, id: id.value, status: next });
}
