import { api, renderNav, toast, withBusy, getSession, formatDate, safeUrl, genPoster } from './core.js';
import { buildSourceRow, collectSourceRows, existingSourceRow, sourceChips, guessKind, labelFromUrl, KIND_HINTS } from './sources-ui.js';

// =====================================================================
// /admin/serie/<id> — o singura serie: episoadele ei, sursele lor si
// postarea in bloc.
//
// De ce o pagina pe serie, in loc de un tabel cu toate episoadele:
// la 1000+ serii si zeci de mii de episoade, un tabel global nu se mai
// incarca nici macar paginat intr-un mod util. Adminul gandeste pe serii —
// „adaug episodul 12 la Frieren" — deci navigatia urmeaza acelasi drum.
// =====================================================================

const EP_PER_PAGE = 50;

// id-ul seriei vine din cale, nu din query — de asta exista ruta dinamica.
const seriesId = Number((location.pathname.match(/^\/admin\/serie\/(\d+)/) || [])[1]);

let me = null;
let series = null;
let meta = null;
let epPage = 1;
let epQuery = '';
let epTimer = null;
let currentSourcesEp = null;
let currentEditEp = null;
let bulkParsed = null;

async function guard() {
  me = await getSession();
  if (!me) { location.replace(`/login?next=${encodeURIComponent(location.pathname)}`); return false; }
  if (!me.is_admin) { location.replace('/'); return false; }
  if (!Number.isInteger(seriesId) || seriesId <= 0) { location.replace('/admin/serii'); return false; }
  return true;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function emptyRow(cols, text) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = cols;
  td.className = 'src-empty';
  td.textContent = text;
  tr.appendChild(td);
  return tr;
}

function toggle(id, force) {
  const p = document.getElementById(id);
  if (!p) return false;
  p.hidden = force !== undefined ? !force : !p.hidden;
  return !p.hidden;
}

// ---------------------------------------------------------------- seria
async function loadSeries() {
  const res = await api(`/admin/series?id=${seriesId}`);
  if (!res.ok) {
    document.getElementById('ser-title').textContent = 'Serie indisponibilă';
    document.getElementById('ser-sub').textContent = res.data?.error || 'Nu am putut încărca seria.';
    document.getElementById('ep-title').textContent = 'Episoade';
    return false;
  }
  series = res.data.series;
  renderSeries();
  return true;
}

function renderSeries() {
  document.getElementById('ser-title').textContent = series.title;
  document.title = `${series.title} • Admin • anime-uke`;
  document.getElementById('ser-sub').textContent =
    `${series.episode_count ?? 0} episoade · ${Number(series.total_views ?? 0).toLocaleString('ro-RO')} vizionări`
    + (series.created_by_name ? ` · adăugată de ${series.created_by_name}` : '')
    + (series.created_at ? ` · ${formatDate(series.created_at)}` : '');

  const poster = document.getElementById('ser-poster');
  poster.innerHTML = '';
  if (series.cover_image) {
    const img = document.createElement('img');
    img.src = safeUrl(series.cover_image, '');
    img.alt = series.title;
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(genPoster(series.title)), { once: true });
    poster.appendChild(img);
  } else {
    poster.appendChild(genPoster(series.title));
  }

  const facts = document.getElementById('ser-facts');
  facts.innerHTML = '';
  const rows = [
    ['Status', series.status === 'completed' ? 'Finalizat' : 'În difuzare'],
    ['Gen', series.genre || '—'],
    ['An', series.year ? String(series.year) : '—'],
    ['Episoade', String(series.episode_count ?? 0)],
    ['Vizionări totale', Number(series.total_views ?? 0).toLocaleString('ro-RO')],
  ];
  for (const [k, v] of rows) {
    const row = el('div', 'info-row');
    row.append(el('dt', 'info-row__label', k), el('dd', 'info-row__value', v));
    facts.appendChild(row);
  }
  if (series.description) facts.appendChild(el('p', 'ser-desc', series.description));

  const link = el('a', 'btn btn--ghost btn--sm', '👁 Vezi pagina publică');
  link.href = `/series?id=${seriesId}`;
  link.target = '_blank';
  link.rel = 'noopener';
  facts.appendChild(link);
}

document.getElementById('ser-edit')?.addEventListener('click', () => {
  const f = document.getElementById('series-edit-form');
  f.title.value = series?.title || '';
  f.status.value = series?.status || 'ongoing';
  f.year.value = series?.year ?? '';
  f.genre.value = series?.genre || '';
  f.cover_image.value = series?.cover_image || '';
  f.description.value = series?.description || '';
  toggle('ser-edit-panel', true);
  f.title.focus();
});
document.getElementById('ser-edit-cancel')?.addEventListener('click', () => toggle('ser-edit-panel', false));

