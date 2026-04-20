// src/admin.js
import { generateId } from './auth.js';

export async function handleAddSeries(request, env) {
  try {
    const { title, description, cover_image, status } = await request.json();
    
    if (!title) {
      return new Response(JSON.stringify({ error: 'Titlul este obligatoriu.' }), { status: 400 });
    }
    
    const id = generateId();
    
    await env.DB.prepare(
      `INSERT INTO anime_series (id, title, description, cover_image, status) 
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, title, description || '', cover_image || '', status || 'ongoing').run();
    
    return new Response(JSON.stringify({ success: true, seriesId: id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Add series error:', error);
    return new Response(JSON.stringify({ error: 'Eroare internă.' }), { status: 500 });
  }
}

export async function handleAddEpisode(request, env) {
  try {
    const { series_id, episode_number, title, doodstream_url } = await request.json();
    
    if (!series_id || !episode_number || !doodstream_url) {
      return new Response(JSON.stringify({ error: 'Câmpuri obligatorii lipsă.' }), { status: 400 });
    }
    
    const id = generateId();
    
    await env.DB.prepare(
      `INSERT INTO episodes (id, series_id, episode_number, title, doodstream_url) 
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, series_id, episode_number, title || `Episodul ${episode_number}`, doodstream_url).run();
    
    return new Response(JSON.stringify({ success: true, episodeId: id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Add episode error:', error);
    return new Response(JSON.stringify({ error: 'Eroare internă.' }), { status: 500 });
  }
}

export async function handleDeleteEpisode(request, env) {
  try {
    const { episodeId } = await request.json();
    
    await env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(episodeId).run();
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Delete episode error:', error);
    return new Response(JSON.stringify({ error: 'Eroare internă.' }), { status: 500 });
  }
}
