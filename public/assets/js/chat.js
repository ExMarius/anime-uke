// =====================================================================
// chat.js — modal de chat live prin WebSocket.
//
// Doar utilizatorii logati pot scrie (verificarea e pe server, in
// functions/chat.js). Daca nu esti logat, butonul trimite la login.
//
// Reconectare cu backoff exponential: pe mobil socket-ul cade des, iar
// fara reconectare chat-ul ramanea mort pana la refresh (v1 nu avea
// nici macar handler de onclose).
// =====================================================================

import { escapeHtml, getSession, toast , staffBadge, rankChip } from './core.js';

let ws = null;
let me = null;
let isOpen = false;
let retry = 0;
let retryTimer = null;
let onlineCount = 0;

const MAX_RETRY_DELAY = 20000;
export async function initChat() {
  let fab = document.getElementById('chat-fab');
  let modal = document.getElementById('chat-modal');
  // Pana acum chat-ul exista doar pe pagina principala; paginile de serie /
  // episod ramaneau fara el, iar site-ul parea „fara viata” pe jumatate din
  // pagini. Daca markup-ul lipseste, il construim aici — identic cu cel din
  // index.html — ca sa mearga identic peste tot, fara duplicate in HTML.
  if (!fab || !modal) {
    const frag = document.createRange().createContextualFragment(`
      <button class="chat-fab" id="chat-fab" type="button" aria-label="Deschide chat-ul live">
        <span class="chat-fab__dot"></span>
        <span class="chat-fab__label">Chat live</span>
      </button>
      <div class="chat-modal" id="chat-modal" data-open="false" role="dialog" aria-modal="true" aria-label="Chat live">
        <div class="chat-box">
          <div class="chat-head">
            <span class="chat-head__title">Chat global</span>
            <span class="chat-head__count" id="chat-online-count">0 online</span>
            <span class="chat-badge" id="chat-badge"></span>
            <button class="chat-close" id="chat-close" type="button" aria-label="Închide chat-ul">✕</button>
          </div>
          <div class="chat-online" id="chat-online">Se conectează…</div>
          <div class="chat-body" id="chat-body"></div>
          <form class="chat-form" id="chat-form">
            <label class="sr-only" for="chat-input">Mesaj</label>
            <div class="sticker-wrap">
              <button class="chat-sticker-btn" id="chat-sticker-btn" type="button"
                title="Stikere" aria-label="Deschide stikerele">😄</button>
              <div class="sticker-pop" id="sticker-pop" hidden></div>
            </div>
            <input class="input" id="chat-input" type="text" maxlength="500" placeholder="Scrie un mesaj…" autocomplete="off">
            <button class="btn btn--accent" type="submit">Trimite</button>
          </form>
        </div>
      </div>`);
    document.body.appendChild(frag);
    fab = document.getElementById('chat-fab');
    modal = document.getElementById('chat-modal');
  }
  if (!fab || !modal) return;

  me = await getSession();

  // Vizitatorii: butonul de chat duce la cont (fără conectare eșuată).
  if (!me) {
    fab.addEventListener('click', () => {
      toast('Chatul e pentru membri — creează-ți un cont gratuit 💬', 'warn');
      setTimeout(() => { location.href = '/register'; }, 900);
    });
    return;
  }

  document.getElementById('chat-close')?.addEventListener('click', closeChat);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeChat(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) closeChat(); });

  document.getElementById('chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });
  initStickers();

  fab.addEventListener('click', () => (isOpen ? closeChat() : openChat()));

  // Chip-ul „N online” din nav (core.js) deschide chat-ul printr-un eveniment
  // global — fara import circular core <-> chat. Chat-ul exista doar pentru
  // utilizatori logati (paginile publice nici nu initializeaza chat.js).
  document.addEventListener('auk:open-chat', () => openChat());
}

function getSessionCached() {
  try { return !!sessionStorage.getItem('auk-me'); } catch { return false; }
}

export function openChat() {
  const modal = document.getElementById('chat-modal');
  if (!modal) return;
  modal.dataset.open = 'true';
  isOpen = true;
  document.getElementById('chat-input')?.focus();
  if (!ws || ws.readyState === WebSocket.CLOSED) connect();
}

export function closeChat() {
  const modal = document.getElementById('chat-modal');
  if (modal) modal.dataset.open = 'false';
  isOpen = false;
}

