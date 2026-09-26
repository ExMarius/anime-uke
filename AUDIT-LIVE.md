# Audit live — https://anime-uke.pages.dev

**Data:** 2026-09-26 (auditul inițial: 2026-09-22) · **Rulat prin:** relay GitHub Actions
(`cf-relay/cmd.sh` → `node scripts/audit-live.mjs`)
**Mod:** read-only, fără credențiale · **Scor final:** ✅ **190** · 🟡 **0** · 🔴 **0** · ℹ️ 36
**Build auditat:** `?v=205f42b` (26.09, post-merge PR #11 — notificări de prietenie;
scorul 190/0/0/ℹ️36 e în picioare din runda 11, vezi §1k și §1l)

| Rundă | Scor | Ce a fost |
|---|---|---|
| 1 (înainte de reparări, build `eb03ecd`) | ✅ 144 · 🟡 19 · 🔴 2 | auditul inițial: 2 probleme reale + 19 observații |
| 2 (după reparări, build `55a3027`) | ✅ 162 · 🟡 0 · 🔴 0 | „niciuna — auditul a trecut curat” |
| 3 (SSR episod, build `0936caa`) | ✅ 168 · 🟡 0 · 🔴 0 | +6 probe noi (2 episoade × JSON-LD/og:type/200), toate verzi |
| 4 (fix-uri verificare totală, build `1a11f03`) | ✅ 168 · 🟡 0 · 🔴 0 | CSP per-directivă, HSTS pe API, rute moarte scoase — curat |
| 5 (integrare + buget de invocări, build `7e83eb8`) | ✅ 179 · 🟡 0 · 🔴 0 · ℹ️ 32 | două linii de lucru contopite + costul unei vizite ~12 → ~2 invocări |
| 6 (scara 1000×1000, migrarea 0028, build `65b57e7`) | ✅ 179 · 🟡 0 · 🔴 0 · ℹ️ 32 | o vizită: ~230.000 → ~64 rânduri citite; planurile de execuție confirmate pe D1-ul de producție |
| 7 (aspect, build `9f8606a`) | vezi §1f | nota pe carduri, progres la continuare, filtre lipicioase, „înapoi sus", scurtatura `/` |
| 8 (chatul care nu se salva, build `8f0c1b9`) | vezi §1g | buffer de DO pierdut la evictie: mesajele și stickerele ajung acum în D1 la fiecare trimitere |
| 9 (funcționalități noi, build `77d17b7`) | ✅ 179 · 🟡 0 · 🔴 0 · ℹ️ 32 | catalog partajabil, sortare după notă, episodul următor, „văzut" — vezi §1h |
| 10 (viteză, build `4b65b07`) | ✅ 186 · 🟡 0 · 🔴 0 · ℹ️ 35 | chat scos de pe calea critică (chunk la cerere), arta hero 168 → 94 KB (pasul 1), coperți dimensionate — vezi §1i |
| 11 (viteză, pasul 2: AVIF, build `d8ad136`) | ✅ 190 · 🟡 0 · 🔴 0 · ℹ️ 36 | arta hero în AVIF (`<picture>`): 224 → 151 KB, −40% comprimat pe live; două buguri de hero reparate — vezi §1j |
| 12 (buget 0: poll adaptiv + incidentul tokenului CF, build `277c5ed`) | ✅ 190 · 🟡 0 · 🔴 0 · ℹ️ 36 | redeploy verificat end-to-end după pierderea accesului la deploy; canarul de chat în D1, markerul `auk-adaptive` publicat, consumul zilei 2% din invocări — vezi §1k |
| 13 (notificări de prietenie, build `205f42b`) | ✅ 190 · 🟡 0 · 🔴 0 · ℹ️ 36 | cererile de prietenie notifică în clopot; canar de prietenie pe live (cerere + acceptare, dovezi în D1), PR #8 mort închis — vezi §1l |

---

## 1d. Runda 5 (2026-09-22): integrare + buget de invocări

Două sesiuni lucrau în paralel pe `main` și **ambele publicau în același proiect Pages**, deci
live-ul oscila între două versiuni divergente. Acum există o singură linie, testată împreună:
feature-urile din `arena/01a0c538-anime-uke` (SSR SEO pe episod, logo, teme de sezon, shop 2.0,
sitemap-uri GSC) + bugetul de invocări din `arena/01a0ca0d-anime-uke`.

