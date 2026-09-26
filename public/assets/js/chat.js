// =====================================================================
// chat.js — modal de chat live prin WebSocket.
// Doar utilizatorii logati pot scrie (verificarea e pe server, in
// routes/chat.js). Daca nu esti logat, butonul trimite la login.
// Reconectare cu backoff exponential: pe mobil socket-ul cade des, iar
// fara reconectare chat-ul ramanea mort pana la refresh (v1 nu avea
// nici macar handler de onclose).
//
// FIX DISPLAY (2026-09-25): butonul si modalul aveau display:none in
// unele cazuri (purge CSS, admin fara initChat, sesiune undefined).
// Acum ensureChatElements() garanteaza ca FAB-ul si modalul EXISTA si
// au display corect pe ORICE pagina, iar open/close folosesc !important
// din CSS (display:flex !important cand e deschis).
//
// FIX PROFILE LINK (2026-09-25): click pe poza/nume din chat -> profil
// + adauga prieten. Avatarul si numele sunt <a> catre /profile?u=...
// =====================================================================

import { api, getSession, toast, staffBadge, staffIcon, rankChip } from './core.js';

let ws = null;
let me = null;
let isOpen = false;
let retry = 0;
let retryTimer = null;
let onlineCount = 0;
let initialized = false;
let activeTab = 'live';
let activeFriend = null;
let dmInbox = [];
let inboxLoaded = false;
let inboxLoading = null;

const MAX_RETRY_DELAY = 20000;

function chatBoxMarkup() {
  return `
    <div class="chat-box">
      <div class="chat-head">
        <span class="chat-head__title">Comunitate</span>
        <span class="chat-head__count" id="chat-online-count">0 online</span>
        <span class="chat-badge" id="chat-badge"></span>
        <button class="chat-close" id="chat-close" type="button" aria-label="Închide chat-ul">✕</button>
      </div>
      <div class="chat-tabs" id="chat-tabs" role="tablist" aria-label="Tip conversație">
        <button class="chat-tab" id="chat-tab-live" type="button" role="tab" aria-controls="chat-live-panel" aria-selected="true" data-chat-tab="live">● Live</button>
        <button class="chat-tab" id="chat-tab-friends" type="button" role="tab" aria-controls="chat-friends-panel" aria-selected="false" data-chat-tab="friends">
          Prieteni <span class="dm-badge" id="dm-tab-badge" hidden></span>
        </button>
      </div>
      <section class="chat-panel chat-panel--live" id="chat-live-panel" role="tabpanel" aria-labelledby="chat-tab-live">
        <div class="chat-online" id="chat-online">Se conectează…</div>
        <div class="chat-body" id="chat-body"></div>
        <form class="chat-form" id="chat-form">
          <label class="sr-only" for="chat-input">Mesaj live</label>
          <div class="sticker-wrap">
            <button class="chat-sticker-btn" id="chat-sticker-btn" type="button" title="Stikere" aria-label="Deschide stikerele">😄</button>
            <div class="sticker-pop" id="sticker-pop" hidden></div>
          </div>
          <input class="input" id="chat-input" type="text" maxlength="500" placeholder="Scrie în chatul live…" autocomplete="off">
          <button class="btn btn--accent" type="submit">Trimite</button>
        </form>
      </section>
      <section class="chat-panel chat-panel--friends" id="chat-friends-panel" role="tabpanel" aria-labelledby="chat-tab-friends" hidden>
        <div class="dm-layout">
          <aside class="dm-sidebar" aria-label="Conversații cu prietenii">
            <div class="dm-sidebar__head"><strong>Prieteni</strong><span id="dm-total-label">0 conversații</span></div>
            <div class="dm-inbox" id="dm-inbox"><p class="dm-empty">Se încarcă…</p></div>
          </aside>
          <div class="dm-thread" id="dm-thread">
            <div class="dm-thread__head">
              <button class="dm-back" id="dm-back" type="button" aria-label="Înapoi la prieteni">‹</button>
              <span class="dm-thread__avatar" id="dm-thread-avatar">💬</span>
              <div><strong id="dm-thread-name">Mesaje private</strong><small id="dm-thread-state">Alege un prieten</small></div>
            </div>
            <div class="dm-body" id="dm-body"><p class="dm-empty">Alege un prieten din listă pentru a începe conversația.</p></div>
            <form class="dm-form" id="dm-form" hidden>
              <label class="sr-only" for="dm-input">Mesaj privat</label>
              <input class="input" id="dm-input" type="text" maxlength="500" placeholder="Mesaj privat…" autocomplete="off">
              <button class="btn btn--accent" type="submit" aria-label="Trimite mesajul privat">➤</button>
            </form>
          </div>
        </div>
      </section>
    </div>`;
}