document.getElementById('series-edit-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = document.getElementById('ser-edit-save');

  await withBusy(btn, async () => {
    const res = await api('/admin/series', {
      method: 'PATCH',
      body: {
        id: seriesId,
        title: f.title.value.trim(),
        status: f.status.value,
        year: f.year.value ? Number(f.year.value) : null,
        genre: f.genre.value.trim(),
        cover_image: f.cover_image.value.trim(),
        description: f.description.value.trim(),
      },
    });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut salva seria', 'err', 5000); return; }
    toast('Serie salvată', 'ok');
    toggle('ser-edit-panel', false);
    await loadSeries();
  });
});

document.getElementById('ser-delete')?.addEventListener('click', async () => {
  const n = Number(series?.episode_count ?? 0);
  if (!confirm(`Ștergi „${series?.title}"${n ? ` și cele ${n} episoade` : ''}? Nu poți anula.`)) return;
  const res = await api(`/admin/series?id=${seriesId}`, { method: 'DELETE' });
  if (!res.ok) { toast(res.data?.error || 'Nu am putut șterge', 'err'); return; }
  toast('Serie ștearsă', 'ok');
  setTimeout(() => { location.href = '/admin/serii'; }, 600);
});

// ---------------------------------------------------------------- episoade
async function loadEpisodes() {
  const tbody = document.querySelector('#episodes-table tbody');
  tbody.innerHTML = '';
  tbody.appendChild(emptyRow(5, 'Se încarcă…'));

  const params = new URLSearchParams({
    series_id: String(seriesId), page: String(epPage), per_page: String(EP_PER_PAGE),
  });
  if (epQuery) params.set('q', epQuery);

  const res = await api(`/admin/episodes?${params}`);
  if (!res.ok) {
    tbody.innerHTML = '';
    tbody.appendChild(emptyRow(5, res.data?.error || 'Nu am putut încărca episoadele'));
    return;
  }

  const eps = res.data.episodes || [];
  tbody.innerHTML = '';
  if (!eps.length) {
    tbody.appendChild(emptyRow(5, epQuery ? `Niciun episod pentru „${epQuery}"` : 'Niciun episod încă. Adaugă primul mai sus.'));
  } else {
    for (const ep of eps) tbody.appendChild(episodeRow(ep));
  }

  document.getElementById('ep-title').textContent =
    `Episoade${res.data.total != null ? ` (${res.data.total})` : ''}`;

  const pager = document.getElementById('ep-pager');
  const pages = Math.max(1, Math.ceil((res.data.total ?? eps.length) / EP_PER_PAGE));
  pager.hidden = pages <= 1 && !res.data.has_more;
  document.getElementById('ep-info').textContent = `Pagina ${res.data.page} din ${pages}`;
  document.getElementById('ep-prev').disabled = res.data.page <= 1;
  document.getElementById('ep-next').disabled = !res.data.has_more;
}

function episodeRow(ep) {
  const tr = document.createElement('tr');

  tr.appendChild(el('td', 'ep-num', String(ep.episode_number)));
  tr.appendChild(el('td', '', ep.title || '—'));
  tr.appendChild(sourceChips(ep.sources));
  tr.appendChild(el('td', '', Number(ep.views || 0).toLocaleString('ro-RO')));

  const td = document.createElement('td');
  const wrap = el('div', 'actions');

  const src = el('button', 'btn btn--accent btn--sm', `Surse (${(ep.sources || []).length})`);
  src.type = 'button';
  src.addEventListener('click', () => openSources(ep));

  const edit = el('button', 'btn btn--ghost btn--sm', 'Editează');
  edit.type = 'button';
  edit.addEventListener('click', () => openEpisodeEdit(ep));

  const view = el('a', 'btn btn--ghost btn--sm', 'Vezi');
  view.href = `/episode?id=${ep.id}`;
  view.target = '_blank';
  view.rel = 'noopener';

  const del = el('button', 'btn btn--danger btn--sm', 'Șterge');
  del.type = 'button';
  del.addEventListener('click', () => deleteEpisode(ep));

  wrap.append(src, edit, view, del);
  td.appendChild(wrap);
  tr.appendChild(td);
  return tr;
}

