# Lansarea publică — Anime-Uke

**Data:** 8 noiembrie 2026 · **Site:** https://anime-uke.pages.dev · **Cost:** 0 lei/lună
**Build de lansare:** branch `arena/2534f1f0-anime-uke` (realizări + domeniu canonic)

Documentul ăsta răspunde la trei întrebări, în ordinea în care contează la o lansare:
**cu ce domeniu intrăm**, **ce verificăm înainte de a da drumul** și **cum rămâne totul la cost 0**
după ce încep să intre oameni.

---

## 1. Domeniul: ce e gratuit cu adevărat „pe vecie”

Adevărul, pe scurt: **un domeniu de nivel superior (TLD) propriu nu e gratuit pe vecie nicăieri.**
Ce există gratis și durabil sunt **subdomenii** oferite de proiecte non-profit sau de comunități de
dezvoltatori. Sunt perfecte pentru lansare, dar au un compromis pe care trebuie să-l știi din prima:
numele rămâne la provider, nu la tine.

| Opțiune | Ce primești | Cost | Cât durează obținerea | Riscul real |
|---|---|---|---|---|
| **`anime-uke.pages.dev`** (ce avem acum) | subdomeniu Cloudflare Pages, HTTPS, CDN, HTTP/3 | 0 | 0 (deja activ) | zero — trăiește cât proiectul Pages, care e gratuit la nesfârșit |
| **DigitalPlat FreeDomain — `*.dpdns.org`** | subdomeniu cu DNS propriu (Cloudflare/FreeDNS) | 0 | minute–1 zi | non-profit (sponsorizat de Cloudflare/GitHub, fiscal prin Hack Foundation); termenii se pot schimba, numele nu se poate muta la alt registru |
| **EU.org — `*.eu.org`** | subdomeniu vechi, respectat, „pe vecie” | 0 | **săptămâni–luni** (revizuire manuală) | aprobare lentă, fără garanție de nume |
| **is-a.dev — `*.is-a.dev`** | subdomeniu pentru proiecte de cod (cerere prin PR pe GitHub) | 0 | ore–zile | făcut pentru proiecte tehnice; reguli de conținut |
| **js.org — `*.js.org`** | subdomeniu pentru proiecte JavaScript open-source | 0 | zile | **nu se potrivește** — nu e un proiect JS public |
| **Freenom (`.tk`, `.ml`, `.ga`, `.cf`)** | — | — | — | **mort**: registratorul a pierdut acreditarea, ~12,6 milioane de domenii au încetat să mai rezolve. Nu recomandăm sub nicio formă. |
| **`.ro` / `.com` plătit** | domeniu al tău, mutabil, cu reputație | ~35–60 lei/an (.ro) | minute | singurul care chiar e „al tău” pe termen lung |

### Recomandarea mea (ordinea corectă)

1. **Lansăm ACUM pe `anime-uke.pages.dev`.** E deja indexat, are HTTPS, CDN, cache și 0 cost. O
   lansare amânată pentru un nume „mai frumos” pierde exact lucrul care contează la început: timpul
   de indexare.
2. **În paralel, cerem `anime-uke.dpdns.org`** (DigitalPlat, gratuit, non-profit). Durează puțin, iar
   codul e deja pregătit: comutarea se face din **două variabile**, fără nicio modificare de cod.
3. **Peste 6–12 luni**, dacă proiectul merge, cumpărăm un `.ro` (~40 lei/an) și îl facem canonic.
   Atunci toate linkurile acumulate se mută cu **301**, nu se pierd.
4. `EU.org` rămâne o variantă bună de rezervă (dacă îl obții, poți avea ambele nume, unul canonic).

> ⚠️ Regula de aur la mutarea pe un domeniu nou: **un singur host canonic**. Două hosturi cu același
> conținut = Google împarte autoritatea între ele. De asta există 301-ul de mai jos.

---

## 2. Cum atașezi domeniul gratuit (DigitalPlat → Cloudflare Pages)

Toate cele 6 minute de mai jos se fac **o singură dată**, în browsere, pe conturile tale. Nimic din
repo nu trebuie schimbat pentru pașii 1–3.

