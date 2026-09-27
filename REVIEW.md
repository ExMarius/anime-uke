# Review — ExMarius/anime-uke (AnimeSphere)

**Data:** 11 sept. 2026 · **Commit analizat:** `24837a4` (main) · **Stack:** Cloudflare Pages + Pages Functions + D1 + Durable Objects · **Deploy:** https://anime-uke.pages.dev

---

## Rezumat

| Severitate | Nr. | Ce înseamnă |
|---|---|---|
| 🔴 Critic | 3 | Oricine poate deveni admin; parolele utilizatorilor sunt la vedere; XSS în chat |
| 🟠 Înalt | 5 | Sistemul de autentificare e funcțional doar pe jumătate; logout nu funcționează; pagina de episod e stricată |
| 🟡 Mediu | 8 | Fără validări, fără schema DB în repo, tailwind CDN în producție |
| 🔵 Scăzut | 6 | Curățenie, DX, documentație |

**Verdict:** scheletul e bun (arhitectura Pages Functions + D1 + DO pentru chat e corectă), dar în starea actuală site-ul **nu e sigur de folosit cu utilizatori reali** și are 2 fluxuri care nu merg deloc. Toate problemele critice se repară în ~2–3 ore de lucru.

---

## 🔴 CRITIC

### C1. `JWT_SECRET` e commitat public → oricine poate deveni admin
**Unde:** `wrangler.toml:16`

```toml
[vars]
JWT_SECRET = "schimba-cu-un-secret-lung-si-aleator-256-bit-2026"
```

Repo-ul e **public**, deci secretul e public. Am verificat practic: am generat un JWT valid cu `is_admin: true` semnat cu exact acest secret (nu îl pun aici ca să nu fie copy-paste). Cine îl pune într-un cookie `token` pe `anime-uke.pages.dev` primește acces la `/api/admin` → poate adăuga/vedea serii, episoade și **lista completă de utilizatori cu emailuri**.

> ⚠️ Dacă secretul a fost schimbat între timp pe Cloudflare (prin dashboard / `wrangler secret`), impactul e doar istoric. Dacă `[vars]` din `wrangler.toml` e încă sursa reală la deploy — e expus acum.

**Fix:**
1. `npx wrangler secret put JWT_SECRET` (pentru proiectul Pages) → generează o valoare nouă, aleatoare, 64+ caractere.
2. Șterge complet `[vars] JWT_SECRET` din `wrangler.toml`.
3. Adaugă `.gitignore` și asigură-te că niciun secret nu mai intră în repo.
4. Rotirea secretului invalidatează toate tokenurile existente — utilizatorii vor trebui să se logheze din nou (e ok, e de dorit).

---

### C2. Parolele sunt stocate în clar în D1
**Unde:** `functions/api/auth/register.js:9-10`, `functions/api/auth/login.js:9`

```js
// register: parola merge direct în DB
.bind(username, email, password).run();
// login: comparare în clar
if (!user || user.password !== password)
```

Orice breșă a DB-ului (sau orice admin falsificat prin C1, sau un backup scăpat) = toate parolele dezvăluite. E și o problemă legală (GDPR).

**Fix (Cloudflare Workers nu are bcrypt nativ, dar are PBKDF2 prin WebCrypto):**
- `register`: generează `salt` aleator (16 bytes) → `PBKDF2-SHA256`, 100.000 iterații → stochează `salt` + `hash` (nu `password`).
- `login`: recalcul hash cu saltul din DB și compară cu `timingSafeEqual`-echivalent (comparare de stringuri pe lungime fixă e suficient aici).
- Adaugă coloanele `password_hash`, `password_salt` în `users`; pentru utilizatorii existenți, cere reset de parolă (nu există flux de reset acum — vezi M6).
- Bonus: rate limiting pe `/api/auth/login` (vezi H5).

---

