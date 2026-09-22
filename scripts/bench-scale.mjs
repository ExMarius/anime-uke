// =====================================================================
// bench-scale.mjs — „duce site-ul 1.000 de serii și 1.000 de utilizatori?"
//
// Măsoară pe un D1 local (SQLite real, aceleași migrări ca producția) cât
// CITESC interogările fierbinți la scara maximă pe care o permite site-ul
// (LIMIT_SERIES = LIMIT_USERS = 1000). Cota gratuită D1 se taxează pe
// rânduri citite (5 milioane/zi), nu pe cereri, deci întrebarea „câte
// rânduri citește o vizită pe prima pagină" e chiar întrebarea bugetului.
//
// Cum se folosește:
//   node scripts/bench-scale.mjs                    # 1000 serii / 1000 useri / un an de activitate
//   node scripts/bench-scale.mjs --views 6000       # proiecția pe zi pentru alt trafic
//   node scripts/bench-scale.mjs --users 200 --progress 60   # scenariu mic
//   node scripts/bench-scale.mjs --json             # tabelul, pentru prelucrare
//   node scripts/bench-scale.mjs --keep             # păstrează baza sintetică pe disc
//
// Rezultatul de referință (22.09.2026, înainte de migrarea 0028):
//   ~230.000 de rânduri citite pentru O vizită pe prima pagină → ~21 vizite/zi.
// După 0028 (indexuri + contoare denormalizate + cache de top): ~370/vizită.
//
// Interogările NU sunt copiate „din memorie": fiecare își declară sursa, iar
// scriptul verifică înainte de rulare că textul există în fișierul respectiv.
// Dacă cineva schimbă SQL-ul din handler, bench-ul cade zgomotos în loc să
// măsoare o interogare care nu mai există.
// =====================================================================

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------
// Argumente
// ---------------------------------------------------------------------
const argv = process.argv.slice(2);
const numArg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  const v = i === -1 ? NaN : Number(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
};
const JSON_OUT = argv.includes('--json');
// --keep: nu șterge baza sintetică la final (utilă la inspectat: dimensiune,
// planuri cu EXPLAIN, teste de SQL pe scara maximă).
const KEEP = argv.includes('--keep');

const SERIES = numArg('series', 1000);
const USERS = numArg('users', 1000);
const PROGRESS_PER_USER = numArg('progress', 200);   // rânduri în watch_progress / utilizator
const RATINGS_PER_USER = numArg('ratings', 30);      // note acordate / utilizator
const EPISODES_PER_SERIES = numArg('episodes', 12);  // medie (seriile lungi au 12x)
const VIEWS_PER_DAY = numArg('views', 2000);         // vizite pe prima pagină / zi (proiecția)

// ---------------------------------------------------------------------
// Pregătirea bazei: migrările reale, apoi date sintetice la scară
// ---------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'bench-scale-'));
const db = new DatabaseSync(join(dir, 'bench.sqlite'));

db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');

for (const f of readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(readFileSync(join(ROOT, 'migrations', f), 'utf8'));
}

/** PRNG determinist — același bench dă aceleași cifre la fiecare rulare. */
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const GENRES = ['Acțiune', 'Aventură', 'Comedie', 'Dramă', 'Fantasy', 'Romantism', 'Sci-Fi', 'Mister', 'Sport', 'Slice of Life'];
const STATUS = ['ongoing', 'completed'];

const t0 = Date.now();
db.exec('BEGIN');

const insSeries = db.prepare(
  `INSERT INTO anime_series (title, description, cover_image, status, genre, year, created_at)
   VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`
);
const insEp = db.prepare(
  `INSERT INTO episodes (series_id, episode_number, title, views, created_at)
   VALUES (?, ?, ?, ?, datetime('now', ?))`
);
const insSrc = db.prepare(
  `INSERT INTO episode_sources (episode_id, label, kind, url, sort_order) VALUES (?, ?, ?, ?, ?)`
);
const insUser = db.prepare(
  `INSERT INTO users (username, email, password_hash, password_salt, points, created_at)
   VALUES (?, ?, 'x', 'y', ?, datetime('now', ?))`
);
const insProg = db.prepare(
  `INSERT INTO watch_progress (user_id, episode_id, seconds, updated_at) VALUES (?, ?, ?, datetime('now', ?))`
);
const insRating = db.prepare(
  `INSERT INTO series_ratings (user_id, series_id, rating) VALUES (?, ?, ?)`
);
const insComment = db.prepare(
  `INSERT INTO episode_comments (episode_id, user_id, body) VALUES (?, ?, ?)`
);
const insNotif = db.prepare(
  `INSERT INTO notifications (user_id, type, payload, read) VALUES (?, 'episode', '{"title":"Episod nou"}', 0)`
);

