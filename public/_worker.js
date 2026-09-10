// =====================================================================
// ENTRYPOINT — Cloudflare Pages "Advanced Mode".
//
// Acest fisier inlocuieste directorul functions/. E necesar pentru ca
// Pages Functions nu poate exporta clase Durable Object (testat cu
// wrangler 3 si 4: "not exported in your entrypoint file").
//
// Aici exportam:
//   - cele 3 clase Durable Object (CHAT, RATE_LIMIT, STATS)
//   - handlerul default de fetch, care ruteaza API-ul si serveste static
// =====================================================================

export { ChatDO } from '../src/do/ChatDO.js';
export { RateLimitDO } from '../src/do/RateLimitDO.js';
export { StatsDO } from '../src/do/StatsDO.js';

import { handleFetch } from '../src/worker.js';

export default {
  fetch: handleFetch,
};
