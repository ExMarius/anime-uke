// =====================================================================
// no-merge-guard.mjs — GARDĂ PERMANENTĂ împotriva merge/close/ștergere.
//
// De ce există (regulă de la proprietar, AGENTS.md §1):
//   Sesiunile Arena lucrează fiecare pe branch-ul ei (`arena/<id>-anime-uke`)
//   și publică DIRECT în producție din acel branch. Un `gh pr merge`, un
//   auto-merge, un `gh pr close` sau o ștergere de branch strecurate într-un
//   workflow sau într-un script ar închide sesiunea în curs și ar arunca
//   munca nepublicată. S-a cerut explicit ca mecanismele astea să fie
//   IMPOSIBILE, nu doar nerecomandate — de aici testul ăsta, care rulează la
//   fiecare `./test.sh` și în CI.
//
// Ce face, fără rețea și fără efecte:
//   1. citește TOATE fișierele urmărite de git (`git ls-files`);
//   2. în fișierele de automatizare (.sh, .yml, .mjs, .js, .json, .toml)
//      caută comenzi de merge / close / auto-merge / ștergere de branch /
//      push în `main`;
//   3. în documentație (.md, .txt) caută aceleași comenzi, dar NUMAI în
//      blocurile de cod — proza are voie (și trebuie) să le numească pentru
//      a le interzice;
//   4. verifică gărzile pozitive: relay-ul publică branch-ul curent, nu
//      `origin/main`; workflow-urile nu cer drepturi pe pull requests;
//      `test.sh` chiar rulează garda asta; AGENTS.md ține regula scrisă.
//
// Rulează: node tests/no-merge-guard.mjs
// =====================================================================

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ---------------------------------------------------------------- fișiere
// `git ls-files` = exact ce ajunge pe GitHub. Dacă lipsește git (sandbox
// restaurat dintr-un snapshot), cădem pe o parcurgere de director.
function fisiereUrmarite() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    const out = [];
    const sari = new Set(['node_modules', '.git', '.wrangler']);
    const walk = (rel) => {
      for (const e of readdirSync(join(ROOT, rel) || '.')) {
        if (sari.has(e)) continue;
        const p = rel ? `${rel}/${e}` : e;
        if (statSync(join(ROOT, p)).isDirectory()) walk(p);
        else out.push(p);
      }
    };
    walk('');
    return out;
  }
}

// Fișiere generate / binare / de date: nu sunt automatizare și pot conține
// orice text venit din loguri (relay-ul salvează acolo ieșirea runnerului).
const IGNORATE = new Set([
  'tests/no-merge-guard.mjs',   // chiar aici sunt scrise tiparele interzise
  'cf-relay/last-output.txt',   // log publicat de runner, nu cod
  'package-lock.json',
]);
const EXT_BINAR = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.avif', '.ico', '.gif', '.woff', '.woff2',
  '.ttf', '.otf', '.mp4', '.webm', '.pdf', '.zip',
]);
const EXT_AUTOMATIZARE = new Set([
  '.sh', '.yml', '.yaml', '.mjs', '.js', '.cjs', '.json', '.toml', '.sql', '.vtt', '.html', '.css',
]);
const EXT_DOC = new Set(['.md', '.txt']);

