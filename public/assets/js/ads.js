// =====================================================================
// ads.js — randarea sloturilor de reclame configurate din admin.
//
// Cum funcționează:
//   1. Pagina are containere goale <div data-ad-slot="index|series|episode">.
//   2. initAds() cere /api/ads (public; staff-ul primește enabled:false
//      dacă hide_for_staff e pornit) și populează containerele.
//   3. Tipuri de slot:
//        iframe — bannerul rețelei într-un <iframe sandbox> (A-ADS și orice
//                 rețea care oferă embed „iframe only", fără <script>).
//        link   — banner-card intern care duce spre URL-ul rețelei
//                 (Adsterra „Direct Link" și similare).
//
// De ce NU injectăm <script>-urile rețelelor: CSP-ul sitului e strict
// (script-src 'self') — un script terț nici nu s-ar încărca. Iframe-ul e
// sandboxat ca reclama să nu poată naviga pagina sau deschide popupuri.
// Dacă /api/ads spune „oprit" sau pică, sloturile rămân goale (hidden) —
// zero schimbare vizuală față de site-ul fără reclame.
// =====================================================================
import { api } from './core.js';

export async function initAds() {
  const holders = [...document.querySelectorAll('[data-ad-slot]')];
  if (!holders.length) return;

  const res = await api('/ads');
  if (!res.ok || !res.data?.enabled) return;

  const bySlot = new Map((res.data.slots || []).map((s) => [s.name, s]));
  for (const holder of holders) {
    const slot = bySlot.get(holder.dataset.adSlot);
    if (!slot || !slot.url) continue;
    renderSlot(holder, slot);
  }
}

function renderSlot(holder, slot) {
  let url;
  try { url = new URL(slot.url); } catch { return; }
  if (url.protocol !== 'https:') return;

  holder.innerHTML = '';
  holder.hidden = false;
  holder.classList.add('ad-box');

  // Eticheta „Publicitate" — onestitate față de utilizatori și cerință
  // standard a rețelelor serioase.
  const tag = document.createElement('span');
  tag.className = 'ad-box__tag';
  tag.textContent = 'Publicitate';
  holder.appendChild(tag);

  if (slot.type === 'iframe') {
    const frame = document.createElement('iframe');
    frame.src = url.href;
    frame.width = String(slot.width || 728);
    frame.height = String(slot.height || 90);
    frame.title = slot.label || 'Reclamă';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer';
    // Sandbox: reclama nu poate naviga pagina-mamă și nu poate deschide
    // popupuri decât prin click explicit (allow-popups + escape-sandbox
    // e necesar ca linkul din banner să se deschidă normal în tab nou).
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.className = 'ad-box__frame';
    holder.appendChild(frame);
  } else {
    const a = document.createElement('a');
    a.href = url.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow sponsored';
    a.className = 'ad-box__link';
    const label = document.createElement('b');
    label.textContent = slot.label || 'Descoperă oferta partenerului nostru';
    const hint = document.createElement('span');
    hint.className = 'ad-box__hint';
    hint.textContent = 'Susții anime-uke cu un click — se deschide în tab nou.';
    a.append(label, hint);
    holder.appendChild(a);
  }
}
