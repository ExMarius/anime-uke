# Ghid de predare pentru următorul agent / dezvoltator

Citește fișierul ăsta **înainte** de orice. Sunt ~5 minute și îți economisesc ore.
`README.md` e harta tehnică (structură, arhitectură, API); aici e **cum se lucrează** și **ce s-a
întâmplat până acum**.

---

## 0. Pe scurt

- **Ce e:** site de anime în română, live la https://anime-uke.pages.dev. Cloudflare Pages + D1 +
  Durable Objects, vanilla JS, fără framework, buget $0.
- **Repo:** https://github.com/ExMarius/anime-uke — branch-ul de referință e **`main`**. Pornește de acolo.
- **Proprietar:** Marius (ExMarius). Comunică în **română**. Vrea lucruri concrete, făcute până la capăt
  (cod + teste + deploy + verificare), nu planuri.
- **Stare:** stabil, curat, toate testele verzi (e2e 474 · dom 147 · plafoane 13), deployat.
  Audit live: ✅ 162 · 🟡 0 · 🔴 0 (vezi `AUDIT-LIVE.md`).

## 1. Setup în 60 de secunde

```bash
npm install                       # Node 22+; wrangler ≥ 4.131.2 (altfel vezi capcana „compatibility date”)
cp .dev.vars.example .dev.vars    # JWT_SECRET local (orice string lung; dev.sh îl generează singur dacă lipsește)
npm run dev                       # ./dev.sh → http://localhost:8788 (aplică migrările locale)
npm test                          # ./test.sh — bază curată, ~1 min; loguri în /tmp/e2e.log, /tmp/dom.log
```

- Pe o bază locală goală **primul cont înregistrat devine admin**. Înregistrează-te prin UI sau:
  `curl -s -X POST localhost:8788/api/auth/register -H 'Content-Type: application/json' -H 'Origin: http://localhost:8788' -d '{"username":"admin","email":"admin@test.ro","password":"parola123"}'`
- Înregistrarea locală e plafonată (`LIMIT_USERS`); dacă ai nevoie de mulți useri la teste, vezi `tests/caps-e2e.mjs`.
- Nu există headless browser în sandbox; paginile se testează în **jsdom** (`tests/dom-smoke.mjs`).

## 2. Ciclul de lucru care funcționează

1. Citește codul din zona pe care o atingi (fiecare fișier are un antet care explică *de ce* există).
2. Schimbare de schemă? → **migrare nouă** `migrations/00NN_nume.sql` (următoarea e **0026**). Niciodată nu edita o migrare aplicată.
3. Endpoint nou? → fișier în `src/routes/api/`, **înregistrat în `src/router.js`** (metoda `'*'` dacă ai mai mulți handleri în fișier — altfel GET-ul tău dă 405 în producție).
4. Clasă CSS construită dinamic în JS (`'foo foo--' + x`)? → adaug-o în safelist din `scripts/purge-css.mjs`, altfel **dispare la deploy**.
5. Scrie verificări în `tests/e2e.mjs` (API) și/sau `tests/dom-smoke.mjs` (pagini). Stilul: `check('descriere', conditie, detaliu)`.
   Atingi rutare/SEO/headere? Rulează și `node scripts/audit-live.mjs http://localhost:8788` — prinde soft-404,
   redirecturi greșite, headere lipsă, sitemap incoerent (pe live se rulează tot prin relay, vezi §3).
6. `./test.sh` verde → commit cu mesaj descriptiv (în română, ca restul istoricului).
7. Deploy (secțiunea 3) → verifică pe live → raportează utilizatorului ce s-a schimbat, concret.

## 3. Deploy fără acces de rețea la Cloudflare (relay)

Sandbox-urile de agent de obicei **nu pot accesa** `api.cloudflare.com`/`pages.dev` direct (curl dă
timeout). Nu insista; folosește relay-ul prin GitHub Actions:

```bash
# 1. scrie ce vrei rulat pe runner (are wrangler, npm ci, curl, token-ul din Secrets):
cat > cf-relay/cmd.sh <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"
# + verificări post-deploy cu curl pe https://anime-uke.pages.dev (grep în JS/CSS, statusuri API)
EOF
# 2. commit + push → workflow-ul pornește automat (orice branch, doar când se schimbă cmd.sh)
git add cf-relay/cmd.sh && git commit -m "relay: deploy <ce>" && git push origin <branch>
# 3. așteaptă și citește rezultatul
sleep 15; ID=$(gh run list --branch <branch> --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $ID --exit-status
git stash; git pull --rebase origin <branch>; git stash pop     # runner-ul comite cf-relay/last-output.txt
cat cf-relay/last-output.txt
```

