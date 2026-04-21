export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const seriesId = url.searchParams.get('series_id');
  const episodes = await env.DB.prepare("SELECT * FROM episodes WHERE series_id = ? ORDER BY episode_number")
    .bind(seriesId).all();
  return Response.json(episodes.results);
}