const seriesIds = [];
const episodeIds = [];

for (let s = 1; s <= SERIES; s++) {
  const epN = rnd() < 0.05 ? EPISODES_PER_SERIES * 12 : EPISODES_PER_SERIES;
  const r = insSeries.run(
    `Serie ${s} — titlu de test cu diacritice ș ț ă`,
    'Descriere de test '.repeat(6),
    `/assets/img/covers/${s}.webp`,
    pick(STATUS),
    GENRES.slice(0, 2 + Math.floor(rnd() * 3)).join(', '),
    2000 + Math.floor(rnd() * 26),
    `-${Math.floor(rnd() * 2000)} days`
  );
  const sid = Number(r.lastInsertRowid);
  seriesIds.push(sid);
  for (let e = 1; e <= epN; e++) {
    const er = insEp.run(sid, e, `Episodul ${e}`, Math.floor(rnd() * 50000), `-${Math.floor(rnd() * 2000)} days`);
    const eid = Number(er.lastInsertRowid);
    episodeIds.push(eid);
    insSrc.run(eid, 'Player 1', 'embed', `https://exemplu.test/embed/${eid}`, 0);
  }
}

// episode_count se ține denormalizat și în producție (admin/episodes.js).
db.prepare(`UPDATE anime_series SET episode_count = (SELECT COUNT(*) FROM episodes e WHERE e.series_id = anime_series.id)`).run();

const userIds = [];
for (let u = 1; u <= USERS; u++) {
  const r = insUser.run(`user${u}`, `user${u}@exemplu.test`, Math.floor(rnd() * 5000), `-${Math.floor(rnd() * 900)} days`);
  userIds.push(Number(r.lastInsertRowid));
}

// Istoric de vizionare: „un an de activitate" pentru fiecare cont.
for (const uid of userIds) {
  const seen = new Set();
  for (let i = 0; i < PROGRESS_PER_USER; i++) {
    const eid = pick(episodeIds);
    if (seen.has(eid)) continue;
    seen.add(eid);
    insProg.run(uid, eid, 60 + Math.floor(rnd() * 1200), `-${Math.floor(rnd() * 365)} days`);
  }
}

for (const uid of userIds) {
  const seen = new Set();
  for (let i = 0; i < RATINGS_PER_USER; i++) {
    const sid = pick(seriesIds);
    if (seen.has(sid)) continue;
    seen.add(sid);
    insRating.run(uid, sid, 1 + Math.floor(rnd() * 10));
  }
}

for (let i = 0; i < Math.min(20000, Math.max(2000, USERS * 5)); i++) {
  insComment.run(pick(episodeIds), pick(userIds), 'Comentariu de test '.repeat(3));
}
for (let i = 0; i < USERS * 8; i++) insNotif.run(pick(userIds));

// Contoarele denormalizate (site_meta) — la fel ca în producție după 0028.
const cnt = (sql, ...p) => Number(db.prepare(sql).get(...p).n);
db.prepare(
  `INSERT OR REPLACE INTO site_meta (key, value) VALUES
     ('series_total', ?), ('episodes_total', ?), ('views_total', ?), ('users_total', ?)`
).run(
  cnt('SELECT COUNT(*) AS n FROM anime_series'),
  cnt('SELECT COUNT(*) AS n FROM episodes'),
  cnt('SELECT COALESCE(SUM(views),0) AS n FROM episodes'),
  cnt('SELECT COUNT(*) AS n FROM users')
);

// Media denormalizată pe serie (migrarea 0028 o calculează la deploy).
db.prepare(
  `UPDATE anime_series SET
     rating_avg = COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM series_ratings r WHERE r.series_id = anime_series.id), 0),
     rating_count = (SELECT COUNT(*) FROM series_ratings r WHERE r.series_id = anime_series.id)`
).run();

db.exec('COMMIT');

const SIZES = {
  anime_series: cnt('SELECT COUNT(*) AS n FROM anime_series'),
  episodes: cnt('SELECT COUNT(*) AS n FROM episodes'),
  users: cnt('SELECT COUNT(*) AS n FROM users'),
  watch_progress: cnt('SELECT COUNT(*) AS n FROM watch_progress'),
  series_ratings: cnt('SELECT COUNT(*) AS n FROM series_ratings'),
  episode_sources: cnt('SELECT COUNT(*) AS n FROM episode_sources'),
  leaderboard_cache: cnt('SELECT COUNT(*) AS n FROM leaderboard_cache'),
};
const seedMs = Date.now() - t0;

