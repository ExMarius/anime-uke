// GET /api/ads — configurația publică a reclamelor, pentru randare în pagini.
//
// E endpoint PUBLIC (vizitatorii fără cont văd și ei reclame — ei sunt
// majoritatea traficului), dar respectă hide_for_staff: adminii și staff-ul
// nu primesc reclame, ca să nu-și genereze singuri impresii/clickuri
// (motiv clasic de ban la rețelele de reclame).
//
// Răspunsul conține DOAR sloturile active, cu strictul necesar randării.
// Configurația completă (inclusiv sloturile oprite) e la /api/admin/ads.
import { json } from '../../lib/http.js';
import { getSessionUser } from '../../lib/session.js';
import { getAdsConfig } from '../../lib/settings.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const cfg = await getAdsConfig(env);

  const off = { enabled: false, slots: [] };
  if (!cfg.enabled) return json(off, { headers: { 'cache-control': 'private, max-age=300' } });

  if (cfg.hide_for_staff) {
    // getSessionUser întoarce null pentru vizitatori — pentru ei nu costă
    // nicio citire D1 în plus (nu au cookie de sesiune).
    const user = await getSessionUser(request, env);
    if (user && (user.is_admin || String(user.staff_role || '') !== '')) {
      return json(off, { headers: { 'cache-control': 'private, max-age=300' } });
    }
  }

  const slots = [];
  for (const [name, s] of Object.entries(cfg.slots)) {
    if (!s.enabled || !s.url) continue;
    slots.push({ name, type: s.type, url: s.url, width: s.width, height: s.height, label: s.label });
  }
  return json(
    { enabled: slots.length > 0, slots },
    { headers: { 'cache-control': 'private, max-age=300' } }
  );
}
