import { api, renderNav, toast, getSession, safeUrl, coverImg, optimizeCover, genPoster , whenActive, countUp, onPulse, observeReveals, relativeTime, startGuestNudge, claimPulse, pushPulse, initChat, openChat } from './core.js';

// Pagina principala: hero + cautare pe SERVER + grila de serii + chat.
//
// Inainte se incarcau toate seriile odata (pana la 500) si se filtrau in
// browser. La 1000+ serii asta se rupea: API-ul se oprea la 500, deci
// jumatate din catalog era invizibil, si fiecare vizita citea sute de
// randuri din D1. Acum cerem cate o pagina si cautarea se face pe server.

const PER_PAGE = 24;

// ---------------------------------------------------------------------
// PRIMA PAGINĂ = O SINGURĂ CERERE
//
// Înainte, ca să se încarce prima pagină, browserul cheltuia 5 invocări de
// Worker: /series, /top, /recent, /genres și /pulse. Cota gratuită e de
// 100.000 de invocări pe zi, iar prima pagină e cea mai vizitată — deci
// conta de 5 ori. Toate vin acum din /api/home (un singur apel), iar datele
// de „pulse" sunt publicate direct în nav, fără /api/pulse separat.
// ---------------------------------------------------------------------
let homePromise = null;

function homeData() {
  if (!homePromise) {
    homePromise = api('/home')
      .then((res) => {
        if (!res.ok) {
          return { ok: false, error: res.data?.error || 'Nu am putut încărca seriile' };
        }
        pushPulse(res.data.pulse);
        return { ok: true, data: res.data };
      })
      .catch(() => ({ ok: false, error: 'Eroare de rețea' }));
  }
  return homePromise;
}

claimPulse();


let allSeries = [];      // seriile incarcate pana acum (toate paginile)
let page = 1;
let query = '';
let sort = 'latest';
let genreFilter = '';
let statusFilter = '';
let sortsLoaded = false;
let searchTimer = null;

// ---------------------------------------------------------------------
// STARE ÎN URL (adăugat 2026-09-24): ?q=naruto&gen=Acțiune&status=ongoing&sort=rating&page=2
//
// De ce: un catalog filtrat trebuie să poată fi trimis cuiva („uite lista de
// acțiune în difuzare") și să supraviețuiască unui reload sau unui share pe
// telefon. Înainte, filtrele trăiau doar în memorie: linkul era mereu „/", iar
// butonul Înapoi al browserului ieșea de pe site în loc să scoată filtrul.
//
// Fiecare schimbare a filtrelor scrie URL-ul cu pushState (o intrare nouă în
// istoric, ca „Înapoi" să scoată filtrul), iar popstate re-citește URL-ul și
// reîncarcă lista. La încărcarea paginii, filtrele vin din URL.
// ---------------------------------------------------------------------
function readUrlState() {
  const p = new URLSearchParams(location.search);
  query = (p.get('q') || '').trim().slice(0, 60);
  genreFilter = (p.get('gen') || '').trim().slice(0, 40);
  statusFilter = ['ongoing', 'completed'].includes(p.get('status')) ? p.get('status') : '';
  const s = p.get('sort');
  sort = ['latest', 'oldest', 'title', 'episodes', 'rating'].includes(s) ? s : 'latest';
  const n = Number(p.get('page'));
  page = Number.isInteger(n) && n > 0 ? n : 1;
}

/** Scrie starea curenta in URL (fara sa reincarce pagina). */
function writeUrlState({ push = true } = {}) {
  const p = new URLSearchParams();
  if (query) p.set('q', query);
  if (genreFilter) p.set('gen', genreFilter);
  if (statusFilter) p.set('status', statusFilter);
  if (sort !== 'latest') p.set('sort', sort);
  if (page > 1) p.set('page', String(page));
  const qs = p.toString();
  const url = qs ? `?${qs}` : location.pathname;
  try {
    if (push) history.pushState({ catalog: true }, '', url);
    else history.replaceState({ catalog: true }, '', url);
  } catch { /* mod privat / file:// — filtrele merg in continuare, doar fara URL */ }
}

/** Un singur punct de intrare pentru orice schimbare de filtru. */
function applyFilters({ reload = true } = {}) {
  const gsel = document.getElementById('genre-select');
  const ssel = document.getElementById('status-select');
  const reset = document.getElementById('filter-reset');
  if (gsel) gsel.value = genreFilter;
  if (ssel) ssel.value = statusFilter;
  if (reset) reset.hidden = !genreFilter && !statusFilter;
  const inp = document.getElementById('search-input');
  if (inp && inp.value !== query) inp.value = query;
  const sortSel = document.getElementById('sort-select');
  if (sortSel && sortSel.value !== sort) sortSel.value = sort;
  writeUrlState();
  if (reload) load();
}

