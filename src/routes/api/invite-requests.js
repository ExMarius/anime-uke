import { json, errorResponse, sanitizeText, isSameOrigin, getClientIp } from '../../lib/http.js';
import { validateEmail } from '../../lib/validate.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { DEFAULT_LIMIT_USERS, resolveLimit, usersFullMessage } from '../../lib/limits.js';

// =====================================================================
// /api/invite-requests — cereri de cod de invitație de la vizitatori.
//
//   POST { email, message }  → 201 + request_code („biletul” cerutului)
//   GET  ?code=RQ-XXXX-XXXX  → { status, invite_code? }
//
// Fluxul complet, fără niciun serviciu de email (buget 0):
//   1. Vizitatorul scrie emailul + motivul, primește un bilet RQ-…
//   2. Adminul vede cererea în panou și o aprobă sau o respinge
//   3. La aprobare se generează AUTOMAT un cod de invitație
//   4. Cerutul verifică biletul și își vede codul când a fost aprobat
//
// Biletul e neghicitabil (8 caractere dintr-un alfabet de 31 → ~10^12
// combinații), iar endpoint-ul de verificare e rate-limitat, deci nu
// cineva poate ghici cererile altora.
//
// Plafonul buget-0 se respectă și aici: dacă comunitatea e plină,
// cererile noi se refuză cu mesaj clar (nu adunam speranțe pe deque).
// =====================================================================

const MAX_PENDING = 300;      // peste asta refuzam cereri noi (anti-spam D1)
const MESSAGE_MIN = 10;
const TICKET_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // fara I,O,0,1

function generateTicket() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => TICKET_ALPHABET[b % TICKET_ALPHABET.length]);
  return `RQ-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const ip = getClientIp(request);
  // Max 3 cereri/oră/IP: un om sincer nu are nevoie de mai multe.
  const rl = await checkRateLimit(env, `invite-req:${ip}`, 3, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter, 'Ai trimis prea multe cereri. Încearcă mai târziu.');

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const email = validateEmail(sanitizeText(body.email, 254));
  if (!email.ok) return errorResponse(400, email.error);

  const message = sanitizeText(body.message, 600).trim();
  if (message.length < MESSAGE_MIN) {
    return errorResponse(400, `Spune-ne și de ce vrei un cod (minim ${MESSAGE_MIN} caractere).`);
  }

  try {
    // Plafonul comunității: dacă nu mai sunt locuri, nu colectăm cereri.
    const maxUsers = resolveLimit(env, 'LIMIT_USERS', DEFAULT_LIMIT_USERS);
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    if ((cnt?.n ?? 0) >= maxUsers) {
      return errorResponse(403, usersFullMessage(maxUsers));
    }

    // Prea multe cereri în așteptare = fie spam, fie owner absent. Oprim
    // scrierile ca tabelul sa nu creasca nelimitat (buget 0).
    const pend = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM invite_requests WHERE status = 'pending'`)
      .first();
    if ((pend?.n ?? 0) >= MAX_PENDING) {
      return errorResponse(403, 'Momentan sunt prea multe cereri în așteptare. Revenim mai târziu.');
    }

    // O singură cerere pending per email: împiedică umplerea listei de
    // către același om, iar adminul nu citeste dubluri.
    const normEmail = email.value.trim().toLowerCase();
    const dup = await env.DB
      .prepare(`SELECT id FROM invite_requests WHERE email = ? AND status = 'pending'`)
      .bind(normEmail)
      .first();
    if (dup) return errorResponse(409, 'Există deja o cerere în așteptare cu acest email.');

    // Cod unic cu reîncercare (ca la codurile de invitație).
    for (let attempt = 0; attempt < 3; attempt++) {
      const ticket = generateTicket();
      try {
        const res = await env.DB
          .prepare('INSERT INTO invite_requests (email, message, request_code) VALUES (?, ?, ?)')
          .bind(normEmail, message, ticket)
          .run();
        if (!res.meta?.last_row_id) throw new Error('last_row_id lipsa');
        return json({ success: true, request_code: ticket }, { status: 201 });
      } catch (err) {
        if (!/UNIQUE/i.test(String(err?.message || err)) || attempt === 2) throw err;
      }
    }
    return errorResponse(500, 'Nu am putut crea cererea');
  } catch (e) {
    console.error('POST /api/invite-requests esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut trimite cererea');
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, `invite-chk:${ip}`, 20, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const code = String(new URL(request.url).searchParams.get('code') || '').trim().toUpperCase();
  if (!/^RQ-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(code)) {
    return errorResponse(400, 'Bilet invalid');
  }

  try {
    const row = await env.DB
      .prepare('SELECT status, invite_code, created_at FROM invite_requests WHERE request_code = ?')
      .bind(code)
      .first();
    if (!row) return errorResponse(404, 'Nu există nicio cerere cu acest bilet');

    // Codul de invitație se arată DOAR cerutului cu biletul, și doar după
    // aprobare. Mesajul și emailul nu pleacă niciodată spre public.
    return json({
      status: row.status,
      created_at: row.created_at,
      invite_code: row.status === 'approved' ? row.invite_code : undefined,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/invite-requests esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut verifica cererea');
  }
}
