export async function onRequest(context) {
  const { request, env } = context;
  const { episodeId } = await request.json();
  
  await env.DB.prepare(
    'UPDATE episodes SET views = views + 1 WHERE id = ?'
  ).bind(episodeId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
