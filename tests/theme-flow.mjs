// =====================================================================
// theme-flow.mjs — fluxul REAL al temei animate, cap-coada, in pagina reala.
//
// Contexte goale (fara localStorage/sessionStorage), ca la prima intrare:
// 1. Inregistreaza un user, ii da gold (prin admin), cumpara si activeaza
//    „Sakura animata" — server-side, ca un utilizator adevarat.
// 2. Monteaza PAGINA REALA /shop in jsdom (HTML de pe server, modulul REAL
//    page-shop.js, cookie-ul sesiunii), cu canvas2d falsificat (numara
//    desenele) si rAF manual.
// 3. Asteapta sesiunea, ruleaza 5 cadre, verifica: clasa pe body + desene.
// Prinde regresii ca „getSession nu aplica tema pe calea network" (2026-09).
// Rulat din test.sh pe serverul principal, DUPA e2e+dom (inregistreaza useri).
// =====================================================================
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const BASE = 'http://127.0.0.1:8788';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- mini jar (ca in e2e) ---
function saveCookie(j, res) {
  const sc = res.headers.get('set-cookie');
  if (sc) j.cookie = sc.split(';')[0];
}
async function req(j, method, path, body) {
  const headers = { Origin: BASE };
  if (j?.cookie) headers.Cookie = j.cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  if (j) saveCookie(j, res);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 80) }; }
  return { status: res.status, data };
}

// 1. user + tema activa server-side
const u = `intrebu${Date.now() % 100000}`;
const j = { cookie: '' };
const ja = { cookie: '' };
await req(ja, 'POST', '/api/auth/login', { email: 'marius@test.ro', password: 'parola123' });
if (!ja.cookie) {
  // Rulare izolata, baza goala: primul user devine admin.
  await req(ja, 'POST', '/api/auth/register', { username: 'flowadmin', email: 'flowadmin@test.ro', password: 'parola123' });
}
const reg = await req(j, 'POST', '/api/auth/register', { username: u, email: `${u}@test.ro`, password: 'parola123' });
const uid = reg.data?.user?.id;
await req(j, 'POST', '/api/auth/login', { email: `${u}@test.ro`, password: 'parola123' });
await req(ja, 'POST', '/api/admin/users', { action: 'set_gold', user_id: uid, value: 1000000 });
await req(j, 'POST', '/api/shop/buy', { item_id: 'theme_petale' });
const act = await req(j, 'POST', '/api/shop/activate', { type: 'theme', id: 'theme_petale' });
console.log('activare server-side:', act.data?.active_theme, '| cookie:', j.cookie ? 'DA' : 'LIPSA');

// 2. pagina reala in jsdom
const html = await (await fetch(`${BASE}/shop`, { headers: { Cookie: j.cookie }, redirect: 'manual' })).text();
const dom = new JSDOM(html, { url: `${BASE}/shop`, pretendToBeVisual: true });
const { window } = dom;

let desene = 0;
window.HTMLCanvasElement.prototype.getContext = function () {
  // Sprite-urile nu folosesc drawImage/fillRect, deci numaratoarea globala e corecta.
  return new Proxy({}, {
    get(t, p) {
      if (p === 'drawImage' || p === 'fillRect') return () => { desene++; };
      if (p === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (typeof p === 'string' && p in t) return t[p];
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
};
let rafCb = null;
let timp = 1000;
const pas = (n) => {
  for (let i = 0; i < n; i++) {
    const cb = rafCb;
    rafCb = null;
    if (!cb) return false;
    timp += 16.7;
    cb(timp);
  }
  return true;
};

globalThis.window = window;
globalThis.document = window.document;
try { globalThis.navigator = window.navigator; } catch { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); }
globalThis.location = window.location;
globalThis.history = window.history;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.FormData = window.FormData;
globalThis.URLSearchParams = window.URLSearchParams;
globalThis.localStorage = window.localStorage;     // GOL (prima intrare)
globalThis.sessionStorage = window.sessionStorage; // GOL (prima intrare)
globalThis.MutationObserver = window.MutationObserver;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => { rafCb = null; };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.alert = () => {};
globalThis.confirm = () => true;
class FakeSocket {
  constructor() { this.readyState = 1; setTimeout(() => this.onopen?.({}), 0); }
  send() {} close() {} addEventListener() {}
}
globalThis.WebSocket = FakeSocket;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const path = typeof input === 'string' ? input : input.url;
  const abs = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = { ...(init.headers || {}), Cookie: j.cookie };
  if ((init.method || 'GET') !== 'GET' && !headers.Origin) headers.Origin = BASE;
  const { credentials, ...rest } = init;
  return realFetch(abs, { ...rest, headers, redirect: 'manual' });
};

// 3. modulul REAL al paginii + asteptare sesiune
await import(join(ROOT, 'public/assets/js/page-shop.js') + '?int=1');
let clasa = '';
for (let i = 0; i < 50 && !clasa; i++) {
  await new Promise((r) => setTimeout(r, 100));
  clasa = [...window.document.body.classList].find((c) => c.startsWith('theme-') && c !== 'theme-rank') || '';
}
console.log('clasa tema pe body dupa sesiune:', clasa || '(LIPSA)');
const canvas = window.document.getElementById('anim-bg');
console.log('canvas #anim-bg:', canvas ? 'EXISTA' : 'LIPSA');
const aRulat = pas(5);
console.log('cadre rulate:', aRulat ? 5 : 0, '| desene particule:', desene);

const okClasa = clasa === 'theme-petale';
const okDesene = desene >= 100;
console.log('\n========================================================');
console.log(okClasa && okDesene ? 'REZULTAT: PASS (flux complet functional)' : `REZULTAT: FAIL (clasa=${okClasa} desene=${okDesene})`);
console.log('========================================================');
process.exit(okClasa && okDesene ? 0 : 1);
