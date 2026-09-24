import { api, renderNav, toast, withBusy, safeUrl, coverImg, staffBadge, staffIcon, rankChip, whenActive, initChat } from './core.js';

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
  const p = data.profile;

  const nameNode = document.getElementById('p-username');
  nameNode.textContent = (data.flair ? data.flair + ' ' : '') + u.username;
  nameNode.classList.toggle('name--gold', !!data.name_gold);
  // Culoarea numelui cumpărată din shop (câștigă peste „auriu").
  nameNode.classList.remove(...[...nameNode.classList].filter((c) => c.startsWith('nc-')));
  if (typeof data.name_color === 'string' && /^color_[a-z]+$/.test(data.name_color)) {
    nameNode.classList.add(`nc-${data.name_color.slice(6)}`);
  }
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
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.addEventListener('error', () => { img.remove(); avText.hidden = false; }, { once: true });
    avText.hidden = true;
    av.appendChild(img);
  } else {
    avText.hidden = false;
    avText.textContent = (u.username[0] || '?').toUpperCase();
  }

  const badges = document.getElementById('p-badges');
  badges.innerHTML = '';
  // UN SINGUR sistem de rang: cel tematic (nivel -> Genin..Hokage), acelasi
  // cu cel din chat/comentarii/clasament. Vechiul rang pe puncte afisa
  // „Genin" de doua ori si contrazicea economia noua (punctele = trofeu de
  // vizionare, nu moneda de rang).
  badges.appendChild(el('span', 'uchip', `⬆️ Nivel ${u.level}`));
  for (const b of [staffBadge(data.identity?.staff), rankChip(data.identity?.rank)].filter(Boolean)) {
    badges.appendChild(b);
  }

  document.getElementById('p-edit-btn').hidden = !data.is_self;
}

