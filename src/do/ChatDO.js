// =====================================================================
// ChatDO — chat live prin Durable Objects.
//
// Validarea mesajelor vine din lib/validate.js (o singura sursa de adevar).
//
// DECIZII DE BUGET (plan gratuit, 1000+ utilizatori/zi):
//
// 1. WebSocket Hibernation API (ctx.acceptWebSocket) in loc de ws.accept().
//    DO-ul nu ruleaza cat timp e idle, deci nu consuma CPU/durata.
//
// 2. Istoricul e tinut IN MEMORIE si incarcat din D1 o singura data la
//    prima trezire. In v1 se facea un SELECT din D1 la FIECARE conectare —
//    la 1000 utilizatori asta insemna mii de citiri inutile pe zi.
//
// 3. Scrierile in D1 sunt BUFFER-izate si facute in loturi (flush la 10
//    mesaje sau la 15 secunde prin alarma). Cerinta „istoric salvat in D1"
//    e pastrata, dar numarul de scrieri scade de ~10x. E esential: din
//    1 sept. 2026 depasirea cotei D1 (100k scrieri/zi) face query-urile sa
//    PICCE, nu doar sa incetineasca — un flood pe chat ar fi dat jos tot
//    site-ul pana la 00:00 UTC.
//
// 4. Rate limiting per utilizator AICI, in DO — gratuit, pentru ca oricum
//    suntem in acelasi request. Nu consuma cota altui DO.
//
// 5. Mesajele de sistem (intrare/iesire) se difuzeaza dar NU se persista
//    in D1. Ar dubla scrierile fara valoare reala.
// =====================================================================

const HISTORY_LIMIT = 30;        // cerinta din spec: ultimele 30 la conectare
const HISTORY_MEMORY_CAP = 60;   // pastram putin mai multe in memorie
const CHAT_KEEP_LAST = 500;      // plafon buget 0: tabelul pastreaza doar ultimele 500
const FLUSH_BATCH_SIZE = 10;
const FLUSH_ALARM_MS = 15_000;
const MAX_TOTAL_CONNECTIONS = 200;
const MAX_CONNECTIONS_PER_USER = 2;
const RATE_MIN_INTERVAL_MS = 1500;   // minim 1.5s intre mesaje
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;      // max 20 mesaje/minut

import { validateChatMessage } from '../lib/validate.js';

