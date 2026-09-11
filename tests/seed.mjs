// Seed pentru dezvoltare locala: creeaza admin + serii + episoade prin API.
// Ruleaza doar impotriva serverului local wrangler.
const BASE = 'http://127.0.0.1:8788';
let cookie = '';

async function req(method, path, body) {
  const headers = { Origin: BASE, 'CF-Connecting-IP': '127.0.0.1' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const t = await res.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = { raw: t.slice(0, 80) }; }
  return { status: res.status, data: d };
}

const SERIES = [
  {
    title: 'One Piece', genre: 'Acțiune, Aventură', year: 1999, status: 'ongoing',
    description: 'Monkey D. Luffy pornește în căutarea comorii legendare One Piece pentru a deveni Regele Piraților.',
    cover_image: 'https://picsum.photos/seed/onepiece/400/600',
    episodes: [
      [1, 'Romance Dawn', 'abc123'], [2, 'Enter the Great Swordsman', 'def456'],
      [3, 'Morgan versus Luffy', 'ghi789'], [4, 'Luffy\u2019s Past', 'jkl012'],
    ],
  },
  {
    title: 'Attack on Titan', genre: 'Acțiune, Dramă', year: 2013, status: 'completed',
    description: 'Omenirea se adăpostește în spatele unor ziduri uriașe pentru a supraviețui titanilor devoratori de oameni.',
    cover_image: 'https://picsum.photos/seed/aot/400/600',
    episodes: [
      [1, 'To You Two Thousand Years Later', 'mno345'], [2, 'That Day', 'pqr678'], [3, 'Dim Light of Despair', 'stu901'],
    ],
  },
  {
    title: 'Frieren: Beyond Journey\u2019s End', genre: 'Aventură, Fantezie', year: 2023, status: 'ongoing',
    description: 'După ce și-a învins demonul, elfa Frieren pornește într-o călătorie de înțelegere a vieții umane.',
    cover_image: 'https://picsum.photos/seed/frieren/400/600',
    episodes: [[1, 'The Journey\u2019s End', 'vwx234'], [2, 'It\u2019s Not Like We\u2019re Friends', 'yza567']],
  },
  {
    title: 'Demon Slayer', genre: 'Acțiune, Supranatural', year: 2019, status: 'ongoing',
    description: 'Tanjiro devine spadasin de demoni după ce familia îi este măcelărită, căutând un leac pentru sora sa.',
    cover_image: 'https://picsum.photos/seed/demonslayer/400/600',
    episodes: [[1, 'Cruelty', 'bcd890'], [2, 'Trainer Sakonji Urokodaki', 'efg123']],
  },
  {
    title: 'Spy x Family', genre: 'Comedie, Acțiune', year: 2022, status: 'ongoing',
    description: 'Un spion, o asasină și o telepatică formează o familie falsă, fără să-și cunoască secretele.',
    cover_image: 'https://picsum.photos/seed/spyfamily/400/600',
    episodes: [[1, 'Operation Strix', 'hij456']],
  },
];

console.log('1. Inregistrez admin-ul (primul user devine admin)...');
let r = await req('POST', '/api/auth/register', { username: 'admin', email: 'admin@anime.ro', password: 'admin123' });
if (r.status === 409) { r = await req('POST', '/api/auth/login', { email: 'admin@anime.ro', password: 'admin123' }); }
console.log(`   -> ${r.status} is_admin=${r.data?.user?.is_admin}`);

console.log('2. Adaug seriile si episoadele (ca admin)...');
for (const s of SERIES) {
  const { episodes, ...payload } = s;
  const created = await req('POST', '/api/admin/series', payload);
  if (created.status !== 201) { console.log(`   ❌ ${s.title}: ${created.data?.error}`); continue; }
  const sid = created.data.id;
  for (const [num, title, code] of episodes) {
    const ep = await req('POST', '/api/admin/episodes', {
      series_id: sid, episode_number: num, title,
      sources: [{ label: 'DoodStream', kind: 'embed', url: `https://doodstream.com/e/${code}` }],
    });
    if (ep.status !== 201) console.log(`   ❌ ${s.title} ep.${num}: ${ep.data?.error}`);
  }
  console.log(`   ✅ ${s.title} (${episodes.length} episoade)`);
}

console.log('3. Inregistrez un utilizator normal si il loghez...');
// ATENTIE: register/login schimba cookie-ul, deci se face DUPA ce adminul
// a adaugat continutul — altfel seriile ar fi create ca non-admin (403).
r = await req('POST', '/api/auth/register', { username: 'mihai', email: 'mihai@anime.ro', password: 'mihai123' });
console.log(`   -> ${r.status} ${r.data?.user?.username || r.data?.error}`);

console.log('4. Marcheaza cateva episoade ca vizionate (puncte)...');
for (const id of [1, 2, 3]) {
  const w = await req('POST', '/api/watch', { episode_id: id });
  console.log(`   episod ${id}: +${w.data?.pointsAdded ?? 0} pct (total ${w.data?.points})`);
}
for (const id of [1, 2, 3, 4, 5]) await req('POST', '/api/view', { episode_id: id });

console.log('\nRezumat:');
// Re-logam ca admin: ultimul login a fost cu mihai (non-admin), deci
// /api/admin/stats ar fi returnat 403.
await req('POST', '/api/auth/login', { email: 'admin@anime.ro', password: 'admin123' });
const st = await req('GET', '/api/admin/stats');
console.log('  ', JSON.stringify(st.data?.stats));
console.log('\nGata. Login admin: admin@anime.ro / admin123');
