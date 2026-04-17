export async function onRequestPost(context) {
    const { request, env } = context;
    const { username, email, password } = await request.json();
    
    // Validare
    if (!username || username.length < 3) {
        return new Response(JSON.stringify({ success: false, message: 'Nume prea scurt (min 3 caractere)' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        });
    }
    if (!email || !email.includes('@')) {
        return new Response(JSON.stringify({ success: false, message: 'Email invalid' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        });
    }
    if (!password || password.length < 6) {
        return new Response(JSON.stringify({ success: false, message: 'Parolă prea scurtă (min 6 caractere)' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        });
    }
    
    // Verifică dacă există
    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ? OR email = ?').bind(username, email).first();
    if (existing) {
        return new Response(JSON.stringify({ success: false, message: 'Utilizator sau email deja existent' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        });
    }
    
    // Hash parolă
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(password));
    const hashedPassword = btoa(String.fromCharCode(...new Uint8Array(hash)));
    
    // Creează utilizator (primul utilizator devine admin)
    const count = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
    const role = count.count === 0 ? 'admin' : 'user';
    
    await env.DB.prepare('INSERT INTO users (username, email, password, gold, xp, level, role) VALUES (?, ?, ?, 100, 0, 1, ?)')
        .bind(username, email, hashedPassword, role).run();
    
    return new Response(JSON.stringify({ success: true, message: 'Cont creat cu succes', isAdmin: role === 'admin' }), {
        status: 201, headers: { 'Content-Type': 'application/json' }
    });
}