/** Din text, păstrează numai conținutul blocurilor ``` (restul devine gol). */
function doarBlocuriDeCod(text) {
  const linii = text.split('\n');
  let inBloc = false;
  return linii.map((l) => {
    if (/^\s*```/.test(l)) { inBloc = !inBloc; return ''; }
    return inBloc ? l : '';
  }).join('\n');
}

// ------------------------------------------------------------- interdicții
// Fiecare tipar = un mecanism care poate încheia sesiunea altcuiva.
// `gata` explică pe scurt DE CE e interzis, ca mesajul de eșec să fie util.
const INTERZISE = [
  { id: 'gh pr merge', re: /\bgh\s+pr\s+merge\b/i, motiv: 'închide PR-ul și integrează în main' },
  { id: 'gh pr close', re: /\bgh\s+pr\s+close\b/i, motiv: 'închide PR-ul sesiunii' },
  { id: 'gh pr --auto', re: /\bgh\s+pr\b[^\n]*--auto\b/i, motiv: 'programează auto-merge' },
  { id: '--delete-branch', re: /--delete-branch\b/i, motiv: 'șterge branch-ul după merge' },
  { id: '--enable-auto-merge', re: /--enable-auto-merge\b/i, motiv: 'activează auto-merge pe repo' },
  { id: 'allow_auto_merge', re: /\ballow_auto_merge\b/i, motiv: 'setare de auto-merge pe repo' },
  { id: 'delete_branch_on_merge', re: /\bdelete_branch_on_merge\b/i, motiv: 'șterge branch-ul automat la merge' },
  { id: 'merge_method', re: /\bmerge_method\b/i, motiv: 'merge de PR prin API' },
  { id: 'endpoint /merge', re: /pulls\/[^\s"'`]*\/merge\b/i, motiv: 'merge de PR prin API' },
  { id: 'endpoint /merges', re: /(repos\/[^\s"'`]*\/merges\b|\/merges["'`\s])/i, motiv: 'merge de branch prin API' },
  { id: 'git merge', re: /\bgit\s+merge(?![-\w])/i, motiv: 'integrează branch-uri local' },
  { id: 'git branch -d', re: /\bgit\s+branch\s+(-d|-D|--delete)\b/, motiv: 'șterge un branch local' },
  { id: 'git push --delete', re: /\bgit\s+push\b[^\n]*(--delete\b|\s:refs\/heads\/|\sorigin\s+:)/, motiv: 'șterge un branch la distanță' },
  { id: 'DELETE pe git/refs', re: /(--method\s+DELETE|-X\s*DELETE)[^\n]*git\/refs|git\/refs[^\n]*(--method\s+DELETE|-X\s*DELETE)/i, motiv: 'șterge un ref prin API' },
  { id: 'delete-branch: true', re: /\bdelete[-_]branch\s*[:=]\s*["']?(true|yes|1)\b/i, motiv: 'opțiune de ștergere a branch-ului' },
  { id: 'acțiune de auto-merge', re: /(enable-pull-request-automerge|automerge-action|auto-merge-action|merge-pr-action|automerge@|squash-merge-action)/i, motiv: 'acțiune GitHub care face merge singură' },
  { id: 'pull_request_target', re: /^\s*pull_request_target\s*:/m, motiv: 'trigger cu drepturi de scriere pe PR-uri străine' },
  { id: 'git push în main', re: /\bgit\s+push\b[^\n]*(\borigin\s+main\b|HEAD:main\b|:refs\/heads\/main\b|\borigin\s+[^\s]*:main\b)/, motiv: 'publică în main fără acordul proprietarului' },
];

console.log('=== GARDĂ: fără merge / close / auto-merge / ștergere de branch ===');

const fisiere = fisiereUrmarite();
check(`lista de fișiere urmărite a fost citită (${fisiere.length})`, fisiere.length > 50, `doar ${fisiere.length}`);

const gasite = [];
let scanateAuto = 0;
let scanateDoc = 0;

for (const f of fisiere) {
  if (IGNORATE.has(f)) continue;
  const ext = extname(f).toLowerCase();
  if (EXT_BINAR.has(ext)) continue;
  const cale = join(ROOT, f);
  if (!existsSync(cale)) continue;

  let text;
  try { text = readFileSync(cale, 'utf8'); } catch { continue; }

  let deVerificat = null;
  if (EXT_AUTOMATIZARE.has(ext) || ext === '') { deVerificat = text; scanateAuto++; }
  else if (EXT_DOC.has(ext)) { deVerificat = doarBlocuriDeCod(text); scanateDoc++; }
  if (deVerificat === null || !deVerificat.trim()) continue;

  const linii = deVerificat.split('\n');
  for (const tipar of INTERZISE) {
    // Tiparele cu ancoră de linie (^…) se testează pe tot textul; restul,
    // linie cu linie, ca mesajul de eșec să arate exact unde e problema.
    if (tipar.re.source.startsWith('^')) {
      if (tipar.re.test(deVerificat)) gasite.push(`${f}: ${tipar.id} (${tipar.motiv})`);
      continue;
    }
    linii.forEach((l, i) => {
      if (tipar.re.test(l)) gasite.push(`${f}:${i + 1}: ${tipar.id} (${tipar.motiv}) → ${l.trim().slice(0, 90)}`);
    });
  }
}

check(`fișiere de automatizare scanate (${scanateAuto}) + documentație (${scanateDoc})`,
  scanateAuto > 20 && scanateDoc > 2, `auto=${scanateAuto} doc=${scanateDoc}`);
check('niciun mecanism de merge / close / auto-merge / ștergere de branch în repo',
  gasite.length === 0, `\n     ${gasite.slice(0, 12).join('\n     ')}`);

// ------------------------------------------------- gărzi pozitive: relay
{
  const caleCmd = join(ROOT, 'cf-relay/cmd.sh');
  const cmd = existsSync(caleCmd) ? readFileSync(caleCmd, 'utf8') : '';
  check('cf-relay/cmd.sh există', cmd.length > 0);
  check('relay-ul NU mai deturnează deploy-ul către origin/main',
    !/git\s+checkout\s+--detach\s+origin\/main/.test(cmd) && !/RELAY_MAIN_CHECKED_OUT/.test(cmd),
    'branch-ul sesiunii nu ar mai putea publica în producție fără merge');
  check('relay-ul publică explicit commitul care l-a declanșat (marker PUBLICA_BRANCHUL_CURENT=1)',
    cmd.includes('PUBLICA_BRANCHUL_CURENT=1'),
    'fără marker nu știm din ce branch a plecat producția');
  check('relay-ul scrie în log branch-ul și commitul publicate',
    /RELAY_REF/.test(cmd) && /RELAY_SHA/.test(cmd),
    'auditul trebuie să spună ce cod a ajuns live');
}

// --------------------------------------------- gărzi pozitive: workflow-uri
{
  const dir = join(ROOT, '.github/workflows');
  const wf = existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  check(`workflow-urile au fost găsite (${wf.join(', ')})`, wf.length >= 3, `găsite: ${wf.length}`);

  const faraPermisiuni = [];
  const cuDrepturiPR = [];
  for (const f of wf) {
    const t = readFileSync(join(dir, f), 'utf8');
    if (!/^permissions:/m.test(t)) faraPermisiuni.push(f);
    if (/pull-requests:\s*(write|admin)/.test(t)) cuDrepturiPR.push(f);
  }
  check('fiecare workflow își declară explicit permisiunile', faraPermisiuni.length === 0, faraPermisiuni.join(', '));
  check('niciun workflow nu cere drept de scriere pe pull requests', cuDrepturiPR.length === 0, cuDrepturiPR.join(', '));

  const relay = readFileSync(join(dir, 'cloudflare-relay.yml'), 'utf8');
  check('relay-ul se poate declanșa dintr-o cerere explicită de publicare (cf-relay/deploy-request.txt)',
    relay.includes('cf-relay/deploy-request.txt'),
    'fără acest trigger, publicarea din branch ar cere modificarea lui cmd.sh');
  check('relay-ul ascultă orice branch (inclusiv branch-ul sesiunii)',
    /branches:\s*\n\s*-\s*'\*\*'/.test(relay), 'push-ul de pe branch-ul sesiunii nu ar publica nimic');

  const autoDeploy = readFileSync(join(dir, 'auto-deploy.yml'), 'utf8');
  check('auto-deploy rămâne limitat la main (nu atinge branch-urile de sesiune)',
    autoDeploy.includes("head_branch == 'main'"),
    'un deploy automat de pe branch ar intra în conflict cu publicarea explicită');
}

// ------------------------------------------------ gărzi pozitive: publicare
{
  const cale = join(ROOT, 'publish.sh');
  const pub = existsSync(cale) ? readFileSync(cale, 'utf8') : '';
  check('publish.sh există (publicare în producție din branch-ul curent)', pub.length > 0);
  check('publish.sh refuză să ruleze pe main',
    /BRANCH.*=.*main|"\$BRANCH"\s*=\s*"main"|= "main"/.test(pub) && /exit 1/.test(pub),
    'trebuie să existe garda care oprește publicarea din main');
  check('publish.sh împinge doar branch-ul curent',
    pub.includes('git push origin "$BRANCH"') || pub.includes('git push origin "${BRANCH}"'),
    'push-ul trebuie legat de branch-ul curent, niciodată de main');
}

// ---------------------------------------------- gărzi pozitive: test.sh + doc
{
  const testSh = readFileSync(join(ROOT, 'test.sh'), 'utf8');
  check('test.sh rulează garda asta la fiecare rulare',
    testSh.includes('tests/no-merge-guard.mjs'),
    'o gardă care nu rulează nu apără nimic');

  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  check('AGENTS.md ține regula scrisă (secțiunea de interdicții de livrare)',
    agents.includes('INTERDICȚII PERMANENTE DE LIVRARE'),
    'regula trebuie să rămână vizibilă pentru orice agent nou');
  check('AGENTS.md trimite publicarea prin publish.sh / relay, nu prin main',
    agents.includes('publish.sh') && agents.includes('fără merge'),
    'ghidul trebuie să descrie exact metoda sigură de publicare');
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} trecute, ${failed} picate`);
process.exit(failed ? 1 : 0);
