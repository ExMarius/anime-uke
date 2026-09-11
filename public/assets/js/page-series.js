import { api, renderNav, toast, safeUrl, getSession, withBusy } from './core.js';

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

// ---------------------------------------------------------------------
// Episoadele vin paginate: o serie lunga (One Piece are peste 1100) ar
// insemna mii de randuri citite din D1 la fiecare vizita. Selectorul de
// intervale de mai jos e construit din `episode_count`, care e stocat pe
// randul seriei — deci nu costa niciun COUNT suplimentar.
// ---------------------------------------------------------------------
let seriesId = null;
let epPage = 1;
let epPages = 1;
let epPerPage = 100;
let epTotal = 0;

/** Intervalul de episoade pe care il acopera o pagina: „101–200”. */
function rangeLabel(page, perPage, total) {
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return `${from}–${to}`;
}

/**
 * Deseneaza selectorul. Sub un numar mic de pagini foloseste butoane (mai
 * putine clicuri); peste, un <select>, ca sa nu umplem ecranul cu 100 de
 * butoane la o serie foarte lunga.
 */
function renderRanges() {
  const bar = document.getElementById('ep-ranges');
  if (!bar) return;
  bar.innerHTML = '';

  if (epPages <= 1) { bar.hidden = true; return; }
  bar.hidden = false;

  const mkBtn = (label, page, { current = false, disabled = false } = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn--sm ${current ? 'btn--accent' : 'btn--ghost'}`;
    b.textContent = label;
    b.disabled = disabled;
    if (!current && !disabled) b.addEventListener('click', () => loadEpisodes(page));
    if (current) b.setAttribute('aria-current', 'page');
    return b;
  };

  bar.appendChild(mkBtn('←', epPage - 1, { disabled: epPage <= 1 }));

  if (epPages <= 10) {
    for (let p = 1; p <= epPages; p++) {
      bar.appendChild(mkBtn(rangeLabel(p, epPerPage, epTotal), p, { current: p === epPage }));
    }
  } else {
    const sel = document.createElement('select');
    sel.className = 'select select--sm';
    sel.setAttribute('aria-label', 'Interval de episoade');
    for (let p = 1; p <= epPages; p++) {
      const o = document.createElement('option');
      o.value = String(p);
      o.textContent = `Episoade ${rangeLabel(p, epPerPage, epTotal)}`;
      sel.appendChild(o);
    }
    sel.value = String(epPage);
    sel.addEventListener('change', () => loadEpisodes(Number(sel.value)));
    bar.appendChild(sel);
  }

  bar.appendChild(mkBtn('→', epPage + 1, { disabled: epPage >= epPages }));
}

function renderEpisodes(episodes) {
  const grid = document.getElementById('episodes-grid');
  grid.innerHTML = '';

  if (!episodes.length) {
    const el = document.createElement('div');
    el.className = 'empty';
    el.style.gridColumn = '1 / -1';
    el.innerHTML = '<div class="empty__icon">📺</div>';
    const t = document.createElement('div');
    t.textContent = epTotal ? 'Niciun episod în intervalul ăsta.' : 'Încă nu au fost adăugate episoade.';
    el.appendChild(t);
    grid.appendChild(el);
    return;
  }
  for (const ep of episodes) grid.appendChild(episodeCard(ep));
}

function showGridError(message) {
  const grid = document.getElementById('episodes-grid');
  grid.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'empty';
  el.style.gridColumn = '1 / -1';
  el.textContent = message;
  grid.appendChild(el);
}

/** Incarca doar episoadele unei pagini — capul seriei ramane pe ecran. */
async function loadEpisodes(page) {
  if (page < 1 || page > epPages) return;
  epPage = page;
  renderRanges();
  skeletonEp(6);

  const res = await api(`/series/${encodeURIComponent(seriesId)}?page=${page}&per_page=${epPerPage}`);
  if (!res.ok) {
    showGridError(res.status === 404 ? 'Seria nu există.' : 'Nu am putut încărca episoadele.');
    return;
  }
  epTotal = res.data.episode_count ?? epTotal;
  epPages = res.data.pages ?? epPages;
  renderRanges();
  renderEpisodes(res.data.episodes || []);
}

async function load() {
  const id = getParam('id');
  const grid = document.getElementById('episodes-grid');

  if (!id) { location.replace('/'); return; }
  seriesId = id;

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

  epPerPage = res.data.per_page || 100;
  epTotal = res.data.episode_count || 0;
  epPages = res.data.pages || 1;
  epPage = res.data.page || 1;

  document.getElementById('episodes-count').textContent =
    epTotal ? `${epTotal} ${epTotal === 1 ? 'episod' : 'episoade'}` : '';

  renderRanges();
  renderEpisodes(res.data.episodes || []);
}

// ---------------------------------------------------------------------
// Lista „de vizionat" — vizibila doar pentru utilizatorii logati.
// Butonul comuta intre adaugare si scoatere, in functie de stare.
// ---------------------------------------------------------------------
let currentSeriesId = null;
let inWatchlist = false;

function paintWatchlistBtn() {
  const btn = document.getElementById('watchlist-btn');
  if (!btn) return;
  btn.textContent = inWatchlist ? '✅ În lista „de vizionat"' : '🔖 Adaugă la „de vizionat"';
  btn.classList.toggle('btn--ok', inWatchlist);
  btn.classList.toggle('btn--ghost', !inWatchlist);
}

async function initWatchlist(seriesId) {
  currentSeriesId = seriesId;
  const btn = document.getElementById('watchlist-btn');
  const link = document.getElementById('profile-link');
  if (!btn) return;

  const user = await getSession();
  if (!user) return;             // vizitatorii nu au lista proprie

  btn.hidden = false;
  if (link) link.hidden = false;

  const res = await api('/watchlist');
  if (res.ok) {
    inWatchlist = (res.data.watchlist || []).some((s) => (s.series_id ?? s.id) === seriesId);
    paintWatchlistBtn();
  }

  btn.addEventListener('click', async () => {
    await withBusy(btn, async () => {
      const r = inWatchlist
        ? await api(`/watchlist?series_id=${encodeURIComponent(currentSeriesId)}`, { method: 'DELETE' })
        : await api('/watchlist', { method: 'POST', body: { series_id: currentSeriesId } });

      if (!r.ok) { toast(r.data?.error || 'Nu am putut actualiza lista', 'err'); return; }
      inWatchlist = !inWatchlist;
      paintWatchlistBtn();
      toast(inWatchlist ? 'Serie adăugată la „de vizionat".' : 'Serie scoasă din listă.', 'ok');
    });
  });
}

await renderNav('');
await load();
const sid = Number(getParam('id'));
if (sid) await initWatchlist(sid);
