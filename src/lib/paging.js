// =====================================================================
// Paginare si cautare pentru listele de serii.
//
// De ce exista acest modul: la 1000+ serii, `LIMIT 500` nu mai functioneaza
// (jumatate din serii nu apar deloc), iar un COUNT(*) pe tot tabelul la
// fiecare vizualizare ar consuma intreaga cota gratuita D1 de randuri citite.
// =====================================================================

/** Numarul maxim de elemente pe o pagina. Peste asta un raspuns devine lent. */
export const MAX_PER_PAGE = 60;
export const DEFAULT_PER_PAGE = 24;

/**
 * Episoadele au propria limita: un card de episod e mult mai mic decat un
 * card de serie, deci incap mai multe pe ecran, dar 2000 dintr-oodata (cat
 * cerea vechiul LIMIT) inseamna ~1100 de randuri citite la fiecare vizita a
 * unei serii lungi. La 1000 DAU asta ar manca singur cateva procente bune
 * din cota gratuita de 5M randuri/zi.
 */
export const MAX_EPISODES_PER_PAGE = 200;
export const DEFAULT_EPISODES_PER_PAGE = 100;

/**
 * Extrage page/per_page din URL, cu limite sanatoase.
 * Valorile absurde (page=999999, per_page=100000) sunt taiate aici, nu in
 * interogare — altfel un client obraznic ar putea cere un offset urias.
 */
export function parsePaging(url, defaultPerPage = DEFAULT_PER_PAGE, maxPerPage = MAX_PER_PAGE) {
  const rawPage = Number(url.searchParams.get('page') || 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1;

  const rawPer = Number(url.searchParams.get('per_page') || defaultPerPage);
  const perPage = Number.isInteger(rawPer) && rawPer > 0
    ? Math.min(rawPer, maxPerPage)
    : defaultPerPage;

  return { page, perPage, offset: (page - 1) * perPage };
}

/**
 * Escape pentru LIKE. Fara asta, un utilizator care cauta „100%" ar primi
 * toate randurile, iar „_" ar functiona ca wildcard — adica textul cautat
// ar fi interpretat ca sablon, nu ca literal.
 */
export function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Curata termenul de cautare: trim, colapsare de spatii, limita de lungime. */
export function parseQuery(url, maxLen = 60) {
  const q = String(url.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
  return q.slice(0, maxLen);
}

const SORTS = {
  latest:   { sql: 's.created_at DESC, s.id DESC', label: 'Cele mai noi' },
  oldest:   { sql: 's.created_at ASC, s.id ASC',   label: 'Cele mai vechi' },
  title:    { sql: 's.title ASC, s.id ASC',        label: 'Titlu (A–Z)' },
  episodes: { sql: 's.episode_count DESC, s.id DESC', label: 'Cele mai multe episoade' },
  // Sortarea „cele mai bine notate" citește DOAR indexul construit în 0028
  // (idx_series_rating pe rating_avg/rating_count), deci nu atinge rândul
  // seriei și nu costă o sortare a catalogului. Fără filtrarea seriilor
  // fără voturi ar apărea o grămadă de serii cu 0 stele la început.
  rating:   { sql: '(s.rating_count > 0) DESC, s.rating_avg DESC, s.rating_count DESC, s.id DESC', label: 'Cele mai bine notate' },
};

export const SORT_KEYS = Object.keys(SORTS);

/** Intoarce coloana de sortare; cade pe „latest" pentru orice valoare necunoscuta. */
export function parseSort(url, fallback = 'latest') {
  const raw = String(url.searchParams.get('sort') || fallback);
  return SORTS[raw] ? raw : (SORTS[fallback] ? fallback : 'latest');
}

export function sortSql(key) {
  return (SORTS[key] || SORTS.latest).sql;
}

export function sortOptions() {
  return SORT_KEYS.map((k) => ({ value: k, label: SORTS[k].label }));
}

/**
 * Citeste un contor din site_meta. O singura rand — de o mie de ori mai
 * ieftin decat COUNT(*) pe tabelul de serii.
 */
export async function readMeta(env, key, fallback = 0) {
  try {
    const row = await env.DB.prepare('SELECT value FROM site_meta WHERE key = ?').bind(key).first();
    return row?.value ?? fallback;
  } catch (e) {
    // Meta e o optimizare, nu o dependenta critica: daca lipseste, intoarcem
    // fallback-ul in loc sa picam tot request-ul.
    console.error('readMeta esuat pentru', key, ':', e?.message || e);
    return fallback;
  }
}

/** Ajusteaza un contor din site_meta (delta poate fi negativa). */
export function bumpMetaStmt(env, key, delta) {
  if (!delta) return null;
  return env.DB
    .prepare(
      `INSERT INTO site_meta (key, value) VALUES (?, MAX(0, ?))
       ON CONFLICT(key) DO UPDATE SET value = MAX(0, value + ?)`
    )
    .bind(key, delta, delta);
}

/**
 * Statement-ele pentru ambele contoare deodata, gata de pus intr-un batch.
 * MAX(0, …) impiedica un numar negativ daca un delete se executa de doua ori.
 */
export function counterStmts(env, { series = 0, episodes = 0 } = {}) {
  return [bumpMetaStmt(env, 'series_total', series), bumpMetaStmt(env, 'episodes_total', episodes)]
    .filter(Boolean);
}