function ensureChatElements() {
  let fab = document.getElementById('chat-fab');
  let modal = document.getElementById('chat-modal');

  if (!fab) {
    const frag = document.createRange().createContextualFragment(`
      <button class="chat-fab" id="chat-fab" type="button" aria-label="Deschide chat-ul" style="display:flex">
        <span class="chat-fab__dot"></span>
        <span class="chat-fab__label">Chat</span>
        <span class="chat-fab__badge dm-badge" id="chat-dm-badge" hidden></span>
      </button>`);
    document.body.appendChild(frag);
    fab = document.getElementById('chat-fab');
  }
  if (!modal) {
    const frag = document.createRange().createContextualFragment(`
      <div class="chat-modal" id="chat-modal" data-open="false" role="dialog" aria-modal="true" aria-label="Chat live și mesaje private" style="display:none">
        ${chatBoxMarkup()}
      </div>`);
    document.body.appendChild(frag);
    modal = document.getElementById('chat-modal');
  }

  // Markup-ul vechi poate exista în index.html; îl actualizăm fără să cerem
  // tuturor paginilor să dubleze structura mini-Discord din acest modul.
  if (modal && !modal.querySelector('#chat-tabs')) modal.innerHTML = chatBoxMarkup();
  if (fab && !fab.querySelector('#chat-dm-badge')) {
    const badge = document.createElement('span');
    badge.className = 'chat-fab__badge dm-badge';
    badge.id = 'chat-dm-badge';
    badge.hidden = true;
    fab.appendChild(badge);
  }

  // Garantăm display-ul chiar dacă CSS-ul a fost purgat sau suprascris.
  if (fab) {
    fab.style.display = 'flex';
    fab.hidden = false;
    fab.removeAttribute('hidden');
  }
  if (modal) {
    if (modal.dataset.open !== 'true') modal.style.display = 'none';
    modal.removeAttribute('hidden');
  }

  return { fab, modal };
}

export async function initChat() {
  if (initialized) {
    // Deja inițializat o dată pe pagină — dar asigurăm că elementele există
    ensureChatElements();
    return;
  }

  const { fab, modal } = ensureChatElements();
  if (!fab || !modal) return;

  try {
    me = await getSession();
  } catch {
    me = null;
  }

  // Curățăm handlere vechi (dacă initChat e chemat de mai multe ori)
  const newFab = fab.cloneNode(true);
  fab.parentNode.replaceChild(newFab, fab);
  const freshFab = document.getElementById('chat-fab');

  // Re-atașăm modalul curat (fără duplicate de listeneri)
  const closeBtn = document.getElementById('chat-close');
  const form = document.getElementById('chat-form');
  const modalEl = document.getElementById('chat-modal');

  // Vizitatorii: butonul de chat duce la cont (fără conectare eșuată).
  // IMPORTANT: null = guest confirmat, undefined = necunoscut — ambele
  // înseamnă „nu ești logat” pentru chat.
  if (!me) {
    freshFab.addEventListener('click', () => {
      toast('Chatul e pentru membri — creează-ți un cont gratuit 💬', 'warn');
      setTimeout(() => { location.href = '/register'; }, 900);
    });
    // Totuși, ascultăm evenimentul global de deschidere (de la pulse-chip)
    document.addEventListener('auk:open-chat', () => {
      toast('Chatul e pentru membri — creează-ți un cont gratuit 💬', 'warn');
      setTimeout(() => { location.href = '/register'; }, 900);
    });
    initialized = true;
    return;
  }

  // Logat: wire-up complet
  const doClose = () => closeChat();
  document.getElementById('chat-close')?.addEventListener('click', doClose);
  modalEl?.addEventListener('click', (e) => { if (e.target === modalEl) closeChat(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) closeChat(); });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });
  document.querySelectorAll('[data-chat-tab]').forEach((button) => {
    button.addEventListener('click', () => switchChatTab(button.dataset.chatTab));
  });
  document.getElementById('dm-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendDirectMessage();
  });
  document.getElementById('dm-back')?.addEventListener('click', () => closeDirectThread());
  initStickers();

  freshFab.addEventListener('click', () => (isOpen ? closeChat() : openChat()));

  // Chip-ul „N online” din nav (core.js) deschide chat-ul printr-un eveniment
  // global — fara import circular core <-> chat.
  document.addEventListener('auk:open-chat', () => openChat());

  initialized = true;
}