// ---------------- skeleton loading ----------------
function skeletons(n = 10) {
  const grid = document.getElementById('series-grid');
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'sk sk-card';
    el.innerHTML = '<div class="sk sk-poster"></div><div class="sk sk-line"></div><div class="sk sk-line sk-line--s"></div>';
    grid.appendChild(el);
  }
}

function emptyState(text, sub = '') {
  const el = document.createElement('div');
  el.className = 'empty';
  el.style.gridColumn = '1 / -1';
  const icon = document.createElement('div');
  icon.className = 'empty__icon';
  icon.textContent = '🎬';
  const t = document.createElement('div');
  t.textContent = text;
  el.append(icon, t);
  if (sub) {
    const s = document.createElement('p');
    s.className = 'hint';
    s.textContent = sub;
    el.appendChild(s);
  }
  return el;
}

// ---------------- card ----------------
function seriesCard(s, idx = 0) {
  const a = document.createElement('a');
  a.className = 'card rv';
  a.style.setProperty('--rv-delay', `${Math.min(idx, 11) * 40}ms`);
  a.href = `/series?id=${encodeURIComponent(s.id)}`;

  const poster = document.createElement('div');
  poster.className = 'poster';

  if (s.cover_image) {
    const img = coverImg(s.cover_image, {
      w: 400, widths: [200, 300, 400],
      sizes: '(min-width: 640px) 184px, 142px',
      alt: s.title || 'Poster',
    });
    img.addEventListener('error', () => img.replaceWith(fallback(s.title)), { once: true });
    poster.appendChild(img);
  } else {
    poster.appendChild(fallback(s.title));
  }

  // Doar RO SUB + numărul de episoade rămân PE poster (colțuri opuse, fără
  // suprapunere). Starea (În difuzare/Finalizat) e în rândul de meta, sub
  // titlu — înainte stătea peste eticheta RO SUB (aceeași colț stânga-sus).
  const ro = document.createElement('span');
  ro.className = 'pill-ro';
  ro.textContent = 'RO SUB';
  poster.appendChild(ro);

  const count = document.createElement('span');
  count.className = 'pill-count';
  count.textContent = `${s.episode_count ?? 0} EP`;
  poster.appendChild(count);

  const body = document.createElement('div');
  body.className = 'card__body';

  const title = document.createElement('h3');
  title.className = 'card__title';
  title.textContent = s.title || 'Fără titlu';
  body.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'card__meta';
  const status = document.createElement('span');
  status.className = `pill-pos${s.status === 'completed' ? ' pill-pos--ok' : ''}`;
  status.textContent = s.status === 'completed' ? 'Finalizat' : 'În difuzare';
  meta.appendChild(status);
  const bits = [];
  if (s.genre) bits.push(s.genre.split(',')[0].trim());
  if (s.year) bits.push(String(s.year));
  if (bits.length) {
    const m = document.createElement('i');
    m.textContent = bits.join(' · ');
    meta.appendChild(m);
  }
  // Nota comunitatii, cand exista: „★ 8.7" + numarul de voturi in tooltip.
  // Vine in acelasi raspuns de catalog (coloane denormalizate pe serie), deci
  // nu costa o cerere in plus — vezi comentariul din src/routes/api/series.js.
  const votes = Number(s.rating_count) || 0;
  if (votes > 0) {
    const r = document.createElement('span');
    r.className = 'badge-rating';
    r.textContent = `★ ${(Number(s.rating_avg) || 0).toFixed(1)}`;
    r.title = `${votes} ${votes === 1 ? 'vot' : 'voturi'} de la comunitate`;
    meta.appendChild(r);
  }
  body.appendChild(meta);

  if (s.description) {
    const desc = document.createElement('p');
    desc.className = 'card__desc';
    desc.textContent = s.description;
    body.appendChild(desc);
  }

  a.append(poster, body);
  return a;
}

function fallback(title) {
  return genPoster(title);
}

// ---------------- render + cautare ----------------
/** Reseteaza grila si afiseaza tot ce am incarcat pana acum. */
function render() {
  const grid = document.getElementById('series-grid');
  const count = document.getElementById('series-count');
  grid.innerHTML = '';

  if (!allSeries.length) {
    grid.appendChild(emptyState(
      query ? 'Nicio potrivire' : 'Încă nu există serii',
      query ? 'Încearcă alt termen de căutare.' : 'Adaugă prima serie din panoul de administrare.'
    ));
    count.textContent = query ? '0 rezultate' : '';
    return;
  }
  count.textContent = `${allSeries.length} afișate`;
  let idx = 0;
  for (const s of allSeries) grid.appendChild(seriesCard(s, idx++));
  observeReveals(grid);
}

function fillSorts(sorts) {
  if (sortsLoaded) return;
  const sel = document.getElementById('sort-select');
  if (!sel || !sorts?.length) return;
  sel.innerHTML = '';
  for (const o of sorts) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = sort;
  sortsLoaded = true;
}

function setHeroStats(data) {
  const total = data.total;
  const eps = data.total_episodes;
  if (!query && total != null) countUp(document.getElementById('stat-series'), total);
  if (!query && eps != null) countUp(document.getElementById('stat-episodes'), eps);
}

