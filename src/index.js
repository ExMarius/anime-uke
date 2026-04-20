// src/index.js
import { ChatRoom } from './chat-room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Rutele pentru API-urile existente
    if (url.pathname.startsWith('/api/')) {
      // Aici pui API-urile tale existente (auth, episodes, etc.)
      return handleApi(request, env);
    }

    // Rută pentru WebSocket chat
    if (url.pathname === '/ws') {
      // Verifică dacă utilizatorul este autentificat (folosește JWT)
      const cookie = request.headers.get('Cookie') || '';
      const tokenMatch = cookie.match(/auth_token=([^;]+)/);
      
      if (!tokenMatch) {
        return new Response('Neautorizat', { status: 401 });
      }

      // Extrage roomId din URL (ex: /ws?room=general)
      const roomId = url.searchParams.get('room') || 'general';
      
      // Creează sau obține instanța Durable Object pentru camera respectivă
      const id = env.CHAT_ROOM.idFromName(roomId);
      const chatRoom = env.CHAT_ROOM.get(id);
      
      // Adaugă username și userId la URL pentru Durable Object
      // (le-ai extras din JWT în realitate)
      const username = url.searchParams.get('username') || 'Anonim';
      const userId = crypto.randomUUID();
      
      const newUrl = new URL(request.url);
      newUrl.searchParams.set('username', username);
      newUrl.searchParams.set('userId', userId);
      
      const upgradedRequest = new Request(newUrl, request);
      return chatRoom.fetch(upgradedRequest);
    }

    // Pentru fișiere statice, returnează din Pages
    return env.ASSETS.fetch(request);
  }
};

// Configurarea Durable Object în wrangler.toml
export { ChatRoom };
