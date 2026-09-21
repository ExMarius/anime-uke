// =====================================================================
// core.js — helper-e comune: API, escape HTML, toast, navbar, sesiune.
//
// REGULI DE SECURITATE (CSP-ul e strict: script-src 'self', fara
// 'unsafe-inline'):
//   1. NICIODATA innerHTML cu date nescurse. Fie escapeHtml(), fie
//      textContent. In v1 mesajele de chat mergeau direct in innerHTML,
//      deci orice utilizator putea executa JS in browserul altora.
//   2. Fara handlere inline (onclick="...") — sunt blocate de CSP.
//      Folosim addEventListener + data-action.
// =====================================================================

let sessionCache;

/** Escape pentru inserare in HTML. Acopera si backtick-ul. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/** Escape pentru inserare intr-un atribut de tip URL (previne javascript:). */
/** Citeste un parametru de query din URL-ul paginii. */
export function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

// Coperțile externe de la IMDb/Amazon suportă redimensionare NATIVĂ chiar
// în URL (sufixul _V1_..._UX<px>_) — cerem exact lățimea de care avem
// nevoie (card 400, serie 600, hero 1000) și primești ~30-70 KB în loc de
// 260 KB. Imaginile noastre (/covers) sunt deja WebP la deploy și rămân
// neatinse; celelalte hosturi externe sunt lăsate ca sunt (siguranță >
// optimizare, după lecția cu proxy-ul weserv care primea 404 de la IMDb).
export function optimizeCover(value, w = 400) {
  if (!value || value === '#') return value;
  try {
    const u = new URL(value, location.origin);
    if (u.origin === location.origin) return value;   // a noastră — deja optimizată
    if (/(^|\.)media-amazon\.com$/.test(u.hostname) && /_V1_.*\.jpg/i.test(u.pathname)) {
      const px = Math.min(w, 1000);                   // originalul e UX1000 — nu mărim
      u.pathname = u.pathname.replace(/_V1_.*\.jpg/i, `_V1_FMjpg_UX${px}_`);
      return u.toString();
    }
    return value;
  } catch {
    return value;
  }
}

export function safeUrl(value, fallback = '#') {
  const v = String(value || '').trim();
  if (!v) return fallback;
  try {
    const u = new URL(v, location.origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    return u.href;
  } catch {
    return fallback;
  }
}

/**
 * Wrapper fetch. Returneaza { ok, status, data }.
 * Nu arunca exceptii la eroare de retea — apelantul primeste ok:false.
 */
export async function api(path, { method = 'GET', body, signal } = {}) {
  const init = {
    method,
    headers: {},
    credentials: 'same-origin',
    signal,
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`/api${path}`, init);

    // 429 vine cu Retry-After; il pasam mai departe pentru mesaje utile
    const retryAfter = Number(res.headers.get('Retry-After')) || null;

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
    }

    if (res.status === 401) {
      sessionCache = undefined;
      return { ok: false, status: 401, data: data || { error: 'Sesiune expirată' }, retryAfter };
    }

    // orice mutatie reusita invalideaza cache-ul de sesiune
    if (method !== 'GET' && res.ok) clearSession();

    return { ok: res.ok, status: res.status, data: data || {}, retryAfter };
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, status: 0, data: { error: 'Anulat' } };
    return { ok: false, status: 0, data: { error: 'Eroare de rețea' } };
  }
}

/** Sesiunea curenta, cache-uita per pagina SI intre pagini (sessionStorage,
 *  TTL scurt). Fara cache, fiecare navigare facea un round-trip serial catre
 *  /auth/me inainte sa randeze nav-ul — una din sursele de delay perceput.
 *  Cache-ul se invalideaza la orice mutatie (POST/PATCH/DELETE) si la 401,
 *  deci punctele/gold-ul din nav raman corecte dupa actiuni. */
const ME_TTL_MS = 20 * 1000;
/** Tema cumpărată din shop: o singură clasă pe <body>, CSS-ul face restul. */
export function applySiteTheme(theme) {
  try {
    document.body.classList.remove(...[...document.body.classList].filter((c) => c.startsWith('theme-') && c !== 'theme-rank'));
    if (theme && /^theme_[a-z]+$/.test(theme) && theme !== 'theme_standard') {
      document.body.classList.add(`theme-${theme.slice(6)}`);
    }
  } catch { /* body indisponibil la momentul apelului — ignorăm */ }
}

