import { sanitizeText } from './http.js';

// =====================================================================
// Noutățile site-ului (tabelul `news`, migrarea 0034).
//
// Regula de buget care a dictat forma: scrierile în D1 sunt resursa scumpă
// (100.000/zi pe planul gratuit), deci o știre NU are voie să coste un
// round-trip separat. `newsStmt()` întoarce un statement gata de pus în
// batch-ul care există deja la locul evenimentului (crearea unei serii,
// schimbarea sezonului). Zero cereri în plus, aceeași tranzacție: dacă
// evenimentul se anulează, nici știrea nu rămâne.
//
// Ce NU intră aici: episoadele. Prima pagină are deja lista lor („Ultimele
// episoade adăugate", /api/recent), iar un rând per episod ar îngropa
// anunțurile reale ale administrației.
// =====================================================================

export const NEWS_KINDS = ['serie', 'sezon', 'anunt'];

export const MAX_NEWS = {
  title: 140,
  body: 500,
  link: 200,
};

/** Doar linkuri interne: o știre nu are voie să trimită în afara site-ului. */
export function sanitizeNewsLink(value) {
  const raw = sanitizeText(value, MAX_NEWS.link).trim();
  if (!raw) return '';
  // Respinge „//evil.tld", „https://…", „javascript:…" și orice nu începe cu /.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  return raw;
}

/**
 * Statement-ul de inserare a unei știri, pentru `env.DB.batch([...])`.
 * Întoarce null dacă titlul e gol — apelantul poate filtra cu .filter(Boolean),
 * exact ca la `bumpMetaStmt`.
 */
export function newsStmt(env, { kind, title, body = '', link = '', authorId = null } = {}) {
  const k = NEWS_KINDS.includes(kind) ? kind : 'anunt';
  const t = sanitizeText(title, MAX_NEWS.title).trim();
  if (!t) return null;
  return env.DB
    .prepare('INSERT INTO news (kind, title, body, link, author_id) VALUES (?, ?, ?, ?, ?)')
    .bind(k, t, sanitizeText(body, MAX_NEWS.body).trim(), sanitizeNewsLink(link), authorId);
}

/** Validare pentru anunțul scris manual din admin. */
export function validateAnnouncement(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Cerere invalidă' };
  }
  const title = sanitizeText(body.title, MAX_NEWS.title).trim();
  if (title.length < 3) return { ok: false, error: 'Titlul anunțului e prea scurt (minim 3 caractere).' };
  return {
    ok: true,
    value: {
      title,
      body: sanitizeText(body.body, MAX_NEWS.body).trim(),
      link: sanitizeNewsLink(body.link),
    },
  };
}
