// =====================================================================
// anim-bg.js — fundaluri ANIMATE cu particule (<canvas>) pentru temele
// de site pe baza de canvas: frunze/petale care cad, bule care urca,
// stele care clipesc.
//
// Cum functioneaza:
//   - tema activa e o clasa pe <body> (theme-sunset, theme-petale, ...);
//     un MutationObserver porneste/opreste animatia cand se schimba clasa
//     (inclusiv la previzualizarea de 5s din shop — vezi animatia live
//     inainte sa cumperi).
//   - canvas-ul e transparent si sta FIX sub continut (z-index: -1):
//     gradientul de dedesubt vine din CSS, particulele din JS.
//   - NU respecta prefers-reduced-motion: o tema animata cumparata si activata
//     explicit = consimtamant pentru miscare (temele statice raman alternativa).
//
// CUM MODIFICI PARAMETRII (pe tema, in tabelul ANIMS de mai jos):
//   - numarul de elemente: campul `numar`
//   - viteza: constantele din functiile update (ex: p.viteza = 1 + ...)
//   - culorile: `culori`/`margine` la petale, `lumina`/`baza` la bule
//
// Reguli de performanta: requestAnimationFrame (niciodata setInterval),
// sprite-uri pre-randate (fara gradienti pe frame), pauza cand tab-ul e
// ascuns, DPR limitat la 2, elementele iesite din ecran se RECICLEAZA.
// =====================================================================

// --- Configuratia temelor animate (slug = clasa body fara "theme-") ---
const ANIMS = {
  // Frunze de toamna care cad leganandu-se (portocaliu/rosu/galben).
  sunset:     { tip: 'petale', numar: 40, culori: ['#ff6b35', '#e85d04', '#faa307', '#d00000', '#ffba08'], margine: '#7c2d12' },
  // Petale de sakura: fundal mov→roz (din CSS), petale roz cu margini.
  petale:     { tip: 'petale', numar: 40, culori: ['#ffc0cb', '#ffb7c5', '#ffe4ec', '#f9a8d4'], margine: '#ff69b4' },
  // Bule portocalii care urca (ca in suc/sampanie), fundal ars (din CSS).
  portocaliu: { tip: 'bule', numar: 60, lumina: '255,179,71', baza: '255,140,0' },
  // Bule de aer albastre + raze de lumina din coltul de sus.
  ocean:      { tip: 'bule', numar: 30, lumina: '186,230,253', baza: '56,189,248', raze: true },
  // Cer instelat: 200 de stele care clipesc + deriv lent (benzile de
  // lumina de dedesubt vin din CSS, animatia theme-aurora-drift).
  aurora:     { tip: 'stele', numar: 200 },
  // --- Teme de SEZON (doar din admin, globale; nu sunt in shop) ---
  // Noapte de Halloween: scantei portocalii care urca pe mov aproape negru.
  halloween:  { tip: 'bule', numar: 50, lumina: '255,150,50', baza: '255,60,0' },
  // Iarna: fulgi de nea care cad lin pe noapte albastra.
  iarna:      { tip: 'fulgi', numar: 80 },
  // Paste: petale pastelate de primavara.
  paste:      { tip: 'petale', numar: 40, culori: ['#ffd6e8', '#fff3b0', '#d8f3dc', '#e4c1f9', '#caffbf'], margine: '#b5838d' },
};

let canvas = null;   // elementul <canvas> fullscreen (unic, refolosit)
let ctx = null;      // contextul 2D
let slugCurent = null; // ce tema animata ruleaza acum (null = oprit)
let cadru = 0;       // id-ul requestAnimationFrame (0 = oprit)
let particule = [];  // petalele/bulele/spatii... pardon — elementele vii
let latime = 0;      // dimensiuni logice (px CSS)
let inaltime = 0;
let timpAnterior = 0;

/** Creeaza canvas-ul (o singura data), transparent, sub continut. */
function asiguraCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'anim-bg';
  canvas.setAttribute('aria-hidden', 'true');
  // Stiluri inline ca sa nu depindem de CSS (si de purge-ul lui).
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;'
    + 'z-index:-1;pointer-events:none;';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); canvas = null; return; } // canvas blocat — ramane gradientul
  redimensioneaza();
  window.addEventListener('resize', redimensioneaza);
}

