import { api, renderNav, toast, withBusy, getSession, safeUrl, genPoster } from './core.js';

// =====================================================================
// /admin/serii — lista seriilor, cu cautare si paginare pe SERVER.
//
// De ce nu ca inainte (toate seriile intr-un tabel + filtru in browser):
// la 1000+ serii tabelul devine inutilizabil, iar API-ul oricum se oprea
// la 500 de randuri, deci jumatate din catalog era invizibil.
// =====================================================================

const PER_PAGE = 25;

let me = null;
let page = 1;
let query = '';
let sort = 'latest';
let lastMeta = null;
let debounceTimer = null;

async function guard() {
  me = await getSession();
  if (!me) { location.replace(`/login?next=${encodeURIComponent(location.pathname)}`); return false; }
  if (!me.is_admin) { location.replace('/'); return false; }
  return true;
}

// ---------------------------------------------------------------- randare
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

function thumb(url, title) {
  const td = document.createElement('td');
  const box = el('div', 'thumb');
  if (url) {
    const img = document.createElement('img');
    img.src = safeUrl(url, '');
    img.alt = title || '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(el('span', 'thumb__fallback', '鬼')), { once: true });
    box.appendChild(img);
  } else {
    box.appendChild(genPoster(title));
  }
  td.appendChild(box);
  return td;
}

function renderTable(list) {
  const tbody = document.querySelector('#series-table tbody');
  tbody.innerHTML = '';

  if (!list.length) {
    tbody.appendChild(emptyRow(7, query ? `Nicio serie pentru „${query}"` : 'Nicio serie încă. Adaugă prima mai sus.'));
    return;
  }

  for (const s of list) {
    const tr = document.createElement('tr');

    tr.appendChild(thumb(s.cover_image, s.title));
    const titleTd = document.createElement('td');
    const a = el('a', 'row-link', s.title || '(fără titlu)');
    a.href = `/admin/serie/${s.id}`;
    titleTd.appendChild(a);
    tr.appendChild(titleTd);

    const st = document.createElement('td');
    st.appendChild(el('span', `pill ${s.status === 'completed' ? 'pill--ok' : 'pill--user'}`,
      s.status === 'completed' ? 'Finalizat' : 'În difuzare'));
    tr.appendChild(st);

    tr.appendChild(el('td', '', s.genre || '—'));
    tr.appendChild(el('td', '', s.year ? String(s.year) : '—'));

    const ep = document.createElement('td');
    const n = Number(s.episode_count ?? 0);
    ep.appendChild(el('span', n ? 'pill pill--user' : 'pill pill--warn', n ? `${n} EP` : '0 EP'));
    tr.appendChild(ep);

    const act = document.createElement('td');
    const wrap = el('div', 'actions');
    const open = el('a', 'btn btn--accent btn--sm', 'Deschide');
    open.href = `/admin/serie/${s.id}`;
    const view = el('a', 'btn btn--ghost btn--sm', 'Vezi');
    view.href = `/series?id=${s.id}`;
    view.target = '_blank';
    view.rel = 'noopener';
    const del = el('button', 'btn btn--danger btn--sm', 'Șterge');
    del.type = 'button';
    del.addEventListener('click', () => deleteSeries(s));
    wrap.append(open, view, del);
    act.appendChild(wrap);
    tr.appendChild(act);

    tbody.appendChild(tr);
  }
}

function renderPager(data) {
  const pager = document.getElementById('pager');
  const pages = data.pages || 1;
  pager.hidden = pages <= 1 && !data.has_more;

  document.getElementById('pg-info').textContent = `Pagina ${data.page} din ${pages}`;
  document.getElementById('pg-prev').disabled = data.page <= 1;
  document.getElementById('pg-next').disabled = !data.has_more;

  const count = document.getElementById('serii-count');
  count.textContent = query
    ? `${data.total} ${data.total === 1 ? 'rezultat' : 'rezultate'} pentru „${query}"`
    : `${data.total ?? list.length} serii în catalog`;
}

let list = [];

