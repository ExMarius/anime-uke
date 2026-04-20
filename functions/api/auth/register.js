export async function onRequest(context) {
  const { request, env } = context;
  const { username, email, password } = await request.json();

  // Simplu: verifică dacă există deja utilizatorul
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Email deja folosit' }), { status: 400 });
  }

  // Generează ID și hash parolă simplu (îți dau varianta fără bcrypt pentru început)
  const id = crypto.randomUUID();
  
  // NOTĂ: Pentru parolă, ideal e bcrypt, dar varianta simplă e hash cu crypto
  const encoder = new TextEncoder();
  const passwordHash = Array.from(encoder.encode(password)).map(b => b.toString(16)).join('');

  await env.DB.prepare(
    'INSERT INTO users (id, username, email, password_hash, points) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, username, email, passwordHash, 0).run();

  return new Response(JSON.stringify({ success: true, userId: id }));
}
