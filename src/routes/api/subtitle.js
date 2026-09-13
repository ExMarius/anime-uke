// GET /api/subtitle?episode_id=N — proxy pentru subtitrarea .vtt
//
// De ce proxy: un fisier .vtt gazduit pe ALT domeniu fara header-e CORS
// esueaza SILENTIOS in <track> — browserul refuza raspunsul si nu vezi
// nicio eroare. Servind subtitrarea prin originul nostru, problema dispare
// pentru orice sursa (relativa /assets/subs/… sau https externa).
// Limitam la 2 MB si verificam magia WEBVTT ca sa nu proxym gunoi.
import { json, errorResponse } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { validatePositiveInt } from '../../lib/validate.js';

const MAX_BYTES = 2 * 1024 * 1024;

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const url = new URL(request.url);
  const id = validatePositiveInt(url.searchParams.get('episode_id'), 'Episodul');
  if (!id.ok) return errorResponse(400, id.error);

  const ep = await env.DB
    .prepare('SELECT subtitle_url FROM episodes WHERE id = ?')
    .bind(id.value)
    .first();
  const sub = String(ep?.subtitle_url || '').trim();
  if (!ep) return errorResponse(404, 'Episodul nu există');
  if (!sub) return errorResponse(404, 'Episodul nu are subtitrare');

  const target = new URL(sub, request.url); // relative → originul nostru
  let res;
  try {
    res = await fetch(target.toString(), {
      redirect: 'follow',
      headers: { 'accept': 'text/vtt, text/plain;q=0.9' },
      cf: { cacheTtl: 3600 },
    });
  } catch {
    return errorResponse(502, 'Nu am putut aduce subtitrarea');
  }
  if (!res.ok) return errorResponse(502, 'Sursa de subtitrare nu răspunde');

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return errorResponse(502, 'Subtitrarea e prea mare');
  const text = new TextDecoder().decode(buf).trimStart();
  if (!text.startsWith('WEBVTT')) return errorResponse(502, 'Fișierul nu pare WebVTT');

  return new Response(text, {
    headers: {
      'content-type': 'text/vtt; charset=utf-8',
      'cache-control': 'private, max-age=600',
    },
  });
}
