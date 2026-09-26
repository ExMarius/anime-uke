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

import { readdirSync, readFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// -------------------------------------- viteză: code splitting + imagini
// Runda 3 (viteză) a mutat chat.js în afara căii critice și a dat fiecărei
// coperți lățimea slotului. Regulile de mai jos sunt IEFTINE (citesc sursa,
// nu build-ul) și prind fix regresia care ar fura lățimea înapoi: cineva
// reintroduce un import static, cineva randează iar coperta întreagă în
// thumbnail. Bugetele de octeți se măsoară separat: scripts/measure-weight.mjs.
{
  const jsDir = join(ROOT, 'public/assets/js');
  const pagini = readdirSync(jsDir).filter((f) => f.startsWith('page-') && f.endsWith('.js'));

  const cuChatStatic = pagini.filter((f) => /from\s*'\.\/chat\.js'/.test(readFileSync(join(jsDir, f), 'utf8')));
  check('nicio pagină nu importă static chat.js (chatul se cere la nevoie)',
    cuChatStatic.length === 0, `îl importă static: ${cuChatStatic.join(', ')}`);

  const core = readFileSync(join(jsDir, 'core.js'), 'utf8');
  check('core.js încarcă chat.js printr-un import() dinamic',
    /import\('\.\/chat\.js'\)/.test(core), 'lipsește import(\'./chat.js\')');
  check('chatul se pornește o singură dată per pagină (promisiune memorată)',
    /chatOn\s*\|\|=\s*loadChat\(\)/.test(core), 'lipsește garda chatOn ||= loadChat()');

  const cuCoperti = ['page-index.js', 'page-series.js', 'page-profile.js', 'page-admin-serii.js', 'page-admin-serie.js'];
  const faraCoverImg = cuCoperti.filter((f) => !readFileSync(join(jsDir, f), 'utf8').includes('coverImg('));
  check(`paginile cu coperți cer lățimea potrivită slotului (coverImg: ${cuCoperti.length} pagini)`,
    faraCoverImg.length === 0, `nu folosesc coverImg: ${faraCoverImg.join(', ')}`);

  const deploy = readFileSync(join(ROOT, 'deploy.sh'), 'utf8');
  check('deploy.sh bundleaza cu --splitting (chunk-uri comune, cache pe hash)',
    /--splitting/.test(deploy), 'lipsește --splitting din pasul de bundle');
  check('deploy.sh curata chunk-urile vechi (c-*.js) inainte de build',
    /rm -f public\/assets\/js\/c-\*\.js/.test(deploy), 'nu șterge chunk-urile vechi');

  const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  check('chunk-urile de build (c-*.js) nu se comit',
    gitignore.includes('public/assets/js/c-*.js'), 'lipsește regula din .gitignore');
}

// -------------------------------------- buget 0: poll adaptiv + online cache
// Poll-ul fix (setInterval 60s/90s) și ChatDO la fiecare /api/pulse sunt
// exact regresia care golește cota. Verificarea citește sursa, nu build-ul:
// minificatorul redenumește funcțiile, dar nu are voie să reapară intervalul fix.
{
  const core = readFileSync(join(ROOT, 'public/assets/js/core.js'), 'utf8');
  const dev = readFileSync(join(ROOT, 'dev.sh'), 'utf8');
  const pulse = readFileSync(join(ROOT, 'src/routes/api/pulse.js'), 'utf8');
  check('clopoțelul nu mai are setInterval fix',
    !/setInterval\(\s*refreshBellBadge/.test(core) && core.includes('adaptivePoll(refreshBellBadge'),
    'a revenit poll-ul la 60 s');
  check('pulse-ul din nav nu mai are setInterval fix',
    !/setInterval\(\s*tick,\s*90000\)/.test(core) && core.includes('adaptivePoll(fetchPulse'),
    'a revenit poll-ul la 90 s');
  check('garda anti-cache citește versiunea din / (static, 0 invocări)',
    /fetch\(\s*'\/'\s*,\s*\{\s*cache:\s*'no-store'\s*\}\s*\)/.test(core) && !/fetch\(\s*location\.pathname/.test(core),
    'cere iar pagina curentă (invocare pe /serie și /episod)');
  check('markerul auk-adaptive e în sursă (supraviețuiește minificării)',
    core.includes('auk-adaptive'), 'lipsește markerul de deploy');
  check('dev.sh leagă ONLINE_CACHE_MS (testele văd online live)',
    /ONLINE_CACHE_MS/.test(dev), 'lipsește bindingul — e2e-ul „online ≥ 1” ar vedea cache');
  const pulseCod = pulse.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  check('pulse întreabă instanța global-chat, nu global',
    pulseCod.includes("idFromName('global-chat')") && !/idFromName\(\s*'global'\s*\)/.test(pulseCod),
    'numele instanței s-a schimbat');
}

// ------------------------------------------------- relay: fișiere invocate
{
  const cmd = readFileSync(join(ROOT, 'cf-relay/cmd.sh'), 'utf8');
  for (const f of ['deploy.sh', 'scripts/audit-live.mjs', 'scripts/usage.mjs', 'cf-relay/chat-canar.mjs']) {
    check(`relay-ul invocă ${f}, iar fișierul există`,
      cmd.includes(f) && existsSync(join(ROOT, f)),
      cmd.includes(f) ? 'lipsește din repo' : 'nu mai e invocat');
  }
  check('relay-ul declanșat de pe branch publică exact origin/main',
    cmd.includes('RELAY_MAIN_CHECKED_OUT=1')
      && cmd.includes('git checkout -- cf-relay/last-output.txt')
      && cmd.includes('git checkout --detach origin/main')
      && cmd.includes('exec bash cf-relay/cmd.sh'),
    'fără această gardă, un push de mentenanță poate publica cod neintegrat');
  const workflow = readFileSync(join(ROOT, '.github/workflows/cloudflare-relay.yml'), 'utf8');
  check('workflow-ul păstrează branch-ul trigger după checkout-ul la main',
    workflow.includes('git checkout -B "$BRANCH" "origin/$BRANCH"')
      && workflow.includes('cp cf-relay/last-output.txt "$OUTPUT"')
      && workflow.includes('git checkout -- cf-relay/last-output.txt'),
    'commitul de output ar rescrie branch-ul de mentenanță cu main sau checkout-ul ar eșua');

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

// ------------------------------------ Pages Git: configul din rădăcină e producție
// Cloudflare Pages citește NUMAI wrangler.toml din rădăcină la buildul Git.
// Dacă dev.sh lasă acolo configul local (cu [[migrations]] și DO-uri inline),
// preview-ul cade înainte să construiască: Pages respinge migrations și cere
// script_name pentru fiecare Durable Object. O copie identică cu șablonul
// producție e intenționată; wrangler.local.toml rămâne singurul config local.
{
  const rootToml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const prodToml = readFileSync(join(ROOT, 'wrangler.prod.toml'), 'utf8');
  const localToml = readFileSync(join(ROOT, 'wrangler.local.toml'), 'utf8');
  const doNames = ['CHAT', 'RATE_LIMIT', 'STATS'];
  const doBlocks = rootToml.split('[[durable_objects.bindings]]').slice(1);
  const bindingsOk = doNames.every((name) => doBlocks.some((block) =>
    block.includes(`name = "${name}"`) && block.includes('script_name = "anime-uke-do"')));

  check('wrangler.toml e identic cu șablonul Pages de producție',
    rootToml === prodToml, 'root-ul diferă de wrangler.prod.toml; Git Pages va citi configul greșit');
  check('configul Pages nu conține [[migrations]]',
    !/^\[\[migrations\]\]/m.test(rootToml), 'Pages respinge migrations în wrangler.toml');
  check('toate DO-urile Pages au script_name către anime-uke-do',
    bindingsOk && (rootToml.match(/script_name = "anime-uke-do"/g) || []).length === doNames.length,
    'CHAT/RATE_LIMIT/STATS trebuie să indice Worker-ul DO extern');
  check('configul local rămâne separat, cu migrations pentru miniflare',
    /^\[\[migrations\]\]/m.test(localToml) && !localToml.includes('script_name = "anime-uke-do"'),
    'wrangler.local.toml trebuie să țină DO-urile inline pentru testele locale');
}

// --------------------------------------------- API-urile din relay chiar există
{
  // Fiecare rută de API pe care o PROBEAZĂ relay-ul (nu orice text din
  // script) trebuie să fie înregistrată în router. O rută ștearsă din cod
  // dar rămasă în verificări ar da 404 în fiecare rulare și ar arăta ca o
  // problemă de producție, deși e doar verificarea rămasă în urmă.
  const cmd = readFileSync(join(ROOT, 'cf-relay/cmd.sh'), 'utf8');
  const routes = readFileSync(join(ROOT, 'src/router.js'), 'utf8');
  // Și scripturile .mjs din cf-relay chem rute (canarul de chat: register/login).
  // Fără ele, o rută greșită (ex. /api/register în loc de /api/auth/register)
  // ar da 401 abia în producție, pe runner — exact ce s-a întâmplat o dată.
  const mjs = readdirSync(join(ROOT, 'cf-relay'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => readFileSync(join(ROOT, 'cf-relay', f), 'utf8'))
    .join('\n');
  const probate = [...new Set([
    ...[...cmd.matchAll(/\$B(\/api\/[a-z0-9\/\-]*)/gi)].map((m) => m[1]),
    ...[...mjs.matchAll(/['"`](\/api\/[a-z0-9\/\-]*)['"`]/gi)].map((m) => m[1]),
  ])].filter((p) => !p.includes('/:'));
  const necunoscute = probate.filter((p) => !routes.includes(`'${p}'`));
  check(`rutele de API probate de relay sunt înregistrate (${probate.length} rute)`,
    necunoscute.length === 0, necunoscute.join(', '));
}

// ------------------------- sintaxa TOT codul JS (nu doar scripturile de test)
{
  // `node --check` rula doar pe tests/ si scripts/ — deci o eroare de sintaxa
  // in src/ sau in JS-ul de pagina ajungea pana la deploy. Exact asa a trecut
  // o linie in tests/dom-smoke.mjs in care un sir deschis cu ' era inchis cu "
  // (arata corect la citit, dar rupea suita cu „Invalid or unexpected token”).
  // Verificarea e o singura poarta pentru tot codul servit sau rulat.
  const fisiere = [];
  const walkJs = (dir) => {
    for (const e of readdirSync(join(ROOT, dir))) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const rel = join(dir, e);
      if (statSync(join(ROOT, rel)).isDirectory()) walkJs(rel);
      else if (rel.endsWith('.js') || rel.endsWith('.mjs')) fisiere.push(rel);
    }
  };
  for (const d of ['src', 'public/assets/js', 'worker-do/src', 'cf-relay']) walkJs(d);

  const rele = [];
  const tmp = join(tmpdir(), 'auk-check.mjs');
  for (const f of fisiere) {
    // Copie cu extensia .mjs: modulele ES nu trec de --check daca fisierul
    // se numeste .js (Node le-ar citi ca CommonJS).
    copyFileSync(join(ROOT, f), tmp);
    const r = run(process.execPath, ['--check', tmp]);
    if (!r.ok) rele.push(`${f}: ${String(r.out).split('\n')[0].slice(0, 90)}`);
  }
  check(`sintaxa intregului cod JS (${fisiere.length} fisiere: src, pagini, worker-do, relay)`,
    rele.length === 0, rele.join(' | '));
}

// ------------------------------------- INSERT-urile au cate un parametru pe coloana
{
  // Bug-ul de producție din 2026-09-23: `INSERT INTO chat_messages (...11 coloane...)`
  // cu doar 10 `?`. D1 a răspuns „10 values for 11 columns” la fiecare flush,
  // eroarea era prinsă și logată, iar chatul nu salva NIMIC — o săptămână întreagă.
  // Un test care doar citește codul prinde asta în 50 ms, înainte de deploy.
  const argsTopLevel = (tuple) => {
    const inner = tuple.slice(1, -1);
    const out = [];
    let depth = 0, quote = null, cur = '';
    for (const ch of inner) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };

  let verificate = 0;
  const rele = [];
  const jsFiles2 = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir))) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const rel = join(dir, e);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (rel.endsWith('.js')) jsFiles2.push(rel);
    }
  };
  walk('src');
  walk('worker-do/src');

  for (const f of jsFiles2) {
    const code = readFileSync(join(ROOT, f), 'utf8');
    for (const lit of code.matchAll(/`([^`]*)`/g)) {
      const sql = lit[1];
      if (!/INSERT\s+(?:OR\s+\w+\s+)?INTO/i.test(sql)) continue;
      const m = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([\w.]+)\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*)$/i);
      if (!m) continue;
      const cols = m[2].split(',').map((x) => x.trim()).filter(Boolean).length;
      const body = m[3].trim();
      let depth = 0, end = -1, quote = null;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === "'" || ch === '"') { quote = ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) continue;
      const args = argsTopLevel(body.slice(0, end + 1));
      verificate++;
      if (args.length !== cols) {
        rele.push(`${f}: ${m[1]} are ${cols} coloane dar ${args.length} valori`);
      }
    }
  }
  check(`INSERT-urile au un parametru pe coloana (${verificate} verificate)`,
    rele.length === 0 && verificate > 20, rele.join(' · '));
}

console.log(`\nREZULTAT: ${passed} trecute, ${failed} esuate`);
process.exit(failed ? 1 : 0);
