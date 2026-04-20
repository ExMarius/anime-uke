export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params.id;
  
  if (!id) {
    return new Response(JSON.stringify({ error: 'ID serie lipsă' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    // Ia seria
    const series = await env.DB.prepare(
      'SELECT * FROM anime_series WHERE id = ?'
    ).bind(id).first();
    
    if (!series) {
      return new Response(JSON.stringify({ error: 'Serie negăsită' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Ia episoadele seriei
    const episodes = await env.DB.prepare(
      'SELECT * FROM episodes WHERE series_id = ? ORDER BY episode_number ASC'
    ).bind(id).all();
    
    return new Response(JSON.stringify({ 
      series: series, 
      episodes: episodes.results 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error fetching series:', error);
    return new Response(JSON.stringify({ error: 'Eroare internă' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
