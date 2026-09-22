// =====================================================================
// pixel-teme.mjs — dovada ca temele animate chiar DESENEAZA pixeli.
//
// Randeaza motorul REAL (public/assets/js/anim-bg.js) pe canvas REAL
// (@napi-rs/canvas), intr-o pagina jsdom cu clasa temei pe body: 60 de
// cadre manuale, apoi numara pixelii cu alfa > 10 din ultimul cadru.
// Praguri pe tip: stelele sunt puncte de 2-4px (maxim teoretic ~1160px,
// deci prag 800), restul (petale/bule/fulgi) trebuie sa acopere >= 5000px.
// La fiecare rulare salveaza si PNG-uri de control in /tmp/pixel-*.png
// (stratul de particule peste fundalul temei din CSS).
// Nu are nevoie de server; rulat din test.sh dupa theme-flow.
// Capcane prinse aici: import PROASPAT per tema (?r=slug) — modulul tine
// canvas-ul intr-o variabila de modul, iar reutilizarea importului leaga
// temele urmatoare de documentul mort al primei rulari (0px fantoma).
// =====================================================================
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLUGS = ['sunset', 'halloween', 'iarna', 'paste', 'petale', 'portocaliu', 'aurora', 'ocean'];
const TIP = { aurora: 'stele' }; // restul: petale/bule/fulgi
const PRAG = { stele: 800, default: 5000 };

// Prima culoare din gradientul CSS al fiecarei teme (fundalul compozitului).
const css = readFileSync(join(ROOT, 'public/assets/css/style.css'), 'utf8');
function bgOf(slug) {
  const m = css.match(new RegExp(`body\\.theme-${slug}\\s*\\{[^}]*?background:[^#]*?(#[0-9a-fA-F]{6})`));
  return m ? m[1] : '#000000';
}

let trecute = 0;
let esuate = 0;
for (const slug of SLUGS) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body class="theme-${slug}"></body></html>`, {
    url: 'http://127.0.0.1:8788/', pretendToBeVisual: true,
  });
  const { window } = dom;

  // Punte: fiecare <canvas> jsdom primeste un backing store REAL, rezolvat
  // leneș — motorul redimensioneaza canvas-ul DUPA getContext, iar in
  // browsere asta reseteaza contextul (backing-ul vechi ar ramane 300x150).
  window.HTMLCanvasElement.prototype.getContext = function () {
    const el = this;
    const cur = () => {
      if (!el._back || el._back.width !== el.width || el._back.height !== el.height) {
        el._back = createCanvas(el.width || 300, el.height || 150);
      }
      return el._back.getContext('2d');
    };
    cur();
    return new Proxy({}, {
      get(t, p) {
        if (p === 'canvas') return el;
        const c = cur();
        if (p === 'drawImage') return (img, ...a) => c.drawImage(img && img._back ? img._back : img, ...a);
        const v = c[p];
        return typeof v === 'function' ? v.bind(c) : v;
      },
      set(t, p, v) { cur()[p] = v; return true; },
    });
  };

  let rafCb = null;
  let timp = 1000;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  globalThis.cancelAnimationFrame = () => { rafCb = null; };
  globalThis.performance = { now: () => timp };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  const mod = await import(pathToFileURL(join(ROOT, 'public/assets/js/anim-bg.js')).href + `?r=${slug}`);
  mod.initAnimBg();
  const canvas = window.document.getElementById('anim-bg');
  let cadre = 0;
  for (let i = 0; i < 60; i++) {
    const cb = rafCb; rafCb = null;
    if (!cb) break;
    timp += 16.7;
    cb(timp);
    cadre++;
  }
  const prag = TIP[slug] === 'stele' ? PRAG.stele : PRAG.default;
  if (!canvas || !canvas._back) {
    console.log(`  ❌ ${slug}: canvas lipsa`);
    esuate++;
    continue;
  }
  const w = canvas._back.width;
  const h = canvas._back.height;
  const img = canvas._back.getContext('2d').getImageData(0, 0, w, h);
  let px = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 10) px++;

  const out = createCanvas(w, h);
  const o = out.getContext('2d');
  o.fillStyle = bgOf(slug);
  o.fillRect(0, 0, w, h);
  o.drawImage(canvas._back, 0, 0);
  writeFileSync(`/tmp/pixel-${slug}.png`, await out.encode('png'));

  const ok = cadre === 60 && px >= prag;
  console.log(`  ${ok ? '✅' : '❌'} ${slug}: ${w}x${h}, ${cadre} cadre, ${px}px (prag ${prag})`);
  if (ok) trecute++;
  else esuate++;
}

console.log('\n========================================================');
console.log(`REZULTAT: ${trecute} trecute, ${esuate} esuate`);
console.log('========================================================');
process.exit(esuate ? 1 : 0);