### C3. XSS stocat în chat (și peste tot unde se randează din DB)
**Unde:** `index.html:123-133` (mesaje chat), `index.html:97-105` (titlu/descriere/poster serie), `series.html:31,35-40`, `admin.html:51-54`

```js
container.innerHTML += `<span class="...">${data.username}:</span><span>${data.message}</span>`;
```

`data.username` vine **direct de la client** (`ChatDO.js:33` folosește `data.username` fără verificare), iar `data.message` la fel. Un utilizator trimite în chat `<img src=x onerror="fetch('/api/admin',{method:'POST',body:...})>` și codul se execută în browserul **tuturor** celor conectați — inclusiv al unui admin real.

**Fix (3 straturi, toate necesare):**
1. O funcție `escapeHTML()` în `app.js` aplicată la **orice** valoare dinamică înainte de `innerHTML`. Sau, mai curat: construiește nodurile cu `textContent` / `createElement`.
2. În `ChatDO`, **nu** mai lua `username` de la client — ia-l din tokenul JWT de la handshake-ul WebSocket (`functions/chat.js` poate verifica cookie-ul și pasa `payload.username` în URL/query către DO). Asta rezolvă și impersonarea (M5).
3. Politică CSP (`Content-Security-Policy` cu `default-src 'self'`, `frame-src` doar pentru domeniile de embed) setată în `functions/_middleware.js`.
4. `iframe`-ul din `episode.html:19` are nevoie de `sandbox="allow-scripts allow-same-origin allow-presentation"` + `referrerpolicy="no-referrer"` — acum un embed malițios poate naviga întreaga pagină (`top`).

---

## 🟠 ÎNALT (funcționalități stricate)

### H1. După login, UI-ul rămâne pe „neautentificat"
**Unde:** `login.html:57-59`, `app.js:4-6`, `index.html:68-89`

