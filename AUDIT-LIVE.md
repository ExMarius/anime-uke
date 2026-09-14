# Audit live — https://anime-uke.pages.dev

**Data:** 2026-09-14 · **Rulat prin:** relay GitHub Actions (`cf-relay/cmd.sh` → `node scripts/audit-live.mjs`)
**Mod:** read-only, fără credențiale, fără deploy · **Scor:** ✅ 144 · 🟡 19 · 🔴 2 · ℹ️ 31
**Build auditat:** `?v=eb03ecd` (wrangler 4.131.2, migrări 0001–0025 toate aplicate remote)

> Raportul e o poză a stării live. Nimic din lista de mai jos nu a fost modificat în cod —
> așteaptă aprobarea proprietarului (vezi „Propuneri de reparare”).

---

## 1. Ce e sănătos (verificat pe live, nu doar în cod)

| Zonă | Rezultat |
|---|---|
| **Headere de securitate** | CSP strict fără `unsafe-inline`/`unsafe-eval`, `frame-ancestors 'none'`, HSTS 1 an, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP |
| **Cookie de sesiune** | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` la logout — JS nu-l poate citi |
| **CSRF** | `POST /api/auth/register` și `/login` cu `Origin: https://evil.example` → **403**; fără `Origin` (curl/navigare) → 401, deci nu se blochează fluxurile normale |
| **Rate limit** | login: al 10-lea eșec → **429** (limita din cod 10/5 min/IP) · register: a 5-a cerere → **429** (5/oră/IP) |
| **Drepturi API** | toate cele 20 de rute admin/privilegiate probeate → **401** fără sesiune (stats, users, series, episodes, log, reports, mods, rank-themes, episode-sources, leaderboard, factions, economy, shop, missions, notifications, watchlist, profile, continue, ranks, chests) |
| **Pagini protejate** | `/profile`, `/shop`, `/admin`, `/admin/serii`, `/admin/serie/1` → **302 `/login?next=…`** (destinația se păstrează) |
| **Validare** | `/api/series/1' OR '1'='1` → **400**; register cu date invalide → **400**; metodă greșită → **405 + `Allow`**; `/api/*` necunoscut → 401 (nu dezvăluie tabela de rute) |
| **Scurgeri** | niciun token/cheie/UUID/parolă hardcodată în cele 8 bundle-uri JS publice; `database_id` D1 nu apare în client |
| **Fișiere sensibile** | `/.git/config`, `/migrations/*.sql`, `/.dev.vars`, `/wrangler.toml` → **404** |
| **SEO on-page, pagina principală** | title 44 car., meta description 160 car., canonical, 6 taguri `og:*`, twitter card, `lang="ro"`, toate assetele cu `?v=` |
| **SEO serii** | `/serie/1017…1019` → 200 cu title/description/canonical/og + **JSON-LD `TVSeries`** (alternateName, countryOfOrigin, contentRating, sameAs) |
| **Performanță** | HTML/CSS/JS servite cu **brotli**; JS total **258 KB** comprimat (8 bundle-uri, fără framework); assetele cu `?v=` au `max-age=31536000, immutable`; imaginile au cache 30 zile; `/` 391 ms, `/series` 35 ms, `/api/series` 133 ms |
| **Imagini** | negocierea WebP funcționează (`hero-1.jpg` 202 KB → 168 KB webp) |
| **Chat** | `/chat` fără upgrade → 401; cu `Origin` străin + handshake WebSocket → nu se face upgrade |
| **Sitemap/robots** | `robots.txt` declară `Sitemap:`; sitemap XML valid, 7 URL-uri, toate pe originea canonică, fără duplicate; `llms.txt` 557 car.; `speculationrules.json` 200 |
| **Buget $0 (D1 remote)** | 31 tabele, volumuri mici: `users` 3, `anime_series` 5, `episodes` 5, `episode_sources` 5, `chat_messages` 30, `watch_progress` 8, `admin_log` 53, `rank_themes` 22. Nimic aproape de cotele gratuite (100k scrieri/zi, 5 GB citiri/zi, 500 MB) |
| **Migrări** | `No migrations to apply!` — schema remote e la zi (0025) |

---

## 2. 🔴 De reparat (2 probleme reale)

### A. Soft 404: seriile și episoadele inexistente răspund cu **200**
`GET /serie/99999999` și `GET /episod/99999999` întorc **200** cu shell-ul paginii; abia JavaScript-ul
afișează „Seria nu există.” (`page-series.js` tratează corect 404 de la API, dar HTML-ul vine deja cu 200).

