export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const seriesId = url.searchParams.get('series_id');
  
  let query = 'SELECT * FROM episodes ORDER BY created_at DESC LIMIT 20';
  let params = [];
  
  if (seriesId) {
    query = 'SELECT * FROM episodes WHERE series_id = ? ORDER BY episode_number ASC';
    params = [seriesId];
  }
  
  const episodes = await env.DB.prepare(query).bind(...params).all();
  
  return new Response(JSON.stringify({ episodes: episodes.results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
