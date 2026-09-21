// =====================================================================
// GET /api/economy — panoul de economie al profilului, intr-o singura
// cerere: XP + nivel + progres, punctele lunii, gold, starea cufarului
// si insigne (cu lunile aferente pentru tooltip-ul „Utilizator activ").
// =====================================================================
import { json } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { BADGES, MONTHLY_GOAL, monthKey, xpNeeded } from '../../lib/xp.js';
import { loadRankThemes, rankForUser } from '../../lib/ranks.js';
import { getStreak } from '../../lib/missions.js';
import { CHEST_COOLDOWN_MS } from './chest.js';
import { settleFactions } from '../../lib/factions.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  // Plățile lunare de facțiune (lideri + câștigătoare) — leneș, idempotent.
  try { await settleFactions(env); } catch { /* nu blocăm panoul */ }

  const me = await env.DB
    .prepare('SELECT xp, level, gold, xp_boost_until FROM users WHERE id = ?')
    .bind(user.id)
    .first();

  const mk = monthKey();
  const monthly = await env.DB
    .prepare('SELECT points FROM user_monthly_points WHERE user_id = ? AND month = ?')
    .bind(user.id, mk)
    .first();

  const badgeRows = await env.DB
    .prepare('SELECT badge, month FROM user_badges WHERE user_id = ? ORDER BY month DESC')
    .bind(user.id)
    .all();

  // Tooltip-ul insignei lunare listeaza fiecare luna cu punctele ei.
  const monthRows = await env.DB
    .prepare('SELECT month, points FROM user_monthly_points WHERE user_id = ? ORDER BY month DESC')
    .bind(user.id)
    .all();

  const cool = await env.DB
    .prepare('SELECT last_opened_at, opens FROM chest_cooldown WHERE user_id = ?')
    .bind(user.id)
    .first();
  let chest = { opens: 0, available: true, remaining_ms: 0 };
  if (cool) {
    const last = Date.parse(String(cool.last_opened_at).replace(' ', 'T') + 'Z');
    const remaining = last + CHEST_COOLDOWN_MS - Date.now();
    chest = { opens: cool.opens, available: remaining <= 0, remaining_ms: Math.max(0, remaining) };
  }

  // Cate chei de cufar are in inventar (shop) — aceeasi citire indexata.
  const keyRow = await env.DB
    .prepare(`SELECT qty FROM user_items WHERE user_id = ? AND item_id = 'chest_key'`)
    .bind(user.id)
    .first();

  const level = me?.level || 1;
  const xp = me?.xp || 0;

  // Rangul curent + urmatorul prag („la nivelul 10 devii Jonin”).
  const themes = await loadRankThemes(env);
  const rank = rankForUser({ ...user, level }, themes);
  const theme = themes.find((t) => t.slug === rank.theme) || themes[0];
  const sortedTiers = [...(theme?.tiers || [])].sort((a, b) => a.min - b.min);
  const nextTier = sortedTiers.find((t) => t.min > level) || null;

  // Statistici reale pentru gridul de profil (toate COUNT pe indexuri).
  const stats = await env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM watched_history WHERE user_id = ?)      AS watched,
         (SELECT COUNT(*) FROM episode_comments WHERE user_id = ?)     AS comments,
         (SELECT COUNT(*) FROM series_subscriptions WHERE user_id = ?) AS subscriptions`
    )
    .bind(user.id, user.id, user.id)
    .first();

  const streak = await getStreak(env, user.id);

  return json({
    xp,
    level,
    xp_needed: xpNeeded(level),
    rank: { ...rank, next_label: nextTier?.label || null, next_min: nextTier?.min || null, next_icon: nextTier?.icon || null },
    streak,
    stats: {
      watched: stats?.watched || 0,
      comments: stats?.comments || 0,
      subscriptions: stats?.subscriptions || 0,
      chest_opens: chest.opens,
    },
    monthly_points: monthly?.points || 0,
    monthly_goal: MONTHLY_GOAL,
    month: mk,
    gold: me?.gold || 0,
    chest,
    chest_keys: keyRow?.qty || 0,
    xp_boost_until: me?.xp_boost_until || null,
    xp_boost_ms: Math.max(0, (me?.xp_boost_until || 0) - Date.now()),
    badges: (badgeRows.results || []).map((b) => ({
      badge: b.badge,
      month: b.month || null,
      name: BADGES[b.badge]?.name || b.badge,
      icon: BADGES[b.badge]?.icon || '🏅',
    })),
    months: (monthRows.results || []).map((m) => ({ month: m.month, points: m.points })),
  });
}
