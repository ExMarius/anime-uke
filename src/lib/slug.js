// =====================================================================
// Slug-uri pentru URL-uri de catalog: „Acțiune, Aventură" → „actiune".
//
// DE CE EXISTĂ: filtrarea pe gen trăia doar în query string (`/?gen=Acțiune`).
// Google tratează paginile cu parametri drept variante ale aceleiași pagini
// și rareori le indexează separat — deci nu aveam nicio pagină de aterizare
// pentru „anime acțiune subtitrat în română", exact interogarea după care ne
// caută lumea. Cu `/gen/actiune` fiecare gen devine o pagină reală, cu titlu,
// descriere, date structurate și loc în sitemap.
//
// Diacriticele se pierd intenționat: URL-urile cu „ț"/„ă" ajung procent-
// codate (%C8%9B), arată rupt când sunt copiate și se potrivesc mai slab cu
// felul în care oamenii scriu în căutare (fără diacritice, de cele mai multe ori).
// =====================================================================

/** Corespondența diacritice → ASCII (română + câteva frecvente). */
const DIACRITICE = {
  ă: 'a', â: 'a', á: 'a', à: 'a', ä: 'a',
  î: 'i', í: 'i', ì: 'i', ï: 'i',
  ș: 's', ş: 's', š: 's',
  ț: 't', ţ: 't',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ñ: 'n', ç: 'c',
};

/**
 * Text → slug sigur pentru URL: litere mici ASCII, cifre și cratime.
 * Întoarce '' pentru orice nu poate deveni un slug util (apelantul decide).
 */
export function slugify(value) {
  const jos = String(value ?? '').toLowerCase().trim();
  let out = '';
  for (const ch of jos) {
    const map = DIACRITICE[ch];
    if (map) out += map;
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** Genul din baza de date care corespunde unui slug din URL (sau null). */
export function genreFromSlug(genuri, slug) {
  const cautat = slugify(slug);
  if (!cautat) return null;
  return (genuri || []).find((g) => slugify(g) === cautat) || null;
}
