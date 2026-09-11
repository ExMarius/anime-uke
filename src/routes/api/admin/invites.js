import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { logAdminAction } from '../../../lib/audit.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { generateInviteCode } from '../../../lib/invite.js';
import { validatePositiveInt } from '../../../lib/validate.js';

// =====================================================================
// /api/admin/invites — generare, listare si revocare coduri de invitatie.
//
// Doar adminii au acces. Fiecare actiune e consemnata in admin_log, ca
// sa ramana urma cine a dat cui acces pe site.
// =====================================================================

const MAX_CODES_PER_REQUEST = 25;   // un burst mai mare n-are sens practic
const MAX_CODE_LENGTH_NOTE = 120;

/** Mascheaza partial codurile deja folosite: nu mai au valoare, iar
 *  afisarea lor completa in panou ar fi doar zgomot vizual. */
function present(row) {
  return {
    id: row.id,
    code: row.code,
    note: row.note || '',
    created_at: row.created_at,
    created_by_name: row.creator_name || '—',
    used_by: row.used_by ?? null,
    used_by_name: row.used_username || null,
    used_at: row.used_at || null,
    revoked: row.revoked === 1,
    revoked_at: row.revoked_at || null,
    status: row.revoked === 1 ? 'revoked' : row.used_by ? 'used' : 'active',
  };
}

const SELECT_FIELDS = `
  i.id, i.code, i.note, i.created_at, i.used_by, i.used_at, i.revoked, i.revoked_at,
  c.username AS creator_name,
  u.username AS used_username
`;
const SELECT_JOINS = `
  FROM invite_codes i
  LEFT JOIN users c ON c.id = i.created_by
  LEFT JOIN users u ON u.id = i.used_by
`;

// ---------------------------------------------------------------------
// GET — lista codurilor, cu filtru si paginare
// ---------------------------------------------------------------------
export async function onRequestGet(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  const url = new URL(request.url);
  const filter = String(url.searchParams.get('filter') || 'all');
  const allowed = new Set(['all', 'active', 'used', 'revoked']);
  const useFilter = allowed.has(filter) ? filter : 'all';

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 500);

  let where = '';
  if (useFilter === 'active') where = 'WHERE i.revoked = 0 AND i.used_by IS NULL';
  else if (useFilter === 'used') where = 'WHERE i.used_by IS NOT NULL';
  else if (useFilter === 'revoked') where = 'WHERE i.revoked = 1';

  try {
    const { results } = await env.DB
      .prepare(`SELECT ${SELECT_FIELDS} ${SELECT_JOINS} ${where} ORDER BY i.created_at DESC, i.id DESC LIMIT ${limit}`)
      .all();

    const counts = await env.DB
      .prepare(`SELECT
          SUM(CASE WHEN revoked = 0 AND used_by IS NULL THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN used_by IS NOT NULL THEN 1 ELSE 0 END)              AS used,
          SUM(CASE WHEN revoked = 1 THEN 1 ELSE 0 END)                      AS revoked,
          COUNT(*)                                                          AS total
        FROM invite_codes`)
      .first();

    return json({
      invites: (results || []).map(present),
      counts: {
        active: counts?.active ?? 0,
        used: counts?.used ?? 0,
        revoked: counts?.revoked ?? 0,
        total: counts?.total ?? 0,
      },
      filter: useFilter,
    });
  } catch (e) {
    console.error('GET /api/admin/invites esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca codurile de invitație');
  }
}

