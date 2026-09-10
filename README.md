# 🎌 AnimeSphere

Site de anime cu conturi, puncte pentru episoade vizionate, panou admin și chat live.

**Stack:** Cloudflare Pages + D1 + Durable Objects + WebSockets · vanilla HTML/CSS/JS, fără framework
**Cost:** $0/lună — rulează integral în planul gratuit Cloudflare
**Live:** https://anime-uke.pages.dev

---

## De ce arhitectura asta

Totul e gândit pentru **buget zero la 1000+ utilizatori/zi**. Limitele planului gratuit care contează:

| Resursă | Cotă gratuită | Cum stăm noi |
|---|---|---|
| Pages — assete statice | **nelimitat** | HTML/CSS/JS servite static, zero cost |
| Workers / Pages Functions | 100.000 requesturi/zi, **10 ms CPU/request** | API-ul face 1–2 interogări per cerere |
| D1 | 5M rânduri citite/zi · 100k rânduri **scrise**/zi · 500 MB | vezi „Optimizări de buget" mai jos |
| Durable Objects | 100.000 requesturi/zi | doar pe chat + rate limit + views |

> ⚠️ **Important:** din 1 septembrie 2026 depășirea cotelor D1 pe planul gratuit produce **eșec hard** (query-ul pică), nu degradare lentă. Adică un flood pe chat ți-ar da jos tot site-ul până la 00:00 UTC. De asta scrierile în D1 sunt minimizate agresiv.

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

## Structură

```
public/                  # assete statice (servite NELIMITAT si gratuit)
├── _worker.js           # ENTRYPOINT — exporta clasele DO + handlerul fetch
├── index.html           # lista seriilor + chat
├── series.html          # detaliile unei serii + episoadele
├── episode.html         # player DoodStream + buton puncte
├── login.html
├── register.html
├── admin.html           # panou admin cu 5 taburi
└── assets/
    ├── css/style.css    # tema dark (albastru inchis + accent #e94560)
    └── js/
        ├── core.js      # api(), escapeHtml(), toast(), renderNav(), sesiune
        ├── chat.js      # WebSocket + modal + reconectare cu backoff
        ├── auth.js      # logica comuna login/register
        ├── page-*.js    # un fisier per pagina
src/
├── worker.js            # handler fetch + serveste static + header-e securitate
├── router.js            # tabela de rute (inlocuieste functions/)
├── routes/              # handlerele API (semnatura identica cu Pages Functions)
│   ├── chat.js          #   upgrade WebSocket cu autentificare
│   └── api/
│       ├── series.js, view.js, watch.js
│       ├── series/by-id.js, episodes/by-id.js
│       ├── auth/   (register, login, logout, me)
│       └── admin/  (stats, series, episodes, users, log)
├── do/                  # Durable Objects
│   ├── ChatDO.js        #   chat live + buffer mesaje + lista online + rate limit
│   ├── RateLimitDO.js   #   rate limiting shardat pe 32 bucket-uri
│   └── StatsDO.js       #   buffer contor vizualizari
└── lib/                 # crypto, jwt, http, session, validate, ratelimit, audit
schema.sql               # schema D1 (documentata)
migrations/0001_init.sql # aplicata cu `wrangler d1 migrations apply`
tests/                   # e2e + seed (nu e in repo, vezi .gitignore)
wrangler.toml
```

### De ce Advanced Mode (`_worker.js`) și nu directorul `functions/`

**Pages Functions nu poate exporta clase Durable Object.** Am testat empiric, cu wrangler 3 și wrangler 4:

```
✘ [ERROR] Your Worker depends on the following Durable Objects,
          which are not exported in your entrypoint file:
          ChatDO, RateLimitDO, StatsDO
```

Variante încercate, toate eșuate: clase în `src/`, re-export în `functions/_do.js`, re-export dintr-un modul de rută (`functions/chat.js`). Singura cale funcțională pentru chat prin Durable Objects pe Pages este Advanced Mode. Acesta e și motivul pentru care chat-ul din versiunea anterioară nu a funcționat niciodată.

