import { verifyJWT } from '../utils/jwt.js';

export async function onRequest(context) {
  const { request, env } = context;
  const token = request.headers.get('Cookie')?.match(/token=([^;]+)/)?.[1];
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return new Response("Unauthorized", { status: 401 });

  const { episode_id } = await request.json();
  const db = env.DB;

  const already = await db.prepare("SELECT id FROM watched_history WHERE user_id = ? AND episode_id = ?")
    .bind(payload.id, episode_id).first();

  if (already) return Response.json({ points: payload.points || 0 });

  await db.prepare("INSERT INTO watched_history (user_id, episode_id) VALUES (?, ?)")
    .bind(payload.id, episode_id).run();

  await db.prepare("UPDATE users SET points = points + 10 WHERE id = ?").bind(payload.id).run();

  return Response.json({ success: true, pointsAdded: 10 });
}
