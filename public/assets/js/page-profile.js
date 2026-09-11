import { api, renderNav, toast, withBusy, safeUrl } from './core.js';

// =====================================================================
// Pagina de profil public — sectiunile „Informatii" si „Acces rapid".
//
// /profile            -> propriul profil
// /profile?u=marius   -> profilul altcuiva
// =====================================================================

const target = new URLSearchParams(location.search).get('u') || 'me';

let data = null;

// ---------------------------------------------------------------- randare
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function infoRow(label, value, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'info-row';

  const dt = el('dt', 'info-row__label', label);
  const dd = el('dd', 'info-row__value');

  if (opts.href) {
    const a = el('a', '', value);
    a.href = opts.href;
    if (opts.external) { a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; }
    dd.appendChild(a);
  } else if (opts.muted) {
    dd.appendChild(el('em', 'info-row__empty', value));
  } else {
    dd.textContent = value;
  }

  wrap.append(dt, dd);
  return wrap;
}

function renderInfo() {
  const box = document.getElementById('p-info');
  const p = data.profile;
  const u = data.user;
  box.innerHTML = '';

  const motto = p.motto || 'Niciun gând de împărtășit…';

  box.append(
    infoRow('Data nașterii', p.birth_date_ro || '—', { muted: !p.birth_date_ro }),
    infoRow('Zodie', p.zodiac || '—', { muted: !p.zodiac }),
    infoRow('Vârsta', p.age != null ? `${p.age} ani` : '—', { muted: p.age == null }),
    infoRow('Gen', p.gender_label || '—', { muted: !p.gender }),
    infoRow('Țară', p.country || '—', { muted: !p.country }),
    infoRow('Facțiune', p.faction || '—', { muted: !p.faction }),
    infoRow('Membru din', u.member_since || '—'),
    infoRow('Utilizator', u.username),
    infoRow('Gând', motto, { muted: !p.motto })
  );

  if (p.mal_url) {
    box.append(infoRow('MyAnimeList', 'Vezi profilul MAL', { href: p.mal_url, external: true }));
  }
}

function renderQuick() {
  const box = document.getElementById('p-quick');
  const s = data.stats;
  box.innerHTML = '';

  const items = [
    { icon: '📺', label: 'Serii vizionate', value: s.series_watched },
    { icon: '🎬', label: 'Episoade vizionate', value: s.episodes_watched },
    { icon: '🔖', label: 'Serii de vizionat', value: s.watchlist, href: '#p-watchlist-section' },
    { icon: '⭐', label: 'Serii recomandate', href: '#p-reco-section' },
    { icon: '🏆', label: 'Puncte', value: data.user.points },
  ];
  if (data.profile.mal_url) {
    items.push({ icon: '🔗', label: 'MyAnimeList', href: data.profile.mal_url, external: true });
  }

  for (const it of items) {
    const node = it.href ? el('a', 'quick__item') : el('div', 'quick__item');
    if (it.href) {
      node.href = it.href;
      if (it.external) { node.target = '_blank'; node.rel = 'noopener noreferrer nofollow'; }
    }
    node.appendChild(el('span', 'quick__icon', it.icon));
    const body = el('div', 'quick__body');
    if (it.value !== undefined) body.appendChild(el('b', 'quick__value', String(it.value)));
    body.appendChild(el('span', 'quick__label', it.label));
    node.appendChild(body);
    box.appendChild(node);
  }
}

function renderHead() {
  const u = data.user;
  const r = data.rank;
  const p = data.profile;

  document.getElementById('p-username').textContent = u.username;
  document.title = `${u.username} • anime-uke`;

  // avatar: imagine daca exista, altfel initiala pe fond crimson
  const av = document.getElementById('p-avatar');
  const avText = document.getElementById('p-avatar-text');
  const existing = av.querySelector('img');
  if (existing) existing.remove();
  if (p.avatar_url) {
    const img = document.createElement('img');
    img.src = safeUrl(p.avatar_url, '');
    img.alt = u.username;
    img.loading = 'lazy';
    img.addEventListener('error', () => { img.remove(); avText.hidden = false; }, { once: true });
    avText.hidden = true;
    av.appendChild(img);
  } else {
    avText.hidden = false;
    avText.textContent = (u.username[0] || '?').toUpperCase();
  }

  const badges = document.getElementById('p-badges');
  badges.innerHTML = '';
  const rank = el('span', `rank rank--${r.key}`, `${r.icon} ${r.label}`);
  badges.appendChild(rank);
  if (u.is_admin) badges.appendChild(el('span', 'pill pill--admin', 'Admin'));

  document.getElementById('p-xp-fill').style.width = `${r.progress}%`;
  const label = document.getElementById('p-xp-label');
  label.textContent = r.next
    ? `${r.points.toLocaleString('ro-RO')} / ${r.next.at.toLocaleString('ro-RO')} puncte până la ${r.next.icon} ${r.next.label}`
    : `${r.points.toLocaleString('ro-RO')} puncte — rang maxim`;
  label.title = label.textContent;

  document.getElementById('p-edit-btn').hidden = !data.is_self;
}