export function openChat() {
  const { fab, modal } = ensureChatElements();
  if (!modal) return;
  // Display garantat: scoatem hidden, setăm data-open și style
  modal.hidden = false;
  modal.removeAttribute('hidden');
  modal.dataset.open = 'true';
  modal.style.display = 'flex';
  isOpen = true;
  if (activeTab === 'friends') document.getElementById('dm-input')?.focus();
  else document.getElementById('chat-input')?.focus();
  if (!ws || ws.readyState === WebSocket.CLOSED) connect();
  // Inbox-ul se cere la deschidere, nu la fiecare pagină vizitată: păstrăm
  // bugetul de invocări și tot avem badge-ul înainte ca utilizatorul să aleagă tabul.
  loadInbox().then(() => {
    if (activeTab === 'friends' && activeFriend) {
      const fresh = dmInbox.find((row) => Number(row.user_id) === Number(activeFriend.user_id));
      if (fresh) markDirectRead(fresh);
    }
  });
  if (activeTab === 'live' && !rulesAccepted()) showRules();
}

// ---------------------------------------------------------------------
// Regulamentul chat-ului: se arata o singura data, la prima deschidere,
// peste fereastra de chat (model: site-urile mari de anime din Romania).
// Acceptul se tine minte in localStorage; comanda „-regulament" scrisa in
// chat il readuce oricand. Nu trece prin server — zero cost.
// ---------------------------------------------------------------------
const RULES_KEY = 'auk-chat-rules-v1';
const CHAT_RULES = [
  'Fără cuvinte, imagini sau stikere obscene.',
  'Fără spoilere din anime — folosește [spoiler]…[/spoiler] în comentarii, nu chat-ul.',
  'Nu-ți da datele personale (adresă, telefon, școală) și nu le cere altora.',
  'Fără CAPS excesiv, flood sau același mesaj/emoji repetat (spam).',
  'Fără reclamă la alte site-uri sau fansub-uri.',
  'Glumele proaste le faci doar cu prietenii tăi — nu cu străinii din chat.',
  'Un membru te deranjează? Raportează-l unui moderator în loc să te cerți.',
];

function rulesAccepted() {
  try { return localStorage.getItem(RULES_KEY) === '1'; } catch { return true; }
}

export function showRules() {
  const box = document.querySelector('#chat-modal .chat-box');
  if (!box || box.querySelector('.chat-rules')) return;

  const wrap = document.createElement('div');
  wrap.className = 'chat-rules';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', 'Regulament chat');
  wrap.style.display = 'flex';

  const h = document.createElement('h3');
  h.className = 'chat-rules__title';
  h.textContent = '📜 Regulament chat';
  const ol = document.createElement('ol');
  ol.className = 'chat-rules__list';
  for (const r of CHAT_RULES) {
    const li = document.createElement('li');
    li.textContent = r;
    ol.appendChild(li);
  }
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Poți readuce fereastra asta oricând scriind -regulament în chat.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--accent btn--sm';
  btn.textContent = 'Am citit și sunt de acord';
  btn.addEventListener('click', () => {
    try { localStorage.setItem(RULES_KEY, '1'); } catch { /* privat */ }
    wrap.remove();
    document.getElementById('chat-input')?.focus();
  });

  wrap.append(h, ol, hint, btn);
  box.appendChild(wrap);
  btn.focus();
}

