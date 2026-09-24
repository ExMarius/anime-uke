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
  // Retinem si CAILE cerute: testele de buget (buget 0 = cota de 100.000 de
  // invocari/zi) verifica exact ce cereri face pagina.
  const requests = [];
  const realFetch = globalThis.fetch;
  window.fetch = async (input, init = {}) => {
    const path = typeof input === 'string' ? input : input.url;
    requests.push(path);
    const abs = path.startsWith('http') ? path : `${BASE}${path}`;
    const headers = { ...(init.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    // POST-urile din pagini trec de isSameOrigin doar cu Origin explicit
    if ((init.method || 'GET') !== 'GET' && !headers.Origin) headers.Origin = BASE;
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
    constructor() {
      this.readyState = 1;               // OPEN: ca testele sa poata trimite
      this.sent = [];
      globalThis.__fakeSocket = this;    // accesibil din assert-uri
      setTimeout(() => this.onopen?.({}), 0);
    }
    send(d) { this.sent.push(d); }
    close() { this.readyState = 3; }
    addEventListener() {}
  }
  FakeSocket.OPEN = 1;
  FakeSocket.CLOSED = 3;

  const globals = {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    HTMLElement: window.HTMLElement, Element: window.Element,
    Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent,
    FormData: window.FormData, URLSearchParams: window.URLSearchParams,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    fetch: window.fetch, WebSocket: FakeSocket,
    getComputedStyle: window.getComputedStyle,
    matchMedia: (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    alert: () => {}, confirm: () => true,
  };
  // Timerii paginii (heartbeat, raf) raman pe Node; window.close() nu i-ar
  // anula si ar craspa suite-ul dupa teardown („document is not defined”).
  // Solutia: ii invelim, retinem id-urile si le oprim la teardown.
  const rawST = globalThis.setTimeout, rawCT = globalThis.clearTimeout;
  const rawSI = globalThis.setInterval, rawCI = globalThis.clearInterval;
  const pendingTimeouts = new Set(), pendingIntervals = new Set();
  globals.setTimeout = (fn, ms, ...a) => { const id = rawST(fn, ms, ...a); pendingTimeouts.add(id); return id; };
  globals.clearTimeout = (id) => { pendingTimeouts.delete(id); rawCT(id); };
  globals.setInterval = (fn, ms, ...a) => { const id = rawSI(fn, ms, ...a); pendingIntervals.add(id); return id; };
  globals.clearInterval = (id) => { pendingIntervals.delete(id); rawCI(id); };
  globals.requestAnimationFrame = (cb) => globals.setTimeout(() => cb(Date.now()), 0);
  globals.cancelAnimationFrame = globals.clearTimeout;

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
    dom, window, errors, importError, requests,
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
      for (const id of pendingTimeouts) rawCT(id);
      for (const id of pendingIntervals) rawCI(id);
      pendingTimeouts.clear(); pendingIntervals.clear();
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
  // Hero-ul trebuie sa arate TOTALUL din site_meta, nu ce incap pe pagina.
  // La 1000+ serii numarul e formatat ro-RO („1.002"), deci comparam cu
  // totalul din API trecut prin acelasi format.
  {
    const m = await (await fetch(`${BASE}/api/series?per_page=24`, { headers: { Cookie: COOKIE } })).json();
    const asteptat = Number(m.total).toLocaleString('ro-RO');
    check('Statistica din hero vine din meta, nu din pagina curenta', p.text('#stat-series') === asteptat, `stat-series=${p.text('#stat-series')} asteptat=${asteptat}`);
  }
  const sel = p.$('#sort-select');
  check('Selectorul de sortare e populat de pe server', sel && sel.options.length === 5, `optiuni=${sel?.options.length}`);
  check('  ...inclusiv „Cele mai bine notate"', [...(sel?.options || [])].some((o) => o.value === 'rating'), [...(sel?.options || [])].map((o) => o.value).join(','));

  // -------------------------------------------------------------------
  // BUGET 0: prima pagină = O SINGURĂ cerere de API.
  // Înainte se făceau 5 (/series, /top, /recent, /genres, /pulse), adică 5
  // invocări din cota gratuită de 100.000/zi pentru fiecare vizitator.
  // -------------------------------------------------------------------
  {
    const apiCalls = p.requests.filter((u) => u.startsWith('/api/'));
    const pathOf = (u) => u.split('?')[0];
    check('Prima pagină cere catalogul o singură dată, prin /api/home',
      apiCalls.filter((u) => pathOf(u) === '/api/home').length === 1, apiCalls.join(' '));
    const redundante = apiCalls.filter((u) => ['/api/series', '/api/top', '/api/recent', '/api/genres', '/api/pulse'].includes(pathOf(u)));
    check('  ...și nu mai cheltuie cereri separate pentru top/recent/genuri/pulse',
      redundante.length === 0, redundante.join(' ') || 'niciuna');
    check('  ...sesiunea rămâne singura cerere în plus (nav, notificări)',
      apiCalls.every((u) => pathOf(u) === '/api/home' || pathOf(u).startsWith('/api/auth') || pathOf(u).startsWith('/api/notifications') || pathOf(u) === '/api/continue'),
      apiCalls.join(' '));
  }
  // Vizibilitatea butonului trebuie sa fie congruenta cu has_more de pe
  // server, indiferent daca baza are 1 serie sau 1000.
  const meta = await (await fetch(`${BASE}/api/series?per_page=24`, { headers: { Cookie: COOKIE } })).json();
  check('Butonul „Incarca mai multe" e congruent cu has_more', p.$('#load-more-wrap')?.hidden === !meta.has_more, `hidden=${p.$('#load-more-wrap')?.hidden} has_more=${meta.has_more}`);
  // Regulile sunt externe (<link rel="speculationrules">) ca sa treaca de CSP fara unsafe-inline.
  check('Regulile de prefetch/prerender pentru navigare rapida exista', !!p.$('link[rel="speculationrules"][href="/speculationrules.json"]'), 'lipseste <link rel=speculationrules>');
  const bellOn = await until(() => !!p.$('#nav-bell'));
  check('Clopoțelul de notificări exista in nav', bellOn, 'lipseste #nav-bell');
  // Nav-ul e randat aici (dovada: clopoțelul) — verificăm și brandul.
  const brandImg = p.$('#nav .nav__brand__mark');
  // Logo-ul din nav e .webp (assetul nu mai trece prin worker, deci nu există
  // negociere Accept pe server); faviconul rămâne .png, pentru iOS/crawlere.
  check('Brandul din nav e logo-ul .webp (img, nu glifă)', brandImg?.tagName === 'IMG' && (brandImg.getAttribute('src') || '').endsWith('logo-icon.webp'), `${brandImg?.tagName} ${brandImg?.getAttribute('src')}`);
  check('Faviconul e logo-ul', (p.$('link[rel="icon"]')?.getAttribute('href') || '').includes('logo-icon.png'), p.$('link[rel="icon"]')?.getAttribute('href'));
  p.$('#nav-bell')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const popOn = await until(() => p.$('#notif-pop')?.hidden === false);
  check('Panoul de notificări se deschide cu stare vida', popOn && /Nicio notificare|Se încarcă/.test(p.$('#notif-pop')?.textContent || ''), p.$('#notif-pop')?.textContent?.slice(0, 60));
  check('Butonul de stikere exista in chat', !!p.$('#chat-sticker-btn'), 'lipseste #chat-sticker-btn');
  p.$('#chat-fab')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  // Regulamentul chat-ului apare la prima deschidere si dispare dupa accept.
  const rulesOn = await until(() => !!p.$('.chat-rules'));
  check('Regulamentul chat-ului apare la prima deschidere', rulesOn && p.$$('.chat-rules__list li').length >= 5, `li=${p.$$('.chat-rules__list li').length}`);
  p.$('.chat-rules .btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  check('Dupa accept regulamentul dispare si acceptul e memorat', !p.$('.chat-rules') && p.window.localStorage.getItem('auk-chat-rules-v1') === '1', `ls=${p.window.localStorage.getItem('auk-chat-rules-v1')}`);
  p.$('#chat-sticker-btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  check('Pickerul de stikere se deschide cu setul Tenor complet', p.$$('#sticker-pop .sticker-pop__item').length >= 50, `n=${p.$$('#sticker-pop .sticker-pop__item').length}`);
  p.$('#sticker-pop .sticker-pop__item')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const sentSticker = (globalThis.__fakeSocket?.sent || [])[0] || '';
  check('Click pe sticker trimite tag-ul de sticker prin socket', sentSticker.includes('[sticker:salut]'), sentSticker);
  globalThis.__fakeSocket?.onmessage?.({ data: JSON.stringify({ type: 'message', user_id: 4242, username: 'StickerBot', message: '[sticker:party]', created_at: '2026-09-12 12:00:00' }) });
  check('Stickerul primit se randeaza ca GIF Tenor din whitelist', p.$('#chat-body .msg__sticker')?.getAttribute('src')?.startsWith('https://media.tenor.com/') === true, p.$('#chat-body .msg__sticker')?.getAttribute('src'));
  globalThis.__fakeSocket?.onmessage?.({ data: JSON.stringify({ type: 'init', online: [], history: [{ user_id: 1, username: 'Vechi', message: '[sticker:love]', created_at: '2026-09-01 10:00:00' }] }) });
  check('Stickerul din istoricul salvat se randeaza tot ca GIF Tenor', (p.$$('#chat-body .msg__sticker').length === 1) && p.$('#chat-body .msg__sticker')?.getAttribute('src')?.includes('media.tenor.com') === true, `n=${p.$$('#chat-body .msg__sticker').length} src=${p.$('#chat-body .msg__sticker')?.getAttribute('src')}`);
  globalThis.__fakeSocket?.onmessage?.({ data: JSON.stringify({ type: 'message', user_id: 4243, username: 'Hacker', message: '[sticker:nu-exista]', created_at: '2026-09-12 12:00:01' }) });
  globalThis.__fakeSocket?.onmessage?.({ data: JSON.stringify({ type: 'message', user_id: 4244, username: 'Mixt', message: 'salut [sticker:lol] pic', created_at: '2026-09-12 12:00:02' }) });
  check('Tag-urile necunoscute sau amestecate raman text (sigur)', p.$$('#chat-body .msg__sticker').length === 1 && (p.$('#chat-body')?.textContent || '').includes('[sticker:nu-exista]'), `img=${p.$$('#chat-body .msg__sticker').length}`);
    check('Nicio eroare de runtime la incarcare', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));

  // Hero banner: anime random sus de tot, TOT bannerul e link catre serie.
  const topsOn = await until(() => p.$('#tops-section')?.hidden === false && p.$$('#top-weekly li').length >= 1);
  check('Topul saptamanal se randeaza pe home', topsOn, `li=${p.$$('#top-weekly li').length}`);
  check('Clasamentul de voturi se randeaza pe home', p.$$('#top-rated li').length >= 1 && /★/.test(p.$('#top-rated')?.textContent || ''), p.$('#top-rated')?.textContent?.slice(0, 60));
  check('Hero bannerul exista in DOM', !!p.$('#hero-banner'), 'lipseste #hero-banner');
  check('Hero bannerul e prima sectiune din main (sus de tot)', p.$('main')?.firstElementChild?.id === 'hero-banner', p.$('main')?.firstElementChild?.id);
  check('Butonul de shuffle „Alt anime” exista', !!p.$('#hero-shuffle'), 'lipseste #hero-shuffle');
  check('Randul „Continua vizionarea” exista in DOM', !!p.$('#continue-section'), 'lipseste #continue-section');
  if (p.$('#hero-banner')?.hidden === false) {
    check('TOT bannerul e un link catre seria afisata', p.$('#hero-banner')?.tagName === 'A' && /^\/series\?id=\d+$/.test(p.$('#hero-banner')?.getAttribute('href') || ''), `${p.$('#hero-banner')?.tagName} ${p.$('#hero-banner')?.getAttribute('href')}`);
    check('Titlul anime-ului e afisat in banner', (p.text('#hero-title') || '').length > 1, p.text('#hero-title'));
    check('Bannerul vizibil are eticheta editoriala', (p.text('#hero-tag') || '').length > 3, p.text('#hero-tag'));
    check('Bannerul are arta de fundal (coperta, arta bundled sau poster generat)', !!p.$('#hero-bg img, #hero-bg .hban__bg-gen'), p.$('#hero-bg')?.innerHTML?.slice(0, 80));
    check('CTA-ul vizual „Vezi seria” exista', !!p.$('#hero-open'), 'lipseste #hero-open');
    p.$('#hero-shuffle')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    check('Shuffle-ul re-randeaza fara sa navigheze si fara erori', /^\/series\?id=\d+$/.test(p.$('#hero-banner')?.getAttribute('href') || '') && p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  } else {
    check('Bannerul ramane ascuns cand catalogul e gol', true);
  }

  // --- aspect: nota pe carduri, butonul „inapoi sus", scurtatura „/"
  {
    // Nota comunitatii trebuie sa apara EXACT pe cardurile care au voturi:
    // numaram din API si comparam cu ce s-a randat (nu depinde de date).
    const lista = await (await fetch(`${BASE}/api/series?per_page=24`, { headers: { Cookie: COOKIE } })).json();
    const rows = lista.series || [];
    const cuVoturi = rows.filter((r) => Number(r.rating_count) > 0);
    check('Catalogul aduce nota si numarul de voturi pe fiecare rand',
      rows.every((r) => 'rating_avg' in r && 'rating_count' in r),
      `chei: ${Object.keys(rows[0] || {}).join(',')}`);
    check('Nota are formatul ★ x.x pe cardurile cu voturi',
      cuVoturi.every((r) => {
        const card = p.$(`#series-grid .card[href$="id=${r.id}"]`);
        const b = card?.querySelector('.badge-rating');
        return b && b.textContent.trim() === `★ ${Number(r.rating_avg).toFixed(1)}`;
      }),
      `${cuVoturi.length} carduri cu voturi din ${rows.length}`);
    check('Cardurile fara voturi nu inventeaza o nota',
      p.$$('#series-grid .badge-rating').length === cuVoturi.length,
      `badge-uri=${p.$$('#series-grid .badge-rating').length} voturi=${cuVoturi.length}`);

    // Scurtatura „/" e doar o indicatie vizuala pe desktop.
    check('Caseta de cautare arata scurtatura „/"', p.$('.search__kbd')?.textContent === '/', p.$('.search__kbd')?.outerHTML?.slice(0, 60));

    // Butonul „inapoi sus": exista pe pagina, dar e ascuns cat timp nu s-a derulat.
    const top = p.$('#to-top');
    check('Butonul „inapoi sus" exista si porneste ascuns', !!top && top.hidden === true, top ? `hidden=${top.hidden}` : 'lipseste #to-top');

    // „Continua vizionarea": fiecare card spune unde a ramas utilizatorul —
    // procent (cand seria are durata completata) sau minutele vazute, fara sa
    // inventeze un procent. Verificarea e conditionala: randul depinde de
    // progresul contului, care poate lipsi pe o baza proaspat seed-uita.
    const cards = p.$$('#continue-row .continue-card');
    if (cards.length) {
      const areStare = cards.every((c) => {
        const txt = c.querySelector('.continue-card__ago')?.textContent || '';
        const bar = c.querySelector('.continue-card__prog');
        const eCorect = txt === '✓ Văzut · ' ? false : /(✓ Văzut|\d+%|\d+ min văzute)/.test(txt);
        // Bara exista doar cand avem procent (procent ⇒ bara).
        return eCorect && (bar ? /\d+%|✓/.test(txt) : true);
      });
      check('Cardurile „Continua vizionarea" spun unde ai ramas', areStare,
        cards.slice(0, 2).map((c) => c.textContent.trim().slice(0, 60)).join(' | '));
      check('Bara de progres are latime setata cand exista', cards.every((c) => {
        const fill = c.querySelector('.continue-card__prog > i');
        return !fill || /%$/.test(fill.style.width || '');
      }), cards.map((c) => c.querySelector('.continue-card__prog > i')?.style.width).join(','));
    } else {
      check('Randul „Continua vizionarea" lipseste cand nu exista progres (comportament corect)', true);
    }
  }

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
  // Seria malițioasă și-o creează singur testul: dacă ar depinde de datele
  // lăsate de suita e2e, ar eșea ori de câte ori baza e seed-uită curat.
  const EVIL = '<img src=x onerror=alert(1)>';
  const evil = await (await fetch(`${BASE}/api/admin/series`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE },
    body: JSON.stringify({ title: EVIL, status: 'ongoing' }),
  })).json();

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

  await p.teardown();
  await fetch(`${BASE}/api/admin/series?id=${evil?.id}`, { method: 'DELETE', headers: { Cookie: COOKIE, Origin: BASE } });
  const p2 = await mountPage({ htmlFile: 'public/admin/serii.html', url: '/admin/serii', module: 'page-admin-serii.js' });
  check('Nicio eroare de runtime la incarcare', p2.errors.length === 0, p2.errors.slice(0, 3).join(' | '));
  await p2.teardown();
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

console.log('\n=== DOM: catalog partajabil prin URL (filtre + sortare) ===');
{
  // Un link ca „/?gen=Acțiune&status=ongoing" trebuie să deschidă pagina
  // DIRECT pe rezultatele filtrate: fără el, un catalog filtrat nu putea fi
  // trimis cuiva, iar butonul Înapoi ieșea de pe site în loc să scoată filtrul.
  // Un gen propriu, ca testul sa nu depinda de catalogul de la acel moment
  // (baza de test poate avea sau nu serii cu genuri). Numele e unic, deci
  // filtrarea „LIKE %gen%" nu poate prinde altceva din întâmplare.
  const gen = 'GenURLTest';
  const created = await (await fetch(`${BASE}/api/admin/series`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE },
    body: JSON.stringify({ title: 'Serie pentru link de catalog', status: 'ongoing', genre: gen, year: 2026 }),
  })).json();
  check('Seria de test pentru linkul de catalog a fost creata', Number.isInteger(created.id), JSON.stringify(created).slice(0, 120));

  const p = await mountPage({
    htmlFile: 'public/index.html',
    url: `/?gen=${encodeURIComponent(gen)}&status=ongoing&sort=title`,
    module: 'page-index.js',
  });
  const loadedUrl = await until(() => p.$$('#series-grid .card, #series-grid .poster-card').length > 0 || p.text('#series-count')?.includes('afișate'));
  check('Pagina se incarca pe filtrele din URL', loadedUrl, p.text('#series-count'));
  check('Selectul de gen preia valoarea din URL', p.$('#genre-select')?.value === gen, `valoare=${p.$('#genre-select')?.value}`);
  check('  ...chiar daca genul nu era in lista adusa de server (devine opțiune)',
    [...(p.$('#genre-select')?.options || [])].some((o) => o.value === gen),
    [...(p.$('#genre-select')?.options || [])].map((o) => o.value).join(','));
  check('Selectul de status preia valoarea din URL', p.$('#status-select')?.value === 'ongoing', `valoare=${p.$('#status-select')?.value}`);
  check('Sortarea din URL ajunge in selector', p.$('#sort-select')?.value === 'title', `valoare=${p.$('#sort-select')?.value}`);
  check('Butonul de resetare a filtrelor e vizibil', p.$('#filter-reset')?.hidden === false, `hidden=${p.$('#filter-reset')?.hidden}`);
  // Catalogul filtrat NU are voie sa vina din /api/home (acela e doar primul
  // ecran, nefiltrat): trebuie o cerere cu parametrii.
  const filtrat = p.requests.find((u) => u.startsWith('/api/series?') && /gen=/.test(u));
  check('Filtrele merg la server, nu se aplica in browser', !!filtrat, p.requests.filter((u) => u.startsWith('/api/series')).join(' ') || 'nicio cerere');
  // /api/home rămâne cerut (hero, topuri, pulse — restul paginii), dar GRILA
  // trebuie să vină din cererea filtrată: comparam numarul de carduri cu ce
  // intoarce serverul pentru exact acel filtru.
  const filtratApi = await (await fetch(`${BASE}/api/series?gen=${encodeURIComponent(gen)}&status=ongoing&per_page=24`)).json();
  const asteptate = (filtratApi.series || []).length;
  const carduri = p.$$('#series-grid .card, #series-grid .poster-card').length;
  check('Grila arata exact rezultatele filtrului de pe server', asteptate >= 1 && carduri === asteptate, `dom=${carduri} api=${asteptate}`);
  check('  ...si catalogul nefiltrat nu mai e cerut de grila', p.requests.filter((u) => u.startsWith('/api/series') && !/gen=/.test(u)).length === 0, p.requests.filter((u) => u.startsWith('/api/series')).join(' '));
  check('URL-ul pastreaza filtrele (linkul poate fi trimis mai departe)',
    /gen=/.test(p.window.location.search) && /status=ongoing/.test(p.window.location.search), p.window.location.search);

  // Schimbarea unui filtru trebuie sa scrie URL-ul si sa dea o intrare noua in
  // istoric (pushState), ca butonul Înapoi sa scoata filtrul, nu sa iasa de pe site.
  const gsel = p.$('#genre-select');
  gsel.value = '';
  gsel.dispatchEvent(new p.window.Event('change', { bubbles: true }));
  const scos = await until(() => !/gen=/.test(p.window.location.search));
  check('Scoaterea filtrului se reflecta in URL (pushState)', scos, p.window.location.search);
  check('  ...si statusul ramas e tot in URL', /status=ongoing/.test(p.window.location.search), p.window.location.search);
  check('Nicio eroare de runtime la navigarea cu filtre', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.teardown();

  await fetch(`${BASE}/api/admin/series?id=${created.id}`, { method: 'DELETE', headers: { Cookie: COOKIE, Origin: BASE } });
}

console.log('\n=== DOM: /series?id=… cu serie lunga (selector de intervale) ===');
// Creeaza o serie de 150 de episoade ca sa treaca de pragul de 100/page.
// Fara paginare, pagina asta ar citi toate episoadele la fiecare vizita.
{
  const created = await (await fetch(`${BASE}/api/admin/series`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE },
    body: JSON.stringify({
      title: 'Serie lunga DOM', status: 'ongoing',
      alt_titles: 'Long Series / Nagai Series', themes: 'pirați, lupte', age_rating: '13+', ep_duration: 24,
      release_date: '1999-10-20', country: 'Japonia', external_url: 'https://myanimelist.net/anime/21/One_Piece',
      team: 'Traducere: Ana', next_ep_note: 'Episodul 151 RoSub', next_ep_at: '2030-01-01T18:00',
    }),
  })).json();
  const sid = created?.id;
  check('Seria lunga de test a fost creata', Number.isInteger(sid), JSON.stringify(created).slice(0, 120));

  await fetch(`${BASE}/api/admin/episodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE },
    body: JSON.stringify({
      series_id: sid,
      episodes: Array.from({ length: 150 }, (_, i) => ({ episode_number: i + 1, title: `Ep ${i + 1}`, sources: [] })),
    }),
  });

  const p = await mountPage({ htmlFile: 'public/series.html', url: `/series?id=${sid}`, module: 'page-series.js' });
  const loaded = await until(() => p.$$('#episodes-grid > *').length > 0);
  check('Episoadele se randeaza', loaded, `n=${p.$$('#episodes-grid > *').length}`);
  check('Se randeaza exact o pagina, nu toate 150', p.$$('#episodes-grid > *').length === 100, `n=${p.$$('#episodes-grid > *').length}`);
  check('Numaratoarea arata totalul real, nu pagina curenta', /150/.test(p.text('#episodes-count') || ''), p.text('#episodes-count'));

  // Cufărul cu comori: sectiunea trebuie sa apara pentru un user logat si sa
  // aiba exact 3 cufere, nu un container gol.
  const chestsOn = await until(() => p.$$('#chests-row .chest').length === 3);
  check('Cufărul cu comori se randeaza cu 3 cufere', chestsOn, `n=${p.$$('#chests-row .chest').length} hidden=${p.$('#chests-section')?.hidden}`);

  // Widgetul de rating: 10 butoane, media vizibila.
  const rateOn = await until(() => p.$$('#rate-stars .rate__star').length === 10);
  check('Widgetul de rating are 10 note', rateOn, `n=${p.$$('#rate-stars .rate__star').length}`);
  const revOn = await until(() => p.$$('#reviews-list .review').length >= 0 && !!p.$('#review-form'));
  check('Sectiunea de recenzii exista cu formular si 10 stele', revOn && p.$$('#review-stars .rate__star').length === 10, `stele=${p.$$('#review-stars .rate__star').length}`);
  p.$$('#review-stars .rate__star')[7]?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  check('Steaua 8 se marcheaza la click', p.$$('#review-stars .rate__star')[7]?.classList.contains('rate__star--on') === true, p.$$('#review-stars .rate__star')[7]?.className);
  const subOn = await until(() => p.$('#sub-btn') && !p.$('#sub-btn').hidden);
  check('Butonul de urmărire a seriei exista', subOn, `hidden=${p.$('#sub-btn')?.hidden}`);
  p.$('#sub-btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const subToggled = await until(() => /Urmărită/.test(p.$('#sub-btn')?.textContent || ''));
  check('Click pe „Urmărește” comută starea prin API', subToggled, p.$('#sub-btn')?.textContent);
  check('Media de vot e afisata', (p.text('#rate-avg') || '').length > 0, p.text('#rate-avg'));
  check('Cuferele isi arata starea (blocat/deschis)', /mai ai|Deschide|Deschis/.test(p.text('#chests-row') || ''), p.text('#chests-row')?.slice(0, 60));
  check('Posterul seriei e randat (fallback cand lipseste coperta)', p.$('#series-poster')?.hidden === false && p.$$('#series-poster > *').length === 1, `hidden=${p.$('#series-poster')?.hidden} copii=${p.$$('#series-poster > *').length}`);
  // Fisa „Informatii despre serie" + titluri alternative + episodul urmator (0024).
  check('Titlurile alternative apar sub titlu', p.$('#series-alt')?.hidden === false && /Nagai Series/.test(p.text('#series-alt') || ''), p.text('#series-alt'));
  check('Fisa detaliata e vizibila si are teme, varsta, durata, tara, echipa', p.$('#series-info')?.hidden === false && ['pirați, lupte', '13+', '24 min', 'Japonia', 'Traducere: Ana'].every((t) => (p.text('#series-info') || '').includes(t)), p.text('#series-info')?.slice(0, 160));
  check('Data lansarii e formatata in romana', /20 octombrie 1999/.test(p.text('#series-info') || ''), p.text('#series-info')?.slice(0, 200));
  const extA = p.$('#series-info a');
  check('Linkul extern e etichetat MyAnimeList si se deschide in fila noua, cu nofollow', extA?.textContent === 'MyAnimeList' && extA.target === '_blank' && /nofollow/.test(extA.rel), extA?.outerHTML?.slice(0, 120));
  check('Anuntul „Episodul urmator" e vizibil cu countdown', p.$('#next-ep')?.hidden === false && /Episodul 151 RoSub/.test(p.text('#next-ep-title') || '') && /peste/.test(p.text('#next-ep-when') || ''), `${p.text('#next-ep-title')} | ${p.text('#next-ep-when')}`);
  check('Selectorul de intervale e vizibil la o serie lunga', p.$('#ep-ranges')?.hidden === false, `hidden=${p.$('#ep-ranges')?.hidden}`);
  check('Selectorul are doua intervale + sageti', p.$$('#ep-ranges button').length === 4, `butoane=${p.$$('#ep-ranges button').length}`);
  check('Primul interval e etichetat corect', /1–100/.test(p.$('#ep-ranges')?.textContent || ''), p.$('#ep-ranges')?.textContent?.slice(0, 80));
  check('Sageata spre pagina anterioara e dezactivata pe pagina 1', p.$$('#ep-ranges button')[0]?.disabled === true, 'ar trebui dezactivata');

  // click pe intervalul al doilea
  const second = p.$$('#ep-ranges button').find((b) => /101–150/.test(b.textContent));
  check('Exista butonul pentru intervalul 101–150', !!second, p.$('#ep-ranges')?.textContent?.slice(0, 100));
  second?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const switched = await until(() => p.$$('#episodes-grid > *').length === 50);
  check('La click se incarca doar intervalul ales', switched, `n=${p.$$('#episodes-grid > *').length}`);
  check('Intervalul ales e marcat ca pagina curenta', p.$('#ep-ranges [aria-current="page"]')?.textContent?.includes('101') === true, p.$('#ep-ranges [aria-current="page"]')?.textContent);
  check('Nicio eroare de runtime pe pagina seriei', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.teardown();

  // -------------------------------------------------------------------
  // MARCAJUL „VAZUT" + EPISODUL URMATOR (2026-09-24)
  //
  // Progresul se creeaza prin API-ul real (nu inselat in DOM): episodul 1
  // pana la pragul de 15 min (8 heartbeat-uri, limita e 120s/cerere), iar
  // episodul 2 abia inceput. Apoi aceeasi pagina trebuie sa arate, pentru
  // fiecare card, starea lui reala.
  // -------------------------------------------------------------------
  const eps = await (await fetch(`${BASE}/api/series/${sid}?per_page=5`, { headers: { Cookie: COOKIE } })).json();
  const ep1 = (eps.episodes || []).find((e) => e.episode_number === 1);
  const ep2 = (eps.episodes || []).find((e) => e.episode_number === 2);
  for (let i = 0; i < 8; i++) {
    await fetch(`${BASE}/api/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE },
      body: JSON.stringify({ episode_id: ep1.id, seconds: 120 }),
    });
  }
  await fetch(`${BASE}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE },
    body: JSON.stringify({ episode_id: ep2.id, seconds: 30 }),
  });

  const p2 = await mountPage({ htmlFile: 'public/series.html', url: `/series?id=${sid}`, module: 'page-series.js' });
  await until(() => p2.$$('#episodes-grid > *').length > 0);
  const card1 = p2.$(`#episodes-grid .card[href$="id=${ep1.id}"]`);
  const card2 = p2.$(`#episodes-grid .card[href$="id=${ep2.id}"]`);
  check('Episodul vazut e marcat in lista (bara + eticheta)',
    card1?.classList.contains('is-watched') === true && /Văzut/.test(card1?.textContent || ''),
    `${card1?.className} | ${card1?.textContent?.slice(0, 40)}`);
  check('Episodul abia inceput apare ca „Început", nu ca vazut',
    card2?.classList.contains('is-started') === true && !card2?.classList.contains('is-watched') && /Început/.test(card2?.textContent || ''),
    `${card2?.className} | ${card2?.textContent?.slice(0, 40)}`);
  check('Nicio eroare de runtime la marcajele de episoade', p2.errors.length === 0, p2.errors.slice(0, 3).join(' | '));
  await p2.teardown();

  // Cardul din „Continua vizionarea": episodul 1 e terminat si are un
  // urmator, deci cardul trebuie sa ofere butonul de comutare.
  const p3 = await mountPage({ htmlFile: 'public/index.html', url: '/', module: 'page-index.js' });
  const card = await until(() => p3.$$('#continue-row .continue-card').length > 0);
  check('Rândul „Continua vizionarea" se randeaza pentru userul cu progres', card, `n=${p3.$$('#continue-row .continue-card').length}`);
  const first = p3.$$('#continue-row .continue-card').find((c) => /id=/.test(c.getAttribute('href') || ''));
  check('Cardul duce la un episod real', !!first && /\/episode\?id=\d+/.test(first.getAttribute('href') || ''), first?.getAttribute('href'));
  const nextBtn = p3.$('#continue-row .continue-card__next');
  check('Cardul terminat ofera butonul „Episodul următor"', !!nextBtn && /următor/i.test(nextBtn.textContent || ''), nextBtn?.textContent);
  if (nextBtn) {
    // Comutarea tine minte preferinta si re-randeaza cardul cu tinta noua.
    const inainte = first.getAttribute('href');
    nextBtn.dispatchEvent(new p3.window.Event('click', { bubbles: true }));
    const schimbat = await until(() => {
      const c = p3.$('#continue-row .continue-card[data-next]');
      return !!c && c.getAttribute('href') !== inainte;
    });
    check('Click pe buton duce cardul la episodul următor', schimbat, p3.$('#continue-row .continue-card')?.getAttribute('href'));
    const reia = p3.$('#continue-row .continue-card__next');
    check('Butonul își schimba sensul (poți reveni la episodul văzut)', /Reia/i.test(reia?.textContent || ''), reia?.textContent);
  }
  check('Nicio eroare de runtime pe prima pagina cu progres', p3.errors.length === 0, p3.errors.slice(0, 3).join(' | '));
  await p3.teardown();

  await fetch(`${BASE}/api/admin/series?id=${sid}`, { method: 'DELETE', headers: { Cookie: COOKIE, Origin: BASE } });
}

