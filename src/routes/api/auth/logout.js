import { json, clearAuthCookie } from '../../../lib/http.js';

// =====================================================================
// Logout — in v1 clientul incerca `document.cookie = "token=; Max-Age=0"`,
// ceea ce NU poate sterge un cookie HttpOnly. Utilizatorul ramanea logat
// dupa ce apasa Logout. Corect: serverul sterge cookie-ul prin Set-Cookie.
//
// Tokenul JWT ramane tehnic valid pana la expirare, dar fara cookie nu mai
// poate fi folosit. Daca vrei revocare dura, ar trebui o lista neagra in D1
// (costa o citire in plus per request) — pentru acest proiect nu e necesar.
// =====================================================================

export async function onRequestPost(context) {
  return json({ success: true }, { headers: { 'Set-Cookie': clearAuthCookie() } });
}

export function onRequestGet() {
  return new Response('Method not allowed', { status: 405 });
}
