import { api, renderNav, toast, withBusy, getSession, formatDate, safeUrl, applySiteTheme, whenActive, initChat } from './core.js';

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
  'password-resets': loadPasswordResets,
  sezon: loadSeason,
  ranks: loadRanks,
  news: loadNews,
  reports: () => { loadReports(); loadChatSlow(); },
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

// ---------------------------------------------------------------------
// RECUPERĂRI DE PAROLĂ — coadă asistată, fără vendor de e-mail.
// Codul nu se păstrează în DOM după reîncărcare: apare exclusiv în răspunsul
// POST care l-a emis. Astfel nici o listare ulterioară de admin nu poate
// expune coduri de recuperare vechi.
function resetDate(seconds) {
  const n = Number(seconds || 0);
  if (!n) return '—';
  return new Date(n * 1000).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' });
}

function resetStatus(status, expired) {
  if (status === 'pending') return 'În așteptare';
  if (status === 'issued' && expired) return 'Expirat';
  if (status === 'issued') return 'Cod emis';
  return status || '—';
}

function resetCodeCard(request, recoveryCode, expiresAt) {
  const card = document.createElement('div');
  card.className = 'reset-code';
  const lead = document.createElement('strong');
  lead.textContent = 'Trimite acum la emailul verificat al membrului:';
  const detail = document.createElement('p');
  detail.className = 'hint';
  detail.textContent = `Solicitarea #${request.id} · codul expiră ${resetDate(expiresAt)}.`;
  const code = document.createElement('code');
  code.className = 'reset-code__value';
  code.textContent = recoveryCode;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn btn--ghost btn--sm';
  copy.textContent = 'Copiază detaliile';
  copy.addEventListener('click', async () => {
    const text = `Solicitarea #${request.id}\nCod de recuperare: ${recoveryCode}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard indisponibil');
      await navigator.clipboard.writeText(text);
      toast('Numărul solicitării și codul au fost copiate.', 'ok');
    } catch {
      toast(`Solicitarea #${request.id} · cod: ${recoveryCode}`, 'info', 9000);
    }
  });
  card.append(lead, detail, code, copy);
  return card;
}