// ---------------------------------------------------------------------
// POST — genereaza coduri noi SAU revoca/anuleaza revocarea unuia
// ---------------------------------------------------------------------
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-invites:${admin.id}`, 120, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  // --- actiuni asupra unui cod existent ---
  const action = String(body.action || '');
  if (action) {
    const id = validatePositiveInt(body.id, 'ID-ul codului');
    if (!id.ok) return errorResponse(400, id.error);

    if (action === 'revoke' || action === 'unrevoke') {
      try {
        const existing = await env.DB
          .prepare('SELECT id, code, used_by, revoked FROM invite_codes WHERE id = ?')
          .bind(id.value)
          .first();
        if (!existing) return errorResponse(404, 'Codul nu există');

        // Un cod deja folosit nu poate fi revocat — contul exista deja,
        // revocarea nu l-ar anula si ar induce adminul in eroare.
        if (action === 'revoke' && existing.used_by) {
          return errorResponse(409, 'Codul a fost deja folosit; nu mai poate fi revocat.');
        }
        if (action === 'revoke' && existing.revoked) {
          return errorResponse(409, 'Codul este deja revocat.');
        }
        if (action === 'unrevoke' && !existing.revoked) {
          return errorResponse(409, 'Codul nu este revocat.');
        }

        await env.DB
          .prepare(
            action === 'revoke'
              ? `UPDATE invite_codes SET revoked = 1, revoked_at = datetime('now') WHERE id = ?`
              : `UPDATE invite_codes SET revoked = 0, revoked_at = NULL WHERE id = ?`
          )
          .bind(id.value)
          .run();

        await logAdminAction(env, admin, action === 'revoke' ? 'revoke_invite' : 'restore_invite',
          'invite', id.value, existing.code);

        return json({ success: true, action, id: id.value, revoked: action === 'revoke' });
      } catch (e) {
        console.error(`POST /api/admin/invites (${action}) esuat:`, e?.message || e);
        return errorResponse(500, 'Nu am putut actualiza codul');
      }
    }

    return errorResponse(400, `Acțiune necunoscută: ${action}`);
  }

  // --- generare de coduri noi ---
  const count = Math.min(Math.max(Number(body.count) || 1, 1), MAX_CODES_PER_REQUEST);
  const note = String(body.note || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, MAX_CODE_LENGTH_NOTE);

  try {
    const created = [];
    // Generam cu retry pe coliziune (UNIQUE ar arunca exceptie). Sansele sunt
    // infime, dar un singur retry costa mai putin decat un esec vizibil.
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = generateInviteCode();
        try {
          const res = await env.DB
            .prepare('INSERT INTO invite_codes (code, note, created_by) VALUES (?, ?, ?)')
            .bind(code, note, admin.id)
            .run();
          created.push({ id: res.meta?.last_row_id, code });
          break;
        } catch (err) {
          if (!/UNIQUE/i.test(String(err?.message || err)) || attempt === 2) throw err;
        }
      }
    }

    if (!created.length) return errorResponse(500, 'Nu am putut genera niciun cod');

    await logAdminAction(env, admin, 'generate_invites', 'invite', null,
      `${created.length} cod${created.length === 1 ? '' : 'uri'}${note ? ` — „${note}"` : ''}`);

    return json({ success: true, created, note }, { status: 201 });
  } catch (e) {
    console.error('POST /api/admin/invites (generate) esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut genera codurile');
  }
}

// ---------------------------------------------------------------------
// DELETE — sterge definitiv un cod NEfolosit (curatare lista)
// ---------------------------------------------------------------------
export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const url = new URL(request.url);
  const id = validatePositiveInt(url.searchParams.get('id'), 'ID-ul codului');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const existing = await env.DB
      .prepare('SELECT id, code, used_by FROM invite_codes WHERE id = ?')
      .bind(id.value)
      .first();
    if (!existing) return errorResponse(404, 'Codul nu există');

    // Pastram randurile codurilor folosite: sunt dovada de audit a cui
    // i s-a dat acces. Pentru ele exista revocarea, nu stergerea.
    if (existing.used_by) {
      return errorResponse(409, 'Codul a fost folosit și nu poate fi șters (face parte din istoric). Poți doar să-l revoci.');
    }

    await env.DB.prepare('DELETE FROM invite_codes WHERE id = ?').bind(id.value).run();
    await logAdminAction(env, admin, 'delete_invite', 'invite', id.value, existing.code);

    return json({ success: true });
  } catch (e) {
    console.error('DELETE /api/admin/invites esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut șterge codul');
  }
}