| Schimbare | Efect | Dovada pe live |
|---|---|---|
| `public/_routes.json` — `/assets/*`, `/`, `/login`, `/register`, `/episode`, favicon, apple-touch-icon, robots/llms/speculationrules nu mai intră în worker | acele cereri costă **0 invocări** | `cache-control: public, max-age=31536000, immutable` pe asset, o singură valoare (înainte: `no-cache, no-cache` = semnul trecerii prin worker) |
| `public/_headers` — headerele cailor ocolite, identice cu `SECURITY_HEADERS` (inclusiv `style-src 'unsafe-inline'`, decizia documentată pentru A-Ads) | securitatea nu scade | CSP + HSTS + X-Frame-Options + Permissions-Policy + CORP + nosniff pe asset; `tests/e2e.mjs` compară cele două seturi |
| `GET /api/home` — prima pagină într-o singură invocare (catalog + topuri + ultimele episoade + genuri + „online") | 5 cereri de API → **1** | `/api/home` → 200 public, toate secțiunile; `dom-smoke` numără cererile paginii |
| imagini cerute direct `.webp` (hero + logo), `.png`/`.jpg` doar pentru favicon, `og:image` și rezervă | fără negociere pe server, fără cereri duble | `logo-icon.webp` 1,9 KB vs PNG 10,9 KB; `og:image` rămâne PNG (rețelele sociale nu acceptă WebP) |
| `scripts/usage.mjs` (`npm run usage`, rulat de relay) | consumul zilei din cotele gratuite, vizibil | vezi tabelul de mai jos |

**Consum real măsurat** (ziua UTC în care s-a deployat, cu toate testele și auditurile):

| Cotă gratuită | Consumat | Din plafon |
|---|---|---|
| Invocări Functions (Pages) | 6.551 | **7%** |
| D1 rânduri citite | 20.345 | 0% |
| D1 rânduri scrise | 219 | 0% |
| Durable Objects requests | 998 | 1% |
| DO durată | 1 GB-s | 0% |

Cifrele de mai sus includ **toată ziua de lucru** (toate rundele de teste, deploy-urile și
auditurile), nu doar traficul real — de aceea un procent de 7% într-o zi de muncă grea e
reperul cel mai bun pe care îl avem pentru „cât duce planul gratuit".

**De făcut de proprietar (2 click-uri, gratuit):** dashboard → Workers & Pages → `anime-uke` →
Settings → Runtime → **Fail open**, ca la epuizarea cotei catalogul static să rămână vizibil.

---

## 1. Ce a fost reparat în sesiunea asta

| ID | Problemă constatată pe live | Reparare | Verificare după deploy |
|---|---|---|---|
| **A** | `/serie/99999999` și `/episod/99999999` răspundeau **200** cu shell-ul paginii („soft 404” pentru Google; crawl budget irosit pe id-uri inventate) | `serveStatic()` verifică existența în D1 (cu cache 5 min la nivel de izolat, inclusiv **cache negativ**) și servește o pagină 404 generată în worker, cu `<meta robots noindex>` + header `X-Robots-Tag: noindex, follow` | `/serie/99999999` → **404**, titlu „404 — Serie inexistentă”, `x-robots-tag: noindex, follow` · `/episod/99999999` → **404** · seriile/episoadele reale (`/serie/1014`, `/episod/4210`) rămân **200** |
| **B** | `/series` (fără id) era pagină moartă: 200 + head gol (fără description/canonical/og), JS-ul făcea `location.replace('/')`, iar URL-ul era **declarat în sitemap**. `/series/` cădea pe poarta de auth → `302 /login` | **301** server-side `/series` → `/` (doar când lipsește un `id` numeric); `/series` scos din `sitemap.xml` | `/series` → **301 https://anime-uke.pages.dev/** · `/series/` → **301 /** · `/series?id=1014` → **200** (forma veche încă funcționează) · sitemap: `/` + 5 × `/serie/<id>`, fără `/series` |
| **C** | 11 căi din repo răspundeau `302 /login?next=…` (conținutul nu scăpa, dar statusul dezvăluia existența fișierelor și umplea crawl-ul): `/package.json`, `/deploy.sh`, `/dev.sh`, `/test.sh`, `/AGENTS.md`, `/schema.sql`, `/src/worker.js`, `/cf-relay/cmd.sh`, `/wrangler.prod.toml`, `/.dev.vars.example`, `/node_modules/…` | allowlist de pagini reale (`STATIC_PAGES` + `DYNAMIC_PAGES`) verificat **înainte** de poarta de autentificare: orice altceva (și nu e API/asset) primește 404. Căile se normalizează (`/x/` → `/x`, `/x.html` → `/x`) ca să nu sară peste poartă | toate cele 11 → **404**; `/profile` (nelogat) încă → **302 /login?next=/profile**; `/profile.html` → 302/308 (clean URL Pages păstrat) |
| **D** | `/login` și `/register` n-aveau canonical (duplicat posibil prin `?next=…`) | `<meta robots noindex, follow>` + `<link rel=canonical>` pe ambele pagini | `/login` noindex 1, canonical 1 · `/register` noindex, canonical 1 |
| **E** | lipsea `Cross-Origin-Resource-Policy` | adăugat în `SECURITY_HEADERS` (`same-origin`) — site-ul nu servește nimic embed-abil către terți | `cross-origin-resource-policy: same-origin` pe `/` |

**Fișiere atinse:** `src/worker.js` (rutare/404/SSR + sitemap), `src/lib/http.js` (header), `public/login.html`,
`public/register.html`, `tests/e2e.mjs` (+19 verificări), `scripts/audit-live.mjs` (probe noi).
**Teste locale după reparări:** `./test.sh` → e2e **474** · dom-smoke **147** · caps **13**, toate verzi.

## 1b. Runda 3 (2026-09-21): SSR SEO pe `/episod/<id>`

Punctul 1 din §3 („cea mai mare oportunitate de trafic organic”) e implementat: `episodeForSeo()` citește
episodul + seria dintr-un JOIN indexat, cu cache 5 min în izolat (inclusiv negativ); la eroare D1 pagina
se servește nemodificată, fără 404 fals. Titlul generic „Episod • anime-uke” nu mai ajunge niciodată la
crawleri — e înlocuit server-side. Verificat pe live (`/episod/4210`, `/episod/4211`, `/episod/4212`):
200 + `TVEpisode` + `video.episode`.
**Fișiere atinse:** `src/worker.js`, `tests/e2e.mjs` (+8 verificări → **482**), `scripts/audit-live.mjs` (+6 probe).

## 1c. Runda 4 (2026-09-21): fix-urile verificării totale

`style-src 'unsafe-inline'` deliberat (reclamele A-Ads, pagina 404 din worker și layout-ul admin erau
blocate de CSP; `script-src` rămâne strict — proba de audit verifică acum per-directivă); HSTS și pe
răspunsurile API; `/api/pulse` citește DO-ul de chat corect (`global-chat`, era `global` → `online` mereu
0, verificat local cu socket real: 0→1→0); `/404`, `/admin/serie` bare și `/covers/*` scos din allowlist
(toate → 404 cu pagina site-ului); `robots.txt` fără `Allow: /series`; prerender pe `/serie/*`.
**Fișiere atinse:** `src/lib/http.js`, `src/worker.js`, `src/routes/api/pulse.js`, `public/robots.txt`,
`public/speculationrules.json`, `tests/e2e.mjs` (+9 verificări → **491**), `scripts/audit-live.mjs`,
`README.md`; șters `tests/prod-smoke.mjs` (expirat, dublat de audit-live).
Notă operațională: între deploy și audit se așteaptă 60s (propagarea Pages a servit o dată HTML vechi).

---

## 2. Ce e sănătos (verificat pe live, nu doar în cod)

| Zonă | Rezultat |
|---|---|
| **Headere de securitate** | CSP cu `script-src` strict (fără `unsafe-inline`/`unsafe-eval`; `style-src` are `unsafe-inline` deliberat din runda 4), `frame-ancestors 'none'`, HSTS 1 an (și pe API, din runda 4), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP |
| **Cookie de sesiune** | `HttpOnly; Secure; SameSite=Lax; Path=/` — JS nu-l poate citi |
| **CSRF** | `POST /api/auth/register` și `/login` cu `Origin: https://evil.example` → **403**; fără `Origin` (curl/navigare) → 401, deci fluxurile normale nu se blochează |
| **Rate limit** | login: al 10-lea eșec → **429** (10/5 min/IP) · register: a 5-a cerere → **429** (5/oră/IP) |
| **Drepturi API** | toate cele 20 de rute admin/privilegiate probeate → **401** fără sesiune (stats, users, series, episodes, log, reports, mods, rank-themes, episode-sources, leaderboard, factions, economy, shop, missions, notifications, watchlist, profile, continue, ranks, chests) |
| **Pagini protejate** | `/profile`, `/shop`, `/admin`, `/admin/serii`, `/admin/serie/1` → **302 `/login?next=…`** (destinația se păstrează) |
| **Validare** | `/api/series/1' OR '1'='1` → **400**; register invalid → **400**; metodă greșită → **405 + `Allow`**; `/api/*` necunoscut → 401 (nu dezvăluie tabela de rute) |
| **Scurgeri** | niciun token/cheie/UUID/parolă hardcodată în cele 8 bundle-uri JS publice; `database_id` D1 nu apare în client |
| **Fișiere sensibile** | `/.git/config`, `/migrations/*.sql`, `/.dev.vars`, `/wrangler.toml` → **404** |
| **SEO on-page** | `/`: title 44 car., description 160 car., canonical, 6 `og:*`, twitter card, `lang="ro"`, assete cu `?v=` · `/serie/<id>`: title/description/canonical/og + **JSON-LD `TVSeries`** (alternateName, countryOfOrigin, contentRating, sameAs) |
| **Performanță** | HTML/CSS/JS cu **brotli**; JS total **258 KB** comprimat (8 bundle-uri, fără framework); assetele cu `?v=` → `max-age=31536000, immutable`; imaginile → cache 30 zile; `/` 391 ms, `/series` 35 ms, `/api/series` 133 ms |
| **Imagini** | negociere WebP funcțională (`hero-1.jpg` 202 KB → 168 KB webp) |
| **Chat** | `/chat` fără upgrade → 401; cu `Origin` străin + handshake WebSocket → nu se face upgrade |
| **Sitemap/robots** | `robots.txt` declară `Sitemap:`; sitemap XML valid, 6 URL-uri canonic, fără duplicate, fără `/series`; `llms.txt`; `speculationrules.json` |
| **Buget $0 (D1 remote)** | 31 tabele, volume mici: `users` 3, `anime_series` 5, `episodes` 5, `episode_sources` 5, `chat_messages` 30, `watch_progress` 8, `admin_log` 53, `rank_themes` 22 — nimic aproape de cotele gratuite (100k scrieri/zi, 5 GB citiri/zi, 500 MB) |
| **Migrări** | `No migrations to apply!` — schema remote e la zi (0025) |

---

## 3. Rămase de decis (nu sunt defecte, sunt alegeri de produs)

1. ~~**SSR SEO lipsește pe `/episod/<id>`**~~ — **REZOLVAT 2026-09-21** (runda 3): paginile de episod ies din
   server cu titlu „Serie — Episodul N subtitrat în română | Anime-Uke”, description, canonical,
   `og:type video.episode` și JSON-LD `TVEpisode` (+`partOfTVSeries`) + `BreadcrumbList`. Cost: o citire D1
   (JOIN indexat episod+serie) cu cache 5 min + cache negativ, la fel ca la serii. Dovada pe live:
   `/episod/4210` → titlu „One Piece — Episodul 3 subtitrat în română | Anime-Uke”, `TVEpisode`/`BreadcrumbList` prezente.
2. **Canonical/og hardcodate pe `anime-uke.pages.dev`** în `index.html`, `login.html`, `register.html`. Când se
   adaugă domeniu propriu (`CANONICAL_ORIGIN`), aceste trei fișiere trebuie trecute pe originea canonică
   (sau injectate din worker, ca la `/serie/<id>`).
3. **`/episode` fără id** rămâne 200 (shell + JS). Nu e în sitemap și nu e link-uit; se poate aplica același 301
   ca la `/series` dacă se dorește consecvență.
4. **Audit cu sesiune pe live** — auditul nu are credențiale, deci fluxele logate (shop, cufere, misiuni, facțiuni,
   admin, chat) sunt verificate doar local de `./test.sh`. Dacă vrei o trecere și pe live, e nevoie de un cont de
   test (sau aprobarea să creez unul temporar și să-l șterg după).

---

## 3b. Note de întreținere pentru `_routes.json`

- Orice rută pusă în `exclude` **nu mai trece prin poarta de autentificare din worker** — doar
  pagini publice. `exclude` conține acum: `/assets/*`, `/`, `/login`, `/register`, `/episode`,
  `/favicon.ico`, `/apple-touch-icon.png`, `/robots.txt`, `/llms.txt`, `/speculationrules.json`.
- Rămân OBLIGATORIU pe worker: `/api/*`, `/chat`, SSR `/serie/<id>` și `/episod/<id>`,
  `/sitemap.xml`, `/sitemap.txt`, `/sitemap`, `/profile`, `/shop`, `/admin/*`.
- Dacă apare o pagină publică nouă (ex. `/despre`), adaug-o în `exclude` **și** în
  `PUBLIC_PAGES`/`STATIC_PAGES` din `src/worker.js` (altfel e 404 prin worker, pentru
  crawlerii care o cer pe calea din `include`).

---

## 1e. Runda 6 (2026-09-22): scara 1.000 × 1.000 (migrarea 0028)

Întrebarea proprietarului — „duce 1.000 de utilizatori și 1.000 de serii?" — a fost
măsurată, nu estimată: `scripts/bench-scale.mjs` construiește scara maximă pe un D1 local
(aceleași migrări; 1.000 serii, 19.788 episoade, 1.000 conturi, 199.011 rânduri de progres,
29.578 note) și raportează ce citește fiecare interogare fierbinte. Pe planul gratuit se
taxează rândurile citite (5M/zi), deci asta era întrebarea reală — iar răspunsul, înainte,
era NU: **~230.000 rânduri citite pentru O vizită pe prima pagină** (~21 vizite/zi până la
epuizarea cotei).

| Interogare din prima pagină | Rânduri citite înainte | După 0028 |
|---|---|---|
| Top săptămânal (`watch_progress`, scanare completă) | 199.011 | 1 (cache) · ~4.000 la recalculul orar |
| Top notate (`GROUP BY` pe toate notele) | 29.578 | 5 |
| `pulse` (COUNT/SUM pe 3 tabele) | 41.576 | 4 |
| Catalog (24 carduri, B-tree temporar) | ≤1.000 | ≤25 |
| **Total pe vizită** | **~230.000** | **~64** |

Fix-urile (migrarea 0028 + cod): `idx_progress_updated`, media notelor denormalizată pe
serie și resincronizată în același batch cu votul (`src/lib/ratings.js`), `idx_series_rating`,
`idx_series_created_id`, contoarele `users_total`/`views_total` în `site_meta`, cache de o
oră pentru topul săptămânal în `leaderboard_cache` (`TOP_CACHE_MINUTES=0` în dev/teste).

Dovada pe producție (secțiunea 14 din `cf-relay/cmd.sh`, rulată pe build-ul `65b57e7`):
`EXPLAIN QUERY PLAN` pe D1-ul real, pentru cele patru interogări fierbinți —

```
top săptămânal → SEARCH w USING INDEX idx_progress_updated (updated_at>?) …
top notate     → SCAN anime_series USING COVERING INDEX idx_series_rating
catalog        → SCAN s USING COVERING INDEX idx_series_created_id
pulse          → SEARCH site_meta USING INDEX sqlite_autoindex_site_meta_1 (key=?)
scanări de watch_progress în topul săptămânal (trebuie 0): 0
```

Tot acolo s-a confirmat și migrarea pe producție: coloanele `rating_avg`/`rating_count`
există pe `anime_series`, iar contoarele au fost inițializate din datele reale
(`users_total = 3`, `views_total = 7` — câte conturi și câte vizualizări avea site-ul).

Teste noi: `tests/top-cache.mjs` (17 — cache-ul topului: hit, miss, expirare, `TOP_CACHE_MINUTES=0`,
degradare când D1 pică) și `tests/counters.mjs` (16 — maparea contoarelor pe `pulse` și forma
batch-ului care resincronizează media), plus în e2e verificarea că media denormalizată din
clasament e identică cu cea calculată live din note.

---

## 1f. Runda 7 (2026-09-23): aspect (nota pe carduri, progres, filtre lipicioase)

Rundă de UX, cu cost zero în buget. Verificată în relay (secțiunea 15 din
`cf-relay/cmd.sh`), pe CSS-ul **purjat și minificat** care ajunge la utilizator —
nu pe sursă — pentru că PurgeCSS e cel care poate șterge o clasă nouă:

| Ce s-a adăugat | Dovada pe live |
|---|---|
| nota comunității pe carduri (`★ 8.7`, doar seriile cu voturi) | `.badge-rating` prezent în CSS-ul publicat; `/api/series` întoarce `rating_avg` + `rating_count` |
| bară de progres + procent/min min văzute la „Continuă vizionarea" | `.continue-card__prog` în CSS; bundle-ul conține șirul (escapat de esbuild: `min v\u0103zute`) |
| filtre de catalog lipicioase sub navbar | `position: sticky` în CSS-ul publicat |
| buton „înapoi sus" pe toate paginile | `to-top` în `core.js` din producție + `requestAnimationFrame` |
| scurtătura `/` pentru căutare | `<kbd class="search__kbd">` în HTML-ul live + `!=="/"` în bundle |

Teste: dom-smoke 163 → 169 (nota apare exact pe cardurile cu voturi, butonul
pornit ascuns, cardurile de continuare spun unde ai rămas) și e2e 574 → 576
(nota în catalog, `ep_duration` în `/api/continue`). În plus, `test.sh` începe
acum cu `tests/scripts-health.mjs` (23 de verificări: `bash -n` pe toate
scripturile, `node --check` pe `scripts/`+`tests/`, rutele probate de relay
există, fără ghilimele tipografice nepereche) — garda asta a prins în timpul
lucrului o eroare de sintaxă în `cmd.sh` care ar fi picat deploy-ul pe runner.

## 1g. Runda 8 (2026-09-23): chatul care nu se salva (bug de producție)

Raportat de proprietar: „nu se salvează mesajele, nici stickerele”. Diagnosticul,
citit direct din producție (secțiunea 16 din `cf-relay/cmd.sh`):

| Dovada | Valoare |
|---|---|
| rânduri în `chat_messages` | 30 (din care `max_id` = 30) |
| mesaje în ultimele 24h / 7 zile | **0 / 0** |
| ultimul mesaj salvat | 2026-09-14 |

**Cauza:** `ChatDO` ținea mesajele într-un buffer **în memorie** și le scria în D1
în loturi (10 mesaje sau alarma de 15 secunde). Cu WebSocket Hibernation, Cloudflare
evacuează DO-ul când nu se întâmplă nimic — iar alarma sună pe o **instanță nouă**,
cu bufferul gol. Pe un site mic (câteva mesaje pe oră) asta însemna practic zero
mesaje salvate, deși toți utilizatorii le vedeau live. Stickerele sunt mesaje
`[sticker:id]` pe exact același drum, deci un singur fix le acoperă pe amândouă.

**De ce nu a prins nimic:** în miniflare (local) DO-ul **nu e evacuat niciodată**,
deci bufferul ajungea mereu la D1 și toate suitele treceau. Bug-ul era invizibil
prin construcție, nu prin lipsă de teste.

**Fix:** bufferul s-a mutat în **storage-ul durabil al DO-ului**:

1. fiecare mesaj se scrie cu `state.storage.put` **înainte** de broadcast (chei
   ordonabile `m:<seq>` zero-padded) — storage-ul DO supraviețuiește evicției;
2. lotul pentru D1 se **citește din storage** la flush, deci alarma scrie corect
   chiar dacă sună pe o instanță proaspăt trezită;
3. cheile se șterg **doar după** un `DB.batch()` reușit; dacă D1 pică, mesajele
   rămân durabile și se scriu la următoarea ocazie (catch-up la conectare, la
   următorul mesaj sau la următoarea alarmă);
4. istoricul de la conectare = arhiva D1 ∪ bufferul durabil, în ordine
   cronologică, fără dubluri, ultimele 30;
5. plafon de siguranță: bufferul nu crește peste 1.000 de mesaje dacă D1 e jos
   mult timp; arhiva păstrează singură ultimele 500 (curățenie rară, contor ținut
   în storage).

**Al doilea bug, ascuns în spatele primului:** `INSERT INTO chat_messages` avea
**11 coloane și doar 10 parametri** — D1 răspundea „10 values for 11 columns” la
fiecare flush, eroarea era prinsă și doar logată, iar tabelul rămânea gol. Chiar
dacă bufferul ar fi supraviețuit evicției, mesajele tot nu ajungeau în D1. (Rândurile
cu id 1–30 din producție au fost scrise de versiunea dinainte de 15 septembrie;
după deploy-ul din 15 septembrie nu a mai intrat nimic în tabel.)

**Verificare:** `tests/chat-persist.mjs` (nou, 14 verificări, în `./test.sh`)
simulează evicția — instanță nouă de `ChatDO` peste **același** storage și aceeași
bază — deci prinde regresia în secunde, local. Refuză explicit designul „buffer în
memorie + flush periodic”: la baseline, pe codul vechi, 11 din 14 verificări picau.
`tests/chat-d1.mjs` (nou, 8 verificări) scrie un mesaj pe chatul local și apoi
citește **fișierul SQLite al D1-ului** din `.wrangler/state` — nu o bază falsă, nu
un mock: ori rândul e în tabel, ori testul pică. O bază falsă nu se plânge de SQL
greșit, iar exact asta a lăsat bug-ul nevăzut o săptămână. În plus,
`tests/scripts-health.mjs` compară acum numărul de coloane cu numărul de valori la
toate instrucțiunile `INSERT` din `src/` (28 verificate) — garda statică prinde
greșeala în 50 ms, înainte de orice deploy.

Pe live, dovada o dă **canarul** din secțiunea 17 a relay-ului: cont temporar,
un mesaj normal + un sticker scrise pe chatul real, așteptate 20 de secunde (o
alarmă întreagă), apoi citite din D1 și șterse.

**Rezultatul canarului, pe producție** (rularea relay din 2026-09-23, commit `1dff223`):

```
✅ cont temporar creat: canar74bc674a (id 23)
✅ WebSocket deschis pe chat-ul live
✅ mesajul a fost difuzat live        ✅ stickerul a fost difuzat live
   … aștept 20s (fereastra de flush)
✅ istoricul de la reconectare conține ambele (30 mesaje)
dovezi în D1 (rândurile canarului, citite direct din baza de date):
   id 31  canar-2026-09-23T21:43:21   2026-09-23 21:43:23
   id 32  [sticker:naruto]            2026-09-23 21:43:25
mesajul e ÎN D1: da        stickerul e ÎN D1: da
după curățenie: 30 rânduri în chat_messages, 3 conturi
```

Cu o săptămână înainte, aceleași două mesaje nu lăsau **nimic** în tabel
(`0 în ultimele 24h`), iar cel mai recent rând era din 14 septembrie. Deploy-ul
care a urcat fix-ul: worker `anime-uke-do` republicat + Pages `?v=1dff223`.

**Dovada din viața reală** (rularea relay din 2026-09-24, secțiunea 16):
proprietarul a scris el însuși un sticker pe chatul live la 18:02, iar baza de
date îl arăta la 18:24 — `id 35 · mariusuke · [sticker:chopper] · 2026-09-24 18:02:12`,
singurul rând din ultimele 24 de ore și din ultimele 7 zile (restul tabelelor
erau deja curățate de canar, care își șterge mesajele după fiecare verificare).

## 1h. Runda 9 (2026-09-24): funcționalități noi (catalog partajabil, episodul următor, „văzut")

Cerute de proprietar ca pasul 2 din „mai fain la site" (după aspect). Toate cu
buget zero: nicio migrare nouă, nicio cerere în plus pe prima pagină.

| Ce s-a adăugat | Cum se verifică |
|---|---|
| **Filtrele intră în URL** (`?gen=Acțiune&status=ongoing&sort=rating&page=2`) și butonul Înapoi scoate filtrul | dom-smoke: pagina montată pe `/?gen=…&status=ongoing&sort=title` cere serverului exact filtrul (nu catalogul implicit), selecturile preiau valorile, iar scoaterea unui filtru rescrie URL-ul; numărul de carduri = numărul de rânduri întoarse de API pentru acel filtru |
| **Sortarea „Cele mai bine notate"** | e2e: `?sort=rating` întoarce seriile notate ÎNAINTEA celor fără voturi; indexul `idx_series_rating` (0028) face sortarea fără să atingă rândul seriei |
| **Episodul următor** direct din cardul „Continuă vizionarea" | e2e: răspunsul `/api/continue` aduce `next_episode_id`/`next_episode_number`, verificate împotriva episodului următor real; dom-smoke: cardul terminat are butonul, iar click-ul mută ținta cardului pe episodul următor (și poate reveni) |
| **Marcaje ✓ Văzut / Început în lista de episoade** | e2e: episodul cu 15+ minute e marcat, cele neatinse nu, iar marcajul coincide cu cel din pagina episodului; dom-smoke: bara verde + eticheta apar pe cardul văzut, chihlimbar pe cel început. Fără sesiune, răspunsul nu conține deloc câmpul (zero citiri în plus) |

Trei lucruri învățate pe pielea noastră în runda asta, toate prinse de teste
înainte de deploy:

1. **D1 acceptă maxim 100 de parametri legați per interogare.** Marcajele de
   progres trimiteau un parametru per episod afișat; pe pagina 1 a unei serii
   lungi (100 de episoade) ieșeau 101 → 500, listă goală, în timp ce pagina 2
   mergea. Acum `IN (...)` se împarte în bucăți de 90.
2. **`idx_episodes_series` din 0001 e deja `(series_id, episode_number)`** —
   migrarea pe care o pregătisem pentru „episodul următor" a fost ștearsă înainte
   de commit: era un index duplicat. `EXPLAIN QUERY PLAN` confirmă
   „SEARCH e2 USING COVERING INDEX idx_episodes_series (series_id=? AND episode_number>?)”.
3. **`/api/genres` ținea în cache o listă goală o oră întreagă** — pe un catalog
   proaspăt (sau după un deploy, înainte de prima serie cu gen) filtrul de gen
   rămânea gol până la restart. Acum o listă goală se ține un minut.

`tests/scripts-health.mjs` verifică în plus **sintaxa întregului cod JS** (90 de
fișiere: `src/`, `public/assets/js/`, `worker-do/`, `cf-relay/`) — înainte doar
`tests/` și `scripts/` erau verificate, deci o eroare de sintaxă în front-end
ajungea până la deploy. Garda a prins-o imediat într-o rundă: o linie în care un
șir deschis cu `'` era închis cu `"` arăta perfect corect la citit.

Suita completă: scripts-health 28 · e2e 584 · dom-smoke 193 · chat-persist 14 ·
chat-d1 8 · counters 16 · theme-cache 7 · top-cache 17 · pixel-teme 8 · plafoane 13.

---

## 1i. Runda 10 (2026-09-24): viteză (chunk-uri la cerere, imagini dimensionate)

Cerută de proprietar ca pasul 3 din „mai fain la site" (după aspect și
funcționalități). Cifrele vin din `npm run weight`, care rulează pipeline-ul de
deploy pe o copie a repo-ului.

