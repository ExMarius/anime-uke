import { api, renderNav, toast, getSession, clearSession, withBusy, safeUrl, getParam, escapeHtml, formatDate, staffBadge, rankChip , whenActive } from './core.js';

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
let activityTimer = null;
let pendingSeconds = 0;
let currentSubtitle = '';
let resumedOnce = false;

function fmtTime(total) {
  const m = Math.floor(total / 60);
  const sec = Math.floor(total % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function paintProgress() {
  const box = document.getElementById('watch-progress');
  if (!box) return;
  box.hidden = false;
  const shown = watchSeconds + pendingSeconds;
  document.getElementById('watch-progress-fill').style.width =
    `${Math.min(100, (shown / watchThreshold) * 100)}%`;
  document.getElementById('watch-progress-time').textContent =
    `${fmtTime(Math.min(shown, watchThreshold))} / ${fmtTime(watchThreshold)}`;
  const label = document.getElementById('watch-progress-label');
  const note = document.getElementById('watch-progress-note');
  if (watchedDone) {
    label.textContent = '✔ Vizionat — puncte acordate';
    note.textContent = 'Timpul continuă să se acumuleze pentru cuferele seriei.';
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
  if (activityTimer) { clearInterval(activityTimer); activityTimer = null; }
  window.removeEventListener('pagehide', flushProgress);
  document.removeEventListener('visibilitychange', flushOnHidden);
}

// Trimitem progresul la 2 minute, nu la 30 de secunde. La 1000 de utilizatori
// activi pe zi, un heartbeat de 30s ar insemna ~240.000 de scrieri/zi in D1 —
// peste plafonul planului gratuit (100.000). Acuratetea nu pierde: fiecare
// secunda vizionata intra intr-un acumulator local si e trimisa in loturi.
const HEARTBEAT_SEND_MS = 120000;
// Trebuie sa coincida cu MAX_INCREMENT de pe server (/api/progress).
const SEND_CAP = 120;

function flushOnHidden() { if (document.hidden) flushProgress(); }

/** Trimite secundele acumulate local. Nu pierdem timp niciodata: daca
 *  cererea esueaza, secundele se intorc in acumulator. */
async function flushProgress() {
  if (!pendingSeconds || !episodeId) return;
  const secs = Math.min(pendingSeconds, SEND_CAP);
  pendingSeconds -= secs;

  const res = await api('/progress', {
    method: 'POST',
    body: { episode_id: episodeId, seconds: secs },
  });
  if (res.status === 401) { stopHeartbeat(); return; }
  if (!res.ok) { pendingSeconds += secs; return; }

  const wasDone = watchedDone;
  watchSeconds = res.data.seconds ?? watchSeconds;
  watchedDone = !!res.data.watched;
  paintProgress();
  if (!wasDone && watchedDone) {
    toast(`+${res.data.pointsAdded ?? 10} puncte! Total: ${res.data.points}`, 'ok');
    clearSession();          // forteaza recitirea punctelor in navbar
    await renderNav('');
  }
}

function startHeartbeat() {
  stopHeartbeat();
  // Numaram fiecare secunda in care userul chiar se uita. Contam si DUPA
  // pragul de 15 minute: timpul acela e cel care deblocheaza cuferele de
  // argint si aur, deci oprirea acumularii la „vizionat" le-ar fi blocat
  // pentru totdeauna in utilizarea reala.
  activityTimer = setInterval(() => { if (activeNow()) pendingSeconds += 1; }, 1000);
  heartbeatTimer = setInterval(flushProgress, HEARTBEAT_SEND_MS);
  // La plecare din pagina trimitem ce a ramas, ca sa nu se piarda secunde.
  window.addEventListener('pagehide', flushProgress);
  document.addEventListener('visibilitychange', flushOnHidden);
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
  const extLink = document.getElementById('ext-link');

  // Golim sursa veche inainte de a ascunde: un <video> lasat cu src
  // continua sa descarce date in fundal si sa tina un tab de retea ocupat.
  if (video && !video.paused) video.pause();
  if (video) video.removeAttribute('src');
  if (video) video.load();
  if (iframe) iframe.src = 'about:blank';

  if (iframe) iframe.hidden = true;
  if (video) video.hidden = true;
  if (extLink) extLink.hidden = true;
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
  const extLink = document.getElementById('ext-link');

  if (src.kind === 'file') {
    showLoading();
    video.src = safeUrl(src.url, '');
    video.hidden = false;

    // Subtitrarea in romana: un fisier WebVTT atasat ca <track>. Il punem
    // de fiecare data cand porneste o sursa file, ca sa nu ramana un track
    // de la episodul anterior.
    video.querySelectorAll('track').forEach((tr) => tr.remove());
    const sub = safeUrl(currentSubtitle, '');
    if (sub && sub !== '#') {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = 'Română';
      track.srclang = 'ro';
      track.default = true;
      track.src = sub;
      video.appendChild(track);
    }
    // `loadeddata` e mai de incredere decat `load` la elemente media.
    video.addEventListener('loadeddata', () => clearLoading(), { once: true });
    // Reluare din unde a ramas: progresul vine de pe server, deci functioneaza
    // si intre dispozitive. Sarim peste daca e la inceput sau aproape de final.
    video.addEventListener('loadedmetadata', () => {
      if (resumedOnce) return;
      resumedOnce = true;
      const resumeAt = watchSeconds;
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      if (resumeAt > 5 && dur > 0 && resumeAt < dur - 30) {
        video.currentTime = resumeAt;
        toast(`▶ Reluat de la ${fmtTime(resumeAt)}`, 'ok');
      }
    }, { once: true });
    video.addEventListener('error', () => {
      clearLoading();
      showLoading('Fișierul video nu poate fi redat în browserul tău.');
    }, { once: true });
    setTimeout(clearLoading, 6000);

  } else if (src.kind === 'link') {
    // Si un link extern se reda in pagina, nu mai trimite utilizatorul afara:
    // fisierele media merg direct in <video>, restul in iframe. Randul discret
    // de sub player ramane doar ca alternativa, nu ca inlocuitor.
    const url = safeUrl(src.url, '');
    if (!url || url === '#') { showLoading('Sursa nu e disponibilă.'); return; }
    extLink.href = url;
    extLink.hidden = false;
    const lbl = document.getElementById('ext-label');
    if (lbl) lbl.textContent = src.label || 'sursa';

    if (/\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(url)) {
      showLoading();
      video.src = url;
      video.hidden = false;
      video.addEventListener('loadeddata', () => clearLoading(), { once: true });
      video.addEventListener('error', () => {
        clearLoading();
        showLoading('Fișierul nu se poate reda aici. Folosește linkul de sub player.');
      }, { once: true });
      setTimeout(clearLoading, 6000);
    } else {
      showLoading();
      iframe.src = url;
      iframe.hidden = false;
      iframe.addEventListener('load', () => clearLoading(), { once: true });
      setTimeout(() => {
        if (document.getElementById('player-loading')) {
          clearLoading();
          showLoading('Sursa nu răspunde. Folosește linkul de sub player sau altă sursă.');
        }
      }, 8000);
    }

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
  currentSubtitle = ep.subtitle_url || '';
  // Fara linia asta heartbeat-ul nu trimitea NICIODATA secundele: flushProgress
  // iesea pe `if (!episodeId) return`. Timpul de vizionare parea mort din
  // cauza unei singure variabile neasignate.
  episodeId = Number(id);
  resumedOnce = false;

  const label = `Episodul ${ep.episode_number}${ep.title ? ` — ${ep.title}` : ''}`;
  titleEl.textContent = label;
  document.title = `${ep.series_title || 'Serie'} · ${label} • anime-uke`;

  metaEl.textContent = `${ep.series_title || ''} · 👁 ${Number(ep.views ?? 0).toLocaleString('ro-RO')} vizionări`;

  crumb.href = `/series?id=${encodeURIComponent(ep.series_id)}`;
  crumb.textContent = `← ${ep.series_title || 'Înapoi la serie'}`;
  if (numEl) numEl.textContent = ep.episode_number;

  // Playerul se incarca doar dupa ce avem URL-urile validate pe server.
  renderSources(res.data.sources || []);

  // Navigare intre episoade + abonare + auto-next (nu blocam playerul pe ele)
  initEpNav(ep.series_id, ep.episode_number).catch(() => { /* optional */ });

  initComments(Number(id));
  loadComments(Number(id)).catch(() => { /* comentariile sunt optionale */ });

  watchThreshold = Number(res.data.watch_threshold) || 900;
  watchSeconds = Number(res.data.progress_seconds) || 0;
  watchedDone = !!res.data.watched;
  paintProgress();
  startHeartbeat();

  // Contor de vizualizari: merge in StatsDO (buffer), nu direct in D1.
  // Fara await — nu trebuie sa incetineasca afisarea paginii.
  api('/view', { method: 'POST', body: { episode_id: Number(id) } }).catch(() => {});
}

// ---------------------------------------------------------------------
// Scurtaturi de taste pentru fisierul video redat nativ.
//
// Fullscreen-ul NU e treaba noastra la embed-uri: butonul nativ al sursei
// (mp4upload, DoodStream…) functioneaza singur, pentru ca iframe-ul din
// episode.html are allowfullscreen + allow-fullscreen in sandbox. Un buton
// propriu peste al lui doar ar strica experienta.
// ---------------------------------------------------------------------
function initPlayerTools() {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const v = document.getElementById('player-video');
    const fileActive = v && !v.hidden;
    switch (e.key) {
      case ' ':
        if (fileActive) { e.preventDefault(); if (v.paused) v.play(); else v.pause(); }
        break;
      case 'm': case 'M':
        if (fileActive) v.muted = !v.muted;
        break;
      case 'ArrowRight':
        if (fileActive && Number.isFinite(v.duration)) v.currentTime = Math.min(v.duration, v.currentTime + 10);
        break;
      case 'ArrowLeft':
        if (fileActive) v.currentTime = Math.max(0, v.currentTime - 10);
        break;
      default:
        return;
    }
  });
}

// ---------------------------------------------------------------------
// Comentarii pe episod: lista, postare, stergere (proprie / admin).
// Textul se escape-uieste INTOTDEAUNA; singurul markup permis e tag-ul
// [spoiler], transformat intr-un span care se dezvaluie la click.
// ---------------------------------------------------------------------
function renderCommentBody(raw) {
  const safe = escapeHtml(raw)
    .replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<span class="spoiler">$1</span>')
    .replace(/\n/g, '<br>');
  return safe;
}

async function loadComments(episodeId) {
  const list = document.getElementById('comments-list');
  const count = document.getElementById('comments-count');
  if (!list) return;

  const res = await api(`/comments?episode_id=${encodeURIComponent(episodeId)}`);
  if (!res.ok) { list.innerHTML = '<p class="hint">Comentariile nu sunt disponibile acum.</p>'; return; }

  const me = await getSession();
  const items = res.data.comments || [];
  count.textContent = items.length ? `${items.length}` : '';
  list.innerHTML = '';

  if (!items.length) {
    list.innerHTML = '<p class="hint">Fii primul care comentează episodul ăsta.</p>';
    return;
  }

  for (const c of items) {
    const art = document.createElement('article');
    art.className = 'comment';

    const head = document.createElement('div');
    head.className = 'comment__head';
    const who = document.createElement('span');
    who.className = 'comment__who';
    who.textContent = c.username;
    const when = document.createElement('span');
    when.className = 'comment__when';
    when.textContent = formatDate(c.created_at);
    head.appendChild(who);
    for (const b of [staffBadge(c.staff), rankChip(c.rank)].filter(Boolean)) head.appendChild(b);
    head.appendChild(when);
    if (c.own || me?.is_admin) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'comment__del';
      del.textContent = '🗑';
      del.title = c.own ? 'Șterge comentariul' : 'Șterge (admin)';
      del.addEventListener('click', async () => {
        if (!confirm('Ștergi comentariul?')) return;
        const r = await api(`/comments?id=${c.id}`, { method: 'DELETE' });
        if (!r.ok) { toast(r.data?.error || 'Nu am putut șterge', 'err'); return; }
        loadComments(episodeId);
      });
      head.appendChild(del);
    }
    art.appendChild(head);

    const body = document.createElement('div');
    body.className = 'comment__body';
    body.innerHTML = renderCommentBody(c.body);
    art.appendChild(body);
    list.appendChild(art);
  }
}

function initComments(episodeId) {
  const form = document.getElementById('comment-form');
  const input = document.getElementById('comment-body');
  const hint = document.getElementById('comment-hint');
  if (!form) return;

  input.addEventListener('input', () => {
    hint.textContent = `${input.value.trim().length}/2000`;
  });

  // Dezvaluie spoilerele la click (delegare: span-urile apar dinamic).
  document.getElementById('comments-list')?.addEventListener('click', (e) => {
    const sp = e.target.closest('.spoiler');
    if (sp) sp.classList.add('spoiler--open');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text.length < 4) { toast('Comentariul e prea scurt.', 'warn'); return; }
    const btn = document.getElementById('comment-submit');
    btn.disabled = true;
    const r = await api('/comments', { method: 'POST', body: { episode_id: episodeId, body: text } });
    btn.disabled = false;
    if (!r.ok) { toast(r.data?.error || 'Nu am putut posta comentariul', 'err'); return; }
    input.value = '';
    hint.textContent = '';
    toast('Comentariul a fost postat.', 'ok');
    loadComments(episodeId);
  });
}

