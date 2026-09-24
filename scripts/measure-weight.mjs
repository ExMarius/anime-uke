// =====================================================================
// measure-weight.mjs — cât cântărește de fapt fiecare pagină în producție.
//
// De ce există: „optimizăm viteza" fără cifre e ghicit. Local, fișierele din
// repo sunt SURSE (cu comentarii, neîmpachetate); ce ajunge la vizitator e
// rezultatul pipeline-ului din deploy.sh: purge CSS → minificare → bundle cu
// code splitting (esbuild). Scriptul rulează exact pașii aceia, într-o copie
// temporară (repo-ul rămâne neatins), și raportează octeți pe fiecare asset.
//
// Două cifre contează, și sunt diferite:
//   • CALE CRITICĂ (eager) = HTML + CSS + JS-ul de care are nevoie pagina ca
//     să randeze: bundle-ul paginii + chunk-urile pe care le importă STATIC.
//   • AMÂNAT (deferred) = chunk-urile cerute abia la nevoie (chat.js), care
//     nu blochează primul render.
// Un chat de 14 KB scos din calea critică nu se vede în „total", dar se vede
// în prima cifră — de aceea sunt raportate separat.
//
// Rezultatul se compară cu BUGETE. Bugetele nu sunt „orice trece azi": sunt
// limita pe care ne-am angajat să n-o depășim fără să discutăm (vezi README →
// „Viteză"). Depășirea iese cu cod 1, deci test.sh o prinde.
//
// Rulare:  node scripts/measure-weight.mjs [--json] [--top=10]
// =====================================================================

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const ESB = join(ROOT, 'node_modules/.bin/esbuild');
const JSON_OUT = process.argv.includes('--json');
const TOP = Number((process.argv.find((a) => a.startsWith('--top=')) || '').split('=')[1]) || 8;

// ---------------------------------------------------------------------
// BUGETE (octeți). Comparăm pe coloana gzip, fiindcă Cloudflare comprimă
// automat textul. Marja e ~25% peste valoarea măsurată la 2026-09-24, ca
// bugetul să prindă o REGRESIE (ex: chat.js re-importat static), nu orice
// atingere de fișier.
// ---------------------------------------------------------------------
const BUGETE = {
  jsEager: 19.5 * 1024,    // gzip: bundle pagină + chunk-uri statice (calea critică)
  jsDeferred: 8 * 1024,    // gzip: chunk-urile cerute la nevoie (chat.js)
  css: 22 * 1024,          // gzip: per foaie de stil
  html: 15 * 1024,         // gzip: HTML-ul (conține SVG-uri inline)
  caleCritica: 45 * 1024,  // gzip: HTML + CSS + JS eager (o pagină întreagă)
  artaHero: 70 * 1024,     // octeți PE DISC: imaginea hero inline din prima pagină (AVIF)
  artaHeroFallback: 110 * 1024, // octeți PE DISC: aceeași imagine în WebP (rezerva)
  imagineBundled: 130 * 1024, // octeți PE DISC: orice altă imagine din /assets/img
};

const kb = (n) => (n / 1024).toFixed(1);
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const br = (buf) => brotliCompressSync(buf).length;

// ---------------------------------------------------------------------
// 0. Copie de lucru: public/ + src/ (purge-ul citește și sursele JS ca să
//    știe ce clase sunt folosite).
// ---------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'auk-weight-'));
cpSync(join(ROOT, 'public'), join(work, 'public'), { recursive: true });
cpSync(join(ROOT, 'src'), join(work, 'src'), { recursive: true });

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });

// ---------------------------------------------------------------------
// 1. Purge CSS (exact ca în deploy.sh) — sare dacă pachetul lipsește.
// ---------------------------------------------------------------------
const JS_DIR = join(work, 'public/assets/js');
let purged = false;
try {
  run(process.execPath, [join(ROOT, 'scripts/purge-css.mjs')]);
  cpSync('/tmp/purged/style.css', join(work, 'public/assets/css/style.css'));
  purged = true;
} catch { /* fără purgecss (npm ci incomplet): măsurăm neminificat */ }

