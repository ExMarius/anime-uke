// functions/api/register.js
// Acest API rulează la https://anime-uke.pages.dev/api/register

export async function onRequest({ request, env }) {
  // Verificăm că e cerere de tip POST
  if (request.method !== 'POST') {
    return Response.json({ error: 'Folosește POST pentru înregistrare' }, { status: 405 });
  }
  
  try {
    // Extragem datele trimise de utilizator
    const { username, email, password } = await request.json();
    
    // Transformăm parola în hash (SHA-256)
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(password));
    const password_hash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Salvăm utilizatorul în baza de date D1
    const result = await env.DB.prepare(
      `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`
    ).bind(username, email, password_hash).run();
    
    // Răspundem cu succes
    return Response.json({ success: true, userId: result.meta.last_row_id });
    
  } catch (error) {
    return Response.json({ error: 'Username sau email deja folosit' }, { status: 400 });
  }
}