- `deploy.sh` face totul în ordine: D1 → **migrări remote** → Worker DO → Pages → JWT_SECRET, plus purge CSS,
  bundle/minify JS, versionare `?v=<commit>` și trecerea JS/CSS din `public/_headers` pe `immutable`
  (ele nu mai trec prin worker, deci Cache-Control-ul se decide acolo). Nu trebuie să rulezi migrările separat.
- Logurile Actions **nu** se pot citi cu `gh run view --log` din sandbox; de aceea output-ul e comis în `last-output.txt`.
- Pentru verificări read-only pe live poți folosi și tool-ul de fetch al agentului (nu curl), sau — mai bine,
  pentru că acoperă zeci de probe deodată — `node scripts/audit-live.mjs https://anime-uke.pages.dev` în `cmd.sh`
  (rulează și fără `./deploy.sh`, dacă vrei doar auditul). Iese cu cod 1 dacă găsește 🔴.
- Token-ul Cloudflare stă **doar** în GitHub Secrets (`CLOUDFLARE_API_TOKEN`). **Nu-l scrie niciodată în fișiere**,
  nici în mesaje de commit, nici în `cmd.sh`.
- Comentariile din JS sunt stripate la minificare — nu folosi text din comentarii ca marker de deploy; folosește
  identificatori (nume de funcții, id-uri HTML, clase CSS).

## 4. Capcane cunoscute (toate au mușcat cel puțin o dată)

