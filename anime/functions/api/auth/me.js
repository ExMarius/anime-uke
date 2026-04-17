export async function onRequestGet(context) {
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
    
    const user = await env.DB.prepare('SELECT id, username, email, role, gold, xp, level FROM users WHERE id = ?').bind(session.userId).first();
    return new Response(JSON.stringify({ success: true, user }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
