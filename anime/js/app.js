// Anime Uke - Frontend JavaScript
// Toate funcțiile pentru interacțiunea cu API-ul

const API_BASE = '/api';

// ==================== UTILITARE ====================

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} position-fixed top-0 start-50 translate-middle-x mt-3`;
    notification.style.zIndex = '9999';
    notification.style.minWidth = '300px';
    notification.style.textAlign = 'center';
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'} me-2"></i>
        ${message}
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

function getToken() {
    return localStorage.getItem('token');
}

function saveToken(token) {
    localStorage.setItem('token', token);
}

function removeToken() {
    localStorage.removeItem('token');
}

// ==================== AUTENTIFICARE ====================

async function register(username, email, password) {
    try {
        const response = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        return await response.json();
    } catch (error) {
        console.error('Register error:', error);
        return { success: false, message: 'Eroare de conexiune' };
    }
}

async function login(username, password, remember = false) {
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, remember })
        });
        const data = await response.json();
        if (data.success && data.token) {
            saveToken(data.token);
            if (data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }
        }
        return data;
    } catch (error) {
        console.error('Login error:', error);
        return { success: false, message: 'Eroare de conexiune' };
    }
}

async function logout() {
    try {
        await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    removeToken();
    localStorage.removeItem('user');
}

async function checkAuth() {
    const token = getToken();
    if (!token) return null;
    
    try {
        const response = await fetch(`${API_BASE}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success && data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
            return data.user;
        } else {
            removeToken();
            return null;
        }
    } catch (error) {
        console.error('Check auth error:', error);
        return null;
    }
}

async function checkAdmin() {
    const user = await checkAuth();
    return user && user.role === 'admin';
}

function updateNavbar() {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const profileLink = document.getElementById('profileLink');
    const authLink = document.getElementById('authLink');
    
    if (profileLink) profileLink.style.display = user ? 'block' : 'none';
    if (authLink) {
        if (user) {
            authLink.textContent = 'Profil';
            authLink.href = '/profile';
        } else {
            authLink.textContent = 'Login';
            authLink.href = '/login';
        }
    }
}

function checkAuthAndRedirect() {
    const token = getToken();
    if (token) {
        window.location.href = '/';
    }
}

// ==================== UTILIZATOR ====================