/**
 * Plasa de siguranta a paginii. Fara ea, o eroare aruncata in renderNav sau o
 * cerere care atarna lasa pagina in starea HTML initiala: titlu „Se incarca…",
 * bara de surse goala, spinner vesnic. Utilizatorul nu afla niciodata DE CE.
 * Acum orice esec devine un mesaj vizibil + un buton de reincercare.
 */
function showBootFailure(why) {
  const titleEl = document.getElementById('episode-title');
  if (titleEl && /încarcă/i.test(titleEl.textContent)) titleEl.textContent = 'Nu am putut încărca episodul';
  const box = showLoading(`${why} Verifică conexiunea și încearcă din nou.`);
  box.classList.remove('loading');
  box.classList.add('empty');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn--accent';
  retry.textContent = 'Reîncearcă';
  retry.addEventListener('click', () => location.reload());
  box.appendChild(retry);
  stopHeartbeat();
}

async function boot() {
  initPlayerTools();
  // nav-ul si continutul merg in paralel; load() are efecte secundare
  // (POST /view, heartbeat de watch-time) deci ruleaza doar cand pagina e
  // efectiv activa — un tab prerenderat nu trebuie sa numere vizionari
  await Promise.all([
    renderNav(''),
    new Promise((done) => whenActive(async () => { await load(); done(); })),
  ]);
}

