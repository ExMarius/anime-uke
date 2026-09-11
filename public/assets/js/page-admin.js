import { api, renderNav, toast, withBusy, getSession, formatDate, safeUrl } from './core.js';

// =====================================================================
// Panoul admin. Toate celulele sunt construite cu createElement +
// textContent, niciodata innerHTML cu date din DB — titlurile de serii si
// username-urile sunt continut generat de utilizatori, deci innerHTML ar
// redeschide gaura de XSS din v1.
// =====================================================================

let me = null;
let seriesList = [];

// ---------------------------------------------------------------------
// GUARD: serverul oricum respinge non-adminii (403), dar evitam sa
// incarcam tot panoul pentru un utilizator normal.
// ---------------------------------------------------------------------
async function guard() {
  me = await getSession();
  if (!me) { location.replace('/login?next=/admin'); return false; }
  if (!me.is_admin) {
    document.querySelector('main').innerHTML =
      '<div class="empty"><div class="empty__icon">🔒</div><h2 class="section__title section__title--plain" style="justify-content:center">403 — Acces interzis</h2>' +
      '<p class="hint">Nu ai acces la panoul de administrare.</p>' +
      '<p style="margin-top:1.2rem"><a class="btn btn--accent" href="/">Înapoi la serii</a></p></div>';
    return false;
  }
  document.getElementById('admin-who').textContent = `Logat ca ${me.username}`;
  return true;
}

// ---------------------------------------------------------------------
// TABURI
// ---------------------------------------------------------------------
const LOADERS = {
  stats: loadStats,
  series: loadSeriesTab,
  episodes: loadEpisodesTab,
  users: loadUsers,
  invites: loadInvites,
  log: loadLog,
};

function initTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab));
  });
}

function selectTab(tab) {
  const key = tab.id.replace('tab-', '');
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== `panel-${key}`; });
  LOADERS[key]?.();
}

// ---------------------------------------------------------------------
// STATISTICI
// ---------------------------------------------------------------------
async function loadStats() {
  const box = document.getElementById('stats-cards');
  const res = await api('/admin/stats');
  if (!res.ok) { toast(res.data?.error || 'Nu am putut încărca statisticile', 'err'); return; }

  const s = res.data.stats;
  const cards = [
    ['Utilizatori', s.total_users],
    ['Admini', s.total_admins],
    ['Banați', s.total_banned],
    ['Serii', s.total_series],
    ['Episoade', s.total_episodes],
    ['Vizionări', s.total_views],
    ['Marcate ca văzute', s.total_watched],
    ['Mesaje chat', s.total_chat_messages],
  ];

  box.innerHTML = '';
  for (const [label, value] of cards) {
    const el = document.createElement('div');
    el.className = 'stat';
    const v = document.createElement('div');
    v.className = 'stat__value';
    v.textContent = Number(value || 0).toLocaleString('ro-RO');
    const l = document.createElement('div');
    l.className = 'stat__label';
    l.textContent = label;
    el.append(v, l);
    box.appendChild(el);
  }

  fillTable('top-episodes', ['Serie', 'Episod', 'Vizionări'], res.data.top_episodes, (ep) => [
    ep.series_title, `Ep. ${ep.episode_number} — ${ep.title || ''}`, Number(ep.views || 0).toLocaleString('ro-RO'),
  ], 'Niciun episod încă.');

  fillTable('latest-users', ['Username', 'Puncte', 'Înscris'], res.data.latest_users, (u) => [
    u.username, u.points, formatDate(u.created_at),
  ], 'Niciun utilizator încă.');
}

