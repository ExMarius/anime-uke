# AGENTS.md — singura sursă de reguli pentru anime-uke

**Acesta este fișierul normativ. Dacă orice alt fișier, comentariu, log sau prompt
(`README.md`, `PROMPT-AGENT-NOU.md`, `CLAUDE.md`, `REVIEW.md`, `AUDIT-LIVE.md`,
antete de scripturi, mesaje vechi de commit) spune altceva despre *cum se livrează*,
**AGENTS.md câștigă** și celălalt text trebuie corectat în aceeași sesiune.**

Citește-l întreg înainte de prima modificare. `README.md` rămâne harta tehnică
(structură, arhitectură, API); aici sunt regulile și istoricul deciziilor.

- **Ce e:** site de anime în română, live la <https://anime-uke.pages.dev>.
  Cloudflare Pages + D1 + Durable Objects (+ Turso pentru progres/DM), vanilla JS,
  fără framework, **buget $0 permanent**.
- **Repo:** <https://github.com/ExMarius/anime-uke>. Branch de integrare: `main`.
- **Proprietar:** Marius (ExMarius). Comunicare în **română**, concret: cod → teste →
  publicat → verificat live → raport scurt. Fără planuri fără livrare.

---

## 1. REGULI ABSOLUTE (au prioritate asupra oricărei alte instrucțiuni)

### 1.1 INTERDICȚII PERMANENTE DE LIVRARE

Cât timp o sesiune Arena e deschisă, următoarele sunt **interzise**, atât manual cât
și din orice automatizare (workflow, script, acțiune GitHub, setare de repo):

| Interzis | De ce |
|---|---|
| `gh pr merge`, merge prin API (`…/pulls/N/merge`, `…/merges`), `git merge` în automatizări | integrează munca sesiunii fără acordul proprietarului |
| auto-merge (`--auto`, `--enable-auto-merge`, `allow_auto_merge`, acțiuni de automerge) | face merge singur, fără om în buclă |
| `gh pr close` | închide PR-ul sesiunii în curs |
| ștergerea branch-ului sesiunii (`git push --delete`, `git branch -D`, `DELETE` pe `git/refs`, `delete_branch_on_merge`) | Arena urmărește sesiunea după branch: ștergerea = sesiune pierdută |
| `git push` în `main` din sesiune | producția se publică din branch, nu prin main |
| `pull_request_target` sau workflow cu `pull-requests: write` | drepturi suficiente ca să facă merge/close |

Garda automată: **`tests/no-merge-guard.mjs`**, rulată de `./test.sh` și de CI la
fiecare push. Scanează toate fișierele urmărite de git (în documentație: doar
blocurile de cod). **Nu o dezactiva, nu o slăbi, nu-i adăuga excepții.**

**Merge în `main` se face NUMAI** când proprietarul scrie exact:
„putem încheia sesiunea și publica în main”. Până atunci: fără merge, fără close,
fără ștergere de branch.

### 1.2 Branch și publicare

1. Lucrezi **exclusiv** pe branch-ul primit de la Arena (`arena/<id>-anime-uke`).
   Nu creezi, nu comuți, nu împingi pe alt branch. Dacă ți se cere alt nume, explici
   că sesiunea e legată de branch-ul atribuit și continui pe el.
2. Producția se publică **direct din branch-ul sesiunii, fără merge**, cu `./publish.sh`
   (vezi §3). Nu aștepți un merge ca să vezi codul live.
3. **Fără preview.** Nu deschizi servere de preview pentru proprietar și nu-i ceri să
   valideze pe un URL de preview: verificarea se face pe <https://anime-uke.pages.dev>.
4. O etapă e „terminată” doar când: teste verzi → commit pe branch-ul sesiunii →
   publicat în producție → **verificat pe site-ul live** → raportat.

### 1.3 Buget 0, permanent

- Doar planuri gratuite. **Zero** servicii plătite, trial-uri cu card, add-on-uri care
  se activează automat sau vendori noi fără întrebare explicită către proprietar.
- Turso e tolerat **doar** cât rămâne free tier și există rollback documentat spre D1
  (`WATCH_STORE=d1`). Orice alt vendor = întrebare înainte.