| Simptom | Cauză | Ce faci |
|---|---|---|
| `wrangler.toml` apare modificat în `git status` | `dev.sh` îl înlocuiește cu config-ul local cât rulează | **Nu-l comite.** La pull: `git stash && git pull --rebase && git stash pop` |
| Un badge/culoare nouă nu apare pe live, dar local merge | PurgeCSS a scos clasa (construită dinamic) | safelist în `scripts/purge-css.mjs` |
| Endpoint nou răspunde 405 pe live | ruta din `router.js` are altă metodă decât handlerul | pune `method: '*'` |
| „no such column" în producție după deploy | migrarea nu e în `migrations/` sau are număr duplicat | verifică `last-output.txt` pasul „Schema D1" |
| Testele pică cu „no such table"/port ocupat | un `workerd` orfan ține 8788 | `./test.sh` îl omoară singur; altfel `pkill -9 -f workerd` |
| Register 403 local | plafonul `LIMIT_USERS` | folosește un cont existent sau `LIMIT_USERS=50 ./dev.sh` |
| `dev.sh`/`test.sh` mor instant: „This Worker requires compatibility date \"2026-05-01\", but the newest date supported by this server binary is …” | wrangler/workerd din `package-lock.json` e mai vechi decât `compatibility_date` din configurii | `npm i -D wrangler@latest` (≥ 4.131.2) și comite `package-lock.json`. Alternativ, coboară data în toate cele 5 fișiere `.toml` |
| `git push` pe tag → 403 | token-ul GitHub al sandbox-ului nu are drept pe tags | folosește `gh api` (refs) sau lasă tag-urile |
| Un asset n-are CSP/HSTS pe live (sau are alt set decât API-ul) | assetul e servit din stratul static (`public/_routes.json`), iar headerele lui vin din `public/_headers`, nu din worker | ține cele două seturi identice (`SECURITY_HEADERS` ↔ `public/_headers`); `tests/e2e.mjs` verifică paritatea |
| `Cache-Control: no-cache, no-cache` (valoare dublată) pe un asset | assetul a trecut ȘI prin worker → `public/_routes.json` lipsește sau nu-l mai exclude | verifică `public/_routes.json` (deploy.sh refuză să publice fără el) |
| Hero-ul apare fără WebP / 404 pe `/assets/img/hero-*.webp` | frații `.webp` sunt COMISAȚI în repo, nu generați la deploy | `git add public/assets/img/*.webp`; nu adăuga `find -delete` în deploy.sh |
| `/api/series`, `/api/top`, `/api/recent`, `/api/genres`, `/api/pulse` cerute de prima pagină | cineva a desfăcut agregarea din `/api/home` | `tests/dom-smoke.mjs` numără cererile paginii („Prima pagină cere catalogul o singură dată") |

## 5. Modelul de date pe care trebuie să-l respecți

- **Două sisteme de grade, separate** (detalii în README → „Grade și drepturi"):
  - *nivel*: automat din XP (`users.level` + `rank_themes`/`users.rank_theme`) → `rankChip()`.
  - *staff*: manual din admin (`users.staff_role` ∈ `''|helper|staff|moderator`, `users.is_admin`) → `staffBadge()`.
  - drepturi: `canModerate()` în `src/lib/session.js` = Admin sau Moderator. Helper/Staff = doar badge.
  - `users.is_mod` e coloană moartă (absorbită în 0025). Nu o citi, nu o scrie.
- **Facțiuni** (`src/lib/factions.js`): alegere lunară a userului; setează automat tema de grade de nivel. Nu au legătură cu staff-ul.
- **Economie**: puncte (doar vizionare, clasament) ≠ XP/nivel (toată activitatea) ≠ gold (cufere/misiuni → shop). Nu le amesteca.
- **Scrieri în D1 = resursa scumpă** (100k/zi pe free). Chat-ul și view-urile se bufferizează în DO. Nu adăuga scrieri per-request fără motiv.
- Fișa seriei (0024): `alt_titles, themes, age_rating, ep_duration, release_date, country, external_url, team, next_ep_note, next_ep_at` — validate în `src/lib/validate.js`.

## 6. Ce s-a făcut recent (ca să nu refaci)

- Grade de staff Helper/Staff/Moderator + tab „Grade" refăcut în admin (0025).
- Fișa detaliată a seriei + „Episodul următor" cu countdown + JSON-LD SEO (0024).
- Sortare comentarii (top/nou/vechi, client), regulament chat (overlay + `-regulament`).
- Curățenie: eliminat `schema.sql`, `push.sh`, seed-uri de scară, `public/covers`, `src/lib/rank.js`; README rescris;
  branch-urile vechi șterse; `main` = starea curentă (vechiul main e tag-ul `backup/main-exemplu`).
- Toolchain: `wrangler` urcat la 4.131.2 (workerd 1.20260911.1) — `compatibility_date = "2026-05-01"` din toate
  configurile făcea `dev.sh`/`test.sh` să moară la pornire pe o clonă proaspătă cu wrangler 4.84.1. După upgrade:
  455 + 147 + 13 teste verzi local, deploy prin relay reușit, toate markerele din `deploy.sh` (migrații, Worker DO,
  URL Pages, `JWT_SECRET`) încă se regăsesc în ieșirea wrangler 4.131.2 — verificare comisă în `cf-relay/last-output.txt`.
- Curățenie branch-uri (2): șters `arena/01a0a0f5-anime-uke` de pe remote — avea exact același commit ca `main`
  (`3bf7f0c`), nimic pierdut.
- Audit complet al sitelui live + reparări (detaliile și probele în **`AUDIT-LIVE.md`**):
  - `/serie/<id>` și `/episod/<id>` inexistente → **404 real** (pagină generată în worker, `noindex` + `X-Robots-Tag`),
    cu cache negativ 5 min în izolat; înainte răspundeau 200 = soft 404 pentru Google.
  - `/series` fără id → **301 spre `/`** și scos din sitemap (era pagină moartă, iar JS-ul făcea `location.replace('/')`).
    `/series?id=N` rămâne 200.
  - Rute necunoscute (`/package.json`, `/AGENTS.md`, `/deploy.sh`, …) → **404**, nu `302 /login?next=…`: allowlist
    `STATIC_PAGES` + `DYNAMIC_PAGES` verificat ÎNAINTE de poarta de autentificare, cu normalizare `/x/`→`/x`, `/x.html`→`/x`.
  - `/login` și `/register`: `noindex` + canonical. Header nou `Cross-Origin-Resource-Policy: same-origin`.
  - `tests/e2e.mjs` a crescut de la 455 la **474** de verificări (toate cazurile de mai sus).

### Sesiunea „buget 0 / să nu pice la trafic” (2026-09-22)

Fiecare cerere care ajunge în Pages Functions consumă o invocare din cota gratuită de **100.000/zi**.
Un vizitator fără cont cheltuia ~12 invocări (1 pagină + 6 assete + 5 cereri de API). Acum cheltuie ~2:

1. **`public/_routes.json`** — `/assets/*`, `/`, `/login`, `/register`, `/episode` sunt servite direct de
   stratul static (0 invocări). Securitatea nu a scăzut: headerele cailor ocolite vin din `public/_headers`,
   cu valori IDENTICE cu `SECURITY_HEADERS`, iar `tests/e2e.mjs` verifică paritatea la fiecare rulare.
   `deploy.sh` refuză să publice dacă `_routes.json` lipsește și trece JS/CSS din `_headers` pe
   `immutable` 1 an (aceleași căi sunt versionate cu `?v=<commit>`).
   *Atenție la mentenanță:* orice rută adăugată în `exclude` scapă de poarta de autentificare din worker
   (de aceea acolo sunt doar pagini publice).
2. **`/api/home`** — prima pagină (catalog + top weekly/rated + ultimele episoade + genuri + pulse)
   într-o singură invocare, în loc de cinci. `page-index.js` o cere o dată (`homeData()`, memoizat) și
   distribuie datele către grilă, topuri, „ultimele episoade", filtre și chip-ul de „online"
   (`claimPulse()`/`pushPulse()` din `core.js`); hero-ul refolosește aceeași listă.
3. **Imagini** — pagina referă direct `.webp` (frați comiși în repo), deci nu mai există negociere
   `Accept: image/webp` în worker: una-două cereri mai puțin per vizită, una mai puțin sigură.
   Scara de rezervă a bannerului trăiește acum într-un SINGUR handler (înainte `onerror` + `addEventListener`
   se băteau cap în cap și prima treaptă — coperta din DB — nu se aplica niciodată).
4. **Curățenie în `src/worker.js`**: scoase negocierea WebP și regula `?v=` → `immutable` (moarte, fiindcă
   assetul nu mai ajunge în worker). `statusOverride()` a rămas fără consumatori → șters.
5. **Teste**: `tests/e2e.mjs` **486** (+12: `/api/home`, `_routes.json`, paritatea de headere, dovada că
   assetul nu trece prin worker), `dom-smoke.mjs` **150** (+3: numărătoarea cererilor paginii; reparată și
   verificarea flaky „anterior dezactivat pe primul episod" — butoanele pornesc acum `disabled` în HTML).
   `scripts/audit-live.mjs` a primit probe noi (asset static servit direct, `.webp` direct, `og:image`
   rămâne `.jpg` fiindcă rețelele sociale nu acceptă WebP).

**De făcut de proprietar, o dată (2 click-uri, gratuit):** dashboard → Workers & Pages → `anime-uke` →
Settings → Runtime → **Fail open** (la epuizarea cotei, catalogul static rămâne vizibil în loc de pagină de eroare).

---

## 7. Backlog (idei discutate cu proprietarul, neîncepute — cere confirmare înainte)

- Din audit (`AUDIT-LIVE.md` §3 — alegeri de produs, nu defecte): SSR SEO pe `/episod/<id>` (title generic azi;
  se poate face liniștit — URL-ul pretty NU e în `_routes.json`, deci trece prin worker; doar shell-ul
  `/episode` e servit static;
  e cea mai mare oportunitate de trafic organic — cere JSON-LD `VideoObject`/`BreadcrumbList` + cache ca la serii);
  canonical/og hardcodate pe `anime-uke.pages.dev` în `index.html`/`login.html`/`register.html` (de mutat pe
  `CANONICAL_ORIGIN` când apare domeniul propriu); `/episode` fără id (același 301 ca `/series`, dacă se vrea);
  audit live cu sesiune (are nevoie de un cont de test).

- Probleme la **facțiuni** pe care proprietarul a zis că le va descrie (întreabă-l: „ce nu merge la facțiuni?").
- Din referința „exemplu" (un site similar): meta „tradus de {team}" pe episod (câmpul `team` există deja pe serie —
  vezi `src/routes/api/episodes/by-id.js`), buton „mulțumesc", link „Ultima vizionare", panou notificări extins,
  „Gând" (status scurt pe profil), avatar picker, sondaj săptămânal, „Seria săptămânii", „Episoade anunțate",
  cei mai activi per rol, Hall of fame, mesaje private/blocare în lista online.

## 8. Reguli de la proprietar

- Nu scrie secrete în cod. Token-ul Cloudflare rămâne activ în GitHub Secrets (nu cere rotirea lui decât la final).
- Fă lucrurile complet: cod → teste → deploy → verificare pe live → raport clar în română.
- Nu șterge/redenumi lucruri „de curățenie" fără să verifici că nu sunt referite (`grep -rn` în `src public scripts tests deploy.sh dev.sh test.sh`).
- Când termini o sesiune mai lungă, **actualizează acest fișier** (secțiunile 6 și 7) pentru următorul.