export async function getSession(force = false) {
  if (sessionCache !== undefined && !force) return sessionCache;
  if (!force) {
    try {
      const raw = sessionStorage.getItem('auk-me');
      if (raw) {
        const c = JSON.parse(raw);
        if (c && typeof c.t === 'number' && Date.now() - c.t < ME_TTL_MS) {
          sessionCache = c.user ?? null;
          applySiteTheme(sessionCache?.site_theme || null);
          return sessionCache;
        }
      }
    } catch { /* mod privat */ }
  }
  const res = await api('/auth/me');
  if (!res.ok && res.status === 0) return sessionCache ?? null; // retea moarta: nu suprascrie
  sessionCache = res.ok ? (res.data.user || null) : undefined;
  try { sessionStorage.setItem('auk-me', JSON.stringify({ t: Date.now(), user: sessionCache })); } catch { /* ignora */ }
  return sessionCache;
}

/** Invalidare: undefined = „nu stim inca”, spre deosebire de null = „guest
 *  confirmat”. Fara distinctia asta, orice POST reusit transforma sesiunea in
 *  guest pana la reload — guard-urile dadeau redirect aiurea. */
export function clearSession() {
  sessionCache = undefined;
  try { sessionStorage.removeItem('auk-me'); } catch { /* ignora */ }
}

/** Ruleaza fn imediat, sau la activare daca pagina e prerandata: paginile
 *  prerenderate nu trebuie sa aiba efecte secundare (vizualizari, heartbeat,
 *  WebSocket) inainte ca utilizatorul sa ajunga efectiv pe ele. */
export function whenActive(fn) {
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', () => fn(), { once: true });
  } else {
    fn();
  }
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' });
  clearSession();
  location.href = '/';
}

// ---------------------------------------------------------------------
// TOAST (inlocuieste alert()-ul din v1, care bloca firul de executie)
// ---------------------------------------------------------------------
export function toast(message, type = 'info', ms = 3800) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(wrap);
  }

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message; // textContent, nu innerHTML
  wrap.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast--out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

// ---------------------------------------------------------------------
// NAVBAR — randata din /api/auth/me, nu din localStorage.
// ---------------------------------------------------------------------
export async function renderNav(active = '') {
  const nav = document.getElementById('nav');
  if (!nav) return null;

  const user = await getSession();
  nav.innerHTML = '';

  const brand = document.createElement('a');
  brand.className = 'nav__brand';
  brand.href = '/';
  const mark = document.createElement('img');
  mark.className = 'nav__brand__mark';
  mark.src = '/assets/img/logo-icon.png';
  mark.alt = '';                    // decorativ: numele e în .nav__brand__text
  mark.setAttribute('aria-hidden', 'true');
  mark.width = 34; mark.height = 34; // fără CLS: spațiul e rezervat din start
  const btext = document.createElement('span');
  btext.className = 'nav__brand__text';
  btext.textContent = 'anime-uke';
  brand.append(mark, btext);
  nav.appendChild(brand);

  const links = document.createElement('div');
  links.className = 'nav__links';
  nav.appendChild(links);

  const add = (href, label, opts = {}) => {
    const a = document.createElement('a');
    a.className = `nav__link${opts.accent ? ' nav__link--accent' : ''}${active === href ? ' is-active' : ''}`;
    a.href = href;
    a.textContent = label;
    links.appendChild(a);
    return a;
  };

  add('/', 'Serii');

  if (user) {
    const points = document.createElement('span');
    points.className = 'nav__points';
    points.textContent = `★ ${user.points}`;
    points.title = 'Puncte: +10 per episod vizionat. Te clasează în TOP-ul SĂPTĂMÂNAL — duminică top 3 primește 500/300/200 gold.';
    links.appendChild(points);

    // Economie: nivelul si gold-ul vin deja in sesiune — chipuri gratuite.
    const lvl = document.createElement('span');
    lvl.className = 'nav__points nav__points--lvl';
    lvl.textContent = `⚔️ Nv ${user.level || 1}`;
    lvl.title = `Nivelul ${user.level || 1}: crește singur din orice activitate (vizionat, misiuni, chat).`;
    links.appendChild(lvl);

    const gold = document.createElement('span');
    gold.className = 'nav__points nav__points--gold';
    gold.textContent = `🪙 ${(user.gold || 0).toLocaleString('ro-RO')}`;
    gold.title = `${(user.gold || 0).toLocaleString('ro-RO')} gold — MONEDA de cheltuit în shop: misiuni zilnice + cufere + cufărelul la 4 ore.`;
    links.appendChild(gold);

    add('/shop', '🛒 Shop');

    links.appendChild(buildBell());
    refreshBellBadge(); // dupa append: badge-ul e acum in document

    if (user.is_admin) add('/admin', 'Admin', { accent: true });

    const me = document.createElement('a');
    me.className = 'nav__link';
    me.href = '/profile';
    me.textContent = 'Profilul meu';
    links.appendChild(me);

    const chip = document.createElement('span');
    chip.className = 'nav__user';
    const hi = document.createElement('span');
    hi.textContent = 'Salut,';
    const name = document.createElement('b');
    const nameLink = document.createElement('a');
    nameLink.href = '/profile';
    nameLink.textContent = user.username;
    nameLink.title = 'Deschide profilul';
    name.appendChild(nameLink);
    chip.append(hi, name);
    links.appendChild(chip);

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn--ghost btn--sm';
    logoutBtn.type = 'button';
    logoutBtn.textContent = 'Ieșire';
    logoutBtn.addEventListener('click', logout);
    links.appendChild(logoutBtn);
  } else {
    add('/login', 'Login');
    add('/register', 'Cont nou', { accent: true });
  }

  // Semnele live („N online”) pe toate paginile — site-ul respiră.
  startPulse();

  return user;
}

