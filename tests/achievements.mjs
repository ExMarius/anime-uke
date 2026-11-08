// =====================================================================
// achievements.mjs — realizările (migrarea 0031), testate fĂRĂ server.
//
// De ce separat de e2e: în e2e verifici o singură cale („s-a deblocat ceva
// după un episod”), iar aici verifici regulile care se strică ușor la o
// refactorizare și care NU se văd într-un flux fericit:
//   * catalogul e coerent (id-uri unice, praguri crescătoare, statistici
//     care există cu adevărat în STAT_QUERIES);
//   * recompensa se acordă O SINGURĂ DATĂ, chiar la evaluări repetate;
//   * fără prag atins nu se scrie NIMIC (buget D1);
//   * notificarea poartă numele și recompensa;
//   * 301-ul către domeniul propriu (canonicalRedirectTarget) respectă
//     exact regulile de siguranță: nu atinge API-ul, nu redirectează când
//     e dezactivat, nu bucluiește pe hostul canonic.
//
// Rulează: node tests/achievements.mjs
// =====================================================================

import {
  ACHIEVEMENTS,
  STAT_QUERIES,
  TIERS,
  evaluateAchievements,
  progressFor,
  presentAchievements,
} from '../src/lib/achievements.js';
import { canonicalRedirectTarget } from '../src/worker.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ---------------------------------------------------------------------
// 1. Catalogul
// ---------------------------------------------------------------------
console.log('=== CATALOGUL DE REALIZĂRI ===');
{
  const ids = ACHIEVEMENTS.map((a) => a.id);
  check('Id-urile sunt unice', new Set(ids).size === ids.length, ids.join(','));

  const badTier = ACHIEVEMENTS.filter((a) => !TIERS[a.tier]);
  check('Fiecare treaptă există în TIERS', badTier.length === 0, badTier.map((a) => a.id).join(','));

  const badStat = ACHIEVEMENTS.filter((a) => !STAT_QUERIES[a.stat]);
  check('Fiecare statistică are o interogare în STAT_QUERIES', badStat.length === 0, badStat.map((a) => a.id).join(','));

  const badTarget = ACHIEVEMENTS.filter((a) => !Number.isInteger(a.target) || a.target < 1);
  check('Pragurile sunt întregi pozitivi', badTarget.length === 0, badTarget.map((a) => a.id).join(','));

  const noText = ACHIEVEMENTS.filter((a) => !a.name || !a.icon || !a.desc || !a.req);
  check('Fiecare card are nume, icon, descriere și cerință', noText.length === 0, noText.map((a) => a.id).join(','));

  // Praguri crescătoare pe aceeași statistică: două realizări cu același prag
  // s-ar debloca simultan și ar arăta ca un duplicat.
  const byStat = {};
  for (const a of ACHIEVEMENTS) (byStat[a.stat] ||= []).push(a.target);
  const notIncreasing = Object.entries(byStat).filter(([, targets]) => {
    const sorted = [...targets].sort((x, y) => x - y);
    return new Set(sorted).size !== sorted.length;
  });
  check('Nu există două praguri identice pe aceeași statistică', notIncreasing.length === 0, notIncreasing.map(([s]) => s).join(','));

  check('Recompensele sunt gold pozitiv, fără XP',
    ACHIEVEMENTS.every((a) => (a.gold || 0) > 0 && (a.xp || 0) === 0),
    ACHIEVEMENTS.filter((a) => !(a.gold > 0) || a.xp).map((a) => a.id).join(','));
  check('Există cel puțin 12 realizări (catalog „de lansare”)', ACHIEVEMENTS.length >= 12, `n=${ACHIEVEMENTS.length}`);
}

// ---------------------------------------------------------------------
// 2. Matematica progresului
// ---------------------------------------------------------------------
console.log('\n=== PROGRESUL PE CARD ===');
{
  const ach = ACHIEVEMENTS.find((a) => a.id === 'episodes_10');
  check('0 din prag → 0%', progressFor(ach, { episodes: 0 }).percent === 0);
  check('Jumătate din prag → 50%', progressFor(ach, { episodes: 5 }).percent === 50);
  check('Peste prag → se afișează pragul, nu 130%', (() => {
    const p = progressFor(ach, { episodes: 13 });
    return p.current === 10 && p.percent === 100;
  })(), JSON.stringify(progressFor(ach, { episodes: 13 })));
  check('Statistică lipsă → 0, fără NaN', (() => {
    const p = progressFor(ach, {});
    return p.current === 0 && p.percent === 0 && Number.isFinite(p.percent);
  })());

  const stats = { episodes: 1, comments: 0, level: 10 };
  const rows = presentAchievements(stats, new Map([['first_episode', '2026-01-01 00:00:00']]));
  check('Catalogul prezentat are toate realizările', rows.length === ACHIEVEMENTS.length);
  check('Cardurile deblocate apar primele', rows[0].unlocked === true && rows[0].id === 'first_episode', JSON.stringify(rows.slice(0, 2).map((r) => r.id)));
  check('Cardul deblocat poartă data deblocării', rows[0].unlocked_at === '2026-01-01 00:00:00');
}