async function deleteEpisode(ep) {
  if (!confirm(`Ștergi episodul ${ep.episode_number}${ep.title ? ` — ${ep.title}` : ''}?`)) return;
  const res = await api(`/admin/episodes?id=${ep.id}`, { method: 'DELETE' });
  if (!res.ok) { toast(res.data?.error || 'Nu am putut șterge episodul', 'err'); return; }
  toast('Episod șters', 'ok');
  if (currentSourcesEp?.id === ep.id) closeSources();
  await Promise.all([loadEpisodes(), loadSeries()]);
}

document.getElementById('ep-prev')?.addEventListener('click', () => { if (epPage > 1) { epPage--; loadEpisodes(); } });
document.getElementById('ep-next')?.addEventListener('click', () => { epPage++; loadEpisodes(); });

document.getElementById('ep-q')?.addEventListener('input', (e) => {
  clearTimeout(epTimer);
  const v = e.target.value.trim();
  epTimer = setTimeout(() => { epQuery = v; epPage = 1; loadEpisodes(); }, 280);
});

// ---------------------------------------------------------------- adaugare unica
function addFormSourceRow(src) {
  const box = document.getElementById('e-sources');
  if (box.querySelectorAll('.src-row').length >= (meta?.max || 12)) {
    toast(`Maximum ${meta?.max || 12} surse per episod`, 'warn');
    return;
  }
  box.appendChild(buildSourceRow(meta, src, { onRemove: syncSourceCount }));
  syncSourceCount();
}

function syncSourceCount() {
  const box = document.getElementById('e-sources');
  const out = document.getElementById('e-sources-count');
  const n = box.querySelectorAll('.src-row').length;
  const max = meta?.max || 12;
  if (out) out.textContent = n ? `${n} / ${max} surse` : '';
  const btn = document.getElementById('e-add-source');
  if (btn) btn.disabled = n >= max;
}

document.getElementById('e-add-source')?.addEventListener('click', () => addFormSourceRow({}));
document.getElementById('toggle-ep-form')?.addEventListener('click', () => {
  if (toggle('ep-create-panel')) {
    addFormSourceRow({});
    document.getElementById('e-number').focus();
  }
});
document.getElementById('ep-cancel')?.addEventListener('click', () => toggle('ep-create-panel', false));

document.getElementById('episode-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = document.getElementById('episode-submit');
  const sources = collectSourceRows(document.getElementById('e-sources'));

  if (!sources.length) { toast('Adaugă cel puțin o sursă video', 'warn'); return; }

  await withBusy(btn, async () => {
    const res = await api('/admin/episodes', {
      method: 'POST',
      body: {
        series_id: seriesId,
        episode_number: Number(f.episode_number.value),
        subtitle_url: (f.subtitle_url?.value || '').trim(),
        title: f.title.value.trim(),
        sources,
      },
    });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut adăuga episodul', 'err', 5000); return; }

    toast(`Episodul ${f.episode_number.value} a fost adăugat`, 'ok');
    f.reset();
    document.getElementById('e-sources').innerHTML = '';
    addFormSourceRow({});
    await Promise.all([loadEpisodes(), loadSeries()]);
  });
});

// ---------------------------------------------------------------- editare episod
function openEpisodeEdit(ep) {
  currentEditEp = ep;
  const f = document.getElementById('episode-edit-form');
  f.episode_number.value = ep.episode_number;
  f.title.value = ep.title || '';
  if (f.subtitle_url) f.subtitle_url.value = ep.subtitle_url || '';
  document.getElementById('ep-edit-title').textContent = `Editează episodul ${ep.episode_number}`;
  toggle('ep-edit-panel', true);
  f.title.focus();
}

document.getElementById('ep-edit-cancel')?.addEventListener('click', () => toggle('ep-edit-panel', false));

document.getElementById('episode-edit-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = document.getElementById('ep-edit-save');

  await withBusy(btn, async () => {
    const res = await api('/admin/episodes', {
      method: 'PATCH',
      body: { id: currentEditEp.id, episode_number: Number(f.episode_number.value), title: f.title.value.trim(), subtitle_url: (f.subtitle_url?.value || '').trim() },
    });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut salva', 'err', 5000); return; }
    toast('Episod salvat', 'ok');
    toggle('ep-edit-panel', false);
    await loadEpisodes();
  });
});