// ---------------------------------------------------------------------
// CLOPOTEL DE NOTIFICARI (nav)
// Un singur element pe pagina, construit odata cu nav-ul. Badge-ul vine
// din GET /notifications/unread (indexat, ieftin): poll la 60 s + refresh
// imediat cand tab-ul revine in fata. Lista se incarca doar la click.
// ---------------------------------------------------------------------
let bellPop = null;

function notifHref(n) {
  const p = n.payload || {};
  if (p.episode_id) return `/episode?id=${encodeURIComponent(p.episode_id)}`;
  if (p.series_id) return `/series?id=${encodeURIComponent(p.series_id)}`;
  return null;
}

/** Ajusteaza badge-ul relativ (pentru updates optimiste). */
function bumpBadge(delta) {
  const b = document.getElementById('nav-bell-badge');
  if (!b || b.hidden) return;
  const n = Math.max(0, (Number(b.textContent) || 0) + delta);
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = n === 0;
}

// Un singur apel fara retry inseamna: un fetch picat tranzitoriu (retea de
// telefon, server rece) tine badge-ul greșit pana la urmatorul poll de 60 s.
// Reia scurt cu backoff la eroare de retea; succesul reseteaza backoff-ul.
let bellRetryMs = 0;
async function refreshBellBadge() {
  const b = document.getElementById('nav-bell-badge');
  if (!b) return;
  const res = await api('/notifications/unread');
  if (!res.ok && res.status === 0) {
    bellRetryMs = bellRetryMs ? Math.min(bellRetryMs * 2, 15000) : 2500;
    setTimeout(refreshBellBadge, bellRetryMs);
    return;
  }
  bellRetryMs = 0;
  const n = res.ok ? Number(res.data.count || 0) : 0;
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = n === 0;
}

