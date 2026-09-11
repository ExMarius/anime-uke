import { api, renderNav, toast, getSession, clearSession, withBusy, safeUrl } from './core.js';

// Pagina episodului: player cu surse multiple + contor vizualizari + puncte.
//
// In v1 pagina asta era stricata pentru orice serie in afara de id=1:
// se facea `/episodes?series_id=1` hardcodat si se cauta episodul in lista.
// Acum avem endpoint dedicat /api/episodes/:id.

const POINTS_PER_EPISODE = 10;

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function setWatchedState(watched) {
  const btn = document.getElementById('watch-btn');
  const note = document.getElementById('watch-note');
  if (!btn) return;

  if (watched) {
    btn.disabled = true;
    btn.textContent = '✔ Deja marcat ca vizionat';
    note.textContent = 'Ai primit deja punctele pentru episodul ăsta.';
  } else {
    btn.disabled = false;
    btn.textContent = `✅ Marchează ca vizionat (+${POINTS_PER_EPISODE} puncte)`;
    note.textContent = '';
  }
}

async function markWatched() {
  const btn = document.getElementById('watch-btn');
  const id = getParam('id');

  await withBusy(btn, async () => {
    const res = await api('/watch', { method: 'POST', body: { episode_id: Number(id) } });

    if (res.status === 401) {
      toast('Trebuie să fii autentificat ca să primești puncte', 'warn');
      clearSession();
      setTimeout(() => { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; }, 900);
      return;
    }
    if (!res.ok) {
      toast(res.data?.error || 'Nu am putut marca episodul', 'err');
      return;
    }

    clearSession();            // forteaza recitirea punctelor din DB
    await renderNav('');       // reimparte navbar-ul cu punctele noi

    if (res.data.alreadyWatched) {
      toast(res.data.message || 'Deja marcat', 'warn');
    } else {
      toast(`+${res.data.pointsAdded ?? POINTS_PER_EPISODE} puncte! Total: ${res.data.points}`, 'ok');
    }
    setWatchedState(true);
  });
}

// ---------------------------------------------------------------------
// SURSE VIDEO MULTIPLE
//
// Fiecare episod poate avea mai multe surse. Tipurile:
//   embed -> iframe (DoodStream si alti furnizori)
//   file  -> fisier .mp4/.webm, redat cu <video>
//   link  -> pagina externa, deschisa intr-un tab nou
//
// Alegerea utilizatorului se tine minte in localStorage, separat pe
// episod: unii prefera mereu aceeasi sursa si nu are rost sa o
// reincarce la fiecare vizita.
// ---------------------------------------------------------------------

const KIND_ICONS = { embed: '\u25B6', file: '\uD83C\uDFA6', link: '\uD83D\uDD17' };

let sources = [];
let activeSource = -1;

function memoryKey() {
  return `auk-src-${getParam('id')}`;
}

function hideAllPlayers() {
  const iframe = document.getElementById('player');
  const video = document.getElementById('player-video');
  const ext = document.getElementById('player-ext');

  // Golim sursa veche inainte de a ascunde: un <video> lasat cu src
  // continua sa descarce date in fundal si sa tina un tab de retea ocupat.
  if (video && !video.paused) video.pause();
  if (video) video.removeAttribute('src');
  if (video) video.load();
  if (iframe) iframe.src = 'about:blank';

  if (iframe) iframe.hidden = true;
  if (video) video.hidden = true;
  if (ext) ext.hidden = true;
}

function showLoading(text) {
  const wrap = document.getElementById('player-wrap');
  let loading = document.getElementById('player-loading');
  if (!loading) {
    loading = document.createElement('div');
    loading.id = 'player-loading';
    loading.className = 'loading';
    wrap.prepend(loading);
  }
  loading.hidden = false;
  loading.innerHTML = '';
  if (text) {
    loading.textContent = text;
  } else {
    const sp = document.createElement('div');
    sp.className = 'spinner';
    loading.append(sp, document.createTextNode('Se încarcă playerul…'));
  }
  return loading;
}

function clearLoading() {
  document.getElementById('player-loading')?.remove();
}