| Ce s-a schimbat | Dovada pe live (build `4b65b07`) |
|---|---|
| **Arta hero redimensionată** (1280 px/q≈90 → 1024 px/q72) | `/assets/img/hero-1.webp` → 200, **94.014 B** (era 168.738 B). Toate trei: 168+126+131 KB → 94+65+70 KB |
| **Preload-ul redundant scos** (imaginea e deja inline în HTML) | `curl /` nu mai conține `as="image" href="/assets/img/hero-1.webp"` |
| **Preconnect la hostul coperților** | `curl /` conține `preconnect … m.media-amazon.com` |
| **Code splitting**: bundle-ul paginii cere core-ul comun dintr-un chunk separat | §19 din relay: `page-index.js` importă `c-DAH2Y522.js` → 200, 21.746 B; auditul §9: pe calea critică **13,9 KB comprimat** (entry + 1 chunk), cache `immutable` |
| **chat.js amânat** (import dinamic în chunk-ul comun) | §19: `import("./c-OJMPPHBS.js")` → 200, 14.755 B (5.167 B brotli pe live); auditul: „chat-ul (c-OJMPPHBS.js) e în afara ei" |
| **Bundle-ul e identic cu și fără `?v=`** | md5 `7dd481d4aa9c5e87c839ef6448fc9c5a` în ambele cazuri — fără copie veche la margine |
| **Markerii rundei 2 supraviețuiesc split-ului** | §19: `auk-continue-next` încă e în bundle-ul publicat |