Tokenul se setează **doar** ca cookie `HttpOnly` (corect din partea serverului). Dar:
- `login.html` primește `data.token` în răspuns și **nu face nimic cu el** — nu îl salvează în `localStorage`.
- `getToken()` citește `document.cookie`, care **nu conține** cookie-urile `HttpOnly` → returnează mereu `undefined`.
- `updateNav()` din `index.html` face `if (token)` → mereu ramura `else` → utilizatorul logat vede tot „Login / Register", iar `points-display` rămâne gol.
- Comentariul din `index.html:73` („Luăm datele din localStorage (setate la login)") e fals: nicăieri nu se scrie în `localStorage`.

**Fix:** backend-ul e sursa de adevăr, nu `localStorage`. Adaugă `functions/api/me.js` care returnează `{username, points, is_admin}` din JWT, și în front: `const me = await apiCall('/me'); if (me) {...}`. Șterge tot ce ține de `localStorage` și de `getToken()`.

### H2. `Cookie` e „forbidden header" — nu se poate seta din `fetch`
**Unde:** `app.js:11`

```js
options.headers = { ...options.headers, Cookie: `token=${t}` };
```

Browserul refuză setarea header-ului `Cookie` din JS (Chrome loghează `Refused to set unsafe header "Cookie"`). Din fericire e și inutil: pe same-origin browserul trimite cookie-ul automat. **Fix:** șterge cele 4 linii; păstrează `credentials: 'same-origin'` (implicit) sau `'include'` dacă vei avea alt domeniu pentru API.

### H3. `logout()` nu funcționează
**Unde:** `app.js:21-24`

```js
document.cookie = "token=; Max-Age=0";   // nu poate șterge un cookie HttpOnly
location.href = '/login.html';           // utilizatorul rămâne de fapt logat
```

**Fix:** `POST /api/auth/logout` care face `Set-Cookie: token=; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Path=/`, apoi front-ul face redirect. (Opțional, pentru revocare reală: blacklist de `jti` în D1 sau KV cu TTL.)

### H4. Pagina de episod nu funcționează pentru nicio serie în afară de `series_id=1`
**Unde:** `episode.html:40`

```js
const allEp = await apiCall('/episodes?series_id=1'); // ajustează dacă ai mai multe serii
const ep = allEp.find(e => e.id == currentEpisodeId);
```

Pentru seria 2+, `ep` e `undefined` → `return` → pagină goală, fără player, fără mesaj de eroare.

**Fix:** endpoint dedicat `functions/api/episodes/[id].js` → `SELECT * FROM episodes WHERE id = ?`. Front-ul cere direct `/episodes/${currentEpisodeId}`. La fel pentru `series.html:29-30`, care descarcă **toate** seriile ca să găsească una → `functions/api/series/[id].js`.

### H5. Fără rate limiting nicăieri
`/api/auth/login` permite brute-force nelimitat; `/api/auth/register` permite creare de conturi la infinit; chat-ul permite flood (fiecare mesaj = un `INSERT` în D1, deci și cost).

**Fix:** `functions/_middleware.js` cu un Durable Object de tip rate limiter (sau `DO` existent reutilizat) pe cheie `IP + rută`: ex. 10 încercări de login / 5 min, 30 mesaje de chat / minut / utilizator.

---

## 🟡 MEDIU

| # | Problemă | Unde | Fix |
|---|---|---|---|
| M1 | **Schema D1 nu e în repo.** Nu există niciun `.sql`/migrations, deci DB-ul e ireproductibil. 5 tabele sunt inferate doar din cod. | repo root | Adaugă `schema.sql` + `migrations/` și `[[migrations]]` în `wrangler.toml`. Am scris schema reconstruită mai jos. |
| M2 | JWT **fără `exp`** → tokenuri valide pentru totdeauna. | `utils/jwt.js`, `login.js:13` | Adaugă `exp: Math.floor(Date.now()/1000) + 86400` la sign și verificare în `verifyJWT`. |
| M3 | `apiCall` dă crash pe răspuns non-JSON / eroare de rețea (`res.json()` aruncă, nu există `try/catch`). | `app.js:18` | `try/catch` + `if (!res.ok)` → returnează `null` sau obiect de eroare. |
| M4 | `admin.js` GET returnează **emailurile** tuturor utilizatorilor; `admin.html` nu le afișează (coloane moarte în payload). | `admin.js:25` | Selectează doar ce se afișează: `id, username, points, is_admin`. |
| M5 | Chat: `username` vine de la client → **impersonare trivială** (poți scrie ca oricine, inclusiv ca admin). | `ChatDO.js:33`, `index.html:145` | Vezi C3.2 — username din JWT, la handshake. |
| M6 | `register.js` — `catch` generic: orice eroare (DB picat, coloană lipsă) e raportată ca „Utilizatorul există deja". Fără validare (lungime username/parolă, format email). Nu există flux de reset parolă. | `register.js:5-20` | Validează explicit + verifică duplicate cu `SELECT` înainte + loghează eroarea reală. |
| M7 | Tailwind prin **CDN** (`cdn.tailwindcss.com`) pe toate cele 6 pagini: ~300 KB JS la fiecare load, warning oficial „not for production", iar `initTailwind()` cu `content: ["./**/*.html"]` e irelevant pentru CDN. | toate `.html` | Build local cu Tailwind CLI → un `style.css` mic, servit static. |
| M8 | `@tailwind base/components/utilities` din `style.css` **nu fac nimic** fără build Tailwind — deci din fișier se aplică doar `body` și `.neon`. | `style.css:1-3` | Dispare odată cu M7. |

### M1 — `schema.sql` reconstruit din cod

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,     -- era: password TEXT (C2)
  password_salt TEXT NOT NULL,
  points        INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS anime_series (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  poster_url  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episodes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id        INTEGER NOT NULL REFERENCES anime_series(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  episode_number   INTEGER NOT NULL,
  doodstream_embed TEXT,
  UNIQUE (series_id, episode_number)
);

CREATE TABLE IF NOT EXISTS watched_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  watched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, episode_id)      -- acum dublura e evitată doar în cod (watch.js:12), cu race condition
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT NOT NULL,
  message   TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id, episode_number);