// ---------------------------------------------------------------------
// Interogările fierbinți, cu sursa lor din cod
// ---------------------------------------------------------------------
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function sqlOf(file, anchor, occurrence = 0) {
  // Extrage șirul (backtick SAU apostrof) în care se află ancora dată. SQL-ul
  // stă în handler fie într-un template literal, fie într-un șir simplu, iar
  // ancora e ÎNĂUNTRUL lui — deci deschiderea e înaintea ancorei, iar
  // închiderea după ea. Alegem deschiderea cea mai apropiată de ancoră.
  const src = readFileSync(join(ROOT, file), 'utf8');
  let idx = -1;
  for (let k = 0; k <= occurrence; k++) {
    idx = src.indexOf(anchor, idx + 1);
    if (idx === -1) throw new Error(`ancora „${anchor}" lipsește din ${file}`);
  }
  const candidate = (q) => {
    const o = src.lastIndexOf(q, idx);
    if (o === -1) return null;
    const c = src.indexOf(q, o + 1);
    if (c === -1 || c < idx) return null;
    return { o, c };
  };
  const win = [candidate('`'), candidate("'")].filter(Boolean).sort((a, b) => b.o - a.o)[0];
  if (!win) throw new Error(`nu găsesc șirul SQL pentru ancora „${anchor}" din ${file}`);
  // Interpolările din handler (${whereSql}, ${sortSql(sort)}…) se înlocuiesc cu
  // valorile concrete folosite în producție pentru cererea măsurată.
  return src
    .slice(win.o + 1, win.c)
    .replace(/\$\{whereSql\}/g, '')
    .replace(/\$\{sortSql\(sort\)\}/g, 's.created_at DESC, s.id DESC')
    .replace(/\$\{TOTAL_CAP\}/g, '500')
    .replace(/\$\{minutes\}/g, '60')
    .replace(/\$\{[^}]*\}/g, '');
}

