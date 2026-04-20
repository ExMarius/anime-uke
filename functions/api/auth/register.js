export async function onRequest(context) {
  const { request, env } = context;
  
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const { username, email, password } = await request.json();
    
    if (!username || !email || !password || password.length < 4) {
      return new Response(JSON.stringify({ error: 'Date invalide. Parola minim 4 caractere.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Verifică dacă există deja
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ? OR username = ?'
    ).bind(email, username).first();
    
    if (existing) {
      return new Response(JSON.stringify({ error: 'Email sau username deja folosit.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Hash parolă simplă
    const encoder = new TextEncoder();
    const passwordHash = Array.from(encoder.encode(password + 'anime-secret-salt'))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    
    const userId = crypto.randomUUID();
    
    await env.DB.prepare(
      `INSERT INTO users (id, username, email, password_hash, points, role) 
       VALUES (?, ?, ?, ?, 0, 'user')`
    ).bind(userId, username, email, passwordHash).run();
    
    return new Response(JSON.stringify({ success: true, userId }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Register error:', error);
    return new Response(JSON.stringify({ error: 'Eroare internă.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