async function loadPasswordResets() {
  const box = document.getElementById('password-reset-list');
  if (!box) return;
  const res = await api('/admin/password-resets');
  if (!res.ok) { box.textContent = res.data?.error || 'Nu am putut încărca solicitările.'; return; }
  const requests = res.data?.requests || [];
  box.innerHTML = '';
  if (!requests.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Nicio solicitare activă. Cererile noi vor apărea aici.';
    box.appendChild(empty);
    return;
  }

  for (const request of requests) {
    const row = document.createElement('article');
    row.className = 'reset-request' + (request.status === 'pending' ? ' reset-request--pending' : '');
    const main = document.createElement('div');
    main.className = 'reset-request__main';
    const name = document.createElement('strong');
    name.textContent = request.username;
    const email = document.createElement('span');
    email.className = 'reset-request__email';
    email.textContent = request.email;
    const meta = document.createElement('span');
    meta.className = 'hint';
    const details = [
      `cererea #${request.id}`,
      `solicitată ${resetDate(request.requested_at)}`,
    ];
    if (request.status === 'issued') details.push(`${request.expired ? 'expirat' : 'expiră'} ${resetDate(request.expires_at)}`);
    meta.textContent = details.join(' · ');
    main.append(name, email, meta);

    const actions = document.createElement('div');
    actions.className = 'reset-request__actions';
    const status = document.createElement('span');
    status.className = `pill ${request.status === 'pending' ? 'pill--staff' : request.expired ? 'pill--banned' : 'pill--user'}`;
    status.textContent = resetStatus(request.status, request.expired);
    actions.appendChild(status);

    if (request.status === 'pending') {
      const issue = document.createElement('button');
      issue.type = 'button';
      issue.className = 'btn btn--accent btn--sm';
      issue.textContent = 'Emite cod';
      issue.addEventListener('click', () => withBusy(issue, async () => {
        if (!confirm(`Ai verificat că ${request.username} controlează adresa ${request.email}? Codul va fi afișat o singură dată.`)) return;
        const result = await api('/admin/password-resets', { method: 'POST', body: { action: 'issue', id: request.id } });
        if (!result.ok) { toast(result.data?.error || 'Nu am putut emite codul.', 'err'); return; }
        status.textContent = 'Cod emis';
        status.className = 'pill pill--user';
        issue.remove();
        row.appendChild(resetCodeCard(result.data.request, result.data.recovery_code, result.data.expires_at));
        toast('Cod emis — copiază-l și trimite-l în siguranță.', 'ok', 7000);
      }));
      actions.appendChild(issue);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--ghost btn--sm';
    cancel.textContent = request.status === 'pending' ? 'Respinge' : 'Anulează';
    cancel.addEventListener('click', () => withBusy(cancel, async () => {
      if (!confirm(`Anulezi solicitarea #${request.id} pentru ${request.username}?`)) return;
      const result = await api('/admin/password-resets', { method: 'POST', body: { action: 'cancel', id: request.id } });
      if (!result.ok) { toast(result.data?.error || 'Nu am putut anula solicitarea.', 'err'); return; }
      toast('Solicitare anulată.', 'ok');
      loadPasswordResets();
    }));
    actions.appendChild(cancel);

    row.append(main, actions);
    box.appendChild(row);
  }
}

// ---------------------------------------------------------------------
// SEZON: tema globala pentru toata lumea (doar adminul o seteaza). Temele
// de sezon nu apar in shop; cine are tema personala o pastreaza, restul vad
// sezonul. Previzualizarea foloseste acelasi mecanism ca in shop (motorul
// canvas porneste singur la schimbarea clasei body).
// ---------------------------------------------------------------------
async function loadSeason() {
  const box = document.getElementById('sezon-list');
  const cur = document.getElementById('sezon-curent');
  if (!box) return;
  const res = await api('/admin/season');
  if (!res.ok) { box.textContent = res.data?.error || 'Nu am putut încărca sezonul.'; return; }
  const activ = res.data.seasonal_theme || null;
  if (cur) cur.textContent = activ ? `activă: ${(res.data.available || []).find((t) => t.id === activ)?.name || activ}` : 'dezactivat';
  box.innerHTML = '';
  for (const t of res.data.available || []) {
    const row = document.createElement('div');
    row.className = 'ranks-row';
    const title = document.createElement('span');
    title.className = 'ranks-row__title';
    title.textContent = `${t.id === activ ? '✅ ' : ''}${t.name}`;
    row.appendChild(title);
    const peek = document.createElement('button');
    peek.type = 'button';
    peek.className = 'btn btn--ghost btn--sm';
    peek.textContent = '👁 Previzualizează';
    peek.addEventListener('click', () => peekSeason(t.id));
    const set = document.createElement('button');
    set.type = 'button';
    set.className = 'btn btn--accent btn--sm';
    set.textContent = t.id === activ ? '✓ Activă' : 'Setează ca sezon';
    set.disabled = t.id === activ;
    set.addEventListener('click', () => withBusy(set, async () => {
      if (!confirm(`„${t.name}" devine tema TUTUROR (temele personale active se resetează — nimic cumpărat nu se pierde). Continui?`)) return;
      const r = await api('/admin/season', { method: 'POST', body: { theme_id: t.id } });
      if (!r.ok) { toast(r.data?.error || 'Nu am putut seta sezonul', 'error'); return; }
      const n = Number(r.data?.reset_users) || 0;
      toast(`Sezon activ: ${t.name} 🍂 (${n} ${n === 1 ? 'utilizator trecut' : 'utilizatori trecuți'} pe sezon)`, 'success');
      const meNow = await getSession(true);
      applySiteTheme(meNow?.site_theme || null);
      loadSeason();
    }));
    row.append(peek, set);
    box.appendChild(row);
  }
  await paintSeasonBanner(activ, res.data.available || []);
}

// ---------------------------------------------------------------------
// Banner „tu vezi X, ceilalti vad sezonul": adminul cu tema personala NU
// vede sezonul (asa e specificatia), dar nimic nu-i spunea asta — parea un
// bug („am activat Halloween si vad toamna"). Bannerul arata tema efectiva
// a adminului + buton de previzualizare PERSISTENTA (pana la refresh).
// ---------------------------------------------------------------------
async function paintSeasonBanner(activ, available) {
  document.getElementById('sezon-banner')?.remove();
  if (!activ) return;
  const me = await getSession().catch(() => null);
  const efectiv = me?.site_theme || null;
  if (efectiv === activ) return; // vede sezonul — nimic de explicat
  const numeSezon = (available.find((t) => t.id === activ) || {}).name || activ;
  let numeEfectiv = 'Standard';
  let motiv = 'se propagă — dă Refresh în câteva secunde';
  if (efectiv) {
    // Numele temei efective + activarea RAW (api() prefixeaza singur /api;
    // /auth/me NU expune active_theme, dar /shop da — e singura sursa).
    const shop = await api('/shop');
    numeEfectiv = (shop.data?.themes || []).find((t) => t.id === efectiv)?.name || efectiv;
    if (shop.data?.active_theme) motiv = 'temă personală';
  }
  const bold = (s) => { const e = document.createElement('b'); e.textContent = s; return e; };
  const panel = document.querySelector('#panel-sezon .box');
  const list = document.getElementById('sezon-list');
  if (!panel || !list) return;
  const b = document.createElement('div');
  b.id = 'sezon-banner';
  b.className = 'box__hint'; // clasa exista in HTML — zero risc de purge CSS
  const txt = document.createElement('span');
  txt.append(
    document.createTextNode('👁️ Tu vezi acum '),
    bold(numeEfectiv),
    document.createTextNode(` (${motiv}) — ceilalți utilizatori pe Standard văd `),
    bold(numeSezon),
    document.createTextNode('. '),
  );
  const vezi = document.createElement('button');
  vezi.type = 'button';
  vezi.id = 'sezon-vezi';
  vezi.className = 'btn btn--accent btn--sm';
  vezi.textContent = 'Vezi sezonul';
  const mea = document.createElement('button');
  mea.type = 'button';
  mea.id = 'sezon-mea';
  mea.className = 'btn btn--ghost btn--sm';
  mea.textContent = '⟳ Înapoi la tema mea';
  mea.disabled = true;
  vezi.addEventListener('click', () => {
    previewSeasonPersistent(activ);
    vezi.disabled = true;
    mea.disabled = false;
  });
  mea.addEventListener('click', async () => {
    const m2 = await getSession(true);
    applySiteTheme(m2?.site_theme || null);
    vezi.disabled = false;
    mea.disabled = true;
  });
  b.append(txt, vezi, document.createTextNode(' '), mea);
  panel.insertBefore(b, list);
}

/** Previzualizare PERSISTENTA a sezonului (pana la refresh): nu scrie in
 *  cache-ul de tema, deci la reincarcare revine tema proprie. Motorul canvas
 *  porneste/opreste singur din MutationObserver la schimbarea clasei. */
function previewSeasonPersistent(themeId) {
  document.body.classList.remove(...[...document.body.classList].filter((c) => c.startsWith('theme-') && c !== 'theme-rank'));
  document.body.classList.add(`theme-${themeId.slice(6)}`);
  toast('👁️ Vezi sezonul acum — rămâne până reîncarci pagina', 'info', 4000);
}

function initSeason() {
  document.getElementById('sezon-clear')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      const r = await api('/admin/season', { method: 'POST', body: { theme_id: '' } });
      if (!r.ok) { toast(r.data?.error || 'Eroare', 'error'); return; }
      toast('Sezon dezactivat — toată lumea revine la tema proprie/Standard', 'success');
      const meNow = await getSession(true);
      applySiteTheme(meNow?.site_theme || null);
      loadSeason();
    });
  });
}
initSeason();