export function closeChat() {
  const modal = document.getElementById('chat-modal');
  if (modal) {
    modal.dataset.open = 'false';
    modal.style.display = 'none';
  }
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
    if (data.type === 'dm') { handleDirectMessage(data); return; }
    if (data.type === 'system') { renderSystem(data.text); if (data.online) renderOnline(data.online); scrollDown(); return; }
    if (data.type === 'error') {
      toast(data.text || 'Nu am putut trimite mesajul', 'err');
      if (data.scope === 'dm' && data.code === 'not_friends') loadInbox(true);
    }
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

function profileHref(username) {
  if (!username) return '/profile';
  return `/profile?u=${encodeURIComponent(username)}`;
}

function renderOnline(list) {
  onlineCount = list.length;
  const head = document.getElementById('chat-online-count');
  if (head) head.textContent = `${onlineCount} online`;

  const box = document.getElementById('chat-online');
  if (!box) return;
  box.innerHTML = '';
  box.style.display = 'block';

  if (!list.length) {
    box.textContent = 'Nimeni online momentan';
    return;
  }

  const label = document.createElement('span');
  label.textContent = 'Online: ';
  box.appendChild(label);

  list.forEach((u, idx) => {
    const a = document.createElement('a');
    a.href = profileHref(u.username);
    a.className = 'chat-online__user';
    a.title = `Vezi profilul lui ${u.username}`;
    a.textContent = `${staffIcon(u.staff_role)}${u.rank_icon || ''} ${u.username}`.trim();
    box.appendChild(a);
    if (idx < list.length - 1) {
      box.appendChild(document.createTextNode(', '));
    }
  });
}

function scrollDown() {
  const body = document.getElementById('chat-body');
  if (body) body.scrollTop = body.scrollHeight;
}

// ---------------------------------------------------------------------
// Mesaje private — inbox mini-Discord în același modal
// ---------------------------------------------------------------------
function switchChatTab(tab) {
  activeTab = tab === 'friends' ? 'friends' : 'live';
  const live = document.getElementById('chat-live-panel');
  const friends = document.getElementById('chat-friends-panel');
  if (live) live.hidden = activeTab !== 'live';
  if (friends) friends.hidden = activeTab !== 'friends';
  document.querySelectorAll('[data-chat-tab]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.chatTab === activeTab));
  });

  if (activeTab === 'friends') {
    loadInbox().then(() => {
      if (activeFriend) {
        const fresh = dmInbox.find((row) => Number(row.user_id) === Number(activeFriend.user_id));
        if (fresh) markDirectRead(fresh);
      }
    });
    (activeFriend ? document.getElementById('dm-input') : document.querySelector('.dm-friend'))?.focus();
  } else {
    document.getElementById('chat-input')?.focus();
    if (!rulesAccepted()) showRules();
  }
}

async function loadInbox(force = false) {
  if (inboxLoading) return inboxLoading;
  if (inboxLoaded && !force) {
    renderInbox();
    return;
  }

  inboxLoading = (async () => {
    const result = await api('/messages');
    if (!result.ok) {
      const box = document.getElementById('dm-inbox');
      if (box) {
        box.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'dm-empty';
        p.textContent = result.data?.error || 'Nu am putut încărca prietenii.';
        box.appendChild(p);
      }
      return;
    }
    dmInbox = Array.isArray(result.data?.conversations) ? result.data.conversations : [];
    inboxLoaded = true;

    // Unfriend cât modalul e deschis: conversația dispare și thread-ul se
    // închide imediat, fără a păstra istoricul vizibil în DOM.
    if (activeFriend && !dmInbox.some((row) => Number(row.user_id) === Number(activeFriend.user_id))) {
      closeDirectThread();
    }
    renderInbox();
  })().finally(() => { inboxLoading = null; });
  return inboxLoading;
}

