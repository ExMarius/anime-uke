// =====================================================================
// Notificari: un singur INSERT ... SELECT notifica totii abonatii unei
// serii (fara N round-trip-uri), iar badge-ul din nav citeste doar
// count-ul indexat. Tipurile sunt extensibile prin catalogul de mai jos.
// =====================================================================

export const NOTIF_TYPES = {
  new_episode: { icon: '🎬', text: (p) => `Episod nou la ${p.series_title}: Episodul ${p.episode_number}${p.episode_title ? ` — ${p.episode_title}` : ''}` },
  new_episodes: { icon: '📚', text: (p) => `${p.count} episoade noi la ${p.series_title}` },
};

/** Notifica toti abonatii seriei. O singura scriere batch in D1. */
export async function notifySubscribers(env, seriesId, type, payload) {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const res = await env.DB.prepare(
    `INSERT INTO notifications (user_id, type, payload, created_at)
     SELECT user_id, ?, ?, ? FROM series_subscriptions WHERE series_id = ?`
  ).bind(type, JSON.stringify(payload || {}), stamp, seriesId).run();

  // Curatare ieftina: cititele mai vechi de 30 de zile nu mai intereseaza
  // pe nimeni. Ruleaza rar (doar la postari), nu la fiecare citire.
  await env.DB
    .prepare(`DELETE FROM notifications WHERE read = 1 AND created_at < datetime('now', '-30 days')`)
    .run();
  return res.meta?.changes || 0;
}

export async function unreadCount(env, userId) {
  const r = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0')
    .bind(userId)
    .first();
  return r?.n || 0;
}

export async function listNotifications(env, userId, { limit = 30, unreadOnly = false } = {}) {
  const q = unreadOnly
    ? 'SELECT id, type, payload, read, created_at FROM notifications WHERE user_id = ? AND read = 0 ORDER BY id DESC LIMIT ?'
    : 'SELECT id, type, payload, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?';
  const res = await env.DB.prepare(q).bind(userId, Math.min(50, Math.max(1, limit))).all();
  return (res.results || []).map((r) => {
    let payload = {};
    try { payload = JSON.parse(r.payload); } catch { /* ignora */ }
    const meta = NOTIF_TYPES[r.type];
    return {
      id: r.id,
      type: r.type,
      payload,
      read: !!r.read,
      created_at: r.created_at,
      icon: meta?.icon || '🔔',
      text: meta ? meta.text(payload) : 'Notificare nouă',
    };
  });
}

export async function markRead(env, userId, { all = false, ids = [] } = {}) {
  if (all) {
    const r = await env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').bind(userId).run();
    return r.meta?.changes || 0;
  }
  if (!ids.length) return 0;
  const marks = ids.slice(0, 50).map((id) =>
    env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').bind(Number(id), userId)
  );
  const out = await env.DB.batch(marks);
  return out.reduce((s, r) => s + (r.meta?.changes || 0), 0);
}
