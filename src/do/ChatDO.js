// =====================================================================
// ChatDO — chat live prin Durable Objects.
//
// Validarea mesajelor vine din lib/validate.js (o singura sursa de adevar).
//
// BUG REPARAT (2026-09-23, raportat din productie: „nu se salveaza mesajele,
// nici stikerele"):
//
//   Varianta veche tinea mesajele intr-un buffer IN MEMORIE si le scria in D1
//   la 10 mesaje sau la alarma de 15 secunde. Cu WebSocket Hibernation API,
//   insa, Cloudflare poate evacua DO-ul ORICAND — asta e chiar ideea: nu
//   platesti durata cat timp nu se intampla nimic. La trezire constructorul
//   ruleaza din nou, deci bufferul in memorie era GOL:
//
//     mesaj → broadcast (toata lumea il vede) → buffer in memorie
//           → evictie → alarma suna pe un DO cu buffer gol
//           → flush() nu avea ce scrie → MESAJUL SE PIERDEA PENTRU TOTDEAUNA
//
//   Pe un site mic (cateva mesaje pe ora) DO-ul e evacuat intre mesaje aproape
//   mereu, deci practic NICIUN mesaj nu ajungea in D1. Local, in miniflare,
//   DO-ul nu e evacuat niciodata — de aceea toate testele treceau.
//
// DE CE NU SE MAI POATE PIERDE CEVA:
//   1. Fiecare mesaj se scrie IMEDIAT in storage-ul durabil al DO-ului
//      (`storage.put`), inainte de broadcast. Storage-ul e transactional si
//      supravietuieste evictiei/restartului, spre deosebire de memorie.
//   2. Arhivarea in D1 (pentru istoricul de durata) se face tot in loturi,
//      dar lotul se CITESTE DIN STORAGE, nu din memorie: alarma poate suna pe
//      un DO proaspat trezit si tot stie exact ce are de scris.
//   3. Dupa un flush reusit, cheile se sterg din storage; daca D1 pica,
//      mesajele raman acolo si se scriu la urmatoarea incercare (catch-up la
//      reconectare, la urmatorul mesaj sau la urmatoarea alarma).
//   4. Istoricul de la conectare combina arhiva D1 cu ce e inca in buffer,
//      fara dubluri — deci ce vezi dupa un reload e exact ce s-a scris.
//
// Costul ramane zero in plus: operatiile de storage nu sunt cereri facturate,
// iar scrierile in D1 raman in loturi (10 mesaje / 15 secunde), la fel ca
// inainte. In plus, istoricul se citeste acum din storage (cateva milisecunde,
// zero rânduri D1) atata timp cat bufferul e plin — D1 e consultat doar
// pentru partea de arhiva.
//
// Alte decizii de buget (neschimbate):
//   - WebSocket Hibernation API (ctx.acceptWebSocket): DO-ul nu ruleaza cat
//     timp e idle, deci nu consuma CPU/durata.
//   - Rate limiting per utilizator AICI, in DO — gratuit, suntem oricum in
//     acelasi request.
//   - Mesajele de sistem (intrare/iesire) se difuzeaza dar NU se persista.
// =====================================================================

const HISTORY_LIMIT = 30;        // cerinta din spec: ultimele 30 la conectare
const CHAT_KEEP_LAST = 500;      // plafon buget 0: tabelul pastreaza doar ultimele 500
const FLUSH_BATCH_SIZE = 10;     // peste atatea mesaje in buffer, scriem imediat
const FLUSH_ALARM_MS = 15_000;
const FLUSH_MAX_PER_ROUND = 100; // cat scrie intr-o singura runda catre D1
const STORAGE_CAP = 1000;        // cat poate creste bufferul durabil daca D1 e jos
const PRUNE_EVERY = 200;         // cate mesaje intre curateniile tabelului D1
const MAX_TOTAL_CONNECTIONS = 200;
const MAX_CONNECTIONS_PER_USER = 2;
const RATE_MIN_INTERVAL_MS = 1500;   // minim 1.5s intre mesaje
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;      // max 20 mesaje/minut

const MSG_PREFIX = 'm:';          // cheia unui mesaj inca nescis in D1
const SEQ_KEY = 'seqmax';         // ultimul numar de ordine scris in D1
const PRUNE_KEY = 'sinceprune';   // cate mesaje de la ultima curatenie

/** Cheie ordonabila (zero-padded) pentru un mesaj din bufferul durabil. */
const msgKey = (seq) => MSG_PREFIX + String(seq).padStart(12, '0');
const seqOf = (key) => Number(key.slice(MSG_PREFIX.length)) || 0;

/** Amprenta unui mesaj, pentru a nu-l afisa de doua ori (arhiva + buffer). */
const fingerprint = (m) => `${m.created_at}|${m.user_id}|${m.message}`;