function connect() {
  clearTimeout(retryTimer);

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/chat`;

  try {
    ws = new WebSocket(url);
  } catch (e) {
    scheduleRetry();
    return;
  }

  ws.onopen = () => {
    retry = 0;
    setBadge('conectat');
  };

  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === 'init') {
      if (data.you) me = data.you;
      renderOnline(data.online || []);
      const body = document.getElementById('chat-body');
      if (body) body.innerHTML = '';
      (data.history || []).forEach(renderMessage);
      scrollDown();
      return;
    }
    if (data.type === 'message') { renderMessage(data); if (data.online) renderOnline(data.online); scrollDown(); return; }
    if (data.type === 'system') { renderSystem(data.text); if (data.online) renderOnline(data.online); scrollDown(); return; }
    if (data.type === 'error') { toast(data.text || 'Nu am putut trimite mesajul', 'err'); }
  };

  ws.onerror = () => setBadge('eroare');

  ws.onclose = (event) => {
    ws = null;
    // 4000/4001 = inchidere intentionata din server (prea multe taburi / sesiune invalida)
    if (event.code === 4000 || event.code === 4001) {
      setBadge('deconectat');
      return;
    }
    if (isOpen) scheduleRetry();
  };
}

function scheduleRetry() {
  const delay = Math.min(1000 * 2 ** retry, MAX_RETRY_DELAY);
  retry += 1;
  setBadge(`reconectare în ${Math.round(delay / 1000)}s`);
  retryTimer = setTimeout(connect, delay);
}

function setBadge(text) {
  const el = document.getElementById('chat-badge');
  if (el) el.textContent = text;
}

function renderOnline(list) {
  onlineCount = list.length;
  const head = document.getElementById('chat-online-count');
  if (head) head.textContent = `${onlineCount} online`;

  const box = document.getElementById('chat-online');
  if (!box) return;
  box.textContent = list.length
    ? 'Online: ' + list.map((u) => `${u.staff_role ? (u.staff_role === 'Admin' ? '🛡️' : '🛠️') : ''}${u.rank_icon || ''} ${u.username}`.trim()).join(', ')
    : 'Nimeni online momentan';
}

function scrollDown() {
  const body = document.getElementById('chat-body');
  if (body) body.scrollTop = body.scrollHeight;
}

/** Stikere: GIF-uri populare cu anime, direct de pe Tenor (media.tenor.com).
 *  Id-ul ramane whitelist — un tag necunoscut din mesaj se randeaza ca text
 *  simplu, niciodata img, iar URL-urile nu vin niciodata de la utilizator.
 *  Id-urile vechi (salut/lol/love/...) sunt pastrate: sticker-ele deja
 *  salvate in istoricul chatului continua sa se randeze ca imagine. */
export const STICKERS = [
  { id: 'salut', label: 'Salut', url: 'https://media.tenor.com/3odQw0NS2ZIAAAAm/one-piece-op.webp' },
  { id: 'lol', label: 'Râs', url: 'https://media.tenor.com/qg8lImmxa_sAAAAm/one-piece-monkey-d-luffy.webp' },
  { id: 'love', label: 'Dragoste', url: 'https://media.tenor.com/VZ8Csy3ooBoAAAAm/demon-slayer-kimetsu-no-yaiba.webp' },
  { id: 'nervos', label: 'Nervos', url: 'https://media.tenor.com/K-uiOjifp90AAAAm/goku-goku-black.webp' },
  { id: 'plans', label: 'Plâns', url: 'https://media.tenor.com/9DOXBiQspSQAAAAm/hampter-sad.webp' },
  { id: 'shock', label: 'Șoc', url: 'https://media.tenor.com/WszXFLZ1O28AAAAm/holy-enelshock.webp' },
  { id: 'ok', label: 'OK', url: 'https://media.tenor.com/c-w2c8qXoXYAAAAm/jujutsu-kaisen-yuji-itadori.webp' },
  { id: 'zzz', label: 'Somn', url: 'https://media.tenor.com/seGvGe7Cp2cAAAAm/anime-bocchi.webp' },
  { id: 'party', label: 'Petrecere', url: 'https://media.tenor.com/Oza7xqkFY2gAAAAm/buggy-buggy-dancing.webp' },
  { id: 'luffy', label: 'Luffy sare', url: 'https://media.tenor.com/yQpfFS04RHgAAAAm/luffy-bounce.webp' },
  { id: 'chopper', label: 'Chopper', url: 'https://media.tenor.com/2J_qowQYhkYAAAAm/pet-tony-tony-chopper.webp' },
  { id: 'robin', label: 'Robin WTF', url: 'https://media.tenor.com/VlcpKOUOq8gAAAAm/one-piece-nico-robin.webp' },
  { id: 'naruto', label: 'Naruto', url: 'https://media.tenor.com/4atnm_3hO-AAAAAm/naruto.webp' },
  { id: 'pisica', label: 'Pisica ninja', url: 'https://media.tenor.com/ZVakFxhrwgUAAAAm/naruto-potatoe.webp' },
  { id: 'kakashi', label: 'Kakashi', url: 'https://media.tenor.com/Z7JnijiEGrEAAAAm/kakashi-menor.webp' },
  { id: 'obito', label: 'Obito', url: 'https://media.tenor.com/gWU7YwfHDkMAAAAm/obito-naruto.webp' },
  { id: 'tobi', label: 'Tobi', url: 'https://media.tenor.com/fkryI7FLjgMAAAAm/obito-naruto.webp' },
  { id: 'goku-dans', label: 'Goku dance', url: 'https://media.tenor.com/Y0goYxQv6FkAAAAm/goku-dance.webp' },
  { id: 'goku-nor', label: 'Goku pe nor', url: 'https://media.tenor.com/Gie5G6h373YAAAAm/goku-dragon-ball.webp' },
  { id: 'goku-fuge', label: 'Goku fuge', url: 'https://media.tenor.com/cJtDhl2-MP0AAAAm/goku-dragon-ball.webp' },
  { id: 'goku-supreme', label: 'Goku Supreme', url: 'https://media.tenor.com/j0v_uKpHEVoAAAAm/dragon-ball-dragon-ball-super.webp' },
  { id: 'nezuko', label: 'Nezuko', url: 'https://media.tenor.com/CYuL_bwVyHsAAAAm/nezuko-vitor-rossoni.webp' },
  { id: 'mitsuri', label: 'Mitsuri', url: 'https://media.tenor.com/BopLsVA-EFEAAAAm/kanrojimitsuri.webp' },
  { id: 'tanjiro', label: 'Tanjiro', url: 'https://media.tenor.com/wUZAKoV9vZAAAAAm/pet-tanjiro-kamado.webp' },
  { id: 'muichiro', label: 'Muichiro', url: 'https://media.tenor.com/4euFw-Yamx4AAAAm/muichiropet.webp' },
  { id: 'fern', label: 'Fern', url: 'https://media.tenor.com/icFr1mGPS7gAAAAm/fern-frieren.webp' },
  { id: 'poke', label: 'Poke', url: 'https://media.tenor.com/nRgaP2XCX-wAAAAm/poke-you.webp' },
  { id: 'trailblazer', label: 'Deal with it', url: 'https://media.tenor.com/KeqbuC5yrgUAAAAm/deal-with-it-trailblazer.webp' },
  { id: 'waifu', label: 'Waifu dance', url: 'https://media.tenor.com/TcrzssE_SwMAAAAm/anime-waifu.webp' },
  { id: 'eren-bruh', label: 'Eren bruh', url: 'https://media.tenor.com/VLUZEOpoKzYAAAAm/eren-yeager-eren.webp' },
  { id: 'eren', label: 'Eren', url: 'https://media.tenor.com/D9UTK52U-AwAAAAm/eren-yeager.webp' },
  { id: 'pisica-aot', label: 'Pisica AoT', url: 'https://media.tenor.com/ZG4ITj9JZ8IAAAAm/kedy-aot.webp' },
  { id: 'titan', label: 'Titan colosal', url: 'https://media.tenor.com/fkUyA-Cr3vUAAAAm/disco-rabbit-colossal-titan-stomp-disco-rabbit.webp' },
  { id: 'annie', label: 'Annie', url: 'https://media.tenor.com/wOZlfFDwUjkAAAAm/annie-scared.webp' },
  { id: 'vegeta', label: 'Vegeta', url: 'https://media.tenor.com/GU2t_DbBoMoAAAAm/vegeta.webp' },
  { id: 'vegeta-metoda', label: 'Vegeta metoda', url: 'https://media.tenor.com/YNzyLfofe28AAAAm/vegeta-method.webp' },
  { id: 'vegeta-dans', label: 'Vegeta dance', url: 'https://media.tenor.com/UhtPTKiXCQkAAAAm/vegeta-dance.webp' },
  { id: 'majin', label: 'Majin Vegeta', url: 'https://media.tenor.com/s5H-epeo0ewAAAAm/jus-mugen-majin-vegeta.webp' },
  { id: 'mini-vegeta', label: 'Mini Vegeta', url: 'https://media.tenor.com/sxmRpXLv3hcAAAAm/mini-vegeta-discord.webp' },
  { id: 'saitama', label: 'Saitama', url: 'https://media.tenor.com/vV9t--sZmW0AAAAm/one-punch.webp' },
  { id: 'saitama-ok', label: 'Saitama OK', url: 'https://media.tenor.com/gdJ_xfy7bT0AAAAm/saitama-saitama-ok-meme.webp' },
  { id: 'saitama-tare', label: 'Ești tare', url: 'https://media.tenor.com/gBEwTW4wyeUAAAAm/you-are-powerful.webp' },
  { id: 'saitama-iubire', label: 'Saitama love', url: 'https://media.tenor.com/ete5XOfF3MQAAAAm/anime-love.webp' },
  { id: 'anya', label: 'Anya', url: 'https://media.tenor.com/fFnRKgwGSLEAAAAm/anya-forger-anya-spy-x-family-anime.webp' },
  { id: 'anya-shock', label: 'Anya șoc', url: 'https://media.tenor.com/grHqC42XysIAAAAm/spy-family.webp' },
  { id: 'anya-heh', label: 'Anya heh', url: 'https://media.tenor.com/0rlAawxpalIAAAAm/anya-anya-forger.webp' },
  { id: 'anya-bani', label: 'Anya bani', url: 'https://media.tenor.com/Fgo_yilM8aIAAAAm/anya-belrory-anya.webp' },
  { id: 'anya-cute', label: 'Anya drăguță', url: 'https://media.tenor.com/_YwQzqVMX1YAAAAm/spy-x-family-anya-spy-x-family-anime.webp' },
  { id: 'makima', label: 'Makima ascultă', url: 'https://media.tenor.com/7xC3klGi_J8AAAAm/makima-is-listening-big-ears.webp' },
  { id: 'pochita', label: 'Pochita', url: 'https://media.tenor.com/Wz3m8A_r4TIAAAAm/pochita-chainsaw-man.webp' },
  { id: 'pochita-spin', label: 'Pochita spin', url: 'https://media.tenor.com/mOz9vJIGa1gAAAAm/pochita-spin.webp' },
  { id: 'denji', label: 'Denji', url: 'https://media.tenor.com/5xbXPnI94hgAAAAm/denji-chainsaw-man.webp' },
  { id: 'denji-griddy', label: 'Denji griddy', url: 'https://media.tenor.com/aM3opOUmhQ0AAAAm/chainsaw-man-denji.webp' },
  { id: 'power', label: 'Power', url: 'https://media.tenor.com/GwYHIEZ2JxYAAAAm/power-chainsaw-man-chainsaw-man.webp' },
];
const STICKER_BY_ID = new Map(STICKERS.map((x) => [x.id, x]));
const STICKER_RE = /^\[sticker:([a-z0-9-]{1,24})\]$/;

function stickerImg(st, label) {
  const img = document.createElement('img');
  img.className = 'msg__sticker';
  img.src = st.url;
  img.alt = label || st.label;
  img.title = label || st.label;
  img.loading = 'lazy';
  img.setAttribute('referrerpolicy', 'no-referrer');
  return img;
}


/** Picker-ul de stikere: butonul 😄 din formular deschide grila; un click pe
 *  un sticker il trimite instant ca mesaj de sine statator. */
function initStickers() {
  const btn = document.getElementById('chat-sticker-btn');
  const pop = document.getElementById('sticker-pop');
  if (!btn || !pop) return;
  pop.innerHTML = '';
  for (const st of STICKERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sticker-pop__item';
    b.title = st.label;
    b.appendChild(stickerImg(st, st.label));
    b.addEventListener('click', () => {
      pop.hidden = true;
      sendSticker(st.id);
    });
    pop.appendChild(b);
  }
  btn.addEventListener('click', () => { pop.hidden = !pop.hidden; });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true;
  });
}

function sendSticker(id) {
  if (!STICKER_BY_ID.has(id)) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Chat-ul nu e conectat încă. Încearcă din nou într-o secundă.', 'warn');
    return;
  }
  ws.send(JSON.stringify({ type: 'chat', message: `[sticker:${id}]` }));
}

/** Construieste noduri cu textContent — niciodata innerHTML cu date de la utilizator. */
function renderMessage(m) {
  const body = document.getElementById('chat-body');
  if (!body) return;

  const row = document.createElement('div');
  row.className = 'msg' + (me && m.user_id === me.id ? ' msg--own' : '');

  // mesajele care sunt DOAR un sticker se randeaza ca imagine mare; un tag
  // necunoscut sau amestecat cu text ramane text simplu (sigur)
  const sm = String(m.message || '').match(STICKER_RE);
  if (sm && STICKER_BY_ID.has(sm[1])) {
    const who = nameEl(m);
    const av = avatarEl(m);
    if (av) row.append(av);
    row.append(who, stickerImg(STICKER_BY_ID.get(sm[1])));
    if (m.created_at) {
      const time = document.createElement('span');
      time.className = 'msg__time';
      time.textContent = String(m.created_at).slice(11, 16);
      row.appendChild(time);
    }
    body.appendChild(row);
    trimBody(body);
    return;
  }

  // identitatea: staff badge + grad tematic, ambele din server (niciodata
  // din client) — cine vorbeste si cu ce autoritate se vede dintr-o privire
  const badges = [
    staffBadge(m.staff_role),
    rankChip(m.rank_label ? { label: m.rank_label, icon: m.rank_icon } : null),
  ].filter(Boolean);

  const user = nameEl(m);
  const av = avatarEl(m);

  const text = document.createElement('span');
  text.className = 'msg__text';
  text.textContent = m.message || '';

  if (av) row.append(av);
  row.append(...badges, user, text);

  if (m.created_at) {
    const time = document.createElement('span');
    time.className = 'msg__time';
    time.textContent = String(m.created_at).slice(11, 16);
    row.appendChild(time);
  }

  body.appendChild(row);
  trimBody(body);
}

function renderSystem(text) {
  const body = document.getElementById('chat-body');
  if (!body) return;
  const el = document.createElement('div');
  el.className = 'msg msg--system';
  el.textContent = text || '';
  body.appendChild(el);
  trimBody(body);
}

/** Tine DOM-ul mic: la 1000 de utilizatori, mii de noduri ar incetini pagina. */
function trimBody(body, keep = 200) {
  while (body.children.length > keep) body.removeChild(body.firstChild);
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Chat-ul nu e conectat încă. Încearcă din nou într-o secundă.', 'warn');
    return;
  }

  ws.send(JSON.stringify({ type: 'chat', message: text.slice(0, 500) }));
  input.value = '';
}

/** Numele din chat: 💎 flair si 🌟 aur vin din server (atașate la handshake
 *  si stocate pe mesaj) — clientul nu le poate falsifica. */
function nameEl(m) {
  const u = document.createElement('span');
  // Culoarea numelui (shop). Validăm formatul — vine din DB-ul nostru, dar
  // aplicăm classă doar pentru id-uri cu aspect de id.
  const ncol = typeof m.name_color === 'string' && /^color_[a-z]+$/.test(m.name_color) ? m.name_color.slice(6) : '';
  u.className = 'msg__user' + (m.name_gold ? ' msg__user--gold' : '') + (ncol ? ` nc-${ncol}` : '');
  u.textContent = (m.flair ? m.flair + ' ' : '') + (m.username || 'Anon');
  return u;
}

/** Avatarul celui care vorbeste: <img> cu URL-ul din profil (poate fi GIF
 *  animat — <img> randeaza animatia nativ). Linkul picat sau gazda care
 *  blocheaza hotlinking cad pe initiala, niciodata pe imagine stricata. */
function avatarEl(m) {
  if (!m.avatar) return null;
  const wrap = document.createElement('span');
  wrap.className = 'msg__avatar';
  const img = document.createElement('img');
  img.src = m.avatar;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.setAttribute('referrerpolicy', 'no-referrer');
  img.addEventListener('error', () => {
    const fb = document.createElement('span');
    fb.className = 'msg__avatar-fb';
    fb.textContent = (m.username || 'A')[0].toUpperCase();
    img.replaceWith(fb);
  }, { once: true });
  wrap.appendChild(img);
  return wrap;
}
