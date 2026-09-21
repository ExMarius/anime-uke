# Audit live — https://anime-uke.pages.dev

**Data:** 2026-09-21 · **Rulat prin:** relay GitHub Actions (`cf-relay/cmd.sh` → `node scripts/audit-live.mjs`)
**Mod:** read-only, fără credențiale · **Scor final:** ✅ **168** · 🟡 **0** · 🔴 **0** · ℹ️ 32
**Build auditat:** `?v=1a11f03` (wrangler 4.131.2, migrări 0001–0025 aplicate remote, fără migrări noi)

| Rundă | Scor | Ce a fost |
|---|---|---|
| 1 (înainte de reparări, build `eb03ecd`) | ✅ 144 · 🟡 19 · 🔴 2 | auditul inițial: 2 probleme reale + 19 observații |
| 2 (după reparări, build `55a3027`) | ✅ 162 · 🟡 0 · 🔴 0 | „niciuna — auditul a trecut curat” |
| 3 (SSR episod, build `0936caa`) | ✅ 168 · 🟡 0 · 🔴 0 | +6 probe noi (2 episoade × JSON-LD/og:type/200), toate verzi |
| 4 (fix-uri verificare totală, build `1a11f03`) | ✅ 168 · 🟡 0 · 🔴 0 | CSP per-directivă, HSTS pe API, rute moarte scoase — curat |

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
