// GET /api/ranks — temele de grade + gradul propriu, pentru selectorul
// din profil si pentru preview-uri. O singura citire D1.
import { json } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { identity, loadRankThemes } from '../../lib/ranks.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const themes = await loadRankThemes(env);
  return json({ themes, me: identity(gate.user, themes) });
}