/** Ajusteaza canvas-ul la fereastra (cu devicePixelRatio, max 2). */
function redimensioneaza() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  latime = window.innerWidth;
  inaltime = window.innerHeight;
  canvas.width = Math.round(latime * dpr);
  canvas.height = Math.round(inaltime * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// --- Sprite-uri pre-randate: desenam o data intr-un canvas mic, apoi
// doar copiem (drawImage) pe frame. Asa tinem 60fps si pe telefon. -----

/** Sprite de petala/frunza: elipsa + margine + nervura. */
function spritePetala(marime, culoare, margine) {
  const s = document.createElement('canvas');
  const r = Math.ceil(marime * 2 + 4);
  s.width = r * 2;
  s.height = r * 2;
  const c = s.getContext('2d');
  c.translate(r, r);
  c.beginPath();
  c.ellipse(0, 0, marime, marime * 0.62, 0, 0, Math.PI * 2);
  c.fillStyle = culoare;
  c.globalAlpha = 0.85;
  c.fill();
  c.globalAlpha = 1;
  c.lineWidth = 1.5;
  c.strokeStyle = margine;
  c.stroke();
  // Nervura din mijloc, subtila.
  c.beginPath();
  c.moveTo(-marime * 0.8, 0);
  c.lineTo(marime * 0.8, 0);
  c.lineWidth = 1;
  c.globalAlpha = 0.5;
  c.stroke();
  return s;
}

/** Sprite de bula: gradient radial 3D + reflexie alba (sticla). */
function spriteBula(raza, lumina, baza) {
  const s = document.createElement('canvas');
  s.width = s.height = Math.ceil(raza * 2 + 4);
  const c = s.getContext('2d');
  const cx = s.width / 2;
  const cy = s.height / 2;
  // Corpul bulei: luminos in stanga-sus, transparent pe margine.
  const g = c.createRadialGradient(cx - raza * 0.3, cy - raza * 0.3, 0, cx, cy, raza);
  g.addColorStop(0, `rgba(${lumina},0.9)`);
  g.addColorStop(0.35, `rgba(${lumina},0.55)`);
  g.addColorStop(0.8, `rgba(${baza},0.25)`);
  g.addColorStop(1, `rgba(${baza},0.05)`);
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, raza, 0, Math.PI * 2);
  c.fill();
  // Reflexia de sticla: punct alb in coltul stanga-sus.
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.beginPath();
  c.ellipse(cx - raza * 0.35, cy - raza * 0.38, raza * 0.22, raza * 0.14, -0.5, 0, Math.PI * 2);
  c.fill();
  return s;
}

