// Anime Uke - Cloudflare Worker Backend
// Acest fișier rulează pe Cloudflare Workers și gestionează toate API-urile

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        if (method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // ==================== AUTENTIFICARE ====================
        
        // Register
        if (path === '/api/auth/register' && method === 'POST') {
            try {
                const { username, email, password } = await request.json();
                
                if (!username || username.length < 3) {
                    return jsonResponse({ success: false, message: 'Numele utilizator trebuie să aibă minim 3 caractere' }, 400, corsHeaders);
                }
                if (!email || !email.includes('@')) {
                    return jsonResponse({ success: false, message: 'Email invalid' }, 400, corsHeaders);
                }
                if (!password || password.length < 6) {
                    return jsonResponse({ success: false, message: 'Parola trebuie să aibă minim 6 caractere' }, 400, corsHeaders);
                }
                
                // Check if user exists
                const existingUser = await env.DB.prepare('SELECT id FROM users WHERE username = ? OR email = ?').bind(username, email).first();
                if (existingUser) {
                    return jsonResponse({ success: false, message: 'Utilizator sau email deja existent' }, 400, corsHeaders);
                }
                
                // Hash password (simplificat - în producție folosește bcrypt sau argon2)
                const hashedPassword = await hashPassword(password);
                
                // Create user
                const result = await env.DB.prepare(
                    'INSERT INTO users (username, email, password, gold, xp, level, role) VALUES (?, ?, ?, 100, 0, 1, "user")'
                ).bind(username, email, hashedPassword).run();
                
                return jsonResponse({ success: true, message: 'Cont creat cu succes' }, 201, corsHeaders);
            } catch (error) {
                console.error(error);
                return jsonResponse({ success: false, message: 'Eroare internă' }, 500, corsHeaders);
            }
        }
        
        // Login
        if (path === '/api/auth/login' && method === 'POST') {
            try {
                const { username, password, remember } = await request.json();
                
                const user = await env.DB.prepare('SELECT * FROM users WHERE username = ? OR email = ?').bind(username, username).first();
                if (!user) {
                    return jsonResponse({ success: false, message: 'Utilizator sau parolă incorectă' }, 401, corsHeaders);
                }
                
                const validPassword = await verifyPassword(password, user.password);
                if (!validPassword) {
                    return jsonResponse({ success: false, message: 'Utilizator sau parolă incorectă' }, 401, corsHeaders);
                }
                
                // Generate session token
                const token = generateToken(user.id);
                const expires = remember ? 30 : 1;
                await env.KV.put(`session:${token}`, JSON.stringify({ userId: user.id, expires: Date.now() + expires * 86400000 }), { expirationTtl: expires * 86400 });
                
                return jsonResponse({
                    success: true,
                    token: token,
                    user: { id: user.id, username: user.username, email: user.email, role: user.role, gold: user.gold, xp: user.xp, level: user.level }
                }, 200, corsHeaders);
            } catch (error) {
                console.error(error);
                return jsonResponse({ success: false, message: 'Eroare internă' }, 500, corsHeaders);
            }
        }
        
        // Get current user
        if (path === '/api/auth/me' && method === 'GET') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) {
                return jsonResponse({ success: false, message: 'Neautorizat' }, 401, corsHeaders);
            }
            
            const user = await env.DB.prepare('SELECT id, username, email, role, gold, xp, level FROM users WHERE id = ?').bind(userId).first();
            return jsonResponse({ success: true, user }, 200, corsHeaders);
        }
        
        // Logout
        if (path === '/api/auth/logout' && method === 'POST') {
            const token = getTokenFromRequest(request);
            if (token) {
                await env.KV.delete(`session:${token}`);
            }
            return jsonResponse({ success: true }, 200, corsHeaders);
        }
        
        // ==================== UTILIZATOR ====================
        
        // Get user profile
        if (path === '/api/user/profile' && method === 'GET') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) return jsonResponse({ success: false }, 401, corsHeaders);
            
            const user = await env.DB.prepare('SELECT gold, xp, level FROM users WHERE id = ?').bind(userId).first();
            const nextLevelXP = (user.level + 1) * 100;
            
            return jsonResponse({ success: true, gold: user.gold, xp: user.xp, level: user.level, nextLevelXP }, 200, corsHeaders);
        }
        
        // Get user preferences
        if (path === '/api/user/preferences' && method === 'GET') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) return jsonResponse({}, 401, corsHeaders);
            
            const prefs = await env.DB.prepare('SELECT preferred_server FROM user_preferences WHERE user_id = ?').bind(userId).first();
            return jsonResponse({ preferred_server: prefs?.preferred_server || 'DoodStream' }, 200, corsHeaders);
        }
        
        // Update user preferences
        if (path === '/api/user/preferences' && method === 'PUT') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) return jsonResponse({ success: false }, 401, corsHeaders);
            
            const { preferred_server } = await request.json();
            await env.DB.prepare(`
                INSERT INTO user_preferences (user_id, preferred_server) 
                VALUES (?, ?) 
                ON CONFLICT(user_id) DO UPDATE SET preferred_server = excluded.preferred_server
            `).bind(userId, preferred_server).run();
            
            return jsonResponse({ success: true }, 200, corsHeaders);
        }
        
        // Get recent views
        if (path === '/api/user/recent-views' && method === 'GET') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) return jsonResponse({ views: [] }, 200, corsHeaders);
            
            const views = await env.DB.prepare(`
                SELECT v.*, s.name as series_name, s.slug as series_slug, e.title 
                FROM views v
                JOIN episodes e ON v.episode_id = e.id
                JOIN series s ON e.series_id = s.id
                WHERE v.user_id = ?
                ORDER BY v.viewed_at DESC
                LIMIT 10
            `).bind(userId).all();
            
            return jsonResponse({ views: views.results }, 200, corsHeaders);
        }
        
        // Get recent comments
        if (path === '/api/user/recent-comments' && method === 'GET') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) return jsonResponse({ comments: [] }, 200, corsHeaders);
            
            const comments = await env.DB.prepare(`
                SELECT c.*, s.name as series_name, s.slug as series_slug, e.episode_number
                FROM comments c
                JOIN episodes e ON c.episode_id = e.id
                JOIN series s ON e.series_id = s.id
                WHERE c.user_id = ?
                ORDER BY c.created_at DESC
                LIMIT 10
            `).bind(userId).all();
            
            return jsonResponse({ comments: comments.results }, 200, corsHeaders);
        }
        
        // ==================== SERII ====================
        
        // Get all series
        if (path === '/api/series' && method === 'GET') {
            const series = await env.DB.prepare('SELECT * FROM series ORDER BY name').all();
            return jsonResponse(series.results, 200, corsHeaders);
        }
        
        // Get single series
        if (path.match(/^\/api\/series\/[^\/]+$/) && method === 'GET') {
            const slug = path.split('/').pop();
            const series = await env.DB.prepare('SELECT * FROM series WHERE slug = ?').bind(slug).first();
            
            if (!series) {
                return jsonResponse({ error: 'Serie negăsită' }, 404, corsHeaders);
            }
            
            // Get average rating
            const rating = await env.DB.prepare('SELECT AVG(rating) as avg FROM ratings WHERE series_id = ?').bind(series.id).first();
            series.avg_rating = rating?.avg ? Math.round(rating.avg * 10) / 10 : 0;
            
            return jsonResponse(series, 200, corsHeaders);
        }
        
        // Get episodes by series
        if (path.match(/^\/api\/series\/[^\/]+\/episodes$/) && method === 'GET') {
            const slug = path.split('/')[3];
            const series = await env.DB.prepare('SELECT id FROM series WHERE slug = ?').bind(slug).first();
            
            if (!series) {
                return jsonResponse({ episodes: [] }, 200, corsHeaders);
            }
            
            const episodes = await env.DB.prepare('SELECT id, episode_number, title, servers FROM episodes WHERE series_id = ? ORDER BY episode_number').bind(series.id).all();
            
            // Parse servers JSON
            const parsedEpisodes = episodes.results.map(ep => ({
                ...ep,
                servers: JSON.parse(ep.servers || '{}')
            }));
            
            return jsonResponse({ episodes: parsedEpisodes }, 200, corsHeaders);
        }
        
        // Get single episode
        if (path.match(/^\/api\/series\/[^\/]+\/episode\/\d+$/) && method === 'GET') {
            const parts = path.split('/');
            const slug = parts[3];
            const episodeNumber = parseInt(parts[5]);
            
            const series = await env.DB.prepare('SELECT id, name, slug FROM series WHERE slug = ?').bind(slug).first();
            if (!series) {
                return jsonResponse({ error: 'Serie negăsită' }, 404, corsHeaders);
            }
            
            const episode = await env.DB.prepare('SELECT * FROM episodes WHERE series_id = ? AND episode_number = ?').bind(series.id, episodeNumber).first();
            if (!episode) {
                return jsonResponse({ error: 'Episod negăsit' }, 404, corsHeaders);
            }
            
            // Parse servers
            episode.servers = JSON.parse(episode.servers || '{}');
            
            // Get prev/next episodes
            const prevEpisode = await env.DB.prepare('SELECT episode_number FROM episodes WHERE series_id = ? AND episode_number < ? ORDER BY episode_number DESC LIMIT 1').bind(series.id, episodeNumber).first();
            const nextEpisode = await env.DB.prepare('SELECT episode_number FROM episodes WHERE series_id = ? AND episode_number > ? ORDER BY episode_number LIMIT 1').bind(series.id, episodeNumber).first();
            
            return jsonResponse({
                episode: { ...episode, prev_episode: prevEpisode?.episode_number, next_episode: nextEpisode?.episode_number },
                series: { id: series.id, name: series.name, slug: series.slug }
            }, 200, corsHeaders);
        }
        
        // Get latest episodes
        if (path === '/api/episodes/latest' && method === 'GET') {
            const episodes = await env.DB.prepare(`
                SELECT e.*, s.name as series_name, s.slug as series_slug, s.image_url
                FROM episodes e
                JOIN series s ON e.series_id = s.id
                ORDER BY e.created_at DESC
                LIMIT 12
            `).all();
            
            return jsonResponse(episodes.results, 200, corsHeaders);
        }
        
        // Get all episodes (admin)
        if (path === '/api/episodes/all' && method === 'GET') {
            const episodes = await env.DB.prepare(`
                SELECT e.*, s.name as series_name, s.slug as series_slug
                FROM episodes e
                JOIN series s ON e.series_id = s.id
                ORDER BY e.created_at DESC
            `).all();
            
            const parsed = episodes.results.map(ep => ({
                ...ep,
                servers: JSON.parse(ep.servers || '{}')
            }));
            
            return jsonResponse(parsed, 200, corsHeaders);
        }
        
        // Get episodes by series ID (admin filter)
        if (path.match(/^\/api\/episodes\/series\/\d+$/) && method === 'GET') {
            const seriesId = parseInt(path.split('/').pop());
            const episodes = await env.DB.prepare(`
                SELECT e.*, s.name as series_name
                FROM episodes e
                JOIN series s ON e.series_id = s.id
                WHERE e.series_id = ?
                ORDER BY e.episode_number
            `).bind(seriesId).all();
            
            return jsonResponse(episodes.results, 200, corsHeaders);
        }
        
        // ==================== VIZIONĂRI ====================
        
        // Mark episode as watched
        if (path === '/api/episode/watched' && method === 'POST') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) return jsonResponse({ success: false }, 401, corsHeaders);
            
            const { series_slug, episode_number } = await request.json();
            
            const series = await env.DB.prepare('SELECT id FROM series WHERE slug = ?').bind(series_slug).first();
            if (!series) return jsonResponse({ success: false }, 404, corsHeaders);
            
            const episode = await env.DB.prepare('SELECT id FROM episodes WHERE series_id = ? AND episode_number = ?').bind(series.id, episode_number).first();
            if (!episode) return jsonResponse({ success: false }, 404, corsHeaders);
            
            // Check if already watched
            const existing = await env.DB.prepare('SELECT id FROM views WHERE user_id = ? AND episode_id = ?').bind(userId, episode.id).first();
            if (existing) {
                return jsonResponse({ success: false, message: 'Deja vizionat' }, 200, corsHeaders);
            }
            
            // Add view
            await env.DB.prepare('INSERT INTO views (user_id, episode_id) VALUES (?, ?)').bind(userId, episode.id).run();
            
            // Add XP and Gold
            const goldEarned = 5;
            const xpEarned = 10;
            await env.DB.prepare('UPDATE users SET gold = gold + ?, xp = xp + ? WHERE id = ?').bind(goldEarned, xpEarned, userId).run();
            
            // Check level up
            const user = await env.DB.prepare('SELECT xp, level FROM users WHERE id = ?').bind(userId).first();
            const nextLevelXP = (user.level + 1) * 100;
            if (user.xp >= nextLevelXP) {
                await env.DB.prepare('UPDATE users SET level = level + 1 WHERE id = ?').bind(userId).run();
            }
            
            return jsonResponse({ success: true, gold_earned: goldEarned }, 200, corsHeaders);
        }
        
        // Check if episode is watched
        if (path.match(/^\/api\/episode\/watched\/[^\/]+\/\d+$/) && method === 'GET') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) return jsonResponse({ watched: false }, 200, corsHeaders);
            
            const parts = path.split('/');
            const seriesSlug = parts[4];
            const episodeNumber = parseInt(parts[5]);
            
            const series = await env.DB.prepare('SELECT id FROM series WHERE slug = ?').bind(seriesSlug).first();
            if (!series) return jsonResponse({ watched: false }, 200, corsHeaders);
            
            const episode = await env.DB.prepare('SELECT id FROM episodes WHERE series_id = ? AND episode_number = ?').bind(series.id, episodeNumber).first();
            if (!episode) return jsonResponse({ watched: false }, 200, corsHeaders);
            
            const view = await env.DB.prepare('SELECT id FROM views WHERE user_id = ? AND episode_id = ?').bind(userId, episode.id).first();
            
            return jsonResponse({ watched: !!view }, 200, corsHeaders);
        }
        
        // ==================== COMENTARII ====================
        
        // Get comments for episode
        if (path.match(/^\/api\/comments\/[^\/]+\/\d+$/) && method === 'GET') {
            const parts = path.split('/');
            const seriesSlug = parts[3];
            const episodeNumber = parseInt(parts[4]);
            
            const series = await env.DB.prepare('SELECT id FROM series WHERE slug = ?').bind(seriesSlug).first();
            if (!series) return jsonResponse({ comments: [] }, 200, corsHeaders);
            
            const episode = await env.DB.prepare('SELECT id FROM episodes WHERE series_id = ? AND episode_number = ?').bind(series.id, episodeNumber).first();
            if (!episode) return jsonResponse({ comments: [] }, 200, corsHeaders);
            
            const comments = await env.DB.prepare(`
                SELECT c.*, u.username 
                FROM comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.episode_id = ?
                ORDER BY c.created_at ASC
            `).bind(episode.id).all();
            
            return jsonResponse({ comments: comments.results }, 200, corsHeaders);
        }
        
        // Post comment
        if (path === '/api/comments' && method === 'POST') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) return jsonResponse({ success: false, message: 'Trebuie să fii logat' }, 401, corsHeaders);
            
            const { series_slug, episode_number, content, parent_id } = await request.json();
            
            if (!content || content.length < 10) {
                return jsonResponse({ success: false, message: 'Comentariul trebuie să aibă minim 10 caractere' }, 400, corsHeaders);
            }
            
            const series = await env.DB.prepare('SELECT id FROM series WHERE slug = ?').bind(series_slug).first();
            if (!series) return jsonResponse({ success: false }, 404, corsHeaders);
            
            const episode = await env.DB.prepare('SELECT id FROM episodes WHERE series_id = ? AND episode_number = ?').bind(series.id, episode_number).first();
            if (!episode) return jsonResponse({ success: false }, 404, corsHeaders);
            
            await env.DB.prepare('INSERT INTO comments (user_id, episode_id, content, parent_id) VALUES (?, ?, ?, ?)')
                .bind(userId, episode.id, content, parent_id || null).run();
            
            return jsonResponse({ success: true }, 201, corsHeaders);
        }
        
        // Vote comment
        if (path === '/api/comments/vote' && method === 'POST') {
            const userId = await getUserIdFromRequest(request, env);
            if (!userId) return jsonResponse({ success: false }, 401, corsHeaders);
            
            const { comment_id } = await request.json();
            
            // Check if already voted
            const existing = await env.DB.prepare('SELECT id FROM comment_votes WHERE user_id = ? AND comment_id = ?').bind(userId, comment_id).first();
            if (existing) {
                return jsonResponse({ success: false, message: 'Ai votat deja' }, 400, corsHeaders);
            }
            
            await env.DB.prepare('INSERT INTO comment_votes (user_id, comment_id) VALUES (?, ?)').bind(userId, comment_id).run();
            await env.DB.prepare('UPDATE comments SET votes = votes + 1 WHERE id = ?').bind(comment_id).run();
            
            const comment = await env.DB.prepare('SELECT votes FROM comments WHERE id = ?').bind(comment_id).first();
            
            return jsonResponse({ success: true, votes: comment.votes }, 200, corsHeaders);
        }
        
        // ==================== ADMIN ====================
        
        // Add series
        if (path === '/api/admin/series' && method === 'POST') {
            const userId = await getUserIdFromRequest(request, env);
            const user = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
            if (!user || user.role !== 'admin') {
                return jsonResponse({ success: false, message: 'Neautorizat' }, 403, corsHeaders);
            }
            
            const { name, slug, description, image_url, min_age, type } = await request.json();
            const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            
            await env.DB.prepare('INSERT INTO series (name, slug, description, image_url, min_age, type) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(name, finalSlug, description, image_url, min_age || 13, type || 'anime').run();
            
            return jsonResponse({ success: true }, 201, corsHeaders);
        }
        
        // Add episode
        if (path === '/api/admin/episode' && method === 'POST') {
            const userId = await getUserIdFromRequest(request, env);
            const user = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
            if (!user || user.role !== 'admin') {
                return jsonResponse({ success: false, message: 'Neautorizat' }, 403, corsHeaders);
            }
            
            const { series_id, episode_number, title, servers } = await request.json();
            const serversJson = JSON.stringify(servers);
            
            await env.DB.prepare('INSERT INTO episodes (series_id, episode_number, title, servers) VALUES (?, ?, ?, ?)')
                .bind(series_id, episode_number, title, serversJson).run();
            
            return jsonResponse({ success: true }, 201, corsHeaders);
        }
        
        // Delete series
        if (path.match(/^\/api\/admin\/series\/\d+$/) && method === 'DELETE') {
            const userId = await getUserIdFromRequest(request, env);
            const user = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
            if (!user || user.role !== 'admin') {
                return jsonResponse({ success: false, message: 'Neautorizat' }, 403, corsHeaders);
            }
            
            const id = parseInt(path.split('/').pop());
            await env.DB.prepare('DELETE FROM episodes WHERE series_id = ?').bind(id).run();
            await env.DB.prepare('DELETE FROM series WHERE id = ?').bind(id).run();
            
            return jsonResponse({ success: true }, 200, corsHeaders);
        }
        
        // Delete episode
        if (path.match(/^\/api\/admin\/episode\/\d+$/) && method === 'DELETE') {
            const userId = await getUserIdFromRequest(request, env);
            const user = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
            if (!user || user.role !== 'admin') {
                return jsonResponse({ success: false, message: 'Neautorizat' }, 403, corsHeaders);
            }
            
            const id = parseInt(path.split('/').pop());
            await env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(id).run();
            
            return jsonResponse({ success: true }, 200, corsHeaders);
        }
        
        // Fallback - serve static files from Pages
        return new Response('Not found', { status: 404 });
    }
};

// ==================== HELPER FUNCTIONS ====================

function jsonResponse(data, status, headers) {
    return new Response(JSON.stringify(data), {
        status: status,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        }
    });
}

function getTokenFromRequest(request) {
    const auth = request.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
        return auth.substring(7);
    }
    return null;
}

async function getUserIdFromRequest(request, env) {
    const token = getTokenFromRequest(request);
    if (!token) return null;
    
    const session = await env.KV.get(`session:${token}`, 'json');
    if (!session || session.expires < Date.now()) {
        return null;
    }
    
    return session.userId;
}

function generateToken(userId) {
    return crypto.randomUUID() + '-' + userId + '-' + Date.now();
}

async function hashPassword(password) {
    // Simplificat - în producție folosește un algoritm mai sigur
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function verifyPassword(password, hash) {
    const newHash = await hashPassword(password);
    return newHash === hash;
}