/** Umple un tabel simplu; header-ul e definit in HTML, adaugam doar randurile. */
function fillTable(tableId, columns, rows, mapFn, emptyText) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
  tbody.innerHTML = '';

  if (!rows || !rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columns.length;
    td.style.color = 'var(--text-dim)';
    td.textContent = emptyText || '—';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of mapFn(row)) {
      const td = document.createElement('td');
      td.textContent = cell ?? '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------------------
// SERII
// ---------------------------------------------------------------------
async function loadSeriesTab() {
  const res = await api('/admin/series');
  if (!res.ok) { toast(res.data?.error || 'Eroare la încărcarea seriilor', 'err'); return; }
  seriesList = res.data.series || [];
  renderSeriesTable();
  populateSeriesDropdown();
}

function renderSeriesTable() {
  const tbody = document.querySelector('#series-table tbody');
  tbody.innerHTML = '';

  if (!seriesList.length) {
    tbody.appendChild(emptyRow(8, 'Nicio serie încă. Adaugă prima mai sus.'));
    return;
  }

  for (const s of seriesList) {
    const tr = document.createElement('tr');
    tr.append(
      cell(s.id),
      cell(s.title),
      cell(s.genre || '—'),
      cell(s.year || '—'),
      pill(s.status === 'completed' ? 'Finalizat' : 'În difuzare', s.status === 'completed' ? 'pill--admin' : 'pill--user'),
      cell(s.episode_count ?? 0),
      cell(s.created_by_name || '—'),
      actionsCell([
        {
          label: `🔗 Vezi (${s.episode_count ?? 0} ep.)`,
          cls: 'btn btn--ghost btn--sm',
          href: `/series?id=${s.id}`,
        },
        {
          label: 'Șterge',
          cls: 'btn btn--danger btn--sm',
          danger: true,
          confirm: `Ștergi seria „${s.title}" și TOATE episoadele ei?`,
          onClick: () => deleteSeries(s.id, s.title),
        },
      ]),
    );
    tbody.appendChild(tr);
  }
}

async function deleteSeries(id, title) {
  if (!confirm(`Ștergi seria „${title}" și toate episoadele ei? Acțiunea e ireversibilă.`)) return;
  const res = await api(`/admin/series?id=${id}`, { method: 'DELETE' });
  if (!res.ok) { toast(res.data?.error || 'Nu am putut șterge seria', 'err'); return; }
  toast(`Seria „${title}" a fost ștearsă`, 'ok');
  loadSeriesTab();
  loadStats();
}

document.getElementById('series-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = document.getElementById('series-submit');
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.year === '') data.year = null;

  await withBusy(btn, async () => {
    const res = await api('/admin/series', { method: 'POST', body: data });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut adăuga seria', 'err'); return; }
    toast(`Seria „${data.title}" a fost adăugată`, 'ok');
    form.reset();
    loadSeriesTab();
    loadStats();
  });
});

