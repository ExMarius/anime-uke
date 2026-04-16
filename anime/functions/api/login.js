export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Folosește POST' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  try {
    const { email, password } = await request.json();
    const user = await env.DB.prepare(`SELECT id, username, password_hash FROM users WHERE email = ?`).bind(email).first();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Email sau parolă incorectă' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(password));
    const password_hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (password_hash !== user.password_hash) {
      return new Response(JSON.stringify({ error: 'Email sau parolă incorectă' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const sessionId = crypto.randomUUID();
    await env.SESSIONS.put(sessionId, user.id.toString(), { expirationTtl: 86400 });
    return new Response(JSON.stringify({ success: true, sessionId, user: { id: user.id, username: user.username } }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Eroare internă' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