Auditul complet pe build-ul de producție: **✅ 186 · 🟡 0 · 🔴 0 · ℹ️ 35**
(două verificări noi de chunk-uri + una de cache `immutable`, toate verzi).
Canarul de chat (§17) a trecut integral în aceeași rulare: mesaj + sticker în
D1 (id 45/46), curățenie completă.

Ce NU s-a putut verifica din exterior: cât de repede se simte site-ul într-un
browser real (LCP/TBT). Ce s-a verificat: octeții care se descarcă și numărul
de cereri de pe calea critică — restul ține de rețea și de dispozitiv.

## 1j. Runda 11 (2026-09-24): viteză, pasul 2 — arta hero în AVIF

Continuarea pasului 3 din „mai fain la site". Aici imaginea hero (cea care dă
LCP-ul primei pagini) a trecut de la WebP la AVIF, cu `<picture>`:

```html
<picture>
  <source type="image/avif" srcset="/assets/img/hero-1.avif">
  <source type="image/webp" srcset="/assets/img/hero-1.webp">
  <img class="hban__bg-img" id="hero-bg-img" src="/assets/img/hero-1.jpg"
       alt="" fetchpriority="high">
</picture>
```

| Ce s-a schimbat | Dovada pe live (build `d8ad136`) |
|---|---|
| **AVIF (q50) înaintea WebP-ului** | §19 din relay: `hero-1.avif: 56.083 B (image/avif)` lângă `hero-1.webp: 94.014 B` · audit: `AVIF mai mic decât WebP (53.136 vs 88.983 B, −40%)` |
| **Trei formate, un singur drum** | audit: „prima pagină folosește `<picture>` cu AVIF → WebP → JPEG" ✅ |
| **Rezerva JPEG nu mai e o a doua cerere** | cel mult o referință la `.jpg` în HTML (rezerva din `<img src>`) și **fără** `rel=preload as=image` pe hero — ambele verificate de audit |
| **Pe disc** | hero 1/2/3: 94+65+70 KB (WebP q72) → **56+45+54 KB** (AVIF q50), −33% |

