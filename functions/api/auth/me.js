export async function onRequest(context) {
  const { request, env } = context;
  
  // Pentru demo, returnăm un utilizator fake
  // În realitate, ai verifica session-ul din cookie
  
  const cookie = request.headers.get('Cookie') || '';
  
  if (!cookie.includes('session=')) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Aici ar trebui să cauți user-ul după session
  // Varianta simplă: returnează un utilizator default
  return new Response(JSON.stringify({ 
    user: {
      id: '123',
      username: 'DemoUser',
      email: 'demo@example.com',
      role: 'user',
      points: 150
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
