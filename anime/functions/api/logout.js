export async function onRequest({ request, env }) {
  const authHeader = request.headers.get('Authorization');
  const sessionId = authHeader?.replace('Bearer ', '');
  if (sessionId) {
    await env.SESSIONS.delete(sessionId);
  }
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