// Ceas de paza: daca dupa 15s pagina e tot in starea initiala, ceva a atarnat
// (retea lenta, D1 rece, redirect blocat). Mai bine spunem decat tacem.
let booted = false;
const watchdog = setTimeout(() => {
  if (booted) return;
  const titleEl = document.getElementById('episode-title');
  if (titleEl && /încarcă/i.test(titleEl.textContent)) {
    showBootFailure('Încărcarea durează neobișnuit de mult.');
  }
}, 15000);

boot()
  .then(() => { booted = true; clearTimeout(watchdog); })
  .catch((e) => {
    booted = true;
    clearTimeout(watchdog);
    console.error('boot episode:', e);
    showBootFailure('A apărut o eroare la încărcarea paginii.');
  });

document.getElementById('back-btn')?.addEventListener('click', () => history.back());

// Avertizam la parăsirea paginii doar daca playerul e incarcat — evitam
// blocarea navigarii in mod inutil.
window.addEventListener('pageshow', (e) => { if (e.persisted) load(); });

// ---------------------------------------------------------------------
// 🚩 Raportare sursa stricata — cel mai ieftin semnal de calitate: cine
// vede ca nu merge, apasa un buton. +3 XP (din spec), dedup pe server.
// ---------------------------------------------------------------------
const REPORT_REASONS = [
  ['nu_porneste', 'Nu pornește'],
  ['se_intrerupe', 'Se întrerupe'],
  ['audio_sync', 'Audio nesincronizat'],
  ['sursa_moarta', 'Sursa e moartă'],
  ['altceva', 'Altceva'],
];

