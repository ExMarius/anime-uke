// src/episodes.js
import { verifyAuth } from './auth.js';

export async function handleGetSeries(env) {
  const series = await env.DB.prepare(
    'SELECT * FROM anime_series ORDER BY created_at DESC'
  ).all();
  
  return new Response(JSON.stringify({ series: series.results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function handleGetSeriesById(request, env) {
  const id = request.url.split('/').pop();
  
  const series = await env.DB.prepare(
    'SELECT * FROM anime_series WHERE id = ?'
  ).bind(id).first();
  
  if (!series) {
    return new Response(JSON.stringify({ error: 'Serie negăsită' }), { status: 404 });
  }
  
  const episodes = await env.DB.prepare(
    'SELECT * FROM episodes WHERE series_id = ? ORDER BY episode_number ASC'
  ).bind(id).all();
  
  return new Response(JSON.stringify({ series, episodes: episodes.results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function handleGetEpisodes(request, env) {
  const url = new URL(request.url);
  const seriesId = url.searchParams.get('series_id');
  
  let query = 'SELECT * FROM episodes ORDER BY created_at DESC LIMIT 20';
  let params = [];
  
  if (seriesId) {
    query = 'SELECT * FROM episodes WHERE series_id = ? ORDER BY episode_number ASC';
    params = [seriesId];
  }
  
  const episodes = await env.DB.prepare(query).bind(...params).all();
  
  return new Response(JSON.stringify({ episodes: episodes.results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function handleGetEpisode(request, env) {
  const id = request.url.split('/').pop();
  
  const episode = await env.DB.prepare(
    `SELECT e.*, s.title as series_title 
     FROM episodes e 
     JOIN anime_series s ON e.series_id = s.id 
     WHERE e.id = ?`
  ).bind(id).first();
  
  if (!episode) {
    return new Response(JSON.stringify({ error: 'Episod negăsit' }), { status: 404 });
  }
  
  return new Response(JSON.stringify({ episode }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function handleMarkWatched(request, env) {
  const user = await verifyAuth(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), { status: 401 });
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
  
  // Obține punctele actualizate
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

export async function handleAddView(request, env) {
  const { episodeId } = await request.json();
  
  await env.DB.prepare(
    'UPDATE episodes SET views = views + 1 WHERE id = ?'
  ).bind(episodeId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
