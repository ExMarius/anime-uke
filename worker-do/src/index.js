// =====================================================================
// anime-uke-do — Worker dedicat pentru Durable Objects.
//
// De ce exista separat?
//   Cloudflare Pages NU poate gazdui clase Durable Object in productie
//   (docs, actualizat iunie 2026: "You cannot create and deploy a
//   Durable Object within a Pages project"). Advanced Mode functioneaza
//   doar local, in miniflare — de aceea testele e2e trec dar deploy-ul
//   pe Pages esueaza la validarea configului.
//
//   Solutia oficiala: DO-urile traiesc intr-un Worker propriu, iar
//   proiectul Pages le leaga prin `script_name = "anime-uke-do"`.
//
// Traficul real nu trece prin fetch-ul de mai jos: Pages face
// `env.CHAT.get(id).fetch(request)` direct pe binding, iar WebSocket-urile
// raman atasate de DO dupa upgrade.
// =====================================================================

export { ChatDO } from '../../src/do/ChatDO.js';
export { RateLimitDO } from '../../src/do/RateLimitDO.js';
export { StatsDO } from '../../src/do/StatsDO.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Permite apelarea directa a DO-ului (folositor la debug pe workers.dev)
    if (url.pathname === '/chat' || url.pathname === '/chat/state') {
      return env.CHAT.get(env.CHAT.idFromName('global-chat')).fetch(request);
    }
    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, worker: 'anime-uke-do' });
    }

    return new Response('anime-uke — worker Durable Objects\n', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
