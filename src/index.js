// src/index.js - Router principal
import { ChatRoom } from './chat-room.js';
import { 
  handleRegister, 
  handleLogin, 
  handleLogout, 
  handleGetMe,
  verifyAuth 
} from './auth.js';
import {
  handleGetSeries,
  handleGetSeriesById,
  handleGetEpisodes,
  handleGetEpisode,
  handleMarkWatched,
  handleAddView
} from './episodes.js';
import {
  handleAddSeries,
  handleAddEpisode,
  handleDeleteEpisode
} from './admin.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ============ API AUTH ============
    if (path === '/api/auth/register' && method === 'POST') {
      return handleRegister(request, env);
    }
    if (path === '/api/auth/login' && method === 'POST') {
      return handleLogin(request, env);
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      return handleLogout();
    }
    if (path === '/api/auth/me' && method === 'GET') {
      return handleGetMe(request, env);
    }

    // ============ API SERIES ============
    if (path === '/api/series' && method === 'GET') {
      return handleGetSeries(env);
    }
    if (path.match(/^\/api\/series\/[^\/]+$/) && method === 'GET') {
      return handleGetSeriesById(request, env);
    }

    // ============ API EPISODES ============
    if (path === '/api/episodes' && method === 'GET') {
      return handleGetEpisodes(request, env);
    }
    if (path.match(/^\/api\/episode\/[^\/]+$/) && method === 'GET') {
      return handleGetEpisode(request, env);
    }
    if (path === '/api/episodes/watch' && method === 'POST') {
      return handleMarkWatched(request, env);
    }
    if (path === '/api/episodes/view' && method === 'POST') {
      return handleAddView(request, env);
    }

    // ============ API ADMIN (protejate) ============
    if (path === '/api/admin/series' && method === 'POST') {
      const user = await verifyAuth(request, env);
      if (!user || user.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Neautorizat' }), { status: 403 });
      }
      return handleAddSeries(request, env);
    }
    if (path === '/api/admin/episodes' && method === 'POST') {
      const user = await verifyAuth(request, env);
      if (!user || user.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Neautorizat' }), { status: 403 });
      }
      return handleAddEpisode(request, env);
    }
    if (path === '/api/admin/episodes' && method === 'DELETE') {
      const user = await verifyAuth(request, env);
      if (!user || user.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Neautorizat' }), { status: 403 });
      }
      return handleDeleteEpisode(request, env);
    }

    // ============ WEBSOCKET CHAT ============
    if (path === '/ws') {
      const user = await verifyAuth(request, env);
      if (!user) {
        return new Response('Neautorizat', { status: 401 });
      }
      
      const roomId = url.searchParams.get('room') || 'general';
      const id = env.CHAT_ROOM.idFromName(roomId);
      const chatRoom = env.CHAT_ROOM.get(id);
      
      const newUrl = new URL(request.url);
      newUrl.searchParams.set('username', user.username);
      newUrl.searchParams.set('userId', user.id);
      
      return chatRoom.fetch(new Request(newUrl, request));
    }

    // ============ PAGINI STATICE ============
    // Pentru pagini HTML, servește din folderul public/
    // Dacă e deploy pe Pages, ASSETS face asta automat
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Pagina nu există', { status: 404 });
  }
};

export { ChatRoom };