1. **Ia numele:** https://dash.domain.digitalplat.org → cont → *Register* → sufix `dpdns.org` → label
   `anime-uke` (primele venite, primele servite) → la *nameservers* alege **Cloudflare**
   (`ada.ns.cloudflare.com`, `bob.ns.cloudflare.com` — le vezi în dashboard-ul Cloudflare la
   *Websites → Add site → anime-uke.dpdns.org*).
2. **Adaugă zona în Cloudflare** (*Websites → Add a site*), plan **Free**, apoi copiază cei doi
   nameserveri în DigitalPlat. Așteaptă `Active` (de obicei 5–30 min).
3. **Leagă domeniul de proiectul Pages:** Cloudflare → *Workers & Pages* → `anime-uke` → *Custom
   domains* → **Set up a custom domain** → `anime-uke.dpdns.org`. Cloudflare creează automat CNAME-ul
   și certificatul TLS (gratuit). Verifică apoi: `curl -sI https://anime-uke.dpdns.org/robots.txt`
   → `200`.
4. **Comută canonicul** (pagina proiectului → *Settings → Variables and Secrets*):

   | Variabilă | Valoare | Efect |
   |---|---|---|
   | `CANONICAL_ORIGIN` | `https://anime-uke.dpdns.org` | canonical, `og:url`, sitemap, JSON-LD — toate comută odată |
   | `FORCE_CANONICAL_REDIRECT` | `1` | 301 din `pages.dev` (și din preview-uri) către domeniu; **API-ul nu se redirectează** |

5. **Regula de host în Cloudflare** (*Rules → Redirect Rules → Create rule*), gratuită:
   `when hostname eq "anime-uke.pages.dev"` → *Static redirect*, `301`, către
   `https://anime-uke.dpdns.org` + *preserve query string* + *preserve path suffix*.
   ⚠️ **Nu sări peste pasul ăsta.** Pagina principală, `/login`, `/register`, `/episode` și asseturile
   sunt excluse din worker (`public/_routes.json`), deci 301-ul din cod nu le vede — regula din
   Cloudflare e singura care le mută. 301-ul din worker rămâne ca al doilea strat pentru rutele
   dinamice (`/serie/<id>`, `/profile`, `/admin`, API-neutro).
6. **Un deploy** (merge în `main` sau relay) și verifică:

   ```bash
   curl -sI https://anime-uke.pages.dev/serie/1014 | grep -i location   # 301 → domeniu
   curl -s  https://anime-uke.dpdns.org/ | grep -o 'rel="canonical"[^>]*'  # canonical nou
   curl -s  https://anime-uke.dpdns.org/sitemap.xml | head -3           # URL-uri pe domeniul nou
   curl -sI https://anime-uke.dpdns.org/api/home | head -1              # 200 (API-ul nu face 301)
   ```

   Dacă vrei să testezi înainte de a atinge producția: `CANONICAL_ORIGIN=https://anime-uke.test
   FORCE_CANONICAL_REDIRECT=1 ./dev.sh`, apoi `curl -sI localhost:8788/` → 301. Logica e acoperită și
   de `node tests/achievements.mjs` (secțiunea „DOMENIU CANONIC”).

---

## 3. Checklist de lansare

### Înainte (se face în repo, cu testele verzi)

- [x] `./test.sh` complet verde (scripts-health, greutate, e2e, dom-smoke pe surse **și** pe build,
      chat, Turso, plafoane, realizări)
- [x] Migrarea `0031_achievements.sql` în repo (deploy-ul o aplică singur)
- [x] Nicio cheie/token în cod; secretele stau doar în GitHub Secrets
- [x] 404 real pentru rute inexistente, sitemap coerent, `robots.txt` cu `Sitemap:`
- [x] Headere de securitate pe HTML, API și (în oglindă) pe asseturi — `public/_headers` ↔ `SECURITY_HEADERS`
- [ ] `npm run usage` în ziua lansării (baseline de cost înainte de trafic real)

### După (primele 48 h)

- [ ] **Google Search Console** → adaugă domeniul → trimite `sitemap.xml` → cere indexarea paginii
      principale și a 2–3 serii (fără asta, indexarea poate întârzia săptămâni)
- [ ] **Cloudflare → Analytics**: invocări Functions, rânduri D1 citite/scrise, cereri DO (ținte: <30%
      din cota zilnică)
- [ ] Verifică `https://anime-uke.pages.dev/robots.txt`, `/sitemap.xml`, `/llms.txt` din browser
- [ ] Un tur complet ca utilizator nou: register → serie → episod → 15 min → puncte → realizare →
      comentariu → cufăr → profil. Orice pas blocat se vede aici, nu în teste.
