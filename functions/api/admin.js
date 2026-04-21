import { verifyJWT } from '../../utils/jwt.js';

export async function onRequest(context) {
  const { request, env } = context;
  const token = request.headers.get('Cookie')?.match(/token=([^;]+)/)?.[1];
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload?.is_admin) return new Response("Forbidden", { status: 403 });

  const { method } = request;
  const db = env.DB;

  if (method === "POST") {
    const { type, data } = await request.json();
    if (type === "series") {
      await db.prepare("INSERT INTO anime_series (title, description, poster_url) VALUES (?, ?, ?)")
        .bind(data.title, data.description, data.poster_url).run();
    } else if (type === "episode") {
      await db.prepare("INSERT INTO episodes (series_id, title, episode_number, doodstream_embed) VALUES (?, ?, ?, ?)")
        .bind(data.series_id, data.title, data.episode_number, data.doodstream_embed).run();
    }
    return Response.json({ success: true });
  }

  if (method === "GET") {
    const users = await db.prepare("SELECT id, username, email, points, is_admin FROM users").all();
    return Response.json(users.results);
  }

  return new Response("Method not allowed", { status: 405 });
}