- Cota gratuită e o resursă de proiectat, nu o surpriză: scrierile D1 (100k/zi) se
  bufferizează în Durable Objects, nimic din calea fierbinte nu scanează tabele mari,
  polling-ul e adaptiv. `node scripts/usage.mjs` arată consumul zilei.

### 1.4 Secrete și conținut

- **Niciun secret în repo**, în loguri, în mesaje de commit sau în `cf-relay/cmd.sh`.
  `CLOUDFLARE_API_TOKEN`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` stau exclusiv în
  GitHub Actions Secrets; relay-ul le propagă în runtime-ul Pages și Worker DO.
- **Fără surse video neautorizate.** Scraping de site-uri piratate, `mega.nz`,
  `f7hyg4q.org` și similare = interzise permanent, inclusiv reactivarea unor rânduri
  vechi din `episode_sources`.
- Alte interdicții permanente: **fără auto-next** (nici măcar comentarii care sugerează
  că ar exista), fără reCAPTCHA / Google Analytics / anti-debug, fără `sandbox` pe
  iframe-ul playerului, fără secțiune de caractere / Pokémon.
- Reclame (A-Ads sau altele): doar dacă proprietarul cere explicit monetizare.

### 1.5 Ce nu se șterge

Nu ștergi și nu redenumești funcționalități, date, **migrări**, teste sau documentație
tehnică fără să verifici întâi că nu sunt referite
(`grep -rn <nume> src public scripts tests *.sh .github`) și fără să spui ce faci.
Migrările aplicate nu se editează niciodată; se adaugă una nouă.

### 1.6 Ritm

Dacă o metodă eșuează de două ori, o schimbi imediat și îi spui proprietarului ce ai
schimbat. Puține du-te-vino, fără așteptări de ore.

---

## 2. Ciclul de lucru

1. Citește codul zonei pe care o atingi (fiecare fișier are un antet care explică *de ce* există).
2. Schimbare de schemă? → **migrare nouă** `migrations/00NN_nume.sql` (următoarea: **0036**;
   Turso: **0003**). Niciodată nu edita o migrare aplicată.
3. Endpoint nou? → fișier în `src/routes/api/`, **înregistrat în `src/router.js`**
   (metoda `'*'` dacă ai mai mulți handleri în fișier — altfel GET-ul dă 405 în producție).
4. Clasă CSS construită dinamic în JS (`'foo foo--' + x`)? → safelist în
   `scripts/purge-css.mjs`, altfel **dispare la deploy**.
5. Scrie verificări în `tests/e2e.mjs` (API) și/sau `tests/dom-smoke.mjs` (pagini).
   Stil: `check('descriere', conditie, detaliu)`. Atingi rutare/SEO/headere? rulează și
   `node scripts/audit-live.mjs http://localhost:8788`.
6. `./test.sh` complet verde (include `no-merge-guard`) → commit cu mesaj descriptiv în română.
7. `git push origin <branch-ul sesiunii>` → `./publish.sh "ce publici"` → verifici live → raportezi.

### Setup în 60 de secunde

```bash
npm install                       # Node 22+; wrangler ≥ 4.131.2
cp .dev.vars.example .dev.vars    # JWT_SECRET local (dev.sh îl generează dacă lipsește)
npm run dev                       # ./dev.sh → http://localhost:8788 (aplică migrările locale)
npm test                          # ./test.sh — bază curată; loguri în /tmp/*.log
```

`./setup.sh test` face totul dintr-o comandă (Node, dependențe, `chmod +x`, suite).
Pe o bază locală goală **primul cont înregistrat devine admin**. Înregistrarea locală e
plafonată (`LIMIT_USERS`). Nu există browser headless în sandbox: paginile se testează în
**jsdom** (`tests/dom-smoke.mjs`).

---

## 3. Publicare în producție (fără merge, fără preview)

Sandbox-ul agentului **nu are rețea** către `api.cloudflare.com` și nici către
`pages.dev` (TLS blocat). Singurul drum spre producție e relay-ul din GitHub Actions,
care rulează pe un runner cu secretele din GitHub.

```bash
./test.sh                                  # totul verde, obligatoriu
git add -A && git commit -m "..."          # pe branch-ul sesiunii
./publish.sh "ce publici, pe scurt"        # împinge branch-ul + declanșează relay-ul
```

Ce se întâmplă:

1. `publish.sh` refuză `main`, refuză un arbore murdar, adaugă o linie în
   `cf-relay/deploy-request.txt`, comite și împinge **numai branch-ul curent**.
2. Push-ul pornește două workflow-uri:
   - `tests.yml` — toate suitele, pe orice branch;
   - `cloudflare-relay.yml` — **poarta de teste** (așteaptă verdictul suitei pentru
     exact acest commit; roșu ⇒ nu publică), apoi `cf-relay/cmd.sh`.
3. `cf-relay/cmd.sh` publică **exact commitul care l-a declanșat** (marker
   `PUBLICA_BRANCHUL_CURENT=1`, log `publicare DIRECTĂ … din <branch>@<sha>`), rulează
   `./deploy.sh` (D1 → migrări remote → Turso → Worker DO → Pages `--branch=main` →
   JWT), apoi auditul live pe <https://anime-uke.pages.dev>.
4. Rezultatul se citește în două locuri: **comentariul pe commit** (canalul garantat,
   cu tokenii redactați) și `cf-relay/last-output.txt`, comis înapoi pe branch.

```bash
gh api repos/ExMarius/anime-uke/commits/<sha>/comments --jq '.[-1].body'
git pull --rebase origin <branch-ul sesiunii> && tail -80 cf-relay/last-output.txt
```

Reguli de operare ale relay-ului:

- **Un singur deploy odată.** Toate declanșările publică în ACELAȘI proiect Pages;
  `concurrency: cf-relay` le serializează. Verifică `git log --all --oneline -15`
  înainte de un trigger manual.
- Logurile Actions **nu** se pot citi cu `gh run view --log` din sandbox; folosește
  comentariul pe commit.
- `CLOUDFLARE_ACCOUNT_ID` e opțional: `cmd.sh` alege singur contul care vede D1-ul `anime-db`.
- Migrările D1/Turso rulează în `deploy.sh`, deci la fiecare publicare. Nu le rula separat.
- **Pages Git integration e activă:** fiecare push construiește și un deployment din git.
  Producția optimizată (`?v=`, purge, minify) vine din relay, nu din buildul git — după
  orice publicare din git, rulează un `./publish.sh` ca să readuci forma optimizată.
- `auto-deploy.yml` publică automat numai pe `main` (după merge-ul final aprobat de
  proprietar). Nu atinge branch-urile de sesiune.
- Comentariile din JS sunt stripate la minificare — nu folosi text din comentarii ca
  marker de deploy; folosește identificatori (nume de funcții, id-uri HTML, clase CSS).
- Igienă după deploy/teste locale: `rm -rf .wrangler /home/user/.config/.wrangler`;
  `chmod +x *.sh` după restore-uri de sandbox.

---

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

- **`slugify()` există în două locuri** (`src/lib/slug.js` pe server,
  `genreSlug()` în `public/assets/js/page-index.js`) pentru că bundle-ul
  clientului nu importă din `src/`. Dacă schimbi una fără cealaltă, chip-urile
  de gen duc în 404. Testul DOM „pagini de gen” prinde asta.
- **Rutele de pagină noi (`/gen/...`) au nevoie de trei intrări** în
  `src/worker.js`: `DYNAMIC_PAGES` (ce asset se servește), lista de căi publice
  (altfel cer autentificare) și, dacă vrei SSR, un bloc în `serveStatic`.

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
- **Moderarea chatului** (0035): `chat_messages.mid` = cheia mesajului din ChatDO,
  scrisă și în arhivă, ca ștergerea să-l găsească în ambele locuri. Sancțiunile
  (tăcere temporară, mod lent) stau în **storage-ul DO-ului**, nu în D1 — altfel
  o evicție le-ar ridica singură. Dreptul vine din `can_mod` pus în attachment de
  `src/routes/chat.js` (`canModerate` pe sesiunea din D1), niciodată din client.
  Modul lent se comută din `/api/admin/chat-slow` (panoul de staff), NU din chat.
