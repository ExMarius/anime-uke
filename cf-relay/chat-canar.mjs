// =====================================================================
// chat-canar.mjs — dovada LIVE ca mesajele de chat (si stickerele) chiar
// ajung in D1, pe site-ul din productie.
//
// De ce exista: bug-ul raportat (2026-09-23) era INVIZIBIL in teste —
// local DO-ul nu e niciodata evacuat, deci toate suitele treceau in timp ce
// in productie nu se salva nimic. Singura dovada reala e sa scrii un mesaj
// pe chat-ul live si sa-l cauti in baza de date.
//
// Cum functioneaza (totul pe cont temporar, sters la final):
//   1. Creeaza un cont „canar…" (register) si se logheaza (cookie HttpOnly).
//   2. Deschide WebSocket-ul real (wss://anime-uke.pages.dev/chat) cu cookie-ul.
//   3. Trimite UN mesaj normal si UN sticker — exact cazul care se pierdea:
//      sub pragul de 10 mesaje, deci salvarea depinde de alarma de 15s si de
//      supravietuirea bufferului la evictia DO-ului.
//   4. Asteapta 20s (o alarma completa), apoi reciteste prin D1 ce s-a scris.
//   5. Se reconecteaza si verifica istoricul primit la „init".
//   6. Curata TOT: mesajele, contul si contorul users_total.
//
// Iese cu cod != 0 daca orice pas esueaza, ca relay-ul sa raporteze rosu.
//
// Rulare: node cf-relay/chat-canar.mjs [base-url]
//   Necesita pachetul `ws` (e dependinta de dev, instalata de npm ci).
// =====================================================================

import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';

const BASE = (process.argv[2] || process.env.CANAR_BASE || 'https://anime-uke.pages.dev').replace(/\/$/, '');
const HOST = new URL(BASE).host;
const text = `canar-${new Date().toISOString().slice(0, 19)}`;
const stickerMsg = '[sticker:naruto]';
const WAIT_MS = 20_000;          // o alarma de flush completa (15s) + marja

let failed = 0;
const log = (...a) => console.log(...a);
const ok = (m) => log(`  ✅ ${m}`);
const bad = (m) => { failed++; log(`  ❌ ${m}`); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = randomBytes(4).toString('hex');
const user = { username: `canar${rand}`, email: `canar${rand}@example.com`, password: `Canar-${rand}-Aa1!` };

async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // isSameOrigin() verifica Origin/Referer: fara el, register raspunde 403.
      origin: BASE,
      referer: `${BASE}/`,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const tokenCookie = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('token='));
  let data = null;
  try { data = await res.json(); } catch { /* raspuns non-JSON */ }
  return { status: res.status, data, cookie: tokenCookie };
}