// ---------------------------------------------------------------------
// EPISOADE
// ---------------------------------------------------------------------
function populateSeriesDropdown() {
  const sel = document.getElementById('e-series');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '';

  if (!seriesList.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— adaugă întâi o serie —';
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  for (const s of seriesList) {
    const opt = document.createElement('option');
    opt.value = String(s.id);
    opt.textContent = s.title;
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}

// ---------------------------------------------------------------------
// SURSE VIDEO
//
// Un episod poate avea mai multe surse. Doua locuri unde se gestioneaza:
//   1. formularul de creare a episodului — o lista de randuri editabile,
//   2. panoul de surse de sub tabelul de episoade — pentru episoade existente.
//
// Meta (tipuri + furnizori sugerati) vine de pe server, ca lista sa fie
// definita intr-un singur loc si sa nu derive de validarea din surse.js.
// ---------------------------------------------------------------------
let sourcesMeta = { kinds: [], providers: [], max: 12 };

const KIND_HINTS = {
  embed: 'Se deschide într-un iframe sandbox.',
  file: 'Redat cu playerul nativ al browserului (trebuie .mp4/.webm/.m3u8).',
  link: 'Nu e înglobat — utilizatorul primește un buton care deschide pagina.',
};

async function loadSourcesMeta() {
  const res = await api('/admin/episode-sources?meta=1');
  if (res.ok && res.data) sourcesMeta = { max: 12, ...res.data };
}

function kindOptions(select, selected) {
  select.innerHTML = '';
  const kinds = sourcesMeta.kinds?.length
    ? sourcesMeta.kinds
    : [{ value: 'embed', label: 'Embed (iframe)' }, { value: 'file', label: 'Fișier video' }, { value: 'link', label: 'Link extern' }];
  for (const k of kinds) {
    const opt = document.createElement('option');
    opt.value = k.value;
    opt.textContent = k.label;
    select.appendChild(opt);
  }
  if (selected) select.value = selected;
}

/** Un rand de sursa in formularul de creare a episodului. */
function buildSourceRow(src = {}) {
  const row = document.createElement('div');
  row.className = 'src-row';

  const label = document.createElement('input');
  label.className = 'input src-row__label';
  label.type = 'text';
  label.maxLength = 40;
  label.placeholder = 'Etichetă (ex. DoodStream)';
  label.value = src.label || '';
  label.name = 'src_label';

  const kind = document.createElement('select');
  kind.className = 'select src-row__kind';
  kind.name = 'src_kind';
  kindOptions(kind, src.kind || 'embed');

  const url = document.createElement('input');
  url.className = 'input src-row__url';
  url.type = 'url';
  url.name = 'src_url';
  url.placeholder = src.hint || 'https://doodstream.com/e/abc123';
  url.value = src.url || '';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn--danger btn--sm src-row__del';
  del.title = 'Scoate sursa asta';
  del.textContent = '✕';
  del.addEventListener('click', () => { row.remove(); syncSourceCount(); });

  // Selectia unui furnizor cunoscut completeaza eticheta si tipul —
  // scuteste adminul sa tasteze „DoodStream" de fiecare data.
  const quick = document.createElement('select');
  quick.className = 'select src-row__quick';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Furnizor…';
  quick.appendChild(ph);
  for (const prov of sourcesMeta.providers || []) {
    const o = document.createElement('option');
    o.value = prov.label;
    o.dataset.hint = prov.hint || '';
    o.textContent = prov.label;
    quick.appendChild(o);
  }
  quick.addEventListener('change', () => {
    const opt = quick.selectedOptions[0];
    if (!opt || !opt.value) return;
    if (!label.value.trim()) label.value = opt.value;
    if (opt.dataset.hint) url.placeholder = opt.dataset.hint;
    kind.value = /MP4|\.mp4/i.test(opt.value) ? 'file' : 'embed';
    quick.value = '';
  });

  row.append(label, kind, url, quick, del);
  return row;
}

function syncSourceCount() {
  const box = document.getElementById('e-sources');
  const out = document.getElementById('e-sources-count');
  if (!box || !out) return;
  const n = box.querySelectorAll('.src-row').length;
  const max = sourcesMeta.max || 12;
  out.textContent = n ? `${n} / ${max} surse` : '';
  document.getElementById('e-add-source').disabled = n >= max;
}

function addFormSourceRow(src) {
  const box = document.getElementById('e-sources');
  if (!box) return;
  if (box.querySelectorAll('.src-row').length >= (sourcesMeta.max || 12)) {
    toast(`Maximum ${sourcesMeta.max || 12} surse per episod`, 'warn');
    return;
  }
  box.appendChild(buildSourceRow(src));
  syncSourceCount();
}

/** Aduna sursele din formularul de creare, ignorand randurile goale. */
function collectFormSources() {
  const out = [];
  for (const row of document.querySelectorAll('#e-sources .src-row')) {
    const url = row.querySelector('[name="src_url"]').value.trim();
    if (!url) continue; // rand lasat gol nu e eroare, doar nu il trimitem
    out.push({
      label: row.querySelector('[name="src_label"]').value.trim(),
      kind: row.querySelector('[name="src_kind"]').value,
      url,
    });
  }
  return out;
}

async function loadEpisodesTab() {
  if (!seriesList.length) await loadSeriesTab();
  populateSeriesDropdown();
  await loadSourcesMeta();

  // La prima intrare pe tab, formularul de episod primeste un rand gol,
  // ca adminul sa vada din start ca acolo se pune sursa video.
  const builder = document.getElementById('e-sources');
  if (builder && !builder.querySelector('.src-row')) addFormSourceRow({});

  const res = await api('/admin/episodes');
  if (!res.ok) { toast(res.data?.error || 'Eroare la încărcarea episoadelor', 'err'); return; }

  const episodes = res.data.episodes || [];
  const tbody = document.querySelector('#episodes-table tbody');
  tbody.innerHTML = '';

  if (!episodes.length) {
    tbody.appendChild(emptyRow(7, 'Niciun episod încă.'));
    return;
  }

  for (const ep of episodes) {
    const srcCount = (ep.sources || []).length;
    const tr = document.createElement('tr');
    tr.append(
      cell(ep.id),
      cell(ep.series_title),
      cell(ep.episode_number),
      cell(ep.title || '—'),
      sourcesCell(ep, srcCount),
      cell(Number(ep.views || 0).toLocaleString('ro-RO')),
      actionsCell([
        {
          label: `Surse (${srcCount})`,
          cls: 'btn btn--accent btn--sm',
          onClick: () => openSourcesPanel(ep),
        },
        { label: 'Vezi', cls: 'btn btn--ghost btn--sm', href: `/episode?id=${ep.id}` },
        {
          label: 'Șterge',
          cls: 'btn btn--danger btn--sm',
          onClick: () => deleteEpisode(ep.id, ep.episode_number),
        },
      ]),
    );
    tbody.appendChild(tr);
  }
}

/** Celula cu sursele unui episod: etichete scurte + marcaj pentru cele oprite. */
function sourcesCell(ep, count) {
  const td = document.createElement('td');
  if (!count) {
    const warn = document.createElement('span');
    warn.className = 'pill pill--warn';
    warn.textContent = 'fără sursă';
    warn.title = 'Episodul nu are nicio sursă video — playerul va fi gol.';
    td.appendChild(warn);
    return td;
  }
  const wrap = document.createElement('div');
  wrap.className = 'src-chips';
  for (const src of ep.sources || []) {
    const chip = document.createElement('span');
    chip.className = `src-chip${src.is_active ? '' : ' src-chip--off'}`;
    chip.textContent = src.label;
    chip.title = `${src.kind} — ${src.url}${src.is_active ? '' : ' (dezactivată)'}`;
    wrap.appendChild(chip);
  }
  td.appendChild(wrap);
  return td;
}

async function deleteEpisode(id, num) {
  if (!confirm(`Ștergi episodul ${num}?`)) return;
  const res = await api(`/admin/episodes?id=${id}`, { method: 'DELETE' });
  if (!res.ok) { toast(res.data?.error || 'Nu am putut șterge episodul', 'err'); return; }
  toast(`Episodul ${num} a fost șters`, 'ok');
  loadEpisodesTab();
  loadStats();
}

document.getElementById('episode-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = document.getElementById('episode-submit');
  const data = Object.fromEntries(new FormData(form).entries());

  if (!data.series_id) { toast('Adaugă întâi o serie, apoi alege-o din listă', 'warn'); return; }

  const sources = collectFormSources();
  if (!sources.length) {
    toast('Adaugă cel puțin o sursă video cu un URL', 'warn');
    return;
  }

  await withBusy(btn, async () => {
    const res = await api('/admin/episodes', {
      method: 'POST',
      body: {
        series_id: Number(data.series_id),
        episode_number: Number(data.episode_number),
        title: data.title,
        sources,
      },
    });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut adăuga episodul', 'err', 5000); return; }
    toast(`Episodul ${data.episode_number} a fost adăugat`, 'ok');
    form.reset();
    // form.reset() nu atinge randurile construite dinamic, deci le curatam noi.
    document.getElementById('e-sources').innerHTML = '';
    addFormSourceRow({});
    syncSourceCount();
    populateSeriesDropdown();
    loadEpisodesTab();
    loadStats();
  });
});

// ---------------------------------------------------------------------
// PANOUL DE SURSE (pentru episoade deja create)
// ---------------------------------------------------------------------
let currentSourcesEp = null;

async function openSourcesPanel(ep) {
  currentSourcesEp = ep;
  const panel = document.getElementById('sources-panel');
  const title = document.getElementById('sources-panel-title');

  title.textContent = `Surse — ${ep.series_title} · Ep. ${ep.episode_number}${ep.title ? ` (${ep.title})` : ''}`;
  panel.hidden = false;
  await loadSourcesMeta();
  await refreshSourcesList();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeSourcesPanel() {
  currentSourcesEp = null;
  document.getElementById('sources-panel').hidden = true;
}

async function refreshSourcesList() {
  const box = document.getElementById('sources-list');
  box.innerHTML = '';
  if (!currentSourcesEp) return;

  const res = await api(`/admin/episode-sources?episode_id=${currentSourcesEp.id}`);
  if (!res.ok) {
    box.appendChild(emptyRow(1, res.data?.error || 'Nu am putut încărca sursele'));
    return;
  }
  const list = res.data.sources || [];

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'src-empty';
    empty.textContent = 'Episodul ăsta nu are nicio sursă. Adaugă una mai jos.';
    box.appendChild(empty);
    return;
  }

  for (const src of list) box.appendChild(existingSourceRow(src));
}

/** Un rand de sursa existenta, cu editare inline si comutare activ/oprit. */
function existingSourceRow(src) {
  const row = document.createElement('div');
  row.className = `src-row src-row--existing${src.is_active ? '' : ' src-row--off'}`;

  const label = document.createElement('input');
  label.className = 'input src-row__label';
  label.type = 'text';
  label.maxLength = 40;
  label.value = src.label;

  const kind = document.createElement('select');
  kind.className = 'select src-row__kind';
  kindOptions(kind, src.kind);

  const url = document.createElement('input');
  url.className = 'input src-row__url';
  url.type = 'url';
  url.value = src.url;

  const active = document.createElement('label');
  active.className = 'src-row__active';
  active.title = 'Sursele oprite nu apar pe pagina episodului';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!src.is_active;
  active.append(cb, document.createTextNode('activă'));

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn--accent btn--sm';
  save.textContent = 'Salvează';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn--danger btn--sm';
  del.textContent = '✕';
  del.title = 'Șterge sursa';

  save.addEventListener('click', async () => {
    await withBusy(save, async () => {
      const res = await api('/admin/episode-sources', {
        method: 'PATCH',
        body: {
          id: src.id,
          label: label.value.trim(),
          kind: kind.value,
          url: url.value.trim(),
          is_active: cb.checked,
        },
      });
      if (!res.ok) { toast(res.data?.error || 'Nu am putut salva sursa', 'err', 5000); return; }
      toast('Sursă salvată', 'ok');
      await refreshSourcesList();
      loadEpisodesTab();
    });
  });

  // Bifa de „activă" e o modificare frecventa si ieftina: o salvam pe loc,
  // fara sa astepte apasarea butonului Salveaza.
  cb.addEventListener('change', async () => {
    const res = await api('/admin/episode-sources', {
      method: 'PATCH', body: { id: src.id, is_active: cb.checked },
    });
    if (!res.ok) { cb.checked = !cb.checked; toast(res.data?.error || 'Eroare', 'err'); return; }
    row.classList.toggle('src-row--off', !cb.checked);
    toast(cb.checked ? 'Sursă activată' : 'Sursă dezactivată', 'ok');
    loadEpisodesTab();
  });

  del.addEventListener('click', async () => {
    if (!confirm(`Ștergi sursa „${src.label}"?`)) return;
    const res = await api(`/admin/episode-sources?id=${src.id}`, { method: 'DELETE' });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut șterge', 'err'); return; }
    toast('Sursă ștearsă', 'ok');
    await refreshSourcesList();
    loadEpisodesTab();
  });

  row.append(label, kind, url, active, save, del);
  return row;
}

// ---------------------------------------------------------------------
// LEGATURILE UI-ului de surse
// ---------------------------------------------------------------------
document.getElementById('e-add-source')?.addEventListener('click', () => addFormSourceRow({}));
document.getElementById('sources-close')?.addEventListener('click', closeSourcesPanel);

document.getElementById('s-kind')?.addEventListener('change', (e) => {
  const hint = document.getElementById('s-kind-hint');
  if (hint) hint.textContent = KIND_HINTS[e.target.value] || '';
});

document.getElementById('source-add-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentSourcesEp) return;
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
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
    form.reset();
    await refreshSourcesList();
    loadEpisodesTab();
  });
});