const Q = [
  {
    name: 'PRIMA PAGINĂ: catalog (24 carduri)',
    charge: 'view',
    file: 'src/routes/api/series.js',
    sql: sqlOf('src/routes/api/series.js', 'SELECT s.id, s.title, s.description'),
    params: [25, 0],
    atMost: true, rows: 25, rowsHow: 'index compus, se oprește la 25',
  },
  {
    name: 'PRIMA PAGINĂ: contor total serii',
    charge: 'view',
    file: 'src/lib/paging.js',
    sql: sqlOf('src/lib/paging.js', 'SELECT value FROM site_meta'),
    params: ['series_total'], one: true,
    atMost: true, rows: 1, rowsHow: 'o singură cheie în site_meta',
  },
  {
    name: 'PRIMA PAGINĂ: top săptămânal (din cache D1)',
    charge: 'view',
    file: 'src/routes/api/top.js',
    sql: sqlOf('src/routes/api/top.js', 'SELECT value FROM leaderboard_cache'),
    params: ['top_weekly', '-60 minutes'], one: true,
    atMost: true, rows: 1, rowsHow: 'un rând de cache',
  },
  {
    name: 'PRIMA PAGINĂ: top notate (5 rânduri din index)',
    charge: 'view',
    file: 'src/routes/api/top.js',
    sql: sqlOf('src/routes/api/top.js', 'SELECT id, title, cover_image'),
    params: [],
    atMost: true, rows: 5, rowsHow: 'index pe rating_avg DESC',
  },
  {
    name: 'PRIMA PAGINĂ: ultimele episoade',
    charge: 'view',
    file: 'src/routes/api/recent.js',
    sql: sqlOf('src/routes/api/recent.js', 'SELECT e.id, e.episode_number'),
    params: [],
    atMost: true, rows: 8, rowsHow: 'LIMIT 8, parcurge indexul desc',
  },
  {
    name: 'PRIMA PAGINĂ: genuri (cache 1 oră)',
    charge: 'hour',
    file: 'src/routes/api/genres.js',
    sql: sqlOf('src/routes/api/genres.js', 'SELECT genre FROM anime_series'),
    params: [],
  },
  {
    name: 'PRIMA PAGINĂ: pulse (cache 5 min)',
    charge: 'min5',
    file: 'src/routes/api/pulse.js',
    sql: sqlOf('src/routes/api/pulse.js', 'SELECT key, value FROM site_meta'),
    params: [],
    atMost: true, rows: 4, rowsHow: '4 contoare din site_meta',
  },
  {
    name: 'PRIMA PAGINĂ: TOP săptămânal — RECALCUL (1×/oră)',
    charge: 'hour',
    file: 'src/routes/api/top.js',
    sql: sqlOf('src/routes/api/top.js', 'SELECT e.series_id AS id'),
    params: [],
    countSql: `SELECT COUNT(*) AS n FROM watch_progress WHERE updated_at >= datetime('now', '-7 days')`,
    rowsHow: '+ 2 căutări pe cheie primară per rând din interval',
  },
  {
    name: 'SERIE: episoadele paginate (100/pagină)',
    charge: 'view',
    file: 'src/routes/api/series/by-id.js',
    sql: sqlOf('src/routes/api/series/by-id.js', 'SELECT id, episode_number, title, views, created_at'),
    params: [101, 0],
    atMost: true, rows: 101, rowsHow: 'index (series_id, episode_number)',
  },
  {
    name: 'EPISOD: sursele/legenda episodului',
    charge: 'view',
    file: 'src/routes/api/subtitle.js',
    sql: sqlOf('src/routes/api/subtitle.js', 'SELECT subtitle_url FROM episodes'),
    params: [1], one: true,
    atMost: true, rows: 1, rowsHow: 'cheie primară',
  },
  {
    name: 'NOTIFICĂRI necitite (poll la 60s)',
    charge: 'view',
    file: 'src/lib/notify.js',
    sql: sqlOf('src/lib/notify.js', 'SELECT COUNT(*) AS n FROM notifications'),
    params: [1], one: true,
    countSql: `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0`,
    rowsHow: 'index (user_id, read, id)',
  },
  {
    name: 'SSR episod (crawler, cache 5 min)',
    charge: 'view',
    file: 'src/worker.js',
    sql: sqlOf('src/worker.js', 'SELECT e.id, e.series_id, e.episode_number'),
    params: [1], one: true,
    atMost: true, rows: 2, rowsHow: 'două chei primare',
  },
  {
    name: 'PROGRES: verificarea episodului (heartbeat)',
    charge: 'view',
    file: 'src/routes/api/progress.js',
    sql: sqlOf('src/routes/api/progress.js', 'SELECT id FROM episodes WHERE id = ?'),
    params: [1], one: true,
    atMost: true, rows: 1, rowsHow: 'cheie primară',
  },
  {
    name: 'VOT: resincronizarea mediei (la fiecare vot)',
    charge: 'rare',
    file: 'src/lib/ratings.js',
    sql: sqlOf('src/lib/ratings.js', 'UPDATE anime_series SET'),
    params: [1, 1, 1],
    countSql: `SELECT COUNT(*) AS n FROM series_ratings WHERE series_id = ?`,
    countParams: [1],
    rowsHow: 'index (series_id) — doar notele seriei, nu tot tabelul',
  },
  {
    name: 'SITEMAP: toate seriile (cache 1 oră)',
    charge: 'hour',
    file: 'src/worker.js',
    sql: sqlOf('src/worker.js', 'SELECT id FROM anime_series ORDER BY id DESC'),
    params: [],
  },
  {
    name: 'SITEMAP: toate episoadele (cache 1 oră)',
    charge: 'hour',
    file: 'src/worker.js',
    sql: sqlOf('src/worker.js', 'SELECT id FROM episodes ORDER BY id DESC'),
    params: [],
    rowsOverride: 5000, rowsHow: 'LIMIT 5000 (oprește scanarea)',
  },
];

// ---------------------------------------------------------------------
// Măsurare
// ---------------------------------------------------------------------
/** Aliasul din plan (SCAN w) → tabelul real (watch_progress). */
function realTable(sql, alias) {
  if (Object.hasOwn(SIZES, alias)) return alias;
  const m = sql.match(new RegExp(`(?:FROM|JOIN)\\s+(\\w+)\\s+(?:AS\\s+)?${alias}\\b`, 'i'));
  return m ? m[1] : null;
}

const results = [];

