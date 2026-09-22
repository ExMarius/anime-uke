import { api, renderNav, toast, withBusy, getSession, formatDate, safeUrl } from './core.js';

// =====================================================================
// Panoul admin. Toate celulele sunt construite cu createElement +
// textContent, niciodata innerHTML cu date din DB — titlurile de serii si
// username-urile sunt continut generat de utilizatori, deci innerHTML ar
// redeschide gaura de XSS din v1.
// =====================================================================

let me = null;

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
// Taburile de serii si episoade au fost mutate pe pagini proprii
// (/admin/serii si /admin/serie/<id>) — vezi nota din admin.html.
const LOADERS = {
  stats: loadStats,
  users: loadUsers,
  ranks: loadRanks,
  reports: loadReports,
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
  // Tavanele buget-0 direct pe carduri: adminul vede pe loc cat loc mai e.
  // [eticheta, valoare, plafon] — plafonul e optional. Inainte mergeam cu
  // „3 / 4" prin Number() si iesea NaN pe cardurile cu plafon.
  const cards = [
    ['Utilizatori', s.total_users, s.limit_users],
    ['Admini', s.total_admins],
    ['Banați', s.total_banned],
    ['Serii', s.total_series, s.limit_series],
    ['Episoade', s.total_episodes],
    ['Vizionări', s.total_views],
    ['Marcate ca văzute', s.total_watched],
    ['Mesaje chat', s.total_chat_messages],
  ];

  box.innerHTML = '';
  for (const [label, value, limit] of cards) {
    const el = document.createElement('div');
    el.className = 'stat';
    const v = document.createElement('div');
    v.className = 'stat__value';
    const n = Number(value || 0).toLocaleString('ro-RO');
    v.textContent = limit != null ? `${n} / ${Number(limit).toLocaleString('ro-RO')}` : n;
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
// UTILIZATORI
// ---------------------------------------------------------------------
async function loadUsers() {
  const res = await api('/admin/users');
  if (!res.ok) { toast(res.data?.error || 'Eroare la încărcarea utilizatorilor', 'err'); return; }

  const users = res.data.users || [];
  const currentId = res.data.you ?? me?.id;
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '';

  if (!users.length) { tbody.appendChild(emptyRow(9, 'Niciun utilizator.')); return; }

  for (const u of users) {
    const isSelf = u.id === currentId;
    const tr = document.createElement('tr');
    tr.dataset.uid = u.id;

    const actions = [];
    // Economia se poate ajusta si pe propriul cont (gold/puncte/nivel nu
    // pot bloca panoul); rolul/banul/stergerea raman interzise pe sine.
    actions.push({
      label: '💰 Gold/Puncte/Nivel',
      cls: 'btn btn--sm btn--ghost',
      onClick: () => toggleEconEditor(u, tr),
    });
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
      cell(fmtNum(u.points)),
      cell(`🪙 ${fmtNum(u.gold)}`),
      cell(`Nv. ${u.level ?? 1} · ${fmtNum(u.xp)} XP`),
      pill(staffLabel(u), u.is_admin ? 'pill--admin' : u.staff_role ? 'pill--staff' : 'pill--user'),
      pill(u.is_banned ? 'Banat' : 'Activ', u.is_banned ? 'pill--banned' : 'pill--user'),
      actionsCell(actions),
    );
    tbody.appendChild(tr);
  }
  // Dupa o ajustare reusita redeschidem editorul pe acelasi user (valorile
  // „acum" sunt proaspete, nu trebuie sa-l cauti din nou in lista).
  if (editorUserId != null) {
    const row = tbody.querySelector(`tr[data-uid="${editorUserId}"]`);
    const u = users.find((x) => x.id === editorUserId);
    if (row && u) openEconEditor(u, row);
    else editorUserId = null;
  }
}

/** Numar cu separatori ro-RO (null/undefined → 0). */
function fmtNum(v) {
  return Number(v || 0).toLocaleString('ro-RO');
}

/** Eticheta de rol din tabelul de utilizatori: Admin / grad de staff / User. */
function staffLabel(u) {
  if (u.is_admin) return 'Admin';
  const role = String(u.staff_role || '');
  if (role === 'moderator') return '🛠️ Moderator';
  if (role === 'staff') return '⭐ Staff';
  if (role === 'helper') return '🤝 Helper';
  return 'User';
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
// EDITOR ECONOMIE (gold/puncte/nivel): un rand extensibil sub utilizator,
// cu trei mini-formulare. Delta-urile (gold/puncte) accepta si negative
// (scadere, cu oprire la 0); nivelul se seteaza absolut (1-100, XP-ul se
// reseteaza la pragul nivelului). Dupa fiecare aplicare reusita lista se
// reincarca si editorul se redeschide pe acelasi user.
// ---------------------------------------------------------------------
let editorUserId = null;

function toggleEconEditor(u, tr) {
  if (editorUserId === u.id) {
    editorUserId = null;
    tr.parentNode.querySelector('.econ-edit-row')?.remove();
    return;
  }
  editorUserId = u.id;
  tr.parentNode.querySelector('.econ-edit-row')?.remove();
  openEconEditor(u, tr);
}

function openEconEditor(u, tr) {
  const row = document.createElement('tr');
  row.className = 'econ-edit-row';
  const td = document.createElement('td');
  td.colSpan = 9;
  const wrap = document.createElement('div');
  wrap.className = 'econ-edit';
  wrap.append(
    econGroup(`🪙 Gold — acum: ${fmtNum(u.gold)}`, '±delta (ex. 500 sau -200)', 'Adaugă', (v) => applyEcon(u, 'set_gold', v, (d) => `🪙 Gold nou: ${fmtNum(d.gold)}`)),
    econGroup(`⭐ Puncte — acum: ${fmtNum(u.points)}`, '±delta (ex. 100 sau -50)', 'Adaugă', (v) => applyEcon(u, 'set_points', v, (d) => `⭐ Puncte noi: ${fmtNum(d.points)}`)),
    econGroup(`🎚️ Nivel — acum: Nv. ${u.level ?? 1}`, 'nivel absolut 1-100', 'Setează', (v) => applyEcon(u, 'set_level', v, (d) => `🎚️ Nivel nou: Nv. ${d.level} (XP resetat)`)),
  );
  td.appendChild(wrap);
  row.appendChild(td);
  tr.after(row);
}

/** Un mini-formular: eticheta + input numeric + buton. Fara innerHTML. */
function econGroup(label, placeholder, btnLabel, onApply) {
  const grp = document.createElement('div');
  grp.className = 'econ-edit__grp';
  const lab = document.createElement('span');
  lab.className = 'econ-edit__label';
  lab.textContent = label;
  const input = document.createElement('input');
  input.className = 'input input--sm econ-edit__input';
  input.type = 'number';
  input.step = '1';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--accent btn--sm';
  btn.textContent = btnLabel;
  btn.addEventListener('click', () => withBusy(btn, async () => {
    const raw = input.value.trim();
    if (!raw) { toast('Scrie o valoare mai întâi', 'err'); return; }
    await onApply(Number(raw));
  }));
  const line = document.createElement('div');
  line.className = 'econ-edit__line';
  line.append(input, btn);
  grp.append(lab, line);
  return grp;
}

async function applyEcon(u, action, value, okMsg) {
  if (action === 'set_level' && !confirm(`Îl treci pe ${u.username} la nivelul ${value}? XP-ul i se resetează la pragul nivelului.`)) return;
  const res = await api('/admin/users', { method: 'POST', body: { action, user_id: u.id, value } });
  if (!res.ok) { toast(res.data?.error || 'Ajustarea a eșuat', 'err'); return; }
  toast(okMsg(res.data), 'ok');
  editorUserId = u.id; // ramane deschis dupa reincarcarea listei
  loadUsers();
  loadStats();
}

// GRADE: grade de staff (acordate manual) + teme de nivel (automate)
// ---------------------------------------------------------------------
const STAFF_ICONS = { Admin: '🛡️', Moderator: '🛠️', Staff: '⭐', Helper: '🤝' };

async function loadRanks() {
  await Promise.all([loadStaff(), loadRankThemes()]);
}

async function loadStaff() {
  const box = document.getElementById('staff-list');
  if (!box) return;
  const res = await api('/admin/mods');
  box.innerHTML = '';
  if (!res.ok) { box.textContent = res.data?.error || 'Nu am putut încărca echipa.'; return; }
  const staff = res.data.staff || [];
  if (!staff.length) { box.textContent = 'Nimeni nu are încă un grad.'; return; }
  const meId = me?.id;
  for (const u of staff) {
    const row = document.createElement('div');
    row.className = 'ranks-row staff-row';
    const name = document.createElement('span');
    name.className = 'ranks-row__title';
    name.textContent = u.username + (u.id === meId ? ' (tu)' : '');
    const badge = document.createElement('span');
    badge.className = 'ubadge ubadge--' + (u.is_admin ? 'admin' : u.role === 'Moderator' ? 'mod' : u.role === 'Staff' ? 'staff' : 'helper');
    badge.textContent = `${STAFF_ICONS[u.role] || '🎖️'} ${u.role}`;
    row.append(name, badge);
    if (!u.is_admin && u.id !== meId) {
      const sel = document.createElement('select');
      sel.className = 'input input--sm staff-row__role';
      sel.setAttribute('aria-label', `Gradul lui ${u.username}`);
      for (const [val, label] of [['helper', '🤝 Helper'], ['staff', '⭐ Staff'], ['moderator', '🛠️ Moderator'], ['', '— fără grad']]) {
        const o = document.createElement('option');
        o.value = val; o.textContent = label;
        if (val === u.role_key) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => setStaffRole(u.username, sel.value));
      row.appendChild(sel);
    }
    box.appendChild(row);
  }
}

async function setStaffRole(username, role) {
  const r = await api('/admin/mods', { method: 'POST', body: { username, role } });
  if (r.ok) {
    toast(r.data.staff ? `${r.data.username} este acum ${r.data.staff}` : `${r.data.username} nu mai are grad`, 'success');
  } else {
    toast(r.data?.error || 'Eroare', 'error');
  }
  loadStaff();
  return r;
}

async function loadRankThemes() {
  const res = await api('/ranks');
  const box = document.getElementById('ranks-list');
  if (!box) return;
  box.innerHTML = '';
  if (!res.ok) { box.textContent = 'Nu am putut încărca temele.'; return; }
  for (const t of res.data.themes) {
    const row = document.createElement('div');
    row.className = 'ranks-row';
    const title = document.createElement('span');
    title.className = 'ranks-row__title';
    title.textContent = `${t.title} (${t.slug})`;
    const tiers = document.createElement('span');
    tiers.className = 'ranks-row__tiers';
    tiers.textContent = t.tiers.map((x) => `${x.icon} ${x.label}`).join(' → ');
    row.append(title, tiers);
    if (t.slug !== 'naruto') {
      const del = document.createElement('button');
      del.className = 'btn btn--ghost btn--sm';
      del.type = 'button';
      del.textContent = 'Șterge';
      del.addEventListener('click', async () => {
        const r = await api(`/admin/rank-themes?slug=${encodeURIComponent(t.slug)}`, { method: 'DELETE' });
        toast(r.ok ? 'Temă ștearsă' : (r.data?.error || 'Eroare'), r.ok ? 'success' : 'error');
        if (r.ok) loadRankThemes();
      });
      row.appendChild(del);
    }
    box.appendChild(row);
  }
}

function initRanks() {
  document.getElementById('rank-theme-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const lines = document.getElementById('rt-tiers').value
      .split('\n').map((l) => l.trim()).filter(Boolean);
    const tiers = lines.map((l) => {
      const [min, label, icon] = l.split('|').map((x) => (x || '').trim());
      return { min: Number(min), label, icon: icon || '🎗️' };
    });
    const r = await api('/admin/rank-themes', {
      method: 'POST',
      body: { slug: document.getElementById('rt-slug').value, title: document.getElementById('rt-title').value, tiers },
    });
    toast(r.ok ? 'Temă salvată' : (r.data?.error || 'Eroare'), r.ok ? 'success' : 'error');
    if (r.ok) { ev.target.reset(); loadRankThemes(); }
  });
  document.getElementById('mod-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter;
    const remove = btn?.dataset?.mod === '0';
    const role = remove ? '' : (document.getElementById('mod-role')?.value || 'helper');
    const r = await setStaffRole(document.getElementById('mod-username').value.trim(), role);
    if (r.ok) document.getElementById('mod-username').value = '';
  });
}
initRanks();

