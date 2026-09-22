// =====================================================================
// season.js — tema de sezon a site-ului (globala, setata doar din admin).
//
// Temele de sezon (toamna, Halloween, iarna, Paste) NU sunt in shop si nu
// se pot cumpara; adminul activeaza una pentru toata lumea. La SETARE, toate
// temele personale ACTIVE se reseteaza global (toata lumea vede sezonul);
// ce e cumparat nu se pierde, iar cine nu place sezonul isi alege singur
// alta, care bate sezonul. Rezolvarea se face in GET /api/auth/me.
//
// Citirea e cache-uita in izolat 60s: /auth/me e lovit la fiecare load de
// pagina, fara cache fiecare ar costa o citire D1 in plus.
// =====================================================================
import { SITE_THEMES } from './shop.js';

/** Lista temelor de sezon (pentru admin + validari). */
export function seasonalThemes() {
  return SITE_THEMES.filter((t) => t.seasonal);
}

export function isSeasonalTheme(id) {
  return SITE_THEMES.some((t) => t.seasonal && t.id === id);
}

let cache = { value: null, t: 0 };
const TTL_MS = 60 * 1000;

/** Tema de sezon curenta (id) sau null cand e dezactivata. */
export async function getSeasonalTheme(env) {
  const acum = Date.now();
  if (acum - cache.t < TTL_MS) return cache.value;
  let value = null;
  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'seasonal_theme'").first();
    const v = String(row?.value || '');
    value = isSeasonalTheme(v) ? v : null; // valoare invalida → ignorata
  } catch {
    value = null; // migrarea 0027 neaplicata inca → fara sezon
  }
  cache = { value, t: acum };
  return value;
}

/** Seteaza (sau goleste cu '') tema de sezon. Arunca la id invalid. */
export async function setSeasonalTheme(env, id) {
  const v = String(id || '');
  if (v !== '' && !isSeasonalTheme(v)) throw new Error('Tema de sezon invalida');
  await env.DB.prepare("UPDATE site_settings SET value = ?, updated_at = strftime('%s','now') WHERE key = 'seasonal_theme'").bind(v).run();
  cache = { value: v || null, t: Date.now() };
  return v || null;
}