/** Sprite de fulg de nea: disc alb luminos + scanteie in cruce (gheata). */
function spriteFulg(marime) {
  const s = document.createElement('canvas');
  const r = Math.ceil(marime * 2 + 4);
  s.width = s.height = r * 2;
  const c = s.getContext('2d');
  const g = c.createRadialGradient(r, r, 0, r, r, marime);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(240,248,255,0.85)');
  g.addColorStop(1, 'rgba(240,248,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(r, r, marime, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(r - marime, r);
  c.lineTo(r + marime, r);
  c.moveTo(r, r - marime);
  c.lineTo(r, r + marime);
  c.stroke();
  return s;
}

// --- Fabrici de particule (fiecare cu reset() pentru reciclare) --------

/** Petala: cade in jos, se leagana pe X (vant) si se roteste. */
function petalaNoua(cfg) {
  const p = {
    img: null,
    x: 0, y: 0,
    marime: 8 + Math.random() * 12,      // 8-20px (ca in cerinta)
    viteza: 1 + Math.random() * 2,       // 1-3 px/frame la 60fps
    unghi: Math.random() * Math.PI * 2,  // rotatie 0-360°
    rotatie: 0.01 + Math.random() * 0.03,
    vant: Math.random() * Math.PI * 2,   // faza oscilatiei
    vantViteza: 0.01 + Math.random() * 0.02,
    alfa: 0.6 + Math.random() * 0.4,     // opacitate 0.6-1.0
    reset(deSus) {
      this.x = Math.random() * latime;
      // La pornire le imprastiem pe tot ecranul, apoi reciclam sus.
      this.y = deSus ? -20 : Math.random() * inaltime;
    },
  };
  const culoare = cfg.culori[(Math.random() * cfg.culori.length) | 0];
  p.img = spritePetala(p.marime, culoare, cfg.margine);
  p.reset(false);
  return p;
}

/** Bula: urca de jos in sus cu clipsire usoara pe X. */
function bulaNoua(cfg) {
  const p = {
    img: null,
    x: 0, y: 0,
    raza: 5 + Math.random() * 35,        // 5-40px
    viteza: 0.5 + Math.random() * 1.5,   // 0.5-2 px/frame in sus
    vant: Math.random() * Math.PI * 2,
    vantViteza: 0.01 + Math.random() * 0.03,
    alfa: 0.3 + Math.random() * 0.4,     // opacitate 0.3-0.7
    reset(deJos) {
      this.x = Math.random() * latime;
      this.y = deJos ? inaltime + this.raza + 10 : Math.random() * inaltime;
    },
  };
  p.img = spriteBula(p.raza, cfg.lumina, cfg.baza);
  p.reset(false);
  return p;
}

/** Fulg: cade lent, aproape fara rotatie, cu leganare fina. Are aceeasi
 *  forma ca petala (img, viteza, vant...), deci impart bucla de desenare. */
function fulgNou() {
  const p = {
    img: null,
    x: 0, y: 0,
    marime: 3 + Math.random() * 5,       // 3-8px
    viteza: 0.5 + Math.random() * 1,     // 0.5-1.5 px/frame in jos
    unghi: Math.random() * Math.PI * 2,
    rotatie: 0.002 + Math.random() * 0.008,
    vant: Math.random() * Math.PI * 2,
    vantViteza: 0.005 + Math.random() * 0.015,
    alfa: 0.5 + Math.random() * 0.5,     // opacitate 0.5-1.0
    reset(deSus) {
      this.x = Math.random() * latime;
      this.y = deSus ? -10 : Math.random() * inaltime;
    },
  };
  p.img = spriteFulg(p.marime);
  p.reset(false);
  return p;
}

/** Stea: clipeste (opacitate pulsanta) si aluneca lent. */
function steaNoua() {
  const s = {
    x: Math.random() * latime,
    y: Math.random() * inaltime,
    raza: Math.random() < 0.85 ? 1 : 2,  // majoritatea de 1px
    faza: Math.random() * Math.PI * 2,
    vitezaClipire: 0.02 + Math.random() * 0.05,
    deriva: 0.05 + Math.random() * 0.15,  // px/frame spre stanga
  };
  return s;
}

// --- Bucla de animatie --------------------------------------------------

/** Deseneaza razele de lumina din ocean (3 benzi translucide). */
function deseneazaRaze() {
  ctx.save();
  ctx.translate(latime * 0.72, -inaltime * 0.1);
  ctx.rotate(0.42);
  ctx.fillStyle = 'rgba(186,230,253,0.06)';
  ctx.fillRect(0, 0, 90, inaltime * 1.6);
  ctx.fillStyle = 'rgba(186,230,253,0.045)';
  ctx.fillRect(150, 0, 150, inaltime * 1.6);
  ctx.fillStyle = 'rgba(186,230,253,0.06)';
  ctx.fillRect(360, 0, 60, inaltime * 1.6);
  ctx.restore();
}

/** Un frame: muta + deseneaza toate particulele, apoi cere urmatorul. */
function frame(timp) {
  if (!slugCurent) return; // opriti intre timp
  // Normalizare pe frame-uri de 60fps (ecranele de 120Hz n-ar dubla viteza).
  const f = Math.min((timp - timpAnterior) / 16.667, 4) || 1;
  timpAnterior = timp;
  const cfg = ANIMS[slugCurent];
  ctx.clearRect(0, 0, latime, inaltime);

  if (cfg.raze) deseneazaRaze();

  if (cfg.tip === 'stele') {
    for (const s of particule) {
      s.faza += s.vitezaClipire * f;
      s.x -= s.deriva * f;
      if (s.x < -4) { s.x = latime + 4; s.y = Math.random() * inaltime; }
      ctx.globalAlpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(s.faza));
      ctx.fillStyle = '#e0f2fe';
      const d = s.raza * 2;
      ctx.fillRect(s.x, s.y, d, d);
    }
  } else if (cfg.tip === 'bule') {
    for (const p of particule) {
      p.y -= p.viteza * f;                       // urca
      p.vant += p.vantViteza * f;
      p.x += Math.sin(p.vant) * 0.6 * f;         // clipsire pe X
      if (p.y < -p.raza - 10) p.reset(true);     // recicleaza jos
      ctx.globalAlpha = p.alfa;
      ctx.drawImage(p.img, p.x - p.img.width / 2, p.y - p.img.height / 2);
    }
  } else { // petale + fulgi (aceeasi fizica, sprite diferit)
    for (const p of particule) {
      p.y += p.viteza * f;                       // cade
      p.vant += p.vantViteza * f;
      p.x += Math.sin(p.vant) * 1.5 * f;         // efect de vant
      p.unghi += p.rotatie * f;                  // rotatie continua
      if (p.y > inaltime + 20) p.reset(true);    // recicleaza sus
      ctx.globalAlpha = p.alfa;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.unghi);
      ctx.drawImage(p.img, -p.img.width / 2, -p.img.height / 2);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  cadru = requestAnimationFrame(frame);
}

/** Porneste animatia pentru un slug (oprind ce rula inainte). */
function porneste(slug) {
  opreste();
  asiguraCanvas();
  if (!canvas || !ctx) return; // canvas indisponibil — ramane gradientul static
  const cfg = ANIMS[slug];
  if (!cfg) return;
  const fabrica = cfg.tip === 'bule' ? bulaNoua : cfg.tip === 'stele' ? steaNoua : cfg.tip === 'fulgi' ? fulgNou : petalaNoua;
  try {
    particule = [];
    for (let i = 0; i < cfg.numar; i++) particule.push(fabrica(cfg));
  } catch {
    opreste(); // canvas partial blocat (ex. extensii) — ramane gradientul, fara erori
    return;
  }
  slugCurent = slug;
  timpAnterior = performance.now();
  // Pauza cand tab-ul e ascuns (baterie), reluare la intoarcere.
  cadru = requestAnimationFrame(frame);
}

/** Opreste animatia si goleste canvas-ul. */
function opreste() {
  slugCurent = null;
  if (cadru) { cancelAnimationFrame(cadru); cadru = 0; }
  particule = [];
  if (ctx && canvas) ctx.clearRect(0, 0, latime, inaltime);
}

/** Slug-ul temei animate din clasa body (null daca tema nu e animata). */
function slugDinBody() {
  for (const c of document.body.classList) {
    if (c === 'theme-rank') continue;
    if (c.startsWith('theme-')) {
      const slug = c.slice(6);
      if (ANIMS[slug]) return slug;
    }
  }
  return null;
}

/**
 * Punctul de intrare: se apeleaza o data pe pagina (din core.js).
 * Nu face nimic fara suport <canvas> 2D sau fara rAF.
 */
export function initAnimBg() {
  if (typeof document === 'undefined' || !document.body) return;
  if (typeof requestAnimationFrame === 'undefined') return;

  // Pornim daca tema curenta e animata (ex: aplicata deja din sesiune).
  const initial = slugDinBody();
  if (initial) porneste(initial);

  // Urmarim schimbarile de tema (activare din shop, previzualizare 5s).
  const observator = new MutationObserver(() => {
    const slug = slugDinBody();
    if (slug === slugCurent) return;
    if (slug) porneste(slug);
    else opreste();
  });
  observator.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Pauza cand tab-ul e ascuns — reluam la intoarcere daca tema e animata.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (cadru) { cancelAnimationFrame(cadru); cadru = 0; }
    } else if (slugCurent && !cadru) {
      timpAnterior = performance.now();
      cadru = requestAnimationFrame(frame);
    }
  });
}