function seriesCard(s, opts = {}) {
  const a = el('a', 'card');
  a.href = `/series?id=${encodeURIComponent(s.id ?? s.series_id)}`;

  const poster = el('div', 'poster');
  const imgSrc = s.cover_image || '';
  if (imgSrc) {
    const img = coverImg(imgSrc, {
      w: 400, widths: [200, 300, 400], alt: s.title || '',
      sizes: '(min-width: 640px) 184px, 142px',
    });
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
// Țara: listă completă, România prestabilită. Dacă userul are salvată o
// valoare care nu e în listă, o păstrăm ca opțiune în plus (nu pierdem date).
const COUNTRIES = [
  'România', 'Africa de Sud', 'Afghanistan', 'Albania', 'Algeria', 'Andorra',
  'Angola', 'Antigua și Barbuda', 'Arabia Saudită', 'Argentina', 'Armenia',
  'Australia', 'Austria', 'Azerbaidjan', 'Bahamas', 'Bahrein', 'Bangladesh',
  'Barbados', 'Belarus', 'Belgia', 'Belize', 'Benin', 'Bhutan', 'Bolivia',
  'Bosnia și Herțegovina', 'Botswana', 'Brazilia', 'Brunei', 'Bulgaria',
  'Burkina Faso', 'Burundi', 'Cambodgia', 'Camerun', 'Canada', 'Ciad',
  'Chile', 'China', 'Cipru', 'Coasta de Fildeș', 'Columbia', 'Comore',
  'Coreea de Nord', 'Coreea de Sud', 'Costa Rica', 'Croația', 'Cuba',
  'Danemarca', 'Dominica', 'Ecuador', 'Egipt', 'El Salvador',
  'Emiratele Arabe Unite', 'Eritreea', 'Estonia', 'Eswatini', 'Etiopia',
  'Fiji', 'Filipine', 'Finlanda', 'Franța', 'Gabon', 'Gambia', 'Georgia',
  'Germania', 'Ghana', 'Grecia', 'Grenada', 'Guatemala', 'Guineea',
  'Guineea-Bissau', 'Guineea Ecuatorială', 'Guyana', 'Haiti', 'Honduras',
  'India', 'Indonezia', 'Insulele Marshall', 'Insulele Solomon', 'Iordania',
  'Irak', 'Iran', 'Irlanda', 'Islanda', 'Israel', 'Italia', 'Jamaica',
  'Japonia', 'Kazahstan', 'Kenya', 'Kiribati', 'Kirghizstan', 'Kuweit',
  'Kosovo', 'Laos', 'Lesotho', 'Letonia', 'Liban', 'Liberia', 'Libia',
  'Liechtenstein', 'Lituania', 'Luxemburg', 'Macedonia de Nord', 'Madagascar',
  'Malawi', 'Malaezia', 'Maldive', 'Mali', 'Malta', 'Mauritania', 'Mauritius',
  'Mexic', 'Micronezia', 'Moldova', 'Monaco', 'Mongolia', 'Mozambic',
  'Muntenegru', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Nicaragua', 'Niger',
  'Nigeria', 'Norvegia', 'Noua Zeelandă', 'Olanda', 'Oman', 'Pakistan',
  'Palau', 'Palestina', 'Panama', 'Papua Noua Guinee', 'Paraguay', 'Peru',
  'Polonia', 'Portugalia', 'Qatar', 'Regatul Unit',
  'Republica Centrafricană', 'Republica Cehă', 'Republica Congo',
  'Republica Democratică Congo', 'Republica Dominicană', 'Rusia', 'Rwanda',
  'Saint Kitts și Nevis', 'Saint Lucia', 'Saint Vincent și Grenadine',
  'Samoa', 'San Marino', 'São Tomé și Príncipe', 'Senegal', 'Serbia',
  'Seychelles', 'Sierra Leone', 'Singapore', 'Siria', 'Slovacia', 'Slovenia',
  'Somalia', 'Spania', 'Sri Lanka', 'Statele Unite ale Americii', 'Sudan',
  'Sudanul de Sud', 'Suedia', 'Surinam', 'Elveția', 'Tadjikistan',
  'Tanzania', 'Thailanda', 'Taiwan', 'Timorul de Est', 'Togo', 'Tonga',
  'Trinidad și Tobago', 'Tunisia', 'Turcia', 'Turkmenistan', 'Tuvalu',
  'Ucraina', 'Uganda', 'Ungaria', 'Uruguay', 'Uzbekistan', 'Vanuatu',
  'Vatican', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

function ensureCountryOptions() {
  const input = document.getElementById('f-country');
  if (!input || input.tagName === 'SELECT') return;
  const sel = document.createElement('select');
  sel.className = 'select';
  sel.id = 'f-country';
  sel.name = 'country';
  for (const c of COUNTRIES) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    sel.appendChild(o);
  }
  input.replaceWith(sel);
}
ensureCountryOptions();

function openEditor() {
  const p = data.profile;
  const form = document.getElementById('profile-form');
  form.birth_date.value = p.birth_date || '';
  form.gender.value = p.gender || '';
  const savedCountry = (p.country || '').trim();
  if (savedCountry && ![...form.country.options].some((o) => o.value === savedCountry)) {
    const o = document.createElement('option');
    o.value = savedCountry;
    o.textContent = savedCountry;
    form.country.appendChild(o);
  }
  form.country.value = savedCountry || 'România';
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
const LB_MEDALS = ['🥇', '🥈', '🥉'];

async function loadLeaderboard() {
  const list = document.getElementById('lb-list');
  const note = document.getElementById('lb-note');
  if (!list) return;

  const res = await api('/leaderboard');
  if (!res.ok) { list.closest('.box').hidden = true; return; }

  const { weekly, alltime, viewer, prize } = res.data;

  // Antetul cu miza: ce castigi si pana cand.
  const head = document.getElementById('lb-prize');
  if (head) {
    head.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'lb__prize-line';
    line.innerHTML = '';
    const t = document.createElement('span');
    t.innerHTML = '🏆 TOP-ul <b>săptămânii</b> — duminică se premiază: <b>🥇 500 🥈 300 🥉 200 🪙 gold</b>';
    line.appendChild(t);
    head.appendChild(line);
    const sub = document.createElement('div');
    sub.className = 'hint';
    sub.textContent = `Punctele (+10 per episod) te clasează aici. Săptămâna a început ${prize?.week_start || ''} (UTC).`;
    head.appendChild(sub);
  }

  list.innerHTML = '';

  if (!weekly.length) {
    note.textContent = `Încă nimeni nu a strâns puncte săptămâna asta${viewer ? ` — ai ${viewer.week_points || 0}. Fii primul din top!` : ''}.`;
    const at = document.getElementById('lb-alltime');
    if (at) at.hidden = false;
    const atList = document.getElementById('lb-alltime-list');
    if (atList) {
      atList.innerHTML = '';
      for (let i = 0; i < alltime.length; i++) atList.appendChild(lbRow(alltime[i], i, viewer, false));
    }
    return;
  }

  for (let i = 0; i < weekly.length; i++) {
    list.appendChild(lbRow(weekly[i], i, viewer, true));
  }

  // Prestigiul de tot timpul, mai jos, pliat
  const at = document.getElementById('lb-alltime');
  const atList = document.getElementById('lb-alltime-list');
  if (at && atList) {
    at.hidden = false;
    atList.innerHTML = '';
    for (let i = 0; i < alltime.length; i++) atList.appendChild(lbRow(alltime[i], i, viewer, false));
  }
}

function lbRow(row, i, viewer, weeklyMode) {
  const li = document.createElement('li');
  li.className = 'lb__row' + (viewer && row.username === viewer.username ? ' lb__row--me' : '');

  const rank = document.createElement('span');
  rank.className = 'lb__rank';
  rank.textContent = LB_MEDALS[i] || `#${i + 1}`;
  li.appendChild(rank);

  if (row.avatar) {
    const av = document.createElement('span');
    av.className = 'lb__avatar';
    const img = document.createElement('img');
    img.src = row.avatar;
    img.alt = '';
    img.loading = 'lazy';
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.addEventListener('error', () => {
      const fb = document.createElement('span');
      fb.className = 'lb__avatar-fb';
      fb.textContent = (row.username || 'A')[0].toUpperCase();
      img.replaceWith(fb);
    }, { once: true });
    li.appendChild(av);
  }

  const main = document.createElement('span');
  main.className = 'lb__main';
  const name = document.createElement('b');
  name.textContent = row.username;
  main.append(name, ` ${staffIcon(row.staff)}${row.rank?.icon || ''}`);
  li.appendChild(main);

  const val = document.createElement('span');
  val.className = 'lb__pts';
  if (weeklyMode) {
    val.textContent = `${(row.pts || 0).toLocaleString('ro-RO')} pct`;
    val.title = `${row.eps || 0} episoade vizionate săptămâna asta${row.prize ? ` · la final: +${row.prize} 🪙` : ''}`;
  } else {
    val.textContent = `${(row.points || 0).toLocaleString('ro-RO')} pct`;
    val.title = 'Total de tot timpul';
  }
  li.appendChild(val);

  if (weeklyMode && row.prize) {
    const pz = document.createElement('span');
    pz.className = 'lb__gold';
    pz.textContent = `+${row.prize} 🪙`;
    pz.title = `Premiul locului ${i + 1} la finalul săptămânii`;
    li.appendChild(pz);
  }
  return li;
}

// ---------------------------------------------------------------------
// Economie: XP + nivel, puncte lunare, gold, cufar la 4 ore, insigne.
// Panoul apare doar pe propriul profil — /api/economy e privat oricum.
// ---------------------------------------------------------------------
let econData = null;
let chestBusy = false;

const fmt = (n) => Number(n).toLocaleString('ro-RO');

function fmtRemaining(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const sec = total % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}


function renderEconomy() {
  const d = econData;
  document.getElementById('econ-level').textContent = `Nivel ${d.level}`;

  // Rangul tematic, mare, cu urmatorul prag — progresia ta intr-o privire.
  const rankEl = document.getElementById('econ-rank');
  if (rankEl && d.rank) rankEl.textContent = `${d.rank.icon || '🎗️'} ${d.rank.label}`;
  const nextEl = document.getElementById('econ-rank-next');
  if (nextEl) {
    nextEl.textContent = d.rank?.next_label
      ? `Următorul: ${d.rank.next_icon || ''} ${d.rank.next_label} la nivelul ${d.rank.next_min}`
      : 'Rang maxim atins 👑';
  }
  const stEl = document.getElementById('econ-streak');
  if (stEl && d.streak) {
    stEl.textContent = `🔥 ${d.streak.current} ${d.streak.current === 1 ? 'zi' : 'zile'} la rând`;
    stEl.title = `Recordul tău: ${d.streak.best} ${d.streak.best === 1 ? 'zi' : 'zile'} consecutive`;
    stEl.classList.toggle('econ__streak--on', d.streak.active_today);
  }

  const st = d.stats || {};
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = fmt(v || 0); };
  set('econ-st-watched', st.watched);
  set('econ-st-comments', st.comments);
  set('econ-st-chest', st.chest_opens);
  set('econ-st-subs', st.subscriptions);

  const xpPct = d.xp_needed > 0 ? Math.min(100, Math.round((d.xp / d.xp_needed) * 100)) : 0;
  document.getElementById('econ-xp-fill').style.width = `${xpPct}%`;
  let xpLabel = `${fmt(d.xp)} / ${fmt(d.xp_needed)} XP până la nivelul următor`;
  if ((d.xp_boost_ms || 0) > 0) {
    xpLabel += ` · ⚡ Boost ×2 încă ${Math.floor(d.xp_boost_ms / 3600000)}h ${Math.floor((d.xp_boost_ms % 3600000) / 60000)}m`;
  }
  document.getElementById('econ-xp-label').textContent = xpLabel;

  const mPct = Math.min(100, Math.round((d.monthly_points / d.monthly_goal) * 100));
  document.getElementById('econ-month-fill').style.width = `${mPct}%`;
  document.getElementById('econ-month-label').textContent =
    `${fmt(d.monthly_points)} / ${fmt(d.monthly_goal)} pct`;

  document.getElementById('econ-gold').textContent = `🪙 ${fmt(d.gold)} Gold`;

  renderBadges();
  renderChestState();
}

// ---------------------------------------------------------------------
// MISIUNILE ZILNICE — 3 scopuri pe zi, gold sigur. Progresul se actualizeaza
// singur cand faci actiunea (watch/comment/chest deja notifica serverul);
// aici doar afisam si permitem revendicarea.
// ---------------------------------------------------------------------
let missionData = null;

async function loadMissions() {
  const res = await api('/missions');
  if (!res.ok) return;
  missionData = res.data;
  renderMissions();
}

function renderMissions() {
  const box = document.getElementById('econ-missions');
  if (!box || !missionData?.missions?.length) return;
  box.innerHTML = '';

  for (const m of missionData.missions) {
    const row = document.createElement('div');
    row.className = `mission${m.claimed ? ' mission--done' : ''}${m.progress >= m.target && !m.claimed ? ' mission--ready' : ''}`;

    const ic = document.createElement('span');
    ic.className = 'mission__icon';
    ic.textContent = m.icon;

    const mid = document.createElement('div');
    mid.className = 'mission__mid';
    const lab = document.createElement('span');
    lab.className = 'mission__label';
    lab.textContent = m.label;
    const bar = document.createElement('div');
    bar.className = 'mission__bar';
    const fill = document.createElement('div');
    fill.className = 'mission__fill';
    fill.style.width = `${Math.min(100, Math.round((m.progress / m.target) * 100))}%`;
    bar.appendChild(fill);
    mid.append(lab, bar);

    const right = document.createElement('div');
    right.className = 'mission__right';
    const rew = document.createElement('span');
    rew.className = 'mission__reward';
    rew.textContent = `🪙 ${m.gold} · +${m.xp} XP`;
    right.appendChild(rew);

    if (m.claimed) {
      const ok = document.createElement('span');
      ok.className = 'mission__state';
      ok.textContent = '✓ luată';
      right.appendChild(ok);
    } else if (m.progress >= m.target) {
      const btn = document.createElement('button');
      btn.className = 'btn btn--accent btn--sm mission__claim';
      btn.type = 'button';
      btn.textContent = 'Revendică';
      btn.addEventListener('click', () => claimMission(btn, m.key));
      right.appendChild(btn);
    } else {
      const p = document.createElement('span');
      p.className = 'mission__state';
      p.textContent = `${m.progress}/${m.target}`;
      right.appendChild(p);
    }

    row.append(ic, mid, right);
    box.appendChild(row);
  }

  // Streak-ul din banda hero e si el informatia din misiuni (proaspata).
  if (missionData.streak && econData) {
    econData.streak = missionData.streak;
    const stEl = document.getElementById('econ-streak');
    if (stEl) {
      const c = missionData.streak.current;
      stEl.textContent = `🔥 ${c} ${c === 1 ? 'zi' : 'zile'} la rând`;
      stEl.classList.toggle('econ__streak--on', missionData.streak.active_today);
    }
  }
}

async function claimMission(btn, key) {
  btn.disabled = true;
  btn.textContent = '…';
  const res = await api('/missions', { method: 'POST', body: { mission: key } });
  if (!res.ok) {
    toast(res.data?.error || 'Nu am putut revendica recompensa', 'err');
    btn.disabled = false;
    btn.textContent = 'Revendică';
    return;
  }
  missionData = { missions: res.data.missions, streak: res.data.streak };
  if (econData && res.data.me) {
    econData.gold = res.data.me.gold;
    document.getElementById('econ-gold').textContent = `🪙 ${fmt(econData.gold)} Gold`;
  }
  renderMissions();
  toast(`+${res.data.reward.gold} 🪙 și +${res.data.reward.xp} XP — misiune îndeplinită!`, 'ok');
}

function renderBadges() {
  const box = document.getElementById('econ-badges');
  box.innerHTML = '';
  if (!econData.badges.length) {
    const hint = el('p', 'econ__hint', 'Încă nicio insignă. Vizionează un episod ca să primești prima!');
    box.appendChild(hint);
    return;
  }

  // „Utilizator activ" se aggregateaza: xN luni, tooltip cu fiecare luna.
  const grouped = new Map();
  for (const b of econData.badges) {
    const key = b.badge === 'month_active' ? 'month_active' : `${b.badge}:${b.month || ''}`;
    if (!grouped.has(key)) grouped.set(key, { ...b, count: 0, months: [] });
    const g = grouped.get(key);
    g.count += 1;
    if (b.month) g.months.push(b.month);
  }
  const monthPoints = new Map(econData.months.map((m) => [m.month, m.points]));

  for (const g of grouped.values()) {
    const tile = el('span', 'econ-badge');
    tile.textContent = `${g.icon} ${g.name}${g.count > 1 ? ` ×${g.count}` : ''}`;
    if (g.badge === 'month_active' && g.months.length) {
      const lines = g.months
        .map((m) => `${m}: ${fmt(monthPoints.get(m) || 0)} pct`)
        .join('\n');
      tile.title = `Utilizator activ în:\n${lines}`;
    } else {
      tile.title = g.name;
    }
    box.appendChild(tile);
  }
}

function renderChestState() {
  const btn = document.getElementById('chest-btn');
  const icon = document.getElementById('chest-icon');
  const label = document.getElementById('chest-label');
  btn.classList.remove('chest-btn--ready', 'chest-btn--wait');
  btn.dataset.useKey = '';
  if (econData.chest.available) {
    btn.classList.add('chest-btn--ready');
    icon.textContent = '🧰';
    label.textContent = 'Cufărul te așteaptă!';
    btn.disabled = false;
  } else if ((econData.chest_keys || 0) > 0) {
    // 🗝️ Cheia din shop sare peste cooldown
    btn.classList.add('chest-btn--ready');
    icon.textContent = '🗝️';
    label.textContent = `Deschide cu cheie (ai ${econData.chest_keys})`;
    btn.disabled = false;
    btn.dataset.useKey = '1';
  } else {
    btn.classList.add('chest-btn--wait');
    icon.textContent = '🔒';
    label.textContent = `Poți deschide peste ${fmtRemaining(econData.chest.remaining_ms)}`;
    btn.disabled = true;
  }
}

// --- animatia cufarului, exact secventa din spec:
// shake 800ms → deschidere pop 500ms → sclipici → modal → puls gold ---
function sparkleBurst(host) {
  for (let i = 0; i < 14; i++) {
    const sp = document.createElement('span');
    sp.className = 'sparkle';
    sp.textContent = '✨';
    sp.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 220)}px`);
    sp.style.setProperty('--dy', `${Math.round((Math.random() - 0.8) * 220)}px`);
    sp.style.animationDelay = `${Math.round(Math.random() * 200)}ms`;
    host.appendChild(sp);
    setTimeout(() => sp.remove(), 900);
  }
}

async function openChest() {
  if (chestBusy || !econData || (!econData.chest.available && !(econData.chest_keys > 0))) return;
  chestBusy = true;

  const btn = document.getElementById('chest-btn');
  const icon = document.getElementById('chest-icon');
  btn.disabled = true;
  btn.classList.add('chest-shake');

  try {
    const useKey = btn.dataset.useKey === '1';
    const res = await api('/chest', { method: 'POST', body: useKey ? { use_key: 1 } : undefined });
    if (!res.ok) {
      btn.classList.remove('chest-shake');
      if (res.status === 409) {
        toast('Cufărul se răcește încă — mai ai de așteptat.', 'warn');
        econData = (await api('/economy')).data || econData;
        if (econData) renderChestState();
      } else {
        toast(res.data?.error || 'Nu am putut deschide cufărul.', 'error');
        btn.disabled = false;
      }
      return;
    }

    const r = res.data;
    // pop + sclipici pe buton
    btn.classList.remove('chest-shake');
    icon.textContent = r.reward === 'gold' ? '🪙' : r.reward === 'xp' ? '⚡' : '💨';
    icon.classList.add('chest-pop');
    sparkleBurst(btn);
    setTimeout(() => icon.classList.remove('chest-pop'), 550);

    // modal cu recompensa
    const modal = document.getElementById('chest-modal');
    document.getElementById('chest-modal-icon').textContent =
      r.reward === 'gold' ? '🪙' : r.reward === 'xp' ? '⚡' : '🫙';
    document.getElementById('chest-modal-text').textContent = r.text;
    modal.hidden = false;
    modal.querySelector('.econ-modal__card').classList.add('econ-modal__card--in');

    // puls gold pe chipul din header-ul economiei
    if (r.reward === 'gold') {
      const g = document.getElementById('econ-gold');
      g.textContent = `🪙 ${fmt(r.gold)} Gold`;
      g.classList.remove('gold-pulse');
      void g.offsetWidth; // restart animatie
      g.classList.add('gold-pulse');
      setTimeout(() => g.classList.remove('gold-pulse'), 1600);
    }

    // re-sincronizare completa (xp/luna/insigne s-ar fi putut schimba)
    econData.gold = r.gold;
    econData.chest = r.chest;
    const fresh = await api('/economy');
    if (fresh.ok) econData = fresh.data;
    renderEconomy();
    if (r.reward === 'xp') toast(`+${r.amount} XP!`, 'success');
    renderNav('').catch(() => {});
  } catch {
    btn.classList.remove('chest-shake');
    btn.disabled = false;
    toast('Eroare de rețea la deschiderea cufărului.', 'error');
  } finally {
    chestBusy = false;
  }
}

// ---------------------------------------------------------------------
// Facțiunea mea: alegerea (o dată pe lună), reputația, topul membriilor
// (cu liderul 👑), clasamentul dintre facțiuni și bonusul 1.5x.
// ---------------------------------------------------------------------
let factionData = null;

async function loadFaction() {
  const box = document.getElementById('faction-box');
  if (!box) return;
  const res = await api('/factions');
  if (!res.ok) { box.hidden = true; return; }
  factionData = res.data;
  paintFaction();
}

function factionPickHTML(useToken = false) {
  const d = factionData;
  const wrap = document.createElement('div');
  wrap.className = 'faction__pick';
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.innerHTML = useToken
    ? `Ai <b>${d.faction_tokens || 0} jetoane 🔀</b> — alege facțiunea în care treci ACUM (se consumă 1 jeton).`
    : 'Alege o facțiune la <b>începutul lunii</b>. Episoadele, comentariile și cufărul îți aduc <b>reputație</b> pentru ea.';
  wrap.appendChild(hint);

  const grid = document.createElement('div');
  grid.className = 'faction__grid';
  for (const f of d.factions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'faction__card';
    b.innerHTML = '';
    const icon = document.createElement('span');
    icon.className = 'faction__icon';
    icon.textContent = f.icon;
    const name = document.createElement('span');
    name.className = 'faction__name';
    name.textContent = f.title;
    const tiers = document.createElement('span');
    tiers.className = 'faction__tiers';
    tiers.textContent = f.tiers.map((x) => x.label).join(' → ');
    b.append(icon, name, tiers);
    b.addEventListener('click', async () => {
      if (useToken && f.slug === d.my_faction) { toast('Ești deja în facțiunea asta.', 'info'); return; }
      const q = useToken
        ? `Treci în facțiunea „${f.title}" ACUM, cu 1 jeton 🔀?`
        : `Intri în facțiunea „${f.title}"? Alegerea e blocată până la începutul lunii următoare.`;
      if (!confirm(q)) return;
      const r = await api('/factions', { method: 'POST', body: useToken ? { faction: f.slug, use_token: 1 } : { faction: f.slug } });
      if (!r.ok) { toast(r.data?.error || 'Nu am putut schimba facțiunea', 'error'); return; }
      toast(useToken ? `🔀 Bine ai venit în ${f.title}! (1 jeton consumat)` : `🏛️ Bun venit în ${f.title}! Gradele tale sunt acum pe tema ei.`, 'success', 6000);
      await loadFaction();
      renderNav('').catch(() => {});
    });
    grid.appendChild(b);
  }
  wrap.appendChild(grid);
  return wrap;
}

