import { api, renderNav, toast, safeUrl, getSession, withBusy, genPoster, getParam } from './core.js';

// Pagina unei serii: detalii + toate episoadele, dintr-un singur apel API.


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

  // Posterul seriei. La o imagine care nu se incarca (coperta stearsa, URL
  // mort) cadem pe fallback-ul cu glifa, nu pe un icon de imagine rupta.
  const poster = document.getElementById('series-poster');
  poster.innerHTML = '';
  if (series.cover_image) {
    const img = document.createElement('img');
    img.src = safeUrl(series.cover_image, '');
    img.alt = series.title || 'Poster';
    img.loading = 'eager';
    img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(genPoster(series.title)), { once: true });
    poster.appendChild(img);
    poster.hidden = false;
  } else {
    poster.appendChild(genPoster(series.title));
    poster.hidden = false;
  }

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
  paintRating(res.data);

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

// ---------------------------------------------------------------------
// Cufăr cu comori — timpul petrecut pe seria asta devine recompense.
// Pragurile si acordarea punctelor traieste pe server (/api/chests); aici
// doar le aratam si deschidem cuferele deblocate.
// ---------------------------------------------------------------------
function fmtWatch(sec) {
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** O explozie mica de confetti deasupra cufarului deschis. Pur CSS/JS,
 *  fara librarii: particulele sunt span-uri aruncate cu transform-uri
 *  aleatoare si curatate dupa animatie. */
function burstConfetti(host, count = 26) {
  const colors = ['#dc143c', '#ff5c7a', '#ffd166', '#22c55e', '#4cc9f0', '#f5f5f5'];
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('span');
    bit.className = 'confetti';
    bit.style.background = colors[i % colors.length];
    bit.style.setProperty('--dx', `${Math.round((Math.random() * 2 - 1) * 150)}px`);
    bit.style.setProperty('--dy', `${-Math.round(50 + Math.random() * 130)}px`);
    bit.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
    bit.style.animationDelay = `${Math.round(Math.random() * 120)}ms`;
    host.appendChild(bit);
    setTimeout(() => bit.remove(), 1600);
  }
}

function chestCard(ch, totalSeconds, seriesId) {
  const el = document.createElement('div');
  el.className = 'chest'
    + (ch.secret ? ' chest--secret' : '')
    + (ch.claimed ? ' chest--claimed' : ch.unlocked ? ' chest--open' : ' chest--locked');

  const icon = document.createElement('div');
  icon.className = 'chest__icon';
  icon.textContent = ch.claimed ? '🎉' : ch.icon || '🎁';
  el.appendChild(icon);

  const name = document.createElement('div');
  name.className = 'chest__name';
  name.textContent = ch.name;
  el.appendChild(name);

  const pts = document.createElement('div');
  pts.className = 'chest__pts';
  pts.textContent = ch.claimed
    ? `+${ch.points} primite`
    : ch.secret && !ch.unlocked ? '+? puncte' : `+${ch.points} puncte`;
  el.appendChild(pts);

  if (ch.claimed) {
    const done = document.createElement('div');
    done.className = 'chest__state';
    done.textContent = 'Deschis ✓';
    el.appendChild(done);
  } else if (ch.unlocked) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--accent chest__btn';
    btn.textContent = 'Deschide cufărul';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const r = await api('/chests', { method: 'POST', body: { series_id: seriesId, tier: ch.tier } });
      btn.disabled = false;
      if (!r.ok) { toast(r.data?.error || 'Nu am putut deschide cufărul', 'err'); return; }
      burstConfetti(el, ch.secret ? 44 : 26);
      toast(`${ch.icon || '🎁'} ${ch.name} deschis: +${r.data.pointsAdded} puncte!`, 'ok');
      await Promise.all([loadChests(seriesId), renderNav('')]);
    });
    el.appendChild(btn);
  } else {
    const bar = document.createElement('div');
    bar.className = 'chest__bar';
    const fill = document.createElement('div');
    fill.className = 'chest__fill';
    fill.style.width = `${Math.min(100, Math.round((totalSeconds / ch.seconds) * 100))}%`;
    bar.appendChild(fill);
    el.appendChild(bar);
    const left = document.createElement('div');
    left.className = 'chest__state';
    left.textContent = `mai ai ${fmtWatch(Math.max(0, ch.seconds - totalSeconds))}`;
    el.appendChild(left);
  }
  return el;
}

// ---------------------------------------------------------------------
// Rating 1-10: media comunitatii + nota proprie, revot prin upsert.
// ---------------------------------------------------------------------
function paintRating(d) {
  const box = document.getElementById('rate-box');
  const stars = document.getElementById('rate-stars');
  if (!box || !stars) return;
  box.hidden = false;

  document.getElementById('rate-avg').textContent =
    d.rating_count ? d.rating_average.toLocaleString('ro-RO') : '–';
  document.getElementById('rate-count').textContent =
    d.rating_count ? `${d.rating_count} ${d.rating_count === 1 ? 'vot' : 'voturi'}` : 'fără voturi încă';

  stars.innerHTML = '';
  for (let n = 1; n <= 10; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rate__star' + (n <= (d.my_rating || 0) ? ' rate__star--on' : '');
    b.textContent = String(n);
    b.title = `Dă nota ${n}`;
    b.setAttribute('aria-label', `Nota ${n}`);
    b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await api('/ratings', { method: 'POST', body: { series_id: d.series.id, rating: n } });
      b.disabled = false;
      if (!r.ok) { toast(r.data?.error || 'Nu am putut salva nota', 'err'); return; }
      toast(`Ai notat seria cu ${n}.`, 'ok');
      paintRating({ ...d, my_rating: n, rating_average: r.data.average, rating_count: r.data.count });
    });
    stars.appendChild(b);
  }
}

async function loadChests(seriesId) {
  const section = document.getElementById('chests-section');
  if (!section) return;
  const res = await api(`/chests?series_id=${encodeURIComponent(seriesId)}`);
  if (!res.ok) { section.hidden = true; return; }

  const d = res.data;
  section.hidden = false;
  const row = document.getElementById('chests-row');
  row.innerHTML = '';
  for (const ch of d.chests) row.appendChild(chestCard(ch, d.total_seconds, seriesId));

  const opened = d.chests.filter((c) => c.claimed).length;
  document.getElementById('chests-count').textContent =
    `${opened}/${d.chests.length} deschise` + (d.total_seconds ? ` · ${fmtWatch(d.total_seconds)} de vizionare` : '');
  document.getElementById('chests-hint').textContent = d.total_seconds
    ? 'Timpul se numără cât playerul rulează cu tabul vizibil. Cuferele se deblochează singure.'
    : 'Pornește un episod: timpul petrecut pe seria asta deblochează cuferele, rând pe rând.';
}

await Promise.all([renderNav(''), load()]);
const sid = Number(getParam('id'));
if (sid) {
  await initWatchlist(sid);
  loadChests(sid).catch(() => { /* cuferele sunt optionale: pagina trebuie sa mearga oricum */ });
}