// ---------------------------------------------------------------------
// 🚩 RAPORTARI DE SURSE — semnalul ca o sursa e moarta vine de la
// privitori; aici le triezi: „Rezolva" (ai inlocuit sursa) sau
// „Respinge" (raport fals). Lista e paginata server-side la 200.
// ---------------------------------------------------------------------
let reportsStatus = 'open';

async function loadReports() {
  const box = document.getElementById('reports-list');
  if (!box) return;
  box.innerHTML = '<div class="loading"><div class="spinner"></div>Se încarcă…</div>';
  const res = await api(`/admin/reports?status=${encodeURIComponent(reportsStatus)}`);
  if (!res.ok) {
    box.innerHTML = '<div class="empty">Nu am putut încărca raportările.</div>';
    return;
  }
  const c = res.data.counts || {};
  const counts = document.getElementById('reports-counts');
  if (counts) counts.textContent = `${c.open || 0} deschise · ${c.fixed || 0} rezolvate · ${c.dismissed || 0} respinse`;

  box.innerHTML = '';
  const list = res.data.reports || [];
  if (!list.length) {
    box.innerHTML = '<div class="empty"><div class="empty__icon">🎉</div>Nicio raportare aici.</div>';
    return;
  }

  for (const r of list) {
    const row = document.createElement('div');
    row.className = 'report-row-admin box';

    const main = document.createElement('div');
    main.className = 'report-row-admin__main';
    const title = document.createElement('b');
    title.textContent = `${r.series_title} — E${r.episode_number} ${r.episode_title || ''}`.trim();
    const meta = document.createElement('span');
    meta.className = 'hint';
    const reasonKey = String(r.reason || '').split(':')[0];
    const reasonLabel = (res.data.reasons || {})[reasonKey] || reasonKey;
    const note = String(r.reason || '').includes(':') ? String(r.reason).slice(String(r.reason).indexOf(':') + 2) : '';
    meta.textContent = `${reasonLabel}${note ? ` — „${note}"` : ''} · sursa: ${r.source_label || '?'} · de ${r.username} · ${formatDate(r.created_at)}`;
    main.append(title, meta);

    const acts = document.createElement('div');
    acts.className = 'report-row-admin__acts';
    const mk = (label, cls, action) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn btn--sm ${cls}`;
      b.textContent = label;
      b.addEventListener('click', async () => {
        b.disabled = true;
        const rr = await api('/admin/reports', { method: 'POST', body: { id: r.id, action } });
        if (!rr.ok) { b.disabled = false; toast(rr.data?.error || 'Acțiunea a eșuat', 'error'); return; }
        toast(rr.data.status === 'fixed' ? 'Marcat ca rezolvat ✅' : rr.data.status === 'dismissed' ? 'Respins.' : 'Redeschis.', 'success');
        loadReports();
      });
      return b;
    };
    if (r.status === 'open') {
      acts.append(mk('✅ Rezolvă', 'btn--accent', 'fix'), mk('🗑️ Respinge', 'btn--ghost', 'dismiss'));
    } else {
      acts.append(mk('↩️ Redeschide', 'btn--ghost', 'reopen'));
      const st = document.createElement('span');
      st.className = 'hint';
      st.textContent = r.status === 'fixed' ? 'rezolvat' : 'respins';
      acts.appendChild(st);
    }

    row.append(main, acts);
    box.appendChild(row);
  }
}

function initReports() {
  const filters = document.getElementById('reports-filters');
  if (!filters || filters.dataset.wired) return;
  filters.dataset.wired = '1';
  for (const b of filters.querySelectorAll('button[data-status]')) {
    b.addEventListener('click', () => {
      reportsStatus = b.dataset.status;
      for (const x of filters.querySelectorAll('button')) {
        x.classList.toggle('is-on', x === b);
        x.classList.toggle('btn--accent', x === b);
        x.classList.toggle('btn--ghost', x !== b);
      }
      loadReports();
    });
  }
}

initReports();

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