* De ce contează: Google le clasifică drept **soft 404** — le indexează ca pagini goale, iar crawlerul
  pierde buget pe URL-uri inventate (scanerele generează mii de id-uri aleatorii).
* Unde e în cod: `serveStatic()` în `src/worker.js` — SSR-ul „lite” există doar când seria **e** găsită;
  când nu e găsită, răspunsul assetului (`series.html`) trece mai departe cu 200.
* Reparare propusă: în `serveStatic()`, pentru `/serie/<id>` fără rând în D1 și pentru `/episod/<id>`
  fără episod, întoarce **404** cu un head SEO curat (`<title>Serie inexistentă`, `robots: noindex`).
  Cost: 1 citire D1 pe URL necunoscut — de ținut sub control printr-un cache negativ scurt (60 s) în izolat.

### B. `/series` (fără id) e o pagină moartă, dar e **în sitemap**
`GET /series` → **200**, title „Serie • anime-uke”, **fără** meta description, **fără** canonical, **fără** og:*.
`page-series.js` face `location.replace('/')` când lipsește id-ul, deci utilizatorul ajunge pe prima pagină —
dar crawlerul vede o pagină de calitate slabă la un URL declarat oficial în `sitemap.xml`.
`/series/` (cu slash) e și mai rău: cade pe poarta de auth → `302 /login?next=%2Fseries%2F`.

* Reparare propusă: **301 server-side** `/series` → `/` (catalogul e deja pe prima pagină) și `/series` scos
  din `sitemap.xml` (sau păstrat doar `/` + `/serie/<id>`). Alternativ, dacă `/series` trebuie să rămână
  „catalogul dedicat”, atunci are nevoie de head complet (title/description/canonical/og) — decizie de produs.

---

## 3. 🟡 De verificat (nu strică nimic azi)

| # | Constatare | Impact | Propunere |
|---|---|---|---|
| C | 11 căi de repo răspund `302 /login?next=…` în loc de 404: `/package.json`, `/deploy.sh`, `/dev.sh`, `/test.sh`, `/AGENTS.md`, `/schema.sql`, `/src/worker.js`, `/cf-relay/cmd.sh`, `/wrangler.prod.toml`, `/.dev.vars.example`, `/node_modules/.package-lock.json` | **Conținutul nu scapă** (fișierele nu sunt în `public/`), dar statusul dezvăluie structura repo-ului și murdărește crawl-ul | extinde protecția din `serveStatic()`: orice cale care nu e pagină cunoscută / API / asset → **404** în loc de redirect la login |
| D | `/login` și `/register` n-au canonical și n-au og:* (au description și `lang="ro"`) | minor SEO; risc mic de duplicat cu `?next=…` | canonical + `robots: noindex,follow` pe paginile utilitare (deja sunt excluse din sitemap) |
| E | lipsește `Cross-Origin-Resource-Policy` | minor; `X-Frame-Options: DENY` + `frame-ancestors 'none'` acoperă deja încadrarea | adaugă `Cross-Origin-Resource-Policy: same-origin` (sau `cross-origin` pentru assete, dacă apar embed-uri externe) |

---

## 4. Ce nu poate acoperi auditul (fără cont)

Auditul rulează fără credențiale, deci **nu** probează: login real, drepturile helper/staff/moderator,
shop/cufere/misiuni, alegerea de facțiune, comentarii și review-uri ca user, panoul admin, chat autentificat.
Acestea sunt acoperite local de `tests/e2e.mjs` (455) + `tests/dom-smoke.mjs` (147) + `tests/caps-e2e.mjs` (13) —
toate verzi pe build-ul auditat.

Dacă vrei și o verificare live cu sesiune, am nevoie de un cont de test (sau de aprobarea să creez unul
temporar pe live și să-l șterg după).

---

## 5. Cum se re-rulează auditul

```bash
# local, pe dev.sh (probele de minificare/?v= se sar automat — IS_PROD=false):
npm run dev &
node scripts/audit-live.mjs http://localhost:8788

# pe live, prin relay (sandbox-ul nu are acces la pages.dev):
#   pune în cf-relay/cmd.sh:  node scripts/audit-live.mjs https://anime-uke.pages.dev
#   apoi:  git add cf-relay/cmd.sh && git commit -m "relay: audit live" && git push
#   rezultatul ajunge în cf-relay/last-output.txt (vezi AGENTS.md §3)
```