Două buguri reale, prinse pentru că blocul de hero a început să ruleze în
dom-smoke (lipsurile din jsdom — WAAPI și layout — le ascundeau):

1. `bg.appendChild(img)` detașa `<img>`-ul din `<picture>`, deci sursele
   AVIF/WebP nu se aplicau niciodată și browserul descărca JPEG-ul de rezervă.
   Reparat: re-atașare doar dacă e detașat (`if (!img.parentNode)`).
2. Când hero-ul arată coperta seriei, sursele din HTML (AVIF/WebP de bundle) ar
   fi bătut coperta. Reparat: `clearHeroArt()` golește sursele în starea de
   copertă.

Testele intră de acum în CI (`tests.yml`, la fiecare push, fără secrete):
dom-smoke a urcat de la 193 la **201** verificări (hero-ul e verificat în ambele
stări: artă din bundle și copertă de serie), iar `measure-weight` are buget de
AVIF (≤70 KB) separat de rezerva WebP (≤110 KB).

Auditul complet pe build-ul de producție: **✅ 190 · 🟡 0 · 🔴 0 · ℹ️ 36**.

## 1k. Runda 12 (2026-09-25): buget 0 (poll adaptiv) + incidentul tokenului Cloudflare

Context: deploierile au picat o oră cu „Secretul CLOUDFLARE_API_TOKEN nu e setat pe
repo” — site-ul live a rulat tot timpul (doar canalul de deploy era blocat). Tokenul
a fost readus, iar secretul `CLOUDFLARE_ACCOUNT_ID` s-a dovedit invalid (53 caractere,
nu 32 hex → CF error 7003). Relay-ul a fost întărit în 3 commituri: alegerea
automată a contului care vede D1-ul `anime-db`, oprirea cu exit code-ul deploy-ului
la eroare, rezultatul în comentariu pe commit (canalul de citire din sandbox,
vezi AGENTS.md §3).

