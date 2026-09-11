import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { validatePositiveInt } from '../../../lib/validate.js';
import { validateSource, SOURCE_KINDS, KIND_LABELS, KNOWN_PROVIDERS } from '../../../lib/sources.js';
import { logAdminAction } from '../../../lib/audit.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';

// =====================================================================
// /api/admin/episode-sources — gestionarea surselor video ale unui episod.
//
//   GET    ?episode_id=N   toate sursele (inclusiv cele dezactivate)
//   POST   {episode_id,label,kind,url}        adauga o sursa
//   PATCH  {id,label?,kind?,url?,is_active?,sort_order?}   editeaza partial
//   DELETE ?id=N           sterge o sursa
//
// PATCH e partial in mod deliberat: panoul de admin permite bifeaza/debifeaza
// „activ" fara sa retrimita URL-ul. Daca am cere toate campurile, o bifare
// ar putea rescrie accidental URL-ul cu o valoare veche din formular.
// =====================================================================

const MAX_SOURCES = 12;

async function findEpisode(env, episodeId) {
  return env.DB
    .prepare(
      `SELECT e.id, e.episode_number, e.title, s.title AS series_title
       FROM episodes e JOIN anime_series s ON s.id = e.series_id
       WHERE e.id = ?`
    )
    .bind(episodeId)
    .first();
}