- [ ] Confirmă în dashboard: *Settings → Runtime → Fail open* (la epuizarea cotei, catalogul static
      rămâne vizibil)

### Ce rămâne deliberat pe „nu” (regulile proprietarului)

Fără scraping de site-uri piratate, fără linkuri mega.nz, fără reCAPTCHA / Google Analytics /
anti-debug, fără auto-next, fără secțiune de personaje. Bugetul rămâne 0: niciun serviciu nou plătit.

---

## 4. Costul după lansare: ce urmărești și când reacționezi

| Resursă (plan Free) | Cotă/zi | Consum tipic la ~100 vizitatori/zi | Prag de alarmă |
|---|---|---|---|
| Invocări Pages Functions | 100.000 | ~2.000–4.000 | >30.000 |
| D1 rânduri citite | 5.000.000 | ~50.000–150.000 | >1.500.000 |
| D1 rânduri scrise | 100.000 | ~500–2.000 | >30.000 |
| Durable Objects (cereri) | 100.000 | ~200–1.000 | >30.000 |
| Turso (mesaje private + progres) | free tier | câteva mii | vezi dashboard Turso |

`npm run usage` (GraphQL Analytics, read-only) afișează exact tabelul de mai sus pentru ziua curentă.
Dacă un prag se apropie, **nu** se cumpără nimic: întâi se caută interogarea care scanează
(`node scripts/bench-scale.mjs`), pentru că aproape mereu costul vine dintr-un `SCAN` neindexat, nu
din trafic.

---

## 5. Ce aduce build-ul de lansare (2026-11-08)

| Zonă | Ce s-a schimbat | De ce contează la lansare |
|---|---|---|
| 🏅 **Realizări** (migrarea 0031) | 14 praguri pe termen lung (episoade, comentarii, recenzii, cufere, prieteni, streak, nivel), carduri pe profil cu progres, notificare în clopot, toast imediat | primul sistem care răspunde la „merită să continui?” — reține utilizatorul peste săptămâna 1 |
| 🌐 **Domeniu canonic** | `canonicalRedirectTarget()` + `FORCE_CANONICAL_REDIRECT` (301 sigur, fără API) | mutarea pe domeniu devine o variabilă, nu un refactor |
| ✅ **Teste** | `tests/achievements.mjs` (catalog, recompensă unică, 301) + 13 verificări e2e + 8 verificări DOM | o lansare fără teste e o presupunere |

---

## 6. Secvența de publicare (cine apasă ce)

Publicarea are două părți: **codul** (automat, la merge în `main`) și **migrarea D1** (o comandă prin
relay, pentru că `auto-deploy.yml` nu aplică migrări — decizie deliberată, un `ALTER` greșit în
producție nu are undo).

```bash
# 1. codul ajunge în main (PR → merge). Apoi, automat:
#    tests.yml (toate suitele) → auto-deploy.yml (Worker DO + Pages) → verificare live
gh run list --branch main --limit 3

# 2. migrarea 0031 (o singură dată, după ce codul e live). Relay-ul are
#    tokenul și descoperă singur contul Cloudflare:
gh workflow run cloudflare-relay.yml --ref main \
  -f cmd='set -uo pipefail; npx wrangler d1 migrations apply DB --remote; echo "exit migrari: $?"; npx wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"user_achievements\";"'

# 3. dovada: tabelul există și ruta răspunde (fără sesiune → 401 pe „me”, 404 pe user inexistent)
gh run watch "$(gh run list --workflow cloudflare-relay.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
curl -s -o /dev/null -w '%{http_code}\n' 'https://anime-uke.pages.dev/api/achievements?u=me'
```

Între pasul 1 și pasul 2 site-ul e **complet funcțional**: dacă tabelul lipsește, endpoint-ul de
realizări răspunde cu eroare și secțiunea rămâne ascunsă pe profil (niciun crash, nicio pagină
blocată). Migrarea doar aprinde funcția.

> Notă: `deploy.sh` (calea completă: D1 → migrări → Turso → Worker → Pages → secrete) aplică
> migrările automat. Dacă publici prin `./deploy.sh` sau prin `cf-relay/cmd.sh` care îl apelează,
> pasul 2 nu mai e necesar.