// ---------------------------------------------------------------------
// UTILIZATORI
// ---------------------------------------------------------------------
async function loadUsers() {
  const res = await api('/admin/users');
  if (!res.ok) { toast(res.data?.error || 'Eroare la încărcarea utilizatorilor', 'err'); return; }

  const users = res.data.users || [];
  const currentId = res.data.you ?? me?.id;
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '';

  if (!users.length) { tbody.appendChild(emptyRow(6, 'Niciun utilizator.')); return; }

  for (const u of users) {
    const isSelf = u.id === currentId;
    const tr = document.createElement('tr');

    const actions = [];
    if (!isSelf) {
      actions.push({
        label: u.is_admin ? 'Fă user' : 'Fă admin',
        cls: `btn btn--sm ${u.is_admin ? 'btn--ghost' : 'btn--ok'}`,
        onClick: () => userAction('set_role', u, !u.is_admin),
      });
      actions.push({
        label: u.is_banned ? 'Unban' : 'Ban',
        cls: `btn btn--sm ${u.is_banned ? 'btn--ok' : 'btn--danger'}`,
        onClick: () => userAction('set_ban', u, !u.is_banned),
      });
      actions.push({
        label: 'Șterge cont',
        cls: 'btn btn--sm btn--danger',
        onClick: () => deleteUser(u),
      });
    }

    tr.append(
      cell(u.id),
      cell(u.username + (isSelf ? ' (tu)' : '')),
      cell(u.email),
      cell(u.points),
      pill(u.is_admin ? 'Admin' : 'User', u.is_admin ? 'pill--admin' : 'pill--user'),
      pill(u.is_banned ? 'Banat' : 'Activ', u.is_banned ? 'pill--banned' : 'pill--user'),
      actionsCell(actions.length ? actions : [{ label: '—', cls: 'btn btn--ghost btn--sm', disabled: true }]),
    );
    tbody.appendChild(tr);
  }
}

