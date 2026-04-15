// functions/api/login.js

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Folosește POST pentru autentificare' }, { status: 405 });
  }
  
  try {
    const { email, password } = await request.json();
    
    // Căutăm utilizatorul după email
    const user = await env.DB.prepare(
      `SELECT id, username, password_hash FROM users WHERE email = ?`
    ).bind(email).first();
    
    if (!user) {
      return Response.json({ error: 'Email sau parolă incorectă' }, { status: 401 });
    }
    
    // Verificăm parola
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(password));
    const password_hash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    
    if (password_hash !== user.password_hash) {
      return Response.json({ error: 'Email sau parolă incorectă' }, { status: 401 });
    }
    
    // Generăm sesiune
    const sessionId = crypto.randomUUID();
    await env.SESSIONS.put(sessionId, user.id.toString(), { expirationTtl: 86400 });
    
    return Response.json({ 
      success: true, 
      sessionId: sessionId,
      user: { id: user.id, username: user.username }
    });
    
  } catch (error) {
    return Response.json({ error: 'Eroare internă' }, { status: 500 });
  }
}
