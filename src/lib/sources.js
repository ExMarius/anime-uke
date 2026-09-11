// =====================================================================
// Surse video pentru episoade.
//
// Un episod poate avea mai multe surse (embed DoodStream, alt embed,
// fisier .mp4 direct, link extern). Acest modul e SINGURA sursa de
// adevar pentru: tipuri permise, validarea URL-urilor si lista de
// furnizori sugerati in panoul de admin.
//
// DESPRE CSP-UL DE iframe-uri
// ---------------------------
// Domeniile de embed pentru anime se rotesc constant (DoodStream singur
// a trecut prin dood.so, dood.wf, dood.re, dood.pm, ds2play…). Un
// allowlist fix in Content-Security-Policy ar fi spart playerul in
// fiecare saptamana si ar fi cerut un deploy ca sa adaugi un domeniu.
//
// De aceea frame-src permite orice https:, NU orice sursa. Raman blocate
// javascript:, data: si blob: in iframe — adica exact vectorii prin care
// un URL rau ar putea executa cod in pagina noastra.
//
// Riscul rezidual e acceptabil pentru ca:
//   1. doar adminii pot adauga surse (requireAdmin + verificare de origine),
//   2. site-ul e privat, pe baza de coduri de invitatie,
//   3. iframe-ul ruleaza cu sandbox, deci nu ne poate naviga pagina,
//   4. fiecare adaugare/modificare e consemnata in audit (admin_log).
// =====================================================================

export const SOURCE_KINDS = ['embed', 'file', 'link'];

export const KIND_LABELS = {
  embed: 'Embed (iframe)',
  file: 'Fișier video (.mp4/.webm)',
  link: 'Link extern',
};

// Extensii pe care <video> le poate reda nativ in browser.
// .m3u8 e acceptat la validare, dar Chrome/Firefox nu-l redau fara un
// player HLS — de asta e marcat explicit in UI.
const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v|m3u8)(\?.*)?$/i;

// Sugerate in panoul de admin ca etichete rapide. Nu e o restrictie —
// orice domeniu https trece, ca sa nu fie nevoie de deploy pentru un
// furnizor nou.
export const KNOWN_PROVIDERS = [
  { label: 'DoodStream', hint: 'https://doodstream.com/e/…' },
  { label: 'VidStreaming', hint: 'https://vidstreaming.com/streaming.php?id=…' },
  { label: 'StreamTape', hint: 'https://streamtape.com/e/…' },
  { label: 'Mp4Upload', hint: 'https://www.mp4upload.com/embed-…html' },
  { label: 'Filemoon', hint: 'https://filemoon.sx/e/…' },
  { label: 'MixDrop', hint: 'https://mixdrop.co/e/…' },
  { label: 'Upstream', hint: 'https://upstream.to/embed-…html' },
  { label: 'YouTube', hint: 'https://www.youtube.com/embed/…' },
  { label: 'Fișier MP4', hint: 'https://…/episod.mp4' },
];

/**
 * Insereaza corect o eticheta in interiorul unei chei JSON sau al unui
 * string — folosita doar pentru mesaje de eroare, nu pentru HTML.
 */
function hostOf(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * DoodStream: link-ul de download (/d/xxx) nu e embed-abil; il normalizam
 * la /e/xxx. Restul furnizorilor sunt lasati asa cum i-a dat adminul.
 */
function normalizeDoodstream(url) {
  const host = url.hostname.toLowerCase();
  const isDood = /(^|\.)dood(stream)?\.[a-z]+$/.test(host) || /(^|\.)dood\.[a-z]{2,}$/.test(host);
  if (!isDood) return url;
  const m = url.pathname.match(/^\/[ed]\/([A-Za-z0-9]+)$/);
  if (m) url.pathname = `/e/${m[1]}`;
  return url;
}

/**
 * Valideaza o sursa video.
 * @returns {{ok:true,value:{label:string,kind:string,url:string}}|{ok:false,error:string}}
 */
export function validateSource(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Sursă invalidă' };

  const kind = String(input.kind || 'embed').trim().toLowerCase();
  if (!SOURCE_KINDS.includes(kind)) {
    return { ok: false, error: 'Tip de sursă necunoscut (embed / file / link)' };
  }

  const raw = typeof input.url === 'string' ? input.url.trim() : '';
  if (!raw) return { ok: false, error: 'URL-ul sursei este obligatoriu' };
  if (raw.length > 800) return { ok: false, error: 'URL prea lung (max 800 caractere)' };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'URL invalid' };
  }

  // Doar https. http: ar fi blocat oricum de mixed-content, iar
  // javascript:/data: sunt vectori de XSS.
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'URL-ul trebuie să fie https' };
  }

  if (kind === 'file' && !VIDEO_EXT.test(url.pathname + url.search)) {
    return {
      ok: false,
      error: 'Pentru tipul „fișier video” URL-ul trebuie să se termine în .mp4, .webm, .ogv sau .m3u8',
    };
  }

  url = normalizeDoodstream(url);

  let label = typeof input.label === 'string' ? input.label.trim().replace(/\s+/g, ' ') : '';
  if (label.length > 40) label = label.slice(0, 40).trim();
  // Fara eticheta, derivam una din domeniu — mai util decat „Sursă".
  if (!label) label = hostOf(url.toString()) || 'Sursă';

  return { ok: true, value: { label, kind, url: url.toString() } };
}

/** Valideaza o lista intreaga de surse (max 12 per episod). */
export function validateSourceList(input) {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'Sursele trebuie date ca listă' };
  if (input.length > 12) return { ok: false, error: 'Maximum 12 surse per episod' };

  const seen = new Set();
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const v = validateSource(input[i]);
    if (!v.ok) return { ok: false, error: `Sursa ${i + 1}: ${v.error}` };
    if (seen.has(v.value.url)) return { ok: false, error: `Sursa ${i + 1}: URL-ul e deja în listă` };
    seen.add(v.value.url);
    out.push({ ...v.value, sort_order: i });
  }
  return { ok: true, value: out };
}