function initReport() {
  const btn = document.getElementById('report-btn');
  const panel = document.getElementById('report-panel');
  const reasonsBox = document.getElementById('report-reasons');
  const note = document.getElementById('report-note');
  if (!btn || !panel || !reasonsBox) return;

  let reason = 'nu_porneste';
  for (const [key, label] of REPORT_REASONS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'report-chip' + (key === reason ? ' is-on' : '');
    chip.textContent = label;
    chip.addEventListener('click', () => {
      reason = key;
      for (const c of reasonsBox.children) c.classList.remove('is-on');
      chip.classList.add('is-on');
    });
    reasonsBox.appendChild(chip);
  }

  btn.addEventListener('click', () => { panel.hidden = false; });
  document.getElementById('report-cancel')?.addEventListener('click', () => { panel.hidden = true; });

  document.getElementById('report-send')?.addEventListener('click', async (ev) => {
    const src = sources[activeSource];
    if (!src || !src.id) { toast('Nicio sursă activă de raportat.', 'warn'); return; }
    const sendBtn = ev.currentTarget;
    const prev = sendBtn.disabled;
    sendBtn.disabled = true;
    const res = await api('/report', {
      method: 'POST',
      body: { episode_id: episodeId, source_id: src.id, reason, note: note.value.trim() },
    });
    if (!res.ok && res.status !== 409) {
      sendBtn.disabled = prev;
      toast(res.data?.error || 'Nu am putut trimite raportul.', 'error');
      return;
    }
    panel.hidden = true;
    btn.textContent = res.status === 409 ? '✅ Deja raportat — mersi!' : '✅ Raportat — mulțumim! +3 XP';
    btn.disabled = true;
    toast(res.status === 409 ? 'Ai raportat deja sursa asta — o avem pe listă.' : 'Raport trimis! +3 XP pentru ajutor. 🙏', 'success');
  });
}

