export async function onRequestGet(context) {
    const { env } = context;
    const episodes = await env.DB.prepare(`
        SELECT e.*, s.name as series_name, s.slug as series_slug, s.image_url
        FROM episodes e
        JOIN series s ON e.series_id = s.id
        ORDER BY e.created_at DESC
        LIMIT 12
    `).all();
    return new Response(JSON.stringify(episodes.results), {
        headers: { 'Content-Type': 'application/json' }
    });
}
