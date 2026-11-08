// =====================================================================
// Realizări (achievements) — „logistica” progresului pe termen lung.
//
// DE CE: misiunile (lib/missions.js) dau un motiv să revii MÂINE, iar
// nivelul crește singur, dar niciuna nu răspunde la întrebarea „merită să
// continui?”. Realizările sunt catalizatorul pe termen lung: praguri fixe,
// vizibile, cu recompensă în gold/XP, care se deblochează O SINGURĂ DATĂ
// și rămân pe profil ca dovadă.
//
// REGULI DE BUGET (cost 0 — D1 se taxează pe rânduri citite):
//   * catalogul stă în COD, nu în DB: adăugarea unei realizări noi nu cere
//     migrație și nu produce citiri;
//   * starea per utilizator e un singur SELECT pe cheia primară
//     (user_achievements), nu un rând de tabel pe realizare;
//   * toate contoarele se citesc într-un SINGUR batch de interogări
//     indexate (~11 rânduri citite), nu un JOIN monstru;
//   * evaluarea rulează pe evenimente de prag (episod, cufăr, comentariu,
//     recenzie, prietenie) și când îți deschizi propriul profil — nu la
//     fiecare request;
//   * scrierea e INSERT OR IGNORE: a doua evaluare nu scrie nimic.
//
// Identitățile economiei rămân separate (vezi README):
//   ⭐ puncte = vizionare · ⚔️ XP = activitate · 🪙 gold = shop
// Realizările dau DOAR gold. XP-ul rămâne lucrul care se câștigă prin
// activitate — altfel boost-ul ⚡ (×2 XP din orice sursă) ar dubla și un
// trofeu acordat o singură dată, iar nivelul ar sări pe neașteptate.
// =====================================================================

import { addActivity } from './xp.js';
import { notifyUser } from './notify.js';

/** Treptele de raritate — folosite doar pentru culoarea cardului. */
export const TIERS = {
  bronze: { label: 'Bronz', icon: '🥉' },
  silver: { label: 'Argint', icon: '🥈' },
  gold: { label: 'Aur', icon: '🥇' },
  legend: { label: 'Legendă', icon: '🏆' },
};

/**
 * Catalogul. `stat` se referă la o cheie din STAT_QUERIES (mai jos), `target`
 * e pragul. `req` e textul afișat pe cardul nedeblocat — trebuie să spună
 * exact ce trebuie făcut, fără să oblige utilizatorul să ghicească.
 */