initReport();

// =====================================================================
// PLAYER v4: navigare intre episoade jos, mod cinema, auto-next.
// =====================================================================
let currentSeriesId = null;
let currentNumber = 0;
let epCtx = null;          // {list, page, pages, total, subscribed, subscriber_count}
let prevEp = null;
let nextEp = null;
const EP_PER = 100;

function qs(id) { return document.getElementById(id); }

async function fetchEpPage(seriesId, page) {
  const res = await api(`/series/${encodeURIComponent(seriesId)}?per_page=${EP_PER}&page=${page}`);
  if (!res.ok) return null;
  const d = res.data;
  return {
    list: (d.episodes || []).slice().sort((a, b) => a.episode_number - b.episode_number),
    page: d.page || page,
    pages: d.pages || 1,
    total: d.episode_count || 0,
    subscribed: !!d.subscribed,
    subscriber_count: d.subscriber_count || 0,
  };
}

/** Vecinul (+1/-1) din pagina curenta; la margini trage pagina vecina. */
async function sibling(delta) {
  if (!epCtx) return null;
  const target = currentNumber + delta;
  if (target < 1) return null;
  const inList = epCtx.list.find((e) => e.episode_number === target);
  if (inList) return inList;
  const targetPage = Math.floor((target - 1) / EP_PER) + 1;
  if (targetPage < 1 || targetPage > epCtx.pages || targetPage === epCtx.page) return null;
  const other = await fetchEpPage(currentSeriesId, targetPage);
  if (!other) return null;
  return (other.list || []).find((e) => e.episode_number === target) || null;
}

