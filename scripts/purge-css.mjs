// Curăță CSS-ul de regulile care nu mai apar NICĂIERE în HTML/JS/worker.
// Rulat la deploy, ÎNAINTE de minificare; sursa din repo rămâne intactă.
//
// SAFELIST — clase construite dinamic (nu apar ca literale în surse):
//   rank-<nume>     rangurile vin din baza de date (rankChip)
//   sticker-<id>    stickere Tenor (profil)
//   toast-<tip>     tipuri de notificare
//   pill-pos--ok    variante compuse în JS
//   sk-*            skeletonuri; hban* bannerul hero; rv reveal-la-scroll
//   is-*/has-*      stări toggled cu classList
import { PurgeCSS } from 'purgecss';

const out = await new PurgeCSS().purge({
  content: [
    'public/*.html',
    'public/admin/*.html',
    'public/assets/js/**/*.js',
    'src/**/*.js',
  ],
  css: ['public/assets/css/style.css'],
  variables: false,
  safelist: {
    standard: [
      /^rank-/, /^sticker-/, /^toast-/, /^sk-/, /^hban/, /^pill-/,
      /^mission/, /^is-/, /^has-/, /^rv$/, /^rv-/, /^ep-/, /^src-/,
      /^epis/, /^deep/, /^gen/, /^tops/, /^pulse/, /^streak/, /^range/,
      /^chat/, /^msg/, /^staff/, /^econ/, /^ct/, /^cp/,
      /^nc-/,           // culorile numelui (aplicate dinamic, shop)
      /^theme-/,        // paletele temelor de site (shop)
    ],
  },
});

import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('/tmp/purged', { recursive: true });
for (const r of out) writeFileSync('/tmp/purged/' + r.file.split('/').pop(), r.css);
const before = out.reduce((a, r) => a + r.css.length, 0);
console.log('purge: rezultat în /tmp/purged,', out.length, 'fișiere');
