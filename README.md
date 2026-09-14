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
├── _headers                headere de securitate/cache pe assete
├── robots.txt, llms.txt, speculationrules.json
└── assets/
    ├── css/style.css       nucleu; page-admin.css, page-episode.css, page-user.css per pagină
    ├── img/hero-*.jpg|webp bannerul hero
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
└── seed.mjs                catalog de demo prin API, pe serverul local
tests/
├── e2e.mjs                 suita API completă (local)          ┐
├── dom-smoke.mjs           paginile în jsdom (local)           ├─ ./test.sh le rulează pe toate
├── caps-e2e.mjs            plafoanele LIMIT_USERS/LIMIT_SERIES ┘
└── prod-smoke.mjs          verificare blândă pe producție (o singură înregistrare, pauze)
cf-relay/                   cmd.sh = comanda rulată de GitHub Actions; last-output.txt = rezultatul
.github/workflows/cloudflare-relay.yml
AGENTS.md                   ghid de predare pentru următorul care lucrează (CLAUDE.md trimite la el)
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
npm test                        # ./test.sh: e2e + dom + plafoane, pe o bază curată (~1 min)
```

Reguli care evită surprize:

1. **Orice schimbare de schemă = o migrare nouă** `migrations/00NN_*.sql`. `deploy.sh` le aplică automat pe D1 remote; `dev.sh`/`test.sh` local.
2. **Orice endpoint nou** se adaugă în `src/router.js` (metoda `'*'` dacă fișierul are mai mulți handleri).
3. **Clasele CSS construite dinamic în JS** (`'ubadge ubadge--' + x`) trebuie adăugate în safelist-ul din `scripts/purge-css.mjs`, altfel dispar din producție.
4. **Pentru fiecare feature scrie verificări** în `tests/e2e.mjs` (API) și/sau `tests/dom-smoke.mjs` (pagini). `./test.sh` trebuie să fie verde înainte de deploy.
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

1. **Chat-ul nu scrie în D1 la fiecare mesaj.** Mesajele se buffer-izează în `ChatDO` și se scriu în loturi (la 10 mesaje sau 15 secunde prin alarmă). ~10× mai puține scrieri.
2. **Contorul de vizualizări nu scrie în D1 la fiecare view.** `StatsDO` acumulează și scrie o dată la 20 views / 30 secunde, cu deduplicare pe 10 minute. ~20× mai puține scrieri.
3. **Istoricul chat-ului se citește din D1 o dată pe viața DO-ului**, nu la fiecare conectare (v1 făcea un `SELECT` la fiecare socket nou).
4. **Rate limiting doar pe rute sensibile** (login, register, watch, admin). Fiecare verificare costă 1 request DO, deci GET-urile publice nu trec pe acolo.
5. **Endpoint-uri combinate**: `/api/series/:id` returnează seria *și* episoadele ei într-un singur apel → jumătate din invocările Workers.
6. **Indexuri pe fiecare coloană folosită în `WHERE`/`JOIN`** — pe D1 se taxează rândurile *scanate*, nu cele returnate.
7. **Fără Tailwind CDN** (v1 încărca ~300 KB JS pe fiecare pagină). Un singur CSS de câțiva KB, cache-abil.
8. **WebSocket Hibernation API** în `ChatDO` — DO-ul nu consumă CPU cât timp e idle.

---

---

## Securitate

## Securitate

| Aspect | Implementare |
|---|---|
| Parole | **PBKDF2-SHA256, 20.000 iterații**, salt aleator de 16 octeți per utilizator. Măsurat: ~4.45 ms CPU, deci încadrează în limita de 10 ms a planului gratuit. SHA-256 simplu ar fi fost spart instant pe GPU. |
| Comparație hash | în timp constant (`timingSafeEqual`) |
| Enumerare conturi | login-ul face un hash „de umplutură" și când userul nu există, deci timpii de răspuns sunt identici; mesajul de eroare e același |
| Sesiune | JWT HS256 cu `exp` (7 zile), în cookie `HttpOnly; Secure; SameSite=Lax; Path=/` |
| CSRF | `SameSite=Lax` + verificare explicită a header-ului `Origin` pe toate cererile care modifică date |
| XSS | **CSP strict fără `unsafe-inline`** — tot JS-ul e în fișiere externe, zero handlere inline. Randarea folosește `textContent`/`createElement`, niciodată `innerHTML` cu date de la utilizator. |
| iframe player | `sandbox` + `referrerpolicy`; `frame-src` restricționat la domeniile DoodStream |
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

- `./test.sh` (= `npm test`): pornește `dev.sh` pe o bază curată și rulează `tests/e2e.mjs`, `tests/dom-smoke.mjs`,
  `tests/caps-e2e.mjs`. Logurile: `/tmp/e2e.log`, `/tmp/dom.log`.
- `node tests/prod-smoke.mjs [baseUrl]`: pe producție. **Nu rula e2e.mjs pe producție** — zecile de înregistrări
  rapide declanșează protecția anti-brute-force de la marginea Cloudflare.

---

## Întreținere

Istoricul chat-ului crește nelimitat. Rulează periodic:

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
