export async function onRequestPost(context) {
    const { request, env } = context;
    const auth = request.headers.get('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.substring(7) : null;
    
    if (!token) {
        return new Response(JSON.stringify({ success: false }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    const session = await env.KV.get(`session:${token}`, 'json');
    if (!session || session.expires < Date.now()) {
        return new Response(JSON.stringify({ success: false }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    const { series_slug, episode_number } = await request.json();
    const series = await env.DB.prepare('SELECT id FROM series WHERE slug = ?').bind(series_slug).first();
    if (!series) {
        return new Response(JSON.stringify({ success: false }), { headers: { 'Content-Type': 'application/json' } });
    }
    
    const episode = await env.DB.prepare('SELECT id FROM episodes WHERE series_id = ? AND episode_number = ?').bind(series.id, episode_number).first();
    if (!episode) {
        return new Response(JSON.stringify({ success: false }), { headers: { 'Content-Type': 'application/json' } });
    }
    
    const existing = await env.DB.prepare('SELECT id FROM views WHERE user_id = ? AND episode_id = ?').bind(session.userId, episode.id).first();
    if (!existing) {
        await env.DB.prepare('INSERT INTO views (user_id, episode_id) VALUES (?, ?)').bind(session.userId, episode.id).run();
        await env.DB.prepare('UPDATE users SET gold = gold + 5, xp = xp + 10 WHERE id = ?').bind(session.userId).run();
    }
    
    return new Response(JSON.stringify({ success: true, gold_earned: 5 }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