Beneficiu colateral: controlăm explicit header-ele de securitate și pentru assetele statice.

---

## Setup local

```bash
npm install
cp .dev.vars.example .dev.vars      # si editeaza JWT_SECRET
npx wrangler pages dev              # http://localhost:8788
```

În alt terminal, aplică schema pe D1-ul local:

```bash
npx wrangler d1 migrations apply DB --local
```

> Necesită **Node.js 22+** (wrangler 4 nu pornește pe Node 20).

---

## Deploy în producție

```bash
# 1. creeaza baza de date (o singura data)
npx wrangler d1 create anime-db
#    -> copiaza database_id in wrangler.toml

# 2. aplica schema pe D1-ul REMOT
npx wrangler d1 migrations apply DB --remote

# 3. seteaza secretul JWT (NICIODATA in wrangler.toml)
npx wrangler pages secret put JWT_SECRET
#    -> genereaza o valoare aleatoare lunga, ex:
#       openssl rand -hex 32

# 4. deploy
npx wrangler pages deploy
```

### Primul admin

La o bază de date goală, **primul utilizator înregistrat devine automat admin** (bootstrap). Acțiunea e consemnată în `admin_log`. Deci: deploy-ează, apoi înregistrează-te tu primul.

După ce există admini, bootstrap-ul nu se mai declanșează niciodată.

---

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

`/_worker.js`, `/.dev.vars`, `/wrangler.toml`, `/schema.sql`, `/migrations/*`, `/.git*` → 404, cu mesaje de eroare care nu scurg căi de filesystem.

---

## API

| Metodă | Rută | Acces | Descriere |
|---|---|---|---|
| GET | `/api/series` | public | lista seriilor + număr episoade |
| GET | `/api/series/:id` | public | seria **și** episoadele ei (un singur apel) |
| GET | `/api/episodes/:id` | public | episod + seria lui + `watched` pentru userul curent |
| POST | `/api/view` | public | incrementează vizualizările (prin buffer DO) |
| POST | `/api/auth/register` | public | creează cont; primul user devine admin |
| POST | `/api/auth/login` | public | login cu email **sau** username |
| POST | `/api/auth/logout` | logat | șterge cookie-ul de sesiune |
| GET | `/api/auth/me` | oricine | `{ user }` sau `{ user: null }` |
| POST | `/api/watch` | logat | +10 puncte, o singură dată per episod |
| GET | `/api/admin/stats` | admin | statistici |
| GET/POST/DELETE | `/api/admin/series` | admin | CRUD serii |
| GET/POST/DELETE | `/api/admin/episodes` | admin | CRUD episoade |
| GET/POST | `/api/admin/users` | admin | listă + `set_role` / `set_ban` / `delete` |
| GET | `/api/admin/log` | admin | jurnal audit |
| WS | `/chat` | logat | WebSocket către `ChatDO` |

---

## Testare

```bash
npx wrangler pages dev              # in primul terminal
npx wrangler d1 migrations apply DB --local
node tests/seed.mjs                 # date de demo
node tests/e2e.mjs                  # 105 verificari end-to-end
```

Suite-ul e2e acoperă: validări, bootstrap admin, login/logout, anti-enumerare, fluxul admin complet, puncte și race condition la dublu-click, banare cu invalidare imediată a sesiunii, protecțiile panoului admin, jurnal audit, headere de securitate, CSP fără `unsafe-inline`, căi blocate, chat WebSocket (autentificare, difuzare, rate limit, persistență în D1).

**Rezultatul ultimei rulări: 105 trecute, 0 eșuate.**

---

## Întreținere

Istoricul chat-ului crește nelimitat. Rulează periodic (manual sau printr-un cron trigger):

```sql
DELETE FROM chat_messages WHERE id NOT IN
  (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 5000);
```
