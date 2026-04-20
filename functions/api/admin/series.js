export async function onRequest(context) {
  const { request, env } = context;
  
  // Verifică admin (simplu - în realitate verifici rolul)
  const cookie = request.headers.get('Cookie') || '';
  if (!cookie.includes('session')) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), { status: 403 });
  }
  
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  
  try {
    const { title, description, cover_image, status } = await request.json();
    
    if (!title) {
      return new Response(JSON.stringify({ error: 'Titlul este obligatoriu.' }), { status: 400 });
    }
    
    const id = crypto.randomUUID();
    
    await env.DB.prepare(
      `INSERT INTO anime_series (id, title, description, cover_image, status) 
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, title, description || '', cover_image || '', status || 'ongoing').run();
    
    return new Response(JSON.stringify({ success: true, seriesId: id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Eroare internă.' }), { status: 500 });
  }
}