// ---------------------------------------------------------------------
// 3. Evaluarea pe un D1 fals: recompensa se dă o singură dată
// ---------------------------------------------------------------------
/**
 * D1 minimal, suficient pentru achievements.js: răspunde la exact
 * interogările din STAT_QUERIES + scrierile de recompensă/notificare.
 * Orice alt SQL aruncă — un test care „trece” pe o interogare necunoscută
 * ar ascunde o schimbare de schemă.
 */
function fakeEnv(state) {
  const rowsFor = (rawSql, args) => {
    // D1 nu impune un caz anume pentru cuvintele-cheie; comparăm pe text
    // normalizat ca testul să nu depindă de cum a fost scris interogarea.
    const sql = String(rawSql).toLowerCase();
    if (sql.includes('select ach_id, unlocked_at from user_achievements')) {
      return [...state.unlocked.entries()].map(([ach_id, unlocked_at]) => ({ ach_id, unlocked_at }));
    }
    if (sql.includes('select xp_boost_until')) return [{ xp_boost_until: null }];
    if (sql.includes('select xp, level from users')) return [{ xp: state.xp, level: state.level || 1 }];
    if (sql.includes('select points from user_monthly_points')) return [{ points: 0 }];
    if (sql.includes('select count(*) as n from watched_history')) return [{ n: state.episodes }];
    if (sql.includes('select count(*) as n from episode_comments')) return [{ n: state.comments }];
    if (sql.includes('select count(*) as n from series_reviews')) return [{ n: state.reviews }];
    if (sql.includes('select opens as n from chest_cooldown')) return [{ n: state.chests }];
    if (sql.includes('select best as n from user_streak')) return [{ n: state.streak }];
    if (sql.includes('select count(*) as n from friendships')) return [{ n: state.friends }];
    if (sql.includes('select count(*) as n from watchlist')) return [{ n: state.watchlist }];
    if (sql.includes('select count(*) as n from series_ratings')) return [{ n: state.ratings }];
    if (sql.includes('select count(*) as n from user_items')) return [{ n: state.items }];
    if (sql.includes('select level as n from users')) return [{ n: state.level || 1 }];
    throw new Error(`SQL neașteptat: ${sql}`);
  };

  const run = (rawSql, args) => {
    const sql = String(rawSql).toLowerCase();
    // Setările de recompensă
    if (sql.startsWith('insert or ignore into user_achievements')) {
      const [userId, achId] = args;
      if (state.unlocked.has(achId)) return { meta: { changes: 0 } };
      state.unlocked.set(achId, '2026-11-08 12:00:00');
      state.writes.push(`ach:${userId}:${achId}`);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('update users set gold = gold + ?')) {
      state.gold += Number(args[0]);
      state.writes.push('gold');
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('update users set xp = xp + ?')) {
      state.xp += Number(args[0]);
      state.writes.push('xp');
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('insert into notifications')) {
      // ordinea coloanelor: (user_id, type, payload, created_at)
      state.notifications.push({ type: args[1], payload: JSON.parse(args[2]) });
      state.writes.push('notif');
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('insert into user_monthly_points')) {
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('insert or ignore into user_badges')) {
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith('select ')) {
      return { results: rowsFor(sql, args), meta: { changes: 0 } };
    }
    throw new Error(`Scriere neașteptată: ${sql}`);
  };

  const db = {
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...a) { stmt.args = a; return stmt; },
        async first() { return (rowsFor(sql, stmt.args) || [])[0] || null; },
        async all() { return { results: rowsFor(sql, stmt.args) }; },
        async run() { return run(sql, stmt.args); },
      };
      return stmt;
    },
    async batch(list) {
      const out = [];
      for (const s of list) out.push(await s.run());
      return out;
    },
  };
  return { DB: db };
}