export class ChatDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.history = null;        // incarcat lazy din D1
    this.pending = [];          // buffer de scrieri catre D1
    this.rate = new Map();      // userId -> { last, stamps: [] }
  }

  // -------------------------------------------------------------------
  // Rutare
  // -------------------------------------------------------------------
  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleUpgrade(request, url);
    }

    // GET /chat?state=online — folosit de client la reconnectare
    if (url.pathname.endsWith('/state')) {
      return Response.json({ online: this.onlineList() });
    }

    return new Response('Expected WebSocket', { status: 400 });
  }

  handleUpgrade(request, url) {
    // Utilizatorul e validat in functions/chat.js (JWT + is_banned) INAINTE
    // sa ajunga aici, deci putem avea incredere in parametru.
    let user;
    try {
      user = JSON.parse(url.searchParams.get('u') || 'null');
    } catch {
      user = null;
    }
    if (!user || !user.id || !user.username) {
      return new Response('Unauthorized', { status: 401 });
    }

    const sockets = this.state.getWebSockets();
    if (sockets.length >= MAX_TOTAL_CONNECTIONS) {
      return new Response('Chat plin, incearca mai tarziu', { status: 503 });
    }

    const sameUser = sockets.filter((ws) => ws.deserializeAttachment()?.userId === user.id);
    if (sameUser.length >= MAX_CONNECTIONS_PER_USER) {
      // Inchidem cea mai veche conexiune a aceluiasi user (ex. tab uitat deschis)
      sameUser[0].close(4000, 'Prea multe taburi deschise');
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    server.serializeAttachment({
      userId: user.id, username: user.username,
      rank_label: user.rank_label || '', rank_icon: user.rank_icon || '', staff_role: user.staff_role || '',
      flair: user.flair || '', name_gold: user.name_gold ? 1 : 0,
      name_color: user.name_color || '',
      avatar: user.avatar || '',
    });

    // Nu blocam handshake-ul pe I/O
    this.state.waitUntil(this.onConnected(server, user));

    return new Response(null, { status: 101, webSocket: client });
  }

  async onConnected(ws, user) {
    const history = await this.ensureHistory();

    ws.send(JSON.stringify({
      type: 'init',
      you: { id: user.id, username: user.username },
      history,
      online: this.onlineList(),
    }));

    this.broadcast({ type: 'system', text: `${user.username} a intrat în chat`, online: this.onlineList() }, ws);
  }

  // -------------------------------------------------------------------
  // Hibernation API handlers
  // -------------------------------------------------------------------
  async webSocketMessage(ws, raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // nu raspundem la gunoi
    }

    const att = ws.deserializeAttachment();
    if (!att?.userId) {
      ws.close(4001, 'Sesiune invalida');
      return;
    }

    if (data.type !== 'chat') return;

    // --- rate limit per utilizator ---
    const verdict = this.checkRate(att.userId);
    if (!verdict.ok) {
      ws.send(JSON.stringify({ type: 'error', text: verdict.error }));
      return;
    }

    const v = validateChatMessage(String(data.message ?? ''));
    if (!v.ok) return;
    const message = v.value;

    const entry = {
      user_id: att.userId,
      username: att.username,
      message,
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      // identitatea vine verificata din ruta /chat (session + D1)
      rank_label: att.rank_label || '',
      rank_icon: att.rank_icon || '',
      staff_role: att.staff_role || '',
      flair: att.flair || '',
      name_gold: att.name_gold ? 1 : 0,
      name_color: att.name_color || '',
      avatar: att.avatar || '',
    };

    // --- broadcast imediat (fara sa asteptam D1) ---
    this.broadcast({ type: 'message', ...entry, online: this.onlineList() });

    // --- buffer pentru D1 ---
    this.history = this.history || [];
    this.history.push(entry);
    if (this.history.length > HISTORY_MEMORY_CAP) {
      this.history.splice(0, this.history.length - HISTORY_MEMORY_CAP);
    }

    this.pending.push(entry);
    if (this.pending.length >= FLUSH_BATCH_SIZE) {
      this.state.waitUntil(this.flush());
    } else {
      this.state.waitUntil(this.scheduleFlush());
    }
  }

  webSocketClose(ws, code, reason, wasClean) {
    const att = ws.deserializeAttachment();
    this.rate.delete(att?.userId);
    if (att?.username) {
      this.broadcast({
        type: 'system',
        text: `${att.username} a ieșit din chat`,
        online: this.onlineList(),
      });
    }
    // Flusam ce a ramas in buffer la deconectare
    if (this.pending.length) this.state.waitUntil(this.flush());
  }

  webSocketError(ws, error) {
    console.error('ChatDO ws error:', error?.message || error);
  }

  async alarm() {
    await this.flush();
  }

  // -------------------------------------------------------------------
  // Logica
  // -------------------------------------------------------------------
  async ensureHistory() {
    if (this.history) return this.history.slice(-HISTORY_LIMIT);
    try {
      const res = await this.env.DB.prepare(
        `SELECT user_id, username, message, created_at, rank_label, rank_icon, staff_role, flair, name_gold, name_color, avatar
         FROM chat_messages ORDER BY id DESC LIMIT ?`
      ).bind(HISTORY_LIMIT).all();

      // D1 il punem in memorie in ordine cronologica
      this.history = (res.results || []).slice().reverse();
    } catch (e) {
      console.error('ChatDO istoric esuat:', e?.message || e);
      this.history = [];
    }
    return this.history;
  }

  /** Scrie buffer-ul in D1 intr-un singur batch (1 tranzactie = putine scrieri). */
  async flush() {
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];

    try {
      const stmt = this.env.DB.prepare(
        `INSERT INTO chat_messages (user_id, username, message, created_at, rank_label, rank_icon, staff_role, flair, name_gold, name_color, avatar)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      // Ordinea bind-urilor TREBUIE sa fie identica cu ordinea coloanelor de
      // mai sus (bug istoric: avatarul ajungea in rank_label, iar avatarul
      // salvat era „0"/„1" — istoricul de dupa reconectare era amestecat).
      await this.env.DB.batch(batch.map((m) =>
        stmt.bind(m.user_id, m.username, m.message, m.created_at,
          m.rank_label || '', m.rank_icon || '', m.staff_role || '',
          m.flair || '', m.name_gold ? 1 : 0, m.name_color || '', m.avatar || '')
      ));
    } catch (e) {
      console.error('ChatDO flush esuat:', e?.message || e);
      // Repunem in buffer ca sa nu pierdem mesajele (max o data, ca sa nu creasca la infinit)
      if (batch.length <= FLUSH_BATCH_SIZE * 3) this.pending.unshift(...batch);
      return;
    }

    // --- plafon de stocare (buget 0) ---
    // Pastram doar ultimele CHAT_KEEP_LAST mesaje, ca tabelul sa nu creasca
    // nelimitat intr-o comunitate de 1000 de oameni. Nu „uitam" istoria:
    // interogarea de istoric citeaza oricum ultimele 30. O facem rar (1 din
    // 20 flush-uri) ca sa nu ardem citiri D1 degeaba.
    this.flushCount = (this.flushCount || 0) + 1;
    if (this.flushCount % 20 === 1) {
      try {
        await this.env.DB.prepare(
          `DELETE FROM chat_messages
           WHERE id <= (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 1 OFFSET ?)`
        ).bind(CHAT_KEEP_LAST - 1).run();
      } catch (e) {
        console.error('ChatDO prune esuat:', e?.message || e);
      }
    }
  }

  async scheduleFlush() {
    const current = await this.state.storage.getAlarm();
    if (!current) this.state.storage.setAlarm(Date.now() + FLUSH_ALARM_MS);
  }

  checkRate(userId) {
    const now = Date.now();
    let rec = this.rate.get(userId);
    if (!rec) {
      rec = { last: 0, stamps: [] };
      this.rate.set(userId, rec);
    }

    if (now - rec.last < RATE_MIN_INTERVAL_MS) {
      return { ok: false, error: 'Prea repede — mai asteapta putin.' };
    }

    rec.stamps = rec.stamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (rec.stamps.length >= RATE_MAX_PER_WINDOW) {
      return { ok: false, error: 'Ai trimis prea multe mesaje. Incearca peste un minut.' };
    }

    rec.last = now;
    rec.stamps.push(now);
    return { ok: true };
  }

  /** Lista utilizatorilor online, deduplicata (un user poate avea 2 taburi). */
  onlineList() {
    const seen = new Map();
    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att?.userId && !seen.has(att.userId)) {
        seen.set(att.userId, att);
      }
    }
    return [...seen.entries()].map(([id, att]) => ({
      id, username: att.username,
      rank_label: att.rank_label || '', rank_icon: att.rank_icon || '', staff_role: att.staff_role || '',
      avatar: att.avatar || '',
    }));
  }

  broadcast(payload, except = null) {
    const text = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(text);
      } catch {
        // conexiune moarta; o curata webSocketClose
      }
    }
  }
}
