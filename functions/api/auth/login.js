import { signJWT } from '../../utils/jwt.js';

export async function onRequest(context) {
  const { request, env } = context;
  const { username, password } = await request.json();
  const db = env.DB;

  const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  if (!user || user.password !== password) {
    return new Response(JSON.stringify({ error: "Credențiale greșite" }), { status: 401 });
  }

  const token = await signJWT({ id: user.id, username: user.username, is_admin: !!user.is_admin }, env.JWT_SECRET);
  return new Response(JSON.stringify({ token, username: user.username, points: user.points, is_admin: !!user.is_admin }), {
    headers: { "Set-Cookie": `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400` }
  });
}