import { validateChatMessage } from '../lib/validate.js';

export class ChatDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.seq = null;            // ultimul numar de ordine folosit (lazy)
    this.buffered = null;       // cate mesaje sunt in bufferul durabil (lazy)
    this.flushPromise = null;   // un singur flush odata (altfel se dubleaza scrierile)
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
    // Utilizatorul e validat in routes/chat.js (JWT + is_banned) INAINTE
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
      leader_color: user.leader_color || '',
      avatar: user.avatar || '',
    });

    // Nu blocam handshake-ul pe I/O
    this.state.waitUntil(this.onConnected(server, user));

    return new Response(null, { status: 101, webSocket: client });
  }

  async onConnected(ws, user) {
    const history = await this.loadHistory();

    ws.send(JSON.stringify({
      type: 'init',
      you: { id: user.id, username: user.username },
      history,
      online: this.onlineList(),
    }));

    this.broadcast({ type: 'system', text: `${user.username} a intrat în chat`, online: this.onlineList() }, ws);

    // CATCH-UP: daca DO-ul tocmai s-a trezit (evictie/restart) si are mesaje
    // in bufferul durabil, le scrie acum in arhiva. Fara asta, un DO fara
    // trafic ar astepta o alarma care poate suna pe o instanta noua.
    this.state.waitUntil(this.flush());
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
      leader_color: att.leader_color || '',
      avatar: att.avatar || '',
    };

    // --- 1. DURABIL, inainte de orice: storage-ul DO-ului supravietuieste
    //     evictiei, spre deosebire de memorie (vezi antetul modulului) ---
    await this.ensureSeq();
    const seq = ++this.seq;     // sincron: ordinea cheilor = ordinea mesajelor
    await this.state.storage.put(msgKey(seq), entry);
    this.buffered = (this.buffered || 0) + 1;

    // --- 2. Broadcast imediat (fara sa asteptam D1) ---
    this.broadcast({ type: 'message', ...entry, online: this.onlineList() });

    // --- 3. Arhivarea in D1, in loturi ---
    if (this.buffered >= FLUSH_BATCH_SIZE) {
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
    // Scriem ce a ramas in buffer (o listare de storage cand nu e nimic de scris)
    this.state.waitUntil(this.flush());
  }

  webSocketError(ws, error) {
    console.error('ChatDO ws error:', error?.message || error);
  }

  async alarm() {
    await this.flush();
    // Daca D1 a fost jos si au ramas mesaje, reprogramam (nu asteptam
    // urmatorul mesaj ca sa reincercam).
    const left = await this.state.storage.list({ prefix: MSG_PREFIX, limit: 1 });
    if (left.size > 0) await this.scheduleFlush();
  }

  // -------------------------------------------------------------------
  // Logica
  // -------------------------------------------------------------------

  /**
   * Ultimul numar de ordine folosit, luat din storage (nu din memorie!) si
   * numarul de mesaje inca nescrise in D1. Se executa o data per instanta.
   *
   * Cheile sunt zero-padded, deci ordinea lor lexicografica = ordinea reala,
   * iar `reverse: true` + `limit` ne da exact cele mai noi chei fara sa
   * listam tot bufferul (care poate avea pana la STORAGE_CAP intrari).
   */
  async ensureSeq() {
    if (this.seq !== null) return this.seq;
    const stored = Number(await this.state.storage.get(SEQ_KEY)) || 0;
    const newest = await this.state.storage.list({
      prefix: MSG_PREFIX, reverse: true, limit: FLUSH_BATCH_SIZE,
    });
    this.buffered = newest.size;
    let maxKey = 0;
    for (const key of newest.keys()) maxKey = Math.max(maxKey, seqOf(key));
    // Cheile ramase pot fi mai noi decat contorul (mesaje scrise dar
    // neflush-uite inainte de evictie), deci luam maximul.
    this.seq = Math.max(stored, maxKey);
    return this.seq;
  }

  /**
   * Istoricul de la conectare: bufferul durabil (ce inca nu e in D1) peste
   * arhiva D1, fara dubluri. Nu se bazeaza pe nicio stare din memorie, deci
   * e corect si pe un DO proaspat trezit.
   */
  async loadHistory() {
    let recent = [];
    try {
      const map = await this.state.storage.list({
        prefix: MSG_PREFIX, reverse: true, limit: HISTORY_LIMIT,
      });
      recent = [...map.values()].reverse();      // cronologic
      this.buffered = map.size;
    } catch (e) {
      console.error('ChatDO: citirea bufferului durabil a esuat:', e?.message || e);
    }

    const need = HISTORY_LIMIT - recent.length;
    const older = need > 0 ? await this.historyFromD1(need) : [];
    if (need > 0 && older.length) this.buffered = this.buffered || 0;

    // O cheie poate aparea si in arhiva si in buffer daca stergerea cheilor a
    // esuat dupa un flush reusit (retry-ul ar scrie din nou randul, dar
    // istoricul nu are voie sa arate dubluri).
    const seen = new Set(older.map(fingerprint));
    return [...older, ...recent.filter((m) => !seen.has(fingerprint(m)))];
  }

  /** Ultimele `limit` mesaje din arhiva D1, in ordine cronologica. */
  async historyFromD1(limit) {
    try {
      const res = await this.env.DB.prepare(
        `SELECT user_id, username, message, created_at, rank_label, rank_icon, staff_role, flair, name_gold, name_color, avatar
         FROM chat_messages ORDER BY id DESC LIMIT ?`
      ).bind(limit).all();
      this.buffered = this.buffered || 0;
      return (res.results || []).slice().reverse();
    } catch (e) {
      console.error('ChatDO istoric D1 esuat:', e?.message || e);
      return [];
    }
  }

  /**
   * Scrie in D1 tot ce e in bufferul durabil, apoi sterge cheile scrise.
   * Un singur flush odata: doua flush-uri paralele ar lista aceleasi chei si
   * ar insera randurile de doua ori.
   */
  async flush() {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushOnce().finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  async flushOnce() {
    const map = await this.state.storage.list({
      prefix: MSG_PREFIX, limit: FLUSH_MAX_PER_ROUND,
    });
    if (map.size === 0) {
      this.buffered = 0;
      return;
    }

    const entries = [...map.entries()];     // [cheie, mesaj], in ordine cronologica
    const stmt = this.env.DB.prepare(
      `INSERT INTO chat_messages (user_id, username, message, created_at, rank_label, rank_icon, staff_role, flair, name_gold, name_color, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // Ordinea bind-urilor TREBUIE sa fie identica cu ordinea coloanelor de
    // mai sus (bug istoric: avatarul ajungea in rank_label, iar avatarul
    // salvat era „0"/„1" — istoricul de dupa reconectare era amestecat).
    try {
      await this.env.DB.batch(entries.map(([, m]) =>
        stmt.bind(m.user_id, m.username, m.message, m.created_at,
          m.rank_label || '', m.rank_icon || '', m.staff_role || '',
          m.flair || '', m.name_gold ? 1 : 0, m.name_color || '', m.avatar || '')
      ));
    } catch (e) {
      // NU pierdem nimic: cheile raman in storage, se reincearca mai tarziu.
      console.error('ChatDO flush esuat (mesajele rămân în bufferul durabil):', e?.message || e);
      this.buffered = map.size;
      await this.enforceCap();
      return;
    }

    // Scrise cu succes → ies din bufferul durabil.
    const maxSeq = entries.reduce((mx, [key]) => Math.max(mx, seqOf(key)), 0);
    await this.state.storage.delete(entries.map(([key]) => key));
    await this.state.storage.put(SEQ_KEY, maxSeq);
    this.buffered = Math.max(0, (this.buffered || entries.length) - entries.length);

    await this.maybePrune(entries.length);
  }

  /**
   * Plafon de stocare (buget 0): pastram doar ultimele CHAT_KEEP_LAST mesaje
   * in arhiva. Se face rar — o stergere la fiecare PRUNE_EVERY mesaje scrise,
   * contor tinut in storage (nu in memorie, ca sa nu se repete dupa evictie).
   */
  async maybePrune(inserted) {
    try {
      const since = (Number(await this.state.storage.get(PRUNE_KEY)) || 0) + inserted;
      if (since < PRUNE_EVERY) {
        await this.state.storage.put(PRUNE_KEY, since);
        return;
      }
      await this.state.storage.put(PRUNE_KEY, 0);
      await this.env.DB.prepare(
        `DELETE FROM chat_messages
         WHERE id <= (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 1 OFFSET ?)`
      ).bind(CHAT_KEEP_LAST - 1).run();
    } catch (e) {
      console.error('ChatDO prune esuat:', e?.message || e);
    }
  }

  /**
   * Daca D1 e jos mult timp, bufferul durabil nu are voie sa creasca la
   * infinit (spatiul DO se plateste). Pastram cele mai noi STORAGE_CAP mesaje
   * si aruncam ce e mai vechi — sunt mesaje care oricum nu mai apar in
   * istoricul de 30 de la conectare.
   */
  async enforceCap() {
    try {
      const all = await this.state.storage.list({ prefix: MSG_PREFIX });
      if (all.size <= STORAGE_CAP) return;
      const excess = [...all.keys()].slice(0, all.size - STORAGE_CAP);
      await this.state.storage.delete(excess);
      console.error(`ChatDO: buffer durabil plin (${all.size} mesaje) — am aruncat ${excess.length} vechi`);
    } catch (e) {
      console.error('ChatDO enforceCap esuat:', e?.message || e);
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
