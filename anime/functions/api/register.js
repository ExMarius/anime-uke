export async function onRequest(context) {
  const { request, env } = context;
  
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Metoda nu este permisa' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const { username, email, password } = await request.json();
    
    const encoder = new TextEncoder();
    const passwordHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(password))))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    
    const result = await env.DB.prepare(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    ).bind(username, email, passwordHash).run();
    
    return new Response(JSON.stringify({ success: true, userId: result.meta.last_row_id }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Username sau email deja folosit' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