async function load() {
  const tbody = document.querySelector('#series-table tbody');
  tbody.innerHTML = '';
  tbody.appendChild(emptyRow(7, 'Se încarcă…'));

  const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), sort });
  if (query) params.set('q', query);

  const res = await api(`/admin/series?${params}`);
  if (!res.ok) {
    tbody.innerHTML = '';
    tbody.appendChild(emptyRow(7, res.data?.error || 'Nu am putut încărca seriile'));
    return;
  }

  lastMeta = res.data;
  list = res.data.series || [];
  if (res.data.sorts?.length) fillSorts(res.data.sorts);
  renderTable(list);
  renderPager(res.data);
}

function fillSorts(sorts) {
  const sel = document.getElementById('f-sort');
  if (sel.options.length) return; // populat deja
  for (const o of sorts) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = sort;
}

// ---------------------------------------------------------------- actiuni
async function deleteSeries(s) {
  const n = Number(s.episode_count ?? 0);
  const msg = n
    ? `Ștergi „${s.title}" și cele ${n} episoade ale ei? Acțiunea nu poate fi anulată.`
    : `Ștergi „${s.title}"?`;
  if (!confirm(msg)) return;

  const res = await api(`/admin/series?id=${s.id}`, { method: 'DELETE' });
  if (!res.ok) { toast(res.data?.error || 'Nu am putut șterge seria', 'err'); return; }
  toast(`„${s.title}" a fost ștearsă`, 'ok');
  // Daca am sters ultimul element de pe pagina curenta, ne intoarcem cu una.
  if (list.length === 1 && page > 1) page--;
  load();
}

document.getElementById('series-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = document.getElementById('series-submit');
  const data = Object.fromEntries(new FormData(form).entries());

  await withBusy(btn, async () => {
    const res = await api('/admin/series', {
      method: 'POST',
      body: {
        title: data.title,
        status: data.status,
        year: data.year || null,
        genre: data.genre,
        cover_image: data.cover_image,
        description: data.description,
      },
    });
    if (!res.ok) { toast(res.data?.error || 'Nu am putut adăuga seria', 'err', 5000); return; }

    toast(`„${data.title}" a fost adăugată`, 'ok');
    form.reset();
    document.getElementById('create-panel').hidden = true;
    // Sarim direct la pagina seriei, ca sa adaugi episoadele fara sa o cauti.
    if (res.data?.id) location.href = `/admin/serie/${res.data.id}`;
    else load();
  });
});

// ---------------------------------------------------------------- legaturi UI
function togglePanel(id, force) {
  const p = document.getElementById(id);
  p.hidden = force !== undefined ? !force : !p.hidden;
}

document.getElementById('toggle-form')?.addEventListener('click', () => {
  togglePanel('create-panel');
  if (!document.getElementById('create-panel').hidden) document.getElementById('s-title').focus();
});
document.getElementById('series-cancel')?.addEventListener('click', () => togglePanel('create-panel', false));

document.getElementById('f-sort')?.addEventListener('change', (e) => {
  sort = e.target.value;
  page = 1;
  load();
});

// Cautarea e debounced: la fiecare litera tastata am face un request, iar
// un LIKE pe tot tabelul nu e chiar gratuit.
document.getElementById('f-q')?.addEventListener('input', (e) => {
  clearTimeout(debounceTimer);
  const v = e.target.value.trim();
  debounceTimer = setTimeout(() => {
    query = v;
    page = 1;
    // Sincronizam URL-ul, ca rezultatul cautarii sa poata fi partajat.
    const u = new URL(location.href);
    if (v) u.searchParams.set('q', v); else u.searchParams.delete('q');
    history.replaceState(null, '', u);
    load();
  }, 280);
});

document.getElementById('pg-prev')?.addEventListener('click', () => { if (page > 1) { page--; load(); } });
document.getElementById('pg-next')?.addEventListener('click', () => { if (lastMeta?.has_more) { page++; load(); } });

// ---------------------------------------------------------------- pornire
if (await guard()) {
  const params = new URLSearchParams(location.search);
  query = params.get('q') || '';
  if (query) document.getElementById('f-q').value = query;

  await renderNav('');
  document.getElementById('f-sort').innerHTML = '';
  await load();
}
