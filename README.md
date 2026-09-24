# 🎌 anime-uke

Site de anime cu conturi, puncte pentru episoade vizionate, economie (XP / nivel / gold / cufere / misiuni / shop), facțiuni lunare, grade, panou admin și chat live.

**Stack:** Cloudflare Pages + D1 + Durable Objects + WebSockets · vanilla HTML/CSS/JS, fără framework
**Cost:** $0/lună — rulează integral în planul gratuit Cloudflare
**Live:** https://anime-uke.pages.dev

> **Lucrezi la proiect (om sau agent)?** Începe cu [`AGENTS.md`](AGENTS.md) — ghidul de predare
> (setup, ciclul de lucru, deploy prin relay, capcane, stare curentă, backlog). Acest README este
> harta tehnică: structură, grade și drepturi, arhitectură, API.

---

## Structură (tot ce e în repo are un rol)

```
public/                     assete statice + entrypoint
├── _worker.js              ENTRYPOINT Pages (Advanced Mode): exportă DO-urile + fetch
├── index.html              catalog + banner + chat
├── series.html             fișa unei serii (+ episoade, recenzii, „Episodul următor")
├── episode.html            player + surse + comentarii
├── profile.html            profil public / propriu, economie, facțiune, cufăr
├── shop.html               shop de cosmetice (gold)
├── login.html, register.html
├── admin.html              panou admin: Statistici · Utilizatori · Grade · Raportări · Jurnal
├── admin/serii.html        admin: lista seriilor
├── admin/serie.html        admin: o serie + episoadele + sursele ei  (/admin/serie/<id>)
├── _headers                headerele cailor care NU trec prin worker (paritate cu SECURITY_HEADERS)
├── _routes.json            scoate assetele + paginile publice statice de sub worker (buget 0!)
├── favicon.ico, apple-touch-icon.png
├── robots.txt, llms.txt, speculationrules.json
└── assets/
    ├── css/style.css       nucleu; page-admin.css, page-episode.css, page-user.css per pagină
    ├── img/hero-*.webp     bannerul hero (referit direct .webp; .jpg = rezervă)
    ├── img/logo*.webp|png  logo: .webp în pagină, .png pentru favicon/og:image
    ├── subs/demo-ro.vtt    subtitrare demo folosită de teste
    └── js/
        ├── core.js         api(), sesiune, nav, toast, badge-uri (staffBadge/rankChip), pulse
        ├── chat.js         WebSocket + fereastra de chat + regulament + stickere
        ├── auth.js         logica comună login/register
        ├── sources-ui.js   editorul de surse video (admin + raportare)
        └── page-*.js       un modul per pagină (page-index, page-series, page-episode,
                            page-profile, page-shop, page-admin, page-admin-serii, page-admin-serie)
src/
├── worker.js               fetch handler: rutare API, servire statică, SEO SSR, headere
├── router.js               TABELA DE RUTE — orice endpoint nou se înregistrează aici
├── routes/
│   ├── chat.js             upgrade WebSocket → ChatDO (cu identitatea userului)
│   └── api/                un fișier per endpoint (onRequestGet/Post/Patch/Delete)
│       ├── home.js         PRIMA PAGINA intr-o singura cerere (catalog+top+recent+genuri+pulse)
│       ├── auth/           register, login, logout, me, register-options
│       ├── admin/          series, episodes, episode-sources, users, mods, rank-themes, reports, stats, log
│       ├── series/by-id.js, episodes/by-id.js
│       └── …               comments, reviews, ratings, leaderboard, economy, chest(s), missions,
│                           shop(-buy/-activate), factions, notifications, profile, watchlist, …
├── do/                     Durable Objects: ChatDO, RateLimitDO, StatsDO
└── lib/                    session (auth + drepturi), ranks (grade), crypto, jwt, http, validate,
                            ratelimit, audit, xp, shop, missions, factions, notify, profile, sources, limits, paging
worker-do/                  Worker separat care GĂZDUIEȘTE DO-urile în producție (vezi mai jos)
migrations/                 schema D1 = suma migrărilor 0001…0025 (NU există alt schema.sql)
scripts/
├── purge-css.mjs           rulat de deploy.sh: scoate CSS-ul mort (safelist pentru clase dinamice!)
├── audit-live.mjs          audit read-only al sitului (pagini, SEO, securitate, API, CSRF, rate limit, assete)
├── usage.mjs               „cât din cota gratuită am consumat azi" (GraphQL Analytics, read-only)
├── bench-scale.mjs         „duce 1000 de serii / 1000 de useri?" — rândurile citite de fiecare interogare
└── seed.mjs                catalog de demo prin API, pe serverul local
tests/
├── e2e.mjs                 suita API completă (local)          ┐
├── dom-smoke.mjs           paginile în jsdom (local)           │
├── chat-persist.mjs        chatul supraviețuiește evicției DO  │
├── chat-d1.mjs             mesajul ajunge chiar în tabelul D1  ├─ ./test.sh le rulează pe toate
└── caps-e2e.mjs            plafoanele LIMIT_USERS/LIMIT_SERIES ┘
    (verificarea pe producție = scripts/audit-live.mjs, prin relay; vechiul
    prod-smoke.mjs a fost șters — descria site-ul privat cu invitații.)
cf-relay/                   cmd.sh = comanda rulată de GitHub Actions; last-output.txt = rezultatul
.github/workflows/cloudflare-relay.yml
AGENTS.md                   ghid de predare pentru următorul care lucrează (CLAUDE.md trimite la el)
AUDIT-LIVE.md               ultimul audit al producției: ce s-a verificat, ce s-a reparat, ce a rămas de decis
dev.sh · test.sh · deploy.sh
wrangler.prod.toml (șablon producție) · wrangler.local.toml (dev) · wrangler.migrate.toml (doar migrări)
wrangler.toml               = copia ACTIVĂ; dev.sh o înlocuiește temporar cu cea locală și o restaurează la ieșire
```

