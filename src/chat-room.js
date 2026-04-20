// src/chat-room.js
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Stochează conexiunile active
    this.sessions = new Map(); // websocket -> { username, userId }
  }

  // Metoda principală - primește conexiuni WebSocket
  async fetch(request) {
    // Creează perechea WebSocket (client + server)
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Acceptă conexiunea WebSocket cu suport pentru hibernare
    this.state.acceptWebSocket(server);

    // Parsează URL-ul pentru parametrii (username, userId)
    const url = new URL(request.url);
    const username = url.searchParams.get('username') || 'Anonim';
    const userId = url.searchParams.get('userId') || crypto.randomUUID();

    // Salvează informațiile utilizatorului
    this.sessions.set(server, { username, userId });

    // Trimite istoricul mesajelor (dacă există în D1)
    await this.sendChatHistory(server);

    // Trimite lista utilizatorilor online
    this.broadcastUserList();

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // Trimite istoricul mesajelor din D1
  async sendChatHistory(ws) {
    if (!this.env.DB) return;

    const history = await this.env.DB.prepare(
      `SELECT username, message, created_at 
       FROM chat_messages 
       ORDER BY created_at DESC 
       LIMIT 50`
    ).all();

    ws.send(JSON.stringify({
      type: 'history',
      messages: history.results.reverse()
    }));
  }

  // Când o conexiune WebSocket este deschisă
  async webSocketOpen(ws) {
    console.log('Conexiune deschisă');
  }

  // Când primește un mesaj de la client
  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;

    try {
      const data = JSON.parse(message);
      
      if (data.type === 'message') {
        // Salvează mesajul în D1 (opțional)
        if (this.env.DB) {
          await this.env.DB.prepare(
            `INSERT INTO chat_messages (id, username, user_id, message, created_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
          ).bind(
            crypto.randomUUID(),
            session.username,
            session.userId,
            data.message
          ).run();
        }

        // Difuzează mesajul către toți ceilalți
        const broadcastMessage = JSON.stringify({
          type: 'message',
          username: session.username,
          userId: session.userId,
          message: data.message,
          timestamp: new Date().toISOString()
        });

        for (const [client, clientSession] of this.sessions) {
          if (client !== ws) {
            client.send(broadcastMessage);
          }
        }
      }
    } catch (err) {
      console.error('Eroare procesare mesaj:', err);
    }
  }

  // Când o conexiune se închide
  async webSocketClose(ws) {
    const session = this.sessions.get(ws);
    if (session) {
      this.sessions.delete(ws);
      this.broadcastUserList();
    }
  }

  // Difuzează lista utilizatorilor online
  broadcastUserList() {
    const users = Array.from(this.sessions.values()).map(s => ({
      username: s.username,
      userId: s.userId
    }));

    const userListMessage = JSON.stringify({
      type: 'users',
      users: users
    });

    for (const [client] of this.sessions) {
      client.send(userListMessage);
    }
  }
}
