import { api, renderNav, toast } from './core.js';

// Pagina unei serii: detalii + toate episoadele, dintr-un singur apel API.
// In v1 se descarcau TOATE seriile ca sa o gaseasca pe cea curenta.

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function setHead(series) {
  const title = document.getElementById('series-title');
  const meta = document.getElementById('series-meta');
  const desc = document.getElementById('series-desc');

  title.textContent = series.title || 'Fără titlu';
  document.title = `${series.title || 'Serie'} • AnimeSphere`;

  const bits = [];
  if (series.status) bits.push(series.status === 'completed' ? 'Finalizat' : 'În difuzare');
  if (series.genre) bits.push(series.genre);
  if (series.year) bits.push(String(series.year));
  meta.textContent = bits.join(' · ');

  desc.textContent = series.description || '';
}

function episodeCard(ep) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `/episode?id=${encodeURIComponent(ep.id)}`;

  const body = document.createElement('div');
  body.className = 'card__body';

  const num = document.createElement('div');
  num.className = 'card__meta';
  num.style.color = 'var(--accent)';
  num.style.fontWeight = '800';
  num.textContent = `Episodul ${ep.episode_number}`;

  const title = document.createElement('h3');
  title.className = 'card__title';
  title.textContent = ep.title || `Episodul ${ep.episode_number}`;

  const meta = document.createElement('p');
  meta.className = 'card__meta';
  meta.textContent = `👁 ${ep.views ?? 0} vizionări`;

  body.append(num, title, meta);
  a.appendChild(body);
  return a;
}

async function load() {
  const id = getParam('id');
  const grid = document.getElementById('episodes-grid');

  if (!id) { location.replace('/'); return; }

  const res = await api(`/series/${encodeURIComponent(id)}`);

  if (!res.ok) {
    grid.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'empty';
    el.textContent = res.status === 404 ? 'Seria nu există.' : 'Nu am putut încărca seria.';
    grid.appendChild(el);
    document.getElementById('series-title').textContent = 'Serie indisponibilă';
    if (res.status === 404) toast('Seria nu există', 'warn');
    return;
  }

  setHead(res.data.series);

  const episodes = res.data.episodes || [];
  document.getElementById('episodes-heading').textContent =
    `Episoade (${episodes.length})`;

  grid.innerHTML = '';
  if (!episodes.length) {
    const el = document.createElement('div');
    el.className = 'empty';
    el.textContent = 'Încă nu au fost adăugate episoade pentru seria asta.';
    grid.appendChild(el);
    return;
  }
  for (const ep of episodes) grid.appendChild(episodeCard(ep));
}

await renderNav('');
await load();
