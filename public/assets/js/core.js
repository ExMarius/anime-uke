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
      sessionCache = null;
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
export async function getSession(force = false) {
  if (sessionCache !== undefined && !force) return sessionCache;
  if (!force) {
    try {
      const raw = sessionStorage.getItem('auk-me');
      if (raw) {
        const c = JSON.parse(raw);
        if (c && typeof c.t === 'number' && Date.now() - c.t < ME_TTL_MS) {
          sessionCache = c.user ?? null;
          return sessionCache;
        }
      }
    } catch { /* mod privat */ }
  }
  const res = await api('/auth/me');
  sessionCache = res.ok ? (res.data.user || null) : null;
  try { sessionStorage.setItem('auk-me', JSON.stringify({ t: Date.now(), user: sessionCache })); } catch { /* ignora */ }
  return sessionCache;
}

export function clearSession() {
  sessionCache = null;
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
  const mark = document.createElement('span');
  mark.className = 'nav__brand__mark';
  mark.textContent = '鬼';
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
    points.title = `${user.points} puncte`;
    links.appendChild(points);

    // Economie: nivelul si gold-ul vin deja in sesiune — chipuri gratuite.
    const lvl = document.createElement('span');
    lvl.className = 'nav__points nav__points--lvl';
    lvl.textContent = `⚔️ Nv ${user.level || 1}`;
    lvl.title = `Nivel ${user.level || 1}`;
    links.appendChild(lvl);

    const gold = document.createElement('span');
    gold.className = 'nav__points nav__points--gold';
    gold.textContent = `🪙 ${(user.gold || 0).toLocaleString('ro-RO')}`;
    gold.title = `${user.gold || 0} Gold`;
    links.appendChild(gold);

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

  return user;
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

/**
 * Poster procedural, determinist din titlu: nuanta + initiale.
 *
 * De ce exista: la un catalog mare (1000+ serii de test) majoritatea nu au
 * copertă. Un fallback identic pe fiecare card ar arata ca un sablon
 * stricat; o nuanta derivata din titlu face catalogul variat si citibil,
 * fara sa coste vreo imagine si fara vreo cerere in plus.
 */
/** Badge de staff (Admin/Moderator) — ierarhia de moderare, vizibila. */
export function staffBadge(staff) {
  if (!staff) return null;
  const s = document.createElement('span');
  s.className = 'ubadge ubadge--' + (staff === 'Admin' ? 'admin' : staff === 'Moderator' ? 'mod' : 'staff');
  s.textContent = staff === 'Admin' ? '🛡️ Admin' : staff === 'Moderator' ? '🛠️ Moderator' : staff;
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
