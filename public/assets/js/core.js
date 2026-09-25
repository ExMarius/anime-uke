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
import { initAnimBg } from './anim-bg.js';

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

/**
 * <img> pentru o copertă, cu lățimea potrivită slotului în care intră.
 *
 * De ce nu ajungea `optimizeCover`: acolo cerem O singură lățime, aleasă de
 * noi. Cardul din grilă are 184 px pe desktop și 142 px pe telefon, dar
 * cerea 400 px — de ~2-3x mai mulți octeți pe fiecare poster; thumbnail-ul
 * din admin are 34 px și cerea coperta întreagă. Aici îi dăm browserului
 * `srcset` + `sizes` (exact ca la bannerul din pagina principală): alege el
 * treapta, ținând cont și de ecranul retina, iar `decoding=async` scoate
 * decodarea JPEG/WebP de pe firul principal (mai puțin TBT la scroll).
 *
 * `w` rămâne lățimea de bază din `src` (fallback pentru browsere fără
 * srcset) și e plafonul: nu cerem niciodată mai mult decât înainte.
 */
export function coverImg(cover, opts = {}) {
  const { w = 400, widths, sizes, alt = '', loading = 'lazy', className = '' } = opts;
  const img = document.createElement('img');
  const url = safeUrl(cover, '');
  if (className) img.className = className;
  img.alt = alt;
  img.loading = loading;
  img.decoding = 'async';
  const steps = [...new Set((widths || [w]).map((x) => Math.min(x, w)))].sort((a, b) => a - b);
  if (url && url !== '#') {
    if (steps.length > 1) {
      img.srcset = steps.map((x) => `${optimizeCover(url, x)} ${x}w`).join(', ');
      img.sizes = sizes || `${w}px`;
    }
    img.src = optimizeCover(url, w);
  }
  return img;
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
    const valid = theme && /^theme_[a-z]+$/.test(theme) && theme !== 'theme_standard';
    if (valid) {
      document.body.classList.add(`theme-${theme.slice(6)}`);
    }
    // Sincronizam cache-ul instant: la urmatoarea pagina tema se aplica din
    // localStorage inainte de fetch-ul de sesiune (zero flash). Sursa
    // adevarului ramane serverul — getSession rescrie la fiecare raspuns.
    try {
      if (valid) localStorage.setItem('auk-theme', theme);
      else localStorage.removeItem('auk-theme');
    } catch { /* mod privat — ramanem pe aplicarea din sesiune */ }
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
  // FIX: tema se aplica si pe calea network, nu doar din cache-ul de sesiune.
  // Fara linia asta, prima pagina dupa >20s de pauza ramanea netemata pana
  // la urmatoarea navigare (si motorul canvas nu pornea niciodata pe ea).
  applySiteTheme(sessionCache?.site_theme || null);
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
  try { localStorage.removeItem('auk-theme'); } catch { /* ignora */ }
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
  // .webp direct: assetul nu mai trece prin worker (public/_routes.json), deci
  // nu mai exista negociere Accept: image/webp pe server. Toate browserele care
  // ruleaza acest site (module ES, WebP din 2020) il afiseaza.
  mark.src = '/assets/img/logo-icon.webp';
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
// POLLING ADAPTIV (buget 0)
//
// De ce exista: clopotelul si chipul „N online” se improspateaza din API,
// iar un setInterval fix cheltuieste invocari la nesfarsit — inclusiv pe
// un tab uitat deschis peste noapte, care intreaba de 1.440 de ori pe zi
// „cate notificari am?” ca sa primeasca de fiecare data acelasi „0”.
// Cota planului gratuit e de 100.000 de invocari/zi, deci ~70 de tab-uri
// uitate deschise o golesc toata, fara nicio informatie noua.
//
// Regula celor patru opriri — un poll se opreste cand:
//   1. tab-ul e ASCUNS (document.hidden): nimeni nu vede badge-ul;
//   2. tab-ul e INACTIV de 10 minute (fara mouse/tastatura/scroll): omul
//      a plecat de tot, chiar daca fereastra a ramas in fata;
//   3. numarul NU s-a schimbat: intervalul se dubleaza 60 s -> 120 s ->
//      240 s pana la plafonul de 5 minute (si revine la 60 s imediat ce
//      apare ceva nou — cine primeste notificari le vede repede);
//   4. pagina e parasita: stop() curata tot (fara scurgeri de timere).
//
// Distanta minima intre doua cereri (minGap) taie si „furtuna de tab-uri”:
// cine comuta de zece ori intre ferestre nu declanseaza zece cereri.
//
// Functia polluita intoarce `true` daca s-a schimbat ceva (adica vreau sa
// raman la intervalul scurt). Orice altceva (undefined/false) = liniste,
// deci poll-ul isi largeste pasul.
// ---------------------------------------------------------------------
export const POLL_BELL_MS = 60_000;
export const POLL_PULSE_MS = 90_000;
export const POLL_MAX_MS = 300_000;
export const POLL_IDLE_MS = 600_000;

/** Miscarile care inseamna „omul e aici”. Scroll-ul nu bubuie, deci capture. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

/**
 * Urmatorul interval, in milisecunde. `0` = NU programa nimic (tab inactivil).
 * Functie pura, fara timere: testele o verifica direct (tests/poll-buget.mjs).
 */
export function nextPollDelay(unchanged, idleMs, base = POLL_BELL_MS, max = POLL_MAX_MS, idleAfter = POLL_IDLE_MS) {
  if (!(idleMs < idleAfter)) return 0;
  const steps = Math.max(0, Math.min(Number(unchanged) || 0, 3));
  return Math.min(base * 2 ** steps, max);
}

/**
 * Porneste un poll care respecta cele patru opriri de mai sus.
 * Intoarce { stop, poke, stats } — `poke()` spune „s-a intamplat ceva,
 * uita-te acum” (il foloseste codul care stie ca numarul s-a schimbat).
 */
export function adaptivePoll(fn, opts = {}) {
  const base = opts.base ?? POLL_BELL_MS;
  const max = opts.max ?? POLL_MAX_MS;
  const idleAfter = opts.idleAfter ?? POLL_IDLE_MS;
  const minGap = opts.minGap ?? Math.min(base, 30_000);

  // runNow pleacă de la -1 ca PRIMUL interval programat să fie `base`, nu
  // dublul: altfel fetch-ul imediat ar conta ca „nimic nou” și am sări pasul scurt.
  let unchanged = opts.runNow === false ? 0 : -1;
  let lastActivity = Date.now();
  let lastRun = 0;
  let timer = null;
  let stopped = false;

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = null;
    const delay = nextPollDelay(unchanged, Date.now() - lastActivity, base, max, idleAfter);
    if (!delay) return;          // inactiv: nu programam nimic, reia la miscare
    timer = setTimeout(run, delay);
  }

  async function run() {
    if (stopped) return;
    if (document.hidden) return; // tab ascuns: nici macar nu reprogramam
    lastRun = Date.now();
    let changed = false;
    try {
      changed = (await fn()) === true;
    } catch { /* un poll nu are voie sa rupa pagina */ }
    unchanged = changed ? 0 : unchanged + 1;
    schedule();
  }

  /** Activitate sau tab revenit in fata: cel mult o cerere la minGap. */
  function poke() {
    lastActivity = Date.now();
    if (stopped || document.hidden) return;
    if (Date.now() - lastRun < minGap) return;
    clearTimeout(timer);
    timer = null;
    run();
  }

  // Scroll/click țin tab-ul „viu” (nu se oprește după 10 min de citit), dar
  // NU cer date noi. Altfel un scroll la fiecare 30 s ar anula backoff-ul și
  // am cheltui iar o invocare la fiecare minGap. Excepție: revenirea din
  // inactivitate — timerul era oprit, deci merită o privire imediată.
  const onActivity = () => {
    const wasIdle = !(Date.now() - lastActivity < idleAfter);
    lastActivity = Date.now();
    if (wasIdle) poke();
  };
  const onVisibility = () => { if (!document.hidden) poke(); };

  if (typeof document !== 'undefined' && document.addEventListener) {
    for (const ev of ACTIVITY_EVENTS) {
      document.addEventListener(ev, onActivity, { passive: true });
    }
    document.addEventListener('scroll', onActivity, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVisibility);
  }

  if (opts.runNow === false) schedule();
  else run();

  return {
    poke,
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      if (typeof document !== 'undefined' && document.removeEventListener) {
        for (const ev of ACTIVITY_EVENTS) document.removeEventListener(ev, onActivity);
        document.removeEventListener('scroll', onActivity, { capture: true });
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
    stats: () => ({ unchanged, idleMs: Date.now() - lastActivity, scheduled: !!timer, lastRun }),
  };
}

// ---------------------------------------------------------------------
// CLOPOTEL DE NOTIFICARI (nav)
// Un singur element pe pagina, construit odata cu nav-ul. Badge-ul vine
// din GET /notifications/unread (indexat, ieftin), prin adaptivePoll:
// 60 s cand se misca ceva, pana la 5 min cand e liniste, deloc pe un tab
// ascuns sau parasit. Lista se incarca doar la click.
// ---------------------------------------------------------------------
let bellPop = null;
let bellPoll = null;

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
/**
 * Intoarce TRUE daca numarul s-a schimbat fata de ce afisa badge-ul:
 * adaptivePoll tine cont de asta (schimbare = revin la 60 s, liniste = 5 min).
 */
async function refreshBellBadge() {
  const b = document.getElementById('nav-bell-badge');
  if (!b) return false;
  const res = await api('/notifications/unread');
  if (!res.ok && res.status === 0) {
    bellRetryMs = bellRetryMs ? Math.min(bellRetryMs * 2, 15000) : 2500;
    setTimeout(refreshBellBadge, bellRetryMs);
    return false;
  }
  bellRetryMs = 0;
  const n = res.ok ? Number(res.data.count || 0) : 0;
  const prev = b.hidden ? 0 : (Number(b.textContent) || 0);
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = n === 0;
  return n !== prev;
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
  // String păstrat de minificator: marker de deploy (poll-ul fix a dispărut).
  btn.dataset.poll = 'auk-adaptive';
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

  // Badge proaspăt, dar NU pe ceas: adaptivePoll (vezi „POLLING ADAPTIV”)
  // sare peste tab-ul ascuns, dublează pasul cât timp numărul nu se schimbă
  // și se oprește de tot după 10 minute fără activitate. Primul apel e deja
  // făcut de call site (imediat după appendChild), deci aici pornim doar
  // programarea — fără o a doua cerere la load. La re-randarea nav-ului
  // oprim poll-ul vechi, altfel rămân timere care cer date pentru un DOM șters.
  bellPoll?.stop();
  bellPoll = adaptivePoll(refreshBellBadge, { base: POLL_BELL_MS, runNow: false });

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
// Același adaptivePoll ca la clopoțel (90 s → 5 min, oprit pe tab ascuns
// sau părăsit). Serverul ține contoarele D1 5 minute și „online” 60 s,
// deci nici cererile care totuși pleacă nu lovesc Durable Object-ul de fiecare dată.
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

/** Întoarce TRUE dacă s-a schimbat câți sunt online — adaptivePoll rămâne
 *  la pasul scurt când site-ul e viu și lărgește pasul când e liniște. */
async function fetchPulse() {
  const res = await api('/pulse');
  if (!res.ok || res.status === 0) return false;
  const prevOnline = pulseData ? (Number(pulseData.online) || 0) : -1;
  pushPulse(res.data);
  return (Number(res.data?.online) || 0) !== prevOnline;
}

/** Publică date de pulse venite pe altă cale decât /api/pulse — pagina
 *  principală le primește deja în /api/home, deci nu mai facem o cerere. */
export function pushPulse(data) {
  if (!data) return;
  pulseData = data;
  for (const fn of pulseWaiters.splice(0)) fn(pulseData);
  updatePulseChip(pulseData);
}

/** Anunță că pagina își aduce singură datele de pulse (vezi pushPulse):
 *  startPulse nu mai pornește cu o cerere imediată către /api/pulse. */
let pulseClaimed = false;
export function claimPulse() { pulseClaimed = true; }

function updatePulseChip(data) {
  const chip = document.getElementById('pulse-chip');
  if (!chip || !data) return;
  const n = Number(data.online) || 0;
  chip.hidden = false;
  const label = chip.querySelector('.pulse-chip__n');
  if (label) label.textContent = n > 0 ? `${n} online` : 'online';
  chip.classList.toggle('pulse-chip--live', n > 0);
}

// ---------------------------------------------------------------------
// CHAT LA CERERE („code splitting”) + FIX DISPLAY
// ---------------------------------------------------------------------
// chat.js cântărește ~14 KB minificat (socket, stikere, regulament, istoric)
// și era importat STATIC de fiecare pagină — deci fiecare vizitator îl
// descărca și-și deschidea socket-ul chiar dacă nu intra niciodată în chat.
// Deploy-ul rulează esbuild cu --splitting: modulul ajunge într-un singur
// chunk comun (nume cu hash de conținut → cache 1 an), cerut abia când e
// nevoie. Importul e dinamic și NU creează ciclu de module (core ← chat
// rămâne singura direcție de import static).
//
// FIX DISPLAY (2026-09-25): chat-ul trebuie să aibă display garantat pe
// ORICE pagină, chiar dacă initChat întârzie sau eșuează. Injectăm FAB-ul
// sincron la încărcarea modulului (dacă body există deja), iar initChat
// re-încearcă la eroare.
let chatMod;   // promisiunea de încărcare a modulului
let chatOn;    // promisiunea de pornire (initChat rulează o singură dată)

function ensureChatDomSync() {
  try {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById('chat-fab') && document.getElementById('chat-modal')) return;
    const frag = document.createRange().createContextualFragment(`
      <button class="chat-fab" id="chat-fab" type="button" aria-label="Deschide chat-ul live" style="display:flex">
        <span class="chat-fab__dot"></span>
        <span class="chat-fab__label">Chat live</span>
      </button>
      <div class="chat-modal" id="chat-modal" data-open="false" role="dialog" aria-modal="true" aria-label="Chat live" style="display:none">
        <div class="chat-box">
          <div class="chat-head">
            <span class="chat-head__title">Chat global</span>
            <span class="chat-head__count" id="chat-online-count">0 online</span>
            <span class="chat-badge" id="chat-badge"></span>
            <button class="chat-close" id="chat-close" type="button" aria-label="Închide chat-ul">✕</button>
          </div>
          <div class="chat-online" id="chat-online">Se conectează…</div>
          <div class="chat-body" id="chat-body"></div>
          <form class="chat-form" id="chat-form">
            <label class="sr-only" for="chat-input">Mesaj</label>
            <div class="sticker-wrap">
              <button class="chat-sticker-btn" id="chat-sticker-btn" type="button"
                title="Stikere" aria-label="Deschide stikerele">😄</button>
              <div class="sticker-pop" id="sticker-pop" hidden></div>
            </div>
            <input class="input" id="chat-input" type="text" maxlength="500" placeholder="Scrie un mesaj…" autocomplete="off">
            <button class="btn btn--accent" type="submit">Trimite</button>
          </form>
        </div>
      </div>`);
    document.body.appendChild(frag);
  } catch { /* DOM indisponibil — va încerca din nou la initChat */ }
}

// Încercăm injectarea imediată dacă body există deja (modulele ES sunt
// deferred, deci de obicei body există). Dacă nu, o facem la DOMContentLoaded.
try {
  if (typeof document !== 'undefined') {
    if (document.body) ensureChatDomSync();
    else document.addEventListener('DOMContentLoaded', ensureChatDomSync, { once: true });
  }
} catch { /* ignora */ }

function loadChat() {
  return (chatMod ||= import('./chat.js'));
}

/** Pornește chat-ul (fab, modal, socket) — o singură dată per pagină. */
export function initChat() {
  ensureChatDomSync();
  return (chatOn ||= loadChat()
    .then((m) => m.initChat())
    .catch((err) => { chatOn = undefined; throw err; }));   // reîncearcă la următorul apel
}

/** Deschide fereastra de chat, pornind-o dacă încă nu e pornită. */
export async function openChat() {
  ensureChatDomSync();
  try {
    await initChat();
    (await loadChat()).openChat();
  } catch {
    // Fallback: dacă modulul nu se încarcă, măcar afișăm modalul
    const modal = document.getElementById('chat-modal');
    if (modal) {
      modal.hidden = false;
      modal.removeAttribute('hidden');
      modal.dataset.open = 'true';
      modal.style.display = 'flex';
    }
  }
}

/** Chip-ul de pulse din nav. Click → deschide chat-ul (prin wrapper-ul de mai
 *  sus, ca chat.js să rămână încărcat la cerere). */
function buildPulseChip() {
  const chip = document.createElement('button');
  chip.id = 'pulse-chip';
  chip.type = 'button';
  chip.className = 'pulse-chip';
  chip.hidden = true;
  chip.dataset.poll = 'auk-adaptive';
  chip.title = 'Cine e online acum — deschide chat-ul';
  chip.innerHTML = '<span class="pulse-chip__dot" aria-hidden="true"></span>' +
    '<span class="pulse-chip__n">online</span>';
  chip.addEventListener('click', () => {
    openChat().catch(() => { /* chat opțional */ });
  });
  return chip;
}

let pulsePoll = null;
export function startPulse() {
  if (document.getElementById('pulse-chip')) return;
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.appendChild(buildPulseChip());
  // Pagina care și-a luat deja datele din /api/home nu mai plătește o cerere;
  // dacă totuși ele nu ajung, primul pas de 90 s le aduce. La re-randare
  // repornim poll-ul fără un fetch imediat — DOM-ul e nou, datele nu.
  const deja = !!pulsePoll;
  pulsePoll?.stop();
  pulsePoll = adaptivePoll(fetchPulse, {
    base: POLL_PULSE_MS,
    max: POLL_MAX_MS,
    runNow: !deja && !pulseClaimed,
  });
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

// Fundaluri animate cu particule (teme canvas): porneste singur pe orice
// pagina care importa core.js. Modulele ES sunt deferred, deci body exista.
// TEMA INSTANT LA INTRAREA PE PAGINA: fetch-ul de sesiune (getSession) ia
// sute de ms, timp in care pagina ar clipi in tema implicita. Aplicam
// sincron ultima tema cunoscuta din localStorage; getSession o confirma sau
// o corecteaza imediat ce soseste raspunsul (sursa adevarului = serverul).
try {
  const temaCache = localStorage.getItem('auk-theme');
  if (temaCache && /^theme_[a-z]+$/.test(temaCache) && temaCache !== 'theme_standard') {
    document.body.classList.add(`theme-${temaCache.slice(6)}`);
  }
} catch { /* mod privat / body indisponibil — asteptam sesiunea */ }

try { initAnimBg(); } catch { /* fara canvas — ramane gradientul static */ }

// ---------------------------------------------------------------------
// BUTONUL „INAPOI SUS": apare dupa ce ai coborat doua ecrane, pe orice
// pagina. Fara el, un catalog de 1000 de serii se rasfoieste urat pe
// telefon. Ascultatorul e passiv si lucreaza doar intr-un rAF, deci nu
// incurca scroll-ul; pe paginile scurte butonul nu se arata deloc.
// ---------------------------------------------------------------------
export function initToTop() {
  if (typeof document === 'undefined' || !document.body) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'to-top';
  btn.className = 'to-top';
  btn.hidden = true;
  btn.setAttribute('aria-label', 'Înapoi sus');
  btn.textContent = '↑';
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Focusul ramane pe un element care nu mai e vizibil dupa derulare: il
    // mutam pe inceputul paginii, ca navigarea cu tastatura sa nu se rupa.
    document.getElementById('nav')?.scrollIntoView?.({ block: 'start' });
  });
  document.body.appendChild(btn);

  let scheduled = false;
  const apply = () => {
    scheduled = false;
    const show = window.scrollY > 700;
    if (show === btn.hidden) btn.hidden = !show;
  };
  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  }, { passive: true });
  apply();
  return btn;
}

