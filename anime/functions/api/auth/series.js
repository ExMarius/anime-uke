export async function onRequestGet(context) {
    const { env } = context;
    const series = await env.DB.prepare('SELECT * FROM series ORDER BY name').all();
    return new Response(JSON.stringify(series.results), {
        headers: { 'Content-Type': 'application/json' }
    });
}