async function userAction(action, user, value) {
  const labels = {
    set_role: value ? `Îl faci ADMIN pe ${user.username}?` : `Îl treci pe ${user.username} la rol de user?`,
    set_ban: value ? `Îl banezi pe ${user.username}? Nu se va mai putea loga.` : `Îl debanezi pe ${user.username}?`,
  };
  if (!confirm(labels[action] || 'Confirmi acțiunea?')) return;

  const res = await api('/admin/users', { method: 'POST', body: { action, user_id: user.id, value } });
  if (!res.ok) { toast(res.data?.error || 'Acțiunea a eșuat', 'err'); return; }
  toast('Gata', 'ok');
  loadUsers();
  loadStats();
}

async function deleteUser(user) {
  if (!confirm(`Ștergi definitiv contul „${user.username}"? Istoricul lui de vizionări dispare și el.`)) return;
  const res = await api('/admin/users', { method: 'POST', body: { action: 'delete', user_id: user.id } });
  if (!res.ok) { toast(res.data?.error || 'Nu am putut șterge contul', 'err'); return; }
  toast(`Contul „${user.username}" a fost șters`, 'ok');
  loadUsers();
  loadStats();
}

// ---------------------------------------------------------------------
// JURNAL
// ---------------------------------------------------------------------
async function loadLog() {
  const res = await api('/admin/log?limit=100');
  if (!res.ok) { toast(res.data?.error || 'Eroare la încărcarea jurnalului', 'err'); return; }

  fillTable(
    'log-table',
    ['Data', 'Admin', 'Acțiune', 'Țintă', 'Detalii'],
    res.data.log || [],
    (l) => [l.created_at, l.admin_name, l.action, `${l.target_type || ''}${l.target_id ? ' #' + l.target_id : ''}`, l.details || ''],
    'Jurnalul e gol.'
  );
}

