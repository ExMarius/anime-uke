import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { validatePositiveInt } from '../../../lib/validate.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { generateInviteCode } from '../../../lib/invite.js';
import { logAdminAction } from '../../../lib/audit.js';

// =====================================================================
// /api/admin/invite-requests — cererile de coduri de la vizitatori.
//
//   GET              lista (pending primele), max 100
//   POST approve     generează AUTOMAT un cod de invitație și îl atașează
//                    cererii; cerutul îl vede cu biletul său RQ-…
//   POST reject      marchează cererea ca respinsă
//
// Decizia e definitivă (pending → approved/rejected): aprobat de două
// ori ar genera două coduri pentru aceeași persoană, deci 409.
// =====================================================================

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  try {
    // Pending primele (asta citeste adminul), apoi cele mai noi. LIMIT 100:
    // daca s-au strans mai multe, ownerul are o problema de-altfel.
    const res = await env.DB
      .prepare(
        `SELECT id, email, message, status, request_code, invite_code, created_at, decided_at
         FROM invite_requests
         ORDER BY (status = 'pending') DESC, id DESC
         LIMIT 100`
      )
      .all();

    const rows = res.results || [];
    return json({
      requests: rows,
      pending: rows.filter((r) => r.status === 'pending').length,
    });
  } catch (e) {
    console.error('GET /api/admin/invite-requests esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca cererile');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-invreq:${admin.id}`, 120, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const id = validatePositiveInt(body.id, 'ID-ul cererii');
  if (!id.ok) return errorResponse(400, id.error);

  const action = String(body.action || '');
  if (action !== 'approve' && action !== 'reject') {
    return errorResponse(400, 'Acțiune necunoscută');
  }

  try {
    const row = await env.DB
      .prepare('SELECT id, email, message, status FROM invite_requests WHERE id = ?')
      .bind(id.value)
      .first();
    if (!row) return errorResponse(404, 'Cererea nu există');
    if (row.status !== 'pending') {
      return errorResponse(409, `Cererea a fost deja ${row.status === 'approved' ? 'aprobată' : 'respinsă'}.`);
    }

    if (action === 'reject') {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE invite_requests SET status = 'rejected', decided_at = datetime('now'), decided_by = ? WHERE id = ?`
        ).bind(admin.id, id.value),
      ]);
      await logAdminAction(env, admin, 'invite_request_rejected', 'invite_request', id.value, row.email);
      return json({ success: true, status: 'rejected' });
    }

    // --- approve: generăm codul în același stil ca cele manuale ---
    // Reîncercăm de 3 ori pe coliziune UNIQUE, apoi cedăm cu eroare.
    let code = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = generateInviteCode();
      try {
        // INSERT-ul codului si decizia pleaca intr-o singura tranzactie:
        // ori exista ambele, ori niciuna — nu putem aproba fara cod.
        await env.DB.batch([
          env.DB.prepare('INSERT INTO invite_codes (code, note, created_by) VALUES (?, ?, ?)')
            .bind(candidate, `cerere #${row.id} — ${row.email}`, admin.id)
          ,
          env.DB.prepare(
            `UPDATE invite_requests SET status = 'approved', invite_code = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?`
          ).bind(candidate, admin.id, id.value),
        ]);
        code = candidate;
        break;
      } catch (err) {
        if (!/UNIQUE/i.test(String(err?.message || err)) || attempt === 2) throw err;
      }
    }
    if (!code) return errorResponse(500, 'Nu am putut genera codul');

    await logAdminAction(env, admin, 'invite_request_approved', 'invite_request', id.value,
      `${row.email} → cod generat`);

    return json({ success: true, status: 'approved', invite_code: code });
  } catch (e) {
    console.error('POST /api/admin/invite-requests esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut procesa cererea');
  }
}