/** Previzualizare 5s a unei teme de sezon, apoi revenire la tema efectiva. */
let sezonPeekTimer = 0;
function peekSeason(themeId) {
  document.body.classList.remove(...[...document.body.classList].filter((c) => c.startsWith('theme-') && c !== 'theme-rank'));
  document.body.classList.add(`theme-${themeId.slice(6)}`);
  toast('👁️ Previzualizare 5 secunde…', 'info', 2000);
  clearTimeout(sezonPeekTimer);
  sezonPeekTimer = setTimeout(async () => {
    const me = await getSession(true);
    applySiteTheme(me?.site_theme || null);
  }, 5000);
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

// ---------------------------------------------------------------------
// CHAT LIVE: modul lent (buget — vezi src/routes/api/admin/chat-slow.js).
// Setarea sta in storage-ul ChatDO, deci comutarea nu costa nicio scriere D1.
// ---------------------------------------------------------------------
const SLOW_SECONDS = 10;
let slowWired = false;

async function loadChatSlow() {
  const btn = document.getElementById('chat-slow-toggle');
  const eticheta = document.getElementById('chat-slow-state');
  if (!btn) return;

  const res = await api('/admin/chat-slow');
  if (!res.ok) { btn.textContent = 'Indisponibil'; btn.disabled = true; return; }
  paintSlow(Number(res.data?.slow) || 0);

  if (!slowWired) {
    slowWired = true;
    btn.addEventListener('click', () => withBusy(btn, async () => {
      const acum = Number(btn.dataset.slow) || 0;
      const r = await api('/admin/chat-slow', { method: 'POST', body: { seconds: acum ? 0 : SLOW_SECONDS } });
      if (!r.ok) { toast(r.data?.error || 'Nu am putut schimba modul lent', 'error'); return; }
      const nou = Number(r.data?.slow) || 0;
      paintSlow(nou);
      toast(nou ? `Mod lent pornit: un mesaj la ${nou} secunde` : 'Mod lent oprit', 'success');
    }));
  }

  function paintSlow(secunde) {
    btn.dataset.slow = String(secunde);
    btn.textContent = secunde ? `🐇 Oprește modul lent` : `🐢 Pornește modul lent (${SLOW_SECONDS}s)`;
    if (eticheta) eticheta.textContent = secunde ? `activ: un mesaj la ${secunde}s` : 'oprit';
  }
}

// ---------------------------------------------------------------------
// NOUTATI: anunturile echipei pentru prima pagina. Seriile noi si temele
// de sezon se scriu automat la eveniment (src/lib/news.js), aici e doar
// canalul manual + retragerea unei stiri gresite.
// ---------------------------------------------------------------------
const NEWS_LABEL = { serie: 'Serie nouă', sezon: 'Sezon', anunt: 'Anunț' };
let newsFormWired = false;

async function loadNews() {
  const box = document.getElementById('news-admin-list');
  if (!box) return;
  wireNewsForm();

  const res = await api('/admin/news');
  if (!res.ok) { box.textContent = res.data?.error || 'Nu am putut încărca noutățile.'; return; }

  const items = res.data.items || [];
  box.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'box__hint';
    p.textContent = 'Încă nu există nicio noutate publicată.';
    box.appendChild(p);
    return;
  }

  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'ranks-row';

    const title = document.createElement('span');
    title.className = 'ranks-row__title';
    const eticheta = NEWS_LABEL[it.kind] || NEWS_LABEL.anunt;
    title.textContent = `[${eticheta}] ${it.title}` + (it.author ? ` — ${it.author}` : '');
    title.title = `${formatDate(it.created_at)}${it.link ? ' · ' + it.link : ''}`;
    row.appendChild(title);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--ghost btn--sm';
    del.textContent = '🗑 Retrage';
    del.addEventListener('click', () => withBusy(del, async () => {
      if (!confirm(`Retragi „${it.title}" de pe prima pagină?`)) return;
      const r = await api(`/admin/news?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' });
      if (!r.ok) { toast(r.data?.error || 'Nu am putut retrage știrea', 'error'); return; }
      toast('Știre retrasă', 'success');
      loadNews();
    }));
    row.appendChild(del);

    box.appendChild(row);
  }
}

function wireNewsForm() {
  if (newsFormWired) return;            // tabul se reincarca la fiecare click
  const form = document.getElementById('news-form');
  if (!form) return;
  newsFormWired = true;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const title = document.getElementById('news-title');
    const body = document.getElementById('news-body');
    const link = document.getElementById('news-link');
    const valLink = (link?.value || '').trim();
    // Verificam aici ca sa nu piarda omul textul scris: serverul ar taia
    // linkul extern in tacere si ar publica anuntul fara el.
    if (valLink && (!valLink.startsWith('/') || valLink.startsWith('//'))) {
      toast('Linkul trebuie să fie intern și să înceapă cu / (ex. /serie/1014)', 'error');
      return;
    }
    await withBusy(btn, async () => {
      const r = await api('/admin/news', {
        method: 'POST',
        body: { title: title?.value || '', body: body?.value || '', link: valLink },
      });
      if (!r.ok) { toast(r.data?.error || 'Nu am putut publica anunțul', 'error'); return; }
      toast('Anunț publicat pe prima pagină 📣', 'success');
      form.reset();
      loadNews();
    });
  });
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
  whenActive(() => initChat().catch(() => { /* chat optional */ }));
}
