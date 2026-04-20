export async function onRequest(context) {
  const { request, env } = context;
  
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  try {
    const { email, password } = await request.json();
    
    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email și parolă obligatorii' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Caută utilizatorul
    const user = await env.DB.prepare(
      'SELECT id, username, email, password_hash, role, points FROM users WHERE email = ?'
    ).bind(email).first();
    
    if (!user) {
      return new Response(JSON.stringify({ error: 'Email sau parolă greșită' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Verifică parola
    const encoder = new TextEncoder();
    const passwordHash = Array.from(encoder.encode(password))
      .map(b => b.toString(16)).join('');
    
    if (user.password_hash !== passwordHash) {
      return new Response(JSON.stringify({ error: 'Email sau parolă greșită' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Actualizează last_login
    await env.DB.prepare(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(user.id).run();
    
    // Creează token simplu (session ID)
    const sessionToken = crypto.randomUUID();
    
    // Return cu cookie
    return new Response(JSON.stringify({ 
      success: true, 
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        points: user.points
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/`
      }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Eroare internă' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