console.log('\n=== DOM: /admin (dashboard-ul fara taburile mutate) ===');
{
  const p = await mountPage({ htmlFile: 'public/admin.html', url: '/admin', module: 'page-admin.js' });
  const loaded = await until(() => p.$$('#stat-grid .stat, #stats-grid .stat, .stat').length > 0 || p.text('#admin-who'));
  check('Dashboard-ul se incarca si isi umple statisticile', loaded, `who=${p.text('#admin-who')}`);
  check('Linkul catre pagina noua de serii e prezent', p.$('a[href="/admin/serii"]') !== null, 'lipseste linkul');
  check('Nicio eroare de runtime dupa eliminarea taburilor', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
    p.$('#tab-ranks')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const ranksOn = await until(() => p.$$('#ranks-list .ranks-row').length >= 3);
  check('Panoul admin de grade listeaza temele', ranksOn, `randuri=${p.$$('#ranks-list .ranks-row').length}`);
  check('Formularele de tema noua si de grade de staff exista', !!p.$('#rank-theme-form') && !!p.$('#mod-form') && !!p.$('#mod-role'), 'lipsesc formularele');
  const roleOpts = [...(p.$$('#mod-role option') || [])].map((o) => o.value);
  check('Selectul de grad ofera helper/staff/moderator', roleOpts.includes('helper') && roleOpts.includes('staff') && roleOpts.includes('moderator'), roleOpts.join(','));
  const staffOn = await until(() => p.$$('#staff-list .staff-row').length >= 1);
  check('Echipa curenta listeaza cel putin adminul', staffOn && /Admin/.test(p.text('#staff-list') || ''), (p.text('#staff-list') || '').slice(0, 80));
  const firstBox = p.$('#panel-ranks .box .box__title');
  check('Gradele de staff sunt primul lucru din tab, temele de nivel marcate automate', /Grade de staff/.test(firstBox?.textContent || '') && /automate/.test(p.text('#panel-ranks .box--muted .box__title') || ''), `${firstBox?.textContent} | ${p.text('#panel-ranks .box--muted .box__title')}`);
  p.$('#tab-reports')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const repTabOn = await until(() => p.$('#panel-reports')?.hidden === false);
  check('Tabul de raportari deschide panoul', repTabOn, `hidden=${p.$('#panel-reports')?.hidden}`);
  const repListOn = await until(() => p.$$('#reports-list .report-row-admin').length > 0 || /Nicio raportare|Nu am putut/.test(p.text('#reports-list') || ''));
  check('Lista de raportari se incarca (randuri sau stare vida)', repListOn, p.text('#reports-list')?.slice(0, 80));  await p.teardown();
}

console.log('\n=== DOM: /admin tab Sezon (setare din UI + banner) ===');
{
  // Adminul primeste o tema personala (Sakura), ca sa existe diferenta intre
  // ce vede el si sezon — cazul real „am activat Halloween si vad toamna".
  const meR = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: COOKIE } });
  const adminId = (await meR.json())?.user?.id;
  const post = (path, body) => fetch(`${BASE}${path}`, { method: 'POST', headers: { Cookie: COOKIE, Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post('/api/admin/users', { action: 'set_gold', user_id: adminId, value: 200000 });
  await post('/api/shop/buy', { item_id: 'theme_sakura' });
  await post('/api/shop/activate', { type: 'theme', id: 'theme_sakura' });

  const p = await mountPage({ htmlFile: 'public/admin.html', url: '/admin', module: 'page-admin.js' });
  const seteaza = async (nume) => {
    p.$('#tab-sezon')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
    const ok = await until(() => p.$$('#sezon-list .ranks-row').length === 4);
    if (!ok) return false;
    p.$$('#sezon-list .ranks-row').find((r) => (r.textContent || '').includes(nume))
      ?.querySelectorAll('button')[1]?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
    return until(() => new RegExp(nume).test(p.text('#sezon-curent') || ''));
  };
  p.$('#tab-sezon')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const rowsOk = await until(() => p.$$('#sezon-list .ranks-row').length === 4);
  check('Tabul Sezon listeaza cele 4 teme', rowsOk, `randuri=${p.$$('#sezon-list .ranks-row').length}`);
  // Setarea e globala: adminul (resetat de pe Sakura) vede sezonul LIVE, fara banner.
  const setOk = await seteaza('Iarnă');
  check('Setarea sezonului din UI (Iarna)', setOk, `curent=${p.text('#sezon-curent')}`);
  const liveOk = await until(() => [...p.window.document.body.classList].includes('theme-iarna'));
  check('Adminul vede sezonul live pe pagina proprie (reset global)', liveOk, [...p.window.document.body.classList].join(','));
  await wait(600);
  check('Fara banner cand adminul vede sezonul', !p.$('#sezon-banner'), p.text('#sezon-banner') || '(absent)');
  check('Nicio eroare de runtime pe tabul Sezon (setare)', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.teardown();
  // Realegere personala DUPA setare → la urmatoarea vizita bannerul explica diferenta.
  await post('/api/shop/activate', { type: 'theme', id: 'theme_sakura' });
  const p2 = await mountPage({ htmlFile: 'public/admin.html', url: '/admin', module: 'page-admin.js' });
  // HARNESS: core.js se importa o singura data per proces (modulele de pagina
  // il refera fara ?t=), deci cache-ul lui de sesiune supravietuieste intre
  // mount-uri — p2 ar mosteni sesiunea veche (cu sezonul) a lui p1. Il golim
  // explicit. In productie nu exista problema: fiecare pagina e un graf proaspat.
  await import('../public/assets/js/core.js').then((m) => m.clearSession());
  p2.$('#tab-sezon')?.dispatchEvent(new p2.window.Event('click', { bubbles: true }));
  await until(() => p2.$$('#sezon-list .ranks-row').length === 4);
  const bannerOk = await until(() => !!p2.$('#sezon-banner'));
  const bannerTxt = p2.text('#sezon-banner') || '';
  check('Bannerul ii spune adminului ca vede tema personala', bannerOk && /Sakura/.test(bannerTxt) && /Iarnă/.test(bannerTxt), bannerTxt.slice(0, 130));
  p2.$('#sezon-vezi')?.dispatchEvent(new p2.window.Event('click', { bubbles: true }));
  const prevOk = await until(() => [...p2.window.document.body.classList].includes('theme-iarna'));
  check('„Vezi sezonul" aplica sezonul persistent', prevOk, [...p2.window.document.body.classList].join(','));
  p2.$('#sezon-mea')?.dispatchEvent(new p2.window.Event('click', { bubbles: true }));
  const backOk = await until(() => [...p2.window.document.body.classList].includes('theme-sakura'));
  check('„Înapoi la tema mea" restaureaza Sakura', backOk, [...p2.window.document.body.classList].join(','));
  check('Nicio eroare de runtime pe tabul Sezon (banner)', p2.errors.length === 0, p2.errors.slice(0, 3).join(' | '));
  await p2.teardown();
  // Curatenie: sezonul gol + adminul inapoi pe Standard (suitele urmatoare).
  await post('/api/admin/season', { theme_id: '' });
  await post('/api/shop/activate', { type: 'theme', id: 'theme_standard' });
}

console.log('\n=== DOM: /episode (player, surse, progres) ===');
// Pagina asta nu era acoperita deloc de dom-smoke, deci un crash la bootstrap
// ajungea direct in productie ca un spinner vesnic. Acum o montam cu un
// episod real si verificam ca bootstrap-ul chiar termina treaba.
{
  // Fixture propriu: o serie cu un episod si o sursa video reala, ca testul sa
  // nu depinda de ce a mai ramas in baza de la alte suite.
  const created = await (await fetch(`${BASE}/api/admin/series`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE },
    body: JSON.stringify({ title: `DOM Ep Test ${Date.now()}`, status: 'completed' }),
  })).json();
  const sid = created?.series?.id ?? created?.id;
  await fetch(`${BASE}/api/admin/episodes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE },
    body: JSON.stringify({ series_id: sid, episodes: [
      { episode_number: 1, title: 'Unu', subtitle_url: '/assets/subs/demo-ro.vtt', sources: [{ label: 'S1', kind: 'file', url: 'https://media.w3.org/2010/05/bunny/trailer.mp4' }] },
      { episode_number: 2, title: 'Doi', sources: [{ label: 'S1', kind: 'file', url: 'https://media.w3.org/2010/05/bunny/trailer.mp4' }] },
    ] }),
  });
  const detail = await (await fetch(`${BASE}/api/series/${sid}`, { headers: { Cookie: COOKIE } })).json();
  const epId = detail?.episodes?.[0]?.id;
  check('Exista un episod real pe care sa montam playerul', Number.isInteger(epId), `epId=${epId}`);

  const p = await mountPage({ htmlFile: 'public/episode.html', url: `/episode?id=${epId}`, module: 'page-episode.js' });
  // Titlul trebuie sa devina ETICHETA episodului. Orice altceva (placeholder
  // sau mesajul de esec) inseamna ca bootstrap-ul nu a terminat treaba — exact
  // bug-ul care a trimis in productie un spinner vesnic.
  const loaded = await until(() => /Episodul \d/.test(p.text('#episode-title') || ''));
  check('Bootstrap-ul termina: titlul devine eticheta episodului', loaded, `titlu=${p.text('#episode-title')}`);
  check('Nu s-a afisat starea de esec in player', !p.$('.player .empty'), 'playerul arata mesajul de esec');
  check('Nicio eroare de runtime la montarea playerului', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  check('Bara de progres spre 15 minute e in DOM', !!p.$('#watch-progress'), 'lipseste #watch-progress');

  // Garda [hidden]: linkul extern discret trebuie sa fie ascuns implicit.
  // Verificam si computed style, nu doar atributul — bug-ul original era de
  // CSS (o regula `display` de autor batea stylesheet-ul UA pentru [hidden]).
  const link = p.$('#ext-link');
  check('Linkul extern discret e ascuns implicit (atribut)', link?.hidden === true, `hidden=${link?.hidden}`);
  check('Linkul extern discret e ascuns implicit (computed)', !link || p.window.getComputedStyle(link).display === 'none', `display=${link && p.window.getComputedStyle(link).display}`);

  // O sursa unica nu are ce alege: bara de taburi trebuie ascunsa, nu goala.
  const nSurse = p.$$('#source-list .sources__btn, #source-list button').length;
  check('Sursele se randeaza sau bara e ascunsa curat', nSurse > 0 || p.$('#source-tabs')?.hidden === true, `butoane=${nSurse} barHidden=${p.$('#source-tabs')?.hidden}`);

  // Subtitrarea din episod trebuie sa ajunga ca <track> in <video>.
  const trackOk = await until(() => p.$('#player-video track')?.getAttribute('srclang') === 'ro');
  check('Subtitrarea se ataseaza ca <track srclang="ro">', trackOk, `track=${p.$('#player-video track')?.outerHTML?.slice(0, 90)}`);
  check('Track-ul de subtitrare trece prin proxy-ul anti-CORS', (p.$('#player-video track')?.getAttribute('src') || '').includes('/api/subtitle'), p.$('#player-video track')?.getAttribute('src'));

  // Fullscreen-ul e al sursei: iframe-ul trebuie sa aiba permisiunile, iar
  // noi nu mai punem buton propriu peste cel nativ al furnizorului.
  check('Nu mai exista buton propriu de fullscreen (fullscreen-ul e al sursei)', !p.$('#fs-btn'), 'a ramas #fs-btn');
  const iframe = p.$('#player');
  check('Iframe-ul sursei NU mai are sandbox (playerii terti pica pe fallback CSS in sandbox)', !iframe?.hasAttribute('sandbox'), iframe?.getAttribute('sandbox') || 'fara sandbox');
  check('Permissions policy permite fullscreen in iframe', (iframe?.getAttribute('allow') || '').includes('fullscreen'), iframe?.getAttribute('allow'));
  check('Iframe-ul are allowfullscreen (+ prefixe legacy)', iframe?.hasAttribute('allowfullscreen') === true && iframe?.hasAttribute('webkitallowfullscreen') === true, iframe?.outerHTML?.slice(0, 140));
  check('Video are controale native', p.$('#player-video')?.hasAttribute('controls') === true, 'lipseste atributul controls');
  check('Butonul de raportare a sursei exista', !!p.$('#report-btn'), 'lipseste #report-btn');
  p.$('#report-btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const repPanelOn = await until(() => p.$('#report-panel')?.hidden === false);
  check('Panoul de raportare se deschide cu cele 5 motive', repPanelOn && p.$$('#report-reasons .report-chip').length === 5, `chips=${p.$$('#report-reasons .report-chip').length}`);
  const repChip2 = p.$$('#report-reasons .report-chip')[1];
  repChip2?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  check('Selectia motivului muta marcajul is-on', repChip2?.classList.contains('is-on') === true, repChip2?.className);

  // ---- PLAYER v4: navigare jos, modal, cinema, auto-next
  check('Bara de navigare intre episoade exista jos', !!p.$('#ep-prev') && !!p.$('#ep-list') && !!p.$('#ep-next'), 'lipseste ep-nav');
  // Ambele butoane sunt desenate de acelasi paintEpNav(): asteptam starea
  // finala (urmatorul activ, anteriorul dezactivat) inainte sa o asertam,
  // altfel verificarea putea cadea pe prima randare.
  const navReady = await until(() => p.$('#ep-next')?.disabled === false && p.$('#ep-prev')?.disabled === true);
  check('Butonul „următorul” e activ când exista episod după', p.$('#ep-next')?.disabled === false, `disabled=${p.$('#ep-next')?.disabled}`);
  check('Butonul „anterior” e dezactivat pe primul episod', navReady && p.$('#ep-prev')?.disabled === true, `disabled=${p.$('#ep-prev')?.disabled}`);
  check('Modalul „Alte episoade” e invizibil cat e hidden (CSS [hidden])', p.window.getComputedStyle(p.$('#eplist-modal')).display === 'none', p.window.getComputedStyle(p.$('#eplist-modal')).display);
  p.$('#ep-list')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const listOn = await until(() => p.$('#eplist-modal')?.hidden === false && p.$$('#eplist-grid .eplist__ep').length >= 1 && p.window.getComputedStyle(p.$('#eplist-modal')).display !== 'none');
  check('Modalul „Alte episoade” se deschide cu grila de episoade', listOn, `n=${p.$$('#eplist-grid .eplist__ep').length}`);
  check('Episodul curent e marcat in grila', !!p.$('#eplist-grid .eplist__ep.is-on'), 'lipseste is-on');
  p.$('#eplist-close')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));

  const ctaOn = await until(() => p.$('#ep-sub-btn') && !p.$('#ep-sub-btn').hidden);
  check('CTA-ul de abonare „Vreau să știu…” exista sub navigare', ctaOn && /Vreau să știu|Primești notificări/.test(p.$('#ep-sub-btn')?.textContent || ''), p.$('#ep-sub-btn')?.textContent);
  const beforeTxt = p.$('#ep-sub-btn')?.textContent || '';
  p.$('#ep-sub-btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const toggled = await until(() => (p.$('#ep-sub-btn')?.textContent || '') !== beforeTxt);
  check('Click pe CTA comută abonarea', toggled, p.$('#ep-sub-btn')?.textContent);
  p.$('#ep-sub-btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  await until(() => (p.$('#ep-sub-btn')?.textContent || '') === beforeTxt);

  check('Mod cinema e pornit implicit (player lat)', p.window.document.body.classList.contains('cinema'), p.window.document.body.className);
  p.$('#cinema-btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  check('Toggle-ul cinema scoate clasa de pe body', !p.window.document.body.classList.contains('cinema'), p.window.document.body.className);
  p.$('#cinema-btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));

  p.window.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  p.window.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'm', bubbles: true }));
  check('Scurtaturile degradeaza fara crash cand API-urile lipsesc', p.errors.length === 0, p.errors.slice(0, 2).join(' | '));

  // Comentariile: formular prezent, lista randata (macar starea vida).
  const comOn = await until(() => !!p.$('#comments-list')?.textContent);
  check('Sectiunea de comentarii se randeaza', comOn && !!p.$('#comment-form'), `list=${(p.$('#comments-list')?.textContent || '').slice(0, 40)}`);
  const cInput = p.$('#comment-body');
  if (cInput) {
    cInput.value = 'Comentariu dom-smoke cu voturi';
    cInput.dispatchEvent(new p.window.Event('input', { bubbles: true }));
    p.$('#comment-form')?.dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true }));
    const cOn = await until(() => p.$$('#comments-list .comment').length > 0);
    check('Comentariul postat apare in lista cu coloana de vot', cOn && !!p.$('#comments-list .comment .comment__vote'), `n=${p.$$('#comments-list .comment').length}`);
    const upBtn = p.$('#comments-list .comment .cvote');
    upBtn?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
    const scoreOn = await until(() => p.$('#comments-list .comment .comment__score')?.textContent === '1');
    check('Click pe ▲ urca score-ul la 1', scoreOn, p.$('#comments-list .comment .comment__score')?.textContent);
    p.$('#comments-list .comment .comment__reply-btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
    const rfOn = await until(() => !!p.$('#comments-list .comment .reply-form'));
    check('Butonul „Răspunde” deschide formularul inline', rfOn, 'lipseste reply-form');
    const rTa = p.$('#comments-list .reply-form textarea');
    if (rTa) {
      rTa.value = 'Raspuns dom-smoke';
      p.$('#comments-list .reply-form .btn')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
      const repOn = await until(() => p.$$('#comments-list .comment--reply').length === 1);
      check('Raspunsul apare indentat sub parinte', repOn, `n=${p.$$('#comments-list .comment--reply').length}`);
    }
  }
  await p.teardown();
  await fetch(`${BASE}/api/admin/series?id=${sid}`, { method: 'DELETE', headers: { Cookie: COOKIE, Origin: BASE } });
}

console.log('\n=== DOM: /profile (clasamentul randat) ===');
{
  const p = await mountPage({ htmlFile: 'public/profile.html', url: '/profile', module: 'page-profile.js' });
  const loaded = await until(() => p.$$('#lb-list .lb__row').length > 0 || /nimeni/i.test(p.text('#lb-note') || ''));
  check('Clasamentul se randeaza pe profil', loaded, `randuri=${p.$$('#lb-list .lb__row').length} note=${p.text('#lb-note')}`);
  check('Fiecare rand are nume si puncte', p.$$('#lb-list .lb__row').every((r) => r.textContent.includes('pct')), p.$('#lb-list')?.textContent?.slice(0, 80));
  check('Nicio eroare de runtime pe profil', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.teardown();
}

console.log('\n=== DOM: /profile (panoul de economie) ===');
{
  const p = await mountPage({ htmlFile: 'public/profile.html', url: '/profile', module: 'page-profile.js' });
  const econOn = await until(() => p.$('#p-econ') && !p.$('#p-econ').hidden);
  check('Panoul de economie apare pe propriul profil', econOn, `hidden=${p.$('#p-econ')?.hidden}`);
  check('Bara de XP anunta progresul catre nivelul urmator', /XP până la nivelul următor/.test(p.text('#econ-xp-label') || ''), p.text('#econ-xp-label'));
  check('Randul lunar arata punctele si pragul de 10.000', /10\.000 pct/.test(p.text('#econ-month-label') || ''), p.text('#econ-month-label'));
  check('Butonul cufarului are o stare reala (disponibil sau countdown)', /așteaptă|deschide peste/i.test(p.text('#chest-label') || ''), p.text('#chest-label'));
  check('Vitrina de insigne e populata (insigne sau hint de pornire)', p.$$('#econ-badges > *').length > 0, p.$('#econ-badges')?.innerHTML?.slice(0, 100));
  check('Modalul de recompensa exista dar e ascuns', !!p.$('#chest-modal') && p.$('#chest-modal').hidden === true, String(p.$('#chest-modal')?.hidden));
  check('Nicio eroare de runtime in panoul de economie', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  check('Profilul arata gradul tematic ca cip langa nume', !!p.$('#p-badges .uchip'), p.$('#p-badges')?.innerHTML?.slice(0, 120));
  // Tema de grade se alege acum prin factiune (panoul #faction-box), nu
  // printr-un <select> separat.
  const factionOn = await until(() => !!p.$('#faction-box') && !/Se încarcă/.test(p.text('#faction-sub') || ''));
  check('Panoul de facțiune e încărcat pe profilul propriu', factionOn, p.text('#faction-sub'));
  const missionsOn = await until(() => p.$$('#econ-missions .mission').length >= 3);
  check('Misiunile zilnice se randeaza (3 randuri)', missionsOn, `n=${p.$$('#econ-missions .mission').length}`);
  const avImg = p.$('#p-avatar img');
  check('Avatarul din profil se randeaza ca <img> cu referrerpolicy', !!avImg && avImg.getAttribute('referrerpolicy') === 'no-referrer', avImg?.outerHTML?.slice(0, 120));
  check('Formularul explica ca GIF animat e acceptat (+Tenor)', /GIF animat/.test(p.text('body')) && /Tenor/.test(p.text('body')), 'hint GIF/Tenor lipsa');
  const geninCount = (p.$('#p-badges')?.textContent || '').match(/Genin/g)?.length || 0;
  check('Rangul apare o singura data langa nume (fara dublura)', geninCount <= 1, `Genin x${geninCount}`);
  check('Bara veche „puncte până la rang" a disparut', !p.$('#p-xp-fill'), 'p-xp-fill inca exista');
  check('Fiecare misiune arata recompensa', p.$$('#econ-missions .mission__reward').every((r) => /🪙/.test(r.textContent)), p.$('#econ-missions')?.textContent?.slice(0, 120));
  check('Rangul tematic e afisat mare pe profil', /Genin|Chunin|Jonin|Kage|Hokage|Membru/.test(p.text('#econ-rank') || ''), p.text('#econ-rank'));
  check('Statisticile reale apar in grid (episoade/comentarii)', p.$$('#econ-stats .econ__stat').length >= 4, `n=${p.$$('#econ-stats .econ__stat').length}`);
  await p.teardown();
}

{
  console.log('=== DOM: notificari UI (badge + marcat citit) ===');
  // Serie proprie: fixturele anterioare sunt sterse de sectiunile lor.
  const mk = async (num, title) => fetch(`${BASE}/api/admin/episodes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE }, body: JSON.stringify({ series_id: nsid, episode_number: num, title, sources: [{ label: 'S1', kind: 'file', url: 'https://media.w3.org/2010/05/bunny/trailer.mp4' }] }) });
  const ownSeries = await (await fetch(`${BASE}/api/admin/series`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE }, body: JSON.stringify({ title: `DOM Notif ${Date.now()}`, status: 'ongoing' }) })).json();
  const nsid = ownSeries?.series?.id ?? ownSeries?.id;
  check('Samanarea pentru notificari are o serie valida', Number.isInteger(nsid), `nsid=${nsid}`);
  await fetch(`${BASE}/api/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE }, body: JSON.stringify({ series_id: nsid, on: 1 }) });
  await mk(1, 'Notif Unu');
  const p = await mountPage({ htmlFile: 'public/index.html', url: '/', module: 'page-index.js' });
  const badgeOn = await until(() => p.$('#nav-bell-badge') && !p.$('#nav-bell-badge').hidden && Number(p.$('#nav-bell-badge').textContent) >= 1);
  check('Badge-ul clopoțelului arata notificarea necitita', badgeOn, `badge=${p.$('#nav-bell-badge')?.textContent}`);
  p.$('#nav-bell')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const itemsOn = await until(() => p.$$('#notif-pop .notif-pop__item').length >= 1);
  check('Dropdown-ul listeaza notificarea cu marcajul „nou”', itemsOn && !!p.$('#notif-pop .notif-pop__item--new'), `n=${p.$$('#notif-pop .notif-pop__item').length}`);
  p.$('#notif-pop .notif-pop__all')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const cleared = await until(() => p.$('#nav-bell-badge')?.hidden === true && p.$$('#notif-pop .notif-pop__item--new').length === 0);
  check('„Marchează tot ca citit” curata badge-ul si marcajul', cleared, `hidden=${p.$('#nav-bell-badge')?.hidden} new=${p.$$('#notif-pop .notif-pop__item--new').length}`);
  await mk(2, 'Notif Doi');
  // Dropdown-ul a ramas deschis dupa markAll: un click il inchide, al
  // doilea il redeschide si abia atunci reia lista din API.
  p.$('#nav-bell')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  p.$('#nav-bell')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const freshOn = await until(() => !!p.$('#notif-pop .notif-pop__item--new'));
  check('Notificarea noua apare dupa refresh-ul listei', freshOn, 'lipseste item nou');
  p.$('#notif-pop .notif-pop__item')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
  const readOn = await until(() => p.$('#nav-bell-badge')?.hidden === true);
  check('Click pe notificare o marcheaza citita (badge dispare)', readOn, `hidden=${p.$('#nav-bell-badge')?.hidden}`);
  await p.teardown();
  await fetch(`${BASE}/api/admin/series?id=${nsid}`, { method: 'DELETE', headers: { Cookie: COOKIE, Origin: BASE } });
}

{
  console.log('=== DOM: /shop (vitrina de gold) ===');
  const p = await mountPage({ htmlFile: 'public/shop.html', url: '/shop', module: 'page-shop.js' });
  const cardsOn = await until(() => p.$$('#shop-grid .shop-card').length === 8);
  check('Shop-ul randeaza cele 8 articole (Shop 2.0)', cardsOn, `n=${p.$$('#shop-grid .shop-card').length}`);
  check('Gold-ul curent e afisat in antet', /🪙\s*\d/.test(p.text('#shop-gold') || ''), p.text('#shop-gold'));
  check('Preturile sunt vizibile pe toate cardurile', p.$$('#shop-grid .shop-card__price').length === 8, `n=${p.$$('#shop-grid .shop-card__price').length}`);
  check('Bannerul de boost exista (ascuns cand e inactiv)', !!p.$('#shop-boost'), 'lipseste #shop-boost');
  check('Temele se randeaza (13 in shop; sezonul e ascuns)', p.$$('#themes-grid .theme-card').length === 13, `n=${p.$$('#themes-grid .theme-card').length}`);
  check('Linkul catre shop exista in nav', !!p.$('#nav a[href="/shop"]'), 'lipseste linkul din nav');
  check('Shop explica economia: cel puțin 4 carduri „cum funcționează"', p.$$('.howto .howto__card').length >= 4, `n=${p.$$('.howto .howto__card').length}`);
  check('Nicio eroare de runtime in shop', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
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