function renderInbox() {
  const box = document.getElementById('dm-inbox');
  if (!box) return;
  box.innerHTML = '';

  const total = dmInbox.reduce((sum, row) => sum + (Number(row.unread) || 0), 0);
  updateDmBadges(total);
  const label = document.getElementById('dm-total-label');
  if (label) label.textContent = `${dmInbox.length} ${dmInbox.length === 1 ? 'prieten' : 'prieteni'}`;

  if (!dmInbox.length) {
    const p = document.createElement('p');
    p.className = 'dm-empty';
    p.textContent = 'Nu ai încă prieteni acceptați. Adaugă-i din profil pentru a le scrie.';
    box.appendChild(p);
    return;
  }

  for (const friend of dmInbox) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dm-friend' + (activeFriend && Number(activeFriend.user_id) === Number(friend.user_id) ? ' dm-friend--active' : '');
    button.dataset.userId = String(friend.user_id);
    button.appendChild(dmAvatar(friend, 'dm-friend__avatar'));

    const main = document.createElement('span');
    main.className = 'dm-friend__main';
    const name = document.createElement('strong');
    name.textContent = friend.username;
    const preview = document.createElement('small');
    preview.textContent = friend.last_message
      ? `${Number(friend.last_sender_id) === Number(me?.id) ? 'Tu: ' : ''}${friend.last_message}`
      : 'Începe conversația';
    main.append(name, preview);
    button.appendChild(main);

    const side = document.createElement('span');
    side.className = 'dm-friend__side';
    if (friend.last_message_at) {
      const time = document.createElement('time');
      time.textContent = String(friend.last_message_at).slice(11, 16);
      side.appendChild(time);
    }
    if (Number(friend.unread) > 0) {
      const badge = document.createElement('b');
      badge.className = 'dm-badge';
      badge.textContent = Number(friend.unread) > 99 ? '99+' : String(friend.unread);
      side.appendChild(badge);
    }
    button.appendChild(side);
    button.addEventListener('click', () => openDirectThread(friend));
    box.appendChild(button);
  }
}

function dmAvatar(friend, className) {
  const wrap = document.createElement('span');
  wrap.className = className;
  if (friend.avatar) {
    const img = document.createElement('img');
    img.src = friend.avatar;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      wrap.textContent = (friend.username || '?')[0].toUpperCase();
    }, { once: true });
    wrap.appendChild(img);
  } else {
    wrap.textContent = (friend.username || '?')[0].toUpperCase();
  }
  return wrap;
}

function updateDmBadges(total) {
  for (const id of ['dm-tab-badge', 'chat-dm-badge']) {
    const badge = document.getElementById(id);
    if (!badge) continue;
    badge.hidden = total < 1;
    badge.textContent = total > 99 ? '99+' : String(total || '');
  }
}

async function openDirectThread(friend) {
  activeFriend = friend;
  renderInbox();
  document.querySelector('.dm-layout')?.classList.add('dm-layout--thread');

  const name = document.getElementById('dm-thread-name');
  const state = document.getElementById('dm-thread-state');
  const avatar = document.getElementById('dm-thread-avatar');
  const body = document.getElementById('dm-body');
  const form = document.getElementById('dm-form');
  if (name) name.textContent = friend.username;
  if (state) state.textContent = 'Mesaje private · doar între prieteni';
  if (avatar) {
    avatar.innerHTML = '';
    avatar.appendChild(dmAvatar(friend, 'dm-thread__avatar-inner'));
  }
  if (body) {
    body.innerHTML = '';
    const loading = document.createElement('p');
    loading.className = 'dm-empty';
    loading.textContent = 'Se încarcă istoricul…';
    body.appendChild(loading);
  }
  if (form) form.hidden = false;

  const result = await api(`/messages?with=${encodeURIComponent(friend.username)}`);
  // Utilizatorul poate selecta alt prieten cât requestul este în zbor.
  if (!activeFriend || Number(activeFriend.user_id) !== Number(friend.user_id)) return;
  if (!result.ok) {
    toast(result.data?.error || 'Conversația nu mai este disponibilă', 'warn');
    closeDirectThread();
    loadInbox(true);
    return;
  }

  if (body) {
    body.innerHTML = '';
    const messages = Array.isArray(result.data?.messages) ? result.data.messages : [];
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'dm-empty';
      empty.textContent = `Spune-i salut lui ${friend.username}.`;
      body.appendChild(empty);
    } else {
      messages.forEach(renderDirectBubble);
    }
    body.scrollTop = body.scrollHeight;
  }

  if (isOpen && activeTab === 'friends') await markDirectRead(friend);
  document.getElementById('dm-input')?.focus();
}

