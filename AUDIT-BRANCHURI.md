# Audit branch-uri Arena — verificare înainte de curățenie

Regula (AGENTS.md §1.1): **niciun branch nu se șterge fără verificare**, iar branch-ul
unei sesiuni active nu se șterge niciodată. Fișierul ăsta păstrează dovada verificării
și SHA-urile, ca orice ștergere să fie reversibilă:

```bash
# restaurare completă a unui branch șters (ref-ul e doar un pointer):
git push origin <sha>:refs/heads/arena/<id>-anime-uke
```

## Criterii (toate trei, obligatorii)

1. **Integrat**: `git merge-base --is-ancestor origin/<b> origin/main` → vârful branch-ului
   e deja în istoria lui `main`.
2. **Fără commituri unice**: `git rev-list --count origin/main..origin/<b>` = 0
   **și** `git diff origin/main...origin/<b>` gol.
3. **Fără sesiune activă**: niciun PR deschis de pe branch + ultimul commit vechi
   (nu e sesiunea curentă și nici una din ultimele ore).

## Rezultatul verificării (2026-09-29, din sesiunea `arena/01a0eddc-anime-uke`)

| Branch | SHA | Integrat | Commituri unice | Diff vs main | PR-uri | Ultim commit (UTC) | Decizie |
|---|---|---|---|---|---|---|---|
| `arena/01a0d983-anime-uke` | `f303526` | nu | 1 | diferă | #8 CLOSED | 2026-09-25 18:27 | **PĂSTRAT** — are muncă neintegrată |
| `arena/01a0d9c7-anime-uke` | `dc78dd8` | da | 0 | gol | #9, #10 MERGED | 2026-09-25 19:07 | ȘTERS |
| `arena/01a0da3a-anime-uke` | `535c6ba` | da | 0 | gol | #11, #12 MERGED | 2026-09-26 05:45 | ȘTERS |
| `arena/01a0dd39-anime-uke` | `998956f` | nu | 5 | diferă | #13, #14 MERGED | 2026-09-26 12:27 | **PĂSTRAT** — commituri unice |
| `arena/01a0df81-anime-uke` | `2f91d1a` | nu | 2 | diferă | #15 MERGED | 2026-09-26 21:19 | **PĂSTRAT** — commituri unice |
| `arena/01a0dfd5-anime-uke` | `824ee81` | nu | 2 | diferă | #16, #17 MERGED | 2026-09-26 23:06 | **PĂSTRAT** — commituri unice |
| `arena/01a0e1b9-anime-uke` | `37ee218` | da | 0 | gol | #18 MERGED | 2026-09-27 07:48 | ȘTERS |
| `arena/01a0e1fa-anime-uke` | `2d53f83` | da | 0 | gol | #19–#23 MERGED | 2026-09-27 09:47 | ȘTERS |
| `arena/01a0e2e9-anime-uke` | `885b6c3` | da | 0 | gol | #24 MERGED | 2026-09-27 15:32 | ȘTERS |
| `arena/01a0e393-anime-uke` | `1e1f9f8` | nu | 9 | diferă | **#25 OPEN** | 2026-09-27 18:35 | **PĂSTRAT** — PR deschis (resetare parolă) |
| `arena/01a0edbf-anime-uke` | `dbd6168` | da | 0 | gol | #26 MERGED | 2026-09-29 15:26 | **PĂSTRAT** — sesiune încheiată cu ~30 min înainte de a noastră; se șterge doar la confirmarea proprietarului |
| `arena/01a0eddc-anime-uke` | — | — | — | — | — | în lucru | **SESIUNEA CURENTĂ** — nu se atinge |

Branch-urile „PĂSTRAT — commituri unice” conțin, în cea mai mare parte, commituri
`relay: output (…)` (jurnalul de deploy scris de runner) plus, la `01a0dd39`, câteva
corecții de relay care au fost integrate ulterior în altă formă. Nu au fost șterse
pentru că **criteriul 2 nu e îndeplinit** — verificarea conținutului lor rămâne o
sarcină separată, de făcut cu proprietarul.

## Setări de repo verificate (nu au fost modificate)

- `allow_auto_merge = false`
- `delete_branch_on_merge = false`
- fără rulesets, fără acțiuni de auto-merge instalate

## Comenzile de verificare (reproducibile)

```bash
git fetch --unshallow origin ; git fetch origin '+refs/heads/*:refs/remotes/origin/*'
for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep arena | sed 's#origin/##'); do
  git merge-base --is-ancestor "origin/$b" origin/main && integ=DA || integ=NU
  echo "$b integrat=$integ unice=$(git rev-list --count origin/main..origin/$b)"
  gh pr list --state all --head "$b" --json number,state
done
```