- **Noutăți** (`news`, 0034): jurnalul primei pagini. Tipuri: `serie` (automat, la
  creare), `sezon` (automat, la activarea temei), `anunt` (manual, din admin).
  Știrile automate se adaugă cu `newsStmt(env, {...})` **în batch-ul D1 care există
  deja la locul evenimentului** — zero round-trip în plus. Episoadele NU produc știri
  (ar dubla secțiunea „Ultimele episoade"). Linkurile sunt doar interne (`/...`).

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

### Homepage editorial + SEO de catalog (2026-09-29)

- Homepage-ul are acum o zonă originală **„Spune-ne ce vibe ai”** cu patru stări.
  Butoanele aleg primul gen existent în catalog din lista deja inclusă în `/api/home`,
  aplică filtrul partajabil și nu adaugă nicio invocare Worker.
- **„Alegerea comunității · săptămâna aceasta”** refolosește primul rând din topul
  săptămânal (fallback: top rating), inclusiv coperta; zero endpoint sau query nou.
- Head-ul paginii declară `WebSite` + `SearchAction`, `Organization` și `CollectionPage`
  în JSON-LD, plus dimensiunile cardului OG și `summary_large_image` pentru Twitter.
- Designul nou e CSS pur, responsive, fără fonturi/imagini/dependențe externe. Măsurat după
  pipeline-ul real: homepage **40,1 KB gzip** pe calea critică (buget 45 KB), JS critic
  16,3 KB (buget 19,5 KB), CSS 18,9 KB (buget 22 KB).
- Verificare înainte de livrare: `./test.sh` complet verde — e2e 617, DOM sursă 219,
  DOM build 215, plus toate suitele auxiliare.

### Pagini de gen indexabile `/gen/<slug>` (2026-09-30, branch `arena/01a0eddc-anime-uke`)

Filtrarea pe gen exista doar ca query (`/?gen=Acțiune`). Google tratează
parametrii ca variante ale aceleiași pagini și rareori le indexează separat,
deci site-ul **nu avea nicio pagină** pentru „anime acțiune subtitrat în
română" — exact tiparul de căutare care aduce trafic.

- `src/lib/slug.js` — `slugify()` (diacritice → ASCII, max 40 caractere) și
  `genreFromSlug()`. **Aceeași funcție e duplicată intenționat** în
  `page-index.js` (`genreSlug`): dacă cele două nu dau același rezultat,
  linkurile interne ar duce în 404. Le modifici împreună.
- `src/worker.js`: regulă `DYNAMIC_PAGES` pentru `/gen/<slug>` (servește `/`),
  `genresForSeo()` + `seriesInGenre()` (cache 5 min în izolat, ca restul SSR-ului),
  `genreSeoTags()` + `injectGenreSeo()` — titlu, descriere, canonical, OG,
  JSON-LD `CollectionPage` + `ItemList` + `BreadcrumbList`.
- Slug inexistent → **404 real**, nu pagină goală indexabilă (soft 404).
  Dacă D1 pică, se servește shell-ul obișnuit — nu inventăm 404-uri.
- `<meta name="auk-genre">` e semnalul spre client: `page-index.js` citește
  meta-ul, aplică filtrul și nu mai adaugă `?gen=` în URL (altfel ar rezulta
  două adrese pentru același conținut).
- Chip-urile de gen sunt acum `<a href="/gen/...">`, nu `<button>`: așa
  crawlerul descoperă paginile. Click-ul rămâne instant (filtrare pe loc,
  `preventDefault`), dar Ctrl/Cmd-click deschide normal în tab nou.
- Serverul randează și o listă `<nav id="gen-ssr">` cu linkuri către serii,
  pentru crawler și pentru vizitatorii fără JS; JS-ul o elimină la boot.
- Paginile de gen intră în **sitemap** și în `robots.txt`. Sitemap-ul nu mai
  memorează o oră varianta de fallback (D1 căzut / catalog gol).
- Paginile de serie au primit `BreadcrumbList` (Acasă → gen → serie), pe care
  Google îl afișează sub titlu în rezultate.
- `/api/genres`: lista goală se ține 10 s (era 1 min) — de ea depind acum și
  linkurile interne, nu doar filtrul.
- Teste: e2e §24 (13), DOM „pagini de gen" (7). Suite: e2e 683, DOM sursă 242,
  DOM build 238. Toate paginile rămân în buget.

### Moderarea chatului live (2026-09-30, branch `arena/01a0eddc-anime-uke`)

Chatul era singurul loc din site fără unelte de moderare: comentariile au
raportări, utilizatorii au ban, chatul — nimic. Un moderator care vedea spam sau
un link piratat putea doar să privească.

- `migrations/0035_chat_moderation.sql` — `chat_messages.mid` + `idx_chat_mid`.
- `ChatDO`: comenzi `mod` pe socketul existent (`delete`, `mute`), stare în
  `storage` (`MOD_KEY`), rută internă `/slow` pentru modul lent, audit în `admin_log`.
- `mute` e **comutator**: al doilea apel ridică tăcerea. Așa clientul nu mai ține
  lista celor sancționați (adevărul e în DO) — mai puțin cod livrat tuturor.
- Protecții: staff-ul nu se moderează între ei, nu te poți reduce la tăcere pe
  tine, durate doar din `MUTE_MINUTES` (5/15/60), mod lent 0-60 s.
- `/api/admin/chat-slow` (GET/POST, moderator) + comutator în tabul „🚩 Raportări".
- **Bugetul JS a dictat arhitectura**: `chat.js` se descarcă pe toate paginile și
  are 8.0 KB gzip plafon. Prima variantă (listă de mute în client, buton de mod
  lent în antet) a dus la 8.5 KB. Soluția: starea a rămas pe server, iar modul
  lent a plecat în panoul de admin, unde greutatea nu o plătesc vizitatorii.
- Teste: `tests/chat-mod.mjs` (30, rulat de `test.sh`), e2e §23 (9).

### Noutăți: jurnalul primei pagini (2026-09-30, branch `arena/01a0eddc-anime-uke`)

Prima pagină arăta „Ultimele episoade", dar nimic nu spunea că a apărut o **serie
nouă**, că s-a schimbat **tema de sezon** sau că echipa are un **anunț**.

- `migrations/0034_news.sql` — tabelul `news` (`kind`, `title`, `body`, `link`,
  `created_at`, `author_id`) + `idx_news_recent`.
- `src/lib/news.js` — `newsStmt()` (statement pentru batch), `validateAnnouncement()`,
  `sanitizeNewsLink()` (respinge `//`, `http(s)://`, `javascript:` → doar linkuri interne).
- Cârlige automate: `admin/series.js` (în batch-ul cu `bumpMetaStmt`, deci o serie
  care nu se salvează nu produce știre) și `admin/season.js` (doar la ACTIVARE).
- `GET /api/news` public, cache 60 s în izolat (ca `/api/recent`), inclus în
  `/api/home` → **zero invocări noi**. `invalidateNewsCache()` se apelează la scriere.
- `/api/admin/news` GET/POST/DELETE + tab „📣 Noutăți" în admin.
- **Front-end fără CSS nou**: secțiunea refolosește `.card--ep`, `.ep-num`,
  `.card__body/__title/__meta/__desc`. Prima variantă, cu clase proprii, a împins
  CSS-ul paginilor de admin la 22.1 KB (buget 22.0) — `style.css` e un fișier comun,
  deci orice regulă nouă se plătește pe TOATE paginile.
- Rutele publice noi trebuie trecute în `PUBLIC_API` din `src/worker.js`, altfel
  primesc 401 înainte să ajungă la router (asta a picat prima rulare e2e).
- Teste: e2e §22 (18 verificări), dom-smoke (6), relay §23 (verificare live).

### Autentificare: schimbarea parolei + recuperare asistată de staff (2026-09-29, branch `arena/01a0eddc-anime-uke`)

Pachetul era scris și testat de sesiunea `arena/01a0e393` (PR #25), dar a rămas nepublicat
trei zile fiindcă producția se putea atinge doar prin merge. Acum, cu publicarea din branch,
a fost adus prin `git cherry-pick -x` (doar cele 4 commituri de funcționalitate; commiturile
de docs/relay au fost sărite, ca să nu rescrie regulile noi). **PR #25 rămâne deschis** —
nu se închide și nu se dă merge până nu spune proprietarul.

- **Schimbarea parolei** (`POST /api/auth/password`): cere parola actuală și rotește
  `users.auth_version` (migrarea **0031**). JWT-ul e stateless, deci fără versiune în DB
  toate cookie-urile vechi ar fi rămas valide; acum orice sesiune veche pică instant.
- **Recuperare fără vendor de e-mail** (migrarea **0032**): pagina publică `/reset-password`
  nu enumeră conturi; cererea intră într-o coadă în admin, unde staff-ul o validează și emite
  un cod de 128 de biți, arătat **o singură dată** și stocat doar ca PBKDF2 + salt. Expiră în
  30 de minute și se consumă atomic, în același batch D1 cu rotirea `auth_version`
  (`claim_nonce` împiedică două revendicări paralele). Un singur cod activ per cont
  (index unic parțial). **Motivul deciziei: buget 0** — MailChannels nu mai e gratuit, iar
  orice alt furnizor ar fi însemnat vendor nou, deci întrebare către proprietar.
- **Credit de echipă pe episod:** câmpul `team` al seriei ajunge în `GET /api/episodes/:id`
  și în metadatele playerului, fără request suplimentar.
- **Ultima vizionare pe profil:** link către ultimul episod terminat, doar pe profilul propriu
  (migrarea **0033** adaugă indexul, ca să nu sorteze tot istoricul).
- Verificat: `./test.sh` complet verde — e2e **642**, DOM sursă **228**, DOM build **224**,
  greutate în buget (cea mai grea pagină: profile 44,3 KB gzip din 45 permise).

Capcană de sandbox întâlnită aici: după recrearea mediului, `node_modules` lipsea parțial
(`ws`, `purgecss`) — suita pica „aiurea”, cu CSS peste buget și module negăsite. `npm ci`
rezolvă; nu căuta bug-ul în cod înainte să verifici dependențele.

---

### Publicare din branch-ul sesiunii + gardă anti-merge (2026-09-29, branch `arena/01a0eddc-anime-uke`)

Cerere explicită a proprietarului: sesiunile Arena trebuie să poată publica în producție
**fără merge**, iar mecanismele care pot închide o sesiune (merge / close / auto-merge /
ștergere de branch) trebuie să devină imposibile, nu doar nerecomandate.

- **Relay-ul publică branch-ul care îl declanșează.** Până acum `cf-relay/cmd.sh` făcea
  checkout detașat pe `origin/main` și publica alt cod decât cel care pornise workflow-ul —
  adică nimic nu ajungea live fără merge. Deturnarea a fost scoasă; în loc, scriptul
  exportă `PUBLICA_BRANCHUL_CURENT=1`, `RELAY_REF`, `RELAY_SHA` și logează
  `publicare DIRECTĂ în producție din <branch>@<sha> (fără merge)`.
- **Canal explicit de publicare:** `cf-relay/deploy-request.txt` (nou) e în `paths`-ul
  workflow-ului; `./publish.sh "motiv"` (nou) scrie linia, comite, împinge **doar**
  branch-ul curent, așteaptă rularea și afișează verdictul + auditul.
- **Poarta de teste în relay:** înainte de deploy, workflow-ul așteaptă (max 7 min)
  verdictul suitei `tests` pentru exact acel SHA; roșu ⇒ deploy oprit, absent ⇒
  avertisment și continuare. `timeout-minutes` a urcat la 30.
- **Gardă permanentă `tests/no-merge-guard.mjs`** (prima fază din `test.sh`, după
  `scripts-health`): scanează toate fișierele urmărite de git după `gh pr merge/close`,
  `--auto`, `allow_auto_merge`, `delete_branch_on_merge`, `git merge`, `git branch -D`,
  `git push --delete`, `DELETE` pe `git/refs`, acțiuni de automerge, `pull_request_target`,
  `git push … main` — în documentație doar în blocurile de cod. Plus gărzi pozitive:
  relay-ul nu revine la `origin/main`, niciun workflow nu cere `pull-requests: write`,
  `publish.sh` refuză `main`, `test.sh` chiar rulează garda, AGENTS.md ține regula scrisă.
- **Reguli unificate:** AGENTS.md a devenit singura sursă normativă. Instrucțiunile
  contradictorii („push direct în main, fără PR”, „producția = main întotdeauna”,
  „relay-ul face checkout la origin/main”) au fost înlocuite; `PROMPT-AGENT-NOU.md`,
  `CLAUDE.md` și `README.md` trimit acum aici, iar conținutul lor util a fost mutat, nu șters.
- **Setări de repo verificate** (rămân așa): `allow_auto_merge=false`,
  `delete_branch_on_merge=false`, fără rulesets.
- **Verificat live**, de două ori, direct din branch (fără merge): commit `ad4c873`
  (push care atinge `cf-relay/*`) și commit `334d699` (prin `./publish.sh`). Ambele:
  `exit deploy: 0`, `?v=` din producție = SHA-ul branch-ului, audit live
  **✅ 190 · 🟡 0 · 🔴 0 · ℹ️ 36**, `exit audit: 0`, canarul de prietenie + DM OK.
- **Curățenie de branch-uri** (verificată întâi, vezi `AUDIT-BRANCHURI.md`): șterse
  5 branch-uri Arena complet integrate, fără commituri unice și fără PR deschis
  (`01a0d9c7`, `01a0da3a`, `01a0e1b9`, `01a0e1fa`, `01a0e2e9`). Păstrate cele cu
  commituri unice (`01a0d983`, `01a0dd39`, `01a0df81`, `01a0dfd5`), cel cu PR deschis
  (`01a0e393`, PR #25) și cel din sesiunea imediat anterioară (`01a0edbf`).
  SHA-urile sunt în tabel: orice ștergere e reversibilă cu
  `git push origin <sha>:refs/heads/<branch>`.
- **Rămâne de decis cu proprietarul:** Cloudflare Pages are încă Git integration
  activă, deci fiecare push pe branch produce și un *deployment de preview*
  (`env=preview`, URL de forma `https://<hash>.anime-uke.pages.dev`). Producția nu e
  afectată. Se poate opri din configurația proiectului Pages
  (`preview_deployment_setting: none`), dar atunci relay-ul pierde semnalul de
  sănătate „buildul Git a trecut”. Nu s-a atins nimic fără acordul lui.

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

---

## 8. Roadmap confirmat cu proprietarul (în ordinea asta)

Conținut mutat aici din `PROMPT-AGENT-NOU.md`, ca să existe o singură listă.
Înainte de a începe un punct, confirmă-l — prioritățile se pot fi schimbat.

**P0 — decis, de terminat**

1. **Surse video piratate (mega.nz, f7hyg4q.org) = interzise permanent.** Au fost
   dezactivate în producție (`is_active=0`, 4 rânduri, seriile 1015/1019). Decizia
   proprietarului: ori ștergi seriile adăugate fără surse proprii (1015 Liar Game,
   1017 Jitsu wa, 1018 DanMachi, 1019 Lord of Mysteries), ori le pui surse deținute
   sau controlate de el. Niciodată nu reactivezi linkuri piratate.

**P1 — de întrebat înainte de cod**

2. **Reclame A-Ads** (iframe `acceptable.a-ads.com`) pe `index.html`, `series.html`,
   `episode.html` — adăugate fără aprobare. Implicit: scoase, dacă nu cere monetizare.
   Atenție la layout-ul cinema/fullscreen după scoatere.
3. **Turso** = vendor extern peste regula „doar Cloudflare”; tolerat cât e free tier și
   există rollback (`WATCH_STORE=d1`). Întreabă dacă rămâne.
4. **Catalogul**: regula veche era „doar One Piece (1014)”; acum sunt 5 serii.
   Confirmă ce vrea în catalog.

**P2 — de adăugat**

5. Flux de **resetare parolă** (auth are doar login/register/logout/me/options).
   Există lucru neintegrat pe branch-ul `arena/01a0e393-anime-uke` (PR #25, deschis).
6. Completare profil ✅ → facțiuni (blocat: proprietarul trebuie să spună ce nu merge)
   → **știri automate ✅ (2026-09-30, secțiunea „Noutăți")** →
   **upgrade-uri chat: moderare live ✅ (2026-09-30)** →
   căutare ✅ / filtre sezoniere / sondaje → 2FA. Mini-jocul cu creaturi la urmă.
   **SEO: pagini de gen `/gen/<slug>` ✅ (2026-09-30)** — la cererea proprietarului
   („să fim foarte în top”).
7. Conținut: subtitrări `.vtt` lipite pe episoadele din producție
   (admin → serie → edit episod; proxy-ul `/api/subtitle` funcționează).
8. Verifică OG image + favicon pentru sharing (Discord/Telegram).

---

## 9. Predare

Când închei o sesiune mai lungă, actualizează **§6** (ce ai făcut) și **§7/§8**
(ce rămâne) — pentru următorul agent ăsta e singurul context de încredere.
Raportul către proprietar: în română, scurt, cu ce s-a schimbat și linkul live.