// ---------------------------------------------------------------------
// HELPERE DOM
// ---------------------------------------------------------------------
function cell(value) {
  const td = document.createElement('td');
  td.textContent = value ?? '';
  return td;
}

function pill(text, cls) {
  const td = document.createElement('td');
  const span = document.createElement('span');
  span.className = `pill ${cls || ''}`;
  span.textContent = text;
  td.appendChild(span);
  return td;
}

function actionsCell(items) {
  const td = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'actions';

  for (const item of items) {
    if (item.href) {
      const a = document.createElement('a');
      a.className = item.cls;
      a.href = item.href;
      a.textContent = item.label;
      wrap.appendChild(a);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = item.cls;
    b.textContent = item.label;
    b.disabled = !!item.disabled;
    if (item.onClick) {
      b.addEventListener('click', async (e) => {
        await withBusy(e.currentTarget, item.onClick);
      });
    }
    wrap.appendChild(b);
  }

  td.appendChild(wrap);
  return td;
}

function emptyRow(colspan, text) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = colspan;
  td.style.color = 'var(--text-dim)';
  td.textContent = text;
  tr.appendChild(td);
  return tr;
}

// ---------------------------------------------------------------------
// CODURI DE INVITATIE
// ---------------------------------------------------------------------
let inviteFilter = 'all';