function closeDirectThread() {
  activeFriend = null;
  document.querySelector('.dm-layout')?.classList.remove('dm-layout--thread');
  const name = document.getElementById('dm-thread-name');
  const state = document.getElementById('dm-thread-state');
  const avatar = document.getElementById('dm-thread-avatar');
  const body = document.getElementById('dm-body');
  const form = document.getElementById('dm-form');
  if (name) name.textContent = 'Mesaje private';
  if (state) state.textContent = 'Alege un prieten';
  if (avatar) avatar.textContent = '💬';
  if (body) {
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'dm-empty';
    p.textContent = 'Alege un prieten din listă pentru a începe conversația.';
    body.appendChild(p);
  }
  if (form) form.hidden = true;
  renderInbox();
}

function renderDirectBubble(message) {
  const body = document.getElementById('dm-body');
  if (!body) return;
  if (message.id && body.querySelector(`[data-dm-id="${Number(message.id)}"]`)) return;
  body.querySelector('.dm-empty')?.remove();

  const row = document.createElement('div');
  row.className = 'dm-message' + (Number(message.sender_id) === Number(me?.id) ? ' dm-message--own' : '');
  if (message.id) row.dataset.dmId = String(message.id);
  const bubble = document.createElement('p');
  bubble.textContent = message.message || '';
  const time = document.createElement('time');
  time.textContent = String(message.created_at || '').slice(11, 16);
  row.append(bubble, time);
  body.appendChild(row);
  body.scrollTop = body.scrollHeight;
}

async function markDirectRead(friend) {
  if (!friend || Number(friend.unread) < 1) return;
  const result = await api('/messages', {
    method: 'POST',
    body: { action: 'read', with: friend.username },
  });
  if (!result.ok) return;
  const row = dmInbox.find((item) => Number(item.user_id) === Number(friend.user_id));
  if (row) row.unread = 0;
  friend.unread = 0;
  renderInbox();
  updateDmBadges(Number(result.data?.unread) || 0);
}

function sendDirectMessage() {
  const input = document.getElementById('dm-input');
  if (!input || !activeFriend) return;
  const text = input.value.trim();
  if (!text) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Chat-ul nu e conectat încă. Încearcă din nou într-o secundă.', 'warn');
    return;
  }
  ws.send(JSON.stringify({
    type: 'dm',
    recipient_id: Number(activeFriend.user_id),
    message: text.slice(0, 500),
  }));
  input.value = '';
}