Fișiere care **nu** există intenționat: `schema.sql` (schema = migrările), `push.sh`, seed-uri de
scară / SQL generat, `public/covers/` (coperțile sunt URL-uri externe în DB; cardurile fără copertă
primesc un poster procedural din `core.js`).

---

## Grade și drepturi (sursa unică de adevăr)

Există **două sisteme complet separate**, ambele afișate lângă nume în chat, comentarii, recenzii, clasament și profil:

| | Grade de **nivel** | Grade de **staff** |
|---|---|---|
| Ce sunt | Genin → Chunin → … → Hokage (sau altă temă) | 🤝 Helper · ⭐ Staff · 🛠️ Moderator · 🛡️ Admin |
| Cum se obțin | **automat**, din `users.level` (XP) | **manual**, de admin, din `/admin` → tabul „Grade" |
| Unde stau | `rank_themes` (temele) + `users.rank_theme` (tema aleasă de user) | `users.staff_role` = `''｜helper｜staff｜moderator` și `users.is_admin` |
| Cod | `rankForUser()` în `src/lib/ranks.js` | `staffRole()` în `src/lib/ranks.js` |
| Randare | `rankChip()` (`.uchip`) | `staffBadge()` / `staffIcon()` (`.ubadge--admin/mod/staff/helper`) |
| API | `GET /api/ranks`, `POST /api/me/theme`, `/api/admin/rank-themes` | `GET/POST /api/admin/mods` `{ username, role }` |

**Drepturi** (`src/lib/session.js`):

- `is_admin` → tot (panou admin, `requireAdmin`). Adminii se numesc din tabul **Utilizatori** (`set_role`), nu din „Grade".
- `canModerate(user)` = Admin **sau** `staff_role === 'moderator'` → poate șterge comentariile altora (`requireModerator` pentru rute noi de moderare). Sesiunea expune `can_moderate` clientului.
- Helper și Staff sunt **doar badge-uri**, zero drepturi.
- Coloana veche `users.is_mod` a fost absorbită în `staff_role` (migrarea 0025) și **nu mai e citită de cod**.

Facțiunile (`src/lib/factions.js`, `/api/factions`) sunt un al treilea lucru: o alegere lunară a userului, care îi setează automat tema de grade de nivel. Nu au legătură cu staff-ul.

---

## Cum lucrezi

```bash
npm install                     # Node 22+
cp .dev.vars.example .dev.vars  # JWT_SECRET local
npm run dev                     # ./dev.sh → http://localhost:8788 (aplică migrările locale)
npm run seed                    # opțional: catalog de demo (vezi antetul scripts/seed.mjs)
npm test                        # ./test.sh: sănătatea scripturilor + e2e + dom + teme + plafoane (~1 min)
npm run usage                   # consumul de azi din cotele gratuite (token + permisiune de analytics)
```

Reguli care evită surprize:

1. **Orice schimbare de schemă = o migrare nouă** `migrations/00NN_*.sql`. `deploy.sh` le aplică automat pe D1 remote; `dev.sh`/`test.sh` local.
2. **Orice endpoint nou** se adaugă în `src/router.js` (metoda `'*'` dacă fișierul are mai mulți handleri).
3. **Clasele CSS construite dinamic în JS** (`'ubadge ubadge--' + x`) trebuie adăugate în safelist-ul din `scripts/purge-css.mjs`, altfel dispar din producție.
4. **Pentru fiecare feature scrie verificări** în `tests/e2e.mjs` (API) și/sau `tests/dom-smoke.mjs` (pagini). `./test.sh` trebuie să fie verde înainte de deploy.
5. **Pagină nouă în `public/`?** Adaug-o în `STATIC_PAGES` din `src/worker.js` — altfel ruta cade pe allowlist și primește 404.
6. **Rute „inexistente” trebuie să dea 404 real** (nu 200 cu shell gol și nici 302 spre `/login`): așa le tratează
   `serveStatic()` pentru `/serie/<id>` și `/episod/<id>`, iar allowlist-ul pentru orice altă cale necunoscută.