// Vizionările totale și „online acum” vin din /api/pulse (cache 5 min pe
// server). countUp le face să „alerge” la încărcare — semnul site-ului viu.
onPulse((p) => {
  countUp(document.getElementById('stat-views'), p.views);
  const fo = document.getElementById('footer-online');
  if (fo) fo.textContent = String(p.online || 0);
  const fv = document.getElementById('footer-views');
  if (fv) fv.textContent = (p.views || 0).toLocaleString('ro-RO');
});

// ---------------- incarcare ----------------
/**
 * @param {boolean} append  true = adauga pagina la ce e deja afisat
 */
// ---------------------------------------------------------------------
// FILTRE DE CATALOG (gen + status) — modelul site-urilor de anime.
// Schimbarea unui filtru readuce pagina 1 cu noul set de parametri.
// ---------------------------------------------------------------------
function initCatalogFilters() {
  const gsel = document.getElementById('genre-select');
  const ssel = document.getElementById('status-select');
  const reset = document.getElementById('filter-reset');
  if (!gsel || !ssel || !reset) return;

  // Genurile vin o singura data, din cache-ul serverului (10 min) — deja
  // incluse in raspunsul primei pagini (/api/home).
  homeData().then((home) => {
    if (!home.ok || !home.data.genres?.length) return;
    for (const g of home.data.genres) {
      const o = document.createElement('option');
      o.value = g;
      o.textContent = g;
      gsel.appendChild(o);
    }
  }).catch(() => { /* filtrele rămân cu opțiunea „Toate genurile" */ });

  const apply = () => {
    genreFilter = gsel.value;
    statusFilter = ssel.value;
    page = 1;
    applyFilters();
  };
  gsel.addEventListener('change', apply);
  ssel.addEventListener('change', apply);
  reset.addEventListener('click', () => {
    genreFilter = '';
    statusFilter = '';
    applyFilters();
  });
  // Genurile vin asincron: daca URL-ul cere un gen, selectia se face dupa ce
  // opțiunile exista. Iar daca genul cerut NU e in listă (link vechi, un gen
  // ieșit din top 40, sau lista încă neîncărcată), îl adăugam noi ca opțiune:
  // serverul aplică filtrul oricum, deci <select>-ul nu are voie să pară gol
  // și să sugereze că filtrul nu există.
  homeData().then(() => {
    if (!genreFilter) return;
    if (![...gsel.options].some((o) => o.value === genreFilter)) {
      const o = document.createElement('option');
      o.value = genreFilter;
      o.textContent = genreFilter;
      gsel.appendChild(o);
    }
    gsel.value = genreFilter;
  }).catch(() => { /* filtrul rămâne scris în URL, doar selectia nu se aplica */ });
}

// ---------------------------------------------------------------------
// ULTIMELE EPISOADE — secțiunea clasică a site-urilor de anime.
// Publică, din cache-ul serverului (60s), zero citiri în plus pe D1.
// ---------------------------------------------------------------------
async function loadRecent() {
  const section = document.getElementById('recent-section');
  const row = document.getElementById('recent-row');
  if (!section || !row) return;

  const home = await homeData();
  const items = home.ok ? home.data.recent || [] : [];
  if (!items.length) { section.hidden = true; return; }

  row.innerHTML = '';
  for (const it of items) {
    const a = document.createElement('a');
    a.className = 'recent-card rv';
    a.href = `/episode?id=${encodeURIComponent(it.id)}`;

    const art = document.createElement('div');
    art.className = 'recent-card__art';
    if (it.cover_image) {
      const img = coverImg(it.cover_image, {
        w: 400, widths: [200, 300, 400],
        sizes: '(min-width: 900px) 180px, 45vw',
      });
      art.appendChild(img);
    } else {
      art.appendChild(genPoster(it.series_title));
    }
    const ep = document.createElement('span');
    ep.className = 'recent-card__ep';
    ep.textContent = `EP ${it.episode_number}`;
    art.appendChild(ep);
    a.appendChild(art);

    const t = document.createElement('p');
    t.className = 'recent-card__title';
    t.textContent = it.series_title || 'Fără titlu';
    a.appendChild(t);

    row.appendChild(a);
  }
  section.hidden = false;
  observeReveals(row);
}



