// =====================================================================
// seed.mjs — umple site-ul cu un catalog de test prin API-ul REAL.
//
// De ce prin API si nu cu INSERT-uri directe in D1: contoarele
// denormalizate (episode_count, series_total, episodes_total) se
// sincronizeaza in codul de creare. Un seed cu SQL brut ar lasa site-ul cu
// „0 EP" peste tot si ar trebui sa reimplementez sincronizarea aici —
// adica sa am doua surse de adevar pentru aceeasi logica.
//
// Foloseste endpointul de postare in bloc, deci episoadele SI sursele lor
// se creeaza intr-un singur apel per serie.
//
//   BASE=http://127.0.0.1:8788 \
//   SEED_ADMIN_USER=marius SEED_ADMIN_PASS=parola123 \
//   node scripts/seed.mjs
//
// Seriile existente (dupa titlu) sunt sarite, deci scriptul e re-rulabil.
// =====================================================================

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const USER = process.env.SEED_ADMIN_USER || process.argv[2];
const PASS = process.env.SEED_ADMIN_PASS || process.argv[3];

if (!USER || !PASS) {
  console.error('Foloseste: SEED_ADMIN_USER=… SEED_ADMIN_PASS=… node scripts/seed.mjs');
  process.exit(1);
}

// Videoclipuri publice cu licenta libera (Blender open movies si mostre
// CC0), gazduite pe CDN-uri care permit Range requests — de asta le poate
// reda player-ul. Sunt fisiere .mp4 directe, deci kind='file'.
//
// ISTORIC: bucketul Google gtv-videos-bucket a fost mult timp referinta
// pentru videoclipuri de test, dar din 2026 raspunde cu 403. Lista de mai
// jos a fost verificata manual cu un HEAD cu Range inainte de commit.
const REELS = [
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
let reel = 0;
const nextVideo = () => REELS[reel++ % REELS.length];

// ---------------------------------------------------------------------
// Catalogul. Episoadele sunt putine pe serie (date de test), cu exceptia
// lui One Piece, care are destule ca sa treaca de pragul de 100/pagina si
// sa exercite selectorul de intervale de pe pagina seriei.
// ---------------------------------------------------------------------
// Fara coperti locale in repo (site-ul foloseste URL-uri externe, ca in
// productie); cardurile fara imagine primesc posterul procedural din core.js.
const C = () => '';

const CATALOG = [
  {
    title: 'Attack on Titan', slug: 'attack-on-titan', year: 2013, status: 'completed',
    genre: 'Acțiune, Dark Fantasy, Dramă',
    description: 'Omenirea trăiește înghesuită în orașe înconjurate de ziduri uriașe, singura apărare împotriva titanilor care devorează oameni. Când un titan colossal străpunge zidul exterior, tânărul Eren Yeager jură să-i extermine pe toți.',
    episodes: 8,
  },
  {
    title: 'Demon Slayer: Kimetsu no Yaiba', slug: 'demon-slayer', year: 2019, status: 'ongoing',
    genre: 'Acțiune, Supranatural, Istoric',
    description: 'După ce familia îi este măcelărită iar sora transformată în demon, Tanjiro Kamado pornește în căutarea unui leac. Alăturându-se Corpului de Vânători de Demoni, învață Respirația Apei și taie prin întuneric.',
    episodes: 8,
  },
  {
    title: 'Jujutsu Kaisen', slug: 'jujutsu-kaisen', year: 2020, status: 'ongoing',
    genre: 'Acțiune, Supranatural, Școlar',
    description: 'Yuji Itadori înghite un deget blestemat ca să-și salveze prietenii și devine vasul lui Sukuna, Regele Blestemelor. Recrutat de vrăjitorii din Tokyo, învață să lupte cu energia blestemată proprie.',
    episodes: 8,
  },
  {
    title: 'One Piece', slug: 'one-piece', year: 1999, status: 'ongoing',
    genre: 'Aventură, Comedie, Shonen',
    description: 'Monkey D. Luffy, un băiat cu trup de cauciuc, pornește pe mare să găsească comoara One Piece și să devină Regele Piraților. Alături de echipajul lui de pe Thousand Sunny, înfruntă Imperiul și Marinele.',
    episodes: 120,
  },
  {
    title: 'Naruto', slug: 'naruto', year: 2002, status: 'completed',
    genre: 'Acțiune, Aventură, Arte Marțiale',
    description: 'Naruto Uzumaki, un ninja zgomotos cu un demon-vulpe pecetluit înăuntru, visează să devină Hokage și să fie în sfârșit acceptat de satul care l-a ocolit toată viața.',
    episodes: 10,
  },
  {
    title: 'Death Note', slug: 'death-note', year: 2006, status: 'completed',
    genre: 'Thriller, Supranatural, Mister',
    description: 'Un caiet care ucide pe oricine îi este scris numele ajunge în mâinile lui Light Yagami, un liceu strălucit care vrea o lume fără crimă. În calea lui stă doar L, cel mai mare detectiv din lume.',
    episodes: 8,
  },
  {
    title: 'Fullmetal Alchemist: Brotherhood', slug: 'fma-brotherhood', year: 2009, status: 'completed',
    genre: 'Acțiune, Aventură, Fantasy',
    description: 'Frații Elric plătesc scump încercarea de a-și învia mama prin alchimie interzisă. În căutarea Piatrei Filozofale pentru a-și recupera trupurile, descoperă un complot la nivelul întregii țări.',
    episodes: 8,
  },
  {
    title: 'My Hero Academia', slug: 'my-hero-academia', year: 2016, status: 'ongoing',
    genre: 'Acțiune, Supereroi, Școlar',
    description: 'Într-o lume în care aproape toți oamenii au puteri, Izuku Midoriya s-a născut fără niciuna. Când îl salvează pe cel mai mare erou din lume, primește moștenirea One For All și poarta către Academia U.A.',
    episodes: 8,
  },
  {
    title: 'Spy x Family', slug: 'spy-x-family', year: 2022, status: 'ongoing',
    genre: 'Comedie, Acțiune, Slice of Life',
    description: 'Un spion de elită, o asasină și o fetiță care citește gândurile formează, fiecare din motive proprii, o familie falsă perfectă. Niciunul nu știe secretul celuilalt — și toți trei au ceva de ascuns.',
    episodes: 8,
  },
  {
    title: 'Chainsaw Man', slug: 'chainsaw-man', year: 2022, status: 'ongoing',
    genre: 'Acțiune, Dark Fantasy, Groază',
    description: 'Denji, un tânăr înglodat în datorii, fuzionează cu câinele-motofierăstrău Pochita și devine Chainsaw Man. Recrutat de Biroul de Siguranță Publică, vânează demoni pentru o viață cât de cât normală.',
    episodes: 6,
  },
  {
    title: 'Frieren: Beyond Journey’s End', slug: 'frieren', year: 2023, status: 'completed',
    genre: 'Fantasy, Dramă, Aventură',
    description: 'După ce echipajul care a învins Regele Demon se desparte, elfa Frieren — care trăiește mii de ani — înțelege prea târziu cât de puțin și-a cunoscut tovarășii. Pornește din nou la drum, ca să învețe ce înseamnă oamenii.',
    episodes: 6,
  },
  {
    title: 'Cowboy Bebop', slug: 'cowboy-bebop', year: 1998, status: 'completed',
    genre: 'Sci-Fi, Noir, Acțiune',
    description: 'Echipajul navei Bebop vânează prime prin sistemul solar, fugind fiecare de propriul trecut. Jazz, țigări și melancolie într-un western spațial care nu iartă.',
    episodes: 6,
  },
];

// ---------------------------------------------------------------------
let COOKIE = '';

async function req(path, { method = 'GET', body } = {}) {
  const init = {
    method,
    headers: { Origin: BASE },
    redirect: 'manual',
  };
  if (COOKIE) init.headers.Cookie = COOKIE;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}/api${path}`, init);
  const set = res.headers.getSetCookie?.() || [];
  if (set.length) COOKIE = set.map((s) => s.split(';')[0]).join('; ');
  let data = null;
  try { data = await res.json(); } catch { /* raspuns gol */ }
  return { ok: res.ok, status: res.status, data };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const login = await req('/auth/login', { method: 'POST', body: { username: USER, password: PASS } });
  if (!login.ok) { console.error(`✗ login esuat: HTTP ${login.status} ${login.data?.error || ''}`); process.exit(1); }
  if (!login.data?.user?.is_admin) { console.error('✗ contul nu e admin'); process.exit(1); }
  console.log(`✓ logat ca ${login.data.user.username} (admin)`);

  let created = 0, skippedSeries = 0, totalEpisodes = 0;

  for (const s of CATALOG) {
    const found = await req(`/admin/series?per_page=1&q=${encodeURIComponent(s.title)}`);
    if ((found.data?.series || []).some((x) => x.title === s.title)) {
      skippedSeries++;
      console.log(`  • ${s.title} — exista deja, sar peste`);
      continue;
    }

    const ser = await req('/admin/series', {
      method: 'POST',
      body: {
        title: s.title, description: s.description, cover_image: C(s.slug),
        status: s.status, genre: s.genre, year: s.year,
      },
    });
    if (!ser.ok) { console.error(`  ✗ ${s.title}: HTTP ${ser.status} ${ser.data?.error || ''}`); continue; }

    const episodes = [];
    for (let i = 1; i <= s.episodes; i++) {
      const src = [{ label: 'Server principal', kind: 'file', url: nextVideo() }];
      // fiecare al treilea episod primeste o a doua sursa, ca sa existe
      // taburi de surse de testat in player
      if (i % 3 === 0) src.push({ label: 'Backup', kind: 'file', url: nextVideo() });
      episodes.push({ episode_number: i, title: `Episodul ${i}`, sources: src });
    }

    // bulk accepta max 300 pe apel; One Piece (120) incap dintr-odata
    let done = 0;
    while (done < episodes.length) {
      const chunk = episodes.slice(done, done + 300);
      const bulk = await req('/admin/episodes', {
        method: 'POST',
        body: { series_id: ser.data.id, episodes: chunk },
      });
      if (!bulk.ok) { console.error(`  ✗ ${s.title} episoade: HTTP ${bulk.status} ${bulk.data?.error || ''}`); break; }
      done += chunk.length;
      totalEpisodes += bulk.data?.created || 0;
      await wait(150);
    }

    created++;
    console.log(`  ✓ ${s.title} — ${s.episodes} episoade`);
    await wait(150);
  }

  const stats = await req('/admin/stats');
  console.log(`\nGata: ${created} serii create, ${skippedSeries} sarite, ${totalEpisodes} episoade adaugate.`);
  if (stats.ok) console.log('Contoare raportate de server:', JSON.stringify(stats.data?.stats));
}

main().catch((e) => { console.error('✗', e?.message || e); process.exit(1); });
