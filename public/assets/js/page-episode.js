import { api, renderNav, toast, getSession, clearSession, withBusy, safeUrl } from './core.js';

// Pagina episodului: player cu surse multiple + contor vizualizari + puncte.
//
// In v1 pagina asta era stricata pentru orice serie in afara de id=1:
// se facea `/episodes?series_id=1` hardcodat si se cauta episodul in lista.
// Acum avem endpoint dedicat /api/episodes/:id.

// Pragul de puncte si secundele acumulate vin de pe server (/api/progress).
// Clientul doar raporteaza timpul si deseneaza bara — decizia e pe server,
// fiindca o regula traita doar in browser poate fi pacalita.
let watchThreshold = 15 * 60;
let watchSeconds = 0;
let watchedDone = false;
let episodeId = null;
let heartbeatTimer = null;

function fmtTime(total) {
  const m = Math.floor(total / 60);
  const sec = Math.floor(total % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function paintProgress() {
  const box = document.getElementById('watch-progress');
  if (!box) return;
  box.hidden = false;
  document.getElementById('watch-progress-fill').style.width =
    `${Math.min(100, (watchSeconds / watchThreshold) * 100)}%`;
  document.getElementById('watch-progress-time').textContent =
    `${fmtTime(Math.min(watchSeconds, watchThreshold))} / ${fmtTime(watchThreshold)}`;
  const label = document.getElementById('watch-progress-label');
  const note = document.getElementById('watch-progress-note');
  if (watchedDone) {
    label.textContent = '✔ Vizionat — puncte acordate';
    note.textContent = 'Mulțumim că te-ai uitat!';
    box.classList.add('watch-progress--done');
  } else {
    label.textContent = '🍿 Se acumulează timp de vizionare';
    note.textContent = `Punctele și marcajul „vizionat” vin după ${Math.round(watchThreshold / 60)} de minute de vizionare reală.`;
    box.classList.remove('watch-progress--done');
  }
}

/**
 * Secunde „active". Pentru fisiier video citim starea reala a playerului;
 * pentru embed-uri nu putem vedea in iframe (cross-origin), deci folosim
 * timpul cu pagina vizibila ca aproximatie onesta. Pauza sau tab ascuns =
// nu se acumuleaza nimic.
 */
function activeNow() {
  if (document.hidden) return false;
  const src = sources[activeSource];
  if (!src) return false;
  if (src.kind === 'file') {
    const v = document.getElementById('player-video');
    return !!v && !v.hidden && !v.paused && !v.ended;
  }
  return true;
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    if (!activeNow() || watchedDone) return;
    const res = await api('/progress', {
      method: 'POST',
      body: { episode_id: episodeId, seconds: 30 },
    });
    if (res.status === 401) { stopHeartbeat(); return; }
    if (!res.ok) return;
    const wasDone = watchedDone;
    watchSeconds = res.data.seconds ?? watchSeconds;
    watchedDone = !!res.data.watched;
    paintProgress();
    if (!wasDone && watchedDone) {
      toast(`+${res.data.pointsAdded ?? 10} puncte! Total: ${res.data.points}`, 'ok');
      clearSession();          // forteaza recitirea punctelor in navbar
      await renderNav('');
    }
  }, 30000);
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
    // Fallback daca load nu se declanseaza (unele embed-uri blocheaza):
    // spunem utilizatorului ce poate face, in loc sa lasam un cadru gol.
    setTimeout(() => {
      if (document.getElementById('player-loading')) {
        clearLoading();
        showLoading('Embed-ul nu raspunde. Încearcă altă sursă din lista de mai sus.');
      }
    }, 8000);
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

  // Sursa implicita: ultima folosita daca mai exista, altfel prima care se
  // reda inline (fisier, apoi embed). Un link extern NU trebuie sa fie
  // punctul de intrare: utilizatorul a venit sa se uite, nu sa plece.
  let start = 0;
  try {
    const last = localStorage.getItem(memoryKey());
    if (last) {
      const found = sources.findIndex((s) => s.url === last);
      if (found >= 0) start = found;
    }
  } catch { /* ignoram */ }
  if (!sources[start] || sources[start].kind === 'link') {
    const playable = sources.findIndex((s) => s.kind === 'file');
    const embed = sources.findIndex((s) => s.kind === 'embed');
    start = playable >= 0 ? playable : (embed >= 0 ? embed : 0);
  }

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
    stopHeartbeat();
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

  watchThreshold = Number(res.data.watch_threshold) || 900;
  watchSeconds = Number(res.data.progress_seconds) || 0;
  watchedDone = !!res.data.watched;
  paintProgress();
  startHeartbeat();

  // Contor de vizualizari: merge in StatsDO (buffer), nu direct in D1.
  // Fara await — nu trebuie sa incetineasca afisarea paginii.
  api('/view', { method: 'POST', body: { episode_id: Number(id) } }).catch(() => {});
}

await renderNav('');
await load();

document.getElementById('back-btn')?.addEventListener('click', () => history.back());

// Avertizam la parăsirea paginii doar daca playerul e incarcat — evitam
// blocarea navigarii in mod inutil.
window.addEventListener('pageshow', (e) => { if (e.persisted) load(); });