const INVITE_STATUS = {
  active:  { label: 'Activ',   cls: 'pill pill--ok' },
  used:    { label: 'Folosit', cls: 'pill pill--user' },
  revoked: { label: 'Revocat', cls: 'pill pill--banned' },
};

async function loadInvites() {
  const res = await api(`/admin/invites?filter=${encodeURIComponent(inviteFilter)}`);
  if (!res.ok) {
    toast(res.data?.error || 'Nu am putut încărca codurile', 'err');
    return;
  }

  const c = res.data.counts || {};
  const btns = document.querySelectorAll('#invite-filters [data-filter]');
  btns.forEach((b) => {
    const f = b.dataset.filter;
    const n = f === 'all' ? c.total : c[f] ?? 0;
    b.textContent = `${b.textContent.split(' (')[0]} (${n})`;
    const on = f === inviteFilter;
    b.className = `btn btn--sm ${on ? 'btn--accent' : 'btn--ghost'}`;
  });

  const tbody = document.querySelector('#invites-table tbody');
  tbody.innerHTML = '';

  const rows = res.data.invites || [];
  if (!rows.length) {
    tbody.appendChild(emptyRow(6, inviteFilter === 'all'
      ? 'Nu ai generat încă niciun cod. Completează formularul de mai sus.'
      : 'Niciun cod cu acest filtru.'));
    return;
  }

  for (const inv of rows) {
    const tr = document.createElement('tr');

    // Codul, cu buton de copiere — adminul il da mai departe pe Discord etc.
    const tdCode = document.createElement('td');
    const chip = document.createElement('code');
    chip.className = 'code-chip';
    chip.textContent = inv.code;
    tdCode.appendChild(chip);
    if (inv.status === 'active') {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn--ghost btn--sm';
      copy.textContent = 'Copiază';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(inv.code);
          copy.textContent = 'Copiat ✓';
          setTimeout(() => { copy.textContent = 'Copiază'; }, 1500);
        } catch { toast('Nu am putut copia. Selectează codul manual.', 'warn'); }
      });
      tdCode.appendChild(copy);
    }
    tr.appendChild(tdCode);

    tr.appendChild(cell(inv.note || '—'));

    const tdStatus = document.createElement('td');
    const st = INVITE_STATUS[inv.status] || { label: inv.status, cls: 'pill' };
    const pillEl = document.createElement('span');
    pillEl.className = st.cls;
    pillEl.textContent = st.label;
    tdStatus.appendChild(pillEl);
    tr.appendChild(tdStatus);

    tr.appendChild(cell(inv.created_by_name || '—'));
    tr.appendChild(cell(inv.created_at));

    const actions = [];
    if (inv.status === 'active') {
      actions.push({
        label: 'Revocă', cls: 'btn btn--ghost btn--sm',
        onClick: () => inviteAction({ action: 'revoke', id: inv.id }, inv.code, 'revocat'),
      });
      actions.push({
        label: 'Șterge', cls: 'btn btn--danger btn--sm',
        onClick: () => deleteInvite(inv),
      });
    } else if (inv.status === 'revoked') {
      actions.push({
        label: 'Reactivează', cls: 'btn btn--ok btn--sm',
        onClick: () => inviteAction({ action: 'unrevoke', id: inv.id }, inv.code, 'reactivat'),
      });
    }
    tr.appendChild(actionsCell(actions.length ? actions : [{ label: '—', cls: 'btn btn--ghost btn--sm', disabled: true }]));

    tbody.appendChild(tr);
  }
}

