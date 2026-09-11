import { api, renderNav, toast, getSession, safeUrl } from './core.js';
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
    img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
    poster.appendChild(img);
  } else {
    poster.appendChild(fallback());
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

function fallback() {
  const el = document.createElement('div');
  el.className = 'poster__fallback';
  el.textContent = '鬼';
  el.setAttribute('aria-hidden', 'true');
  return el;
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
    ? `Încarcă mai multe (${allSeries.length} din ${data.total})`
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

await renderNav('/');
skeletons(10);
await Promise.all([load(), initChat()]);

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