// Fiecare pagina care incarca core.js primeste butonul; paginile care nu au
// nevoie (autentificare, admin scurt) il vor tine ascuns singure.
try { initToTop(); } catch { /* fara scroll-to-top — pagina merge mai departe */ }

// ---------------------------------------------------------------------
// GARDA ANTI-CACHE: daca tab-ul ramane deschis peste un deploy, shell-ul
// vechi + API-ul nou inseamna butoane/teme care „nu merg" (codul vechi nu
// cunoaste temele noi). La revenirea in tab — cel mult o data pe minut —
// comparam ?v= din tag-urile paginii curente cu ?v= din HTML-ul proaspat
// de pe server; daca difera, anuntam si reincarcam automat. In dev (fara
// ?v=) si pe paginile fara assete versionate garda sta inactiva.
// ---------------------------------------------------------------------
let ultimaVerificareBuild = 0;
function vDinTaguri() {
  const el = document.querySelector('script[src*="?v="], link[href*="?v="]');
  const url = el?.getAttribute('src') || el?.getAttribute('href') || '';
  const m = url.match(/[?&]v=([A-Za-z0-9._-]+)/);
  return m ? m[1] : null;
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    const acum = Date.now();
    if (acum - ultimaVerificareBuild < 60000) return;
    ultimaVerificareBuild = acum;
    try {
      const vCurent = vDinTaguri();
      if (!vCurent) return;
      // Versiunea e aceeași pe toate paginile (deploy.sh pune ?v=<commit>
      // peste tot). Cerem „/”, servit de stratul static — 0 invocări. Pagina
      // curentă ar trece prin worker pe /serie, /episod, /profile, /shop
      // (o invocare + o citire D1) doar ca să citim un query string.
      const html = await (await fetch('/', { cache: 'no-store' })).text();
      const m = html.match(/[?&]v=([A-Za-z0-9._-]+)/);
      if (m && m[1] !== vCurent) {
        toast('A apărut o versiune nouă — reîncarc pagina…', 'info', 2500);
        setTimeout(() => location.reload(), 1200);
      }
    } catch { /* offline sau raspuns neasteptat — ignoram */ }
  });
}
