import { errorResponse } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { identity, loadRankThemes } from '../lib/ranks.js';

// =====================================================================
// /chat — upgrade WebSocket catre ChatDO.
//
// DIFERENTA CRITICA vs. v1: autentificarea se face AICI, inainte de
// upgrade, din cookie-ul HttpOnly. In v1 oricine putea deschide socket-ul
// si trimite `username`-ul pe care il voia — deci impersonarea era triviala
// (puteai scrie in chat ca adminul). Acum username-ul vine din JWT/DB si
// clientul nu il poate falsifica.
//
// Cerinta din spec e respectata: doar utilizatorii logati pot intra in chat.
// Un utilizator banat e respins (getSessionUser verifica is_banned).
// =====================================================================

export async function onRequest(context) {
  const { request, env } = context;

  if (request.headers.get('Upgrade') !== 'websocket') {
    // Fallback util: permite clientului sa interogheze cine e online
    // fara sa deschida un socket.
    const url = new URL(request.url);
    if (url.searchParams.get('state') === 'online') {
      const stub = env.CHAT.get(env.CHAT.idFromName('global-chat'));
      return stub.fetch('https://chat.internal/state');
    }
    return errorResponse(400, 'Acest endpoint acceptă doar conexiuni WebSocket');
  }

  const user = await getSessionUser(request, env);
  if (!user) {
    return errorResponse(401, 'Trebuie să fii autentificat ca să intri în chat');
  }

  const stub = env.CHAT.get(env.CHAT.idFromName('global-chat'));

  // Pasa identitatea VERIFICATA catre DO. DO-ul are incredere in acest
  // parametru pentru ca singura cale de acces e prin aceasta functie.
  // Gradul + rolul de staff se rezolva AICI (din D1, la conectare), ca DO-ul
  // sa le broadcast-uiasca fara sa citeasca baza la fiecare mesaj. Clientul
  // nu poate falsifica nimic: tot lantul vine din sesiunea HttpOnly.
  const themes = await loadRankThemes(env);
  const me = identity(user, themes);

  // Cosmeticele din shop merg atasate la handshake (o citire indexata),
  // nu recitite la fiecare mesaj — la fel ca rank-urile.
  const items = await env.DB
    .prepare(`SELECT item_id FROM user_items WHERE user_id = ? AND qty > 0 AND item_id IN ('name_gold', 'flair_supporter')`)
    .bind(user.id)
    .all();
  const owned = new Set((items.results || []).map((r) => r.item_id));

  // Avatarul (URL, poate fi GIF animat) vine o data la connect, la fel ca
  // rank-urile si cosmeticele: o citire indexata per conectare, zero per mesaj.
  const prof = await env.DB
    .prepare('SELECT avatar_url FROM user_profiles WHERE user_id = ?')
    .bind(user.id)
    .first();

  const url = new URL(request.url);
  url.searchParams.set('u', JSON.stringify({
    id: user.id, username: user.username,
    rank_label: me.rank.label, rank_icon: me.rank.icon, staff_role: me.staff,
    flair: owned.has('flair_supporter') ? '💎' : '',
    name_gold: owned.has('name_gold') ? 1 : 0,
    avatar: prof?.avatar_url || '',
  }));

  return stub.fetch(new Request(url.toString(), request));
}
