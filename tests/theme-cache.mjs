// =====================================================================
// theme-cache.mjs — tema instant, fara flash la intrarea pe pagina.
//
// Core.js aplica la import ultima tema cunoscuta din localStorage
// ('auk-theme'), sincron, inainte de fetch-ul de sesiune (care ia sute de
// ms). Sursa adevarului ramane serverul: applySiteTheme rescrie cache-ul la
// fiecare sesiune/activare. Nu are nevoie de server — jsdom + import direct.
// Rulat din test.sh, dupa dom-smoke.
// =====================================================================
import { JSDOM } from 'jsdom';

let trecute = 0;
const picat = [];
function check(label, ok, detail = '') {
  if (ok) { trecute++; console.log(`  ✅ ${label}`); }
  else { picat.push(`${label} — ${detail}`); console.log(`  ❌ ${label} :: ${detail}`); }
}

/** DOM proaspat + globale de browser + (optional) tema in cache. */
function instaleaza(seedTema) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://test.local/' });
  const { window } = dom;
  if (seedTema !== undefined) window.localStorage.setItem('auk-theme', seedTema);
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  // Canvas blocat (ca la extensiile anti-fingerprint): getContext → null.
  // Daca tema din cache e animata, motorul trebuie sa degradeze elegant.
  window.HTMLCanvasElement.prototype.getContext = () => null;
}

function claseTema() {
  return [...document.body.classList].filter((c) => c.startsWith('theme-') && c !== 'theme-rank');
}

// 1. Tema statica in cache → la import apare sincron pe body, fara fetch.
instaleaza('theme_storm');
const core = await import('../public/assets/js/core.js');
check('Tema din cache se aplica la import (sincron)', claseTema().join() === 'theme-storm', claseTema().join());

// 2. applySiteTheme schimba clasa SI rescrie cache-ul.
core.applySiteTheme('theme_royal');
check('applySiteTheme schimba clasa + rescrie cache-ul',
  claseTema().join() === 'theme-royal' && globalThis.localStorage.getItem('auk-theme') === 'theme_royal',
  `${claseTema().join()} / ${globalThis.localStorage.getItem('auk-theme')}`);

// 3. null/standard curata clasa + cache-ul (logout / tema implicita).
core.applySiteTheme(null);
check('applySiteTheme(null) curata tot', claseTema().length === 0 && globalThis.localStorage.getItem('auk-theme') === null);
core.applySiteTheme('theme_royal');
core.applySiteTheme('theme_standard');
check('applySiteTheme(standard) curata tot', claseTema().length === 0 && globalThis.localStorage.getItem('auk-theme') === null);

// 4. Valori invalide respinse (XSS prin cache / apeluri gresite).
core.applySiteTheme('theme_Evil!!');
core.applySiteTheme('javascript:alert(1)');
check('applySiteTheme respinge valori invalide', claseTema().length === 0 && globalThis.localStorage.getItem('auk-theme') === null);

// 5. Cache otravit + import proaspat → nicio clasa (validarea de la import).
instaleaza('theme_Evil!!"><img src=x>');
await import('../public/assets/js/core.js?otravit=1');
check('Cache otravit: nicio clasa aplicata la import', claseTema().length === 0, claseTema().join());

// 6. Tema ANIMATA in cache + canvas blocat → clasa pusa, fara crash.
instaleaza('theme_petale');
await import('../public/assets/js/core.js?anim=1');
check('Tema animata + canvas blocat: clasa pusa, fara crash', claseTema().join() === 'theme-petale', claseTema().join());

console.log('\n========================================================');
console.log(`REZULTAT: ${trecute} trecute, ${picat.length} esuate`);
if (picat.length) {
  console.log('\nEsuate:');
  for (const p of picat) console.log(`  • ${p}`);
}
console.log('========================================================');
process.exit(picat.length ? 1 : 0);