CREATE INDEX IF NOT EXISTS idx_chat_id         ON chat_messages(id DESC);
CREATE INDEX IF NOT EXISTS idx_watched_user    ON watched_history(user_id);
```

---

## 🔵 SCĂZUT / DX

| # | Observație | Unde |
|---|---|---|
| L1 | Fără `.gitignore` (risc de a commita `node_modules`, `.wrangler`, `.env`). | repo root |
| L2 | `README.md` are 2 rânduri: zero instrucțiuni de setup, deploy, structură. | `README.md` |
| L3 | Fără CI (GitHub Actions cu `wrangler pages deploy`) → deploy manual. | — |
| L4 | `let currentUser` declarat **și** în `app.js:2`, **și** în `index.html:66` (global dublu, supraviețuiește doar pentru că `app.js` nu e modul). | `app.js`, `index.html` |
| L5 | `window.onload` suprascris în fiecare pagină; mai sigur `DOMContentLoaded` sau `defer` + init direct. | toate `.html` |
| L6 | `markAsWatched()` afișează alertă doar pe `data.success`; la episod deja văzut serverul răspunde `{points: 0}` (`watch.js:15`) → **feedback zero**, și `payload.points` nu există niciodată în JWT. Fără `try/catch`, fără disabled-button (dublu-click = 2 cereri). | `episode.html:50-60`, `watch.js:15` |
| L7 | `series.html` și `episode.html` au `<div id="nav-user">` gol și **nu apelează** `updateNav()` → navbar-ul e mort pe ambele pagini. | `series.html:14`, `episode.html:14` |
| L8 | `index.html` nu are link către `series.html` decât prin grid; `series.html` nu are breadcrumb „← înapoi la serii". | — |
| L9 | Fără `<meta name="description">`, OG tags, favicon → sharing pe Discord arată gol. | toate `.html` |
| L10 | `functions/chat.js` nu verifică deloc upgrade-ul/auth și pasează `request` brut către DO; istoricul de 50 mesaje se re-citește din D1 la **fiecare** conectare (poate fi ținut în memoria DO-ului). | `chat.js`, `ChatDO.js:25` |
| L11 | `ChatDO`: `catch (e) {}` gol — erorile dispar complet, imposibil de debugat. Fără limită de lungime pe mesaj. | `ChatDO.js:45` |

---

## Plan de acțiune propus (în ordinea în care aș lucra)

**Faza 1 — stop hemoragie (C1, C2, C3.2, H3)**
1. `wrangler secret put JWT_SECRET` + ștergere din `wrangler.toml` + `.gitignore`.
2. Hash parole (PBKDF2) + `schema.sql` în repo + migrare.
3. `POST /api/auth/logout` + buton de logout funcțional.
4. Chat: username din JWT, nu de la client.

**Faza 2 — să meargă fluxurile (H1, H4, C3.1, L6, L7)**
5. `GET /api/me` + refactor nav pe toate paginile (un singur `renderNav()` în `app.js`).
6. `functions/api/episodes/[id].js` + `series/[id].js`; `episode.html` fără `series_id=1` hardcodat.
7. `escapeHTML()` peste tot + `sandbox` pe iframe.

**Faza 3 — întărire (H2, H5, M2, M3, M4, M6)**
8. `_middleware.js`: rate limiting + header-e de securitate (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy).
9. `exp` în JWT, validări la register, `apiCall` cu error handling, minimizare date la `/api/admin`.

**Faza 4 — producție (M7, L1-L3, L9)**
10. Tailwind build local, README real, GitHub Actions pentru deploy, meta/OG tags.

---

*Notă: raportul e generat ca fișier local în workspace (`/home/user/anime-uke/REVIEW.md`). Spune-mi dacă vrei să îl commit-uim în repo sau să rămână doar pentru tine.*
