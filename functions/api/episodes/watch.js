export async function onRequest(context) {
  const { request, env } = context;
  
  // Verifică session-ul
  const cookie = request.headers.get('Cookie') || '';
  const sessionMatch = cookie.match(/session=([^;]+)/);
  
  if (!sessionMatch) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Pentru demo, ia primul user (în realitate, legi session-ul de user)
  const user = await env.DB.prepare(
    'SELECT id, username, points FROM users LIMIT 1'
  ).first();
  
  if (!user) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const { episodeId } = await request.json();
  
  // Verifică dacă a mai vizionat
  const existing = await env.DB.prepare(
    'SELECT id FROM watched_history WHERE user_id = ? AND episode_id = ?'
  ).bind(user.id, episodeId).first();
  
  if (existing) {
    return new Response(JSON.stringify({ error: 'Episod deja vizionat.', alreadyWatched: true }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Adaugă vizionarea și punctele
  await env.DB.prepare(
    'INSERT INTO watched_history (id, user_id, episode_id, points_awarded) VALUES (?, ?, ?, 10)'
  ).bind(crypto.randomUUID(), user.id, episodeId).run();
  
  await env.DB.prepare(
    'UPDATE users SET points = points + 10 WHERE id = ?'
  ).bind(user.id).run();
  
  const updatedUser = await env.DB.prepare(
    'SELECT points FROM users WHERE id = ?'
  ).bind(user.id).first();
  
  return new Response(JSON.stringify({ 
    success: true, 
    points: 10,
    totalPoints: updatedUser.points
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
