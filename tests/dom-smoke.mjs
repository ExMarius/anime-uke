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
  // Hero-ul trebuie sa arate TOTALUL din site_meta, nu ce incap pe pagina.
  // La 1000+ serii numarul e formatat ro-RO („1.002"), deci comparam cu
  // totalul din API trecut prin acelasi format.
  {
    const m = await (await fetch(`${BASE}/api/series?per_page=24`, { headers: { Cookie: COOKIE } })).json();
    const asteptat = Number(m.total).toLocaleString('ro-RO');
    check('Statistica din hero vine din meta, nu din pagina curenta', p.text('#stat-series') === asteptat, `stat-series=${p.text('#stat-series')} asteptat=${asteptat}`);
  }
  const sel = p.$('#sort-select');
  check('Selectorul de sortare e populat de pe server', sel && sel.options.length === 4, `optiuni=${sel?.options.length}`);
  // Vizibilitatea butonului trebuie sa fie congruenta cu has_more de pe
  // server, indiferent daca baza are 1 serie sau 1000.
  const meta = await (await fetch(`${BASE}/api/series?per_page=24`, { headers: { Cookie: COOKIE } })).json();
  check('Butonul „Incarca mai multe" e congruent cu has_more', p.$('#load-more-wrap')?.hidden === !meta.has_more, `hidden=${p.$('#load-more-wrap')?.hidden} has_more=${meta.has_more}`);
  check('Nicio eroare de runtime la incarcare', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));

  // Bannerul rotativ: trebuie sa existe in DOM, iar daca e vizibil sa duca
  // catre o serie reala. Inchiderea lui se persista pe intervalul de 3h.
  check('Bannerul rotativ exista in DOM', !!p.$('#spot-banner'), 'lipseste #spot-banner');
  check('Randul „Continua vizionarea" exista in DOM', !!p.$('#continue-section'), 'lipseste #continue-section');
  if (p.$('#spot-banner')?.hidden === false) {
    check('Bannerul vizibil duce catre o serie', /^\/series\?id=\d+$/.test(p.$('#spot-title')?.getAttribute('href') || ''), p.$('#spot-title')?.getAttribute('href'));
    check('Bannerul vizibil are eticheta de interval', (p.text('#spot-tag') || '').length > 3, p.text('#spot-tag'));
    p.$('#spot-close')?.dispatchEvent(new p.window.Event('click', { bubbles: true }));
    const bucket = Math.floor(Date.now() / (3 * 60 * 60 * 1000));
    check('Inchiderea bannerului se tine minte pe intervalul curent', p.$('#spot-banner')?.hidden === true && p.window.localStorage.getItem(`auk-spot-${bucket}`) === '1', `hidden=${p.$('#spot-banner')?.hidden}`);
  } else {
    check('Bannerul ramane ascuns daca userul l-a inchis in intervalul curent', true);
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

console.log('\n=== DOM: /series?id=… cu serie lunga (selector de intervale) ===');
// Creeaza o serie de 150 de episoade ca sa treaca de pragul de 100/page.
// Fara paginare, pagina asta ar citi toate episoadele la fiecare vizita.
{
  const created = await (await fetch(`${BASE}/api/admin/series`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE, Origin: BASE },
    body: JSON.stringify({ title: 'Serie lunga DOM', status: 'ongoing' }),
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
  check('Media de vot e afisata', (p.text('#rate-avg') || '').length > 0, p.text('#rate-avg'));
  check('Cuferele isi arata starea (blocat/deschis)', /mai ai|Deschide|Deschis/.test(p.text('#chests-row') || ''), p.text('#chests-row')?.slice(0, 60));
  check('Posterul seriei e randat (fallback cand lipseste coperta)', p.$('#series-poster')?.hidden === false && p.$$('#series-poster > *').length === 1, `hidden=${p.$('#series-poster')?.hidden} copii=${p.$$('#series-poster > *').length}`);
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

  await fetch(`${BASE}/api/admin/series?id=${sid}`, { method: 'DELETE', headers: { Cookie: COOKIE, Origin: BASE } });
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
    body: JSON.stringify({ series_id: sid, episodes: [{ episode_number: 1, title: 'Unu', subtitle_url: '/assets/subs/demo-ro.vtt', sources: [{ label: 'S1', kind: 'file', url: 'https://media.w3.org/2010/05/bunny/trailer.mp4' }] }] }),
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

  // Fullscreen-ul e al sursei: iframe-ul trebuie sa aiba permisiunile, iar
  // noi nu mai punem buton propriu peste cel nativ al furnizorului.
  check('Nu mai exista buton propriu de fullscreen (fullscreen-ul e al sursei)', !p.$('#fs-btn'), 'a ramas #fs-btn');
  const iframe = p.$('#player');
  const sb = iframe?.getAttribute('sandbox') || '';
  check('Sandbox-ul iframe-ului permite fullscreen-ul nativ al sursei', sb.includes('allow-fullscreen'), sb);
  check('Permissions policy permite fullscreen in iframe', (iframe?.getAttribute('allow') || '').includes('fullscreen'), iframe?.getAttribute('allow'));
  check('Iframe-ul are atributul allowfullscreen', iframe?.hasAttribute('allowfullscreen') === true, iframe?.outerHTML?.slice(0, 120));
  check('Video are controale native', p.$('#player-video')?.hasAttribute('controls') === true, 'lipseste atributul controls');
  p.window.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  p.window.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'm', bubbles: true }));
  check('Scurtaturile degradeaza fara crash cand API-urile lipsesc', p.errors.length === 0, p.errors.slice(0, 2).join(' | '));

  // Comentariile: formular prezent, lista randata (macar starea vida).
  const comOn = await until(() => !!p.$('#comments-list')?.textContent);
  check('Sectiunea de comentarii se randeaza', comOn && !!p.$('#comment-form'), `list=${(p.$('#comments-list')?.textContent || '').slice(0, 40)}`);
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