// ---------------------------------------------------------------------
// 2. Minificare + bundle cu splitting (exact ca în deploy.sh, aceeași ordine:
//    întâi restul fișierelor, apoi bundle-urile de pagină).
// ---------------------------------------------------------------------
let minificate = 0;
for (const dir of ['public/assets/css', 'public/assets/js']) {
  for (const f of readdirSync(join(work, dir))) {
    if (!f.endsWith('.css') && !(f.endsWith('.js') && !f.startsWith('page-') && !f.startsWith('c-'))) continue;
    const p = join(work, dir, f);
    try {
      const out = execFileSync(ESB, ['--minify', p], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
      execFileSync('sh', ['-c', `cat > ${JSON.stringify(p)}`], { input: out });
      minificate++;
    } catch { /* rămâne sursa */ }
  }
}

const entries = readdirSync(JS_DIR).filter((f) => f.startsWith('page-') && f.endsWith('.js'));
const outJs = mkdtempSync(join(tmpdir(), 'auk-out-'));
let bundlate = 0;
try {
  // Ca în deploy.sh: scriem într-un director separat (esbuild refuză să
  // suprascrie fișierele de intrare) și abia apoi copiem peste.
  run(ESB, [...entries.map((f) => join(JS_DIR, f)), '--bundle', '--minify', '--format=esm', '--splitting',
    '--target=es2022', '--legal-comments=none', '--outdir=' + outJs,
    '--entry-names=[name]', '--chunk-names=c-[hash]']);
  for (const f of readdirSync(outJs)) cpSync(join(outJs, f), join(JS_DIR, f));
  bundlate = entries.length;
} catch { /* lăsăm neminificat (fallback-ul din deploy.sh) */ }
rmSync(outJs, { recursive: true, force: true });

// ---------------------------------------------------------------------
// 3. Graful de chunk-uri: ce se cere pe calea critică și ce se amână.
//    esbuild scrie importurile RELATIVE (./c-<hash>.js), deci le citim din
//    textul bundle-ului: `from"./c-x.js"` = static, `import("./c-x.js")` =
//    dinamic (cerut la nevoie).
// ---------------------------------------------------------------------
const refStatic = /from\s*"\.\/(c-[\w-]+\.js)"/g;
const refDinamic = /import\(\s*"\.\/(c-[\w-]+\.js)"\s*\)/g;

function graful(entryRel) {
  const eager = new Set();
  const deferred = new Set();
  const vizitat = new Set();
  const coada = [entryRel];
  const citeste = (f) => readFileSync(join(JS_DIR, f), 'utf8');
  while (coada.length) {
    const f = coada.pop();
    if (vizitat.has(f)) continue;
    vizitat.add(f);
    let src = '';
    try { src = citeste(f); } catch { continue; }
    for (const m of src.matchAll(refDinamic)) if (m[1] !== entryRel) deferred.add(m[1]);
    for (const m of src.matchAll(refStatic)) {
      if (m[1] === entryRel || eager.has(m[1]) || vizitat.has(m[1])) continue;
      eager.add(m[1]);
      coada.push(m[1]);   // și chunk-urile pot importa alte chunk-uri
    }
  }
  for (const f of eager) deferred.delete(f);
  return { eager: [...eager], deferred: [...deferred] };
}

// ---------------------------------------------------------------------
// 4. Ce descarcă fiecare pagină.
// ---------------------------------------------------------------------
const assets = new Map();   // cale absolută -> { raw, gzip, br }
const size = (p) => {
  if (!existsSync(p)) return null;
  if (!assets.has(p)) {
    const buf = readFileSync(p);
    assets.set(p, { raw: buf.length, gzip: gz(buf), br: br(buf) });
  }
  return assets.get(p);
};
const suma = (l) => l.reduce((acc, u) => {
  const s = size(join(work, 'public', u.replace(/^\//, '').split('?')[0]));   // href = /assets/...
  return { raw: acc.raw + (s?.raw || 0), gzip: acc.gzip + (s?.gzip || 0), br: acc.br + (s?.br || 0) };
}, { raw: 0, gzip: 0, br: 0 });

const pagini = readdirSync(join(work, 'public')).filter((f) => f.endsWith('.html')).map((f) => join('public', f))
  .concat(readdirSync(join(work, 'public/admin')).filter((f) => f.endsWith('.html')).map((f) => join('public/admin', f)));

const rezultate = [];
for (const rel of pagini) {
  const html = readFileSync(join(work, rel), 'utf8');
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  const js = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const htmlSize = size(join(work, rel));
  const rezCss = suma(css);

  // JS: fiecare referință din HTML e un bundle de pagină → graful lui.
  const eager = [];
  const deferred = [];
  for (const u of js) {
    const f = u.replace(/^\//, '').split('?')[0].replace('assets/js/', '');
    if (entries.includes(f)) {
      const g = graful(f);
      eager.push(`assets/js/${f}`, ...g.eager.map((x) => `assets/js/${x}`));
      deferred.push(...g.deferred.map((x) => `assets/js/${x}`));
    } else eager.push(u.replace(/^\//, '').split('?')[0]);
  }
  const rezJs = suma(eager.map((f) => `/${f}`));
  const rezDef = suma(deferred.map((f) => `/${f}`));

  rezultate.push({
    pagina: rel.replace('public/', '').replace('.html', '') || 'index',
    html: htmlSize, css: rezCss, js: rezJs, amanat: rezDef,
    total: {
      raw: htmlSize.raw + rezCss.raw + rezJs.raw,
      gzip: htmlSize.gzip + rezCss.gzip + rezJs.gzip,
      br: htmlSize.br + rezCss.br + rezJs.br,
    },
    fisiere: { css, js: eager, amanat: deferred },
  });
}

// ---------------------------------------------------------------------
// 5. Imagini: arta hero e INLINE în prima pagină (intră în LCP), deci are
//    buget propriu; restul imaginilor bundled trebuie să rămână mici.
// ---------------------------------------------------------------------
const imagini = [];
for (const f of readdirSync(join(work, 'public/assets/img'))) {
  const s = size(join(work, 'public/assets/img', f));
  if (s) imagini.push({ f: `assets/img/${f}`, ...s });
}
imagini.sort((a, b) => b.raw - a.raw);
const indexHtml = readFileSync(join(work, 'public/index.html'), 'utf8');
// Din <picture> luăm primul <source> (AVIF — ce descarcă browserele actuale) și
// <img> (rezerva). Ambele, fiindcă suma greșită se vede imediat în buget.
const surseHero = [...indexHtml.matchAll(/<source[^>]+srcset="([^"]+)"/g)].map((m) => m[1]);
const artaHero = surseHero.filter((u) => u.endsWith('.avif'))
  .map((u) => size(join(work, 'public', u.replace(/^\//, '')))).reduce((a, s) => a + (s?.raw || 0), 0);
const artaHeroFallback = surseHero.filter((u) => u.endsWith('.webp'))
  .map((u) => size(join(work, 'public', u.replace(/^\//, '')))).reduce((a, s) => a + (s?.raw || 0), 0);

// ---------------------------------------------------------------------
// 6. Raport
// ---------------------------------------------------------------------
if (JSON_OUT) {
  const lista = [...assets.entries()].map(([p, s]) => ({ f: p.replace(work + '/', ''), ...s }))
    .sort((a, b) => b.gzip - a.gzip);
  console.log(JSON.stringify({ purged, bundlate, minificate, artaHero, artaHeroFallback, imagini, assets: lista, pagini: rezultate }, null, 1));
} else {
  console.log(`=== GREUTATE (pipeline de deploy: purge=${purged ? 'da' : 'nu'} · bundle=${bundlate} pagini · minificate=${minificate} fișiere) ===`);
  console.log(`\n${'pagina'.padEnd(14)} ${'html'.padStart(9)} ${'css'.padStart(9)} ${'JS critic'.padStart(10)} ${'amânat'.padStart(9)} ${'TOTAL'.padStart(9)}`);
  for (const r of [...rezultate].sort((a, b) => b.total.gzip - a.total.gzip)) {
    console.log(`${r.pagina.padEnd(14)} ${(kb(r.html.gzip) + ' KB').padStart(9)} ${(kb(r.css.gzip) + ' KB').padStart(9)} ${(kb(r.js.gzip) + ' KB').padStart(10)} ${(kb(r.amanat.gzip) + ' KB').padStart(9)} ${(kb(r.total.gzip) + ' KB').padStart(9)}`);
  }
  const top = [...assets.entries()].map(([p, s]) => ({ f: p.replace(work + '/', ''), ...s }))
    .sort((a, b) => b.gzip - a.gzip).slice(0, TOP);
  console.log(`\nCele mai grele ${TOP} fișiere text (gzip):`);
  for (const t of top) console.log(`  ${(kb(t.gzip) + ' KB').padStart(9)}  ${t.f}  (br ${kb(t.br)} KB)`);

  console.log(`\nImagini bundlate (pe disc, top ${Math.min(5, imagini.length)}):`);
  for (const i of imagini.slice(0, 5)) console.log(`  ${(kb(i.raw) + ' KB').padStart(9)}  ${i.f}`);
  console.log(`  arta hero inline în prima pagină: ${kb(artaHero)} KB (AVIF) · rezerva WebP: ${kb(artaHeroFallback)} KB`);
}

// Cu --out=DIR păstrăm artefactele construite (public/ „ca la deploy"), ca să
// poată fi rulate de teste: dom-smoke AUK_JS_DIR=DIR/public/assets/js.
const OUT_DIR = (process.argv.find((a) => a.startsWith('--out=')) || '').split('=')[1];
if (OUT_DIR) {
  rmSync(OUT_DIR, { recursive: true, force: true });
  cpSync(join(work, 'public'), join(OUT_DIR, 'public'), { recursive: true });
  if (!JSON_OUT) console.log(`\nArtefacte păstrate în ${OUT_DIR} (rulează: AUK_JS_DIR=${OUT_DIR}/public/assets/js node tests/dom-smoke.mjs)`);
}


// ---------------------------------------------------------------------
// 7. Bugete
// ---------------------------------------------------------------------
const depasiri = [];
const worst = (get) => [...rezultate].sort((a, b) => get(b) - get(a))[0];
const grea = worst((r) => r.total.gzip);
const greuJs = worst((r) => r.js.gzip);
if (grea.total.gzip > BUGETE.caleCritica) {
  depasiri.push(`pagina „${grea.pagina}” are ${kb(grea.total.gzip)} KB gzip pe calea critică (buget ${kb(BUGETE.caleCritica)})`);
}
for (const r of rezultate) {
  if (r.html.gzip > BUGETE.html) depasiri.push(`${r.pagina}: HTML ${kb(r.html.gzip)} KB (buget ${kb(BUGETE.html)})`);
  if (r.css.gzip > BUGETE.css) depasiri.push(`${r.pagina}: CSS ${kb(r.css.gzip)} KB (buget ${kb(BUGETE.css)})`);
  if (r.js.gzip > BUGETE.jsEager) depasiri.push(`${r.pagina}: JS pe calea critică ${kb(r.js.gzip)} KB (buget ${kb(BUGETE.jsEager)})`);
  if (r.amanat.gzip > BUGETE.jsDeferred) depasiri.push(`${r.pagina}: JS amânat ${kb(r.amanat.gzip)} KB (buget ${kb(BUGETE.jsDeferred)})`);
}
if (artaHero > BUGETE.artaHero) {
  depasiri.push(`arta hero (AVIF) are ${kb(artaHero)} KB (buget ${kb(BUGETE.artaHero)}); e inline, deci se descarcă mereu`);
}
if (artaHeroFallback > BUGETE.artaHeroFallback) {
  depasiri.push(`rezerva WebP a artei hero are ${kb(artaHeroFallback)} KB (buget ${kb(BUGETE.artaHeroFallback)})`);
}
for (const i of imagini) {
  // Doar imaginile „grele" (nu icoanele) contează pentru buget.
  if (i.raw > BUGETE.imagineBundled) depasiri.push(`${i.f}: ${kb(i.raw)} KB (buget ${kb(BUGETE.imagineBundled)} pe imagine)`);
}

if (!JSON_OUT) {
  console.log(`\nBugete (gzip): cale critică ≤ ${kb(BUGETE.caleCritica)} KB · JS critic ≤ ${kb(BUGETE.jsEager)} KB · JS amânat ≤ ${kb(BUGETE.jsDeferred)} KB`);
  console.log(`         CSS ≤ ${kb(BUGETE.css)} KB · HTML ≤ ${kb(BUGETE.html)} KB · arta hero AVIF ≤ ${kb(BUGETE.artaHero)} KB (WebP ≤ ${kb(BUGETE.artaHeroFallback)}) · imagine ≤ ${kb(BUGETE.imagineBundled)} KB (pe disc)`);
  console.log(`Cel mai greu: pagina „${grea.pagina}” ${kb(grea.total.gzip)} KB gzip · JS critic „${greuJs.pagina}” ${kb(greuJs.js.gzip)} KB gzip`);
  if (depasiri.length) {
    console.log(`\n✗ PESTE BUGET (${depasiri.length}):`);
    for (const d of depasiri) console.log(`   - ${d}`);
  } else {
    console.log('✓ toate paginile sunt în buget');
  }
}
rmSync(work, { recursive: true, force: true });
process.exit(depasiri.length ? 1 : 0);
