import { api, escapeHtml, safeUrl, renderNav, toast, formatDate } from './core.js';
import { initChat } from './chat.js';

// Pagina principala: grila de serii + chat.

async function loadSeries() {
  const grid = document.getElementById('series-grid');
  const count = document.getElementById('series-count');

  const res = await api('/series');
  if (!res.ok) {
    grid.innerHTML = '';
    grid.appendChild(empty(`Nu am putut încărca seriile. ${res.data?.error || ''}`));
    count.textContent = '';
    toast(res.data?.error || 'Eroare la încărcarea seriilor', 'err');
    return;
  }

  const list = res.data.series || [];
  count.textContent = list.length
    ? `${list.length} ${list.length === 1 ? 'serie' : 'serii'} disponibile`
    : '';

  grid.innerHTML = '';

  if (!list.length) {
    grid.appendChild(empty('Încă nu există serii adăugate.'));
    return;
  }

  for (const s of list) grid.appendChild(seriesCard(s));
}

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
    // Daca imaginea nu incarca, aratam fallback-ul in loc de icon rupt.
    img.addEventListener('error', () => { img.replaceWith(fallback()); });
    poster.appendChild(img);
  } else {
    poster.appendChild(fallback());
  }

  const badge = document.createElement('span');
  badge.className = `badge${s.status === 'completed' ? ' badge--ok' : ''}`;
  badge.textContent = s.status === 'completed' ? 'Finalizat' : 'În difuzare';
  poster.appendChild(badge);

  const body = document.createElement('div');
  body.className = 'card__body';

  const title = document.createElement('h3');
  title.className = 'card__title';
  title.textContent = s.title || 'Fără titlu';

  const meta = document.createElement('p');
  meta.className = 'card__meta';
  const bits = [];
  if (s.genre) bits.push(s.genre);
  if (s.year) bits.push(String(s.year));
  bits.push(`${s.episode_count ?? 0} ep.`);
  meta.textContent = bits.join(' · ');

  body.append(title, meta);

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
  el.textContent = '🎌';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function empty(text) {
  const el = document.createElement('div');
  el.className = 'empty';
  el.textContent = text;
  return el;
}

await renderNav('/');
await Promise.all([loadSeries(), initChat()]);