for (const q of Q) {
  // Garda anti-derivă: capul interogării (până la ORDER/GROUP/LIMIT) trebuie
  // să existe în fișierul sursă — coada depinde de interpolările handlerului.
  const src = readFileSync(join(ROOT, q.file), 'utf8');
  const head = (t) => norm(t).split(/\s(?:ORDER BY|GROUP BY|LIMIT)\s/)[0];
  if (!norm(src).includes(head(q.sql))) {
    console.error(`\n✗ ${q.name}: SQL-ul nu mai există în ${q.file} — reancorează bench-ul.`);
    process.exitCode = 1;
  }

  let plan = [];
  try {
    plan = db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params).map((r) => r.detail);
  } catch (e) {
    plan = [`<plan indisponibil: ${e.message}>`];
  }

  const fullScans = plan.filter((d) => /^SCAN (?!CONSTANT)/.test(d));
  const scansText = fullScans.map((d) => d.replace(/ USING (COVERING )?INDEX \S+/, '')).join(' + ');

  let rows;
  if (q.rowsOverride) {
    rows = q.rowsOverride;
  } else if (fullScans.length) {
    rows = fullScans.reduce((sum, d) => {
      const t = realTable(q.sql, d.match(/^SCAN ([\w.]+)/)?.[1]);
      return sum + (t ? SIZES[t] ?? 0 : 0);
    }, 0);
  } else if (q.countSql) {
    const cp = q.countParams || q.params;
    rows = Number(db.prepare(q.countSql).get(...cp).n) || 0;
  } else {
    rows = 10;
  }
  if (q.rows != null) rows = Math.min(rows, q.rows) || q.rows;
  const rowsHow = q.rowsHow || (fullScans.length ? 'scanare completă' : 'index');

  const run = q.one ? (p) => db.prepare(q.sql).get(...p) : (p) => db.prepare(q.sql).all(...p);
  const times = [];
  for (let i = 0; i < 15; i++) {
    const a = Date.now();
    try { run(q.params); } catch { /* parametri nepotriviți: nu măsurăm timpul */ }
    times.push(Date.now() - a);
  }
  times.sort((a, b) => a - b);

  results.push({ ...q, plan, scansText, rows, rowsHow, median: times[Math.floor(times.length / 2)] });
}

// ---------------------------------------------------------------------
// Raport
// ---------------------------------------------------------------------
const fmt = (n) => Math.round(n).toLocaleString('ro-RO');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

const byCharge = (c) => results.filter((r) => r.charge === c).reduce((s, r) => s + r.rows, 0);
const perView = byCharge('view');
const perHour = byCharge('hour');
const per5min = byCharge('min5');
const daily = perView * VIEWS_PER_DAY + perHour * 24 + per5min * 288;
const quota = 5_000_000;
const viewsUntilQuota = Math.floor(quota / perView);

if (!JSON_OUT) {
  console.log(`\n════════ BANC DE TEST LA SCARĂ — ${fmt(SERIES)} serii · ${fmt(USERS)} utilizatori ════════`);
  console.log(`date sintetice: ${Object.entries(SIZES).map(([k, v]) => `${k}=${fmt(v)}`).join(' · ')}`);
  console.log(`construite în ${seedMs} ms\n`);
  console.log(`${pad('interogare', 50)} ${pad('plan', 26)} ${padL('rânduri citite', 15)} ${padL('ms', 5)}`);
  console.log('─'.repeat(101));
  for (const r of results) {
    const planShort = (r.scansText || 'index').slice(0, 25);
    console.log(`${pad(r.name, 50)} ${pad(planShort, 26)} ${padL(fmt(r.rows), 15)} ${padL(r.median, 5)}`);
  }
  console.log('─'.repeat(101));
  console.log(`\n  O vizită pe prima pagină costă      ${padL(fmt(perView), 12)} rânduri citite`);
  console.log(`  La ${fmt(VIEWS_PER_DAY)} vizite/zi + cache-uri:      ${padL(fmt(daily), 12)} rânduri/zi  (cotă: 5.000.000)`);
  console.log(`  Plafonul de 5M/zi ar ține              ${padL(fmt(viewsUntilQuota), 12)} vizite pe zi (doar prima pagină)`);
  console.log(`  Invocări de Worker pentru o vizită:              2   (din 100.000/zi)`);
  console.log(`\n  „rânduri citite" = metrica taxată de D1 (rândurile pe care le atinge interogarea).`);
  console.log(`  ${results.filter((r) => /SCAN/.test(r.scansText)).length} din ${results.length} interogări SCANEAZĂ un tabel întreg.`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    sizes: SIZES, series: SERIES, users: USERS, viewsPerDay: VIEWS_PER_DAY,
    perView, perHour, per5min, daily, viewsUntilQuota,
    results: results.map(({ name, scansText, rows, rowsHow, median, charge }) => ({ name, charge, plan: scansText || 'index', rows, rowsHow, ms: median })),
  }, null, 2));
}

db.close();
if (KEEP) {
  const bytes = statSync(join(dir, 'bench.sqlite')).size;
  if (!JSON_OUT) console.log(`\n  baza sintetică păstrată: ${join(dir, 'bench.sqlite')} (${(bytes / 1048576).toFixed(1)} MB)`);
} else {
  rmSync(dir, { recursive: true, force: true });
}
