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
  const fab = document.getElementById('chat-fab');
  const modal = document.getElementById('chat-modal');
  if (!fab || !modal) return;

  me = await getSession();

  document.getElementById('chat-close')?.addEventListener('click', closeChat);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeChat(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) closeChat(); });

  document.getElementById('chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });
  initStickers();

  fab.addEventListener('click', () => (isOpen ? closeChat() : openChat()));
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

/** Stikerele site-ului: arta proprie, chibi decupat. Id-ul e whitelist —
 *  orice tag necunoscut din mesaj se randeaza ca text simplu, niciodata img. */
export const STICKERS = [
  { id: 'salut', label: 'Salut' },
  { id: 'lol', label: 'Râs' },
  { id: 'love', label: 'Dragoste' },
  { id: 'nervos', label: 'Nervos' },
  { id: 'plans', label: 'Plâns' },
  { id: 'shock', label: 'Șoc' },
  { id: 'ok', label: 'OK' },
  { id: 'zzz', label: 'Somn' },
  { id: 'party', label: 'Petrecere' },
];
const STICKER_IDS = new Set(STICKERS.map((x) => x.id));
const STICKER_RE = /^\[sticker:([a-z0-9-]{1,24})\]$/;

function stickerImg(id, label) {
  const img = document.createElement('img');
  img.className = 'msg__sticker';
  img.src = `/assets/img/stickers/${id}.png`;
  img.alt = label || id;
  img.title = label || id;
  img.loading = 'lazy';
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
    b.appendChild(stickerImg(st.id, st.label));
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
  if (!STICKER_IDS.has(id)) return;
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
  if (sm && STICKER_IDS.has(sm[1])) {
    const who = nameEl(m);
    row.append(who, stickerImg(sm[1]));
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

  const text = document.createElement('span');
  text.className = 'msg__text';
  text.textContent = m.message || '';

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
  u.className = 'msg__user' + (m.name_gold ? ' msg__user--gold' : '');
  u.textContent = (m.flair ? m.flair + ' ' : '') + (m.username || 'Anon');
  return u;
}
