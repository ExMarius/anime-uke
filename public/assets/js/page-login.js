import { api, renderNav } from './core.js';
import { initAuthForm } from './auth.js';

initAuthForm('login');

// ---------------------------------------------------------------------
// Cerere de cod de invitație + verificare cu bilet.
// Totul se face cu elemente DOM + textContent: mesajele serverului nu
// ajung niciodată ca HTML în pagină.
// ---------------------------------------------------------------------
function paintResult(box, kind, build) {
  box.hidden = false;
  box.className = `req-result req-result--${kind}`;
  box.innerHTML = '';
  build(box);
}

function linkToRegister(code, parent) {
  const a = document.createElement('a');
  a.href = `/register?code=${encodeURIComponent(code)}`;
  a.className = 'btn btn--accent btn--sm';
  a.textContent = 'Folosește codul acum';
  parent.appendChild(a);
}

function setupInviteRequest() {
  const form = document.getElementById('req-form');
  const result = document.getElementById('req-result');
  const statusForm = document.getElementById('req-status-form');
  const statusResult = document.getElementById('req-status-result');
  if (!form || !result || !statusForm || !statusResult) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const email = document.getElementById('req-email')?.value.trim();
    const message = document.getElementById('req-message')?.value.trim();
    if (!email || !message) return;

    btn.disabled = true;
    const res = await api('/invite-requests', { method: 'POST', body: { email, message } });
    btn.disabled = false;

    if (!res.ok) {
      paintResult(result, 'err', (b) => { b.textContent = res.data?.error || 'Nu am putut trimite cererea.'; });
      return;
    }

    form.reset();
    paintResult(result, 'ok', (b) => {
      const p1 = document.createElement('p');
      p1.textContent = 'Cererea a plecat spre admin! 🎉';
      const p2 = document.createElement('p');
      p2.append('Biletul tău: ');
      const code = document.createElement('b');
      code.textContent = res.data.request_code;
      p2.appendChild(code);
      const p3 = document.createElement('p');
      p3.textContent = 'Păstrează biletul — cu el vezi aici răspunsul și codul de invitație când cererea e aprobată.';
      b.append(p1, p2, p3);
    });
  });

  statusForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('req-status-code');
    const code = String(input?.value || '').trim().toUpperCase();
    if (!code) return;

    const res = await api(`/invite-requests?code=${encodeURIComponent(code)}`);
    if (res.status === 404) {
      paintResult(statusResult, 'err', (b) => { b.textContent = 'Nu există nicio cerere cu acest bilet.'; });
      return;
    }
    if (!res.ok) {
      paintResult(statusResult, 'err', (b) => { b.textContent = res.data?.error || 'Nu am putut verifica cererea.'; });
      return;
    }

    if (res.data.status === 'approved' && res.data.invite_code) {
      paintResult(statusResult, 'ok', (b) => {
        const p = document.createElement('p');
        p.append('Cererea a fost aprobată! 🎉 Codul tău de invitație: ');
        const c = document.createElement('b');
        c.textContent = res.data.invite_code;
        p.appendChild(c);
        b.appendChild(p);
        b.appendChild(linkToRegister(res.data.invite_code, document.createElement('div')));
      });
    } else if (res.data.status === 'rejected') {
      paintResult(statusResult, 'err', (b) => {
        b.textContent = 'Cererea a fost respinsă deocamdată. Poți încerca mai târziu cu un alt email.';
      });
    } else {
      paintResult(statusResult, 'ok', (b) => {
        b.textContent = 'Cererea e în așteptare. Adminul o va vedea curând — mulțumim pentru răbdare!';
      });
    }
  });
}

setupInviteRequest();

renderNav('/login').catch(() => { /* nav e decorativ aici */ });
