// ==================== CONFIG ====================
const API_BASE = '/api';

// ==================== TOKEN ====================
function getToken() { return localStorage.getItem('token'); }
function saveToken(token) { localStorage.setItem('token', token); }
function removeToken() { localStorage.removeItem('token'); localStorage.removeItem('user'); }

// ==================== AUTENTIFICARE ====================
async function register(username, email, password) {
    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        return await res.json();
    } catch (error) {
        return { success: false, message: 'Eroare de conexiune' };
    }
}

async function login(username, password) {
    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success && data.token) {
            saveToken(data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
        }
        return data;
    } catch (error) {
        return { success: false, message: 'Eroare de conexiune' };
    }
}

async function logout() {
    try {
        await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
    } catch (error) {}
    removeToken();
    window.location.href = '/';
}

async function checkAuth() {
    const token = getToken();
    if (!token) return null;
    try {
        const res = await fetch(`${API_BASE}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
            return data.user;
        }
        removeToken();
        return null;
    } catch (error) {
        return null;
    }
}

function updateNavbar() {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const profileLink = document.getElementById('profileLink');
    const authLink = document.getElementById('authLink');
    const adminLink = document.getElementById('adminLink');
    
    if (profileLink) profileLink.style.display = user ? 'inline-block' : 'none';
    if (adminLink) adminLink.style.display = (user && user.role === 'admin') ? 'inline-block' : 'none';
    if (authLink) {
        if (user) {
            authLink.innerHTML = '<i class="fas fa-user me-1"></i> ' + user.username;
            authLink.href = '/profile.html';
        } else {
            authLink.innerHTML = '<i class="fas fa-sign-in-alt me-1"></i> Login';
            authLink.href = '/login.html';
        }
    }
}

// ==================== SERII ====================
async function loadAllSeries() {
    const container = document.getElementById('seriesList');
    if (!container) return;
    try {
        const res = await fetch(`${API_BASE}/series`);
        const series = await res.json();
        if (series.length === 0) {
            container.innerHTML = '<div class="col-12 text-center py-5">Nu există serii încă.</div>';
            return;
        }
        container.innerHTML = series.map(s => `
            <div class="col-md-2 col-sm-3 col-6 mb-4">
                <div class="anime-card" onclick="location.href='/watch.html?series=${s.slug}'">
                    <img src="${s.image_url || 'https://placehold.co/200x280/1a1a1a/dc3545?text=' + s.name}" alt="${s.name}">
                    <div class="anime-card-body">
                        <div class="anime-card-title">${escapeHtml(s.name)}</div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = '<div class="col-12 text-center text-danger py-5">Eroare la încărcare</div>';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    updateNavbar();
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        loadAllSeries();
    }
});
