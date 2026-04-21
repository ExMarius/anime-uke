export class ChatDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Map();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.handleConnection(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleConnection(ws) {
    const connId = crypto.randomUUID();
    this.connections.set(connId, ws);
    ws.accept();

    // Trimite ultimele 50 mesaje la conectare
    const db = this.env.DB;
    const lastMessages = await db.prepare("SELECT username, message, timestamp FROM chat_messages ORDER BY id DESC LIMIT 50").all();
    ws.send(JSON.stringify({ type: "history", messages: lastMessages.results.reverse() }));

    ws.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "chat") {
          const msg = {
            username: data.username || "Anon",
            message: data.message,
            timestamp: new Date().toISOString()
          };

          // Salvează în D1
          await this.env.DB.prepare("INSERT INTO chat_messages (username, message) VALUES (?, ?)")
            .bind(msg.username, msg.message).run();

          // Broadcast la toți
          this.broadcast(JSON.stringify({ type: "message", ...msg }));
        }
      } catch (e) {}
    });

    ws.addEventListener("close", () => this.connections.delete(connId));
  }

  broadcast(message) {
    for (const ws of this.connections.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(message);
    }
  }
}
