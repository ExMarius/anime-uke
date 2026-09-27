# PROMPT pentru agentul nou — preia site-ul anime-uke

Lucrezi pe site-ul EXISTENT al proprietarului: `https://anime-uke.pages.dev`
(proiect Cloudflare Pages `anime-uke`, repo `ExMarius/anime-uke`, D1 `anime-db`
+ Turso pentru progresul de vizionare). Nu creezi niciun site/proiect/repo nou.
ÎNAINTE de orice: citește `AGENTS.md` (reguli cu prioritate maximă) și `README.md`,
apoi rulează `./setup.sh test` — toate suitele trebuie verzi înainte să modifici ceva.
Flux: push direct în main (FĂRĂ PR) → CI teste → CI auto-deploy. Buget 0 forever.
Dacă o metodă eșuează de două ori, o schimbi și îi spui proprietarului ce ai schimbat.

## Stare verificată la predare (27.09.2026) — NU o re-verifica de la zero
- Toate suitele de teste verzi local și în CI (~1.300 checks); auto-deploy CI funcțional.
- Porți corecte: zone personale (profile, admin, chat, PM) în spatele login-ului;
  catalogul public e decizie VOITĂ (SEO/GSC). Fără secrete în repo.
- Stickere chat = 54 GIF-uri Tenor (whitelist), istoricul chat persistă.
- Player: fără sandbox, fullscreen nativ OK, fără auto-next (interzis permanent).
- Migrări: D1 următoarea = 0031; Turso următoarea = 0003. Nu modifica numerotarea.

## P0 — decis deja, de terminat
1. **Surse video piratate (mega.nz, f7hyg4q.org) = INTERZISE permanent de proprietar.**
   Au fost dezactivate în producție (`is_active=0`, 4 rânduri, series 1015/1019).
   Decizie cu proprietarul: ștergi seriile adăugate fără surse proprii
   (1015 Liar Game, 1017 Jitsu wa, 1018 DanMachi, 1019 Lord of Mysteries)
   SAU le pui surse deținute/controle de el. Niciodată re-activezi linkuri piratate.

## P1 — decizii de cerut proprietarului înainte de cod
2. **Reclame A-Ads** (iframe `acceptable.a-ads.com`) pe `index.html`, `series.html`,
   `episode.html` — adăugate fără aprobarea lui. Implicit: SCOATE-LE, dacă nu zice
   explicit că vrea monetizare. Atenție la layout-ul cinema/fullscreen după.
3. **Turso** = vendor extern peste regula „doar Cloudflare": tolerat cât e free tier
   și există rollback; întreabă proprietarul dacă rămâne sau rollback la D1
   (rollback-ul e documentat în AGENTS.md).
4. **Catalogul**: regula veche era „doar One Piece (1014)"; acum sunt 5 serii.
   Confirmă cu proprietarul ce vrea în catalog.

## P2 — de adăugat (roadmap confirmat de proprietar, în ordinea asta)
5. Flux de **resetare parolă** (lipsește: auth = login/register/logout/me/options).
6. Completare profil → facțiuni → știri automate → upgrade-uri chat →
   căutare/filtre sezoniere/sondaje → 2FA. Mini-jocul cu creaturi la urmă.
7. Conținut: subtitrări (.vtt) liprite pe episoadele din producție
   (admin → serie → edit episod; proxy-ul `/api/subtitle` funcționează).
8. Verifică OG image + favicon pentru sharing (Discord/Telegram).

## P3 — igienă permanentă
9. Migrările D1/Turso NU se aplică automat din CI — doar manual (cf-relay/deploy.sh).
10. După deploy/teste local: `rm -rf .wrangler /home/user/.config/.wrangler`;
    `chmod +x *.sh` după restore-uri de sandbox.
11. Interdicții permanente: scraping pirat, mega.nz/f7hyg4q, auto-next, reCAPTCHA/GA,
    anti-debug, sandbox pe player, secțiune de caractere/Pokémon.

## Definition of done pentru orice task
Teste noi/actualizate verzi (`./test.sh`) → commit mic, mesaj clar → push în main →
CI deploy automat → verifici live (curl pe producție) → îi spui proprietarului
ce s-a schimbat, într-un mesaj scurt.