async function load({ append = false, silent = false } = {}) {
  const grid = document.getElementById('series-grid');
  if (!append && !silent) skeletons(Math.min(PER_PAGE, 10));

  const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), sort });
  if (query) params.set('q', query);
  if (genreFilter) params.set('gen', genreFilter);
  if (statusFilter) params.set('status', statusFilter);

  // Catalogul implicit (pagina 1, fără căutare/filtre) e deja în răspunsul
  // primei pagini → îl refolosim. Pentru „încarcă mai multe", căutare și
  // filtre cerem în continuare /api/series cu parametrii potriviți.
  const useHome = !append && !query && !genreFilter && !statusFilter && page === 1 && sort === 'latest';

  let data = null;
  let errText = '';
  if (useHome) {
    const home = await homeData();
    if (home.ok) data = home.data.series;
    else errText = home.error;
  } else {
    const res = await api(`/series?${params}`);
    if (res.ok) data = res.data;
    else errText = res.data?.error || 'Eroare la încărcarea seriilor';
  }

  if (!data) {
    if (!append) {
      grid.innerHTML = '';
      grid.appendChild(emptyState('Nu am putut încărca seriile', errText || 'Verifică conexiunea și reîncearcă.'));
      document.getElementById('series-count').textContent = '';
    }
    toast(errText || 'Eroare la încărcarea seriilor', 'err');
    return;
  }
  fillSorts(data.sorts);

  if (!append) {
    allSeries = data.series || [];
  } else {
    // Apararea impotriva duplicatelor: daca intre doua cereri a fost adaugata
    // o serie noua, paginarea se decaleaza si am putea primi acelasi rand de
    // doua ori. Filtram dupa id.
    const have = new Set(allSeries.map((s) => s.id));
    for (const s of data.series || []) if (!have.has(s.id)) allSeries.push(s);
  }

  render();
  setHeroStats(data);

  const wrap = document.getElementById('load-more-wrap');
  const btn = document.getElementById('load-more');
  wrap.hidden = !data.has_more;
  btn.disabled = false;
  btn.textContent = data.total != null
    ? `Încarcă mai multe (${allSeries.length} din ${data.total}${data.total_capped ? '+' : ''})`
    : 'Încarcă mai multe';

  if (!append) {
    const user = await getSession();
    document.getElementById('stat-points').textContent = user ? user.points : '0';
  }
}

/** Cautarea se face pe server, deci resetam paginarea la fiecare termen nou. */
function search(q) {
  query = q.trim();
  page = 1;
  // Cautarea scrie si ea URL-ul: „/?q=naruto" e un link care merge trimis.
  // replaceState, nu pushState: search() ruleaza la fiecare tasta (debounce
  // 180 ms), iar 10 litere ar insemna 10 intrari in istoric — butonul Înapoi
  // ar scoate litera cu litera.
  writeUrlState({ push: false });
  load();
}

// Hero banner: arta anime full-bleed sus de tot. Fereastra de 3 ore e
// comuna tuturor (recomandare editoriala), iar butonul „Alt anime” adauga
// un salt aleator per vizita peste bucket, ca sa poti da mai departe pana
// gasesti ceva pe placul tau. Alegerea e determinista pe (bucket, salt),
// deci shuffle-ul nu loveste serverul de fiecare data (cache in sessionStorage).
// ---------------------------------------------------------------------
const SPOT_WINDOW_MS = 3 * 60 * 60 * 1000;
const SPOT_TAGS = [
  'Recomandarea intervalului', 'De maratonat diseară', 'Ascunsă în catalog',
  'Alegerea comunității', 'Perla neștiută', 'Revăzut și aprobat',
];

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

function spotSalt() {
  try { return sessionStorage.getItem('auk-spot-salt') || ''; } catch { return ''; }
}

/** Arta de rezervă pentru hero: gradient cinematic din titlu + initiala
 *  mare, ca un poster de anime fără imagine oficială. */
function genHeroArt(title) {
  const t = String(title || '').trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const el = document.createElement('div');
  el.className = 'hban__bg-gen';
  el.style.background = [
    `radial-gradient(120% 90% at 85% 10%, hsl(${hue} 70% 34% / .85), transparent 60%)`,
    `radial-gradient(90% 80% at 10% 90%, hsl(${(hue + 40) % 360} 75% 26% / .9), transparent 65%)`,
    `radial-gradient(60% 60% at 50% 50%, hsl(${(hue + 320) % 360} 60% 18% / .8), transparent 70%)`,
    `linear-gradient(160deg, hsl(${hue} 45% 16%), hsl(${(hue + 300) % 360} 55% 7%))`,
  ].join(', ');
  const kanji = document.createElement('span');
  kanji.className = 'hban__bg-kanji';
  kanji.textContent = (t.split(/\s+/)[0]?.[0] || '鬼').toUpperCase();
  el.appendChild(kanji);
  return el;
}