| Verificare pe live (build `?v=277c5ed`, 18:43–18:45 UTC) | Rezultat |
|---|---|
| `deploy.sh` complet (D1, migrări, DO, Pages, JWT) | `exit 0`; assete versionate `?v=277c5ed`, cache immutable, `_routes.json`, CSS purgat, 9 fișiere minificate |
| Canarul de chat (cont temporar, mesaj + sticker) | OK — ambele rânduri citite direct din D1 (`chat_messages` 71/72), apoi curățenie fără urme |
| `adaptivePoll()` publicat (marker `auk-adaptive`) | 2 apariții în chunk-ul comun `c-UTCDOFMM.js` (25 243 B, immutable) |
| `/api/pulse` | `{"series":5,"episodes":5,"members":3,"views":7,"online":0}` — viu, contoarele 0028 confirmate |
| Funcționalitățile rondelor 7–11 (nota pe carduri, catalog partajabil, AVIF, sticky filters…) | toate prezențe în build-ul publicat (secțiunile 15–19 din `cmd.sh`) |
| Audit live complet | **✅ 190 · 🟡 0 · 🔴 0 · ℹ️ 36** — „niciuna — auditul a trecut curat” |
| Consum cote gratuite (ziua UTC) | Invocări 2,2% · D1 citire 0,2% · D1 scriere 0,2% · DO 0,4% |

