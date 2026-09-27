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
- **Stare:** stabil, curat, toate testele verzi (scripts-health 50 · poll-buget 22 ·
  pulse-online 17 · e2e 614 · dom 214 / 210 pe build · theme-cache 7 · top-cache 17 ·
  chat-persist 14 · counters 16 · chat-d1 8 · theme-flow PASS · pixel-teme 8 · plafoane 13).
  Auditul live de dinaintea rundei de poll (build `c0ae601`): ✅ 179 · 🟡 0 · 🔴 0 · ℹ️ 32
  (vezi `AUDIT-LIVE.md`; se reface la deploy).
- **2026-09-22: cele două linii de lucru au fost INTEGRATE** într-un singur branch
  (`arena/01a0ca0d-anime-uke` = feature-urile din `arena/01a0c538-anime-uke` + bugetul de
  invocări). Ambele deployau în același proiect Pages, deci live-ul oscila între ele —
  vezi §6 „Integrare".

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
2. Schimbare de schemă? → **migrare nouă** `migrations/00NN_nume.sql` (următoarea e **0031**). Niciodată nu edita o migrare aplicată.
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
# 2. commit + push → workflow-ul pornește automat (orice branch, doar când se schimbă cmd.sh).
#    Dacă e un branch, relay-ul face checkout explicit la origin/main înainte de deploy.
git add cf-relay/cmd.sh && git commit -m "relay: deploy <ce>" && git push origin <branch>
# 3. așteaptă și citește rezultatul
sleep 15; ID=$(gh run list --branch <branch> --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $ID --exit-status
git stash; git pull --rebase origin <branch>; git stash pop     # runner-ul comite cf-relay/last-output.txt
cat cf-relay/last-output.txt
```

- `deploy.sh` face totul în ordine: D1 → **migrări remote** → Worker DO → Pages → JWT_SECRET, plus purge CSS,
  bundle/minify JS, versionare `?v=<commit>`. Nu trebuie să rulezi migrările separat.
- Logurile Actions **nu** se pot citi cu `gh run view --log` din sandbox. Canalul principal de citit rezultatul
  (de la 25.09) e **comentariul pe commit** pe care îl lasă relay-ul: `gh api repos/ExMarius/anime-uke/commits/<sha>/comments`.
  Înaintea capului/cozii de output (cu tokenii redactați), comentariul scoate explicit reperele de predare: `exit deploy`,
  `?v=` din HTML, canarul de prietenie și totalul/exit-ul auditului — nu le pierde la trunchierea logului. `last-output.txt`
  se comite și el când push-ul trece, dar comentariul e garantat.
- `CLOUDFLARE_ACCOUNT_ID` e opțional și poate fi invalid (de ex. 53 caractere în loc de 32 hex): `cf-relay/cmd.sh`
  alege singur contul pe care tokenul chiar vede D1-ul `anime-db`. Dacă secretul e setat corect, verifică doar paritatea.
- `node scripts/usage.mjs` (`npm run usage`, rulat și de `cf-relay/cmd.sh`) arată procentul
  consumat azi din cotele gratuite (Functions / D1 / DO). Cere permisiunea
  „Account Analytics: Read" pe token; fără ea scrie clar ce lipsește, nu crapă.
- **Un singur deploy odată.** Toate trigger-ele relay publică în ACELAȘI proiect Pages; ele
  rulează acum codul din `origin/main`, dar două sesiuni paralele se pot totuși călca la migrări,
  cache și audit. Concurența workflow-ului le serializează; verifică `git log --all --oneline -15`
  înainte de un trigger manual.
- **Atenție, Git integration activă:** proiectul Pages face build automat la fiecare push (inclusiv
  commit-urile `relay: output` — de aici preview-urile). Un merge în `main` declanșează deploy de
  producție **din git** (fără `?v=`/purge/minify/migrări — dar cu bindinguri corecte din `wrangler.toml`
  comis). După un merge în `main`, rulează un deploy prin relay ca să readuci producția la forma optimizată.
- Pentru verificări read-only pe live ai două căi: (1) tool-ul de fetch al agentului (merge direct, fără
  relay): `robots.txt`, `sitemap.xml`, `speculationrules.json`, `/api/pulse` se văd ca text, paginile vin
  randate (cu JS executat), iar `/404` dovedește 404-ul real. Ce NU vezi prin fetch: headerele HTTP
  (CSP/HSTS/Cache) — pentru alea rămâne relay-ul cu `curl -sI`. (2) auditul complet, care acoperă zeci de
  probe deodată: `node scripts/audit-live.mjs https://anime-uke.pages.dev` în `cmd.sh` (rulează și fără
  `./deploy.sh`, dacă vrei doar auditul). Iese cu cod 1 dacă găsește 🔴.