function seriesCard(s, opts = {}) {
  const a = el('a', 'card');
  a.href = `/series?id=${encodeURIComponent(s.id ?? s.series_id)}`;

  const poster = el('div', 'poster');
  const imgSrc = s.cover_image || '';
  if (imgSrc) {
    const img = document.createElement('img');
    img.src = safeUrl(imgSrc, '');
    img.alt = s.title || '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(el('div', 'poster__fallback', '鬼')), { once: true });
    poster.appendChild(img);
  } else {
    poster.appendChild(el('div', 'poster__fallback', '鬼'));
  }
  if (opts.removable) {
    const btn = el('button', 'poster__remove', '✕');
    btn.type = 'button';
    btn.title = 'Scoate din listă';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await removeFromWatchlist(s.series_id ?? s.id);
    });
    poster.appendChild(btn);
  }
  poster.appendChild(el('span', `pill-pos${s.status === 'completed' ? ' pill-pos--ok' : ''}`,
    s.status === 'completed' ? 'Finalizat' : 'În difuzare'));

  const body = el('div', 'card__body');
  body.appendChild(el('h3', 'card__title', s.title || 'Fără titlu'));
  const meta = [s.episode_count != null ? `${s.episode_count} EP` : '', s.year || ''].filter(Boolean).join(' · ');
  if (meta) body.appendChild(el('p', 'card__meta', meta));

  a.append(poster, body);
  return a;
}

function renderReco() {
  const section = document.getElementById('p-reco-section');
  const grid = document.getElementById('p-reco');
  grid.innerHTML = '';
  const list = data.recommendations || [];
  if (!list.length) { section.hidden = true; return; }
  section.hidden = false;
  for (const s of list) grid.appendChild(seriesCard(s));
}

// ---------------------------------------------------------------- watchlist
async function loadWatchlist() {
  if (!data.is_self) {
    document.getElementById('p-watchlist-section').hidden = true;
    return;
  }
  const res = await api('/watchlist');
  const grid = document.getElementById('p-watchlist');
  const count = document.getElementById('p-watchlist-count');
  grid.innerHTML = '';

  if (!res.ok) { count.textContent = ''; return; }
  const list = res.data.watchlist || [];
  count.textContent = list.length ? `${list.length} ${list.length === 1 ? 'serie' : 'serii'}` : '';

  if (!list.length) {
    const empty = el('div', 'empty');
    empty.style.gridColumn = '1 / -1';
    empty.appendChild(el('div', 'empty__icon', '🔖'));
    empty.appendChild(el('div', '', 'Lista ta e goală.'));
    empty.appendChild(el('p', 'hint', 'Adaugă serii din butonul „De vizionat" de pe pagina fiecărei serii.'));
    grid.appendChild(empty);
    return;
  }
  for (const s of list) grid.appendChild(seriesCard(s, { removable: true }));
}

async function removeFromWatchlist(seriesId) {
  const res = await api(`/watchlist?series_id=${encodeURIComponent(seriesId)}`, { method: 'DELETE' });
  if (res.ok) {
    toast('Serie scoasă din listă.', 'ok');
    await loadWatchlist();
    if (data) { data.stats.watchlist = Math.max(0, (data.stats.watchlist || 0) - 1); renderQuick(); }
  } else {
    toast(res.data?.error || 'Nu am putut șterge din listă', 'err');
  }
}

