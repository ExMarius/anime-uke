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

// Hero banner: arta anime full-bleed sus de tot. Fereastra de 3 ore e
// comuna tuturor (recomandare editoriala), iar butonul „Alt anime” adauga
// un salt aleator per vizita peste bucket, ca sa poti da mai departe pana
// gasesti ceva pe placul tau. Alegerea e determinista pe (bucket, salt),
// deci shuffle-ul nu loveste serverul de fiecare data (cache in sessionStorage).
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

function spotSalt() {
  try { return sessionStorage.getItem('auk-spot-salt') || ''; } catch { return ''; }
}

/** Arta de rezervă pentru hero: gradient cinematic din titlu + initiala
 *  mare, ca un poster de anime fără imagine oficială. */
function genHeroArt(title) {
  const t = String(title || '').trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const el = document.createElement('div');
  el.className = 'hban__bg-gen';
  el.style.background = [
    `radial-gradient(120% 90% at 85% 10%, hsl(${hue} 70% 34% / .85), transparent 60%)`,
    `radial-gradient(90% 80% at 10% 90%, hsl(${(hue + 40) % 360} 75% 26% / .9), transparent 65%)`,
    `radial-gradient(60% 60% at 50% 50%, hsl(${(hue + 320) % 360} 60% 18% / .8), transparent 70%)`,
    `linear-gradient(160deg, hsl(${hue} 45% 16%), hsl(${(hue + 300) % 360} 55% 7%))`,
  ].join(', ');
  const kanji = document.createElement('span');
  kanji.className = 'hban__bg-kanji';
  kanji.textContent = (t.split(/\s+/)[0]?.[0] || '鬼').toUpperCase();
  el.appendChild(kanji);
  return el;
}

async function pickSpotSeries(salt) {
  const bucket = Math.floor(Date.now() / SPOT_WINDOW_MS);
  const cacheKey = `auk-spot-data-${bucket}-${salt}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached) return cached;
  } catch { /* ignora */ }

  const first = await api('/series?per_page=24&page=1');
  if (!first.ok || !first.data?.series?.length) return null;
  const pages = Math.max(1, Number(first.data.pages) || 1);
  const page = (hashStr(`spot-page-${bucket}-${salt}`) % pages) + 1;
  const list = page === 1
    ? first.data.series
    : (await api(`/series?per_page=24&page=${page}`))?.data?.series || [];
  if (!list.length) return null;
  const pick = list[hashStr(`spot-item-${bucket}-${salt}`) % list.length];
  try { sessionStorage.setItem(cacheKey, JSON.stringify(pick)); } catch { /* ignora */ }
  return pick;
}

async function renderHero(salt = spotSalt()) {
  const box = document.getElementById('hero-banner');
  if (!box) return;

  const bucket = Math.floor(Date.now() / SPOT_WINDOW_MS);
  const pick = await pickSpotSeries(salt);
  if (!pick) { box.hidden = true; return; }

  document.getElementById('hero-tag').textContent =
    SPOT_TAGS[hashStr(`spot-tag-${bucket}-${salt}`) % SPOT_TAGS.length];
  const href = `/series?id=${encodeURIComponent(pick.id)}`;
  const a = document.getElementById('hero-title');
  a.textContent = pick.title;
  a.setAttribute('href', href);
  document.getElementById('hero-open').setAttribute('href', href);
  document.getElementById('hero-sub').textContent =
    [pick.genre, pick.year, pick.episode_count ? `${pick.episode_count} episoade` : '']
      .filter(Boolean).join(' · ');

  const bg = document.getElementById('hero-bg');
  bg.innerHTML = '';
  const cover = safeUrl(pick.cover_image, '');
  if (cover && cover !== '#') {
    const img = document.createElement('img');
    img.className = 'hban__bg-img';
    img.src = cover;
    img.alt = '';
    img.addEventListener('error', () => { img.remove(); bg.appendChild(genHeroArt(pick.title)); }, { once: true });
    bg.appendChild(img);
  } else {
    bg.appendChild(genHeroArt(pick.title));
  }

  box.hidden = false;
  box.classList.remove('hban--in');
  void box.offsetWidth;
  box.classList.add('hban--in');
}

async function initHero() {
  await renderHero();
  document.getElementById('hero-shuffle')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    const salt = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    try { sessionStorage.setItem('auk-spot-salt', salt); } catch { /* mod privat */ }
    try { await renderHero(salt); } finally { btn.disabled = false; }
  });
}

// ---------------------------------------------------------------------
async function renderContinue() {
  const section = document.getElementById('continue-section');
  const row = document.getElementById('continue-row');
  if (!section || !row) return;

  const res = await api('/continue');
  if (!res.ok || !res.data?.items?.length) { section.hidden = true; return; }

  section.hidden = false;
  row.innerHTML = '';
  for (const it of res.data.items) {
    const a = document.createElement('a');
    a.className = 'continue-card';
    a.href = `/episode?id=${encodeURIComponent(it.episode_id)}`;

    const art = document.createElement('div');
    art.className = 'continue-card__art';
    const cover = safeUrl(it.cover_image, '');
    if (cover && cover !== '#') {
      const img = document.createElement('img');
      img.src = cover; img.alt = ''; img.loading = 'lazy';
      art.appendChild(img);
    } else {
      art.appendChild(genPoster(it.series_title));
    }
    a.appendChild(art);

    const meta = document.createElement('div');
    meta.className = 'continue-card__meta';
    const t1 = document.createElement('span');
    t1.className = 'continue-card__series';
    t1.textContent = it.series_title;
    const t2 = document.createElement('span');
    t2.className = 'continue-card__ep';
    t2.textContent = `Episodul ${it.episode_number}`;
    meta.appendChild(t1);
    meta.appendChild(t2);
    a.appendChild(meta);
    row.appendChild(a);
  }
}

await renderNav('/');
skeletons(10);
await Promise.all([load(), initChat()]);
initHero().catch(() => { /* bannerul e decorativ: pagina merge si fara el */ });
renderContinue().catch(() => { /* randul de continuare e optional */ });

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