export const ACHIEVEMENTS = [
  { id: 'first_episode', icon: '🎬', name: 'Primul cadru', tier: 'bronze', stat: 'episodes', target: 1,
    desc: 'Ai terminat primul episod de pe Anime-Uke.', req: 'Vizionează un episod (15 minute)', gold: 10 },
  { id: 'first_comment', icon: '💬', name: 'Prima părere', tier: 'bronze', stat: 'comments', target: 1,
    desc: 'Ai scris primul comentariu. Comunitatea crește așa.', req: 'Scrie un comentariu', gold: 5 },
  { id: 'first_purchase', icon: '🛍️', name: 'Prima achiziție', tier: 'bronze', stat: 'items', target: 1,
    desc: 'Ai cumpărat primul cosmetic din shop.', req: 'Cumpără un articol din Shop', gold: 10 },
  { id: 'watchlist_5', icon: '📌', name: 'Lista de vizionat', tier: 'bronze', stat: 'watchlist', target: 5,
    desc: 'Cinci serii puse deoparte pentru mai târziu.', req: 'Adaugă 5 serii în „Serii de vizionat”', gold: 10 },

  { id: 'episodes_10', icon: '🍿', name: 'Maratonist', tier: 'silver', stat: 'episodes', target: 10,
    desc: 'Zece episoade terminate. Deja nu mai e o întâmplare.', req: 'Vizionează 10 episoade', gold: 25 },
  { id: 'first_review', icon: '⭐', name: 'Critic de anime', tier: 'silver', stat: 'reviews', target: 1,
    desc: 'Ai scris prima recenzie cu notă.', req: 'Scrie o recenzie', gold: 20 },
  { id: 'chest_10', icon: '🎁', name: 'Vânător de comori', tier: 'silver', stat: 'chests', target: 10,
    desc: 'Ai deschis cufărul de zece ori.', req: 'Deschide cufărul de 10 ori', gold: 30 },
  { id: 'friends_3', icon: '🤝', name: 'Grup de suport', tier: 'silver', stat: 'friends', target: 3,
    desc: 'Trei prieteni pe site — ai cu cine comenta.', req: 'Fă-ți 3 prieteni', gold: 20 },
  { id: 'rater_5', icon: '🎲', name: 'Juriu', tier: 'silver', stat: 'ratings', target: 5,
    desc: 'Ai notat cinci serii. Clasamentul îți datorează acuratețea.', req: 'Notează 5 serii', gold: 25 },

  { id: 'episodes_50', icon: '📺', name: 'Binge-watcher', tier: 'gold', stat: 'episodes', target: 50,
    desc: 'Cincizeci de episoade. Serialele te știu deja pe nume.', req: 'Vizionează 50 de episoade', gold: 75 },
  { id: 'comments_25', icon: '🗣️', name: 'Vocea comunității', tier: 'gold', stat: 'comments', target: 25,
    desc: 'Douăzeci și cinci de comentarii care mișcă discuția.', req: 'Scrie 25 de comentarii', gold: 60 },
  { id: 'streak_7', icon: '🔥', name: 'Foc continuu', tier: 'gold', stat: 'streak', target: 7,
    desc: 'Șapte zile la rând cu activitate. Disciplină de adevărat.', req: 'Intră 7 zile la rând', gold: 50 },
  { id: 'level_10', icon: '⚔️', name: 'Veteran', tier: 'gold', stat: 'level', target: 10,
    desc: 'Nivelul 10 — mult peste un cont obișnuit.', req: 'Ajunge la nivelul 10', gold: 60 },

  { id: 'episodes_100', icon: '🏆', name: 'Legendă vie', tier: 'legend', stat: 'episodes', target: 100,
    desc: 'O sută de episoade pe Anime-Uke. Respect.', req: 'Vizionează 100 de episoade', gold: 200 },
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/**
 * O interogare per contor, toate pe index/cheie primară. Sursa de adevăr e
 * mereu baza (watched_history, chest_cooldown…), nu un contor denormalizat
 * care poate rămâne în urmă — o realizare greșită e mai rea decât una
 * întârziată.
 */
export const STAT_QUERIES = {
  episodes: 'SELECT COUNT(*) AS n FROM watched_history WHERE user_id = ?',
  comments: 'SELECT COUNT(*) AS n FROM episode_comments WHERE user_id = ?',
  reviews: 'SELECT COUNT(*) AS n FROM series_reviews WHERE user_id = ?',
  chests: 'SELECT opens AS n FROM chest_cooldown WHERE user_id = ?',
  streak: 'SELECT best AS n FROM user_streak WHERE user_id = ?',
  friends: `SELECT COUNT(*) AS n FROM friendships
            WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
  watchlist: 'SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?',
  ratings: 'SELECT COUNT(*) AS n FROM series_ratings WHERE user_id = ?',
  items: 'SELECT COUNT(*) AS n FROM user_items WHERE user_id = ? AND qty > 0',
  level: 'SELECT level AS n FROM users WHERE id = ?',
};

const STAT_KEYS = Object.keys(STAT_QUERIES);

/** Contoarele unui utilizator, într-un singur round-trip către D1. */
export async function loadAchievementStats(env, userId) {
  const stmts = STAT_KEYS.map((key) => {
    const stmt = env.DB.prepare(STAT_QUERIES[key]);
    // Doar prietenia are nevoie de user_id de două ori.
    return key === 'friends' ? stmt.bind(userId, userId) : stmt.bind(userId);
  });
  const results = await env.DB.batch(stmts);
  const stats = {};
  STAT_KEYS.forEach((key, i) => {
    stats[key] = Number(results?.[i]?.results?.[0]?.n || 0);
  });
  return stats;
}

/** Progresul unei realizări, pentru bara de pe card. */
export function progressFor(achievement, stats) {
  const target = Math.max(1, Number(achievement.target) || 1);
  const current = Math.min(Number(stats?.[achievement.stat] || 0), target);
  return { current, target, percent: Math.round((current / target) * 100) };
}

/** Lista completă (catalog + stare), pentru profil: deblocate întâi. */
export function presentAchievements(stats, unlockedMap = new Map()) {
  const rows = ACHIEVEMENTS.map((a) => {
    const progress = progressFor(a, stats);
    return {
      id: a.id,
      icon: a.icon,
      name: a.name,
      desc: a.desc,
      req: a.req,
      tier: a.tier,
      tier_label: TIERS[a.tier]?.label || '',
      gold: a.gold || 0,
      xp: a.xp || 0,
      unlocked: unlockedMap.has(a.id),
      unlocked_at: unlockedMap.get(a.id) || null,
      progress,
    };
  });
  const weight = (r) => (r.unlocked ? 2 : 0) + r.progress.percent / 100;
  return rows.sort((a, b) => weight(b) - weight(a));
}

/** Următoarea realizare „la un pas” — folosită ca îndemn pe profil. */
export function nextAchievement(stats, unlockedMap = new Map()) {
  const locked = ACHIEVEMENTS
    .filter((a) => !unlockedMap.has(a.id))
    .map((a) => ({ a, p: progressFor(a, stats) }))
    .filter((x) => x.p.current > 0);
  if (!locked.length) return null;
  locked.sort((x, y) => y.p.percent - x.p.percent);
  return { id: locked[0].a.id, name: locked[0].a.name, icon: locked[0].a.icon, ...locked[0].p };
}

async function unlockedMapFor(env, userId) {
  const res = await env.DB
    .prepare('SELECT ach_id, unlocked_at FROM user_achievements WHERE user_id = ?')
    .bind(userId)
    .all();
  return new Map((res.results || []).map((r) => [r.ach_id, r.unlocked_at]));
}

export { unlockedMapFor };

/**
 * Deblochează ce a fost atins și acordă recompensele O SINGURĂ DATĂ.
 *
 * @returns {Promise<Array>} realizările NOI (poate fi gol) — clientul le
 *          afișează ca toast imediat după acțiunea care le-a declanșat.
 */
export async function evaluateAchievements(env, userId, { notify = true } = {}) {
  if (!userId) return [];
  const [stats, have] = await Promise.all([
    loadAchievementStats(env, userId),
    unlockedMapFor(env, userId),
  ]);

  const fresh = ACHIEVEMENTS.filter((a) => !have.has(a.id) && Number(stats[a.stat] || 0) >= a.target);
  if (!fresh.length) return [];

  // INSERT OR IGNORE + meta.changes: dacă două evaluări rulează în paralel
  // (episod + comentariu), recompensa se acordă o singură dată.
  const inserted = await env.DB.batch(
    fresh.map((a) =>
      env.DB.prepare('INSERT OR IGNORE INTO user_achievements (user_id, ach_id) VALUES (?, ?)')
        .bind(userId, a.id)
    )
  );
  const got = fresh.filter((_, i) => (inserted?.[i]?.meta?.changes || 0) > 0);
  if (!got.length) return [];

  const gold = got.reduce((s, a) => s + (a.gold || 0), 0);
  const xp = got.reduce((s, a) => s + (a.xp || 0), 0);
  if (gold) {
    await env.DB.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').bind(gold, userId).run();
  }
  if (xp) await addActivity(env, userId, xp);

  if (notify) {
    for (const a of got) {
      // payload fără episode_id/series_id: clopotul duce la profil (vezi
      // notifHref din core.js), unde cardul e deja aprins.
      await notifyUser(env, userId, 'achievement', {
        ach_id: a.id, name: a.name, icon: a.icon, gold: a.gold || 0, xp: a.xp || 0,
      });
    }
  }

  return got.map((a) => ({ id: a.id, name: a.name, icon: a.icon, tier: a.tier, gold: a.gold || 0, xp: a.xp || 0 }));
}