async function pickSpotSeries(salt) {
  const bucket = Math.floor(Date.now() / SPOT_WINDOW_MS);
  const cacheKey = `auk-spot-data-${bucket}-${salt}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached) return cached;
  } catch { /* ignora */ }

  // Mereu din CELE MAI NOI 24 de serii: orice serie adăugată recent intră
  // automat în rotația bannerului la fereastra următoare (sau la click pe
  // „Alt anime"), fără niciun pas manual.
  // Lista „cele mai noi 24" e exact ce aduce /api/home pentru prima pagină:
  // o refolosim, ca bannerul să nu coste o a doua invocare de Worker.
  const home = await homeData();
  const list = home.ok ? home.data.series?.series || [] : [];
  if (!list.length) return null;
  const pick = list[hashStr(`spot-item-${bucket}-${salt}`) % list.length];
  try { sessionStorage.setItem(cacheKey, JSON.stringify(pick)); } catch { /* ignora */ }
  return pick;
}

async function renderHero(salt = spotSalt()) {
  const box = document.getElementById('hero-banner');
  if (!box) return;

  const bucket = Math.floor(Date.now() / SPOT_WINDOW_MS);
  const pick = await pickSpotSeries(salt);
  if (!pick) { box.hidden = true; return; }

  document.getElementById('hero-tag').textContent =
    SPOT_TAGS[hashStr(`spot-tag-${bucket}-${salt}`) % SPOT_TAGS.length];
  // Tot bannerul e un singur <a>: click oriunde duce la seria afisata.
  document.getElementById('hero-banner').setAttribute('href', `/series?id=${encodeURIComponent(pick.id)}`);
  document.getElementById('hero-title').textContent = pick.title;
  document.getElementById('hero-sub').textContent =
    [pick.genre, pick.year, pick.episode_count ? `${pick.episode_count} episoade` : '']
      .filter(Boolean).join(' · ');

  const bg = document.getElementById('hero-bg');
  // Refolosim imaginea INLINE din HTML (first paint = arta bundled, LCP
  // descoperibil instant): ii schimbam doar sursa, nu o recreem.
  let img = document.getElementById('hero-bg-img');
  if (!img) {
    img = document.createElement('img');
    img.id = 'hero-bg-img';
    img.className = 'hban__bg-img';
  }
  const cover = safeUrl(pick.cover_image, '');
  // Fara coperta proprie: una din imaginile anime bundled (arta originala),
  // aleasa determinist din aceeasi sare ca si seria — bannerul arata mereu
  // „cu totul”, nu ca un placeholder.
  // Referim direct .webp (cu .jpg ca rezervă pentru browsere vechi): înainte
  // se cerea .jpg, iar workerul răspundea din mers cu .webp — adică două
  // cereri și o invocare de Worker pentru fiecare imagine.
  const HERO_ART = ['/assets/img/hero-1.webp', '/assets/img/hero-2.webp', '/assets/img/hero-3.webp'];
  const HERO_ART_LEGACY = ['/assets/img/hero-1.jpg', '/assets/img/hero-2.jpg', '/assets/img/hero-3.jpg'];
  const artIdx = hashStr(`spot-art-${bucket}-${salt}`) % HERO_ART.length;
  const artUrl = HERO_ART[artIdx];
  const artLegacy = HERO_ART_LEGACY[artIdx];
  img.fetchPriority = 'high';
  // O SINGURĂ scară de rezervă, ca să nu se bată două handlere de eroare
  // una pe alta (înainte exista și `onerror`, și un `addEventListener`, iar
  // al doilea anula prima treaptă): coperta redimensionată → coperta
  // originală din DB → arta .webp bundled → arta .jpg (browsere vechi) →
  // poster generat local. Ultima treaptă nu mai poate eșua.
  const ladder = [];
  if (cover && cover !== '#') ladder.push({ src: cover, clear: true });
  ladder.push({ src: artUrl, clear: true }, { src: artLegacy, clear: true }, { gen: true });
  let step = 0;
  img.addEventListener('error', () => {
    const next = ladder[step++];
    if (!next) return;
    if (next.gen) { img.remove(); bg.appendChild(genHeroArt(pick.title)); return; }
    if (img.src === new URL(next.src, location.origin).href) {  // deja încercat
      img.dispatchEvent(new Event('error'));
      return;
    }
    if (next.clear) { img.srcset = ''; img.sizes = ''; }
    img.src = next.src;
  });
  if (cover && cover !== '#') {
    // srcset responsive: IMDb livreaza la latimea potrivita ecranului
    // (telefon ~400w, tableta 800w, desktop 1280w) — nicio imagine mai mare
    // decat trebuie (auditul „Properly size images").
    img.srcset = [400, 800, 1000].map((w) => `${optimizeCover(cover, w)} ${w}w`).join(', ');
    img.sizes = '100vw';
    img.src = optimizeCover(cover, 1000);
  } else {
    img.srcset = '';
    img.sizes = '';
    img.src = artUrl;
  }
  if (img.parentNode !== bg) bg.appendChild(img);

  box.hidden = false;
  box.classList.remove('hban--loading');   // la revedere, skeleton
  // Intrarea prin Web Animations API: restart natural la fiecare apel si
  // zero reflow fortat (vechiul truc cu offsetWidth costa ~74ms de layout).
  box.animate(
    [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }],
    { duration: 700, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' }
  );
}

async function initHero() {
  try {
    await renderHero();
  } catch {
    // bannerul e decorativ: la eroare il ascundem cu totul (nu lasam
    // skeletonul afisat in eternitate peste pagina)
    document.getElementById('hero-banner')?.setAttribute('hidden', '');
  }
  document.getElementById('hero-shuffle')?.addEventListener('click', async (ev) => {
    // butonul sta IN anchorul-banner: nu vrem sa si navigheze la shuffle
    ev.preventDefault();
    ev.stopPropagation();
    const btn = ev.currentTarget;
    btn.disabled = true;
    const salt = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    try { sessionStorage.setItem('auk-spot-salt', salt); } catch { /* mod privat */ }
    try { await renderHero(salt); } finally { btn.disabled = false; }
  });
}

// ---------------------------------------------------------------------
async function renderContinue() {
  const section = document.getElementById('continue-section');
  const row = document.getElementById('continue-row');
  if (!section || !row) return;

  // Doar utilizatorii logati au progres: pentru anonimi nu facem deloc
  // cererea (401-ul de altadata aparea ca eroare in consola si strica
  // auditul „Cele mai bune practici").
  const me = await getSession().catch(() => null);
  if (!me) { section.hidden = true; return; }

  const res = await api('/continue');
  if (!res.ok || !res.data?.items?.length) { section.hidden = true; return; }

  section.hidden = false;
  // Proprietarul site-ului poate alege altfel prin butonul „Episodul următor"
  // din card (vezi mai jos): preferinta sta in localStorage, nu pe server.
  const preferNext = (() => {
    try { return localStorage.getItem('auk-continue-next') === '1'; } catch { return false; }
  })();

  row.innerHTML = '';
  for (const it of res.data.items) {
    // Când episodul e terminat și seria are un episod următor, cardul duce
    // DIRECT la el (comportamentul pe care îl aștepți de la „Continuă
    // vizionarea"): ai terminat episodul 5, vrei să dai play la 6.
    // `next_episode_id` vine din server (o singură căutare în index), nu e
    // ghicit din numere — episoadele nu sunt mereu consecutive.
    const done = it.seconds >= WATCH_DONE_SECONDS;
    const nextId = Number(it.next_episode_id) || 0;
    const goNext = done && nextId > 0 && preferNext;
    const targetId = goNext ? nextId : it.episode_id;

    const a = document.createElement('a');
    a.className = 'continue-card';
    a.href = `/episode?id=${encodeURIComponent(targetId)}`;
    if (goNext) a.dataset.next = '1';

    const art = document.createElement('div');
    art.className = 'continue-card__art';
    const cover = safeUrl(it.cover_image, '');
    if (cover && cover !== '#') {
      art.appendChild(coverImg(cover, {
        w: 400, widths: [200, 300, 400],
        sizes: '(min-width: 900px) 160px, 45vw',
      }));
    } else {
      art.appendChild(genPoster(it.series_title));
    }

    // Bara de progres peste arta, ca la platformele de streaming: cat la suta
    // din episod s-a vazut. Durata vine din serie (ep_duration, in minute);
    // daca nu e completata, aratam „Ai inceput" in loc de un procent inventat.
    const durMin = Number(it.ep_duration) || 0;
    const totalSec = durMin > 0 ? durMin * 60 : 0;
    // Fara durata completata pe serie nu inventam un procent: scriem cate
    // minute s-au acumulat efectiv (valoarea vine din watch_progress).
    const watchedMin = Math.max(1, Math.round(it.seconds / 60));
    const pct = done ? 100 : (totalSec > 0 ? Math.min(99, Math.max(3, Math.round((it.seconds / totalSec) * 100))) : 0);
    if (pct > 0) {
      const prog = document.createElement('span');
      prog.className = 'continue-card__prog';
      const fill = document.createElement('i');
      fill.style.width = `${pct}%`;
      if (done) fill.className = 'is-done';
      prog.appendChild(fill);
      prog.title = done ? 'Episod terminat' : `Ai văzut ~${pct}% din episod`;
      art.appendChild(prog);
    }
    a.appendChild(art);

    const meta = document.createElement('div');
    meta.className = 'continue-card__meta';
    const t1 = document.createElement('span');
    t1.className = 'continue-card__series';
    t1.textContent = it.series_title;
    const t2 = document.createElement('span');
    t2.className = 'continue-card__ep';
    t2.textContent = goNext
      ? `Episodul ${it.next_episode_number} (după ${it.episode_number})`
      : `Episodul ${it.episode_number}`;
    meta.appendChild(t1);
    meta.appendChild(t2);
    // „acum 2 ore” — rândul pare viu, nu o listă înghețată
    if (it.updated_at) {
      const t3 = document.createElement('span');
      t3.className = 'continue-card__ago';
      const stare = done ? '✓ Văzut' : (pct > 0 ? `${pct}%` : `${watchedMin} min văzute`);
      t3.textContent = `${stare} · ${relativeTime(it.updated_at)}`;
      meta.appendChild(t3);
    }
    a.appendChild(meta);

    // Comutator „Episodul următor" — apare doar cand exista un episod urmator
    // (altfel ar fi un buton care nu face nimic, pe majoritatea cardurilor).
    if (done && nextId > 0) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'continue-card__next';
      toggle.textContent = preferNext ? '↩︎ Reia episodul curent' : '⏭ Episodul următor';
      toggle.title = preferNext
        ? 'Cardurile terminat incep de la episodul văzut, nu de la următorul'
        : 'Cardurile terminate incep direct de la episodul următor';
      toggle.addEventListener('click', (e) => {
        // Butonul stă într-un <a>: fără preventDefault, click-ul ar naviga.
        e.preventDefault();
        e.stopPropagation();
        const nou = !preferNext;
        try { localStorage.setItem('auk-continue-next', nou ? '1' : '0'); } catch { /* mod privat */ }
        renderContinue().catch(() => { /* rândul e opțional */ });
      });
      a.appendChild(toggle);
    }
    row.appendChild(a);
  }
}

// Acelasi prag ca pe server (WATCH_THRESHOLD_SECONDS din
// src/routes/api/progress.js): sub el, punctele si marcajul „vizionat" nu se
// acorda. Pagina il foloseste doar ca sa stie cum arata cardul din
// „Continuă vizionarea" — decizia rămâne a serverului.
const WATCH_DONE_SECONDS = 15 * 60;

skeletons(10);
// nav-ul si lista merg in paralel; chat-ul (WebSocket) doar cand pagina e
// efectiv activa, ca un tab prerenderat sa nu deschida socket degeaba
async function loadTops() {
  const sec = document.getElementById('tops-section');
  const home = await homeData();
  if (!home.ok || !sec) { if (sec) sec.hidden = true; return; }
  const week = home.data.top?.weekly || [];
  const rated = home.data.top?.rated || [];
  if (!week.length && !rated.length) { sec.hidden = true; return; }

  const fill = (id, rows, meta) => {
    const ol = document.getElementById(id);
    ol.innerHTML = '';
    for (const r of rows) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/series?id=${encodeURIComponent(r.id)}`;
      a.textContent = r.title;
      const m = document.createElement('span');
      m.className = 'toplist__meta';
      m.textContent = meta(r);
      li.append(a, m);
      ol.appendChild(li);
    }
  };
  fill('top-weekly', week, (r) => `👥 ${r.watchers} · ${Math.round((r.seconds || 0) / 60)} min`);
  fill('top-rated', rated, (r) => `★ ${r.average} · ${r.votes} ${r.votes === 1 ? 'vot' : 'voturi'}`);
  sec.hidden = false;
}

