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
      '<div class="empty"><h2 class="page-title">403</h2><p>Nu ai acces la panoul de administrare.</p>' +
      '<p><a class="btn btn--accent" href="/">Înapoi la serii</a></p></div>';
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

async function loadEpisodesTab() {
  if (!seriesList.length) await loadSeriesTab();
  populateSeriesDropdown();

  const res = await api('/admin/episodes');
  if (!res.ok) { toast(res.data?.error || 'Eroare la încărcarea episoadelor', 'err'); return; }

  const episodes = res.data.episodes || [];
  const tbody = document.querySelector('#episodes-table tbody');
  tbody.innerHTML = '';

  if (!episodes.length) {
    tbody.appendChild(emptyRow(6, 'Niciun episod încă.'));
    return;
  }

  for (const ep of episodes) {
    const tr = document.createElement('tr');
    tr.append(
      cell(ep.id),
      cell(ep.series_title),
      cell(ep.episode_number),
      cell(ep.title || '—'),
      cell(Number(ep.views || 0).toLocaleString('ro-RO')),
      actionsCell([
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

  await withBusy(btn, async () => {
    const res = await api('/admin/episodes', {
      method: 'POST',
      body: {
        series_id: Number(data.series_id),
        episode_number: Number(data.episode_number),
        title: data.title,
        doodstream_url: data.doodstream_url,
      },
    });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut adăuga episodul', 'err', 5000); return; }
    toast(`Episodul ${data.episode_number} a fost adăugat`, 'ok');
    form.reset();
    populateSeriesDropdown();
    loadEpisodesTab();
    loadStats();
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

  if (!users.length) { tbody.appendChild(emptyRow(7, 'Niciun utilizator.')); return; }

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
// INIT
// ---------------------------------------------------------------------
if (await guard()) {
  await renderNav('/admin');
  initTabs();
  await loadStats();
}
