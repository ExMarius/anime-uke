// =====================================================================
// purge-generated.mjs — genereaza scripts/purge-generated.sql
//
//   node scripts/purge-generated.mjs
//
// Sterge EXACT seriile de test create de gen-scale-sql.mjs (lista de
// titluri e determinista: acelasi seed => aceeasi lista), lasand intact
// catalogul postat manual. Nu ruleaza nimic de la sine: doar scrie
// fisierul SQL, ca decizia de curatare sa fie explicita.
//
//   wrangler d1 execute DB --remote --file=scripts/purge-generated.sql
// =====================================================================
import { writeFileSync } from 'node:fs';

const N = Number(process.argv[2] || 1000);

// Aceeasi secventa ca in gen-scale-sql.mjs — altfel lista nu coincide.
let seedState = 1337;
const rnd = () => (seedState = (seedState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];

const ADJ = ['Crimson','Silent','Eternal','Shattered','Azure','Hollow','Radiant','Frozen','Wandering','Scarlet','Midnight','Golden','Broken','Sacred','Neon','Iron','Pale','Burning','Lost','Silver'];
const NOUN = ['Blade','Requiem','Horizon','Covenant','Labyrinth','Symphony','Vanguard','Chronicle','Sanctuary','Paradox','Mirage','Odyssey','Frontier','Genesis','Requiem','Throne','Garden','Storm','Echo','Crown'];
const TAIL = ['', ' Season 2', ' Season 3', ' Season 4', ': Origins', ': Final Arc'];

const titles = new Set();
while (titles.size < N) {
  const t = `The ${pick(ADJ)} ${pick(NOUN)}${pick(TAIL)}`.replace('  ', ' ').trim();
  titles.add(t);
}
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const list = [...titles];

const out = [
  '-- Generat de scripts/purge-generated.mjs — sterge doar seriile de test.',
  '-- Episoadele si sursele lor cad prin FK ON DELETE CASCADE.',
  `DELETE FROM anime_series WHERE title IN (${list.map(q).join(',')});`,
  `UPDATE anime_series SET episode_count = (SELECT COUNT(*) FROM episodes WHERE episodes.series_id = anime_series.id);`,
  `INSERT OR REPLACE INTO site_meta (key, value) VALUES ('series_total', (SELECT COUNT(*) FROM anime_series));`,
  `INSERT OR REPLACE INTO site_meta (key, value) VALUES ('episodes_total', (SELECT COUNT(*) FROM episodes));`,
];
writeFileSync(new URL('./purge-generated.sql', import.meta.url), out.join('\n') + '\n');
console.log(`✓ scripts/purge-generated.sql: ${list.length} serii de test marcate pentru stergere`);