// ---------------------------------------------------------------- surse
async function openSources(ep) {
  currentSourcesEp = ep;
  document.getElementById('sources-panel-title').textContent =
    `Surse — Episodul ${ep.episode_number}${ep.title ? ` (${ep.title})` : ''}`;
  toggle('sources-panel', true);
  await refreshSources();
  document.getElementById('sources-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeSources() {
  currentSourcesEp = null;
  toggle('sources-panel', false);
}

async function refreshSources() {
  const box = document.getElementById('sources-list');
  box.innerHTML = '';
  if (!currentSourcesEp) return;

  const res = await api(`/admin/episode-sources?episode_id=${currentSourcesEp.id}`);
  if (!res.ok) { box.appendChild(el('div', 'src-empty', res.data?.error || 'Eroare')); return; }

  const list = res.data.sources || [];
  if (!list.length) {
    box.appendChild(el('div', 'src-empty', 'Episodul ăsta nu are nicio sursă. Adaugă una mai jos.'));
    return;
  }
  for (const src of list) {
    box.appendChild(existingSourceRow(meta, src, {
      api, toast, withBusy,
      onChanged: async () => { await refreshSources(); await loadEpisodes(); },
    }));
  }
}

document.getElementById('sources-close')?.addEventListener('click', closeSources);

document.getElementById('s-kind')?.addEventListener('change', (e) => {
  const hint = document.getElementById('s-kind-hint');
  if (hint) hint.textContent = KIND_HINTS[e.target.value] || '';
});

// La lipirea unui URL in formularul de sursa, deducem tipul si eticheta.
document.getElementById('s-url')?.addEventListener('blur', (e) => {
  const v = e.target.value.trim();
  if (!v) return;
  const label = document.getElementById('s-label');
  if (!label.value.trim()) label.value = labelFromUrl(v);
  const kind = document.getElementById('s-kind');
  if (!kind.dataset.touched) kind.value = guessKind(v);
});
document.getElementById('s-kind')?.addEventListener('change', (e) => { e.target.dataset.touched = '1'; });

document.getElementById('source-add-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentSourcesEp) return;
  const f = e.currentTarget;
  const data = Object.fromEntries(new FormData(f).entries());
  const btn = document.getElementById('source-add-submit');

  await withBusy(btn, async () => {
    const res = await api('/admin/episode-sources', {
      method: 'POST',
      body: {
        episode_id: currentSourcesEp.id,
        label: (data.label || '').trim(),
        kind: data.kind,
        url: (data.url || '').trim(),
      },
    });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut adăuga sursa', 'err', 5000); return; }
    toast('Sursă adăugată', 'ok');
    f.reset();
    delete f.kind.dataset.touched;
    await refreshSources();
    await loadEpisodes();
  });
});

// ---------------------------------------------------------------- postare in bloc
/**
 * Parsam lista in browser si aratam un preview inainte de trimitere.
 * Format: `număr | titlu | url1, url2` (titlul e optional).
 */
function parseBulk(text) {
  const episodes = [];
  const errors = [];
  const seen = new Set();

  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const n = idx + 1;

    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 2) {
      errors.push({ line: n, error: 'Format așteptat: număr | titlu | url1, url2' });
      return;
    }

    const num = Number(parts[0]);
    if (!Number.isInteger(num) || num < 1 || num > 10000) {
      errors.push({ line: n, error: `„${parts[0]}" nu e un număr de episod valid` });
      return;
    }
    if (seen.has(num)) {
      errors.push({ line: n, error: `Episodul ${num} apare de două ori în listă` });
      return;
    }
    seen.add(num);

    // Doua campuri = numar + url-uri; trei sau mai multe = numar + titlu + url-uri.
    let title = '';
    let urlsPart;
    if (parts.length === 2) {
      urlsPart = parts[1];
    } else {
      title = parts[1];
      urlsPart = parts.slice(2).join(',');
    }

    const urls = urlsPart.split(',').map((u) => u.trim()).filter(Boolean);

    // Un episod FARA sursa e valid: serverul il accepta, formularul de episod
    // singular il accepta, iar sursele se pot adauga oricand mai tarziu din
    // panoul de surse. Inainte bulk-ul respingea liniile de genul „3 |", ceea
    // ce facea ca lipirea unei liste de numere sa esueze fara motiv — si ca
    // postarea in bloc sa fie mai stricta decat postarea unu cate unu.
    // Semnalam totusi in previzualizare cate episoade raman fara sursa, ca sa
    // nu treaca neobservat un URL uitat.
    const badUrl = urls.find((u) => !/^https:\/\/\S+$/i.test(u));
    if (badUrl) { errors.push({ line: n, error: `URL invalid (trebuie https): ${badUrl}` }); return; }

    episodes.push({
      episode_number: num,
      title,
      sources: urls.map((u) => ({ label: labelFromUrl(u), kind: guessKind(u), url: u })),
    });
  });

  return { episodes, errors };
}