5. `wrangler.toml` apare modificat cât timp rulează `dev.sh` — **nu-l comite** în starea aceea (e copia locală). La `git pull --rebase` cu dev.sh pornit: `git stash && git pull --rebase && git stash pop`.
6. Primul cont înregistrat pe o bază goală devine automat admin (bootstrap). Plafoane: 1000 useri / 1000 serii (`src/lib/limits.js`, suprascriibile prin `LIMIT_USERS`/`LIMIT_SERIES` la teste).

---

## Deploy

```bash
export CLOUDFLARE_API_TOKEN=...   # D1 Edit, Pages Edit, Workers Scripts Edit
npm run deploy                    # ./deploy.sh
```

`deploy.sh` rulează în ordinea obligatorie: **D1 → migrări → Worker DO (`anime-uke-do`) → Pages → JWT_SECRET**,
purgă CSS-ul mort, bundle-uiește/minifică JS-ul per pagină și versionează assetele cu `?v=<commit>`.

**Fără acces de rețea la Cloudflare** (ex. sandbox de agent): scrie comanda în `cf-relay/cmd.sh`, comite pe un
branch `arena/**`, push. Workflow-ul `cloudflare-relay` o rulează pe un runner GitHub (token-ul e în secretul
repo-ului `CLOUDFLARE_API_TOKEN`, niciodată în cod) și comite rezultatul în `cf-relay/last-output.txt`.
Deploy complet = `cmd.sh` apelează `./deploy.sh`.

### De ce există `worker-do/`

Cloudflare Pages nu poate găzdui clase Durable Object în producție. Advanced Mode (`public/_worker.js` cu
`export { ChatDO }`) merge doar local, în miniflare. De aceea DO-urile trăiesc în Worker-ul `anime-uke-do`
(`worker-do/`), iar Pages le leagă prin `script_name = "anime-uke-do"` (în `wrangler.prod.toml`).
Local, `wrangler.local.toml` le rulează inline ca să nu fie nevoie de un al doilea proces.

---

## De ce arhitectura asta (buget zero)

Limitele planului gratuit care contează: Workers 100k req/zi · 10 ms CPU; D1 5M rânduri citite / 100k **scrise** pe zi;
DO 100k req/zi. Depășirea cotelor D1 produce eșec hard până la 00:00 UTC, deci scrierile sunt minimizate agresiv.

### Optimizări de buget (toate deliberate, nu accidentale)

0. **Assetele si paginile publice statice NU trec prin worker.** `public/_routes.json`
   scoate `/assets/*`, `/`, `/login`, `/register`, `/episode`, `/favicon.ico`,
   `/apple-touch-icon.png`, `/robots.txt`, `/llms.txt`, `/speculationrules.json` de sub
   Pages Functions: fiecare cerere care ajunge în worker consumă o invocare din cota
   gratuită de 100.000/zi, iar un vizitator face 1 pagină + ~6 assete + 2-3 cereri de API.
   Headerele de securitate pentru căile ocolite vin din `public/_headers` (identice cu
   `SECURITY_HEADERS` din worker — `tests/e2e.mjs` verifică paritatea la fiecare rulare).
   `deploy.sh` refuză publicarea fără `_routes.json`.