initCatalogFilters();
loadRecent().catch(() => { /* secțiunea e optională */ });
// Filtrele din URL se aplica INAINTE de prima cerere, ca pagina sa se
// incarce direct pe rezultatele cerute (fara un al doilea apel).
readUrlState();
if (genreFilter) document.getElementById('genre-select').value = genreFilter;
if (statusFilter) document.getElementById('status-select').value = statusFilter;
applyFilters({ reload: false });
if (query) document.getElementById('search-input').value = query;
await Promise.all([renderNav('/'), load(), loadTops().catch(() => { /* optionale */ })]);
whenActive(() => initChat().catch(() => { /* chat-ul e optional la load */ }));
startGuestNudge();
initHero().catch(() => { /* bannerul e decorativ: pagina merge si fara el */ });
renderContinue().catch(() => { /* randul de continuare e optional */ });

// Debounce: fara el, fiecare litera tastata ar insemna un LIKE pe tot
// tabelul de serii — iar cautarea e exact operatia care nu e indexabila.
document.getElementById('search-input')?.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  // Sugestiile instant (dropdown sub search): si ele pe server, dar cer
  // doar 6 rezultate — la fel de ieftin, arata ca un produs serios.
  searchTimer = setTimeout(() => { search(v); searchSuggest(v); }, 180);
});

