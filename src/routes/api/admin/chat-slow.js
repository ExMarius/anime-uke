import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireModerator } from '../../../lib/session.js';
import { logAdminAction } from '../../../lib/audit.js';

// =====================================================================
// /api/admin/chat-slow — modul lent al chatului live (staff).
//
//   GET  → { slow: <secunde> }
//   POST { seconds: 0..60 } → impune un interval minim între mesaje
//
// DE CE AICI ȘI NU ÎN CHAT: `chat.js` se descarcă pe toate paginile și are
// un buget de 8 KB gzip. Ștergerea unui mesaj și reducerea la tăcere sunt
// acțiuni legate de o bulă anume, deci trebuie să fie în chat; modul lent e
// o setare globală, folosită rar, de câțiva oameni — locul ei e în panoul de
// staff, unde greutatea nu se plătește de către vizitatori.
//
// Setarea trăiește în storage-ul ChatDO (gratuit), nu în D1. Ruta doar
// verifică dreptul și transmite mai departe.
// =====================================================================

/** Trimite cererea către Durable Object-ul chatului global. */
function chatStub(env) {
  return env.CHAT.get(env.CHAT.idFromName('global-chat'));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireModerator(request, env);
  if (gate.response) return gate.response;

  try {
    const res = await chatStub(env).fetch('https://chat.internal/slow');
    return json(await res.json());
  } catch (e) {
    console.error('GET /api/admin/chat-slow esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut citi starea chatului');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireModerator(request, env);
  if (gate.response) return gate.response;
  const staff = gate.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  try {
    const res = await chatStub(env).fetch('https://chat.internal/slow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: body.seconds, by: staff.username }),
    });
    const data = await res.json();
    if (!res.ok) return errorResponse(res.status, data?.error || 'Interval invalid');

    await logAdminAction(env, staff, 'chat_slow', 'chat', null, `${data.slow}s`);
    return json({ success: true, slow: data.slow });
  } catch (e) {
    console.error('POST /api/admin/chat-slow esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut schimba modul lent');
  }
}
