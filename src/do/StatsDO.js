// =====================================================================
// StatsDO — buffer pentru contorul de vizualizari.
//
// Cerinta din spec: „views incrementat automat la deschiderea episodului".
// Naiv, asta inseamna un UPDATE in D1 la fiecare vizionare. La 1000+
// utilizatori/zi x mai multe episoade, consuma serios din cota de
// 100.000 scrieri/zi — care din 1 sept. 2026 pica HARD la depasire.
//
// Solutia: incrementam in memorie si scriem in D1 in loturi, o data la
// 20 de views sau la 30 de secunde. Scrierile scad de ~20x.
//
// Bonus: deduplicam (userId + episodeId) intr-o fereastra de 10 minute,
// ca un refresh repetat sa nu umfle artificial contorul.
// =====================================================================

const FLUSH_THRESHOLD = 20;
const FLUSH_ALARM_MS = 30_000;
const DEDUPE_WINDOW_MS = 10 * 60_000;

export class StatsDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.counts = new Map();  // episodeId -> numar de views acumulate
    this.seen = new Map();    // `${userId}:${episodeId}` -> timestamp
  }

  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ counted: false }, { status: 400 });
    }

    const episodeId = Number(body.episode_id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      return Response.json({ counted: false }, { status: 400 });
    }

    const now = Date.now();
    // `viewer` e id-ul utilizatorului logat SAU un hash de IP pentru vizitatori.
    // Fara asta, toti vizitatorii ar imparti cheia `0` si s-ar numara o singura
    // vizionare la 10 minute pentru toti odata.
    const viewer = String(body.viewer || 'anon').slice(0, 80);
    const dedupeKey = `${viewer}:${episodeId}`;

    const lastSeen = this.seen.get(dedupeKey);
    if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) {
      // Acelasi utilizator, acelasi episod, recent => nu numar a doua oara
      return Response.json({ counted: false, reason: 'duplicate' });
    }

    this.seen.set(dedupeKey, now);
    this.counts.set(episodeId, (this.counts.get(episodeId) || 0) + 1);

    let total = 0;
    for (const v of this.counts.values()) total += v;

    if (total >= FLUSH_THRESHOLD) {
      this.state.waitUntil(this.flush());
    } else {
      this.state.waitUntil(this.scheduleFlush());
    }

    this.pruneSeen(now);

    return Response.json({ counted: true });
  }

  async alarm() {
    await this.flush();
  }

  async flush() {
    if (this.counts.size === 0) return;

    const entries = [...this.counts.entries()];
    this.counts.clear();

    try {
      const stmt = this.env.DB.prepare('UPDATE episodes SET views = views + ? WHERE id = ?');
      await this.env.DB.batch(entries.map(([id, n]) => stmt.bind(n, id)));
    } catch (e) {
      console.error('StatsDO flush esuat:', e?.message || e);
      // Repunem ca sa nu pierdem views (limitat, sa nu creasca la infinit)
      if (entries.length <= 200) {
        for (const [id, n] of entries) {
          this.counts.set(id, (this.counts.get(id) || 0) + n);
        }
      }
    }
  }

  async scheduleFlush() {
    const current = await this.state.storage.getAlarm();
    if (!current) this.state.storage.setAlarm(Date.now() + FLUSH_ALARM_MS);
  }

  pruneSeen(now) {
    if (this.seen.size < 5000) return;
    for (const [key, ts] of this.seen) {
      if (now - ts >= DEDUPE_WINDOW_MS) this.seen.delete(key);
    }
  }
}
