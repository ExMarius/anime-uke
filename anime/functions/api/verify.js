export async function onRequest({ request, env }) {
  const authHeader = request.headers.get('Authorization');
  const sessionId = authHeader?.replace('Bearer ', '');
  if (!sessionId) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const userId = await env.SESSIONS.get(sessionId);
  if (!userId) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const user = await env.DB.prepare(`SELECT id, username, email FROM users WHERE id = ?`).bind(userId).first();
  return new Response(JSON.stringify({ authenticated: true, user }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
