// =====================================================================
// dom-smoke.mjs — ruleaza scripturile de pagina intr-un DOM real (jsdom)
// impotriva serverului local, ca sa prinda erorile pe care testele API
// nu le vad: id-uri gresite, module care arunca la import, randari goale.
//
// De ce conteaza: paginile de admin au fost rescrise complet, iar o
// referinta gresita la un element nu strica niciun test API — strica
// doar adminul care incearca sa posteze 500 de episoade.
//
// Rulare: porneste ./dev.sh, apoi `node tests/dom-smoke.mjs`.
// =====================================================================
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const ROOT = new URL('..', import.meta.url).pathname;

let passed = 0;
let failed = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push({ label, detail });
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Asteapta pana cand o conditie pe DOM devine adevarata (sau expira). */
async function until(fn, timeout = 12000, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await fn()) return true;
    } catch { /* elementul poate sa nu existe inca */ }
    await wait(step);
  }
  return false;
}

// ---------------------------------------------------------------- auth
let COOKIE = '';

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username: 'marius', password: 'parola123' }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const c = setCookie.map((s) => s.split(';')[0]).join('; ');
  if (!c) throw new Error(`login esuat: HTTP ${res.status}`);
  COOKIE = c;
}

// ------------------------------------------------------------ harness
/**
 * Incarca un fisier HTML intr-un jsdom, instaleaza globalele de care au
 * nevoie modulele (document/window/location/fetch/WebSocket) si ruleaza
 * scriptul de pagina ca modul ES. Intoarce erorile prinse pe parcurs.
 */
async function mountPage({ htmlFile, url, module, cookie = COOKIE }) {
  const html = readFileSync(`${ROOT}${htmlFile}`, 'utf8');
  const dom = new JSDOM(html, { url: `${BASE}${url}`, pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];

  // fetch: jsdom nu are unul care sa mearga in retea, deci il punem pe al
  // nostru si rezolvam URL-urile relative fata de serverul local.
  const realFetch = globalThis.fetch;
  window.fetch = async (input, init = {}) => {
    const path = typeof input === 'string' ? input : input.url;
    const abs = path.startsWith('http') ? path : `${BASE}${path}`;
    const headers = { ...(init.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    // jsdom nu stie de 'same-origin'; Node ar cere un URL absolut valid.
    const { credentials, ...rest } = init;
    try {
      return await realFetch(abs, { ...rest, headers, redirect: 'manual' });
    } catch (e) {
      errors.push(`fetch ${path}: ${e.message}`);
      throw e;
    }
  };

  // Chat-ul deschide un WebSocket; intr-un test DOM nu ne intereseaza,
  // dar lipsa constructorului ar opri executia paginii principale.
  class FakeSocket {
    constructor() { this.readyState = 0; setTimeout(() => this.onerror?.({}), 0); }
    send() {} close() {} addEventListener() {}
  }
  FakeSocket.OPEN = 1;

  const globals = {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    HTMLElement: window.HTMLElement, Element: window.Element,
    Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent,
    FormData: window.FormData, URLSearchParams: window.URLSearchParams,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    fetch: window.fetch, WebSocket: FakeSocket,
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    getComputedStyle: window.getComputedStyle,
    alert: () => {}, confirm: () => true,
  };
  const saved = {};
  for (const [k, v] of Object.entries(globals)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });
  }

  // Orice eroare nearunca din module ajunge aici, nu in consola.
  const onErr = (e) => errors.push(e?.reason?.stack || e?.reason?.message || String(e?.reason || e));
  process.on('unhandledRejection', onErr);
  window.addEventListener('error', (e) => errors.push(e.message));

  let importError = null;
  try {
    // ?t=… forteaza reimportul: fara asta, a doua pagina ar primi modulul
    // deja executat din cache si nu ar randa nimic.
    await import(`file://${ROOT}public/assets/js/${module}?t=${Date.now()}${Math.random()}`);
  } catch (e) {
    importError = e;
    errors.push(`import ${module}: ${e.message}`);
  }

  return {
    dom, window, errors, importError,
    doc: window.document,
    $: (sel) => window.document.querySelector(sel),
    $$: (sel) => [...window.document.querySelectorAll(sel)],
    text: (sel) => window.document.querySelector(sel)?.textContent?.trim() ?? null,
    async teardown() {
      // Paginile au debounce (cautarea) si fetch-uri in zbor. Daca demontam
      // imediat, globalele se schimba sub ele si primim TypeError-uri care nu
      // sunt ale paginii testate, ci ale celei anterioare.
      await wait(1200);
      process.off('unhandledRejection', onErr);
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
      window.close();
    },
  };
}

// ============================================================== TESTE
await login();
console.log(`(sesiune admin obtinuta: ${COOKIE.slice(0, 18)}…)`);

console.log('=== DOM: pagina principala (cautare + paginare pe server) ===');
{
  const p = await mountPage({ htmlFile: 'public/index.html', url: '/', module: 'page-index.js' });
  const loaded = await until(() => p.$$('#series-grid .card, #series-grid .poster-card').length > 0 || p.text('#series-count')?.includes('afișate'));
  check('Grila de serii se populeaza din API', loaded, `count=${p.text('#series-count')} html=${p.$('#series-grid')?.innerHTML.slice(0, 120)}`);
  check('Numaratoarea reflecta pagina incarcata, nu tot catalogul', /\d+ afișate|0 rezultate/.test(p.text('#series-count') || ''), p.text('#series-count'));
  check('Statistica din hero vine din meta, nu din pagina curenta', /^\d+$/.test(p.text('#stat-series') || ''), `stat-series=${p.text('#stat-series')}`);
  const sel = p.$('#sort-select');
  check('Selectorul de sortare e populat de pe server', sel && sel.options.length === 4, `optiuni=${sel?.options.length}`);
  check('Butonul „Incarca mai multe" e ascuns cand nu mai exista pagini', p.$('#load-more-wrap')?.hidden === true, `hidden=${p.$('#load-more-wrap')?.hidden}`);
  check('Nicio eroare de runtime la incarcare', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));

  // cautarea trebuie sa ajunga pe server, nu sa filtreze in browser
  const input = p.$('#search-input');
  input.value = 'zzz_inexistent';
  input.dispatchEvent(new p.window.Event('input', { bubbles: true }));
  const emptied = await until(() => /Nicio potrivire/.test(p.$('#series-grid')?.textContent || ''));
  check('Cautarea goleste grila si cere rezultatul de pe server', emptied, `cards=${p.$$('#series-grid .card, #series-grid .poster-card').length} text=${(p.$('#series-grid')?.textContent || '').slice(0, 100)}`);
  check('Mesajul de stare vida e specific cautarii, nu generic', /Nicio potrivire/.test(p.$('#series-grid')?.textContent || '') && !/Încă nu există serii/.test(p.$('#series-grid')?.textContent || ''), (p.$('#series-grid')?.textContent || '').slice(0, 100));
  check('Numaratoarea arata 0 rezultate la cautare fara potriviri', /0 rezultate/.test(p.text('#series-count') || ''), p.text('#series-count'));
  await p.teardown();
}