1. **Chat-ul nu scrie în D1 la fiecare mesaj, dar nici nu pierde nimic.** Fiecare mesaj se scrie instant în
   **storage-ul durabil al DO-ului** (`state.storage.put` — operațiile de storage nu sunt cereri facturate),
   iar arhivarea în D1 se face în loturi, la 10 mesaje sau prin alarma de 15 secunde. Bufferul trăiește în
   storage, nu în memorie: la evicția DO-ului (WebSocket Hibernation) mesajele sunt tot acolo, iar alarma le
   scrie dintr-o instanță nouă. ~10× mai puține scrieri în D1, zero mesaje pierdute.
   *De ce a fost nevoie de asta:* varianta veche ținea bufferul în memorie, iar în producție DO-ul e evacuat
   între mesaje — deci pe un site mic nimic nu ajungea în D1, deși local (miniflare, fără evicție) toate
   testele treceau. Vezi `tests/chat-persist.mjs` și secțiunea „canar" din `cf-relay/cmd.sh`.
   *(Al doilea bug, ascuns în spatele primului: `INSERT INTO chat_messages` avea 11 coloane și doar 10
   parametri, deci D1 refuza fiecare scriere — acum e prins static de `tests/scripts-health.mjs` și
   „pe viu" de `tests/chat-d1.mjs`, care citește tabelul din fișierul SQLite local.)*
2. **Contorul de vizualizări nu scrie în D1 la fiecare view.** `StatsDO` acumulează și scrie o dată la 20 views / 30 secunde, cu deduplicare pe 10 minute. ~20× mai puține scrieri.
3. **Istoricul chat-ului vine din storage-ul DO-ului** (ultimele 30 de mesaje, o listare de chei — milisecunde,
   zero rânduri D1); D1 e consultat doar pentru completarea arhivei mai vechi. v1 făcea un `SELECT` la fiecare socket nou.
4. **Rate limiting doar pe rute sensibile** (login, register, watch, admin). Fiecare verificare costă 1 request DO, deci GET-urile publice nu trec pe acolo.
5. **Endpoint-uri combinate**: `/api/series/:id` returnează seria *și* episoadele ei
   într-un singur apel; `/api/home` aduce TOATĂ prima pagină (catalog + topuri + ultimele
   episoade + genuri + contorul „online") într-o singură invocare, în loc de cinci.
   Pagina mai face apoi doar cererile de sesiune (`/auth/me`, `/continue`,
   `/notifications/unread`).
6. **Imaginile sunt referite direct `.webp`** (hero, logo), cu `.png`/`.jpg` păstrate pentru
   favicon, `og:image` (rețelele sociale nu acceptă WebP) și ca rezervă. Fără negociere pe
   server: assetul nu mai trece prin worker, deci nu mai există două cereri per imagine.
7. **Indexuri pe fiecare coloană folosită în `WHERE`/`JOIN`** — pe D1 se taxează rândurile *scanate*, nu cele returnate.
8. **Fără Tailwind CDN** (v1 încărca ~300 KB JS pe fiecare pagină). Un singur CSS de câțiva KB, cache-abil.
9. **WebSocket Hibernation API** în `ChatDO` — DO-ul nu consumă CPU cât timp e idle.
10. **Cache-Control-ul assetelor vine din `public/_headers`**, nu din cod: `deploy.sh`
    înlocuiește „no-cache" cu `immutable` 1 an pentru JS/CSS (toate referințele din HTML
    poartă `?v=<commit>`, iar `page-*.js` sunt bundle-uite). Zero revalidări, zero cereri
    care să ajungă în worker.

---

## Cum arată site-ul (runda de aspect, 2026-09-23)

Detalii care fac diferența la folosire zilnică, toate cu cost zero în buget
(zero cereri noi, zero imagini noi, zero biblioteci):

| Unde | Ce vezi | De ce |
|---|---|---|
| Cardurile de serie | **★ 8.7** lângă gen și an | nota vine în același răspuns de catalog (coloane denormalizate pe serie); apare doar dacă seria are voturi |
| „Continuă vizionarea" | bară de progres peste copertă + `40%` sau `12 min văzute` | durata vine din serie; fără durată completată scriem minutele reale, nu un procent inventat. `✓ Văzut` (verde) după pragul de 15 minute |
| Catalogul | filtrele (gen/status/sortare) rămân lipite sub navbar | la 1000 de serii nu mai urci până sus ca să schimbi genul; pe telefon rămân în flux |
| Orice pagină | buton **↑ înapoi sus** după două ecrane derulate | ascultător pasiv + rAF, deci nu încarcă derularea; ascuns pe paginile scurte |
| Căutarea | scurtătura **`/`** (scrie și sare în câmp), **Esc** golește | ca la GitHub/YouTube; indicată de un `<kbd>` vizibil doar pe desktop |

## Funcționalități noi (runda 2, 2026-09-24)

Tot cu buget zero — nicio cerere în plus pe prima pagină, nicio migrare nouă:

| Unde | Ce face | De ce așa |
|---|---|---|
| Catalogul | linkul păstrează filtrele: `/ ?gen=Acțiune&status=ongoing&sort=rating&page=2` | un catalog filtrat poate fi trimis cuiva; `pushState` la fiecare schimbare, deci butonul **Înapoi** scoate filtrul, nu te scoate de pe site. Căutarea folosește `replaceState` (altfel 10 litere = 10 intrări în istoric) |
| Sortarea | opțiune nouă **„Cele mai bine notate"** | citește direct indexul `idx_series_rating` (0028), nu rândul seriei; seriile fără voturi cad la final |
| „Continuă vizionarea" | când episodul e terminat, cardul duce **direct la episodul următor** | `next_episode_id` vine de la server, într-o singură căutare în `idx_episodes_series` (index compus din 0001) — nu e ghicit din numere, deci merge și cu goluri în numerotare |
| Cardul terminat | buton **⏭ Episodul următor / ↩︎ Reia episodul curent** | preferința stă în `localStorage`, nu pe server (zero scrieri în D1) |
| Lista de episoade | marcaj **✓ Văzut** (verde) / **Început** (chihlimbar) + bară laterală | o singură interogare pe cheia primară a lui `watch_progress` pentru toată pagina, **doar cu sesiune**; pentru vizitatori răspunsul e identic cu înainte. Prag de 30 s, ca la „Continuă vizionarea" |

Costul măsurat (bench-scale, 1.000 serii / 1.000 utilizatori): prima pagină
74 rânduri citite per vizită (era 64) — 414.904 rânduri/zi la 2.000 de vizite,
adică ~8% din cota de 5M. Invocările rămân 2 per vizită.

## Viteză (runda 3, 2026-09-24)

Aici nu s-a „optimizat" pe impresii: fiecare schimbare are cifra de dinainte și
de după, măsurate cu `npm run weight` (rulează exact pipeline-ul din `deploy.sh`
pe o copie a repo-ului: purge CSS → minificare → bundle cu code splitting).

| Ce | Înainte | După | De ce conta |
|---|---|---|---|
| Arta hero (bundled) | 168 + 126 + 131 KB (1280 px, q≈90) | **92 + 64 + 70 KB** (1024 px, q72) | imaginea e inline în prima pagină, deci intră direct în LCP; −197 KB fără nicio diferență vizibilă la 1080p |
| Formatul artei hero | un singur JPEG, apoi un singur WebP | **`<picture>`: AVIF → WebP → JPEG** (55 + 44 + 52 KB în AVIF) | AVIF e ~33% sub WebP pe aceeași imagine; browserul alege primul format pe care îl știe, fără negociere pe server. `setHeroArt()` schimbă toate sursele o dată la shuffle |
| `<link rel=preload>` pe hero | 1 cerere în plus | **scos** | `<img>`-ul era deja inline mai sus — preload-ul declanșa o a doua cerere pentru aceeași imagine |
| Coperți externe | 400 px pentru orice slot; thumbnail de 34 px → coperta întreagă | **`coverImg()`: `srcset`/`sizes` per slot** (grid 200/300/400, căutare & admin 120, poster serie 200/300/600) | cardul are 184 px pe desktop / 142 px pe telefon, iar browserul alege singur treapta (și ține cont de retina) |
| `chat.js` (14,4 KB minificat) | în **fiecare** bundle de pagină | **chunk comun, cerut la nevoie** (`import()` dinamic în `core.js`) | vizitatorul care nu deschide chatul nu-l mai descarcă și nu-și mai deschide socket-ul; se pornește o singură dată per pagină |
| Cod comun (`core.js`, `anim-bg.js`) | duplicat în fiecare bundle | **chunk cu hash de conținut**, cache 1 an | la navigare între pagini se descarcă o singură dată, nu la fiecare pagină |
| Măsurare | — | **`scripts/measure-weight.mjs` + bugete în `test.sh`** | o regresie (ex: chatul reintrat pe calea critică) pică testele, nu vizitatorii |

Greutatea măsurată pe pipeline-ul de deploy (gzip, „cale critică" = HTML + CSS +
JS de care pagina are nevoie ca să randeze; `amânat` = chunk-uri cerute la nevoie):

| Pagina | HTML | CSS | JS critic | amânat | Total |
|---|---|---|---|---|---|
| profile | 3,2 KB | 18,8 KB | 16,8 KB | 5,0 KB | 38,9 KB |
| episode | 3,9 KB | 19,1 KB | 14,7 KB | 5,0 KB | 37,7 KB |
| index | 4,2 KB | 16,3 KB | 13,9 KB | 5,0 KB | 34,4 KB |
| series | 2,6 KB | 16,3 KB | 13,8 KB | 5,0 KB | 32,7 KB |

Față de runda precedentă (aceleași pagini, același pipeline): prima pagină a
scăzut de la 37,3 KB la 34,4 KB pe calea critică, iar JS-ul ei de la 17,0 KB la
13,9 KB — restul de 5,0 KB (chatul) se cere doar dacă e folosit. La navigare
câștigul e mai mare: `core.js` + `anim-bg.js` (7,7 KB gzip) se descarcă o dată
per sesiune, nu la fiecare pagină. Bugetele (în `measure-weight.mjs`) sunt: cale
critică ≤ 45 KB, JS critic ≤ 19,5 KB, JS amânat ≤ 8 KB, CSS ≤ 22 KB, HTML ≤ 15 KB,
arta hero ≤ 70 KB (AVIF; rezerva WebP ≤ 110 KB), nicio imagine ≤ 130 KB.

---

## Cât duce planul gratuit (și ce faci când se apropie)

### „Duce 1.000 de utilizatori și 1.000 de serii?" — da, cu o condiție: să nu scanezi tabele

Plafoanele site-ului sunt 1.000 de conturi și 1.000 de anime-uri (`src/lib/limits.js`).
Întrebarea se poate răspunde doar măsurând, așa că există un banc de test care
construiește exact acea scară pe un D1 local (aceleași migrări ca producția) și
numără ce citește fiecare interogare fierbinte:

```bash
node scripts/bench-scale.mjs            # 1000 serii · 1000 useri · un an de activitate
node scripts/bench-scale.mjs --views 6000   # proiecția pentru alt trafic
```

Pe planul gratuit contează **rândurile citite** (5 milioane/zi), nu cererile. Vestea
bună: invocările nu sunt problema — o vizită costă ~2 din 100.000. Problema erau trei
interogări care scanau tabele întregi **la fiecare afișare a primei pagini**:

| Interogare (prima pagină) | Înainte | Acum | Ce a rezolvat-o |
|---|---|---|---|
| Top săptămânal (`watch_progress`, 7 zile) | **199.011** | **1** (din cache) / ~4.000 la recalcul orar | `idx_progress_updated` (0028) + cache de o oră în `leaderboard_cache` |
| Top notate (`series_ratings`) | **29.578** | **5** | media denormalizată pe serie + `idx_series_rating` (0028) |
| `pulse` (COUNT/SUM pe 3 tabele) | **41.576** | **4** | contoare în `site_meta` (0028), întreținute la scriere |
| Catalog 24 carduri | ≤1.000 | **≤25** | `idx_series_created_id` (0028) |
| Restul (sesiune, genuri, sitemap, notificări) | ~600 | ~600 (amortizat) | erau deja indexate |

**Rezultatul măsurat:** o vizită pe prima pagină a scăzut de la **~230.000** de rânduri
citite la **~64**, iar la 2.000 de vizite pe zi consumul ajunge la **~395.000 rânduri/zi
(8% din cotă)**. Plafonul de 5M/zi ar ține acum teoretic ~78.000 de vizite pe zi pe prima
pagină, în loc de ~21. Aceeași măsurătoare a arătat și ce NU era o problemă: scrierile
(heartbeat-ul de vizionare e la 2 minute, vizualizările se bat la 20 înainte de un flush
D1) și invocările.

Planurile de execuție sunt verificate **pe D1-ul de producție** la fiecare rulare a
relay-ului (`EXPLAIN QUERY PLAN`, secțiunea 14 din `cf-relay/cmd.sh`): topul săptămânal iese
`SEARCH w USING INDEX idx_progress_updated`, iar numărătoarea „scanări de `watch_progress`"
trebuie să fie 0.

Spațiul nu e o problemă la scara asta: baza sintetică de mai sus (1.000 de serii, 19.788 de
episoade, un an de istoric de vizionare pentru 1.000 de conturi) are **26 MB**, iar plafonul
gratuit e 500 MB pe bază. Crește cu istoricul de vizionare (o linie per utilizator+episod),
deci `npm run bench -- --keep` e modul cel mai rapid de a vedea unde ajungi.

Ce a rămas deliberat „scump" și de ce e în regulă: genurile (1.000 rânduri, o dată pe
oră), sitemap-urile (până la 6.000 rânduri, o dată pe oră, cerute de crawlere) și
recalculul topului săptămânal (o dată pe oră). Toate trei sunt în afara căii fierbinți,
deci nu cresc cu traficul. Dacă vreodată crește și numărul lor, pârghiile sunt în
`README`-ul de mai jos plus `TOP_CACHE_MINUTES` (cache-ul topului, în minute).