- Token-urile Cloudflare/Turso stau **doar** în GitHub Secrets
  (`CLOUDFLARE_API_TOKEN`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`). **Nu le
  scrie niciodată în fișiere**, mesaje de commit sau `cmd.sh`. Relay-ul copiază
  credențialele Turso în secretele runtime Pages + Worker DO la deploy.
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
| Un asset n-are CSP/HSTS pe live (sau are alt set decât API-ul) | assetul e servit din stratul static (`public/_routes.json`), deci headerele vin din `public/_headers`, nu din worker | ține cele două seturi identice (`SECURITY_HEADERS` ↔ `public/_headers`); `tests/e2e.mjs` verifică paritatea |
| `Cache-Control: no-cache, no-cache` (valoare dublată) pe un asset | assetul a trecut ȘI prin worker → `_routes.json` lipsește ori nu-l mai exclude | `deploy.sh` refuză să publice fără `public/_routes.json` |
| Imagine 404 / hero fără WebP pe live | `.webp` sunt COMISE în repo, nu generate la deploy | `git add public/assets/img/*.webp`; nu pune `find -delete` în `deploy.sh` |
| Logo-ul din nav nu se încarcă pe un browser vechi | DOM-ul cere direct `.webp` (nu mai există negociere pe server) | e intenționat: WebP e suportat de orice browser care rulează module ES; `.png` rămâne pentru favicon/`og:image` |
| Prima pagină cheltuie 5 cereri de API | cineva a desfăcut agregarea din `/api/home` | `tests/dom-smoke.mjs` numără cererile paginii („Prima pagină cere catalogul o singură dată") |
| Cota D1 se duce în câteva ore, deși traficul e mic | o interogare SCANEAZĂ un tabel întreg (se taxează rândurile citite, nu cererile) | `node scripts/bench-scale.mjs` arată planul + rândurile per interogare; la scara maximă nimic din prima pagină n-are voie să fie „SCAN <tabel mare>" |
| Clasamentul „cele mai bine notate" arată medii vechi | o cale nouă scrie în `series_ratings` fără să resincronizeze contoarele | folosește `saveRating()` din `src/lib/ratings.js`; `tests/counters.mjs` verifică forma batch-ului |
| `pulse` arată 0 serii / 0 membri | contoarele din `site_meta` nu se întrețin pe o cale de scriere nouă | contoarele se bat cu `bumpMetaStmt` (serii/episoade: `admin/*`; conturi: `register.js`; vizualizări: `StatsDO.flush`) |
| Testele e2e nu văd o vizionare în „top săptămânal" | topul e ținut o oră în `leaderboard_cache` | rulați cu `TOP_CACHE_MINUTES=0` (o face `test.sh`/`dev.sh`); cache-ul propriu-zis e testat în `tests/top-cache.mjs` |
| Chatul nu salvează nimic în producție, deși mesajele se văd live | două cauze suprapuse: (1) `INSERT INTO chat_messages` avea 11 coloane dar 10 `?` → D1 răspundea „10 values for 11 columns” la fiecare flush, eroare doar logată; (2) bufferul era în memorie, iar evicția DO-ului îl golea înainte de alarmă | două garduri noi: `tests/scripts-health.mjs` compară numărul de coloane cu numărul de valori la TOATE instrucțiunile `INSERT` din `src/` (prinde greșeala în 50 ms, fără server), iar `tests/chat-d1.mjs` citește **fișierul SQLite al D1-ului local** după ce scrie un mesaj pe chat — un test care nu poate fi păcălit de o bază falsă |
| Mesajele de chat (și stickerele) nu se salvează în producție, deși local testele trec | bufferul de mesaje era în MEMORIE, iar WebSocket Hibernation evacuează DO-ul între mesaje: alarma suna pe o instanță nouă, cu buffer gol. Miniflare nu evacuează niciodată, deci local bug-ul e invizibil | fiecare mesaj se scrie întâi în `state.storage` (durabil), lotul se citește din storage la flush, iar istoricul = D1 ∪ buffer, fără dubluri. `tests/chat-persist.mjs` simulează evicția (instanță nouă peste același storage); relay-ul are „canarul" din secțiunea 17 (cont temporar, mesaj + sticker real, citite apoi din D1) |
| „Pagina 1 a unei serii lungi întoarce listă goală (500), pagina 2 merge" | interogarea de progres trimitea câte un parametru per episod afișat, iar D1 acceptă **maxim 100 de parametri legați per interogare** | împarte `IN (...)` în bucăți de 90 (`src/routes/api/series/by-id.js`); simptomul „doar prima pagină pică" e semnătura acestei limite |
| O funcție nouă „nu se salvează" deși nu dă eroare | `INSERT` cu 11 coloane și 10 valori, eroare doar logată | `tests/scripts-health.mjs` numără coloanele vs. valorile la toate instrucțiunile `INSERT`; `tests/chat-d1.mjs` citește tabelul real |
| Deploy-ul de pe runner nu pornește, deși local totul e verde | sintaxă invalidă în `cf-relay/cmd.sh` (ex. o ghilimea tipografică `"` care închide un șir bash deschis cu `„`) | `node tests/scripts-health.mjs` rulează `bash -n` pe toate scripturile; e prima suită din `test.sh` |
| Relay-ul pică instant: „Secretul CLOUDFLARE_API_TOKEN nu e setat pe repo” | secretul a fost șters/rotit din GitHub (s-a întâmplat 25.09 — o oră de deploieri n-au putut ieși; site-ul live rulează în continuare, doar deploy-ul e blocat) | cere proprietarului să-l readadă: Settings → Secrets and variables → Actions → `CLOUDFLARE_API_TOKEN`; diagnosticul ajunge singur în comentariul pe commit |
| Deploy pică cu CF 7003 „Could not route to /accounts/…/d1” | secretul `CLOUDFLARE_ACCOUNT_ID` e invalid (altceva decât 32 hex) sau e alt cont | `cmd.sh` alege acum automat contul care vede D1-ul `anime-db`; pentru curățenie: secretul gol sau ID-ul corect (32 hex) |
| O clasă nouă din JS dispare pe live | PurgeCSS a șters-o: nu apare ca literal în HTML/JS analizat | scrie clasa ca literal în JS/HTML sau adaug-o în safelist (`scripts/purge-css.mjs`); relay-ul verifică prezența în CSS-ul publicat (secțiunea 15) |
| Verificarea din relay raportează 0 la o funcție nouă din bundle | esbuild escapează non-ASCII (`min v\u0103zute`) și normalizează ghilimelele (`!== '/'` → `!=="/"`) | caută doar formei ASCII sigure: `min v`, `!==\"/\"` |

- **jsdom nu are Web Animations API (`element.animate`)**. Paginile o folosesc pentru
  animații de intrare; fără gardă, apelul aruncă, iar codul de eroare al paginii ascunde
  elementul — testul valida calea de EROARE. Acum `animate` e gardat în pagină, iar
  `tests/dom-smoke.mjs` are un polyfill minim. Lecția generală: când un test „trece" pe o
  ramură de eroare (ex. „bannerul rămâne ascuns când catalogul e gol"), verifică-ți
  ÎNTÂI premisa (aici: întreabă API-ul dacă catalogul chiar e gol).
- **Nu muta `<img>`-ul din `<picture>`**: `bg.appendChild(img)` necondiționat scoate
  imaginea din `<picture>`, iar `<source>`-urile (AVIF/WebP) devin inutile — browserul
  descarcă mereu rezerva JPEG. Adaugă în fundal doar imaginea creată de JS (`if (!img.parentNode)`).

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

### Pregătire lansare publică: conexiuni Pages + observabilitate (2026-09-26, branch `arena/01a0dd39-anime-uke`)

- **Git integration Pages reparată:** buildurile preview eșuau înainte de cod cu
  `Configuration file for Pages projects does not support "migrations"` și DO-uri fără
  `script_name`. Cauza: `wrangler.toml` comis era configul local. Fișierul de la
  rădăcină este acum configul Pages de producție (fără `[[migrations]]`, toate cele
  trei bindinguri DO trimit la `anime-uke-do` prin `script_name`). `dev.sh` continuă
  să copieze numai temporar `wrangler.local.toml`, deci testele locale păstrează DO-urile
  inline. Nu înlocui din nou `wrangler.toml` cu configul local înainte de push.
- **Relay-ul citește conexiunea Pages/Git:** raportează configurația de build, separă
  preview-ul `github:push` de deploy-ul manual și, la eșec, publică ultimele 30 de
  linii redactate din logul Pages în `last-output.txt` și comentariul commitului.
  Comentariul începe și cu reperele operaționale (`deploy exit`, `?v=`, canarul de
  prietenie și auditul), ca să nu fie pierdute prin trunchiere.
- **CI:** diagnosticul de eșec nu mai marchează drept erori cozile tuturor logurilor
  verzi; expune doar ultima probă negativă/excepție prin API. Suitele complete locale
  au trecut: scripts-health 50 · greutate în buget · e2e 614 · dom 214/210 · restul
  suitei verzi. `npm audit` nu raportează vulnerabilități.

### Prietenie: notificări la cerere și acceptare (2026-09-25, branch `arena/01a0da3a-anime-uke`)

Sistemul `/api/friends` (migrarea 0029, PR #7) trimitea cereri în tăcere: aflai
din întâmplare că ai o cerere de rezolvat. Acum fiecare eveniment care cere o
acțiune sau e o veste bună notifică în clopot:

- **`src/lib/notify.js`**: două tipuri noi în catalogul `NOTIF_TYPES`
  (`friend_request`, `friend_accepted`) + funcția `notifyUser(env, userId, type,
  payload)` — o singură scriere D1 către un utilizator (spre deosebire de
  `notifySubscribers`, care notifică în bloc toți abonații unei serii). Fără
  migrare nouă: `payload` e JSON, deci tipurile nu schimbă schema.
- **`src/routes/api/friends.js`**: notificare la `send` (către destinatar), la
  `accept` (către solicitant) și la acceptarea automată (când celălalt ceruse
  deja). `reject`/`cancel`/`remove` **nu** notifică — zgomot inutil. O
  notificare eșuată nu pichează acțiunea (se loghează în `notifyUser`).
- **`public/assets/js/core.js`**: `notifHref` trimite notificările de prietenie
  la `/profile?u=<username>` (payload-ul poartă `username`), de unde cererea se
  rezolvă cu un click. Episoadele/seriile păstrează prioritatea.
- **Teste**: `tests/e2e.mjs` secțiunea „13h2" (fluxul complet: cerere →
  notificare, duplicat fără a doua notificare, acceptare, mark-read, eliminare
  tăcută, acceptare automată) + `tests/dom-smoke.mjs` (badge + text + link în
  dropdown, pe două conturi temporare șterse la final).
- **Live**: `cf-relay/friends-canar.mjs` (rulat din `cmd.sh` §17b) face fluxul
  pe producție cu două conturi „canarp%", iar D1-ul e citit direct ca dovadă.
  Dacă plafonul de 5 conturi/oră împiedică al doilea cont, verificarea **se
  sare** (exit 0), nu dă fals roșu.

### Mesaje private între prieteni (2026-09-26)

Chatul are acum în același modal taburile **Live** și **Prieteni**. Implementarea
este în `src/lib/private-messages.js`, `src/lib/turso.js`,
`turso/migrations/0001_private_messages.sql`, `src/routes/api/messages.js`,
`src/do/ChatDO.js` și `public/assets/js/chat.js`:

- `/api/messages` listează numai prietenii `accepted`, cu preview + unread;
  `?with=<username>` citește istoricul numai dacă prietenia este încă activă;
  `POST { action:'read', with }` marchează conversația citită.
- **Producția păstrează conținutul DM în Turso (`anime-uke-messages`)**, nu în
  D1. D1 rămâne sursa de adevăr pentru users/friendships. Fără credențiale
  Turso (numai local/test), adaptorul folosește tabelul D1 din migrarea 0030.
- DM-ul se trimite pe WebSocket ca `{ type:'dm', recipient_id, message }`.
  `ChatDO` verifică statusul în D1 la **fiecare DM**, persistă în Turso, apoi
  recitește prietenia; dacă un unfriend a concurat cu scrierea, șterge mesajul
  și nu îl livrează. Nu adăuga vreun cache de prietenie aici.
- Unfriend nu șterge istoricul, dar îl face imediat inaccesibil și blochează
  trimiterea inclusiv pe un socket deschis înaintea eliminării.
- Clasele mini-Discord sunt `dm-*`; `/^dm/` trebuie să rămână în safelist-ul
  `scripts/purge-css.mjs`. La deploy verifică și artefactul CSS purgat/minificat,
  nu doar sursa.
- Regresiile sunt în `tests/e2e.mjs` secțiunea 13h3 (accepted-only, persistență,
  zero leak către al treilea socket, unread/read, blocare după unfriend),
  `tests/turso-messages.mjs` (protocol + selectarea Turso) și
  `tests/dom-smoke.mjs` (taburile Live/Prieteni din același modal).
- `deploy.sh` aplică migrările din `turso/migrations/`, face backfill idempotent
  din D1 și setează secretele pe **ambele** runtime-uri: Pages citește inboxul,
  Workerul `anime-uke-do` scrie DM-ul. Relay-ul validează direct mesajul canar
  în Turso și îl curăță înainte să șteargă conturile temporare.

Următoarea migrare D1 este **0031**; nu modifica 0030. Migrarea Turso 0002
(progres de vizionare) e descrisă mai jos; următoarea liberă e **0003**.

### Progresul de vizionare mutat în Turso, în etape (2026-09-27) — LIVE pe `turso`

**Stare la 27.09, verificată pe producție:** etapele d1 → shadow → turso au fost
rulate în ordine, fiecare cu deploy propriu și canar live (`cmd.sh` §21).
Ultimul deploy (`exit deploy: 0`, audit ✅ 190 · 🟡 0 · 🔴 0) confirmă:
`store=turso`, **0 rânduri de progres noi în D1**, rândul canarului prezent în
Turso (`user=111 ep=4212 serie=1019 secunde=1200`), recompensa exact o dată în
D1 (`watched_history` 1 rând, 10 puncte), `compare` cu **delta maxim 0s**,
`watch_store_audit` **gol** (niciun timeout, niciun fallback, nicio divergență).
Consum real în ziua lansării (trei deploy-uri + canari + audituri incluse):
**977 rows_written D1 (1%)**, 22.459 citite (0%), 1.623 invocări (2%), 539 DO (1%).


`watch_progress` = jumătate din scrierile D1 (30.000 din ~61.300/zi la 500
spectatori × 12 episoade × 24 min). A fost mutat în baza Turso gratuită
EXISTENTĂ (`anime-uke-messages`) — niciun serviciu nou, niciun card, niciun
trial. Implementarea: `src/lib/watch-store.js`,
`turso/migrations/0002_watch_progress.sql`, `scripts/watch-turso.mjs`,
`tests/watch-store.mjs`.

- **Etapa se alege din `cf-relay/watch-stage.txt`** (fișier comis, ultima linie
  nevidă). Modificarea lui declanșează relay-ul și redeployează cu etapa nouă;
  rollback = un commit cu `d1`. `WATCH_STORE` din environment/variabilă de repo
  îl suprascrie. **Nu** pune `WATCH_STORE` în `[vars]` din `wrangler*.toml`:
  Pages refuză deploy-ul cu „Binding name 'WATCH_STORE' already in use” când
  există și ca secret (a picat o dată, 27.09). Secretul se pune ÎNAINTE de
  `pages deploy`, altfel intră în vigoare abia la deploy-ul următor.
- **Flag: `WATCH_STORE` = `d1` (implicit) | `shadow` | `turso`.** Fără
  credențiale Turso, orice valoare cade pe `d1`. `deploy.sh` îl pune ca
  secret Pages din environment; `[vars]` din `wrangler*.toml` îl ține pe `d1`.
  **Rollback = `WATCH_STORE=d1 ./deploy.sh`**, fără migrare inversă și fără
  ștergerea vreunui rând.
- **Ce NU s-a mutat, deliberat:** `watched_history`, puncte, XP, gold, misiuni,
  streak. Recompensa exact-once e `INSERT OR IGNORE` + `meta.changes` în
  aceeași bază cu `users.points`; mutarea ei ar transforma o garanție atomică
  într-un protocol distribuit. Nu o muta „ca să fie totul la un loc”.
- **`series_id` e denormalizat în tabelul Turso**: nu există JOIN între două
  baze, iar topul săptămânal și cuferele au nevoie de serie. Se scrie din
  aceeași citire pe cheia primară care validează episodul în `progress.js`.
- **Scrierile NU se reîncearcă** (`TURSO_WRITE_RETRIES = 0`): incrementul nu e
  idempotent, o reîncercare ar inventa minute vizionate. Citirile se
  reîncearcă o dată. La eșec/timeout (2,5 s) se scrie în D1 (fallback) și se
  jurnalizează — progresul nu se pierde niciodată.
- **Fallback nu înseamnă tăcere:** divergențe shadow, timeout-uri și eșecuri
  merg în `watch_store_audit` (în Turso) + `console.warn` + contoare
  (`watchStoreStats()`). `node scripts/watch-turso.mjs report` le citește.
  Jurnalul are termen propriu (1 s) ca un Turso lent să nu dubleze latența.
- **Unelte:** `scripts/watch-turso.mjs backfill|compare|report|count`.
  Backfill-ul e idempotent (fuziune cu `MAX(seconds)`, progresul e monoton).
  `compare` raportează lipsă/în plus/delta maxim și iese 1 la nepotrivire.
- **Nu șterge și nu compacta** rândurile vechi din D1 în aceeași lansare cu
  cutover-ul. E o etapă separată, după o perioadă de verificare cu `report`.
- **Etapele pe producție** (relay publică doar din `origin/main`):
  1. merge în `main` cu `WATCH_STORE=d1` → deploy neutru (zero schimbare de
     comportament), migrarea Turso 0002 se aplică singură în pasul 3 din `deploy.sh`;
  2. relay cu `WATCH_STORE=shadow` → dual-write + backfill + `compare`;
     verifică `report` câteva zile (ținta: 0 divergențe);
  3. relay cu `WATCH_STORE=turso` → cutover; `usage.mjs` trebuie să arate
     scrierile D1 în scădere spre ~31%;
  4. canar live: un cont temporar se uită la un episod, apoi verifici DIRECT
     ambele baze (`wrangler d1 execute ... watch_progress` = fără rând nou,
     `node scripts/watch-turso.mjs count/compare` = rândul e în Turso).
- Teste: `node tests/watch-store.mjs` (73 verificări, SQLite real pentru ambele
  baze, fără rețea) rulează în `test.sh`; `tests/watch-budget.mjs` blochează
  regresia de buget (61.300 → 31.300).
- Curățenie în aceeași rundă: `tursoArg()` (rămășiță de la codificatorul Hrana
  scris de mână, înlocuit de driverul vendored) și `public/assets/img/logo.webp`
  (nereferit nicăieri; `logo.png` rămâne pentru `og:image`, `logo-icon.webp`
  pentru nav) au fost șterse.

Următoarea migrare D1 este **0031**. Următoarea migrare Turso este **0003**;
nu modifica 0001/0002 după deploy.

### Relay-ul: diagnostic token + alegere automată a contului CF (2026-09-25)

Proprietarul a pierdut accesul la deploiere pentru că secretul `CLOUDFLARE_API_TOKEN`
lipsea din GitHub Secrets (site-ul live continua să ruleze, dar orice deploy pică în
pasul de verificare). Doi blocaji, ambele remediale în `cf-relay/`:

- **Verificare secret + diagnostic:** workflow-ul scrie în `cf-relay/last-output.txt`
  *înainte* de `cmd.sh` dacă tokenul lipsește, plus un comentariu pe commit (canalul
  principal de citire din sandbox, tokenii redactați — vezi §3).
- **Alegerea contului CF:** secretul `CLOUDFLARE_ACCOUNT_ID` era invalid (53 caractere,
  nu 32 hex) → CF error 7003. `cmd.sh` listează conturile la care tokenul are acces și
  alege pe cel care vede D1-ul `anime-db`; dacă niciunul nu-l vede, iese cu eroare clară.
- **Deploy-ul oprește la prima eroare:** `cmd.sh` propagă exit code-ul lui `deploy.sh`
  (înainte continua la audit și mința cu un rezultat „OK”).

Verificat end-to-end pe live: deploy `exit 0`, canarul de chat a ajuns în D1, markerul
`auk-adaptive` e în chunk-ul publicat, auditul live a ieșit curat, `/api/pulse` viu
(`{"series":5,…,"online":1}`).

### Buget 0, runda de poll (2026-09-25, branch `arena/01a0d983-anime-uke`)

Tab-urile lăsate deschise goleau cota: clopoțelul la 60 s și „N online” la 90 s,
inclusiv pe tab ascuns, plus un request ChatDO la fiecare `/api/pulse`. Acum:

- `adaptivePoll()` în `public/assets/js/core.js` — 0 cereri pe tab ascuns sau
  părăsit 10 minute; backoff 60→120→240→plafon 5 min când numărul nu se schimbă;
  revenire la pasul scurt când se schimbă. Scroll-ul ține tab-ul „viu”, dar nu
  anulează backoff-ul. La re-randarea nav-ului poll-ul vechi e oprit (fără
  scurgere de timere). Test: `tests/poll-buget.mjs` (fără server, ceas controlat).
- `src/routes/api/pulse.js` ține „online” 60 s în izolat + `caches.default`
  (cu timestamp, nu doar max-age). Eșecul DO nu se memorează. `ONLINE_CACHE_MS=0`
  în `dev.sh` (implicit) — producția nu are bindingul, deci cachează.
  **Nu scoate bindingul din dev.sh**: e2e-ul „Pulse vede socket-ul deschis”
  ar vedea un 0 cache-uit. Test: `tests/pulse-online.mjs`.
- Garda anti-cache cere `fetch('/')` (static, 0 invocări), nu `location.pathname`.
- Marker de deploy: `data-poll="auk-adaptive"` (stringul supraviețuiește
  minificării; `cf-relay/cmd.sh` §20 îl caută în chunk-ul publicat).
- Branch-urile vechi `arena/*` de pe remote au fost șterse (toate erau deja
  în `main`). Pe remote rămâne doar `main` + branch-ul sesiunii curente.

Următoarea migrare, dacă e nevoie de schemă, e **0031** (ultima definită e 0030).
Nu edita o migrare deja aplicată.



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
- SSR SEO pe `/episod/<id>` (2026-09-21, branch `arena/01a0c538-anime-uke`): titlu
  „Serie — Episodul N subtitrat în română | Anime-Uke”, description, canonical, `og:type video.episode`,
  JSON-LD `TVEpisode` (+`partOfTVSeries`) și `BreadcrumbList` Acasă → Serie → Episod. Implementare în
  `src/worker.js` (`episodeForSeo` — un JOIN indexat, cache 5 min + cache negativ; la eroare D1 servește
  shell-ul nemodificat, fără 404 fals). e2e 474 → **482**, audit-live are probe noi pe episoade, audit
  producție ✅ **168** · 🟡 0 · 🔴 0 (build `?v=0936caa`). Detalii în `AUDIT-LIVE.md`.
- Verificare totală + reparații (2026-09-21, același branch): `style-src 'unsafe-inline'` deliberat în CSP
  (reclamele A-Ads, pagina 404 din worker și layout-ul admin erau blocate de `style-src 'self'`;
  `script-src` rămâne strict — probele e2e/audit verifică acum per-directivă); HSTS și pe răspunsurile
  workerului; `pulse` citea DO-ul greșit (`'global'` vs `'global-chat'`) → `online` mereu 0, reparat și
  verificat cu socket real (0→1→0); scos din allowlist `/404` (cerea login!), `/admin/serie` bare (JS cu
  NaN), `/covers/*` (director inexistent); `seriesForSeo` la eroare D1 servește shell-ul ca episoadele;
  `robots.txt` fără `Allow: /series`; prerender pe `/serie/*`; șters `tests/prod-smoke.mjs` (expirat,
  dublat de audit-live); README corectat (CSP, frame-src, sandbox). e2e 482 → **491**, audit live
  ✅ 168 · 🟡 0 · 🔴 0, build `?v=1a11f03`. Lecție: după deploy se așteaptă 60s înainte de audit
  (propagarea Pages a servit o dată HTML vechi) — e în `cf-relay/cmd.sh`.
- Curățenie + predare (2026-09-21, același branch; deploy de sincronizare `?v=7703add` — doar llms.txt +
  _headers, zero cod; audit reconfirmat 168/0/0): test de
  regresie pulse (socket deschis → `online ≥ 1`; verificat că pică pe codul vechi) → e2e **492**;
  `llms.txt` fără linkul `/series` (301); scos referințele moarte `/covers` din `_headers`/`deploy.sh`;
  README fără titlul dublat. Vânătoare de cod mort cu rezultat negativ (bine): toate exporturile din
  `src/lib` sunt folosite (unele doar intern — `addXp` via `addActivity`, `MISSIONS` via `getMissionState`;
  `requireModerator` e rezervă documentată pentru rute viitoare), toate apelurile frontend au rută în
  router (verificat scriptic), toate assetele/CSS-ul/imaginile sunt referite. `/api/me/theme` n-are UI
  (doar teste) — by design, tema vine din facțiuni. Live reverificat și prin fetch direct (robots,
  sitemap, pulse, speculationrules, `/404`, `/episod/4210` randat complet).

### Integrare + buget de invocări (2026-09-22, branch `arena/01a0ca0d-anime-uke`)

Două sesiuni au lucrat în paralel pe `main` și ambele deployau în proiectul Pages `anime-uke`:
una pe feature-uri/SEO (`arena/01a0c538-anime-uke`, PR #4 — SSR SEO pe episod, logo, teme de
sezon, shop 2.0, sitemap-uri GSC) și una pe bugetul de invocări (PR #5). Live-ul oscila între
cele două versiuni. Acum e o singură linie, testată împreună:

1. **Buget 0, partea de invocări** (detalii în README → „Cât duce planul gratuit"):
   - `public/_routes.json` — `/assets/*`, `/`, `/login`, `/register`, `/episode`, favicon,
     apple-touch-icon, robots/llms/speculationrules sunt servite direct de stratul static
     (**0 invocări**). Ce NU e acolo rămâne pe worker: API, `/chat`, SSR `/serie/<id>` și
     `/episod/<id>`, paginile din spatele porții, sitemap-urile.
     *Atenție la mentenanță:* orice rută adăugată în `exclude` scapă de poarta de
     autentificare din worker — doar pagini publice, niciodată `/profile`, `/admin`, `/shop`.
   - `GET /api/home` — prima pagină într-o singură invocare (înainte: 5). `page-index.js` o
     cere o dată (`homeData()`, memoizat) și distribuie datele către grilă, topuri, „ultimele
     episoade", filtre, hero și chip-ul „N online" (`claimPulse()`/`pushPulse()` din `core.js`).
   - `public/_headers` preia headerele de securitate pentru căile ocolite, cu valori IDENTICE
     cu `SECURITY_HEADERS` (inclusiv decizia documentată `style-src 'unsafe-inline'` pentru
     A-Ads). `deploy.sh` trece JS/CSS pe `immutable` 1 an, cu marcaje `assets-versioned:start/end`.
   - Imaginile (hero, logo) sunt cerute direct `.webp`; `.jpg`/`.png` rămân pentru
     `og:image`/favicon și ca rezervă. Negocierea `Accept: image/webp` din worker a fost scoasă
     (era cod mort după `_routes.json`), la fel și regula `?v=` → `immutable` și `statusOverride()`.
   - `scripts/usage.mjs` — consumul zilei din cotele gratuite, în `cf-relay/cmd.sh`.
2. **Rezultatul măsurat:** costul unei vizite ~12 → **~2 invocări**; în ziua deployului (cu
   toate testele, deploy-urile și auditurile) consumul a fost **7% din invocări, 0% D1, 1% DO**.
3. **Teste:** e2e 492 → **573** (păstrate toate verificările lor + `/api/home`, `_routes.json`,
   paritatea de headere static↔worker, dovada că assetul nu trece prin worker, logo `.webp`),
   dom-smoke 147 → **163** (numără cererile primei pagini; verificarea flaky a butonului
   „anterior" a fost reparată — butoanele pornesc `disabled` în HTML).
4. **De făcut de proprietar (2 click-uri, gratuit):** dashboard → Workers & Pages → `anime-uke`
   → Settings → Runtime → **Fail open** (la epuizarea cotei, catalogul static rămâne vizibil).

---

### Viteză: code splitting + imagini dimensionate (2026-09-24, runda 3)

- **JS-ul paginilor se bundlează cu `--splitting`** (`deploy.sh`): `core.js`,
  `anim-bg.js` și `chat.js` ajung în chunk-uri `c-<hash>.js` (numele E hash-ul
  conținutului, deci cache imutabil corect fără `?v=`; importurile din bundle
  sunt RELATIVE, `from"./c-x.js"` — nu e nevoie de importmap). Chunk-urile NU
  se comit (`public/assets/js/c-*.js` e în `.gitignore`) și se șterg la fiecare
  deploy înainte de build.
- **`chat.js` nu se mai importă static din pagini.** Se încarcă prin
  `loadChat()`/`initChat()`/`openChat()` din `core.js` (import dinamic, o
  singură pornire per pagină). Cine adaugă o pagină nouă importă chatul din
  `core.js`, nu din `chat.js` — altfel îl pune iar pe calea critică și
  `tests/scripts-health.mjs` pică (verificarea e intenționat ieftină: citește
  sursa, nu build-ul).
- **Coperțile se randează cu `coverImg()`** (`core.js`), nu cu
  `createElement('img')` + `optimizeCover`: primește `w` + `widths` + `sizes` și
  lasă browserul să aleagă treapta potrivită slotului. `optimizeCover` rămâne
  pentru cazurile speciale (hero), dar nu mai cere 400 px pentru un thumbnail.
- **Arta bundled are trei formate** (`<picture>`: AVIF → WebP → JPEG), iar
  `setHeroArt()` din `page-index.js` schimbă toate sursele o dată. Dacă adaugi o
  imagine nouă în banner, adaugă toate cele trei fișiere — altfel browserul cade
  pe rezerva JPEG (și bugetul din `measure-weight.mjs` te anunță).
- **CI pe fiecare push**: `.github/workflows/tests.yml` rulează `./test.sh` (fără
  token Cloudflare, fără deploy) și urcă logurile ca artefacte; `cloudflare-relay`
  l-a rămas doar pentru publicare + audit live (se declanșează la o modificare în
  `cf-relay/`).
- **Bugetul de greutate e testat**: `node scripts/measure-weight.mjs` rulează
  pipeline-ul de deploy pe o copie a repo-ului și compară „calea critică" (HTML
  + CSS + JS eager) cu limitele din capul fișierului. Rulează în `test.sh`
  (faza „greutate", fără server) și încă o dată `dom-smoke` pe artefactele
  construite (`AUK_JS_DIR=/tmp/auk-artefacte/public/assets/js`). Când schimbi
  ceva ce intră în bundle, rulează `npm run weight` ÎNAINTE de commit.

### Funcționalități noi (2026-09-24, branch `arena/01a0ca0d-anime-uke`)

Catalog partajabil prin URL (`?gen=&status=&sort=&page=`), sortarea „Cele mai bine
notate", „episodul următor" direct din cardul de continuare (cu comutator ținut în
`localStorage`) și marcajele ✓ Văzut / Început din lista de episoade (o singură
interogare, doar cu sesiune). Detalii și cifre de buget în README → „Funcționalități
noi"; verificarea pe live în `AUDIT-LIVE.md` §1h.

### Aspect: runda de UX (2026-09-23)

Prima rundă din „mai fain la site" (aspect → funcționalități → viteză). Toate
schimbările sunt gratuite în buget: zero cereri noi, zero imagini noi, zero
biblioteci. Nota pe carduri vine din coloanele denormalizate ale seriei (0028),
deci nu costă o cerere per card; „Continuă vizionarea" folosește `ep_duration`
din același rând de serie și scrie minutele reale când durata lipsește;
filtrele de catalog sunt lipicioase sub navbar; `initToTop()` din `core.js`
adaugă butonul „înapoi sus" pe toate paginile; `/` sare în căutare.

---

### Scara: 1.000 de serii / 1.000 de utilizatori (2026-09-22, migrarea 0028)

Întrebarea proprietarului a primit un răspuns măsurat, nu estimat: `scripts/bench-scale.mjs`
construiește scara maximă pe un D1 local (migrările reale: 1.000 serii, 19.788 episoade,
1.000 useri, 199.011 rânduri de progres, 29.578 note) și raportează rândurile citite.
Rezultatul de dinainte: **~230.000 rânduri pentru o singură vizită pe prima pagină** —
adica ~21 de vizite/zi până la epuizarea cotei de 5M. Trei interogări scanau tabele
întregi la fiecare afișare: topul săptămânal (199.011), topul notelor (29.578) și pulse
(41.576). Migrarea 0028 + codul aferent le-au adus la ~64 rânduri/vizită:

- `idx_progress_updated` — fereastra de 7 zile devine căutare în index;
- `anime_series.rating_avg/rating_count` + `idx_series_rating` — media notelor se
  resincronizează în ACELAȘI batch cu votul (`src/lib/ratings.js`), clasamentul citește
  5 rânduri (era GROUP BY pe toate notele site-ului);
- `idx_series_created_id` — catalogul nu mai are nevoie de B-tree temporar;
- `site_meta.users_total/views_total` — pulse citește 4 contoare (era 41.576 rânduri);
- topul săptămânal se ține o oră în `leaderboard_cache` (tabelul din 0008, până acum
  nefolosit): recalculul costă ~4.000 rânduri, 24 de ori pe zi, iar cererile obișnuite
  citesc 1 rând. `TOP_CACHE_MINUTES=0` (dev/teste) îl face proaspăt la fiecare cerere.

Regula care ține site-ul în buget: **nimic din calea fierbinte nu are voie să SCAN-eze un
tabel mare**. `bench-scale.mjs` are o gardă anti-derivă (verifică înainte de rulare că
SQL-ul măsurat există în handler), deci dacă cineva schimbă o interogare, bench-ul cade
zgomotos în loc să raporteze cifre pentru altceva.

---

## 7. Backlog (idei discutate cu proprietarul, neîncepute — cere confirmare înainte)

- Din audit (`AUDIT-LIVE.md` §3 — alegeri de produs, nu defecte): canonical/og hardcodate pe
  `anime-uke.pages.dev` în `index.html`/`login.html`/`register.html` (de mutat pe `CANONICAL_ORIGIN` când apare
  domeniul propriu); audit live cu sesiune (are nevoie de un cont de test).
  SSR SEO pe `/episod/<id>` e **gata** (2026-09-21, vezi §6).
  `/episode` fără id: shell-ul e acum servit direct din stratul static (e în `_routes.json`),
  deci un 301 ar trebui făcut din `_redirects` sau scoțând ruta de sub bypass — nu din worker,
  care nu-l mai vede.

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

---

## Regulile proprietarului (adicate manual, au prioritate MAXIMA)

1. **Flux de livrare:** build → `./test.sh` verde → commit → **push direct în main** →
   deploy. **FĂRĂ pull requests.** (PR-urile #21–#23 au fost excepția altui agent,
   nu regula.)
2. **Viteză:** puține du-te-vino; dacă o metodă eșuează de două ori, schimbă metoda
   imediat și spune ce ai schimbat. Fără așteptare de ore.
3. **Buget 0:** doar planuri gratuite. Turso e tolerat DOAR cât rămâne free tier și
   există rollback documentat spre D1; orice alt vendor nou = întrebare explicită
   către proprietar înainte.
4. **Interdicții:** fără scraping de site-uri piratate și fără linkuri mega.nz /
   similare; **fără auto-next** (scos la cerere explicită — nici măcar comentarii
   care să sugereze că există); fără reCAPTCHA / Google Analytics / anti-debug;
   fără secțiune de caractere / Pokémon.
5. **Player:** video inline; fără buton propriu de fullscreen; fullscreen-ul nativ al
   providerului trebuie să meargă; `allow="fullscreen *; …"`; **fără `sandbox`** pe
   iframe-ul playerului.
6. **Puncte:** doar după 15 minute de vizionare, prin progresul de vizionare
   (indiferent de store-ul activ: D1 sau Turso).
7. **Igienă:** `rm -rf .wrangler /home/user/.config/.wrangler` după deploy/teste;
   `chmod +x *.sh` după restore-uri de sandbox; snapshot < 128 MB / 10k fișiere.
8. **Gate public:** catalogul public e decizia curentă (SEO/GSC). Zonele personale
   (profile, admin, chat, PM) rămân strict în spatele login-ului.

---

## REGULA DE AUR pentru o sesiune/agent NOU
Lucrezi DOAR pe site-ul EXISTENT: `https://anime-uke.pages.dev`, proiectul Cloudflare
Pages `anime-uke`, repo-ul `ExMarius/anime-uke`, baza D1 `anime-db` (+ Turso pentru
progres). **NICIODATĂ site/proiect/repo nou, niciodată rebuild de la zero.**
„Clone"-ul de mai jos NU face un al doilea site: doar descarcă codul curent ca să-l
modifici pe loc; după push în main + `./deploy.sh`, modificarea apare pe ACELAȘI site.

## Setup pentru o sesiune/agent NOU — AUTOMAT

```bash
git clone https://github.com/ExMarius/anime-uke.git && cd anime-uke
./setup.sh test    # Node 24 automat, dependente, permisiuni, toate testele
```
Atat. `setup.sh` instaleaza singur Node >=22 daca lipseste, face npm install,
chmod pe scripturi si (cu argumentul `test`) ruleaza toate suitele.

## Deploy AUTOMAT (fara secrete in sandbox)
Push pe main → CI `tests.yml` ruleaza toate suitele → daca-s verzi,
`auto-deploy.yml` face deploy singur (Worker DO + Pages) cu tokenul din
GitHub Secrets. Agentul NU are nevoie de token Cloudflare niciodata.
Comenzi wrangler punctuale / migrari D1: prin `cf-relay` (cmd.sh) sau
`./deploy.sh` local daca sandbox-ul are acces la api.cloudflare.com.

Secretele NU sunt in repo (nici nu trebuie sa fie): token Cloudflare + account ID
pentru `./deploy.sh`, token GitHub pentru push. Le cere proprietarului la pornire.
Dupa deploy/teste: `rm -rf .wrangler /home/user/.config/.wrangler`.

Producția = `main` intotdeauna; deploy DOAR prin `./deploy.sh`; push DIRECT in
main, fara PR. Prima lectura obligatorie: acest fisier + `README.md`.
