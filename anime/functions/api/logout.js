
// functions/api/logout.js

export async function onRequest({ request, env }) {
  const authHeader = request.headers.get('Authorization');
  const sessionId = authHeader?.replace('Bearer ', '');
  
  if (sessionId) {
    await env.SESSIONS.delete(sessionId);
  }
  
  return Response.json({ success: true });
}
