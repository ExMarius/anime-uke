# PROMPT pentru agentul nou — preia site-ul anime-uke

> **Regulile obligatorii sunt în `AGENTS.md` și numai acolo.** Fișierul ăsta e doar
> promptul de pornire + starea verificată la predare. Dacă găsești aici ceva ce
> contrazice `AGENTS.md`, `AGENTS.md` are dreptate și corectezi textul de aici.

Lucrezi pe site-ul EXISTENT al proprietarului: `https://anime-uke.pages.dev`
(proiect Cloudflare Pages `anime-uke`, repo `ExMarius/anime-uke`, D1 `anime-db`
+ Turso pentru progresul de vizionare și mesajele private).
**Niciodată site/proiect/repo nou, niciodată rebuild de la zero.** Clonarea repo-ului
nu face un al doilea site: descarcă exact codul curent, îl modifici pe loc și îl
publici în ACELAȘI proiect Pages.

ÎNAINTE de orice: citește `AGENTS.md` (reguli, prioritate maximă) și `README.md`
(harta tehnică), apoi rulează `./setup.sh test` — toate suitele trebuie verzi
înainte să modifici ceva.

**Fluxul de livrare** (detaliat în `AGENTS.md` §1–§3):
lucrezi pe branch-ul sesiunii Arena → `./test.sh` verde → commit pe acel branch →
`./publish.sh "ce publici"` publică DIRECT în producție din branch, **fără merge**
și fără preview → verifici pe live → raportezi.
Merge în `main` doar la comanda explicită a proprietarului.
Buget 0 forever. Dacă o metodă eșuează de două ori, o schimbi și spui ce ai schimbat.

## Stare verificată la predare (27–29.09.2026) — nu o re-verifica de la zero

- Toate suitele verzi local și în CI (~1.300 de verificări); relay-ul de publicare
  funcțional din branch-ul sesiunii.
- Porți corecte: zonele personale (profil, admin, chat, PM) în spatele login-ului;
  catalogul public e decizie VOITĂ (SEO/GSC). Fără secrete în repo.
- Stickere chat = 54 GIF-uri Tenor (whitelist); istoricul chatului persistă în D1.
- Player: fără `sandbox`, fullscreen nativ funcțional, fără auto-next (interzis permanent).
- Migrări: D1 următoarea = **0031**; Turso următoarea = **0003**. Nu modifica numerotarea.
- `watch_progress` rulează LIVE pe Turso (`WATCH_STORE=turso`), cu rollback instant la `d1`.

## Ce urmează

Roadmap-ul complet (P0/P1/P2), cu tot ce era în versiunea veche a acestui fișier,
e acum în **`AGENTS.md` §8**. Backlog-ul tehnic e în `AGENTS.md` §7.

## Definiția „gata” pentru orice task

Teste noi/actualizate verzi (`./test.sh`) → commit mic, mesaj clar în română →
push pe branch-ul sesiunii → `./publish.sh` → verificare pe producție (auditul live
din relay) → mesaj scurt către proprietar cu ce s-a schimbat.
