import { errorResponse, isSameOrigin, json } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { validatePositiveInt } from '../../../lib/validate.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { hashPassword, randomHex } from '../../../lib/crypto.js';
import { logAdminAction } from '../../../lib/audit.js';
import { resetCode } from '../auth/password-reset.js';

// =====================================================================
// /api/admin/password-resets — coada de recuperare asistată.
//
// Fără serviciu extern de e-mail, administratorul verifică persoana și îi
// trimite MANUAL codul pe adresa contului. Codul este returnat o singură dată
// după emitere; în D1 rămân exclusiv hash-ul PBKDF2 și saltul lui.
// =====================================================================

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const CODE_TTL_SECONDS = 30 * 60;

function present(row, now) {
  return {
    id: row.id,
    user_id: row.user_id,
    username: row.username,
    email: row.email,
    status: row.status,
    requested_at: Number(row.requested_at || 0),
    issued_at: row.issued_at == null ? null : Number(row.issued_at),
    expires_at: row.expires_at == null ? null : Number(row.expires_at),
    expired: row.status === 'issued' && Number(row.expires_at || 0) <= now,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  try {
    const now = Math.floor(Date.now() / 1000);
    const res = await env.DB
      .prepare(
        `SELECT r.id, r.user_id, r.status, r.requested_at, r.issued_at, r.expires_at,
                u.username, u.email
         FROM password_reset_requests r
         JOIN users u ON u.id = r.user_id
         WHERE r.status IN ('pending', 'issued')
         ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.requested_at ASC
         LIMIT 100`
      )
      .all();
    return json({ requests: (res.results || []).map((row) => present(row, now)) });
  } catch (e) {
    console.error('GET /api/admin/password-resets esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca solicitările');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-password-resets:${admin.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(400, 'Cerere invalidă');

  const id = validatePositiveInt(body.id, 'ID-ul solicitării');
  if (!id.ok) return errorResponse(400, id.error);
  const action = String(body.action || '');
  if (!['issue', 'cancel'].includes(action)) return errorResponse(400, 'Acțiune necunoscută');

  try {
    const row = await env.DB
      .prepare(
        `SELECT r.id, r.user_id, r.status, r.requested_at, r.issued_at, r.expires_at,
                u.username, u.email
         FROM password_reset_requests r JOIN users u ON u.id = r.user_id
         WHERE r.id = ?`
      )
      .bind(id.value)
      .first();
    if (!row) return errorResponse(404, 'Solicitarea nu există');

    const now = Math.floor(Date.now() / 1000);
    if (action === 'cancel') {
      if (!['pending', 'issued'].includes(row.status)) return errorResponse(409, 'Solicitarea nu mai este activă');
      const cancelled = await env.DB
        .prepare(`UPDATE password_reset_requests SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'issued')`)
        .bind(row.id)
        .run();
      if ((cancelled.meta?.changes || 0) !== 1) return errorResponse(409, 'Solicitarea s-a schimbat între timp');
      try {
        await logAdminAction(env, admin, 'cancel_password_reset', 'user', row.user_id, `cererea #${row.id} (${row.username})`);
      } catch (auditError) {
        console.error('audit anulare reset esuat:', auditError?.message || auditError);
      }
      return json({ success: true, request: { ...present(row, now), status: 'cancelled' } });
    }

    if (row.status !== 'pending') {
      return errorResponse(409, row.status === 'issued' ? 'Codul a fost deja emis pentru această solicitare' : 'Solicitarea nu mai este activă');
    }

    const rawCode = randomHex(16);
    const salt = randomHex(16);
    const hash = await hashPassword(rawCode, salt);
    const expiresAt = now + CODE_TTL_SECONDS;
    const issued = await env.DB
      .prepare(
        `UPDATE password_reset_requests
         SET status = 'issued', issued_at = ?, expires_at = ?, issued_by = ?, token_hash = ?, token_salt = ?, used_at = NULL
         WHERE id = ? AND status = 'pending'`
      )
      .bind(now, expiresAt, admin.id, hash, salt, row.id)
      .run();
    if ((issued.meta?.changes || 0) !== 1) return errorResponse(409, 'Solicitarea s-a schimbat între timp');

    // Nu lăsăm o indisponibilitate a jurnalului să consume un cod fără ca
    // administratorul să-l primească în răspunsul de mai jos.
    try {
      await logAdminAction(env, admin, 'issue_password_reset', 'user', row.user_id, `cererea #${row.id} (${row.username}), cod cu expirare în 30 min`);
    } catch (auditError) {
      console.error('audit emitere reset esuat:', auditError?.message || auditError);
    }
    return json({
      success: true,
      request: {
        ...present({ ...row, status: 'issued', issued_at: now, expires_at: expiresAt }, now),
        status: 'issued',
      },
      // Apare O SINGURĂ dată, numai în răspunsul către adminul autentic.
      recovery_code: resetCode(rawCode),
      expires_at: expiresAt,
    });
  } catch (e) {
    console.error('POST /api/admin/password-resets esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut procesa solicitarea');
  }
}
