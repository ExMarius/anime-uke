import { signJWT } from '../../utils/jwt.js';

export async function onRequest(context) {
  const { request, env } = context;
  const { username, email, password } = await request.json();
  const db = env.DB;

  try {
    await db.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)")
      .bind(username, email, password).run();

    const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
    const token = await signJWT({ id: user.id, username: user.username, is_admin: false }, env.JWT_SECRET);

    return new Response(JSON.stringify({ token, username, points: 0, is_admin: false }), {
      headers: { "Set-Cookie": `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400` }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Utilizatorul există deja" }), { status: 400 });
  }
}