// ---------------------------------------------------------------------
// SUGESTII LIVE sub bara de cautare: rezultate in timp real, navigare cu
// sagetile, Enter deschide. O singura cerere de 6 randuri per bataie de
// taste — cel mai bun raport efect/buget pentru senzatia de „site viu”.
// ---------------------------------------------------------------------
let sugItems = [];
let sugActive = -1;
let sugCtrl = null;

function sugBox() {
  let box = document.getElementById('search-sug');
  if (!box) {
    const wrap = document.querySelector('.search');
    if (!wrap) return null;
    box = document.createElement('div');
    box.id = 'search-sug';
    box.className = 'search-sug';
    box.hidden = true;
    wrap.appendChild(box);
  }
  return box;
}

function sugClose() {
  const box = sugBox();
  if (box) { box.hidden = true; box.innerHTML = ''; }
  sugItems = [];
  sugActive = -1;
  sugCtrl?.abort();
  sugCtrl = null;
}

function sugPaint(q) {
  const box = sugBox();
  if (!box) return;
  box.innerHTML = '';
  sugActive = -1;
  if (!sugItems.length) { sugClose(); return; }

  const needle = q.toLowerCase();
  const mark = (text) => {
    const s = document.createElement('span');
    const i = String(text).toLowerCase().indexOf(needle);
    if (!needle || i < 0) { s.textContent = text; return s; }
    s.append(text.slice(0, i));
    const m = document.createElement('mark');
    m.textContent = text.slice(i, i + needle.length);
    s.append(m, text.slice(i + needle.length));
    return s;
  };

  sugItems.forEach((s, i) => {
    const a = document.createElement('a');
    a.className = 'search-sug__item';
    a.href = `/series?id=${encodeURIComponent(s.id)}`;
    const art = document.createElement('span');
    art.className = 'search-sug__art';
    const cover = safeUrl(s.cover_image, '');
    if (cover && cover !== '#') {
      art.appendChild(coverImg(cover, { w: 120, alt: '' }));   // slot de 42 px
    } else {
      art.appendChild(genPoster(s.title));
    }
    const meta = document.createElement('span');
    meta.className = 'search-sug__meta';
    const t = document.createElement('b');
    t.appendChild(mark(s.title || 'Fără titlu'));
    const sub = document.createElement('small');
    sub.textContent = [s.genre?.split(',')[0]?.trim(), s.year, s.episode_count ? `${s.episode_count} EP` : '']
      .filter(Boolean).join(' · ');
    meta.append(t, sub);
    a.append(art, meta);
    a.addEventListener('mouseenter', () => sugHighlight(i));
    a.addEventListener('click', () => sugClose());
    box.appendChild(a);
  });

  const foot = document.createElement('div');
  foot.className = 'search-sug__foot';
  foot.textContent = 'Enter deschide · ↑↓ navighează · Esc închide';
  box.appendChild(foot);
  box.hidden = false;
}