// ---------------------------------------------------------------- editare
function openEditor() {
  const p = data.profile;
  const form = document.getElementById('profile-form');
  form.birth_date.value = p.birth_date || '';
  form.gender.value = p.gender || '';
  form.country.value = p.country || '';
  form.faction.value = p.faction || '';
  form.motto.value = p.motto || '';
  form.mal_url.value = p.mal_url || '';
  form.avatar_url.value = p.avatar_url || '';
  updateMottoCount();

  document.getElementById('p-edit-panel').hidden = false;
  document.getElementById('p-edit-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  form.birth_date.focus();
}

function closeEditor() {
  document.getElementById('p-edit-panel').hidden = true;
}

function updateMottoCount() {
  const n = document.getElementById('f-motto')?.value.length ?? 0;
  const out = document.getElementById('f-motto-count');
  if (out) out.textContent = String(n);
}

document.getElementById('f-motto')?.addEventListener('input', updateMottoCount);
document.getElementById('p-edit-btn')?.addEventListener('click', openEditor);
document.getElementById('profile-cancel')?.addEventListener('click', closeEditor);

document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = document.getElementById('profile-save');
  const body = {
    birth_date: form.birth_date.value,
    gender: form.gender.value,
    country: form.country.value.trim(),
    faction: form.faction.value.trim(),
    motto: form.motto.value.trim(),
    mal_url: form.mal_url.value.trim(),
    avatar_url: form.avatar_url.value.trim(),
  };

  await withBusy(btn, async () => {
    const res = await api('/profile', { method: 'PATCH', body });
    if (!res.ok) {
      toast(res.data?.error || 'Nu am putut salva profilul', 'err', 5000);
      return;
    }
    data = { ...data, ...res.data, is_self: true };
    renderHead(); renderInfo(); renderQuick();
    closeEditor();
    toast('Profil salvat.', 'ok');
  });
});

// ---------------------------------------------------------------- incarcare
async function load() {
  const res = await api(`/profile/${encodeURIComponent(target)}`);

  if (!res.ok) {
    document.getElementById('p-username').textContent =
      res.status === 404 ? 'Utilizator inexistent' : 'Profil indisponibil';
    document.getElementById('p-info').appendChild(
      infoRow('Eroare', res.data?.error || 'Nu am putut încărca profilul', { muted: true })
    );
    if (res.status === 404) toast('Utilizatorul nu există', 'warn');
    return;
  }

  data = res.data;
  renderHead();
  renderInfo();
  renderQuick();
  renderReco();
  await loadWatchlist();
  loadLeaderboard().catch(() => { /* clasamentul e decorativ: profilul merge oricum */ });
}

// ---------------------------------------------------------------------
// Clasament: top 20 dupa puncte + episoadele vazute in ultimele 7 zile.
// Serverul serveste dintr-un cache de 15 minute, deci lista e „proaspata
// destul" si ieftina oricand.
// ---------------------------------------------------------------------
const LB_MEDALS = ['🥇', '🥈', ''];

async function loadLeaderboard() {
  const list = document.getElementById('lb-list');
  const note = document.getElementById('lb-note');
  if (!list) return;

  const res = await api('/leaderboard');
  if (!res.ok) { list.closest('.box').hidden = true; return; }

  const { top, viewer } = res.data;
  list.innerHTML = '';

  if (!top.length) {
    note.textContent = 'Încă nimeni nu a strâns puncte. Fii primul!';
    return;
  }

  for (let i = 0; i < top.length; i++) {
    const row = top[i];
    const li = document.createElement('li');
    li.className = 'lb__row' + (viewer && row.username === viewer.username ? ' lb__row--me' : '');

    const rank = document.createElement('span');
    rank.className = 'lb__rank';
    rank.textContent = LB_MEDALS[i] || `#${i + 1}`;
    li.appendChild(rank);

    const name = document.createElement('span');
    name.className = 'lb__name';
    name.textContent = row.username;
    li.appendChild(name);

    const week = document.createElement('span');
    week.className = 'lb__week';
    week.textContent = row.week ? `${row.week} ep. săptămâna asta` : '';
    li.appendChild(week);

    const pts = document.createElement('span');
    pts.className = 'lb__pts';
    pts.textContent = `${Number(row.points).toLocaleString('ro-RO')} pct`;
    li.appendChild(pts);

    list.appendChild(li);
  }

  note.textContent = viewer && !viewer.in_top
    ? `Tu ai ${Number(viewer.points).toLocaleString('ro-RO')} puncte — în afara top 20. Se recalculează la 15 minute.`
    : 'Se recalculează la 15 minute.';
}

await renderNav('');
await load();
