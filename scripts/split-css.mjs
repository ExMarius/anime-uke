// Împarte style.css în: nucleu (style.css) + foi per-grup de pagini.
// Mutăm în pagina-G.css doar regulile folosite de grupul G și de NIMIC
// altceva — toate celelalte pagini (inclusiv celelalte grupuri) rămân
// cu tot ce le trebuie în nucleu. Safe > perfect.
import { PurgeCSS } from 'purgecss';
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = ['core.js', 'chat.js', 'sources-ui.js'];
const PAGES = {
  index:   ['public/index.html', 'public/assets/js/page-index.js'],
  series:  ['public/series.html', 'public/assets/js/page-series.js'],
  episode: ['public/episode.html', 'public/assets/js/page-episode.js'],
  login:   ['public/login.html', 'public/assets/js/page-login.js'],
  register:['public/register.html', 'public/assets/js/page-register.js'],
  profile: ['public/profile.html', 'public/assets/js/page-profile.js'],
  shop:    ['public/shop.html', 'public/assets/js/page-shop.js'],
  admin:   ['public/admin.html', 'public/assets/js/page-admin.js'],
  admserii:['public/admin/serii.html', 'public/assets/js/page-admin-serii.js'],
  admserie:['public/admin/serie.html', 'public/assets/js/page-admin-serie.js'],
};
const withCore = (p) => [...PAGES[p], ...CORE.map(c => 'public/assets/js/' + c)];
const GROUPS = {
  'page-episode': ['episode'],
  'page-admin':   ['admin', 'admserii', 'admserie'],
  'page-user':    ['profile', 'shop'],
};
const SAFELIST = {
  standard: [/^rank-/, /^sticker-/, /^toast-/, /^sk-/, /^hban/, /^pill-/,
    /^mission/, /^is-/, /^has-/, /^rv$/, /^rv-/, /^ep-/, /^src-/, /^epis/,
    /^deep/, /^gen/, /^tops/, /^pulse/, /^streak/, /^range/, /^chat/,
    /^msg/, /^staff/, /^econ/, /^ct$/, /^cp$/],
};

async function usedFor(pages) {
  const content = [...new Set(pages.flatMap(p => withCore(p)))];
  const out = await new PurgeCSS().purge({ content, css: ['public/assets/css/style.css'], safelist: SAFELIST });
  return out[0].css;
}

function topRules(css) {
  const rules = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { rules.push(css.slice(start, i + 1)); start = i + 1; }
    }
  }
  if (start < css.length) rules.push(css.slice(start));
  return rules;
}

const ALL = Object.keys(PAGES);
const cssAll = readFileSync('public/assets/css/style.css', 'utf8');

for (const [file, pages] of Object.entries(GROUPS)) {
  const gUsed = await usedFor(pages);
  const others = ALL.filter(p => !pages.includes(p));
  const otherUsed = await usedFor(others);
  const only = [];
  for (const r of topRules(gUsed)) {
    const trimmed = r.trim();
    if (trimmed && !otherUsed.includes(trimmed)) only.push(r);
  }
  // nucleul: scoatem din cssAll regulile mutate (identice, string-exact)
  let core = cssAll;
  for (const r of only) {
    const idx = core.indexOf(r);
    if (idx >= 0) core = core.slice(0, idx) + core.slice(idx + r.length);
  }
  writeFileSync(`public/assets/css/${file}.css`, only.join('\n') + '\n');
  writeFileSync('public/assets/css/style.css', core);
  console.log(`${file}.css: ${only.length} reguli, ${only.join('').length} B`);
}
console.log('split gata');
