// /api/admin/ads — configurarea monetizării din panoul admin (tab „Monetizare").
//
//   GET  → configurația completă (toate sloturile, inclusiv cele oprite)
//   POST → validează strict și salvează în site_settings (cheia 'ads')
//
// De ce sloturi structurate (URL + dimensiuni) și nu HTML liber: vezi
// antetul din src/lib/settings.js — CSP-ul strict oricum ar bloca
// <script>-urile inline ale rețelelor, iar HTML liber salvat din admin
// ar fi XSS stocat dacă un cont de admin e compromis.
import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { logAdminAction } from '../../../lib/audit.js';
import { getAdsConfig, validateAdsConfig, setSetting, AD_SLOTS, AD_TYPES } from '../../../lib/settings.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  const config = await getAdsConfig(env);
  return json({ config, slots: AD_SLOTS, types: AD_TYPES });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const v = validateAdsConfig(body?.config);
  if (!v.ok) return errorResponse(400, v.error);

  await setSetting(env, 'ads', JSON.stringify(v.value));
  const activeSlots = Object.entries(v.value.slots).filter(([, s]) => s.enabled).map(([n]) => n);
  await logAdminAction(
    env, gate.user, 'update_ads', 'system', 0,
    v.value.enabled ? `pornit (sloturi: ${activeSlots.join(', ') || 'niciunul'})` : 'oprit'
  );
  return json({ success: true, config: v.value });
}