/** Activeaza sursa cu indexul dat si redeseneaza taburile. */
function selectSource(index) {
  if (!sources[index]) return;
  activeSource = index;
  const src = sources[index];

  try { localStorage.setItem(memoryKey(), src.url); } catch { /* privat mode */ }

  hideAllPlayers();

  const iframe = document.getElementById('player');
  const video = document.getElementById('player-video');
  const ext = document.getElementById('player-ext');

  if (src.kind === 'file') {
    showLoading();
    video.src = safeUrl(src.url, '');
    video.hidden = false;
    // `loadeddata` e mai de incredere decat `load` la elemente media.
    video.addEventListener('loadeddata', () => clearLoading(), { once: true });
    video.addEventListener('error', () => {
      clearLoading();
      showLoading('Fișierul video nu poate fi redat în browserul tău.');
    }, { once: true });
    setTimeout(clearLoading, 6000);

  } else if (src.kind === 'link') {
    clearLoading();
    document.getElementById('ext-text').textContent =
      `„${src.label}" se deschide într-o pagină externă.`;
    const a = document.getElementById('ext-link');
    a.href = safeUrl(src.url, '#');
    ext.hidden = false;

  } else {
    const url = safeUrl(src.url, '');
    if (!url || url === '#') { showLoading('Sursa nu e disponibilă.'); return; }
    showLoading();
    iframe.src = url;
    iframe.hidden = false;
    iframe.addEventListener('load', () => clearLoading(), { once: true });
    // Fallback daca load nu se declanseaza (unele embed-uri blocheaza)
    setTimeout(clearLoading, 6000);
  }

  for (const btn of document.querySelectorAll('#source-list button')) {
    const on = Number(btn.dataset.index) === index;
    btn.classList.toggle('sources__btn--on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

function renderSources(list) {
  sources = Array.isArray(list) ? list.filter((s) => s && s.url) : [];

  const bar = document.getElementById('source-tabs');
  const listBox = document.getElementById('source-list');
  listBox.innerHTML = '';

  if (!sources.length) {
    bar.hidden = true;
    showLoading('Playerul nu e disponibil pentru episodul ăsta.');
    return;
  }

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sources__btn';
    btn.dataset.index = String(i);
    btn.setAttribute('role', 'tab');
    btn.title = `${src.label} — ${src.kind === 'file' ? 'fișier video' : src.kind === 'link' ? 'link extern' : 'embed'}`;
    btn.textContent = `${KIND_ICONS[src.kind] || '\u25B6'} ${src.label}`;
    btn.addEventListener('click', () => selectSource(i));
    listBox.appendChild(btn);
  }

  // O singura sursa: ascundem bara de taburi, nu are ce alege utilizatorul.
  bar.hidden = sources.length < 2;

  // Reluam ultima sursa folosita la episodul asta, daca inca exista.
  let start = 0;
  try {
    const last = localStorage.getItem(memoryKey());
    if (last) {
      const found = sources.findIndex((s) => s.url === last);
      if (found >= 0) start = found;
    }
  } catch { /* ignoram */ }

  selectSource(start);
}

async function load() {
  const id = getParam('id');
  const titleEl = document.getElementById('episode-title');
  const metaEl = document.getElementById('episode-meta');
  const crumb = document.getElementById('breadcrumb');
  const numEl = document.getElementById('episode-num');

  if (!id) { location.replace('/'); return; }

  const res = await api(`/episodes/${encodeURIComponent(id)}`);

  if (!res.ok) {
    titleEl.textContent = 'Episod indisponibil';
    metaEl.textContent = '';
    document.getElementById('episode-num').textContent = '✕';
    const box = showLoading(res.status === 404 ? 'Episodul nu există.' : 'Nu am putut încărca episodul.');
    box.classList.remove('loading');
    box.classList.add('empty');
    document.getElementById('watch-btn').disabled = true;
    if (res.status === 404) toast('Episodul nu există', 'warn');
    return;
  }

  const ep = res.data.episode;

  const label = `Episodul ${ep.episode_number}${ep.title ? ` — ${ep.title}` : ''}`;
  titleEl.textContent = label;
  document.title = `${ep.series_title || 'Serie'} · ${label} • anime-uke`;

  metaEl.textContent = `${ep.series_title || ''} · 👁 ${Number(ep.views ?? 0).toLocaleString('ro-RO')} vizionări`;

  crumb.href = `/series?id=${encodeURIComponent(ep.series_id)}`;
  crumb.textContent = `← ${ep.series_title || 'Înapoi la serie'}`;
  if (numEl) numEl.textContent = ep.episode_number;

  // Playerul se incarca doar dupa ce avem URL-urile validate pe server.
  renderSources(res.data.sources || []);

  setWatchedState(!!res.data.watched);

  // Contor de vizualizari: merge in StatsDO (buffer), nu direct in D1.
  // Fara await — nu trebuie sa incetineasca afisarea paginii.
  api('/view', { method: 'POST', body: { episode_id: Number(id) } }).catch(() => {});
}

await renderNav('');
await load();

document.getElementById('watch-btn')?.addEventListener('click', markWatched);
document.getElementById('back-btn')?.addEventListener('click', () => history.back());

// Avertizam la parăsirea paginii doar daca playerul e incarcat — evitam
// blocarea navigarii in mod inutil.
window.addEventListener('pageshow', (e) => { if (e.persisted) load(); });
