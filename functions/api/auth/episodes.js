export async function onRequest(context) {
  const { env } = context;
  
  try {
    const episodes = await env.DB.prepare(
      'SELECT * FROM episodes ORDER BY created_at DESC LIMIT 20'
    ).all();
    
    return new Response(JSON.stringify({ episodes: episodes.results }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Eroare internă', episodes: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
