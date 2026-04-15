// functions/api/verify.js

export async function onRequest({ request, env }) {
  const authHeader = request.headers.get('Authorization');
  const sessionId = authHeader?.replace('Bearer ', '');
  
  if (!sessionId) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  
  const userId = await env.SESSIONS.get(sessionId);
  if (!userId) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  
  const user = await env.DB.prepare(
    `SELECT id, username, email FROM users WHERE id = ?`
  ).bind(userId).first();
  
  return Response.json({ authenticated: true, user });
}
