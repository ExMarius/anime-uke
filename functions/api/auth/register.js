export async function onRequest(context) {
  const { request, env } = context;
  
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  try {
    const { username, email, password } = await request.json();
    
    // Validare simplă
    if (!username || !email || !password || password.length < 4) {
      return new Response(JSON.stringify({ error: 'Date invalide' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Verifică dacă există deja
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ? OR username = ?'
    ).bind(email, username).first();
    
    if (existing) {
      return new Response(JSON.stringify({ error: 'Email sau username deja folosit' }), { 
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Hash parolă simplu (pentru test, după poți pune bcrypt)
    const encoder = new TextEncoder();
    const passwordHash = Array.from(encoder.encode(password))
      .map(b => b.toString(16)).join('');
    
    const userId = crypto.randomUUID();
    
    await env.DB.prepare(
      `INSERT INTO users (id, username, email, password_hash, points) 
       VALUES (?, ?, ?, ?, 0)`
    ).bind(userId, username, email, passwordHash).run();
    
    return new Response(JSON.stringify({ success: true, userId }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Eroare internă' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
