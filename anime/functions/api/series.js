export async function onRequestGet(context) {
    const { env } = context;
    const series = await env.DB.prepare('SELECT * FROM series ORDER BY name').all();
    return new Response(JSON.stringify(series.results), {
        headers: { 'Content-Type': 'application/json' }
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    
    // Verifică admin
    const auth = request.headers.get('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.substring(7) : null;
    if (!token) {
        return new Response(JSON.stringify({ success: false, message: 'Neautorizat' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    const session = await env.KV.get(`session:${token}`, 'json');
    if (!session) {
        return new Response(JSON.stringify({ success: false, message: 'Sesiune invalidă' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    const user = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(session.userId).first();
    if (user.role !== 'admin') {
        return new Response(JSON.stringify({ success: false, message: 'Necesită drepturi de admin' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    
    const { name, slug, description, image_url, min_age, type } = await request.json();
    const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    await env.DB.prepare('INSERT INTO series (name, slug, description, image_url, min_age, type) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(name, finalSlug, description, image_url, min_age || 13, type || 'anime').run();
    
    return new Response(JSON.stringify({ success: true }), {
        status: 201, headers: { 'Content-Type': 'application/json' }
    });
}
