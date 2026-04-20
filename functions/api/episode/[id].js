export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params.id;
  
  if (!id) {
    return new Response(JSON.stringify({ error: 'ID episod lipsă' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const episode = await env.DB.prepare(
      `SELECT e.*, s.title as series_title, s.id as series_id
       FROM episodes e 
       LEFT JOIN anime_series s ON e.series_id = s.id 
       WHERE e.id = ?`
    ).bind(id).first();
    
    if (!episode) {
      return new Response(JSON.stringify({ error: 'Episod negăsit' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ episode }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error fetching episode:', error);
    return new Response(JSON.stringify({ error: 'Eroare internă' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
