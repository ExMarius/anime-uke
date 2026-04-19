export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // Citim datele trimise de utilizator din formular
    const { username, password } = await request.json();

    // Validare simplă
    if (!username || !password || username.length < 3) {
      return new Response(JSON.stringify({ error: "Date invalide. Username-ul trebuie să aibă minim 3 caractere." }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 1. Generăm un ID unic pentru utilizator
    const userId = crypto.randomUUID();

    // 2. Salvăm în baza de date D1
    // "DB" este numele legăturii pe care o facem în panoul Cloudflare
    await env.DB.prepare(
      "INSERT INTO users (id, username, password_hash, points) VALUES (?, ?, ?, ?)"
    )
    .bind(userId, username, password, 0) // Pentru început salvăm parola simplu, ulterior o securizăm
    .run();

    return new Response(JSON.stringify({ success: true, message: "Cont creat cu succes!" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    // Dacă user-ul există deja, baza de date va da o eroare (pentru că username e UNIQUE)
    return new Response(JSON.stringify({ error: "Utilizatorul există deja sau eroare de bază de date." }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" }
    });
  }
}
