export async function onRequestPost(context) {
    const { request, env } = context;
    const { username, password } = await request.json();
    
    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ? OR email = ?').bind(username, username).first();
    if (!user) {
        return new Response(JSON.stringify({ success: false, message: 'Credențiale incorecte' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        });
    }
    
    // Verifică parola
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(password));
    const hashedPassword = btoa(String.fromCharCode(...new Uint8Array(hash)));
    
    if (hashedPassword !== user.password) {
        return new Response(JSON.stringify({ success: false, message: 'Credențiale incorecte' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        });
    }
    
    // Generează token
    const token = crypto.randomUUID();
    await env.KV.put(`session:${token}`, JSON.stringify({ userId: user.id, expires: Date.now() + 7 * 86400000 }), { expirationTtl: 604800 });
    
    return new Response(JSON.stringify({
        success: true,
        token: token,
        user: { id: user.id, username: user.username, email: user.email, role: user.role, gold: user.gold, xp: user.xp, level: user.level }
    }), { headers: { 'Content-Type': 'application/json' } });
}