console.log('\n=== DOM: /admin/serii (lista paginata) ===');
{
  const p = await mountPage({ htmlFile: 'public/admin/serii.html', url: '/admin/serii', module: 'page-admin-serii.js' });
  const loaded = await until(() => p.$$('#series-table tbody tr').length > 0 || p.$('#series-table tbody .empty, #series-empty') !== null);
  check('Tabelul de serii se populeaza', loaded, `randuri=${p.$$('#series-table tbody tr').length}`);
  check('Randurile au link catre pagina de detaliu a seriei', p.$$('#series-table tbody a.row-link[href^="/admin/serie/"]').length > 0, p.$('#series-table tbody')?.innerHTML.slice(0, 150));
  // In baza exista o serie cu titlul `<img src=x onerror=alert(1)>` (creata de
  // suita e2e). Daca randarea nu escapeaza, jsdom ar executa atributul onerror
  // si ar aparea un <img> real in tabel.
  // In tabela exista si <img>-uri legitime (thumbnail-ul seriei cu poster),
  // deci verificam exact ce conteaza: niciun atribut onerror executabil si
  // titlul malitios afisat ca text, nu ca element.
  const evilRow = p.$$('#series-table tbody tr').find((tr) => tr.textContent.includes('onerror=alert'));
  check('Titlul malitios e randat ca text escaped, nu ca element', !!evilRow && evilRow.querySelectorAll('img[onerror]').length === 0, evilRow ? evilRow.innerHTML.slice(0, 160) : 'randul nu a fost gasit');
  check('Niciun handler inline in tabel (CSP le-ar bloca oricum)', p.$$('#series-table tbody [onerror], #series-table tbody [onclick]').length === 0, `gasite=${p.$$('#series-table tbody [onerror], #series-table tbody [onclick]').length}`);
  check('Nicio eroare de runtime la incarcare', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.teardown();
}

console.log('\n=== DOM: /admin/serie/<id> (episoade + surse + bulk) ===');
{
  // luam un id real de serie ca sa testam pe date adevarate
  const res = await fetch(`${BASE}/api/admin/series?per_page=1`, { headers: { Cookie: COOKIE } });
  const sid = (await res.json())?.series?.[0]?.id;
  check('Exista o serie pe care sa testam pagina de detaliu', Number.isInteger(sid), `sid=${sid}`);

  const p = await mountPage({ htmlFile: 'public/admin/serie.html', url: `/admin/serie/${sid}`, module: 'page-admin-serie.js' });
  const loaded = await until(() => p.text('#ser-title') || p.$$('#episodes-table tbody tr').length > 0);
  check('Detaliul seriei se randeaza din ruta /admin/serie/<id>', loaded, `titlu=${p.text('#ser-title')}`);
  check('Lista de episoade se populeaza', p.$$('#episodes-table tbody tr').length > 0, `randuri=${p.$$('#episodes-table tbody tr').length}`);
  check('Nicio eroare de runtime la incarcare', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));

  // --- parsarea pentru postare in bloc ruleaza in browser ---
  // Panoul de postare in bloc e ascuns pana apesi „Postare in bloc".
  const ta = p.$('#bulk-text');
  check('Panoul de postare in bloc exista', !!ta && !!p.$('#bulk-preview'), 'lipseste #bulk-text sau butonul #bulk-preview');

  p.$('#toggle-bulk')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  check('Panoul de bulk se deschide la click', p.$('#bulk-panel')?.hidden === false, `hidden=${p.$('#bulk-panel')?.hidden}`);

  // #bulk-preview e BUTONUL de previzualizare; raportul se scrie in #bulk-report.
  ta.value = [
    '1 | Primul | https://f7hyg4q.org/d/aB3xY9zQ12, https://cdn.x.com/1.mp4',
    '2 | Al doilea | https://doodstream.com/e/kM8nQ2xW47',
    '3 |',
    'linie gresita fara numar',
  ].join('\n');
  ta.dispatchEvent(new p.window.Event('input', { bubbles: true }));
  p.$('#bulk-preview').dispatchEvent(new p.window.Event('click', { bubbles: true }));

  const previewed = await until(() => p.$$('#bulk-report .bulk-preview__row').length > 0);
  check('Previzualizarea de bulk apare inainte de trimitere', previewed, `randuri=${p.$$('#bulk-report .bulk-preview__row').length} report=${p.$('#bulk-report')?.textContent?.slice(0, 80)}`);
  check('Bulk parseaza corect: 3 valide + doar linia gresita respinsa', p.$$('#bulk-report .bulk-preview__row').length === 3 && p.$$('#bulk-report .bulk-errors__row').length === 1, `ok=${p.$$('#bulk-report .bulk-preview__row').length} err=${p.$$('#bulk-report .bulk-errors__row').length}`);
  check('Episodul fara sursa e semnalat, nu respins', /1 fără sursă/.test(p.$('#bulk-report')?.textContent || ''), p.$('#bulk-report .bulk-report__head')?.textContent);
  const firstSrc = p.$('#bulk-report .bulk-preview__src')?.textContent || '';
  check('Ambele surse din linie sunt recunoscute si tipizate', /embed/.test(firstSrc) && /file/.test(firstSrc), firstSrc.slice(0, 90));
  check('Domeniul rotit DoodStream e clasificat ca embed', /embed/.test(firstSrc), firstSrc.slice(0, 90));
  check('Linia gresita e raportata cu numarul ei', /Linia 4/.test(p.$('#bulk-report')?.textContent || ''), p.$('#bulk-report')?.textContent?.slice(0, 120));
  check('Butonul de trimitere se activeaza dupa previzualizare', p.$('#bulk-submit')?.disabled === false, `disabled=${p.$('#bulk-submit')?.disabled}`);
  await p.teardown();
}

console.log('\n=== DOM: /admin (dashboard-ul fara taburile mutate) ===');
{
  const p = await mountPage({ htmlFile: 'public/admin.html', url: '/admin', module: 'page-admin.js' });
  const loaded = await until(() => p.$$('#stat-grid .stat, #stats-grid .stat, .stat').length > 0 || p.text('#admin-who'));
  check('Dashboard-ul se incarca si isi umple statisticile', loaded, `who=${p.text('#admin-who')}`);
  check('Linkul catre pagina noua de serii e prezent', p.$('a[href="/admin/serii"]') !== null, 'lipseste linkul');
  check('Nicio eroare de runtime dupa eliminarea taburilor', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.teardown();
}

console.log('\n' + '='.repeat(56));
if (failed) {
  console.log(`REZULTAT: ${passed} trecute, ${failed} ESUATE`);
  for (const f of failures) console.log(`  • ${f.label}${f.detail ? ` — ${f.detail.slice(0, 400)}` : ''}`);
} else {
  console.log(`REZULTAT: ${passed} trecute, 0 esuate`);
}
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);
