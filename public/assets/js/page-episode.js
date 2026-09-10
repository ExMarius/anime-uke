import { api, renderNav, toast, getSession, clearSession, withBusy, safeUrl } from './core.js';

// Pagina episodului: player DoodStream + contor vizualizari + puncte.
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

async function load() {
  const id = getParam('id');
  const titleEl = document.getElementById('episode-title');
  const metaEl = document.getElementById('episode-meta');
  const crumb = document.getElementById('breadcrumb');
  const numEl = document.getElementById('episode-num');
  const iframe = document.getElementById('player');
  const loading = document.getElementById('player-loading');

  if (!id) { location.replace('/'); return; }

  const res = await api(`/episodes/${encodeURIComponent(id)}`);

  if (!res.ok) {
    titleEl.textContent = 'Episod indisponibil';
    metaEl.textContent = '';
    document.getElementById('episode-num').textContent = '✕';
    loading.textContent = res.status === 404 ? 'Episodul nu există.' : 'Nu am putut încărca episodul.';
    loading.classList.remove('loading');
    loading.classList.add('empty');
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

  // Playerul se incarca doar dupa ce avem URL-ul validat pe server.
  const url = safeUrl(ep.doodstream_url, '');
  if (url && url !== '#') {
    iframe.src = url;
    iframe.hidden = false;
    iframe.addEventListener('load', () => loading.remove(), { once: true });
    // Fallback daca load nu se declanseaza (unele embed-uri blocheaza)
    setTimeout(() => loading.remove(), 6000);
  } else {
    loading.textContent = 'Playerul nu e disponibil pentru episodul ăsta.';
  }

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
