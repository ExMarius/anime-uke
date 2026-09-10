// =====================================================================
// RateLimitDO — limita de cereri pe cheie (IP + ruta).
//
// DE CE UN DO SEPARAT SI DE CE NU PE TOATE RUTELE:
// Fiecare verificare costa 1 request DO, iar free tier = 100.000 requesturi
// DO/zi. Daca am verifica fiecare request API, la 1000 utilizatori am arde
// cota rapid. Asa ca il folosim DOAR pe rutele sensibile:
//   login, register, watch, scrieri admin.
// GET-urile publice (lista serii/episoade) nu trec pe aici.
//
// Limitare cunoscuta, acceptata: state-ul e in memorie. Daca DO-ul e
// evacuat, contoarele se reseteaza. Pentru anti-abuz e suficient; pentru
// garantie dura ar trebui storage persistent (care costa scrieri).
// =====================================================================

const CLEANUP_INTERVAL_MS = 60_000;

export class RateLimitDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.buckets = new Map(); // key -> number[] (timestamp-uri)
  }

  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: 'body invalid' }, { status: 400 });
    }

    const { key, limit = 10, windowMs = 60_000 } = body;
    if (typeof key !== 'string' || !key) {
      return Response.json({ ok: false, error: 'cheie invalida' }, { status: 400 });
    }

    const now = Date.now();
    const stamps = (this.buckets.get(key) || []).filter((t) => now - t < windowMs);

    if (stamps.length >= limit) {
      const retryAfter = Math.ceil((windowMs - (now - stamps[0])) / 1000);
      this.buckets.set(key, stamps);
      this.state.waitUntil(this.ensureCleanup());
      return Response.json({ ok: false, remaining: 0, retryAfter });
    }

    stamps.push(now);
    this.buckets.set(key, stamps);

    this.state.waitUntil(this.ensureCleanup());

    return Response.json({ ok: true, remaining: Math.max(0, limit - stamps.length), retryAfter: 0 });
  }

  /** Curata cheile expirate ca sa nu creasca memoria la infinit. */
  async ensureCleanup() {
    const last = this.lastCleanup || 0;
    const now = Date.now();
    if (now - last < CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;

    for (const [key, stamps] of this.buckets) {
      const fresh = stamps.filter((t) => now - t < 3_600_000);
      if (fresh.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, fresh);
    }
  }
}