function paintEpNav() {
  const prev = qs('ep-prev');
  const next = qs('ep-next');
  if (prev) {
    prev.disabled = !prevEp;
    prev.onclick = () => { if (prevEp) location.href = `/episode?id=${prevEp.id}`; };
  }
  if (next) {
    next.disabled = !nextEp;
    next.onclick = () => { if (nextEp) location.href = `/episode?id=${nextEp.id}`; };
  }
}

function paintSubCta() {
  const btn = qs('ep-sub-btn');
  if (!btn || !epCtx) return;
  btn.hidden = false;
  const on = epCtx.subscribed;
  btn.textContent = on
    ? `✅ Primești notificări la episoade noi${epCtx.subscriber_count ? ` (${epCtx.subscriber_count})` : ''}`
    : '✉️ Vreau să știu când apare un nou episod';
  btn.classList.toggle('btn--accent', !on);
  btn.classList.toggle('btn--ghost', on);
  if (btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', async () => {
    const on = !epCtx.subscribed;
    const r = await api('/subscribe', { method: 'POST', body: { series_id: currentSeriesId, on: on ? 1 : 0 } });
    if (!r.ok) { toast(r.data?.error || 'Nu am putut schimba abonarea.', 'error'); return; }
    epCtx.subscribed = on;
    epCtx.subscriber_count = r.data.subscriber_count;
    paintSubCta();
    toast(on ? 'Perfect! Te anunțăm imediat ce apare un episod nou. 🔔' : 'Nu te mai anunțăm pentru seria asta.', 'success');
  });
}

// ------------------------- MODAL „ALTE EPIZOADE” -------------------------
function renderEpList() {
  const grid = qs('eplist-grid');
  const range = qs('eplist-range');
  if (!grid || !epCtx) return;
  grid.innerHTML = '';
  for (const e of epCtx.list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'eplist__ep' + (e.episode_number === currentNumber ? ' is-on' : '');
    b.textContent = String(e.episode_number);
    b.title = e.title || `Episodul ${e.episode_number}`;
    b.addEventListener('click', () => {
      qs('eplist-modal').hidden = true;
      if (e.id !== episodeId) location.href = `/episode?id=${e.id}`;
    });
    grid.appendChild(b);
  }
  if (epCtx.pages > 1) {
    range.hidden = false;
    const start = (epCtx.page - 1) * EP_PER + 1;
    const end = Math.min(epCtx.total, epCtx.page * EP_PER);
    qs('eplist-range-label').textContent = `Episoadele ${start}–${end} din ${epCtx.total}`;
    qs('eplist-prev').disabled = epCtx.page <= 1;
    qs('eplist-next').disabled = epCtx.page >= epCtx.pages;
  } else {
    range.hidden = true;
  }
}

async function gotoEpPage(page) {
  const other = await fetchEpPage(currentSeriesId, page);
  if (!other) return;
  epCtx = { ...epCtx, ...other };
  renderEpList();
}