async function loadNotifPop() {
  if (!bellPop) return;
  bellPop.textContent = 'Se încarcă…';
  const res = await api('/notifications?limit=30');
  bellPop.textContent = '';
  const list = res.ok ? (res.data.notifications || []) : [];

  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'notif-pop__empty';
    e.textContent = 'Nicio notificare încă.';
    bellPop.appendChild(e);
    return;
  }

  for (const n of list) {
    const a = document.createElement('a');
    a.className = `notif-pop__item${n.read ? '' : ' notif-pop__item--new'}`;
    const href = notifHref(n);
    if (href) a.href = href; else a.href = '#';
    const ic = document.createElement('span');
    ic.className = 'notif-pop__icon';
    ic.textContent = n.icon || '🔔';
    const txt = document.createElement('span');
    txt.className = 'notif-pop__text';
    const t = document.createElement('b');
    t.textContent = n.text || 'Notificare';
    const d = document.createElement('small');
    d.textContent = formatDate(n.created_at);
    txt.append(t, d);
    a.append(ic, txt);
    a.addEventListener('click', async (ev) => {
      if (href) ev.preventDefault();
      // Optimist: dispare marcajul de „nou” imediat, chiar daca reteaua
      // intarzie o suta de milisecunde.
      a.classList.remove('notif-pop__item--new');
      bumpBadge(-1);
      await api('/notifications/read', { method: 'POST', body: { ids: [n.id] } });
      refreshBellBadge();
      if (href) location.href = href;
      else if (bellPop) { bellPop.hidden = true; }
    });
    bellPop.appendChild(a);
  }

  const markAll = document.createElement('button');
  markAll.className = 'notif-pop__all';
  markAll.type = 'button';
  markAll.textContent = 'Marchează tot ca citit';
  markAll.addEventListener('click', async () => {
    markAll.disabled = true;
    markAll.textContent = 'Se marchează…';
    const r = await api('/notifications/read', { method: 'POST', body: { all: 1 } });
    // Optimist: curatam lista si badge-ul pe loc, apoi reimprospatam.
    for (const el of bellPop.querySelectorAll('.notif-pop__item--new')) {
      el.classList.remove('notif-pop__item--new');
    }
    const b = document.getElementById('nav-bell-badge');
    if (b) { b.hidden = true; b.textContent = '0'; }
    markAll.disabled = false;
    markAll.textContent = 'Marchează tot ca citit';
    if (r.ok) await loadNotifPop();
    refreshBellBadge();
  });
  bellPop.appendChild(markAll);
}

function buildBell() {
  const wrap = document.createElement('div');
  wrap.className = 'bell';

  const btn = document.createElement('button');
  btn.id = 'nav-bell';
  btn.className = 'nav__link bell__btn';
  btn.type = 'button';
  btn.title = 'Notificări';
  btn.setAttribute('aria-label', 'Notificări');
  btn.textContent = '🔔';
  const badge = document.createElement('span');
  badge.id = 'nav-bell-badge';
  badge.className = 'bell__badge';
  badge.hidden = true;
  btn.appendChild(badge);

  const pop = document.createElement('div');
  pop.id = 'notif-pop';
  pop.className = 'notif-pop';
  pop.hidden = true;

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    pop.hidden = !pop.hidden;
    if (!pop.hidden) loadNotifPop();
  });
  document.addEventListener('click', (ev) => {
    if (!pop.hidden && !pop.contains(ev.target) && ev.target !== btn) pop.hidden = true;
  });

  wrap.append(btn, pop);
  bellPop = pop;

  // Badge proaspat: la fiecare minut si cand tab-ul revine in fata.
  // Apelul initial e la call site (dupa appendChild) — aici wrap-ul e inca
  // detach-at si getElementById n-ar gasi badge-ul.
  setInterval(refreshBellBadge, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshBellBadge();
  });

  return wrap;
}

/** Dezactiveaza un buton pe durata unei actiuni async (anti dublu-click). */
export async function withBusy(button, fn) {
  if (!button) return fn();
  const prev = button.disabled;
  const label = button.textContent;
  button.disabled = true;
  button.dataset.prevLabel = label;
  button.textContent = 'Se încarcă…';
  try {
    return await fn();
  } finally {
    button.disabled = prev;
    button.textContent = button.dataset.prevLabel ?? label;
  }
}

/** Format data scurta, fara a sparge pagina la valori lipsa. */
export function formatDate(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Timp relativ în română („acum 3 min”) — limbajul site-urilor vii.
 *  Fără biblioteci: un wrapper subțire peste Intl.RelativeTimeFormat. */
export function relativeTime(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '';
  const diff = (d.getTime() - Date.now()) / 1000; // negativ = trecut
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('ro', { numeric: 'auto' });
  if (abs < 60) return 'chiar acum';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'ore');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'zile');
  return formatDate(value);
}