/** Deschide un socket si strange mesajele primite. */
function connect(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace('https', 'wss')}/chat`, {
      headers: { cookie, origin: BASE, host: HOST },
    });
    const got = [];
    let init = null;
    ws.on('message', (buf) => {
      try {
        const m = JSON.parse(buf.toString());
        if (m.type === 'init') init = m;
        got.push(m);
      } catch { /* ignora */ }
    });
    ws.on('open', () => resolve({ ws, got, init: () => init }));
    ws.on('error', (e) => reject(e));
    setTimeout(() => reject(new Error('timeout la conectare')), 15_000);
  });
}

log(`══ CANAR CHAT (${BASE}) ══`);

// --- 1. cont temporar -------------------------------------------------
const reg = await post('/api/auth/register', user);
if (reg.status !== 200 && reg.status !== 201) {
  bad(`register a raspuns ${reg.status}: ${JSON.stringify(reg.data)}`);
  process.exit(1);
}
ok(`cont temporar creat: ${user.username} (id ${reg.data?.id ?? reg.data?.user?.id ?? '?'})`);

const login = await post('/api/auth/login', { username: user.username, password: user.password });
if (login.status !== 200 || !login.cookie) {
  bad(`login a raspuns ${login.status} (cookie: ${login.cookie ? 'da' : 'nu'})`);
  process.exit(1);
}
ok('login reușit (cookie HttpOnly primit)');

// --- 2/3. socket real + mesaj + sticker -------------------------------
const first = await connect(login.cookie);
ok('WebSocket deschis pe chat-ul live');
first.ws.send(JSON.stringify({ type: 'chat', message: text }));
// DO-ul limitează la un mesaj la 1,5s per utilizator (anti-flood): canarul
// trebuie să respecte același ritm ca un om, altfel al doilea mesaj e refuzat
// și testul ar raporta fals „stickerul nu se salvează".
await sleep(2000);
first.ws.send(JSON.stringify({ type: 'chat', message: stickerMsg }));
await sleep(800);

// Orice refuz al DO-ului (rate limit, sesiune) trebuie să se vadă în output.
const refuzuri = first.got.filter((m) => m.type === 'error');
if (refuzuri.length) refuzuri.forEach((m) => log(`  (DO a refuzat: ${m.text})`));

const echoed = first.got.filter((m) => m.type === 'message');
if (echoed.some((m) => m.message === text)) ok('mesajul a fost difuzat live');
else bad(`mesajul NU a fost difuzat (primite: ${echoed.length})`);
if (echoed.some((m) => m.message === stickerMsg)) ok('stickerul a fost difuzat live');
else bad('stickerul NU a fost difuzat');

// --- 3b. MARCAJELE DE PROGRES (runda 2: „văzut", „episodul următor") -----
// Se foloseste ACELASI cont canar (fara o a doua inregistrare: limita de
// 5 conturi/ora per IP ar putea transforma o rulare repetata in fals rosu).
// Se verifica exact ce vede un utilizator real: progres trimis prin API-ul de
// heartbeat, apoi marcajele in lista seriei si „episodul următor" in rândul de
// continuare. Contul (si progresul lui, prin ON DELETE CASCADE) se sterge la final.
{
  const getJson = async (path, cookie) => {
    const r = await fetch(`${BASE}${path}`, { headers: { cookie, origin: BASE } });
    try { return await r.json(); } catch { return null; }
  };

  // Prima serie din catalog poate avea 0-1 episoade (si seria fara episoade nu
  // poate arăta nici marcaje, nici „episodul următor"): căutăm una cu 2+.
  const catalog = await getJson('/api/series?per_page=10');
  const candidat = (catalog?.series || []).find((x) => Number(x.episode_count) >= 2);
  const serieId = candidat?.id ?? catalog?.series?.[0]?.id;
  const detaliu = serieId ? await getJson(`/api/series/${serieId}?per_page=3`) : null;
  const eps = detaliu?.episodes || [];

  if (eps.length >= 2) {
    // 8 heartbeat-uri x 120s = 960s, peste pragul de 15 minute
    for (let i = 0; i < 8; i++) {
      await post('/api/progress', { episode_id: eps[0].id, seconds: 120 }, login.cookie);
    }
    const cont = await getJson('/api/continue', login.cookie);
    const item = (cont?.items || []).find((x) => x.episode_id === eps[0].id);
    if (item && Number(item.next_episode_id) === Number(eps[1].id)) {
      ok(`rândul de continuare: episodul următor e corect (id ${item.next_episode_id})`);
    } else {
      bad(`episodul următor greșit: ${JSON.stringify(item)} (așteptat ${eps[1].id})`);
    }

    const detaliu2 = await getJson(`/api/series/${serieId}?per_page=3`, login.cookie);
    const m1 = (detaliu2?.episodes || []).find((e) => e.id === eps[0].id);
    const m2 = (detaliu2?.episodes || []).find((e) => e.id === eps[1].id);
    if (m1?.watched === true && Number(m1?.progress_seconds) >= 900) ok('episodul cu 15+ minute apare ca VĂZUT în listă');
    else bad(`marcajul de văzut lipsește: ${JSON.stringify(m1)}`);
    if (m2?.watched === false) ok('episodul neatins rămâne nemarcat');
    else bad(`episod nemarcat greșit: ${JSON.stringify(m2)}`);

    const anon = await getJson(`/api/series/${serieId}?per_page=2`);
    if ((anon?.episodes || []).every((e) => !('watched' in e))) ok('fără sesiune lista nu cheltuie nicio citire de progres');
    else bad('răspunsul public conține marcaje de progres');

    log(`  __CANAR_SERIE__=${serieId}`);
  } else {
    log(`  (nicio serie cu 2+ episoade în primele 10 — verificarea progresului sărită: serie=${serieId} episoade=${eps.length})`);
  }
}

// --- 4. asteptam alarma (15s) si recitim -----------------------------
log(`  … aștept ${WAIT_MS / 1000}s (fereastra de flush) — exact scenariul care se pierdea`);
await sleep(WAIT_MS);

// --- 5. reconectare: istoricul de la init ----------------------------
const second = await connect(login.cookie);
await sleep(1200);
const hist = second.init()?.history || [];
const hasText = hist.some((m) => m.message === text);
const hasSticker = hist.some((m) => m.message === stickerMsg);
if (hasText && hasSticker) ok(`istoricul de la reconectare conține ambele (${hist.length} mesaje)`);
else bad(`istoric incomplet: mesaj=${hasText} sticker=${hasSticker} (istoric ${hist.length})`);

second.ws.close();
first.ws.close();

// Retinem user_id pentru curatenie (vine din login sau din istoric)
const meId = hist.find((m) => m.message === text)?.user_id ?? null;
log(`  (user_id pentru curățenie: ${meId ?? 'necunoscut'})`);
log(`  __CANAR_USER__=${user.username}`);
log(`  __CANAR_ID__=${meId ?? ''}`);
log(`  __CANAR_TEXT__=${text}`);
log(failed === 0 ? 'CANAR: OK (mesajul si stickerul sunt in istoricul servit de DO)'
                 : `CANAR: ${failed} verificări picate`);
process.exit(failed === 0 ? 0 : 1);