console.log('\n=== EVALUAREA (D1 fals, fără rețea) ===');
{
  const state = {
    episodes: 0, comments: 0, reviews: 0, chests: 0, streak: 0, friends: 0,
    watchlist: 0, ratings: 0, items: 0, level: 1,
    xp: 0, gold: 0, unlocked: new Map(), notifications: [], writes: [],
  };
  const env = fakeEnv(state);

  const none = await evaluateAchievements(env, 7);
  check('Fără prag atins nu se deblochează nimic', none.length === 0, JSON.stringify(none));
  check('Fără prag atins nu se scrie NIMIC în D1', state.writes.length === 0, state.writes.join(','));

  state.episodes = 1;
  const first = await evaluateAchievements(env, 7);
  check('Primul episod deblochează „Primul cadru”', first.length === 1 && first[0].id === 'first_episode', JSON.stringify(first));
  check('Recompensa în gold se acordă (+10)', state.gold === 10, `gold=${state.gold}`);
  check('Notificarea de realizare e scrisă', state.notifications.length === 1 && state.notifications[0].type === 'achievement' && /Primul cadru/.test(state.notifications[0].payload.name), JSON.stringify(state.notifications));

  const again = await evaluateAchievements(env, 7);
  check('A doua evaluare nu mai deblochează nimic', again.length === 0, JSON.stringify(again));
  check('A doua evaluare NU mai dă gold (fără dublură)', state.gold === 10, `gold=${state.gold}`);
  check('A doua evaluare nu mai scrie notificări', state.notifications.length === 1, `n=${state.notifications.length}`);

  // Un salt mare: mai multe praguri deodată, cu XP pe unele.
  state.episodes = 50;
  state.comments = 25;
  const many = await evaluateAchievements(env, 7);
  const ids = many.map((a) => a.id).sort();
  check('Un salt deblochează toate pragurile atinse deodată',
    ['episodes_10', 'episodes_50', 'comments_25', 'first_comment'].every((id) => ids.includes(id)), ids.join(','));
  // 10 (primul episod, deja luat) + 5 (prima părere) + 25 + 75 + 60
  check('Gold-ul se adună corect, fără dubluri', state.gold === 10 + 5 + 25 + 75 + 60, `gold=${state.gold}`);
  // Realizările NU ating XP-ul: altfel boost-ul ×2 ar dubla un trofeu
  // acordat o singură dată, iar nivelul ar sări imprevizibil.
  check('Realizările nu acordă XP (XP rămâne activitate)', state.xp === 0, `xp=${state.xp}`);
  check('Fiecare realizare nouă are notificare', state.notifications.length === 1 + many.length, `n=${state.notifications.length}`);
  check('Cardurile întoarse poartă icon + treaptă', many.every((a) => a.icon && a.tier), JSON.stringify(many[0]));
}

// ---------------------------------------------------------------------
// 4. 301-ul către domeniul propriu (lansare pe domeniu)
// ---------------------------------------------------------------------
console.log('\n=== DOMENIU CANONIC (301) ===');
{
  const u = (s) => new URL(s);

  check('Fără FORCE_CANONICAL_REDIRECT nu redirectează', canonicalRedirectTarget({ CANONICAL_ORIGIN: 'https://anime-uke.dpdns.org' }, u('https://anime-uke.pages.dev/serie/1')) === null);

  check('Fără CANONICAL_ORIGIN nu redirectează', canonicalRedirectTarget({ FORCE_CANONICAL_REDIRECT: '1' }, u('https://anime-uke.pages.dev/')) === null);

  check('Host diferit → 301 către domeniu', canonicalRedirectTarget(
    { FORCE_CANONICAL_REDIRECT: '1', CANONICAL_ORIGIN: 'https://anime-uke.dpdns.org' },
    u('https://anime-uke.pages.dev/serie/1014?x=1')
  ) === 'https://anime-uke.dpdns.org/serie/1014?x=1');

  check('Host canonic → fără buclă', canonicalRedirectTarget(
    { FORCE_CANONICAL_REDIRECT: '1', CANONICAL_ORIGIN: 'https://anime-uke.dpdns.org' },
    u('https://anime-uke.dpdns.org/')
  ) === null);

  // Un 301 pe POST devine GET: API-ul nu se atinge NICIODATĂ.
  check('API-ul nu se redirectează (POST-urile ar deveni GET)', canonicalRedirectTarget(
    { FORCE_CANONICAL_REDIRECT: '1', CANONICAL_ORIGIN: 'https://anime-uke.dpdns.org' },
    u('https://anime-uke.pages.dev/api/auth/login')
  ) === null);

  check('WebSocket-ul de chat nu se redirectează', canonicalRedirectTarget(
    { FORCE_CANONICAL_REDIRECT: '1', CANONICAL_ORIGIN: 'https://anime-uke.dpdns.org' },
    u('https://anime-uke.pages.dev/chat')
  ) === null);

  check('Preview-urile de branch rămân accesibile cât timp flag-ul e oprit', canonicalRedirectTarget(
    { CANONICAL_ORIGIN: 'https://anime-uke.dpdns.org' },
    u('https://abc123.anime-uke.pages.dev/')
  ) === null);

  check('CANONICAL_ORIGIN invalid nu rupe site-ul', canonicalRedirectTarget(
    { FORCE_CANONICAL_REDIRECT: '1', CANONICAL_ORIGIN: 'nu-e-un-url' },
    u('https://anime-uke.pages.dev/')
  ) === null);
}

console.log('\n' + '='.repeat(56));
console.log(`REZULTAT: ${passed} trecute, ${failed} esuate`);
if (failed) { console.log('\nEsuate:'); failures.forEach((f) => console.log('  • ' + f)); }
console.log('='.repeat(56));
process.exit(failed ? 1 : 0);
