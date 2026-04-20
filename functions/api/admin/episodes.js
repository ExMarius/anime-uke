export async function onRequest(context) {
  const { request, env } = context;
  
  // Verifică admin
  const cookie = request.headers.get('Cookie') || '';
  if (!cookie.includes('session')) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), { status: 403 });
  }
  
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  
  try {
    const { series_id, episode_number, title, doodstream_url } = await request.json();
    
    if (!series_id || !episode_number || !doodstream_url) {
      return new Response(JSON.stringify({ error: 'Câmpuri obligatorii lipsă.' }), { status: 400 });
    }
    
    const id = crypto.randomUUID();
    
    await env.DB.prepare(
      `INSERT INTO episodes (id, series_id, episode_number, title, doodstream_url) 
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, series_id, episode_number, title || `Episodul ${episode_number}`, doodstream_url).run();
    
    return new Response(JSON.stringify({ success: true, episodeId: id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Eroare internă.' }), { status: 500 });
  }
}
