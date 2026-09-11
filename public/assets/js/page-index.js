import { api, renderNav, toast, getSession, safeUrl, genPoster } from './core.js';
import { initChat, openChat } from './chat.js';

// Pagina principala: hero + cautare pe SERVER + grila de serii + chat.
//
// Inainte se incarcau toate seriile odata (pana la 500) si se filtrau in
// browser. La 1000+ serii asta se rupea: API-ul se oprea la 500, deci
// jumatate din catalog era invizibil, si fiecare vizita citea sute de
// randuri din D1. Acum cerem cate o pagina si cautarea se face pe server.

const PER_PAGE = 24;

let allSeries = [];      // seriile incarcate pana acum (toate paginile)
let page = 1;
let query = '';
let sort = 'latest';
let sortsLoaded = false;
let searchTimer = null;

// ---------------- skeleton loading ----------------
function skeletons(n = 10) {
  const grid = document.getElementById('series-grid');
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'sk sk-card';
    el.innerHTML = '<div class="sk sk-poster"></div><div class="sk sk-line"></div><div class="sk sk-line sk-line--s"></div>';
    grid.appendChild(el);
  }
}

function emptyState(text, sub = '') {
  const el = document.createElement('div');
  el.className = 'empty';
  el.style.gridColumn = '1 / -1';
  const icon = document.createElement('div');
  icon.className = 'empty__icon';
  icon.textContent = '🎬';
  const t = document.createElement('div');
  t.textContent = text;
  el.append(icon, t);
  if (sub) {
    const s = document.createElement('p');
    s.className = 'hint';
    s.textContent = sub;
    el.appendChild(s);
  }
  return el;
}

// ---------------- card ----------------
function seriesCard(s) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `/series?id=${encodeURIComponent(s.id)}`;

  const poster = document.createElement('div');
  poster.className = 'poster';

  if (s.cover_image) {
    const img = document.createElement('img');
    img.src = safeUrl(s.cover_image, '');
    img.alt = s.title || 'Poster';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(fallback(s.title)), { once: true });
    poster.appendChild(img);
  } else {
    poster.appendChild(fallback(s.title));
  }

  const status = document.createElement('span');
  status.className = `pill-pos${s.status === 'completed' ? ' pill-pos--ok' : ''}`;
  status.textContent = s.status === 'completed' ? 'Finalizat' : 'În difuzare';
  poster.appendChild(status);

  const count = document.createElement('span');
  count.className = 'pill-count';
  count.textContent = `${s.episode_count ?? 0} EP`;
  poster.appendChild(count);

  const body = document.createElement('div');
  body.className = 'card__body';

  const title = document.createElement('h3');
  title.className = 'card__title';
  title.textContent = s.title || 'Fără titlu';
  body.appendChild(title);

  const bits = [];
  if (s.genre) bits.push(s.genre.split(',')[0].trim());
  if (s.year) bits.push(String(s.year));
  if (bits.length) {
    const meta = document.createElement('p');
    meta.className = 'card__meta';
    meta.textContent = bits.join(' · ');
    body.appendChild(meta);
  }

  if (s.description) {
    const desc = document.createElement('p');
    desc.className = 'card__desc';
    desc.textContent = s.description;
    body.appendChild(desc);
  }

  a.append(poster, body);
  return a;
}

function fallback(title) {
  return genPoster(title);
}

// ---------------- render + cautare ----------------
/** Reseteaza grila si afiseaza tot ce am incarcat pana acum. */
function render() {
  const grid = document.getElementById('series-grid');
  const count = document.getElementById('series-count');
  grid.innerHTML = '';

  if (!allSeries.length) {
    grid.appendChild(emptyState(
      query ? 'Nicio potrivire' : 'Încă nu există serii',
      query ? 'Încearcă alt termen de căutare.' : 'Adaugă prima serie din panoul de administrare.'
    ));
    count.textContent = query ? '0 rezultate' : '';
    return;
  }
  count.textContent = `${allSeries.length} afișate`;
  for (const s of allSeries) grid.appendChild(seriesCard(s));
}

function fillSorts(sorts) {
  if (sortsLoaded) return;
  const sel = document.getElementById('sort-select');
  if (!sel || !sorts?.length) return;
  sel.innerHTML = '';
  for (const o of sorts) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = sort;
  sortsLoaded = true;
}

function setHeroStats(data) {
  const total = data.total;
  const eps = data.total_episodes;
  if (!query && total != null) document.getElementById('stat-series').textContent = total.toLocaleString('ro-RO');
  if (!query && eps != null) document.getElementById('stat-episodes').textContent = Number(eps).toLocaleString('ro-RO');
}

// ---------------- incarcare ----------------
/**
 * @param {boolean} append  true = adauga pagina la ce e deja afisat
 */
