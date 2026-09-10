import { errorResponse } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';

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
  const url = new URL(request.url);
  url.searchParams.set('u', JSON.stringify({ id: user.id, username: user.username }));

  return stub.fetch(new Request(url.toString(), request));
}