/** prefers-reduced-motion, acces defensiv (medii fara matchMedia). */
function reducedMotion() {
  try { return !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/** Numărătoare animată (count-up): numerele care „aleargă” sunt semnul
 *  universal al unui site live. Respectă prefers-reduced-motion. */
export function countUp(el, target, { ms = 900, format } = {}) {
  const to = Number(target) || 0;
  const fmt = format || ((n) => n.toLocaleString('ro-RO'));
  if (!el) return;
  const paint = (n) => { el.textContent = fmt(n); };
  if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
    paint(to);
    el.dataset.countFrom = String(to);
    return;
  }
  const from = Number(el.dataset.countFrom ?? '0') || 0;
  el.dataset.countFrom = String(to);
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
    paint(Math.round(from + (to - from) * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------
// PULSE — semnele live ale site-ului, pe toate paginile.
// Un chip verde în nav („N online”) + date pentru strip-ul de pe index.
// Poll la 90 s DOAR când tab-ul e vizibil; serverul ține D1 în cache
// 5 minute, deci costul total e neglijabil față de cota gratuită.
// ---------------------------------------------------------------------
let pulseData = null;
let pulseWaiters = [];

export function getPulse() {
  return pulseData;
}

/** Consumatorii se abonează; primul apel aduce datele, următorii primesc
 *  instant ultima valoare fără cereri în plus. */
export function onPulse(fn) {
  if (pulseData) fn(pulseData);
  pulseWaiters.push(fn);
}

async function fetchPulse() {
  const res = await api('/pulse');
  if (!res.ok || res.status === 0) return;
  pulseData = res.data;
  for (const fn of pulseWaiters.splice(0)) fn(pulseData);
  updatePulseChip(pulseData);
}

function updatePulseChip(data) {
  const chip = document.getElementById('pulse-chip');
  if (!chip || !data) return;
  const n = Number(data.online) || 0;
  chip.hidden = false;
  const label = chip.querySelector('.pulse-chip__n');
  if (label) label.textContent = n > 0 ? `${n} online` : 'online';
  chip.classList.toggle('pulse-chip--live', n > 0);
}

/** Chip-ul de pulse din nav. Click → deschide chat-ul (eveniment global,
 *  ca să nu importăm chat.js din core — ar fi ciclu de module). */
function buildPulseChip() {
  const chip = document.createElement('button');
  chip.id = 'pulse-chip';
  chip.type = 'button';
  chip.className = 'pulse-chip';
  chip.hidden = true;
  chip.title = 'Cine e online acum — deschide chat-ul';
  chip.innerHTML = '<span class="pulse-chip__dot" aria-hidden="true"></span>' +
    '<span class="pulse-chip__n">online</span>';
  chip.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('auk:open-chat'));
  });
  return chip;
}

export function startPulse() {
  if (document.getElementById('pulse-chip')) return;
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.appendChild(buildPulseChip());
  const tick = () => { if (!document.hidden) fetchPulse(); };
  tick();
  setInterval(tick, 90000);
  document.addEventListener('visibilitychange', tick);
}

// ---------------------------------------------------------------------
// SCROLL REVEAL — elementele „apăr” la scroll, nu stau_toate de la început.
// IntersectionObserver = zero cost pe frame; .rv primește .in o singură dată.
// ---------------------------------------------------------------------
let revealIO = null;

export function observeReveals(root = document) {
  if (reducedMotion() || !('IntersectionObserver' in window)) {
    for (const el of root.querySelectorAll('.rv:not(.in)')) el.classList.add('in');
    return;
  }
  if (!revealIO) {
    revealIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        revealIO.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });
  }
  for (const el of root.querySelectorAll('.rv:not(.in)')) revealIO.observe(el);
}

/**
 * Poster procedural, determinist din titlu: nuanta + initiale.
 *
 * De ce exista: la un catalog mare (1000+ serii de test) majoritatea nu au
 * copertă. Un fallback identic pe fiecare card ar arata ca un sablon
 * stricat; o nuanta derivata din titlu face catalogul variat si citibil,
 * fara sa coste vreo imagine si fara vreo cerere in plus.
 */
