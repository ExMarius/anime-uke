// =====================================================================
// poll-buget.mjs — poll-ul adaptiv din core.js, fără server.
//
// De ce există: un setInterval fix pe clopoțel (60 s) și pe „N online”
// (90 s) golește cota de 100.000 de invocări/zi cu tab-uri uitate deschise.
// nextPollDelay e funcția pură a bugetului; adaptivePoll e cablajul
// (tab ascuns, inactivitate, backoff, stop). Ceasul și timerele sunt
// controlate, deci suita nu așteaptă minute și nu e flaky.
//
// Rulează: node tests/poll-buget.mjs
// =====================================================================
import { JSDOM } from 'jsdom';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

function instaleaza() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><nav id="nav"></nav></body></html>', {
    url: 'https://test.local/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  window.HTMLCanvasElement.prototype.getContext = () => null;
  // jsdom pornește cu visibilityState=prerender, deci hidden=true. În browser
  // pagina vizibilă are hidden=false — de acolo pornesc testele.
  let hidden = false;
  Object.defineProperty(window.document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  return {
    setHidden(v) {
      hidden = v;
      window.document.dispatchEvent(new window.Event('visibilitychange'));
    },
  };
}

const vis = instaleaza();
const core = await import('../public/assets/js/core.js');

console.log('=== POLL ADAPTIV (buget 0) ===');

{
  const { nextPollDelay, POLL_BELL_MS, POLL_MAX_MS, POLL_IDLE_MS, POLL_PULSE_MS } = core;
  check('prima privire e la intervalul de bază (60 s)', nextPollDelay(0, 0) === POLL_BELL_MS, String(nextPollDelay(0, 0)));
  check('liniștea dublează pasul (120 s)', nextPollDelay(1, 0) === POLL_BELL_MS * 2);
  check('al doilea pas de liniște (240 s)', nextPollDelay(2, 0) === POLL_BELL_MS * 4);
  check('plafonul e 5 minute, nu crește la nesfârșit', nextPollDelay(9, 0) === POLL_MAX_MS, String(nextPollDelay(9, 0)));
  check('tab inactiv de 10 minute: nu se programează nimic', nextPollDelay(0, POLL_IDLE_MS) === 0);
  check('o milisecundă înainte de inactivitate încă se programează', nextPollDelay(0, POLL_IDLE_MS - 1) === POLL_BELL_MS);
  check('pulse (90 s) respectă același plafon', nextPollDelay(3, 0, POLL_PULSE_MS) === POLL_MAX_MS);
  check('unchanged invalid se tratează ca 0', nextPollDelay(undefined, 0) === POLL_BELL_MS && nextPollDelay(-3, 0) === POLL_BELL_MS);
  check('constantele sunt cele din buget',
    POLL_BELL_MS === 60_000 && POLL_PULSE_MS === 90_000 && POLL_MAX_MS === 300_000 && POLL_IDLE_MS === 600_000);
}

{
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  const timers = [];
  const realST = globalThis.setTimeout;
  const realCT = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => {
    const id = timers.length + 1;
    timers.push({ id, fn, ms, cleared: false });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    const t = timers.find((x) => x.id === id);
    if (t) t.cleared = true;
  };
  const due = () => timers.filter((t) => !t.cleared);
  async function fireNext() {
    const t = due()[0];
    if (!t) return null;
    t.cleared = true;
    await t.fn();
    return t;
  }

  let calls = 0;
  let changed = false;
  const h = core.adaptivePoll(async () => { calls++; return changed; }, {
    base: 1000, max: 8000, idleAfter: 10_000, minGap: 500, runNow: false,
  });
  await Promise.resolve();
  check('runNow:false nu cere imediat', calls === 0, `calls=${calls}`);
  check('programează pasul de bază', due().length === 1 && due()[0].ms === 1000, `ms=${due()[0]?.ms} n=${due().length}`);

  await fireNext();
  check('prima rulare a cerut o dată', calls === 1, `calls=${calls}`);
  check('după liniște pasul se dublează', due().length === 1 && due()[0].ms === 2000, `ms=${due()[0]?.ms}`);

  changed = true;
  await fireNext();
  check('o schimbare readuce pasul scurt', due().length === 1 && due()[0].ms === 1000, `ms=${due()[0]?.ms}`);
  changed = false;

  vis.setHidden(true);
  const inainteAscuns = calls;
  await fireNext();
  check('tab ascuns: nicio cerere și niciun timer nou', calls === inainteAscuns && due().length === 0,
    `calls=${calls} timers=${due().length}`);

  now += 600;
  vis.setHidden(false);
  await Promise.resolve();
  await Promise.resolve();
  check('revenirea în tab cere o dată', calls === inainteAscuns + 1, `calls=${calls}`);

  now += 10_000;
  await fireNext();
  check('după 10 minute fără activitate nu se mai programează', due().length === 0, `n=${due().length}`);

  now += 600;
  const inainteIdle = calls;
  document.dispatchEvent(new window.Event('pointerdown'));
  await Promise.resolve();
  await Promise.resolve();
  check('mișcarea după inactivitate cere imediat', calls === inainteIdle + 1, `calls=${calls}`);

  const inainteScroll = calls;
  now += 50;
  document.dispatchEvent(new window.Event('pointerdown'));
  document.dispatchEvent(new window.Event('scroll', { bubbles: true }));
  await Promise.resolve();
  check('scroll/click cât ești activ nu fac cereri în plus', calls === inainteScroll, `calls=${calls}`);

  h.stop();
  const dupaStop = calls;
  await fireNext();
  check('stop() nu mai cere, chiar dacă timerul vechi se declanșează', calls === dupaStop, `calls=${calls}`);

  // runNow: cererea imediată nu trebuie să sară peste pasul de bază.
  let c2 = 0;
  const h2 = core.adaptivePoll(async () => { c2++; return false; }, {
    base: 1000, max: 8000, idleAfter: 99_000, minGap: 500, runNow: true,
  });
  await Promise.resolve();
  await Promise.resolve();
  check('runNow cere imediat', c2 === 1, `calls=${c2}`);
  check('după cererea imediată, primul interval rămâne baza (nu dublul)',
    due().some((t) => t.ms === 1000) && !due().some((t) => t.ms === 2000),
    due().map((t) => t.ms).join(','));
  h2.stop();

  Date.now = realNow;
  globalThis.setTimeout = realST;
  globalThis.clearTimeout = realCT;
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} trecute, ${failed} picate`);
process.exit(failed ? 1 : 0);
