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

    return { ok: res.ok, status: res.status, data: data || {}, retryAfter };
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, status: 0, data: { error: 'Anulat' } };
    return { ok: false, status: 0, data: { error: 'Eroare de rețea' } };
  }
}

/** Sesiunea curenta, cache-uita per pagina (1 singur apel la /auth/me). */
export async function getSession(force = false) {
  if (sessionCache !== undefined && !force) return sessionCache;
  const res = await api('/auth/me');
  sessionCache = res.ok ? (res.data.user || null) : null;
  return sessionCache;
}

export function clearSession() {
  sessionCache = null;
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

  nav.innerHTML = `
    <a class="nav__brand" href="/">🎌 Anime<span>Sphere</span></a>
    <div class="nav__links" id="nav-links"></div>
  `;

  const links = document.getElementById('nav-links');
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
    points.textContent = `⭐ ${user.points} puncte`;
    links.appendChild(points);

    if (user.is_admin) add('/admin', 'Admin', { accent: true });

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn--ghost btn--sm';
    logoutBtn.type = 'button';
    logoutBtn.textContent = `Ieșire (${user.username})`;
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