/** Gradele de staff (acordate manual de admin), cu icon + clasa CSS. */
export const STAFF_META = {
  Admin:     { icon: '🛡️', cls: 'admin' },
  Moderator: { icon: '🛠️', cls: 'mod' },
  Staff:     { icon: '⭐', cls: 'staff' },
  Helper:    { icon: '🤝', cls: 'helper' },
};

/** Iconul de staff (pentru liste compacte: online, clasament). */
export function staffIcon(staff) {
  return staff ? (STAFF_META[staff]?.icon || '🎖️') : '';
}

/** Badge de staff (Admin/Moderator/Staff/Helper) — ierarhia echipei, vizibila. */
export function staffBadge(staff) {
  if (!staff) return null;
  const meta = STAFF_META[staff] || { icon: '🎖️', cls: 'staff' };
  const s = document.createElement('span');
  s.className = 'ubadge ubadge--' + meta.cls;
  s.textContent = `${meta.icon} ${staff}`;
  s.title = `Echipa de staff: ${staff}`;
  return s;
}

/** Gradul tematic (Genin/Chunin/…) al unui om, ca cip mic langa nume. */
export function rankChip(rank) {
  if (!rank || !rank.label) return null;
  const s = document.createElement('span');
  s.className = 'uchip';
  s.textContent = `${rank.icon || '🎗️'} ${rank.label}`;
  s.title = `Grad: ${rank.label}`;
  return s;
}

export function genPoster(title) {
  const t = String(title || '').trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  const hue = h % 360;

  const el = document.createElement('div');
  el.className = 'poster__gen';
  el.style.background =
    `linear-gradient(150deg, hsl(${hue} 42% 27%), hsl(${(hue + 45) % 360} 52% 13%))`;

  const words = t.split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase();
  el.textContent = initials || t[0]?.toUpperCase() || '鬼';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// ---------------------------------------------------------------------
// NUDGE — invitația blândă pentru vizitatori.
//
// Pe paginile publice (catalog, serie, episod), după ~45 de secunde de
// vizionare, le amintim vizitatorilor că un cont deblochează progresul,
// punctele și chatul. O singură dată pe sesiune de 12 ore (localStorage):
// niciodată repede după ce a fost închisă — site-ul trebuie să pară
// prietenos, nu insistent.
// ---------------------------------------------------------------------
const NUDGE_KEY = 'auk-nudge-snooze-until';
const NUDGE_DELAY_MS = 45_000;
const NUDGE_SNOOZE_MS = 12 * 60 * 60 * 1000;

export async function startGuestNudge() {
  const user = await getSession();
  if (user) return;                                  // doar pentru vizitatori

  try {
    const until = Number(localStorage.getItem(NUDGE_KEY) || 0);
    if (until && Date.now() < until) return;         // snoozed recent
  } catch { /* localStorage poate fi blocat — continuăm fără memorie */ }

  setTimeout(() => {
    const b = document.createElement('div');
    b.className = 'nudge';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Invitație la cont');

    const text = document.createElement('div');
    text.className = 'nudge__text';
    const t1 = document.createElement('b');
    t1.textContent = 'Îți place ce vezi? 👀';
    const t2 = document.createElement('span');
    t2.textContent = ' Un cont gratuit îți salvează progresul, îți dă puncte pentru fiecare episod și acces la chat.';
    text.append(t1, t2);

    const acts = document.createElement('div');
    acts.className = 'nudge__acts';
    const yes = document.createElement('a');
    yes.className = 'btn btn--accent btn--sm';
    yes.href = '/register';
    yes.textContent = 'Cont gratuit';
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn btn--ghost btn--sm';
    no.textContent = 'Mai târziu';
    no.addEventListener('click', () => {
      b.remove();
      try { localStorage.setItem(NUDGE_KEY, String(Date.now() + NUDGE_SNOOZE_MS)); } catch {}
    });
    acts.append(yes, no);

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'nudge__x';
    x.setAttribute('aria-label', 'Închide');
    x.textContent = '✕';
    x.addEventListener('click', () => {
      b.remove();
      try { localStorage.setItem(NUDGE_KEY, String(Date.now() + NUDGE_SNOOZE_MS)); } catch {}
    });

    b.append(text, acts, x);
    document.body.appendChild(b);
    requestAnimationFrame(() => b.classList.add('nudge--in'));
  }, NUDGE_DELAY_MS);
}