function initEpListModal() {
  const modal = qs('eplist-modal');
  const open = qs('ep-list');
  if (!modal || !open || open.dataset.wired) return;
  open.dataset.wired = '1';
  open.addEventListener('click', () => { modal.hidden = false; renderEpList(); });
  qs('eplist-close')?.addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.hidden = true; });
  qs('eplist-prev')?.addEventListener('click', () => { if (epCtx && epCtx.page > 1) gotoEpPage(epCtx.page - 1); });
  qs('eplist-next')?.addEventListener('click', () => { if (epCtx && epCtx.page < epCtx.pages) gotoEpPage(epCtx.page + 1); });
}

// ------------------------------ AUTO-NEXT ------------------------------
const autonextOn = () => localStorage.getItem('auk-autonext') !== '0';
let autonextTimer = null;

function stopAutoNext() {
  if (autonextTimer) { clearInterval(autonextTimer); autonextTimer = null; }
  const box = qs('autonext');
  if (box) box.hidden = true;
}

function startAutoNext() {
  if (!nextEp || !autonextOn()) return;
  const box = qs('autonext');
  const count = qs('autonext-count');
  if (!box || !count) return;
  qs('autonext-name').textContent =
    `Episodul ${nextEp.episode_number}${nextEp.title ? ` — ${nextEp.title}` : ''}`;
  let n = 10;
  count.textContent = String(n);
  box.hidden = false;
  autonextTimer = setInterval(() => {
    n -= 1;
    count.textContent = String(Math.max(0, n));
    if (n <= 0) {
      stopAutoNext();
      location.href = `/episode?id=${nextEp.id}`;
    }
  }, 1000);
}

function paintAutoBtn() {
  const b = qs('autonext-btn');
  if (!b) return;
  b.classList.toggle('ptool--on', autonextOn());
  b.textContent = `⏭ Auto-next: ${autonextOn() ? 'pornit' : 'oprit'}`;
}

function initAutoNext() {
  const b = qs('autonext-btn');
  if (b && !b.dataset.wired) {
    b.dataset.wired = '1';
    b.addEventListener('click', () => {
      localStorage.setItem('auk-autonext', autonextOn() ? '0' : '1');
      paintAutoBtn();
      if (!autonextOn()) stopAutoNext();
      toast(autonextOn() ? 'Auto-next pornit: la final trecem singuri la următorul episod.' : 'Auto-next oprit.', 'success');
    });
  }
  paintAutoBtn();
  qs('autonext-cancel')?.addEventListener('click', stopAutoNext);
  qs('autonext-go')?.addEventListener('click', () => { if (nextEp) location.href = `/episode?id=${nextEp.id}`; });
  // doar sursele de tip fisier ne spun cand s-au terminat
  qs('player-video')?.addEventListener('ended', startAutoNext);
}

// ------------------------------ MOD CINEMA ------------------------------
const cinemaOn = () => localStorage.getItem('auk-cinema') !== '0';

function paintCinema() {
  document.body.classList.toggle('cinema', cinemaOn());
  const b = qs('cinema-btn');
  if (b) b.classList.toggle('ptool--on', cinemaOn());
}

function initCinema() {
  const b = qs('cinema-btn');
  if (b && !b.dataset.wired) {
    b.dataset.wired = '1';
    b.addEventListener('click', () => {
      localStorage.setItem('auk-cinema', cinemaOn() ? '0' : '1');
      paintCinema();
    });
  }
  paintCinema();
}

// ------------------------------- TASTA N -------------------------------
document.addEventListener('keydown', (ev) => {
  const tag = (ev.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if ((ev.key === 'n' || ev.key === 'N') && nextEp) location.href = `/episode?id=${nextEp.id}`;
});

async function initEpNav(seriesId, number) {
  currentSeriesId = seriesId;
  currentNumber = number;
  initCinema();
  initAutoNext();
  initEpListModal();
  if (!seriesId) return;
  epCtx = await fetchEpPage(seriesId, Math.floor((number - 1) / EP_PER) + 1);
  if (!epCtx) return;
  [prevEp, nextEp] = await Promise.all([sibling(-1), sibling(1)]);
  paintEpNav();
  paintSubCta();
}
