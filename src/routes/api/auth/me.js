import { json } from '../../../lib/http.js';
import { getSessionUser, publicUser } from '../../../lib/session.js';
import { getSeasonalTheme } from '../../../lib/season.js';

// =====================================================================
// /api/auth/me — singura sursa de adevar despre utilizatorul curent.
//
// In v1 nav-ul citea din localStorage si dintr-un cookie HttpOnly pe care
// JS nu-l poate citi, deci utilizatorul logat aparea tot ca „neautentificat".
// Acum front-ul intreaba serverul, care verifica JWT + is_banned din D1.
//
// Cost: 1 citire D1 per apel. Clientul il cheama o data la load de pagina.
// =====================================================================

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getSessionUser(request, env);

  // Tema de sezon: utilizatorii fara tema personala (active_theme NULL) o
  // mostenesc global; cei cu tema personala nu sunt afectati.
  if (user && !user.active_theme) {
    const sezon = await getSeasonalTheme(env);
    if (sezon) return json({ user: publicUser({ ...user, active_theme: sezon }) });
  }

  // 200 chiar si pentru vizitatori — returnam { user: null }.
  // Asa clientul nu trebuie sa trateze 401 ca pe o eroare la fiecare load.
  return json({ user: publicUser(user) });
}