function renderBulkReport(parsed) {
  const box = document.getElementById('bulk-report');
  box.innerHTML = '';
  box.hidden = false;

  const head = el('div', 'bulk-report__head');
  head.append(
    el('b', '', `${parsed.episodes.length} ${parsed.episodes.length === 1 ? 'episod' : 'episoade'} de creat`),
    el('span', parsed.errors.length ? 'bulk-report__err' : 'bulk-report__ok',
      parsed.errors.length ? `${parsed.errors.length} probleme` : 'fără probleme')
  );
  const noSrc = parsed.episodes.filter((e) => !e.sources.length).length;
  if (noSrc) {
    head.appendChild(el('span', 'bulk-report__warn',
      `${noSrc} fără sursă — le poți adăuga după din panoul de surse`));
  }
  box.appendChild(head);

  if (parsed.episodes.length) {
    const prev = document.createElement('div');
    prev.className = 'bulk-preview';
    for (const ep of parsed.episodes.slice(0, 60)) {
      const row = el('div', 'bulk-preview__row');
      row.append(
        el('span', 'bulk-preview__num', `Ep. ${ep.episode_number}`),
        el('span', 'bulk-preview__title', ep.title || '(fără titlu)'),
        el('span', 'bulk-preview__src', ep.sources.map((s) => `${s.label} [${s.kind}]`).join(' · '))
      );
      prev.appendChild(row);
    }
    if (parsed.episodes.length > 60) {
      prev.appendChild(el('div', 'bulk-preview__row hint', `…și încă ${parsed.episodes.length - 60}`));
    }
    box.appendChild(prev);
  }

  if (parsed.errors.length) {
    const errBox = document.createElement('div');
    errBox.className = 'bulk-errors';
    for (const e of parsed.errors.slice(0, 40)) {
      errBox.appendChild(el('div', 'bulk-errors__row', `Linia ${e.line}: ${e.error}`));
    }
    if (parsed.errors.length > 40) errBox.appendChild(el('div', 'hint', `…și încă ${parsed.errors.length - 40}`));
    box.appendChild(errBox);
  }

  document.getElementById('bulk-submit').disabled = parsed.episodes.length === 0;
}

document.getElementById('toggle-bulk')?.addEventListener('click', () => {
  if (toggle('bulk-panel')) document.getElementById('bulk-text').focus();
});
document.getElementById('bulk-cancel')?.addEventListener('click', () => {
  toggle('bulk-panel', false);
  document.getElementById('bulk-report').hidden = true;
  bulkParsed = null;
  document.getElementById('bulk-submit').disabled = true;
});

document.getElementById('bulk-preview')?.addEventListener('click', () => {
  bulkParsed = parseBulk(document.getElementById('bulk-text').value);
  if (!bulkParsed.episodes.length && !bulkParsed.errors.length) {
    toast('Lista e goală', 'warn');
    return;
  }
  renderBulkReport(bulkParsed);
});

document.getElementById('bulk-submit')?.addEventListener('click', async () => {
  const btn = document.getElementById('bulk-submit');
  // Recitim textul: adminul poate fi editat dupa ultimul preview.
  bulkParsed = parseBulk(document.getElementById('bulk-text').value);
  if (!bulkParsed.episodes.length) { renderBulkReport(bulkParsed); return; }

  await withBusy(btn, async () => {
    const res = await api('/admin/episodes', {
      method: 'POST',
      body: { series_id: seriesId, episodes: bulkParsed.episodes },
    });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut crea episoadele', 'err', 6000); return; }

    const d = res.data || {};
    toast(`${d.created ?? 0} episoade create${d.skipped ? `, ${d.skipped} sărite` : ''}`, d.created ? 'ok' : 'warn', 6000);
    if (d.errors?.length) renderBulkReport({ episodes: [], errors: d.errors.map((e) => ({ line: e.line, error: e.error })) });

    if (d.created) {
      document.getElementById('bulk-text').value = '';
      document.getElementById('bulk-report').hidden = true;
      toggle('bulk-panel', false);
      epPage = 1;
      await Promise.all([loadEpisodes(), loadSeries()]);
    }
  });
});

// ---------------------------------------------------------------- pornire
if (await guard()) {
  await renderNav('');

  const metaRes = await api('/admin/episode-sources?meta=1');
  if (metaRes.ok) meta = metaRes.data;

  const ok = await loadSeries();
  if (ok) {
    addFormSourceRow({});
    await loadEpisodes();
  }
}
