// =====================================================================
// /api/factions — panoul de facțiune
//
//   GET  → facțiunile (temele de grade), alegerea mea, rep, top membrii
//          facțiunii mele (cu liderul 👑), clasamentul dintre facțiuni,
//          câștigătoarea lunii trecute (bonus 1.5x)
//   POST { faction } → alătur-te (o singură dată pe lună)
//
// Settler-ul lunii rulează aici, leneș, la primul GET din lună.
// =====================================================================
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { loadRankThemes } from '../../lib/ranks.js';
import {
  monthKey, myRep, addRep, settleFactions,
  standings, winnerOf, leaderClassFor, prevMonthKey,
} from '../../lib/factions.js';

const sanitizeSlug = (v) => String(v || '').trim().toLowerCase().slice(0, 40);

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `factions:${user.id}`, 60, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  try {
    // Plățile lunii (lideri + câștigătoare) — idempotent, o dată pe lună.
    await settleFactions(env);

    const mk = monthKey();
    const themes = await loadRankThemes(env);
    const factions = themes.map((t) => ({
      slug: t.slug,
      title: t.title,
      icon: t.tiers?.[0]?.icon || '🎗️',
      tiers: t.tiers,
      leader_class: leaderClassFor(t.slug),
    }));

    const mine = user.faction_slug || '';
    const rep = await myRep(env, user.id, mk);

    // Top membri ai facțiunii mele în luna curentă + marcaj de lider
    let members = [];
    if (mine) {
      const rows = await env.DB
        .prepare(
          `SELECT fr.user_id, u.username, fr.rep,
                  (SELECT 1 FROM faction_leaders fl
                    WHERE fl.month = ? AND fl.faction = fr.faction
                      AND fl.user_id = fr.user_id) AS is_leader
           FROM faction_rep fr
           JOIN users u ON u.id = fr.user_id
           WHERE fr.month = ? AND fr.faction = ?
           ORDER BY fr.rep DESC, u.username ASC LIMIT 10`
        )
        .bind(mk, mk, mine)
        .all();
      members = (rows.results || []).map((r) => ({
        username: r.username,
        rep: r.rep || 0,
        leader: !!r.is_leader,
        me: r.user_id === user.id,
      }));
    }

    const board = await standings(env, mk);
    const prevWinner = await winnerOf(env, prevMonthKey());
    const prevWinnerTotal = await env.DB
      .prepare('SELECT total_rep FROM faction_winners WHERE month = ?')
      .bind(prevMonthKey())
      .first();

    return json({
      month: mk,
      factions,
      my_faction: mine,
      my_faction_month: user.faction_month || null,
      can_change: user.faction_month !== mk,
      my_rep: rep.rep,
      members,
      standings: board,
      prev_winner: prevWinner
        ? { faction: prevWinner, total: prevWinnerTotal?.total || 0, bonus: 1.5 }
        : null,
    });
  } catch (e) {
    console.error('GET /api/factions esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca facțiunile');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const rl = await checkRateLimit(env, `fjoin:${gate.user.id}`, 10, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const slug = sanitizeSlug(body?.faction);

  const themes = await loadRankThemes(env);
  const theme = themes.find((t) => t.slug === slug);
  if (!theme) return errorResponse(400, 'Facțiunea nu există');

  const mk = monthKey();
  if (gate.user.faction_month === mk && gate.user.faction_slug) {
    return errorResponse(409, 'Te-ai alăturat deja unei facțiuni luna asta. Schimbarea e posibilă la începutul lunii următoare.');
  }

  // Alegerea setează ȘI tema de grade (automat, după facțiune — cerință).
  await env.DB
    .prepare('UPDATE users SET faction_slug = ?, faction_month = ?, rank_theme = ? WHERE id = ?')
    .bind(slug, mk, slug, gate.user.id)
    .run();

  // Rep existent în luna asta (dacă s-a jucat înainte de alegere) îl mutăm
  // sub facțiunea aleasă, ca nimeni să nu piardă progresul din greșeală.
  await env.DB
    .prepare(
      `INSERT INTO faction_rep (month, user_id, faction, rep) VALUES (?, ?, ?, 0)
       ON CONFLICT(month, user_id) DO UPDATE SET faction = excluded.faction`
    )
    .bind(mk, gate.user.id, slug)
    .run();

  return json({ success: true, faction: slug, rank_theme: slug });
}