function handleDirectMessage(message) {
  const otherId = Number(message.sender_id) === Number(me?.id)
    ? Number(message.recipient_id)
    : Number(message.sender_id);
  const openForThisFriend = activeFriend && Number(activeFriend.user_id) === otherId;
  const visibleThread = openForThisFriend && isOpen && activeTab === 'friends';
  if (openForThisFriend) renderDirectBubble(message);

  // Reîmprospătarea server-side dă preview/unread corecte în toate taburile.
  // Marcăm citit NUMAI dacă thread-ul este efectiv vizibil; un mesaj sosit
  // cât modalul e închis sau utilizatorul e pe Live trebuie să păstreze badge-ul.
  loadInbox(true).then(async () => {
    if (visibleThread && Number(message.recipient_id) === Number(me?.id)) {
      const fresh = dmInbox.find((row) => Number(row.user_id) === otherId) || activeFriend;
      await markDirectRead(fresh);
    }
  });
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
  img.style.display = 'block';
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
    b.style.display = 'block';
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
  body.style.display = 'flex';

  const row = document.createElement('div');
  row.className = 'msg' + (me && m.user_id === me.id ? ' msg--own' : '');
  row.style.display = 'block';

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
  body.style.display = 'flex';
  const el = document.createElement('div');
  el.className = 'msg msg--system';
  el.style.display = 'block';
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

  // Comanda locala: readuce regulamentul (nu ajunge la server).
  if (/^[-/!]regulament$/i.test(text)) {
    input.value = '';
    showRules();
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Chat-ul nu e conectat încă. Încearcă din nou într-o secundă.', 'warn');
    return;
  }

  ws.send(JSON.stringify({ type: 'chat', message: text.slice(0, 500) }));
  input.value = '';
}

/** Numele din chat: 💎 flair si 🌟 aur vin din server (atașate la handshake
 *  si stocate pe mesaj) — clientul nu le poate falsifica.
 *  FIX: numele e acum link catre profil (cerinta: click pe poza/nume -> profil + adauga prieten) */
function nameEl(m) {
  const username = m.username || 'Anon';
  const hasProfile = !!m.username;
  const u = document.createElement(hasProfile ? 'a' : 'span');
  // Culoarea numelui (shop). Validăm formatul — vine din DB-ul nostru, dar
  // aplicăm classă doar pentru id-uri cu aspect de id.
  const ncol = typeof m.name_color === 'string' && /^color_[a-z]+$/.test(m.name_color) ? m.name_color.slice(6) : '';
  // Liderul de facțiune își păstrează culoarea unică (prioritate).
  const lead = typeof m.leader_color === 'string' && /^nc-[a-z]+$/.test(m.leader_color) ? m.leader_color : '';
  u.className = 'msg__user' + (m.name_gold ? ' msg__user--gold' : '') + (lead ? ` ${lead}` : ncol ? ` nc-${ncol}` : '') + (hasProfile ? ' msg__user--link' : '');
  if (lead) u.title = '👑 Liderul facțiunii sale luna aceasta';
  else if (hasProfile) u.title = `Vezi profilul lui ${username}`;
  if (hasProfile) {
    u.href = profileHref(username);
  }
  u.textContent = (m.flair ? m.flair + ' ' : '') + username;
  return u;
}

/** Avatarul celui care vorbeste: <img> cu URL-ul din profil (poate fi GIF
 *  animat — <img> randeaza animatia nativ). Linkul picat sau gazda care
 *  blocheaza hotlinking cad pe initiala, niciodata pe imagine stricata.
 *  FIX: avatarul e link catre profil */
function avatarEl(m) {
  const username = m.username;
  const hasProfile = !!username;
  if (!m.avatar && !hasProfile) return null;

  const wrap = document.createElement(hasProfile ? 'a' : 'span');
  wrap.className = 'msg__avatar' + (hasProfile ? ' msg__avatar--link' : '');
  wrap.style.display = 'inline-grid';
  if (hasProfile) {
    wrap.href = profileHref(username);
    wrap.title = `Vezi profilul lui ${username}`;
  }

  if (m.avatar) {
    const img = document.createElement('img');
    img.src = m.avatar;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.addEventListener('error', () => {
      const fb = document.createElement('span');
      fb.className = 'msg__avatar-fb';
      fb.textContent = (username || 'A')[0].toUpperCase();
      img.replaceWith(fb);
    }, { once: true });
    wrap.appendChild(img);
  } else if (hasProfile) {
    // avatar lipsa dar avem username -> initiala ca link
    const fb = document.createElement('span');
    fb.className = 'msg__avatar-fb';
    fb.textContent = (username || 'A')[0].toUpperCase();
    wrap.appendChild(fb);
  }

  return wrap;
}