function paintFaction() {
  const d = factionData;
  const sub = document.getElementById('faction-sub');
  const body = document.getElementById('faction-body');
  const stand = document.getElementById('faction-standings');
  if (!sub || !body) return;

  body.innerHTML = '';
  stand.innerHTML = '';

  if (!d.my_faction) {
    sub.textContent = `Nu ești în nicio facțiune în luna ${d.month}.`;
    body.appendChild(factionPickHTML());
    return;
  }

  const f = d.factions.find((x) => x.slug === d.my_faction);
  const leaderRow = (d.members || []).find((m) => m.leader);
  sub.innerHTML = '';
  const t1 = document.createElement('span');
  t1.innerHTML = `${f?.icon || '🏛️'} <b>${f?.title || d.my_faction}</b> · ${d.my_rep} reputație în ${d.month}`;
  sub.appendChild(t1);
  if (d.prev_winner && d.prev_winner.faction === d.my_faction) {
    const t2 = document.createElement('span');
    t2.className = 'faction__win';
    t2.innerHTML = ' 🏅 Facțiunea ta a CÂȘTIGAT luna trecută — primești 1.5x gold și XP!';
    sub.appendChild(t2);
  }

  // 🔀 Jetonul din shop: schimbare imediata, fara sa astepti luna urmatoare.
  if (!d.can_change && (d.faction_tokens || 0) > 0) {
    body.appendChild(factionPickHTML(true));
  } else if (!d.can_change) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.innerHTML = 'Schimbarea e blocată până la începutul lunii următoare — sau <b>acum</b>, cu un 🔀 <a href="/shop">jeton din shop</a>.';
    body.appendChild(note);
  }

  // Top membri + lider
  const ol = document.createElement('ol');
  ol.className = 'lb';
  for (const m of d.members || []) {
    const li = document.createElement('li');
    li.className = 'lb__row' + (m.me ? ' lb__row--me' : '');
    const rk = document.createElement('span');
    rk.className = 'lb__rank';
    rk.textContent = m.leader ? '👑' : '•';
    li.appendChild(rk);
    const nm = document.createElement('span');
    nm.className = 'lb__main' + (m.leader ? ` nc-${f?.leader_class || 'gold'}` : '');
    nm.textContent = m.username;
    if (m.leader) nm.title = 'Liderul facțiunii luna aceasta';
    li.appendChild(nm);
    const v = document.createElement('span');
    v.className = 'lb__pts';
    v.textContent = `${m.rep} rep`;
    li.appendChild(v);
    ol.appendChild(li);
  }
  body.appendChild(ol);
  if (!(d.members || []).length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Încă nimeni nu a strâns reputație luna asta în facțiunea ta. Fii primul: vezi un episod sau comentează!';
    body.appendChild(p);
  }

  // Regulile, scurt
  const rules = document.createElement('p');
  rules.className = 'hint';
  rules.innerHTML = d.can_change
    ? 'Poți schimba facțiunea până la prima ta alegere din luna asta. Liderul (cea mai mare reputație) primește culoarea unică a numelui luna următoare.'
    : 'Alegerea e blocată până la începutul lunii următoare. Liderul (cea mai mare reputație) primește culoarea unică a numelui luna următoare.';
  body.appendChild(rules);

  // Clasamentul dintre facțiuni
  if ((d.standings || []).length) {
    const h = document.createElement('h3');
    h.className = 'box__title';
    h.style.fontSize = '1.05rem';
    h.textContent = '⚔️ Clasamentul facțiunilor';
    stand.appendChild(h);
    const ol2 = document.createElement('ol');
    ol2.className = 'lb lb--muted';
    for (const sRow of d.standings) {
      const li = document.createElement('li');
      li.className = 'lb__row' + (sRow.faction === d.my_faction ? ' lb__row--me' : '');
      const i = d.standings.indexOf(sRow);
      const rk = document.createElement('span');
      rk.className = 'lb__rank';
      rk.textContent = ['🥇', '🥈', '🥉'][i] || `#${i + 1}`;
      li.appendChild(rk);
      const nm = document.createElement('span');
      nm.className = 'lb__main';
      const ff = d.factions.find((x) => x.slug === sRow.faction);
      nm.textContent = `${ff?.icon || '🏛️'} ${ff?.title || sRow.faction}`;
      if (d.prev_winner && d.prev_winner.faction === sRow.faction) nm.textContent += ' 🏅';
      li.appendChild(nm);
      const v = document.createElement('span');
      v.className = 'lb__pts';
      v.textContent = `${sRow.total} rep · ${sRow.members} membri`;
      li.appendChild(v);
      ol2.appendChild(li);
    }
    stand.appendChild(ol2);
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Facțiunea câștigătoare a lunii dă membrilor ei 1.5x gold și XP luna următoare 🏅';
    stand.appendChild(note);
  }
}

