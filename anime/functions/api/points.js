export async function onRequestPost(context) {
  const { request, env } = context;
  const { userId, pointsToAdd } = await request.json();

  try {
    // Actualizăm punctele utilizatorului în baza de date
    await env.DB.prepare(
      "UPDATE users SET points = points + ? WHERE id = ?"
    )
    .bind(pointsToAdd, userId)
    .run();

    return new Response(JSON.stringify({ success: true, message: "Puncte adăugate!" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
