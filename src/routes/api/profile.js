import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { getSessionUser } from '../../lib/session.js';
import { getRank, getZodiac, formatRoDate, getAge, GENDERS } from '../../lib/rank.js';
import { validateProfilePatch } from '../../lib/profile.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';

// =====================================================================
// /api/profile/:username  — profil public + statistici
// /api/profile            — PATCH propriul profil
//
// `:username` accepta si valoarea „me", care se rezolva la utilizatorul
// curent. Altfel pagina proprie ar avea nevoie de un al doilea endpoint.
// =====================================================================

/** Serieaza profilul pentru client. Email-ul NU pleaca niciodata de aici. */
function present(user, profile, stats, isSelf) {
  const birthDate = profile?.birth_date || '';
  const rank = getRank(user.points);

  return {
    user: {
      id: user.id,
      username: user.username,
      points: user.points,
      is_admin: !!user.is_admin,
      created_at: user.created_at,
      member_since: formatRoDate(user.created_at),
    },
    rank,
    profile: {
      birth_date: birthDate,
      birth_date_ro: formatRoDate(birthDate),
      zodiac: getZodiac(birthDate),
      age: getAge(birthDate),
      gender: profile?.gender || '',
      gender_label: GENDERS[profile?.gender || ''] || GENDERS[''],
      country: profile?.country || '',
      motto: profile?.motto || '',
      faction: profile?.faction || '',
      mal_url: profile?.mal_url || '',
      avatar_url: profile?.avatar_url || '',
      updated_at: profile?.updated_at || null,
    },
    stats: {
      series_watched: stats?.series_watched ?? 0,
      episodes_watched: stats?.episodes_watched ?? 0,
      watchlist: stats?.watchlist ?? 0,
    },
    is_self: !!isSelf,
  };
}

async function loadStats(env, userId) {
  const [watched, watchlist] = await Promise.all([
    env.DB
      .prepare(
        `SELECT COUNT(*) AS episodes, COUNT(DISTINCT e.series_id) AS series
         FROM watched_history w JOIN episodes e ON e.id = w.episode_id
         WHERE w.user_id = ?`
      )
      .bind(userId)
      .first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?').bind(userId).first(),
  ]);

  return {
    series_watched: watched?.series ?? 0,
    episodes_watched: watched?.episodes ?? 0,
    watchlist: watchlist?.n ?? 0,
  };
}

// ---------------------------------------------------------------------
// GET /api/profile/:username
// ---------------------------------------------------------------------
export async function onRequestGet(context) {
  const { request, env, params } = context;

  const raw = String(params?.username || '').trim();
  if (!raw) return errorResponse(400, 'Lipsește numele de utilizator');

  const me = await getSessionUser(request, env);

  let user;
  if (raw.toLowerCase() === 'me') {
    if (!me) return errorResponse(401, 'Trebuie să fii autentificat');
    user = me;
  } else {
    user = await env.DB
      .prepare('SELECT id, username, points, is_admin, created_at FROM users WHERE username = ?')
      .bind(raw)
      .first();
    if (!user) return errorResponse(404, 'Utilizatorul nu există');
  }

  try {
    const [profile, stats, recommendations] = await Promise.all([
      env.DB.prepare('SELECT * FROM user_profiles WHERE user_id = ?').bind(user.id).first(),
      loadStats(env, user.id),
      // „Serii recomandate": cele mai vizionate serii pe care NU le-a vazut.
      env.DB
        .prepare(
          `SELECT s.id, s.title, s.cover_image, s.status, s.genre, s.year,
                  COALESCE((SELECT SUM(views) FROM episodes WHERE series_id = s.id), 0) AS total_views,
                  s.episode_count                                             AS episode_count
           FROM anime_series s
           WHERE s.id NOT IN (
             SELECT DISTINCT e.series_id FROM watched_history w
             JOIN episodes e ON e.id = w.episode_id WHERE w.user_id = ?
           )
           ORDER BY total_views DESC, s.created_at DESC
           LIMIT 4`
        )
        .bind(user.id)
        .all(),
    ]);

    return json({
      ...present(user, profile, stats, me?.id === user.id),
      recommendations: recommendations?.results || [],
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/profile esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca profilul');
  }
}

// ---------------------------------------------------------------------
// PATCH /api/profile — doar propriul profil
// ---------------------------------------------------------------------
export async function onRequestPatch(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const me = await getSessionUser(request, env);
  if (!me) return errorResponse(401, 'Trebuie să fii autentificat');

  const rl = await checkRateLimit(env, `profile:${me.id}`, 30, 10 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const v = validateProfilePatch(body);
  if (!v.ok) return errorResponse(400, v.error);

  const patch = v.value;

  // Campuri editabile si valorile lor implicite. Un PATCH partial trebuie sa
  // le pastreze pe celelalte, deci citim randul existent si il combinam —
  // altfel upsert-ul ar goli tot ce utilizatorul nu a trimis acum.
  const FIELDS = ['birth_date', 'gender', 'country', 'motto', 'mal_url', 'avatar_url', 'faction'];

  try {
    const existing = await env.DB
      .prepare(`SELECT ${FIELDS.join(', ')} FROM user_profiles WHERE user_id = ?`)
      .bind(me.id)
      .first();

    const merged = {};
    for (const f of FIELDS) merged[f] = f in patch ? patch[f] : (existing?.[f] ?? '');

    await env.DB
      .prepare(
        `INSERT INTO user_profiles
           (user_id, birth_date, gender, country, motto, mal_url, avatar_url, faction, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           birth_date = excluded.birth_date,
           gender     = excluded.gender,
           country    = excluded.country,
           motto      = excluded.motto,
           mal_url    = excluded.mal_url,
           avatar_url = excluded.avatar_url,
           faction    = excluded.faction,
           updated_at = datetime('now')`
      )
      .bind(me.id, merged.birth_date, merged.gender, merged.country,
            merged.motto, merged.mal_url, merged.avatar_url, merged.faction)
      .run();

    const saved = await env.DB
      .prepare('SELECT * FROM user_profiles WHERE user_id = ?')
      .bind(me.id)
      .first();

    const stats = await loadStats(env, me.id);
    return json(present(me, saved, stats, true));
  } catch (e) {
    console.error('PATCH /api/profile esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut salva profilul');
  }
}
