import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { getSessionUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { notifyUser } from '../../lib/notify.js';

// =====================================================================
// /api/friends — sistem de prietenie
//
// GET /api/friends?u=username -> status fata de acel user
//   { status: 'none'|'self'|'pending_out'|'pending_in'|'friends'|'rejected'|'blocked' }
// GET /api/friends -> { friends, incoming, outgoing }
//
// POST /api/friends { username, action? }
//   action default 'send'
//   'send' -> trimite cerere (destinatarul primeste notificare friend_request;
//             daca celalalt ceruse deja, accepta automat si-l notifica)
//   'accept' -> accepta cerere primita (solicitantul primeste friend_accepted)
//   'reject' -> respinge cerere primita (fara notificare — zgomot inutil)
//   'cancel' -> anuleaza cerere trimisa
//   'remove' -> sterge prietenia acceptata
//
// Notificarile sunt scrise prin notifyUser (o singura scriere D1); o
// notificare esuata nu pica actiunea — vezi src/lib/notify.js.
//
// =====================================================================

function normalizeUsername(u) {
  return String(u || '').trim();
}

async function findUserByUsername(env, username) {
  return env.DB.prepare('SELECT id, username FROM users WHERE username = ?').bind(username).first();
}

async function getFriendshipBetween(env, a, b) {
  // cauta in ambele directii
  return env.DB.prepare(
    `SELECT * FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?)
        OR (requester_id = ? AND addressee_id = ?)
     LIMIT 1`
  ).bind(a, b, b, a).first();
}

function presentStatus(meId, otherId, row) {
  if (meId === otherId) return 'self';
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  if (row.status === 'blocked') return 'blocked';
  if (row.status === 'pending') {
    return row.requester_id === meId ? 'pending_out' : 'pending_in';
  }
  if (row.status === 'rejected') {
    // daca eu am respins, arat rejected_in? Simplificam: daca eu sunt addressee care a respins, arat rejected_out? Mai simplu: none daca e rejected si a trecut timp
    // Pentru UX: cel care a trimis vede rejected, cel care a respins vede none (poate retrimite)
    return row.requester_id === meId ? 'rejected' : 'none';
  }
  return 'none';
}

// ---------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------
export async function onRequestGet(context) {
  const { request, env } = context;
  const me = await getSessionUser(request, env);
  if (!me) return errorResponse(401, 'Trebuie să fii autentificat');

  const url = new URL(request.url);
  const targetU = url.searchParams.get('u');

  if (targetU) {
    const username = normalizeUsername(targetU);
    if (!username) return errorResponse(400, 'Username lipsă');
    if (username.toLowerCase() === me.username.toLowerCase()) {
      return json({ status: 'self', username: me.username });
    }
    const other = await findUserByUsername(env, username);
    if (!other) return errorResponse(404, 'Utilizatorul nu există');

    const row = await getFriendshipBetween(env, me.id, other.id);
    const status = presentStatus(me.id, other.id, row);

    return json({
      status,
      username: other.username,
      user_id: other.id,
      friendship: row ? { id: row.id, status: row.status, requester_id: row.requester_id, addressee_id: row.addressee_id, created_at: row.created_at } : null,
    }, { headers: { 'cache-control': 'no-store' } });
  }

  // lista completa
  try {
    const [friendsRes, incomingRes, outgoingRes] = await Promise.all([
      env.DB.prepare(
        `SELECT u.id, u.username, p.avatar_url,
                f.id as friendship_id, f.created_at, f.updated_at, f.requester_id, f.addressee_id
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
         ORDER BY f.updated_at DESC
         LIMIT 100`
      ).bind(me.id, me.id, me.id).all(),
      env.DB.prepare(
        `SELECT u.id, u.username, p.avatar_url, f.id as friendship_id, f.created_at
         FROM friendships f
         JOIN users u ON u.id = f.requester_id
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE f.addressee_id = ? AND f.status = 'pending'
         ORDER BY f.created_at DESC
         LIMIT 100`
      ).bind(me.id).all(),
      env.DB.prepare(
        `SELECT u.id, u.username, p.avatar_url, f.id as friendship_id, f.created_at
         FROM friendships f
         JOIN users u ON u.id = f.addressee_id
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE f.requester_id = ? AND f.status = 'pending'
         ORDER BY f.created_at DESC
         LIMIT 100`
      ).bind(me.id).all(),
    ]);

    return json({
      friends: friendsRes.results || [],
      incoming: incomingRes.results || [],
      outgoing: outgoingRes.results || [],
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/friends failed', e);
    return errorResponse(500, 'Eroare la încărcarea prietenilor');
  }
}

// ---------------------------------------------------------------------
// POST — send / accept / reject / cancel / remove
// ---------------------------------------------------------------------
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const me = await getSessionUser(request, env);
  if (!me) return errorResponse(401, 'Trebuie să fii autentificat');

  const rl = await checkRateLimit(env, `friends:${me.id}`, 20, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { return errorResponse(400, 'JSON invalid'); }

  const username = normalizeUsername(body.username || body.u || '');
  const action = String(body.action || 'send').toLowerCase();

  if (!username) return errorResponse(400, 'Username lipsă');

  if (username.toLowerCase() === me.username.toLowerCase()) {
    return errorResponse(400, 'Nu te poți adăuga pe tine ca prieten');
  }

  const other = await findUserByUsername(env, username);
  if (!other) return errorResponse(404, 'Utilizatorul nu există');

  const existing = await getFriendshipBetween(env, me.id, other.id);

  try {
    if (action === 'send') {
      if (existing) {
        const st = presentStatus(me.id, other.id, existing);
        if (st === 'friends') return errorResponse(409, 'Sunteți deja prieteni');
        if (st === 'pending_out') return errorResponse(409, 'Cerere deja trimisă');
        if (st === 'pending_in') {
          // daca celalalt ti-a trimis deja, accepta automat
          await env.DB.prepare(
            `UPDATE friendships SET status = 'accepted', updated_at = datetime('now')
             WHERE id = ?`
          ).bind(existing.id).run();
          // Cel care ceruse primul află că s-a făcut prietenie — nu știa că
          // celălalt tocmai a apăsat „adaugă” în locul lui.
          await notifyUser(env, other.id, 'friend_accepted', { username: me.username, user_id: me.id });
          return json({ ok: true, status: 'friends', message: 'Cerere acceptată automat — erați deja invitați' });
        }
        if (st === 'blocked') return errorResponse(403, 'Nu poți trimite cerere');
        // daca a fost respinsa, permitem re-trimitere: stergem vechea intrare si cream noua
        if (existing.status === 'rejected') {
          await env.DB.prepare('DELETE FROM friendships WHERE id = ?').bind(existing.id).run();
        } else {
          return errorResponse(409, 'Există deja o relație');
        }
      }
      await env.DB.prepare(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
         VALUES (?, ?, 'pending', datetime('now'), datetime('now'))`
      ).bind(me.id, other.id).run();
      // Destinatarul află că are o cerere de rezolvat (badge + clopot).
      await notifyUser(env, other.id, 'friend_request', { username: me.username, user_id: me.id });
      return json({ ok: true, status: 'pending_out', message: 'Cerere trimisă' });
    }

    if (!existing) return errorResponse(404, 'Nu există nicio cerere');

    if (action === 'accept') {
      if (existing.addressee_id !== me.id || existing.status !== 'pending') {
        return errorResponse(400, 'Nu poți accepta această cerere');
      }
      await env.DB.prepare(
        `UPDATE friendships SET status = 'accepted', updated_at = datetime('now') WHERE id = ?`
      ).bind(existing.id).run();
      // Cel care a cerut află că e acceptat — asta e „vestea bună".
      await notifyUser(env, existing.requester_id, 'friend_accepted', { username: me.username, user_id: me.id });
      return json({ ok: true, status: 'friends' });
    }

    if (action === 'reject') {
      if (existing.addressee_id !== me.id || existing.status !== 'pending') {
        return errorResponse(400, 'Nu poți respinge această cerere');
      }
      await env.DB.prepare(
        `UPDATE friendships SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`
      ).bind(existing.id).run();
      // optional: stergem dupa reject ca sa permita re-trimitere? Pastram rejected ca sa aratam feedback
      // dar stergem dupa 7 zile in mod real — aici stergem imediat ca sa fie simplu? Pastram rejected.
      return json({ ok: true, status: 'rejected' });
    }

    if (action === 'cancel') {
      if (existing.requester_id !== me.id || existing.status !== 'pending') {
        return errorResponse(400, 'Nu poți anula această cerere');
      }
      await env.DB.prepare('DELETE FROM friendships WHERE id = ?').bind(existing.id).run();
      return json({ ok: true, status: 'none' });
    }

    if (action === 'remove') {
      if (existing.status !== 'accepted') return errorResponse(400, 'Nu sunteți prieteni');
      if (existing.requester_id !== me.id && existing.addressee_id !== me.id) {
        return errorResponse(403, 'Nu ai dreptul');
      }
      await env.DB.prepare('DELETE FROM friendships WHERE id = ?').bind(existing.id).run();
      return json({ ok: true, status: 'none' });
    }

    return errorResponse(400, 'Acțiune invalidă');
  } catch (e) {
    console.error('POST /api/friends failed', e);
    return errorResponse(500, 'Eroare la procesarea cererii');
  }
}

// DELETE — alias pentru remove/cancel/reject in functie de status
export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const me = await getSessionUser(request, env);
  if (!me) return errorResponse(401, 'Trebuie să fii autentificat');

  const url = new URL(request.url);
  const username = normalizeUsername(url.searchParams.get('u') || url.searchParams.get('username') || '');
  if (!username) return errorResponse(400, 'Username lipsă');

  const other = await findUserByUsername(env, username);
  if (!other) return errorResponse(404, 'Utilizatorul nu există');

  const existing = await getFriendshipBetween(env, me.id, other.id);
  if (!existing) return errorResponse(404, 'Nu există prietenie');

  try {
    // daca e pending si eu sunt requester -> cancel, daca sunt addressee -> reject, daca accepted -> remove
    await env.DB.prepare('DELETE FROM friendships WHERE id = ?').bind(existing.id).run();
    return json({ ok: true, status: 'none' });
  } catch (e) {
    console.error('DELETE /api/friends failed', e);
    return errorResponse(500, 'Eroare');
  }
}
