import { initAuthForm } from './auth.js';
import { api, renderNav } from './core.js';

// =====================================================================
// Pagina de inregistrare.
//
// Intreaba serverul daca e nevoie de cod de invitatie: in modul bootstrap
// (baza de date goala) campul e ascuns, iar primul cont devine admin.
// Fara aceasta verificare, primul administrator ar ramane blocat in fata
// unui camp obligatoriu pentru care nu exista niciun cod generat.
// =====================================================================

async function setupInviteGate() {
  const field = document.getElementById('invite-field');
  const banner = document.getElementById('bootstrap-banner');
  const input = document.getElementById('invite_code');
  const form = document.getElementById('auth-form');

  // Cod primit prin cerere (?code=... de pe pagina de login): îl punem
  // direct în câmp, ca userul să nu mai scrie manual.
  const prefill = new URLSearchParams(location.search).get('code');
  if (prefill && input) input.value = prefill.trim().toUpperCase();

  const res = await api('/auth/register-options');
  // La eroare alegem varianta stricta: cerem codul. E mai sigur decat sa
  // lasam inregistrarile libere din cauza unui apel esuat.
  const required = res.ok ? !!res.data?.inviteRequired : true;

  if (field) {
    field.hidden = !required;
    if (input) input.required = required;
  }
  if (banner) banner.hidden = required;

  // Plafon atins (buget 0): spunem din timp, nu doar la submit. Dezactivam
  // formularul ca userul sa nu completeze degeaba.
  if (res.ok && res.data?.capacityFull && form) {
    const note = document.createElement('div');
    note.className = 'banner';
    note.textContent = 'Înscrierile sunt închise momentan: comunitatea a atins limita de conturi. Revenim când se eliberează un loc.';
    form.parentNode.insertBefore(note, form);
    const btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Înscrieri închise'; }
  }
}

await setupInviteGate();
initAuthForm('register');

renderNav('/register').catch(() => { /* nav e decorativ aici */ });
