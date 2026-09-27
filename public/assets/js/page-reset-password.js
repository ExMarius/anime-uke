import { api, renderNav, toast, withBusy } from './core.js';

// Recuperarea are două etape deliberate: site-ul nu confirmă dacă un cont
// există, iar codul de la administrator nu ajunge niciodată în URL (care ar
// putea fi salvat în istoric, analytics sau Referer către o pagină externă).

function setResult(id, text, kind = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('hint--ok', kind === 'ok');
  el.classList.toggle('hint--err', kind === 'err');
}

const requestedId = Number(new URLSearchParams(location.search).get('request'));
if (Number.isInteger(requestedId) && requestedId > 0) {
  const input = document.getElementById('reset-request-id');
  if (input) input.value = String(requestedId);
}

document.getElementById('reset-request-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const identifier = String(document.getElementById('reset-identifier')?.value || '').trim();
  const button = document.getElementById('reset-request-submit');
  if (!identifier) {
    toast('Completează emailul sau username-ul.', 'warn');
    return;
  }

  await withBusy(button, async () => {
    const res = await api('/auth/password-reset', { method: 'POST', body: { identifier } });
    if (!res.ok) {
      const message = res.data?.error || 'Nu am putut înregistra solicitarea.';
      setResult('reset-request-result', message, 'err');
      toast(message, 'err');
      return;
    }
    setResult('reset-request-result', res.data?.message || 'Solicitarea a fost înregistrată.', 'ok');
    form.reset();
    document.getElementById('reset-request-id')?.focus();
  });
});

document.getElementById('reset-confirm-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const requestId = Number(document.getElementById('reset-request-id')?.value);
  const code = String(document.getElementById('reset-code')?.value || '').trim();
  const password = String(document.getElementById('reset-password')?.value || '');
  const confirmPassword = String(document.getElementById('reset-password-confirm')?.value || '');
  const button = document.getElementById('reset-confirm-submit');

  if (!Number.isInteger(requestId) || requestId <= 0 || !code) {
    toast('Completează numărul solicitării și codul primit.', 'warn');
    return;
  }
  if (password.length < 4) {
    toast('Parola nouă trebuie să aibă minimum 4 caractere.', 'warn');
    return;
  }
  if (password !== confirmPassword) {
    toast('Parola nouă nu se potrivește cu repetarea ei.', 'warn');
    return;
  }

  await withBusy(button, async () => {
    const res = await api('/auth/password-reset/confirm', {
      method: 'POST',
      body: { request_id: requestId, recovery_code: code, new_password: password },
    });
    if (!res.ok) {
      const message = res.data?.error || 'Nu am putut reseta parola.';
      setResult('reset-confirm-result', message, 'err');
      toast(message, 'err');
      return;
    }
    setResult('reset-confirm-result', res.data?.message || 'Parola a fost resetată.', 'ok');
    form.reset();
    toast('Parolă resetată. Te redirecționăm la login…', 'ok');
    setTimeout(() => { location.href = '/login'; }, 1100);
  });
});

renderNav('/reset-password').catch(() => { /* nav-ul nu blochează recuperarea */ });
