export async function onRequest(context) {
  const { env } = context;
  const series = await env.DB.prepare("SELECT * FROM anime_series").all();
  return Response.json(series.results);
}
