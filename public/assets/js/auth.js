import { api, toast, clearSession, withBusy, getSession } from './core.js';

// =====================================================================
// auth.js — logica comuna pentru login si register.
//
// Spre deosebire de v1: nu mai salvam nimic in localStorage. Sesiunea e
// 100% in cookie HttpOnly, iar navbar-ul intreaba serverul (/api/auth/me).
// In v1 tokenul primit la login era pur si simplu aruncat, iar getToken()
// incerca sa citeasca un cookie HttpOnly din JS — ceea ce e imposibil —
// deci utilizatorul logat aparea tot ca vizitator.
// =====================================================================

/**
 * Redirectioneaza doar catre o cale interna. Fara asta, `?next=` devine
 * un open redirect (ex. /login?next=https://phishing.tld).
 */
function safeNext() {
  const next = new URLSearchParams(location.search).get('next');
  if (!next) return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

async function redirectIfLoggedIn() {
  const user = await getSession();
  if (user) location.replace(safeNext());
}

export function initAuthForm(mode) {
  const form = document.getElementById('auth-form');
  const btn = document.getElementById('submit-btn');
  if (!form) return;

  // Daca e deja logat, nu are rost sa vada formularul
  redirectIfLoggedIn();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form).entries());

    if (mode === 'login') {
      if (!data.identifier || !data.password) {
        toast('Completează email-ul și parola', 'warn');
        return;
      }
    } else {
      if (!data.username || !data.email || !data.password) {
        toast('Completează toate câmpurile', 'warn');
        return;
      }
      if (String(data.password).length < 4) {
        toast('Parola trebuie să aibă minim 4 caractere', 'warn');
        return;
      }
    }

    await withBusy(btn, async () => {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login'
        ? { email: data.identifier, password: data.password }
        : { username: data.username, email: data.email, password: data.password };

      const res = await api(path, { method: 'POST', body });

      if (res.status === 429) {
        const sec = res.retryAfter || 60;
        toast(res.data?.error || `Prea multe încercări. Mai încearcă în ${sec}s.`, 'err', 6000);
        return;
      }

      if (!res.ok) {
        toast(res.data?.error || (mode === 'login' ? 'Email sau parolă incorecte' : 'Nu am putut crea contul'), 'err', 5000);
        return;
      }

      clearSession();
      toast(mode === 'login' ? `Bine ai revenit, ${res.data.user.username}!` : 'Cont creat cu succes!', 'ok');

      // Scurta intarziere ca toast-ul sa fie vazut inainte de navigare
      setTimeout(() => { location.href = safeNext(); }, 450);
    });
  });
}
