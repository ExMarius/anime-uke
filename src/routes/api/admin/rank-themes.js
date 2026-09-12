// /api/admin/rank-themes — adminul adauga teme de grade din orice serie
// („sa mai putem adauga de la alte serii chestii de genu”) si le sterge
// pe cele custom. Temele builtin nu se sterg: oamenii au grade in ele.
import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { validateTiers, loadRankThemes, FALLBACK_BUILTIN } from '../../../lib/ranks.js';
import { logAdminAction } from '../../../lib/audit.js';

const BUILTIN = new Set(FALLBACK_BUILTIN.map((t) => t.slug));

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const slug = String(body?.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  const title = String(body?.title || '').trim().slice(0, 60);
  if (!slug || !title) return errorResponse(400, 'Slug și titlu obligatorii');
  const v = validateTiers(body?.tiers);
  if (!v.ok) return errorResponse(400, v.error);
  // o tema stearsa anterior nu trebuie sa invalideze gradele oamenilor:
  // slug-urile builtin sunt rezervate
  if (BUILTIN.has(slug) && !(await env.DB.prepare('SELECT slug FROM rank_themes WHERE slug = ?').bind(slug).first())) {
    return errorResponse(400, 'Slug rezervat de o temă builtin');
  }

  await env.DB
    .prepare(
      `INSERT INTO rank_themes (slug, title, tiers) VALUES (?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers`
    )
    .bind(slug, title, JSON.stringify(v.value))
    .run();
  await logAdminAction(env, gate.user, 'upsert_rank_theme', 'system', 0, `${slug} (${v.value.length} trepte)`);
  const themes = await loadRankThemes(env);
  return json({ success: true, themes });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const slug = String(new URL(request.url).searchParams.get('slug') || '').trim();
  if (!slug) return errorResponse(400, 'Slug obligatoriu');
  if (BUILTIN.has(slug)) return errorResponse(400, 'Temele builtin nu se șterg');
  const res = await env.DB.prepare('DELETE FROM rank_themes WHERE slug = ?').bind(slug).run();
  // userii ramasi pe tema stearsa cad frumos pe prima tema disponibila
  await env.DB.prepare(`UPDATE users SET rank_theme = 'naruto' WHERE rank_theme = ?`).bind(slug).run();
  await logAdminAction(env, gate.user, 'delete_rank_theme', 'system', 0, slug);
  const themes = await loadRankThemes(env);
  return json({ success: true, deleted: res.meta?.changes || 0, themes });
}
