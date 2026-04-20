export async function onRequest(context) {
  const { request, env } = context;
  const { email, password } = await request.json();

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  
  if (!user) {
    return new Response(JSON.stringify({ error: 'Email sau parolă greșită' }), { status: 401 });
  }

  // Verificare parolă (simplă)
  const encoder = new TextEncoder();
  const passwordHash = Array.from(encoder.encode(password)).map(b => b.toString(16)).join('');
  
  if (user.password_hash !== passwordHash) {
    return new Response(JSON.stringify({ error: 'Email sau parolă greșită' }), { status: 401 });
  }

  // Generează token simplu
  const token = crypto.randomUUID();
  
  // Salvează token-ul într-un cookie
  return new Response(JSON.stringify({ success: true, user: { id: user.id, username: user.username, points: user.points } }), {
    headers: {
      'Set-Cookie': `token=${token}; HttpOnly; Path=/; Max-Age=604800`,
      'Content-Type': 'application/json'
    }
  });
}
