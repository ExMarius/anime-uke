// =====================================================================
// scripts-health.mjs — scripturile de deploy/test trebuie să fie VALIDE.
//
// De ce există: `cf-relay/cmd.sh` rulează pe un runner GitHub și e singurul
// drum prin care ajunge codul pe Cloudflare (sandboxul n-are acces la API-ul
// lor). O virgulă greșită acolo nu se vede local, nu pică nicio suită — se
// vede abia când deploy-ul nu mai pornește. Exact asta s-a întâmplat cu o
// ghilimea tipografică de închidere pusă într-un `echo "…"`: bash închidea
// șirul mai devreme și tot fișierul devenea invalid.
//
// Verifică, fără să execute nimic:
//   - `bash -n` pe fiecare script shell (parserul bash, zero efecte);
//   - sintaxa fiecărui modul din scripts/ și tests/ (node --check);
//   - că fișierele pe care le invocă relay-ul chiar există în repo.
//
// Rulează: node tests/scripts-health.mjs
// =====================================================================

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Rulează o comandă și întoarce { ok, out } fără să arunce. */
function run(cmd, args) {
  try {
    execFileSync(cmd, args, { cwd: ROOT, stdio: 'pipe' });
    return { ok: true, out: '' };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message).split('\n').slice(0, 4).join(' ') };
  }
}

console.log('=== SĂNĂTATE SCRIPTURI ===');

// ---------------------------------------------------------------- shell
const shellScripts = ['.sh files din rădăcină']
  .flatMap(() => readdirSync(ROOT).filter((f) => f.endsWith('.sh')).sort())
  .concat(['cf-relay/cmd.sh']);

for (const f of shellScripts) {
  if (!existsSync(join(ROOT, f))) { check(`${f} există`, false, 'lipsește'); continue; }
  const r = run('bash', ['-n', f]);
  check(`bash -n ${f}`, r.ok, r.out);
}

// ---------------------------------------------------------------- JS
const jsFiles = [
  ...readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`),
  ...readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.mjs')).map((f) => `tests/${f}`),
];

for (const f of jsFiles) {
  const r = run(process.execPath, ['--check', f]);
  check(`sintaxă ${f}`, r.ok, r.out);
}

// ------------------------------------------------- relay: fișiere invocate
{
  const cmd = readFileSync(join(ROOT, 'cf-relay/cmd.sh'), 'utf8');
  for (const f of ['deploy.sh', 'scripts/audit-live.mjs', 'scripts/usage.mjs']) {
    check(`relay-ul invocă ${f}, iar fișierul există`,
      cmd.includes(f) && existsSync(join(ROOT, f)),
      cmd.includes(f) ? 'lipsește din repo' : 'nu mai e invocat');
  }

  // Capcana de shell care s-a întâmplat deja: ghilimea dreaptă (") închide
  // un șir deschis cu „. Acceptăm doar perechile corecte sau fără diacritice.
  const badLines = cmd.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line))          // comentariile nu se lexicalizează
    .filter(({ line }) => /„[^”"]*"/.test(line));
  check('fără ghilimele tipografice nepereche în cmd.sh (bash închide șirul greșit)',
    badLines.length === 0,
    badLines.map((b) => `linia ${b.n}`).join(', '));
}

// --------------------------------------------- API-urile din relay chiar există
{
  // Fiecare rută de API pe care o PROBEAZĂ relay-ul (nu orice text din
  // script) trebuie să fie înregistrată în router. O rută ștearsă din cod
  // dar rămasă în verificări ar da 404 în fiecare rulare și ar arăta ca o
  // problemă de producție, deși e doar verificarea rămasă în urmă.
  const cmd = readFileSync(join(ROOT, 'cf-relay/cmd.sh'), 'utf8');
  const routes = readFileSync(join(ROOT, 'src/router.js'), 'utf8');
  const probate = [...new Set([...cmd.matchAll(/\$B(\/api\/[a-z0-9\/\-]*)/gi)].map((m) => m[1]))]
    .filter((p) => !p.includes('/:'));
  const necunoscute = probate.filter((p) => !routes.includes(`'${p}'`));
  check(`rutele de API probate de relay sunt înregistrate (${probate.length} rute)`,
    necunoscute.length === 0, necunoscute.join(', '));
}

console.log(`\nREZULTAT: ${passed} trecute, ${failed} esuate`);
process.exit(failed ? 1 : 0);
