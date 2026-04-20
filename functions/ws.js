export async function onRequest(context) {
  const { request } = context;
  
  // Upgrade la WebSocket
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);
  
  server.accept();
  
  server.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      server.send(JSON.stringify({
        type: 'message',
        username: 'User',
        message: data.message,
        timestamp: new Date().toISOString()
      }));
    } catch (err) {
      server.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
    }
  });
  
  server.addEventListener('close', () => {
    console.log('WebSocket closed');
  });
  
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