Lecția: când deploierele pică instant, primul loc deuit e `cf-relay/last-output.txt`
sau comentariul pe commit — verificarea de secret e *înainte* de `cmd.sh`, cu
diagnostic clar. Verificările e2e/CI nu acoperi accesul la Cloudflare: doar un
deploy real pe live o face.

## 1l. Runda 13 (2026-09-26): notificări de prietenie

Sistemul `/api/friends` (PR #7, migrarea 0029) trimitea cereri în tăcere: destinatarul
afla de existența unei cereri doar dacă se uita pe profil. Runda adaugă notificările
în clopot — `friend_request` la trimitere, `friend_accepted` la acceptare (inclusiv la
acceptarea automată, către cel care ceruse primul). Fără migrare nouă: tipurile sunt
un catalog în `src/lib/notify.js`, iar `payload` (JSON) poartă `username`, ca notificarea
să aibă link către profil.

| Verificare pe live (build `?v=205f42b`, 26.09, post-merge PR #11) | Rezultat |
|---|---|
| `deploy.sh` complet din `main` (merge-ul declanșează deploy din git, relay-ul readuce forma optimizată) | `exit 0`; assete versionate `?v=205f42b`, cache immutable, `_routes.json`, CSS purgat, 10 pagini bundle-uite |
| Canarul de prietenie (`cf-relay/friends-canar.mjs`, §17b în `cmd.sh`) | OK — cont B trimite cerere lui A, A are notificarea „…ți-a trimis o cerere de prietenie” (badge 1), A acceptă, B are „…ți-a acceptat cererea de prietenie” (badge 1) |
| Dovada în D1 (rândurile citite direct din tabel) | `notifications`: `friend_request` către A cu `payload {"username":"canarp…b","user_id":42}` + `friend_accepted` către B — ambele `read=0`, apoi curățenie fără urme (conturile „canarp%” șterse, contor `users_total` realiniat) |
| Linkul din notificare către profil | marker `/profile?u=` prezent în chunk-ul comun publicat (1 apariție) |
| Audit live complet | **✅ 190 · 🟡 0 · 🔴 0 · ℹ️ 36** — „niciuna — auditul a trecut curat” |
| Consum cote gratuite (ziua UTC) | Invocări 0,1% · D1 citire 0,02% · D1 scriere 0,04% · DO 0% |

Curățenie de repo în aceeași rundă: **PR #8** (`arena/01a0d983-anime-uke`, „buget 0: poll
adaptiv”) a fost închis — conținutul lui de cod era deja în `main` prin PR #9/#10, iar
singura diferenție rămasă era `cf-relay/last-output.txt` (un log de CI).

## 4. Cum se re-rulează auditul

```bash
# local, pe dev.sh (probele de minificare/?v= se sar automat — IS_PROD=false):
npm run dev &
node scripts/audit-live.mjs http://localhost:8788

# pe live, prin relay (sandbox-ul nu are acces la pages.dev):
#   cf-relay/cmd.sh:  ./deploy.sh && node scripts/audit-live.mjs https://anime-uke.pages.dev
#   git add cf-relay/cmd.sh && git commit -m "relay: audit live" && git push
#   rezultatul ajunge în cf-relay/last-output.txt (vezi AGENTS.md §3)
```

Auditul iese cu cod 1 dacă există 🔴, deci poate fi folosit ca poartă de deploy.
