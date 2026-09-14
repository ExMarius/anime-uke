// =====================================================================
// Facțiuni — fiecare temă de grade (anime) e o facțiune.
//
// Alegerea: o dată pe lună (users.faction_month). Punctele pentru
// episod (+10) și comentariu (+5) și deschiderea cufărului (+5) dau
// REPUTAȚIE facțiunii. La final de lună, leneș (fără cron, buget 0):
//   * cel mai rep membru din facțiune -> LIDER luna următoare
//     (recunoscut după culoarea unică a numelui)
//   * facțiunea cu rep total maxim câștigă -> membrii ei primesc 1.5x
//     gold și XP luna următoare
// =====================================================================
import { monthKey } from './xp.js';

export { monthKey };

const LEADER_CLASSES = [
  'gold', 'sky', 'violet', 'lime', 'pink', 'cyan',
  'orange', 'royal', 'teal', 'magenta', 'green', 'red',
];

/** Culoarea unică a liderului de facțiune, deterministă din slug. */
export function leaderClassFor(slug) {
  let h = 0;
  for (let i = 0; i < String(slug).length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return LEADER_CLASSES[h % LEADER_CLASSES.length];
}

/** Cheia lunii precedenței celei curente (YYYY-MM). */
export function prevMonthKey(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  x.setUTCMonth(x.getUTCMonth() - 1);
  return monthKey(x);
}

/** Rep total al lunii pentru un utilizator (1 citire indexată). */
export async function myRep(env, userId, month = monthKey()) {
  const r = await env.DB
    .prepare('SELECT rep, faction FROM faction_rep WHERE month = ? AND user_id = ?')
    .bind(month, userId)
    .first();
  return { rep: Number(r?.rep) || 0, faction: r?.faction || '' };
}

/** Adaugă reputație în facțiunea userului (no-op dacă nu e în niciuna). */
export async function addRep(env, user, amount) {
  const slug = user?.faction_slug;
  if (!slug || !amount) return;
  await env.DB
    .prepare(
      `INSERT INTO faction_rep (month, user_id, faction, rep) VALUES (?, ?, ?, ?)
       ON CONFLICT(month, user_id) DO UPDATE SET rep = rep + ?`
    )
    .bind(monthKey(), user.id, slug, amount, amount)
    .run();
}

/** Facțiunea câștigătoare a lunii date (1 citire). */
export async function winnerOf(env, month) {
  const r = await env.DB
    .prepare('SELECT faction FROM faction_winners WHERE month = ?')
    .bind(month)
    .first();
  return r?.faction || '';
}

/** 1.5x dacă userul e în facțiunea câștigătoare a lunii trecute. */
export async function bonusFor(env, user) {
  const slug = user?.faction_slug;
  if (!slug) return 1;
  const winner = await winnerOf(env, prevMonthKey());
  return winner && winner === slug ? 1.5 : 1;
}

/**
 * Plata leneșă a lunii trecute: lideri + facțiunea câștigătoare.
 * Guard: o singură citire (leaders pentru luna CURENTĂ există?).
 * Chemată din GET /api/factions și din GET /api/economy.
 */
export async function settleFactions(env) {
  const cur = monthKey();
  const prev = prevMonthKey();
  const done = await env.DB
    .prepare('SELECT 1 AS x FROM faction_leaders WHERE month = ? LIMIT 1')
    .bind(cur)
    .first();
  if (done) return { settled: false };

  // Lider: argmax(rep) pe fiecare facțiune (bare column + MAX e valid în SQLite)
  const tops = await env.DB
    .prepare(
      `SELECT faction, user_id, MAX(rep) AS rep
       FROM faction_rep WHERE month = ?
       GROUP BY faction`
    )
    .bind(prev)
    .all();

  // Câștigătoarea: suma rep pe facțiune
  const sums = await env.DB
    .prepare(
      `SELECT faction, SUM(rep) AS total
       FROM faction_rep WHERE month = ?
       GROUP BY faction ORDER BY total DESC, faction ASC LIMIT 1`
    )
    .bind(prev)
    .all();
  const win = (sums.results || [])[0];

  const stmts = [];
  for (const t of tops.results || []) {
    stmts.push(
      env.DB.prepare('INSERT OR IGNORE INTO faction_leaders (month, faction, user_id, rep) VALUES (?, ?, ?, ?)')
        .bind(cur, t.faction, t.user_id, t.rep || 0)
    );
  }
  if (win) {
    stmts.push(
      env.DB.prepare('INSERT OR IGNORE INTO faction_winners (month, faction, total_rep) VALUES (?, ?, ?)')
        .bind(cur, win.faction, win.total || 0)
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { settled: true, leaders: tops.results?.length || 0, winner: win?.faction || '' };
}

/** Clasamentul facțiunilor în luna curentă (o citire). */
export async function standings(env, month = monthKey()) {
  const res = await env.DB
    .prepare(
      `SELECT faction, SUM(rep) AS total, COUNT(*) AS members
       FROM faction_rep WHERE month = ?
       GROUP BY faction ORDER BY total DESC`
    )
    .bind(month)
    .all();
  return (res.results || []).map((r) => ({ faction: r.faction, total: r.total || 0, members: r.members || 0 }));
}
