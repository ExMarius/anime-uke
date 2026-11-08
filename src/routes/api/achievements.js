// =====================================================================
// GET /api/achievements[?u=<username>]
//
// Profilul public al realizărilor: catalogul complet, care e deblocat, cât
// mai lipsește până la următorul prag. Datele sunt publice (ca profilul),
// deci ruta nu cere sesiune — dar „me” cere, evident.
//
// Evaluarea rulează DOAR pe profilul propriu: deschiderea propriei pagini
// e momentul în care utilizatorul se uită la progres, iar acolo merită
// plătit costul celor ~11 citiri (o dată, nu la fiecare request). Pentru
// profilul altcuiva citim doar starea deja scrisă.
// =====================================================================

import { json, errorResponse } from '../../lib/http.js';
import { getSessionUser } from '../../lib/session.js';
import {
  ACHIEVEMENTS,
  evaluateAchievements,
  loadAchievementStats,
  nextAchievement,
  presentAchievements,
  unlockedMapFor,
} from '../../lib/achievements.js';

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const raw = String(url.searchParams.get('u') || params?.username || 'me').trim().slice(0, 40);
  if (!raw) return errorResponse(400, 'Lipsește numele de utilizator');

  const me = await getSessionUser(request, env);

  let user;
  if (raw.toLowerCase() === 'me') {
    if (!me) return errorResponse(401, 'Trebuie să fii autentificat');
    user = me;
  } else {
    user = await env.DB
      .prepare('SELECT id, username FROM users WHERE username = ?')
      .bind(raw)
      .first();
    if (!user) return errorResponse(404, 'Utilizatorul nu există');
  }

  const isSelf = !!me && me.id === user.id;

  try {
    let justUnlocked = [];
    if (isSelf) {
      // Eșecul evaluării nu trebuie să golească pagina: catalogul se poate
      // afișa și din starea deja salvată.
      try {
        justUnlocked = await evaluateAchievements(env, user.id);
      } catch (e) {
        console.error('evaluateAchievements a eșuat:', e?.message || e);
      }
    }

    const [stats, unlocked] = await Promise.all([
      loadAchievementStats(env, user.id),
      unlockedMapFor(env, user.id),
    ]);

    const achievements = presentAchievements(stats, unlocked);
    const count = achievements.filter((a) => a.unlocked).length;

    return json({
      user: { id: user.id, username: user.username, is_self: isSelf },
      total: ACHIEVEMENTS.length,
      unlocked: count,
      percent: Math.round((count / ACHIEVEMENTS.length) * 100),
      next: nextAchievement(stats, unlocked),
      just_unlocked: justUnlocked,
      achievements,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/achievements a eșuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca realizările');
  }
}