async function initEconomy() {
  const res = await api('/economy');
  if (!res.ok) return;
  econData = res.data;
  document.getElementById('p-econ').hidden = false;
  // Fara asta panoul ramane pe valorile placeholder din HTML („Se incarca…”,
  // „0 / 600 XP”, vitrina de insigne goala) — apelul se pierduse la
  // refactorizarea pe factiuni.
  renderEconomy();
  loadFaction().catch(() => { /* panoul e optional */ });
  loadMissions().catch(() => { /* misiunile sunt optionale */ });

  document.getElementById('chest-btn').addEventListener('click', () => {
    // shake-ul porneste imediat (800ms) chiar daca POST-ul e pe drum
    if (!chestBusy && econData?.chest.available) {
      document.getElementById('chest-btn').classList.add('chest-shake');
    }
    openChest();
  });
  document.getElementById('chest-modal-close').addEventListener('click', () => {
    const modal = document.getElementById('chest-modal');
    modal.hidden = true;
    modal.querySelector('.econ-modal__card').classList.remove('econ-modal__card--in');
  });
  document.getElementById('chest-modal').addEventListener('click', (ev) => {
    if (ev.target.id === 'chest-modal') document.getElementById('chest-modal-close').click();
  });

  // countdown-ul din buton se actualizeaza singur, fara cereri catre server
  setInterval(() => {
    if (!econData || econData.chest.available || chestBusy) return;
    econData.chest.remaining_ms = Math.max(0, econData.chest.remaining_ms - 1000);
    if (econData.chest.remaining_ms === 0) econData.chest.available = true;
    renderChestState();
  }, 1000);
}

