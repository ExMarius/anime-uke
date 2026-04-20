export async function onRequest(context) {
  const { env } = context;
  
  const series = await env.DB.prepare(
    'SELECT * FROM anime_series ORDER BY created_at DESC'
  ).all();
  
  return new Response(JSON.stringify({ series: series.results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
