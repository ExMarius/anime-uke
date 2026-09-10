// =====================================================================
// Rate limiting prin RateLimitDO, cu sharding pe 32 de bucket-uri.
//
// De ce sharding: daca toate verificarile ar merge catre un singur DO,
// acela ar fi un gat de sticla si un singur punct de esec. Daca am face
// un DO per cheie, am avea mii de instante. 32 de sharduri e compromisul.
//
// A se folosi DOAR pe rute sensibile. Fiecare apel = 1 request DO
// (cota gratuita: 100.000/zi) + 1 subrequest din cele 50 permise.
// =====================================================================

const SHARDS = 32;

function shardFor(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % SHARDS;
}

/**
 * @returns {Promise<{ok:boolean, remaining:number, retryAfter:number}>}
 *          Daca DO-ul nu raspunde, permitem cererea (fail-open) — un
 *          rate limiter picat nu trebuie sa doboare tot site-ul.
 */
export async function checkRateLimit(env, key, limit, windowMs) {
  const allow = { ok: true, remaining: limit, retryAfter: 0 };
  if (!env.RATE_LIMIT) return allow;

  try {
    const id = env.RATE_LIMIT.idFromName(`rl-${shardFor(key)}`);
    const stub = env.RATE_LIMIT.get(id);
    const res = await stub.fetch('https://ratelimit.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, limit, windowMs }),
    });
    if (!res.ok) return allow;
    return await res.json();
  } catch (e) {
    console.error('rate limit esuat (fail-open):', e?.message || e);
    return allow;
  }
}

/** Raspuns standard 429. */
export function tooManyRequests(retryAfter = 60, message = 'Prea multe încercări. Încearcă mai târziu.') {
  return new Response(JSON.stringify({ error: message, retryAfter }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': String(retryAfter),
    },
  });
}
