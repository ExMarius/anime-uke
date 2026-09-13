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
  invites: () => Promise.all([loadInvites(), loadInviteRequests()]),
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

// Refresh manual pentru cererile de coduri (secțiunea Invitații).
document.getElementById('requests-refresh')?.addEventListener('click', () => loadInviteRequests());
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
  const cards = [
    ['Utilizatori', `${s.total_users} / ${s.limit_users}`],
    ['Admini', s.total_admins],
    ['Banați', s.total_banned],
    ['Serii', `${s.total_series} / ${s.limit_series}`],
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

// ---------------------------------------------------------------------
// CERERI DE CODURI (de la vizitatori)
//
// Aprobarea genereaza AUTOMAT un cod de invitație: codul pleaca spre
// cerut prin biletul sau (pagina de login → „Verifică starea”), iar in
// tabel apare si ca sa-l poata copia adminul, de pilda pentru Discord.
// ---------------------------------------------------------------------
const REQ_STATUS = {
  pending:  { label: 'În așteptare', cls: 'pill pill--banned' },
  approved: { label: 'Aprobată',     cls: 'pill pill--ok' },
  rejected: { label: 'Respinsă',     cls: 'pill pill--user' },
};

async function loadInviteRequests() {
  const tbody = document.querySelector('#requests-table tbody');
  if (!tbody) return;

  const res = await api('/admin/invite-requests');
  if (!res.ok) {
    tbody.innerHTML = '';
    tbody.appendChild(emptyRow(5, res.data?.error || 'Nu am putut încărca cererile.'));
    return;
  }

  const rows = res.data.requests || [];

  // Badge pe tab: adminul vede din prima dacă așteaptă cineva.
  const tab = document.getElementById('tab-invites');
  if (tab) {
    const pending = res.data.pending || 0;
    tab.textContent = pending > 0 ? `🎟️ Invitații (${pending} cereri)` : '🎟️ Invitații';
  }

  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.appendChild(emptyRow(5, 'Nicio cerere de cod încă. Cineva va scrie curând — cererile apar aici automat.'));
    return;
  }

  for (const r of rows) {
    const tr = document.createElement('tr');

    const tdEmail = document.createElement('td');
    tdEmail.textContent = r.email;
    tr.appendChild(tdEmail);

    const tdMsg = document.createElement('td');
    tdMsg.textContent = r.message;
    tdMsg.title = r.message;
    tdMsg.style.maxWidth = '340px';
    tr.appendChild(tdMsg);

    const tdDate = document.createElement('td');
    tdDate.textContent = String(r.created_at || '').slice(0, 16);
    tr.appendChild(tdDate);

    const tdStatus = document.createElement('td');
    const st = REQ_STATUS[r.status] || { label: r.status, cls: 'pill' };
    const pill = document.createElement('span');
    pill.className = st.cls;
    pill.textContent = st.label;
    tdStatus.appendChild(pill);
    if (r.status === 'approved' && r.invite_code) {
      const codeEl = document.createElement('code');
      codeEl.className = 'code-chip';
      codeEl.textContent = r.invite_code;
      tdStatus.appendChild(codeEl);
    }
    tr.appendChild(tdStatus);

    const tdAct = document.createElement('td');
    if (r.status === 'pending') {
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn btn--sm btn--accent';
      ok.textContent = 'Aprobă';
      ok.addEventListener('click', () => decideRequest(r.id, 'approve', tr));
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'btn btn--sm btn--ghost';
      no.textContent = 'Respinge';
      no.addEventListener('click', () => decideRequest(r.id, 'reject', tr));
      tdAct.append(ok, ' ', no);
    } else {
      tdAct.textContent = '—';
    }
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  }
}

async function decideRequest(id, action, tr) {
  const res = await api('/admin/invite-requests', { method: 'POST', body: { id, action } });
  if (!res.ok) { toast(res.data?.error || 'Decizia nu a putut fi salvată', 'err'); return; }

  if (action === 'approve') {
    toast(`Cod generat: ${res.data.invite_code} — cerutul îl vede cu biletul său.`, 'ok');
  } else {
    toast('Cerere respinsă.', 'ok');
  }
  loadInviteRequests();
}

// ---------------------------------------------------------------------
// GRADE & STAFF: teme de grade (din orice serie) + moderatori
// ---------------------------------------------------------------------
async function loadRanks() {
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
        if (r.ok) loadRanks();
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
    if (r.ok) { ev.target.reset(); loadRanks(); }
  });
  document.getElementById('mod-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter;
    const r = await api('/admin/mods', {
      method: 'POST',
      body: { username: document.getElementById('mod-username').value, is_mod: btn?.dataset?.mod === '1' ? 1 : 0 },
    });
    toast(r.ok ? (r.data.is_mod ? 'Moderator promovat' : 'Retrogradat') : (r.data?.error || 'Eroare'), r.ok ? 'success' : 'error');
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
