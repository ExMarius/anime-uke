import { initAuthForm } from './auth.js';
import { api } from './core.js';

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

  const res = await api('/auth/register-options');
  // La eroare alegem varianta stricta: cerem codul. E mai sigur decat sa
  // lasam inregistrarile libere din cauza unui apel esuat.
  const required = res.ok ? !!res.data?.inviteRequired : true;

  if (field) {
    field.hidden = !required;
    if (input) input.required = required;
  }
  if (banner) banner.hidden = required;
}

await setupInviteGate();
initAuthForm('register');
