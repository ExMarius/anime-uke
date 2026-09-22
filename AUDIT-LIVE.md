# Audit live — https://anime-uke.pages.dev

**Data:** 2026-09-22 · **Rulat prin:** relay GitHub Actions (`cf-relay/cmd.sh` → `node scripts/audit-live.mjs`)
**Mod:** read-only, fără credențiale · **Scor final:** ✅ **168** · 🟡 **0** · 🔴 **0** · ℹ️ 32
**Build auditat:** `?v=2db4976` (wrangler 4.131.2, migrări 0001–0025 aplicate remote)

| Rundă | Scor | Ce a fost |
|---|---|---|
| 1 (înainte de reparări, build `eb03ecd`) | ✅ 144 · 🟡 19 · 🔴 2 | auditul inițial: 2 probleme reale + 19 observații |
| 2 (după reparări, build `55a3027`) | ✅ 162 · 🟡 0 · 🔴 0 | „niciuna — auditul a trecut curat” |
| 3 (după optimizările de buget, build `2db4976`) | ✅ 168 · 🟡 0 · 🔴 0 | probe noi pe „ce nu trece prin worker” — toate verzi |

---

## 0. Sesiunea „buget 0": de ce site-ul nu mai poate pica la trafic

Planul gratuit dă **100.000 de invocări de Worker pe zi**, iar fiecare cerere care ajunge în
Pages Functions consumă una. Un vizitator fără cont cheltuia ~12 invocări (1 pagină + 6 assete +
5 cereri de API: `/series`, `/top`, `/recent`, `/genres`, `/pulse`). Acum cheltuie **~2**.

| Ce s-a schimbat | Efect | Dovada pe live (build `2db4976`) |
|---|---|---|
| `public/_routes.json`: `/assets/*`, `/`, `/login`, `/register`, `/episode` nu mai intră în worker | assetele = 0 invocări; o pagină statică = 0 invocări | `cache-control: public, max-age=31536000, immutable` (o singură valoare — înainte ieșea `no-cache, no-cache`, semnul trecerii prin worker) |
| `public/_headers`: headerele de securitate pentru căile ocolite | securitatea nu scade (paritate verificată automat) | CSP + HSTS + `X-Frame-Options` + `Permissions-Policy` + CORP prezente pe `/assets/css/style.css` (5/5); `/profile`, `/admin`, `/shop` încă 302 → `/login?next=…`; `/serie/99999999` → 404 |
| `/api/home`: prima pagină într-o singură cerere (catalog + topuri + ultimele episoade + genuri + „online") | 5 cereri de API → 1 | `/api/home` → 200 (public), agregare completă, 289 ms |
| imagini referite direct `.webp` (frați comiși în repo) | fără negociere pe server, fără cereri duble | `hero-1.webp` → 200 `image/webp` (168 KB vs 202 KB JPEG); pagina nu mai cere `.jpg`-ul (rămâne doar în `og:image`, pentru rețelele sociale) |

**Consum real, măsurat (`node scripts/usage.mjs` prin relay, ziua UTC 2026-09-22** — zi care
include toate deployurile, auditurile și suitele de teste ale zilei):

| Cotă gratuită | Consumat | Din plafon |
|---|---|---|
| Invocări Functions (Pages) | 6.410 | **6%** |
| D1 rânduri citite | 19.210 | 0% |
| D1 rânduri scrise | 219 | 0% |
| Durable Objects requests | 952 | 1% |
| DO durată | 1 GB-s | 0% |

**De făcut de proprietar (2 click-uri, gratuit):** dashboard → Workers & Pages → `anime-uke` →
Settings → Runtime → **Fail open**. Atunci, chiar dacă se epuizează cota, catalogul static
continuă să se încarce (nu pagina de eroare).

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

---

## 2. Ce e sănătos (verificat pe live, nu doar în cod)

| Zonă | Rezultat |
|---|---|
| **Headere de securitate** | CSP strict fără `unsafe-inline`/`unsafe-eval`, `frame-ancestors 'none'`, HSTS 1 an, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP |
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

1. **SSR SEO lipsește pe `/episod/<id>`** — paginile de episod au title generic „Episod • anime-uke”, fără
   description/og/JSON-LD, deși sunt paginile cu cel mai mare potențial de trafic organic („anime X episodul Y
   subtitrat în română”). Repararea cere o citire D1 per episod + cache (la fel ca la serii) și un bloc
   `VideoObject`/`BreadcrumbList` în JSON-LD. **Nu s-a făcut acum** — e feature nou, nu reparație.
2. **Canonical/og hardcodate pe `anime-uke.pages.dev`** în `index.html`, `login.html`, `register.html`. Când se
   adaugă domeniu propriu (`CANONICAL_ORIGIN`), aceste trei fișiere trebuie trecute pe originea canonică
   (sau injectate din worker, ca la `/serie/<id>`).
3. **`/episode` fără id** rămâne 200 (shell + JS). Nu e în sitemap și nu e link-uit; se poate aplica același 301
   ca la `/series` dacă se dorește consecvență. **Atenție la implementare:** shell-ul `/episode` e acum
   servit direct din stratul static (e în `public/_routes.json`), deci un 301 pentru cazul „fără id" ar
   trebui făcut fie din `_redirects`, fie scoțând ruta de sub bypass — nu din worker, care nu-l mai vede.
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
