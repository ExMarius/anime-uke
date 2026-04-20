// functions/api/auth/register.js
export async function onRequest(context) {
  // onRequest acceptă automat GET, POST, etc.
  const { request, env } = context;
  
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  try {
    const { username, email, password } = await request.json();
    
    // Restul codului tău...
    
    return new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Eroare internă' }), { status: 500 });
  }
}