function sugHighlight(i) {
  const box = sugBox();
  if (!box) return;
  sugActive = i;
  for (const [j, el] of [...box.querySelectorAll('.search-sug__item')].entries()) {
    el.classList.toggle('is-active', j === i);
  }
}

async function searchSuggest(q) {
  const term = q.trim();
  const box = sugBox();
  if (!box) return;
  if (term.length < 2) { sugClose(); return; }

  sugCtrl?.abort();
  sugCtrl = new AbortController();
  const res = await api(`/series?q=${encodeURIComponent(term)}&per_page=6&page=1`, { signal: sugCtrl.signal });
  if (res.status === 0) return; // anulată de o cerere mai nouă sau rețea moartă
  sugItems = res.ok ? (res.data.series || []) : [];
  sugPaint(term);
}

document.getElementById('search-input')?.addEventListener('keydown', (e) => {
  const box = sugBox();
  if (!box || box.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = sugActive + (e.key === 'ArrowDown' ? 1 : -1);
    sugHighlight((next + sugItems.length) % Math.max(1, sugItems.length));
  } else if (e.key === 'Enter' && sugActive >= 0 && sugItems[sugActive]) {
    e.preventDefault();
    location.href = `/series?id=${encodeURIComponent(sugItems[sugActive].id)}`;
  } else if (e.key === 'Escape') {
    sugClose();
  }
});

// Escape curata cautarea cand nu e nimic de inchis deasupra (comportamentul
// de bara de adrese, pe care utilizatorii il asteapta instinctiv).
document.getElementById('search-input')?.addEventListener('keydown', (e) => {
  const box = sugBox();
  if (e.key !== 'Escape' || (box && !box.hidden)) return;
  const input = e.currentTarget;
  if (!input.value) return;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

// Scurtatura „/": sare in cautare de oriunde din pagina (ca pe GitHub/YouTube).
// Ignorata cand scrii deja intr-un camp sau cand ai modificatori — altfel ar
// fura tastele din chat, din formulare sau din comenzile browserului.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = document.activeElement;
  const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.tagName === 'SELECT');
  if (typing) return;
  const input = document.getElementById('search-input');
  if (!input) return;
  e.preventDefault();
  input.focus();
  input.select?.();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.search')) sugClose();
});

document.getElementById('sort-select')?.addEventListener('change', (e) => {
  sort = e.target.value;
  page = 1;
  applyFilters();
});

// Butonul „Înapoi" al browserului: reface filtrele din URL, nu iese de pe site.
window.addEventListener('popstate', () => {
  readUrlState();
  applyFilters({ reload: false });   // selectorii si URL-ul se resincronizeaza
  load({ silent: true });
});

document.getElementById('load-more')?.addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  e.currentTarget.textContent = 'Se încarcă…';
  page++;
  writeUrlState();
  await load({ append: true, silent: true });
});

document.getElementById('hero-chat')?.addEventListener('click', openChat);
document.getElementById('footer-chat')?.addEventListener('click', (e) => {
  e.preventDefault();
  openChat();
});
const fy = document.getElementById('footer-year');
if (fy) fy.textContent = String(new Date().getFullYear());
