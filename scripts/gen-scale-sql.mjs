// =====================================================================
// gen-scale-sql.mjs — genereaza scripts/scale-seed.sql cu N serii de test.
//
//   node scripts/gen-scale-sql.mjs 1000
//
// De ce SQL si nu API: endpointurile de admin au rate limiting (200 de
// serii / 400 de episoade pe ora), ceea ce e corect ca protectie dar ar
// bloca un load initial de 1000 de serii. Un import de date unic nu e
// trafic de utilizator, deci nu trebuie sa treaca prin limita pe cerere.
//
// Contoarele denormalizate (episode_count, series_total, episodes_total)
// sunt RECALCULATE la final din datele reale, intr-o singura tranzactie —
// nu reimplementez sincronizarea, doar o reconstruiesc dupa un bulk load.
//
// Seriile nu au copertă intentionat: la scala asta vrem sa vedem si cum
// arata fallback-ul procedural de poster, nu 1000 de imagini lipsa.
// =====================================================================
import { writeFileSync } from 'node:fs';

const N = Number(process.argv[2] || 1000);
const EPISODES_PER_SERIES = 4;

// Determinist, ca doua rulari sa dea acelasi catalog (testabil).
let seedState = 1337;
const rnd = () => (seedState = (seedState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];

const ADJ = ['Crimson','Silent','Eternal','Shattered','Azure','Hollow','Radiant','Frozen','Wandering','Scarlet','Midnight','Golden','Broken','Sacred','Neon','Iron','Pale','Burning','Lost','Silver'];
const NOUN = ['Blade','Requiem','Horizon','Covenant','Labyrinth','Symphony','Vanguard','Chronicle','Sanctuary','Paradox','Mirage','Odyssey','Frontier','Genesis','Requiem','Throne','Garden','Storm','Echo','Crown'];
const TAIL = ['', ' Season 2', ' Season 3', ' Season 4', ': Origins', ': Final Arc'];
const GENRES = ['Acțiune, Aventură', 'Fantasy, Dramă', 'Sci-Fi, Thriller', 'Comedie, Slice of Life', 'Dark Fantasy, Groază', 'Romance, Dramă', 'Mister, Supranatural', 'Sport, Shonen'];
const STATUS = ['ongoing', 'completed'];
const HOOK = [
  'Un erou fără nume pornește într-o călătorie care va schimba totul.',
  'După un dezastru neașteptat, un grup de prieteni trebuie să o ia de la zero.',
  'O organizație secretă, o promisiune veche și un adevăr care nu trebuia aflat.',
  'Într-un oraș care nu doarme niciodată, o singură noapte răstoarnă totul.',
  'Când trecutul se întoarce, alegerile mici devin destine.',
  'Două lumi care nu trebuiau să se întâlnească se ciocnesc fără cale de întoarcere.',
];

const VIDEOS = [
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_2MB.mp4',
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_2MB.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4',
  'https://vjs.zencdn.net/v/oceans.mp4',
  'https://media.w3.org/2010/05/sintel/trailer.mp4',
  'https://media.w3.org/2010/05/bunny/trailer.mp4',
];

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

// --- titluri unice ---
const titles = new Set();
while (titles.size < N) {
  const t = `The ${pick(ADJ)} ${pick(NOUN)}${pick(TAIL)}`.replace('  ', ' ').trim();
  titles.add(t);
}
const list = [...titles];

const out = [];
out.push('-- Generat de scripts/gen-scale-sql.mjs — NU edita manual.');
// Fara BEGIN/COMMIT: workerd respinge tranzactiile SQL explicite in fisiere.;

// --- serii, in loturi de 200 ---
for (let i = 0; i < list.length; i += 200) {
  const rows = list.slice(i, i + 200).map((t) =>
    `(${q(t)}, ${q(pick(HOOK))}, '', ${q(pick(STATUS))}, ${q(pick(GENRES))}, ${1995 + Math.floor(rnd() * 31)})`
  );
  out.push(`INSERT OR IGNORE INTO anime_series (title, description, cover_image, status, genre, year) VALUES\n${rows.join(',\n')};`);
}

// --- episoade, in loturi de 200 tuple ---
const epTuples = [];
for (const t of list) {
  for (let n = 1; n <= EPISODES_PER_SERIES; n++) {
    epTuples.push(`((SELECT id FROM anime_series WHERE title=${q(t)}), ${n}, ${q(`Episodul ${n}`)})`);
  }
}
for (let i = 0; i < epTuples.length; i += 200) {
  out.push(`INSERT OR IGNORE INTO episodes (series_id, episode_number, title) VALUES\n${epTuples.slice(i, i + 200).join(',\n')};`);
}

// --- surse: o singura instructiune, url-ul ales dupa id ---
const caseSql = VIDEOS.map((u, i) => `WHEN ${i} THEN ${q(u)}`).join(' ');
out.push(`INSERT OR IGNORE INTO episode_sources (episode_id, label, kind, url, sort_order)
SELECT e.id, 'Server principal', 'file', CASE (e.id % ${VIDEOS.length}) ${caseSql} ELSE ${q(VIDEOS[0])} END, 0
FROM episodes e
WHERE e.series_id IN (SELECT id FROM anime_series WHERE title IN (${list.map(q).join(',')}));`);

// --- recalculare contoare din datele reale ---
out.push(`UPDATE anime_series SET episode_count = (SELECT COUNT(*) FROM episodes WHERE episodes.series_id = anime_series.id);`);
out.push(`INSERT OR REPLACE INTO site_meta (key, value) VALUES ('series_total', (SELECT COUNT(*) FROM anime_series));`);
out.push(`INSERT OR REPLACE INTO site_meta (key, value) VALUES ('episodes_total', (SELECT COUNT(*) FROM episodes));`);
;

writeFileSync(new URL('./scale-seed.sql', import.meta.url), out.join('\n') + '\n');
console.log(`✓ scripts/scale-seed.sql: ${list.length} serii, ${epTuples.length} episoade, ~${epTuples.length} surse`);