async function getUserProfile() {
    try {
        const response = await fetch(`${API_BASE}/user/profile`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        return await response.json();
    } catch (error) {
        console.error('Get profile error:', error);
        return { success: false };
    }
}

async function getUserPreferences() {
    try {
        const response = await fetch(`${API_BASE}/user/preferences`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        return await response.json();
    } catch (error) {
        console.error('Get preferences error:', error);
        return {};
    }
}

async function setPreferredServer(server) {
    try {
        const response = await fetch(`${API_BASE}/user/preferences`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({ preferred_server: server })
        });
        return await response.json();
    } catch (error) {
        console.error('Set preferred server error:', error);
        return { success: false, message: 'Eroare de conexiune' };
    }
}

// ==================== SERII ====================

async function loadAllSeries() {
    const container = document.getElementById('allSeries');
    if (!container) return;
    
    try {
        const response = await fetch(`${API_BASE}/series`);
        const series = await response.json();
        
        if (series.length === 0) {
            container.innerHTML = '<div class="col-12 text-center text-muted py-5">Nu există serii încă.</div>';
            return;
        }
        
        container.innerHTML = series.map(s => `
            <div class="col-md-3 col-sm-4 col-6 mb-4">
                <div class="anime-card">
                    <a href="/series/${s.slug}">
                        <img src="${s.image_url || 'https://placehold.co/200x280/1a1a1a/dc3545?text=No+Image'}" alt="${s.name}">
                    </a>
                    <div class="anime-card-body">
                        <div class="anime-card-title">${escapeHtml(s.name)}</div>
                        <div class="anime-card-type">${s.type || 'anime'}</div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load series error:', error);
        container.innerHTML = '<div class="col-12 text-center text-danger py-5">Eroare la încărcarea seriilor</div>';
    }
}

async function loadLatestEpisodes() {
    const container = document.getElementById('latestEpisodes');
    if (!container) return;
    
    try {
        const response = await fetch(`${API_BASE}/episodes/latest`);
        const episodes = await response.json();
        
        if (episodes.length === 0) {
            container.innerHTML = '<div class="col-12 text-center text-muted py-5">Nu există episoade încă.</div>';
            return;
        }
        
        container.innerHTML = episodes.map(ep => `
            <div class="col-md-3 col-sm-4 col-6 mb-4">
                <div class="anime-card">
                    <a href="/watch/${ep.series_slug}/${ep.episode_number}">
                        <img src="${ep.image_url || 'https://placehold.co/200x280/1a1a1a/dc3545?text=No+Image'}" alt="${ep.series_name}">
                    </a>
                    <div class="anime-card-body">
                        <div class="anime-card-title">${escapeHtml(ep.series_name)}</div>
                        <div class="anime-card-type">Episodul ${ep.episode_number}</div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load latest episodes error:', error);
        container.innerHTML = '<div class="col-12 text-center text-danger py-5">Eroare la încărcarea episoadelor</div>';
    }
}

// ==================== COMENTARII ====================

async function loadComments(seriesSlug, episodeNumber) {
    try {
        const response = await fetch(`${API_BASE}/comments/${seriesSlug}/${episodeNumber}`);
        return await response.json();
    } catch (error) {
        console.error('Load comments error:', error);
        return { comments: [] };
    }
}

async function postComment(seriesSlug, episodeNumber, content, parentId = null) {
    try {
        const response = await fetch(`${API_BASE}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                series_slug: seriesSlug,
                episode_number: episodeNumber,
                content: content,
                parent_id: parentId
            })
        });
        return await response.json();
    } catch (error) {
        console.error('Post comment error:', error);
        return { success: false, message: 'Eroare de conexiune' };
    }
}

async function voteComment(commentId) {
    try {
        const response = await fetch(`${API_BASE}/comments/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({ comment_id: commentId })
        });
        return await response.json();
    } catch (error) {
        console.error('Vote comment error:', error);
        return { success: false };
    }
}

// ==================== EPISOADE ====================

async function markEpisodeWatched(seriesSlug, episodeNumber) {
    try {
        const response = await fetch(`${API_BASE}/episode/watched`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                series_slug: seriesSlug,
                episode_number: episodeNumber
            })
        });
        return await response.json();
    } catch (error) {
        console.error('Mark watched error:', error);
        return { success: false };
    }
}

async function isEpisodeWatched(seriesSlug, episodeNumber) {
    try {
        const response = await fetch(`${API_BASE}/episode/watched/${seriesSlug}/${episodeNumber}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        return await response.json();
    } catch (error) {
        console.error('Check watched error:', error);
        return { watched: false };
    }
}

// ==================== ADMIN ====================

async function addSeries(data) {
    try {
        const response = await fetch(`${API_BASE}/admin/series`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (error) {
        console.error('Add series error:', error);
        return { success: false, message: 'Eroare de conexiune' };
    }
}

async function addEpisode(data) {
    try {
        const response = await fetch(`${API_BASE}/admin/episode`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (error) {
        console.error('Add episode error:', error);
        return { success: false, message: 'Eroare de conexiune' };
    }
}

async function deleteSeries(id) {
    try {
        const response = await fetch(`${API_BASE}/admin/series/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        return await response.json();
    } catch (error) {
        console.error('Delete series error:', error);
        return { success: false };
    }
}

async function deleteEpisode(id) {
    try {
        const response = await fetch(`${API_BASE}/admin/episode/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        return await response.json();
    } catch (error) {
        console.error('Delete episode error:', error);
        return { success: false };
    }
}

// ==================== HELPER ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== INIT ====================

// Auto-initializare pentru pagini
document.addEventListener('DOMContentLoaded', () => {
    updateNavbar();
    
    // Auto-load pentru pagina principală
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        if (typeof loadLatestEpisodes === 'function') loadLatestEpisodes();
        if (typeof loadAllSeries === 'function') loadAllSeries();
    }
});