await Promise.all([renderNav(''), load()]);
whenActive(() => initChat().catch(() => { /* chat optional */ }));
if (target === 'me') initEconomy().catch(() => { /* panoul e bonus, profilul merge oricum */ });

// ---------------------------------------------------------------------
// Taburi profil: fiecare secțiune are pagina ei (Prezentare / Progres /
// Facțiunea / Clasamente / Liste). Se ține minte tabul ales; hash-ul din
// URL (#factiune) deschide direct tabul respectiv.
// ---------------------------------------------------------------------
function initProfileTabs() {
  const bar = document.getElementById('p-tabs');
  if (!bar) return;
  const btns = [...bar.querySelectorAll('.ptabs__btn')];
  const panes = [...document.querySelectorAll('.ptab')];

  const activate = (id, save) => {
    if (!panes.some((p) => p.dataset.pane === id)) id = 'start';
    btns.forEach((b) => b.classList.toggle('is-active', b.dataset.ptab === id));
    panes.forEach((p) => p.classList.toggle('is-active', p.dataset.pane === id));
    if (save) {
      try { sessionStorage.setItem('ptab', id); } catch { /* privat */ }
      history.replaceState(null, '', `#${id}`);
    }
  };

  btns.forEach((b) => b.addEventListener('click', () => activate(b.dataset.ptab, true)));

  let initial = '';
  try { initial = sessionStorage.getItem('ptab') || ''; } catch { /* privat */ }
  if ((location.hash || '').slice(1)) initial = location.hash.slice(1);
  activate(initial || 'start', false);
}
initProfileTabs();