/** Descriere lizibila pentru audit: „Ep. 3 din „One Piece" — DoodStream". */
function epLabel(ep, sourceLabel) {
  return `Ep. ${ep.episode_number} din „${ep.series_title}" — ${sourceLabel}`;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  const url = new URL(request.url);

  // ?meta=1 intoarce optiunile de formular (tipuri de sursa + furnizori
  // sugerati). Le servim de pe server ca sa existe UN SINGUR loc unde se
  // defineste lista — altfel panoul de admin si validarea ar deriva.
  if (url.searchParams.get('meta') === '1') {
    return json({
      kinds: SOURCE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
      providers: KNOWN_PROVIDERS,
      max: MAX_SOURCES,
    });
  }

  const episodeId = validatePositiveInt(url.searchParams.get('episode_id'), 'ID-ul episodului');
  if (!episodeId.ok) return errorResponse(400, episodeId.error);

  try {
    const res = await env.DB
      .prepare(
        `SELECT id, episode_id, label, kind, url, sort_order, is_active, created_at
         FROM episode_sources WHERE episode_id = ?
         ORDER BY sort_order ASC, id ASC`
      )
      .bind(episodeId.value)
      .all();

    return json({ sources: res.results || [] });
  } catch (e) {
    console.error('GET /api/admin/episode-sources esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca sursele');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-src:${admin.id}`, 300, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const episodeId = validatePositiveInt(body.episode_id, 'ID-ul episodului');
  if (!episodeId.ok) return errorResponse(400, episodeId.error);

  const v = validateSource(body);
  if (!v.ok) return errorResponse(400, v.error);

  try {
    const ep = await findEpisode(env, episodeId.value);
    if (!ep) return errorResponse(404, 'Episodul nu există');

    const countRes = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM episode_sources WHERE episode_id = ?')
      .bind(episodeId.value)
      .first();
    if ((countRes?.n ?? 0) >= MAX_SOURCES) {
      return errorResponse(400, `Maximum ${MAX_SOURCES} surse per episod`);
    }

    // Noua sursa merge la sfarsitul listei; adminul o poate muta dupa aceea.
    const order = countRes?.n ?? 0;

    const res = await env.DB
      .prepare(
        `INSERT INTO episode_sources (episode_id, label, kind, url, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
      .bind(episodeId.value, v.value.label, v.value.kind, v.value.url, order)
      .run();

    const id = res.meta?.last_row_id;
    await logAdminAction(env, admin, 'add_source', 'episode', episodeId.value,
      epLabel(ep, `${v.value.label} (${v.value.kind})`));

    return json({ success: true, id, source: { id, ...v.value, sort_order: order, is_active: 1 } },
      { status: 201 });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/UNIQUE/i.test(msg)) {
      return errorResponse(409, 'Sursa asta există deja la episod');
    }
    console.error('POST /api/admin/episode-sources esuat:', msg);
    return errorResponse(500, 'Nu am putut adăuga sursa');
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-src:${admin.id}`, 300, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const id = validatePositiveInt(body.id, 'ID-ul sursei');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const existing = await env.DB
      .prepare('SELECT id, episode_id, label, kind, url, sort_order, is_active FROM episode_sources WHERE id = ?')
      .bind(id.value)
      .first();
    if (!existing) return errorResponse(404, 'Sursa nu există');

    const ep = await findEpisode(env, existing.episode_id);
    if (!ep) return errorResponse(404, 'Episodul nu mai există');

    // Construim campurile de actualizat doar din ce a trimis clientul.
    const updates = {};
    let label = existing.label;
    let kind = existing.kind;
    let url = existing.url;

    // kind/url/label se valideaza impreuna: eticheta derivata din domeniu
    // depinde de URL, iar tipul „file" impune o extensie video.
    if (body.url !== undefined || body.kind !== undefined || body.label !== undefined) {
      const v = validateSource({
        url: body.url !== undefined ? body.url : url,
        kind: body.kind !== undefined ? body.kind : kind,
        label: body.label !== undefined ? body.label : label,
      });
      if (!v.ok) return errorResponse(400, v.error);
      if (v.value.url !== url) { updates.url = v.value.url; url = v.value.url; }
      if (v.value.kind !== kind) { updates.kind = v.value.kind; kind = v.value.kind; }
      if (v.value.label !== label) { updates.label = v.value.label; label = v.value.label; }
    }

    if (body.is_active !== undefined) {
      const active = body.is_active ? 1 : 0;
      if (active !== existing.is_active) updates.is_active = active;
    }

    if (body.sort_order !== undefined) {
      const order = Number(body.sort_order);
      if (!Number.isInteger(order) || order < 0 || order > 999) {
        return errorResponse(400, 'Ordine invalidă');
      }
      if (order !== existing.sort_order) updates.sort_order = order;
    }

    if (!Object.keys(updates).length) {
      return json({ success: true, unchanged: true, source: existing });
    }

    const sets = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    await env.DB
      .prepare(`UPDATE episode_sources SET ${sets} WHERE id = ?`)
      .bind(...Object.values(updates), id.value)
      .run();

    const changed = Object.keys(updates).join(', ');
    await logAdminAction(env, admin, 'edit_source', 'episode', existing.episode_id,
      `${epLabel(ep, label)} — modificat: ${changed}`);

    return json({ success: true, source: { ...existing, ...updates } });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/UNIQUE/i.test(msg)) return errorResponse(409, 'Sursa asta există deja la episod');
    console.error('PATCH /api/admin/episode-sources esuat:', msg);
    return errorResponse(500, 'Nu am putut actualiza sursa');
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const url = new URL(request.url);
  const id = validatePositiveInt(url.searchParams.get('id'), 'ID-ul sursei');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const existing = await env.DB
      .prepare('SELECT id, episode_id, label, kind, url FROM episode_sources WHERE id = ?')
      .bind(id.value)
      .first();
    if (!existing) return errorResponse(404, 'Sursa nu există');

    const ep = await findEpisode(env, existing.episode_id);

    await env.DB.prepare('DELETE FROM episode_sources WHERE id = ?').bind(id.value).run();

    if (ep) {
      await logAdminAction(env, admin, 'delete_source', 'episode', existing.episode_id,
        epLabel(ep, existing.label));
    }

    return json({ success: true });
  } catch (e) {
    console.error('DELETE /api/admin/episode-sources esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut șterge sursa');
  }
}