async function load({ append = false, silent = false } = {}) {
  const grid = document.getElementById('series-grid');
  if (!append && !silent) skeletons(Math.min(PER_PAGE, 10));

  const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), sort });
  if (query) params.set('q', query);

  const res = await api(`/series?${params}`);

  if (!res.ok) {
    if (!append) {
      grid.innerHTML = '';
      grid.appendChild(emptyState('Nu am putut încărca seriile', res.data?.error || 'Verifică conexiunea și reîncearcă.'));
      document.getElementById('series-count').textContent = '';
    }
    toast(res.data?.error || 'Eroare la încărcarea seriilor', 'err');
    return;
  }

  const data = res.data;
  fillSorts(data.sorts);

  if (!append) {
    allSeries = data.series || [];
  } else {
    // Apararea impotriva duplicatelor: daca intre doua cereri a fost adaugata
    // o serie noua, paginarea se decaleaza si am putea primi acelasi rand de
    // doua ori. Filtram dupa id.
    const have = new Set(allSeries.map((s) => s.id));
    for (const s of data.series || []) if (!have.has(s.id)) allSeries.push(s);
  }

  render();
  setHeroStats(data);

  const wrap = document.getElementById('load-more-wrap');
  const btn = document.getElementById('load-more');
  wrap.hidden = !data.has_more;
  btn.disabled = false;
  btn.textContent = data.total != null
    ? `Încarcă mai multe (${allSeries.length} din ${data.total}${data.total_capped ? '+' : ''})`
    : 'Încarcă mai multe';

  if (!append) {
    const user = await getSession();
    document.getElementById('stat-points').textContent = user ? user.points : '0';
  }
}

/** Cautarea se face pe server, deci resetam paginarea la fiecare termen nou. */
function search(q) {
  query = q.trim();
  page = 1;
  load();
}

// ---------------------------------------------------------------------
// Banner rotativ: o recomandare comuna, schimbata o data la 3 ore.
//
// Fereastra de timp (bucket-ul de 3h) e aceeasi pentru toti utilizatorii,
// deci in intervalul curent toata lumea vede aceeasi recomandare — arata a
// editorial, nu a zar per vizita. Alegerea e determinista din bucket, deci
// nu cerem nimic in plus de la server pentru „randomizarea" itself.
// Inchiderea bannerului se tine minte doar pentru intervalul curent: la
// urmatorul bucket reapare cu alt continut.
// ---------------------------------------------------------------------
const SPOT_WINDOW_MS = 3 * 60 * 60 * 1000;
const SPOT_TAGS = [
  'Recomandarea intervalului', 'De maratonat diseară', 'Ascunsă în catalog',
  'Alegerea comunității', 'Perla neștiută', 'Revăzut și aprobat',
];

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

async function renderSpotlight() {
  const box = document.getElementById('spot-banner');
  if (!box) return;

  const bucket = Math.floor(Date.now() / SPOT_WINDOW_MS);
  try { if (localStorage.getItem(`auk-spot-${bucket}`)) return; } catch { /* mod privat */ }

  // Alegerea se cache-uieste pe bucket in sessionStorage: o a doua vizita in
  // acelasi interval nu mai face cererile catre catalog.
  const cacheKey = `auk-spot-data-${bucket}`;
  let pick = null;
  try { pick = JSON.parse(sessionStorage.getItem(cacheKey) || 'null'); } catch { /* ignora */ }

  if (!pick) {
    const first = await api('/series?per_page=24&page=1');
    if (!first.ok || !first.data?.series?.length) return;
    const pages = Math.max(1, Number(first.data.pages) || 1);
    const page = (hashStr(`spot-page-${bucket}`) % pages) + 1;
    const list = page === 1
      ? first.data.series
      : (await api(`/series?per_page=24&page=${page}`))?.data?.series || [];
    if (!list.length) return;
    pick = list[hashStr(`spot-item-${bucket}`) % list.length];
    try { sessionStorage.setItem(cacheKey, JSON.stringify(pick)); } catch { /* ignora */ }
  }

  document.getElementById('spot-tag').textContent = SPOT_TAGS[hashStr(`spot-tag-${bucket}`) % SPOT_TAGS.length];
  const a = document.getElementById('spot-title');
  a.textContent = pick.title;
  a.href = `/series?id=${encodeURIComponent(pick.id)}`;
  document.getElementById('spot-sub').textContent =
    [pick.genre, pick.year, pick.episode_count ? `${pick.episode_count} ep.` : ''].filter(Boolean).join(' · ');

  const art = document.getElementById('spot-art');
  art.innerHTML = '';
  const cover = safeUrl(pick.cover_image, '');
  if (cover && cover !== '#') {
    const img = document.createElement('img');
    img.src = cover; img.alt = ''; img.loading = 'lazy';
    art.appendChild(img);
  } else {
    art.appendChild(genPoster(pick.title));
  }

  box.hidden = false;
  document.getElementById('spot-close')?.addEventListener('click', () => {
    box.hidden = true;
    try { localStorage.setItem(`auk-spot-${bucket}`, '1'); } catch { /* ignora */ }
  }, { once: true });
}

await renderNav('/');
skeletons(10);
await Promise.all([load(), initChat()]);
renderSpotlight().catch(() => { /* bannerul e decorativ: pagina merge si fara el */ });

// Debounce: fara el, fiecare litera tastata ar insemna un LIKE pe tot
// tabelul de serii — iar cautarea e exact operatia care nu e indexabila.
document.getElementById('search-input')?.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => search(v), 280);
});

document.getElementById('sort-select')?.addEventListener('change', (e) => {
  sort = e.target.value;
  page = 1;
  load();
});

document.getElementById('load-more')?.addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  e.currentTarget.textContent = 'Se încarcă…';
  page++;
  await load({ append: true, silent: true });
});

document.getElementById('hero-chat')?.addEventListener('click', openChat);
