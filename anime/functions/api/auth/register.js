export async function onRequestPost(context) {
    const { request, env } = context;
    const { username, email, password } = await request.json();
    
    // Verifică dacă există
    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ? OR email = ?').bind(username, email).first();
    if (existing) {
        return new Response(JSON.stringify({ success: false, message: 'Utilizator sau email deja existent' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    // Hash parolă
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(password));
    const hashedPassword = btoa(String.fromCharCode(...new Uint8Array(hash)));
    
    // Creează utilizator
    await env.DB.prepare('INSERT INTO users (username, email, password, gold, xp, level, role) VALUES (?, ?, ?, 100, 0, 1, "user")')
        .bind(username, email, hashedPassword).run();
    
    return new Response(JSON.stringify({ success: true, message: 'Cont creat cu succes' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
}
