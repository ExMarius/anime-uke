// src/chat-room.js
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    const url = new URL(request.url);
    const username = url.searchParams.get('username') || 'Anonim';
    const userId = url.searchParams.get('userId') || crypto.randomUUID();
    
    this.state.acceptWebSocket(server);
    this.sessions.set(server, { username, userId });
    
    // Trimite istoricul mesajelor
    await this.sendChatHistory(server);
    
    // Anunță toți utilizatorii despre noul venit
    this.broadcast({
      type: 'system',
      message: `${username} s-a alăturat chatului.`
    });
    
    this.broadcastUserList();
    
    return new Response(null, { status: 101, webSocket: client });
  }
  
  async sendChatHistory(ws) {
    if (!this.env.DB) return;
    
    const history = await this.env.DB.prepare(
      `SELECT username, message, created_at 
       FROM chat_messages 
       ORDER BY created_at DESC 
       LIMIT 30`
    ).all();
    
    ws.send(JSON.stringify({
      type: 'history',
      messages: (history.results || []).reverse()
    }));
  }
  
  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;
    
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'message' && data.message && data.message.trim()) {
        const msgText = data.message.trim().substring(0, 500);
        
        // Salvează în D1
        if (this.env.DB) {
          await this.env.DB.prepare(
            `INSERT INTO chat_messages (id, username, user_id, message, created_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
          ).bind(crypto.randomUUID(), session.username, session.userId, msgText).run();
        }
        
        // Difuzează către toți
        this.broadcast({
          type: 'message',
          username: session.username,
          userId: session.userId,
          message: msgText,
          timestamp: new Date().toISOString()
        }, ws);
      }
    } catch (err) {
      console.error('Chat message error:', err);
    }
  }
  
  async webSocketClose(ws) {
    const session = this.sessions.get(ws);
    if (session) {
      this.sessions.delete(ws);
      this.broadcast({
        type: 'system',
        message: `${session.username} a părăsit chatul.`
      });
      this.broadcastUserList();
    }
  }
  
  broadcast(message, excludeWs = null) {
    for (const [client] of this.sessions) {
      if (client !== excludeWs) {
        try {
          client.send(JSON.stringify(message));
        } catch (err) {
          console.error('Broadcast error:', err);
        }
      }
    }
  }
  
  broadcastUserList() {
    const users = Array.from(this.sessions.values()).map(s => ({
      username: s.username,
      userId: s.userId
    }));
    
    this.broadcast({
      type: 'users',
      users: users
    });
  }
}
