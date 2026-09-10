// =====================================================================
// Helper-e HTTP: raspunsuri JSON, cookie-uri de sesiune, header-e de
// securitate. Fara dependente externe.
// =====================================================================

export const COOKIE_NAME = 'token';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 zile, identic cu TTL-ul JWT

/**
 * CSP strict FARA 'unsafe-inline': tot JS-ul e in fisiere externe,
 * deci nu e nevoie sa permitem scripturi inline (v1 avea inline peste tot).
 * frame-src include domeniile DoodStream, care se rotesc — fara ele
 * playerul se sparge.
 */
export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' wss:",
    "frame-src 'self' https://doodstream.com https://*.doodstream.com https://dood.so https://*.dood.so https://dood.wf https://*.dood.wf https://dood.re https://*.dood.re https://dood.pm https://*.dood.pm https://doodstream.co https://*.doodstream.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

export function errorResponse(status, message, headers = {}) {
  return json({ error: message }, { status, headers });
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/**
 * SameSite=Lax: blocheaza trimiterea cookie-ului la POST cross-site
 * (deci protejeaza de CSRF) dar permite navigarea top-level GET.
 */
export function setAuthCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

export function clearAuthCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** IP-ul clientului, din header-ele Cloudflare (de incredere in fata Worker-ului). */
export function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Aparare suplimentara impotriva CSRF pentru cereri care modifica date:
 * Origin/Referer trebuie sa fie acelasi host. Cu SameSite=Lax e redundant,
// dar costa zero si acopera cazurile in care cookie-ul ar fi setat altfel.
 */
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  const host = new URL(request.url).host;
  if (origin) return new URL(origin).host === host;
  if (referer) return new URL(referer).host === host;
  return true; // cereri fara Origin (ex. navigare, curl) — SameSite oricum protejeaza
}

/** Curata un string de control chars si il limiteaza la maxLength. */
export function sanitizeText(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}
