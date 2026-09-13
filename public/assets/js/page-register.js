import { initAuthForm } from './auth.js';
import { api, renderNav } from './core.js';

// =====================================================================
// Pagina de inregistrare.
//
// Intreaba serverul starea portii: in modul bootstrap (baza de date goala)
// pagina anunta ca primul cont devine admin, iar cand comunitatea atinge
// plafonul dezactiveaza formularul cu un mesaj clar.
// =====================================================================

async function setupRegisterGate() {
  const banner = document.getElementById('bootstrap-banner');
  const form = document.getElementById('auth-form');

  const res = await api('/auth/register-options');
  // Bannerul „ești primul utilizator" apare doar in modul bootstrap.
  if (banner) banner.hidden = !res.ok || !res.data?.bootstrap;

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

await setupRegisterGate();
initAuthForm('register');

renderNav('/register').catch(() => { /* nav e decorativ aici */ });
