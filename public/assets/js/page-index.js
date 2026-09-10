import { api, renderNav, toast, getSession, safeUrl } from './core.js';
import { initChat, openChat } from './chat.js';

// Pagina principala: hero + cautare client-side + grila de serii + chat.

let allSeries = [];

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
function render(list) {
  const grid = document.getElementById('series-grid');
  const count = document.getElementById('series-count');
  grid.innerHTML = '';

  if (!list.length) {
    grid.appendChild(emptyState(
      allSeries.length ? 'Nicio potrivire' : 'Încă nu există serii',
      allSeries.length ? 'Încearcă alt termen de căutare.' : 'Adaugă prima serie din panoul de administrare.'
    ));
    count.textContent = allSeries.length ? `0 din ${allSeries.length}` : '';
    return;
  }

  count.textContent = `${list.length} ${list.length === 1 ? 'serie' : 'serii'}`;
  for (const s of list) grid.appendChild(seriesCard(s));
}

function filter(q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return render(allSeries);
  const out = allSeries.filter((s) =>
    [s.title, s.genre, s.description, s.year].some((v) => String(v ?? '').toLowerCase().includes(needle))
  );
  render(out);
}

// ---------------- incarcare ----------------
async function load() {
  skeletons(10);
  const res = await api('/series');

  if (!res.ok) {
    document.getElementById('series-grid').innerHTML = '';
    document.getElementById('series-grid').appendChild(
      emptyState('Nu am putut încărca seriile', res.data?.error || 'Verifică conexiunea și reîncearcă.')
    );
    document.getElementById('series-count').textContent = '';
    toast(res.data?.error || 'Eroare la încărcarea seriilor', 'err');
    return;
  }

  allSeries = res.data.series || [];
  render(allSeries);

  const totalEp = allSeries.reduce((n, s) => n + (s.episode_count || 0), 0);
  document.getElementById('stat-series').textContent = allSeries.length;
  document.getElementById('stat-episodes').textContent = totalEp;

  const user = await getSession();
  document.getElementById('stat-points').textContent = user ? user.points : '0';
}

await renderNav('/');
skeletons(10);
await Promise.all([load(), initChat()]);

document.getElementById('search-input')?.addEventListener('input', (e) => filter(e.target.value));
document.getElementById('hero-chat')?.addEventListener('click', openChat);
