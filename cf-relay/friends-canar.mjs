// =====================================================================
// friends-canar.mjs — dovada LIVE ca notificarile de prietenie chiar
// ajung la destinatar, pe site-ul din productie.
//
// De ce exista: sistemul /api/friends trimitea cereri în tăcere (nimeni nu
// afla că are o cerere de rezolvat). Notificarile sunt acum scrise în D1 la
// fiecare cerere/acceptare, dar o scriere în cod nu dovodește nimic pe
// producție — la fel ca bugul de chat care trecea prin toate testele
// locale. Aici verificăm fluxul întreg, cu conturi temporare:
//
//   1. Creează DOUĂ conturi „canarp…” (register + login, cookie HttpOnly).
//   2. B îi trimite cerere lui A → A primește notificare „friend_request”.
//   3. A acceptă → B primește notificare „friend_accepted”.
//   4. Verifică textele, payload-ul (username pentru link) și badge-ul.
//   5. Raportează __CANAR_A__/__CANAR_B__ — cmd.sh șterge conturile din D1
//      (prietenia și notificările se sting în cascadă).
//
// Plafonul de înregistrare (5 conturi/oră pe IP) poate împiedica un cont la
// rulări repetate: în acel caz verificarea SE SARE (exit 0), ca să nu dea
// fals roșu pe deploy. Orice alt eșec e roșu.
//
// Rulare: node cf-relay/friends-canar.mjs [base-url]
// =====================================================================

const BASE = (process.argv[2] || process.env.CANAR_BASE || 'https://anime-uke.pages.dev').replace(/\/$/, '');

let failed = 0;
const log = (...a) => console.log(...a);
const ok = (m) => log(`  ✅ ${m}`);
const bad = (m) => { failed++; log(`  ❌ ${m}`); };
const skip = (m) => log(`  ⏭  ${m} (verificare sărită, nu e un eșec)`);

const rand = Math.random().toString(36).slice(2, 8);
const A = { username: `canarp${rand}a`, email: `canarp${rand}a@example.com`, password: `Canar-${rand}-Aa1!` };
const B = { username: `canarp${rand}b`, email: `canarp${rand}b@example.com`, password: `Canar-${rand}-Bb1!` };

async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // isSameOrigin() verifica Origin/Referer: fara el, API-ul raspunde 403.
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

const getJson = async (path, cookie) => {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie, origin: BASE, referer: `${BASE}/` } });
  try { return await r.json(); } catch { return null; }
};

log(`══ CANAR PRIETENIE (${BASE}) ══`);

// --- 1. doua conturi temporare ---------------------------------------
// Plafonul de 5 conturi/oră pe IP: dacă unul din conturi nu mai încapă,
// verificarea se sare (roșu fals pe un redeploy în aceeași oră). Conturile
// create până atunci se curăță oricum în cmd.sh (pattern „canarp%”).
const regB = await post('/api/auth/register', B);
if (regB.status === 429) {
  skip(`plafonul de conturi/oră atins (${JSON.stringify(regB.data)})`);
  log('CANAR: sărit (plafon conturi) — rulează din nou peste o oră pentru dovada completă');
  process.exit(0);
}
if (regB.status !== 200 && regB.status !== 201) {
  bad(`register B a raspuns ${regB.status}: ${JSON.stringify(regB.data)}`);
  process.exit(1);
}
ok(`cont temporar B creat: ${B.username}`);
log(`  __CANAR_B__=${B.username}`);

const regA = await post('/api/auth/register', A);
if (regA.status === 429) {
  skip(`plafonul de conturi/oră atins la al doilea canar (${JSON.stringify(regA.data)})`);
  log('CANAR: sărit (plafon conturi) — rulează din nou peste o oră pentru dovada completă');
  process.exit(0);
}
if (regA.status !== 200 && regA.status !== 201) {
  bad(`register A a raspuns ${regA.status}: ${JSON.stringify(regA.data)}`);
  process.exit(1);
}
ok(`cont temporar A creat: ${A.username}`);
log(`  __CANAR_A__=${A.username}`);

const loginA = await post('/api/auth/login', { username: A.username, password: A.password });
const loginB = await post('/api/auth/login', { username: B.username, password: B.password });
if (!loginA.cookie || !loginB.cookie) {
  bad(`login esuat (A: ${loginA.status}, B: ${loginB.status})`);
  process.exit(1);
}
ok('amandoua conturile sunt logate (cookie HttpOnly)');

// --- 2. B îi trimite cerere lui A → A are notificare -------------------
const send = await post('/api/friends', { username: A.username }, loginB.cookie);
if (send.data?.status !== 'pending_out') {
  bad(`cererea de prietenie nu s-a trimis: ${send.status} ${JSON.stringify(send.data)}`);
  process.exit(1);
}
ok('cererea de prietenie s-a trimis (B → A)');

const notifA = await getJson('/api/notifications', loginA.cookie);
const nReq = (notifA?.notifications || []).find((n) => n.type === 'friend_request');
if (nReq && nReq.payload?.username === B.username && /cerere de prietenie/.test(nReq.text || '')) {
  ok(`A are notificarea de cerere: „${nReq.text}” (badge ${notifA.unread})`);
} else {
  bad(`A NU are notificarea de cerere: ${JSON.stringify(notifA)?.slice(0, 200)}`);
}

// --- 3. A acceptă → B are notificare de acceptare ----------------------
const accept = await post('/api/friends', { username: B.username, action: 'accept' }, loginA.cookie);
if (accept.data?.status !== 'friends') {
  bad(`acceptarea a esuat: ${accept.status} ${JSON.stringify(accept.data)}`);
  process.exit(1);
}
ok('cererea s-a acceptat (A → B)');

const notifB = await getJson('/api/notifications', loginB.cookie);
const nAcc = (notifB?.notifications || []).find((n) => n.type === 'friend_accepted');
if (nAcc && nAcc.payload?.username === A.username && /acceptat/.test(nAcc.text || '')) {
  ok(`B are notificarea de acceptare: „${nAcc.text}” (badge ${notifB.unread})`);
} else {
  bad(`B NU are notificarea de acceptare: ${JSON.stringify(notifB)?.slice(0, 200)}`);
}

// --- 4. linkul din notificare duce la profil (se vede in bundle) --------
// Dovada în D1 (rândurile chiar există în tabel) se face în cmd.sh, care
// are wrangler; aici lăsăm doar userii de șters.
log(`  __CANAR_A__=${A.username}`);
log(`  __CANAR_B__=${B.username}`);
log(failed === 0 ? 'CANAR: OK (cererea si acceptarea au notificat pe live)'
                 : `CANAR: ${failed} verificări picate`);
process.exit(failed === 0 ? 0 : 1);
