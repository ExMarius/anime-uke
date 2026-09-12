// =====================================================================
// GET /api/economy — panoul de economie al profilului, intr-o singura
// cerere: XP + nivel + progres, punctele lunii, gold, starea cufarului
// si insigne (cu lunile aferente pentru tooltip-ul „Utilizator activ").
// =====================================================================
import { json } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { BADGES, MONTHLY_GOAL, monthKey, xpNeeded } from '../../lib/xp.js';
import { CHEST_COOLDOWN_MS } from './chest.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const me = await env.DB
    .prepare('SELECT xp, level, gold FROM users WHERE id = ?')
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

  const level = me?.level || 1;
  const xp = me?.xp || 0;

  return json({
    xp,
    level,
    xp_needed: xpNeeded(level),
    monthly_points: monthly?.points || 0,
    monthly_goal: MONTHLY_GOAL,
    month: mk,
    gold: me?.gold || 0,
    chest,
    badges: (badgeRows.results || []).map((b) => ({
      badge: b.badge,
      month: b.month || null,
      name: BADGES[b.badge]?.name || b.badge,
      icon: BADGES[b.badge]?.icon || '🏅',
    })),
    months: (monthRows.results || []).map((m) => ({ month: m.month, points: m.points })),
  });
}
