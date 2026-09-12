import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { validatePositiveInt } from '../../lib/validate.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { addActivity, grantBadge } from '../../lib/xp.js';

// =====================================================================
// POST /api/progress — acumuleaza timp real de vizionare.
//
// REGULA (cerinta explicita): punctele si marcajul „vizionat" NU se dau la
// deschiderea paginii si nici la un buton apasat de utilizator, ci abia
// dupa 15 minute de vizionare activa. Altfel un bot sau un utilizator
// care da click pe „marcat ca vizionat" ar farma puncte fara sa se uite
// la nimic.
//
// Cum functioneaza:
//   - playerul trimite un heartbeat la ~30s cu secundele efectiv vizionate
//     (tab vizibil + player pornit); daca utilizatorul pune pauza sau
//     pleaca din tab, acumularea se opreste
//   - serverul aduna in watch_progress; cand totalul trece de prag,
//     marcheaza episodul ca vizionat si acorda punctele O SINGURA DATA
//     (INSERT OR IGNORE + meta.changes, atomic, fara race condition)
//
// De ce pragul e verificat pe server si nu pe client: clientul e al
// utilizatorului, deci orice regula traita doar in browser poate fi
// pacalita. Clientul doar raporteaza secundele; decizia e aici.
// =====================================================================

/** Minute de vizionare pentru puncte + marcajul „vizionat”. */
export const WATCH_THRESHOLD_SECONDS = 15 * 60;
export const POINTS_PER_EPISODE = 10;

/**
 * Maximul acceptat intr-un singur heartbeat. Un client trimite normal 30s;
 * limita exista ca sa nu poata fi varsate 900 de secunde dintr-o singura
// cerere si sa se sara direct peste prag.
 */
const MAX_INCREMENT = 120;

const RATE_LIMIT = 240;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `progress:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const id = validatePositiveInt(body.episode_id, 'ID-ul episodului');
  if (!id.ok) return errorResponse(400, id.error);

  const seconds = Number(body.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return errorResponse(400, 'Număr de secunde invalid');
  }
  // Rotunjim in sus la cel mult MAX_INCREMENT: un heartbeat onest e 30s.
  const inc = Math.min(Math.ceil(seconds), MAX_INCREMENT);

  const episode = await env.DB.prepare('SELECT id FROM episodes WHERE id = ?').bind(id.value).first();
  if (!episode) return errorResponse(404, 'Episodul nu există');

  try {
    const up = await env.DB
      .prepare(
        `INSERT INTO watch_progress (user_id, episode_id, seconds)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, episode_id)
         DO UPDATE SET seconds = seconds + ?, updated_at = datetime('now')
         RETURNING seconds`
      )
      .bind(user.id, id.value, inc, inc)
      .first();

    const total = Number(up?.seconds) || inc;
    const alreadyWatched = total - inc >= WATCH_THRESHOLD_SECONDS;

    let pointsAdded = 0;
    let points = user.points;

    // Pragul tocmai a fost trecut: marcam vizionat + acordam punctele,
    // atomic. INSERT OR IGNORE intoarce changes=0 daca exista deja randul,
    // deci al doilea heartbeat care trece pragul nu mai acorda nimic.
    if (total >= WATCH_THRESHOLD_SECONDS && !alreadyWatched) {
      const results = await env.DB.batch([
        env.DB
          .prepare('INSERT OR IGNORE INTO watched_history (user_id, episode_id, points) VALUES (?, ?, ?)')
          .bind(user.id, id.value, POINTS_PER_EPISODE),
      ]);
      if ((results[0]?.meta?.changes || 0) > 0) {
        await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?')
          .bind(POINTS_PER_EPISODE, user.id).run();
        pointsAdded = POINTS_PER_EPISODE;
        points = user.points + POINTS_PER_EPISODE;

        // Economie: episodul vizionat hraneste XP-ul contului si punctele
        // lunare (spec: +10 XP), plus insignele de vizionare. Ruleaza doar
        // la prima trecere a pragului, pentru ca INSERT OR IGNORE de mai
        // sus garanteaza changes = 1 exact o data per episod.
        await addActivity(env, user.id, POINTS_PER_EPISODE);
        await grantBadge(env, user.id, 'first_watch');
        const wc = await env.DB
          .prepare('SELECT COUNT(*) AS n FROM watched_history WHERE user_id = ?')
          .bind(user.id)
          .first();
        if ((wc?.n || 0) >= 50) await grantBadge(env, user.id, 'watcher_50');
      }
    } else if (total >= WATCH_THRESHOLD_SECONDS) {
      const cur = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first();
      points = cur?.points ?? user.points;
    }

    return json({
      seconds: total,
      threshold: WATCH_THRESHOLD_SECONDS,
      watched: total >= WATCH_THRESHOLD_SECONDS,
      pointsAdded,
      points,
    });
  } catch (e) {
    console.error('POST /api/progress esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut salva progresul');
  }
}
