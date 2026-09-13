// =====================================================================
// Plafonul comunității — misiunea e buget 0.
//
// Site-ul ruleze exclusiv pe servicii Cloudflare gratuite, deci creșterea
// trebuie să fie o decizie, nu un accident. Acestea sunt tavanile care
// garantăm că nu le depășim:
//
//   LIMIT_USERS   — maxim 1000 de conturi. Protejează cota de scrieri D1
//                   (100k/zi) și spațiul (500 MB pe planul gratuit).
//   LIMIT_SERIES  — maxim 1000 de anime-uri în catalog. Fiecare serie
//                   trage după ea episoade, surse, ratinguri și comentarii.
//
// Ambele se pot depăși doar explicit: variabilele LIMIT_USERS / LIMIT_SERIES
// din configurarea Pages cresc tavanul când ownerul decide asta (un plan
// plătit, sau pur și simplu un tavan mai mare). În teste, tavanul coboară
// prin aceleași variabile ca să simulăm „comunitatea plină" ieftin.
// =====================================================================

export const DEFAULT_LIMIT_USERS = 1000;
export const DEFAULT_LIMIT_SERIES = 1000;

/** Citește un tavan din env; căde pe implicit dacă lipsește ori e invalid. */
export function resolveLimit(env, key, dflt) {
  const raw = Number(env?.[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : dflt;
}

export const usersFullMessage = (n) =>
  `Comunitatea e plină: s-a atins limita de ${n} de conturi. Înscrierile se redeschid când se eliberează un loc.`;

export const seriesFullMessage = (n) =>
  `S-a atins limita de ${n} de anime-uri în catalog. Șterge o serie sau crește limita din setări.`;
