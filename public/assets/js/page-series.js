import { api, renderNav, toast, safeUrl } from './core.js';

// Pagina unei serii: detalii + toate episoadele, dintr-un singur apel API.

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function badge(text, cls = '') {
  const el = document.createElement('span');
  el.className = `pill-pos ${cls}`.trim();
  el.style.position = 'static';
  el.textContent = text;
  return el;
}

function setHead(series) {
  const title = document.getElementById('series-title');
  const desc = document.getElementById('series-desc');
  const badges = document.getElementById('series-badges');

  title.textContent = series.title || 'Fără titlu';
  document.title = `${series.title || 'Serie'} • anime-uke`;

  badges.innerHTML = '';
  badges.appendChild(badge(series.status === 'completed' ? '✓ Finalizat' : '● În difuzare', series.status === 'completed' ? 'pill-pos--ok' : ''));
  if (series.genre) for (const g of String(series.genre).split(',').slice(0, 3)) {
    if (g.trim()) badges.appendChild(badge(g.trim()));
  }
  if (series.year) badges.appendChild(badge(String(series.year)));

  desc.textContent = series.description || '';
}

function episodeCard(ep) {
  const a = document.createElement('a');
  a.className = 'card card--ep';
  a.href = `/episode?id=${encodeURIComponent(ep.id)}`;

  const num = document.createElement('div');
  num.className = 'ep-num';
  num.textContent = ep.episode_number;

  const body = document.createElement('div');
  body.className = 'card__body';

  const title = document.createElement('h3');
  title.className = 'card__title';
  title.textContent = ep.title || `Episodul ${ep.episode_number}`;

  const meta = document.createElement('p');
  meta.className = 'card__meta';
  const views = document.createElement('span');
  views.className = 'views';
  views.textContent = `👁 ${Number(ep.views || 0).toLocaleString('ro-RO')}`;
  meta.appendChild(views);

  body.append(title, meta);
  a.append(num, body);
  return a;
}

function skeletonEp(n = 6) {
  const grid = document.getElementById('episodes-grid');
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'sk';
    el.style.height = '76px';
    el.style.borderRadius = 'var(--r-lg)';
    grid.appendChild(el);
  }
}

async function load() {
  const id = getParam('id');
  const grid = document.getElementById('episodes-grid');

  if (!id) { location.replace('/'); return; }

  skeletonEp(6);
  const res = await api(`/series/${encodeURIComponent(id)}`);

  if (!res.ok) {
    grid.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'empty';
    el.style.gridColumn = '1 / -1';
    el.textContent = res.status === 404 ? 'Seria nu există.' : 'Nu am putut încărca seria.';
    grid.appendChild(el);
    document.getElementById('series-title').textContent = 'Serie indisponibilă';
    if (res.status === 404) toast('Seria nu există', 'warn');
    return;
  }

  setHead(res.data.series);

  const episodes = res.data.episodes || [];
  document.getElementById('episodes-count').textContent =
    episodes.length ? `${episodes.length} ${episodes.length === 1 ? 'episod' : 'episoade'}` : '';

  grid.innerHTML = '';
  if (!episodes.length) {
    const el = document.createElement('div');
    el.className = 'empty';
    el.style.gridColumn = '1 / -1';
    el.innerHTML = '<div class="empty__icon">📺</div>';
    const t = document.createElement('div');
    t.textContent = 'Încă nu au fost adăugate episoade.';
    el.appendChild(t);
    grid.appendChild(el);
    return;
  }
  for (const ep of episodes) grid.appendChild(episodeCard(ep));
}

await renderNav('');
await load();
