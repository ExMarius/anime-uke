export async function onRequest(context) {
  const { request, env } = context;
  
  const cookie = request.headers.get('Cookie') || '';
  const sessionMatch = cookie.match(/session=([^;]+)/);
  
  if (!sessionMatch) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Pentru demo, returnăm un user din DB pe baza unui lookup
  // În realitate, ai stoca session-ul în KV sau ai folosi JWT
  
  // Simplu: returnează un user test (schimbă cu logica ta reală)
  const user = await env.DB.prepare(
    'SELECT id, username, email, role, points FROM users LIMIT 1'
  ).first();
  
  if (!user) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