async function inviteAction(body, code, verb) {
  const res = await api('/admin/invites', { method: 'POST', body });
  if (res.ok) {
    toast(`Codul ${code} a fost ${verb}.`, 'ok');
    await loadInvites();
  } else {
    toast(res.data?.error || `Nu am putut ${verb} codul`, 'err');
  }
}

async function deleteInvite(inv) {
  if (!confirm(`Ștergi definitiv codul ${inv.code}?`)) return;
  const res = await api(`/admin/invites?id=${encodeURIComponent(inv.id)}`, { method: 'DELETE' });
  if (res.ok) {
    toast('Cod șters.', 'ok');
    await loadInvites();
  } else {
    toast(res.data?.error || 'Nu am putut șterge codul', 'err');
  }
}

document.getElementById('invite-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = document.getElementById('invite-submit');
  const data = Object.fromEntries(new FormData(form).entries());

  await withBusy(btn, async () => {
    const res = await api('/admin/invites', {
      method: 'POST',
      body: { count: Number(data.count) || 1, note: (data.note || '').trim() },
    });

    if (!res.ok) {
      toast(res.data?.error || 'Nu am putut genera codurile', 'err');
      return;
    }

    const created = res.data.created || [];
    toast(`${created.length} cod${created.length === 1 ? '' : 'uri'} generat${created.length === 1 ? '' : 'e'}.`, 'ok');

    // Afisam codurile proaspete ca sa poata fi copiate imediat, fara sa
    // fie nevoie ca adminul sa le caute in tabel.
    const box = document.getElementById('invite-result');
    box.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'banner';
    const head = document.createElement('b');
    head.textContent = 'Coduri proaspăt generate — copiază-le acum:';
    wrap.appendChild(head);
    const list = document.createElement('div');
    list.className = 'code-list';
    for (const c of created) {
      const chip = document.createElement('code');
      chip.className = 'code-chip';
      chip.textContent = c.code;
      list.appendChild(chip);
    }
    wrap.appendChild(list);

    if (created.length > 1) {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'btn btn--ghost btn--sm';
      all.textContent = 'Copiază-le pe toate';
      all.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(created.map((c) => c.code).join('\n'));
          all.textContent = 'Copiate ✓';
          setTimeout(() => { all.textContent = 'Copiază-le pe toate'; }, 1500);
        } catch { toast('Nu am putut copia.', 'warn'); }
      });
      wrap.appendChild(all);
    }

    box.appendChild(wrap);
    form.reset();
    document.getElementById('i-count').value = '1';
    inviteFilter = 'all';
    await loadInvites();
  });
});

document.getElementById('invite-filters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  inviteFilter = btn.dataset.filter;
  loadInvites();
});

// ---------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------
if (await guard()) {
  await renderNav('/admin');
  initTabs();
  await loadStats();
}