Cotele care contează: **100.000 invocări de Worker/zi** (Functions), **5M rânduri citite +
100.000 scrieri D1/zi**, **100.000 requests DO/zi**, 10 ms CPU/cerere. Toate se resetează la
**00:00 UTC**. Depășirea cotelor D1/DO oprește partea dinamică (site-ul static rămâne sus —
vezi „Fail open" mai jos).

**Costul unei vizite acum:**

| Ce | Înainte | Acum |
|---|---|---|
| Prima pagină (HTML + assete + logo) | 1 + 6 invocări | **0** (servește stratul static) |
| API pentru prima pagină | 5 (`/series` `/top` `/recent` `/genres` `/pulse`) | **1** (`/api/home`) |
| Sesiune (nav, puncte) | 1 | 1 |
| **Total vizitator fără cont** | **~12 invocări** | **~2 invocări** |
| **Rânduri citite din D1 / vizită** | **~230.000** | **~64** |

Cu ~2 invocări per vizită, 100k/zi înseamnă **zeci de mii de vizite pe zi**. Un vizitator
logat care se uită la un episod consumă în plus: `/api/episodes/:id`, `/api/view`, un
heartbeat la 2 minute (`/api/progress` = 1 invocare + 1 request DO + 1 scriere D1) și poll-ul
de notificări la 60 s cât timp ține tab-ul deschis. Când traficul crește, în ordinea în care
merită atinse:

1. **Fail open** (dashboard → Workers & Pages → `anime-uke` → Settings → Runtime): la
   epuizarea cotei, vizitatorii văd în continuare catalogul servit static, nu pagina de eroare.
2. **Poll-ul de notificări** (`core.js`, 60 s) — se poate lungi sau condiționa de vizibilitatea tab-ului.
3. **Heartbeat-ul de vizionare** (`page-episode.js` → `HEARTBEAT_SEND_MS`, `SEND_CAP` și
   `MAX_INCREMENT` din `src/routes/api/progress.js` — de ținut sincronizate): 2 → 5 minute
   scade de ~2,5× scrierile D1 din vizionare.
4. **Vezi scara**: `node scripts/bench-scale.mjs` spune ce ar costa fiecare interogare la
   1.000 de serii și 1.000 de utilizatori (și cât ar ține cota la traficul dorit).
5. **Vezi consumul**: `npm run usage` (rulează și la sfârșitul `cf-relay/cmd.sh`) afișează
   procentul din fiecare cotă pentru ziua UTC curentă. Cere pe token permisiunea
   „Account Analytics: Read" — dacă lipsește, scriptul spune exact asta.
6. **Protecție anti-abuz gratis**: Bot Fight Mode, „Under Attack Mode" pentru urgente,
   5 reguli WAF custom pe planul gratuit. Rate limiting-ul propriu acoperă login/register/watch/chat.
7. **Backup**: D1 are Time Travel (restaurarere la un moment din trecut); `worker-do` și Pages
   se redeploya din repo.

---

## Securitate

| Aspect | Implementare |
|---|---|
| Parole | **PBKDF2-SHA256, 20.000 iterații**, salt aleator de 16 octeți per utilizator. Măsurat: ~4.45 ms CPU, deci încadrează în limita de 10 ms a planului gratuit. SHA-256 simplu ar fi fost spart instant pe GPU. |
| Comparație hash | în timp constant (`timingSafeEqual`) |
| Enumerare conturi | login-ul face un hash „de umplutură" și când userul nu există, deci timpii de răspuns sunt identici; mesajul de eroare e același |
| Sesiune | JWT HS256 cu `exp` (7 zile), în cookie `HttpOnly; Secure; SameSite=Lax; Path=/` |
| CSRF | `SameSite=Lax` + verificare explicită a header-ului `Origin` pe toate cererile care modifică date |
| XSS | **CSP cu `script-src` strict, fără `unsafe-inline`** — tot JS-ul e în fișiere externe, zero handlere inline. (`style-src` are `unsafe-inline` deliberat: snippet A-Ads + pagina 404 din worker; stilurile nu execută JS.) Randarea folosește `textContent`/`createElement`, niciodată `innerHTML` cu date de la utilizator. |
| iframe player | `referrerpolicy` + `allow` cu allowlist pe origin (`fullscreen *` etc.), fără `sandbox` (playerii terți cad silențios cu el — vezi comentariul din `episode.html`); `frame-src 'self' https:` — allowlist fix imposibil, furnizorii își rotesc domeniile (vezi `src/lib/http.js`) |
| Alte headere | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Banare | `is_banned` e verificat la **fiecare** request autentificat, nu doar la login — un utilizator banat își pierde sesiunea imediat |
| Rate limiting | login 10/5min, register 5/oră, watch 60/oră, chat 20/min + 1.5s între mesaje (toate pe IP sau per utilizator) |
| Secret JWT | doar prin `wrangler pages secret put`. Nu există în `wrangler.toml` și nu e în repo. |
| Panou admin | nu îți poți modifica propriul cont; ultimul admin nu poate fi demodat, banat sau șters; toate acțiunile sunt jurnalizate în `admin_log` |
| Date minime | `/api/admin/users` nu returnează hash-urile de parolă niciodată |

### Căi blocate explicit

`/_worker.js`, `/.dev.vars`, `/wrangler.toml`, `/migrations/*`, `/.git*` → 404, cu mesaje de eroare care nu scurg căi de filesystem.

---

## API (rezumat; lista completă și metodele exacte sunt în `src/router.js`)

| Zonă | Rute | Acces |
|---|---|---|
| Catalog | `GET /api/series`, `/api/series/:id`, `/api/episodes/:id`, `/api/genres`, `/api/recent`, `/api/top`, `/api/subtitle` | public |
| Cont | `POST /api/auth/register|login|logout`, `GET /api/auth/me`, `GET /api/auth/register-options` | public |
| Vizionare | `POST /api/view`, `POST /api/progress`, `GET /api/continue`, `/api/watchlist`, `POST /api/subscribe` | logat |
| Comunitate | `/api/comments`, `POST /api/comments/vote`, `/api/reviews`, `POST /api/ratings`, `POST /api/report`, `GET /api/leaderboard`, `GET /api/pulse` | logat / public |
| Economie | `GET /api/economy`, `/api/chest`, `/api/chests`, `/api/missions`, `GET /api/shop`, `POST /api/shop/buy|activate`, `/api/factions` | logat |
| Identitate | `GET /api/ranks`, `POST /api/me/theme`, `GET /api/profile/:username`, `PATCH /api/profile`, `/api/notifications*` | logat |
| Admin | `/api/admin/stats|log|series|episodes|episode-sources|users|mods|rank-themes|reports` | admin |
| Chat | `WS /chat` → `ChatDO` | logat |

---

## Testare

- `./test.sh` (= `npm test`): pornește `dev.sh` pe o bază curată și rulează `tests/scripts-health.mjs`,
  `tests/e2e.mjs`, `tests/dom-smoke.mjs`, suitele fără server (`theme-cache`, `top-cache`, `chat-persist`,
  `counters`), `chat-d1` (citește fișierul SQLite al D1-ului local), `theme-flow`, `pixel-teme` și `tests/caps-e2e.mjs`.
  Numărul de verificări: scripts-health 36 · e2e 584 · dom-smoke 193 · chat-persist 14 · chat-d1 8 · counters 16
  · theme-cache 7 · top-cache 17 · pixel-teme 8 · plafoane 13. Logurile: `/tmp/e2e.log`, `/tmp/dom.log`.
- **CI**: `.github/workflows/tests.yml` rulează `./test.sh` la fiecare push (fără secrete, fără
  deploy) și publică logurile ca artefacte; relay-ul rămâne pentru publicare + audit live.
- `test.sh` rulează și **bugetul de greutate** (`scripts/measure-weight.mjs`, fără server, ~2 s) și încă o dată
  `dom-smoke` pe **artefactele de deploy** (189 verificări: bundle minificat + chunk-uri reale, prin `AUK_JS_DIR`) —
  o rupere în graful de chunk-uri se vede acolo, nu în producție. Cele 4 verificări care lipsesc sunt blocul care are
  nevoie de identitatea modulului `core.js` ca să reseteze sesiunea între două randări în același proces (imposibil
  când codul stă într-un chunk cu exporturi minificate); pe surse rulează toate 193.
- `npm run weight` (= `node scripts/measure-weight.mjs`): greutatea reală a fiecărei pagini pe pipeline-ul de deploy
  (purge → minificare → bundle cu splitting), cu `--json` pentru diff-uri și `--out=DIR` ca să păstreze artefactele.
- `node cf-relay/chat-canar.mjs [url]`: canarul de chat — cont temporar, un mesaj + un sticker pe chatul viu,
  apoi citirea lor din D1 și curățenie totală. Rulează automat pe runner, în secțiunea 17 din `cf-relay/cmd.sh`.
- Pe producție **nu rula e2e.mjs** — zecile de înregistrări rapide declanșează protecția anti-brute-force
  de la marginea Cloudflare. Verificarea pe live = `audit-live.mjs` prin relay (mai jos).
- `node scripts/audit-live.mjs [baseUrl]`: audit read-only — statusuri pagini, SEO (title/description/canonical/og/
  JSON-LD/sitemap), headere de securitate și cookie, CSRF pe origine străină, rate limit la login/register,
  rute API publice vs protejate, soft-404, compresie/cache/minificare, scanare de secrete în bundle-urile publice.
  Fără credențiale, deci nu scrie nimic; iese cu cod 1 dacă găsește probleme 🔴. Pe local:
  `node scripts/audit-live.mjs http://localhost:8788`. Pe producție se rulează prin relay (vezi `AGENTS.md` §3).

---

## Întreținere

Istoricul chat-ului se curăță singur: `ChatDO` păstrează doar ultimele 500 de mesaje în arhivă (șterge rar,
la fiecare 200 de mesaje scrise — contorul stă tot în storage, ca să nu se repete după evicție). Pentru o
curățenie manuală mai agresivă:

```sql
DELETE FROM chat_messages WHERE id NOT IN
  (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 5000);
```

---

## Economia, pe scurt (fiecare valoare = o identitate)

| Valoare | De unde vine | La ce folosește |
|---|---|---|
| ⭐ **Puncte** | doar vizionare (+10/episod, 15 min) | clasament onest — nu pot fi cumpărate |
| ⚔️ **XP → Nivel** | toată activitatea (vizionare, comentarii, cufere, misiuni) | îți dă **gradul de nivel** vizibil (Genin → Hokage, după tema aleasă) — nu e grad de staff |
| 🪙 **Gold** | cufăr (noroc, /4h) + misiuni zilnice (sigur) | shop: chei de cufăr, nume de aur, flair suporter |
| 🎯 **Misiuni** | 3/zi, reset UTC: vezi un episod, comentează, deschide cufărul | gold + XP garantate pe fiecare |
| 🔥 **Streak** | zile consecutive cu cel puțin o misiune | record personal, afișat pe profil |
| 📊 **Activitate lunară** | aceleași acțiuni ca XP-ul, contor separat | bară pe profil; insigna „Utilizator activ" la 10.000 |
