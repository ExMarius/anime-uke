// script.js - Sistem simplu și funcțional pentru Anime Uke
console.log('🚀 Anime Uke System Starting...');

// ==================== CONFIG ====================
const CONFIG = {
    get BIN_ID() {
        return localStorage.getItem('anime_uke_bin_id') || "693177b4d0ea881f401260aa";
    },
    get API_KEY() {
        return localStorage.getItem('anime_uke_api_key') || "$2a$10$chxy/E8m6jlMEUh7n7/qfuEDpFt.uv4AMZGCwfzju51RM.ApKwonO";
    },
    API_URL: "https://api.jsonbin.io/v3/b"
};

// ==================== FUNCȚII SIMPLE JSONBIN ====================

// Obține userii - SIMPLU și SIGUR
async function getUsers() {
    console.log('🔍 Getting users from JSONBin...');
    
    try {
        const response = await fetch(`${CONFIG.API_URL}/${CONFIG.BIN_ID}/latest`, {
            headers: { 'X-Master-Key': CONFIG.API_KEY }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ Users loaded successfully');
        return data.record?.users || [];
        
    } catch (error) {
        console.warn('⚠️ Using default users:', error.message);
        // Returnează useri default în caz de eroare
        return [
            { id: 1, username: "admin", password: "admin123", role: "admin" },
            { id: 2, username: "membru", password: "membru123", role: "membru" }
        ];
    }
}

// Actualizează userii
async function updateUsers(users) {
    try {
        const response = await fetch(`${CONFIG.API_URL}/${CONFIG.BIN_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': CONFIG.API_KEY
            },
            body: JSON.stringify({ users: users })
        });
        
        return await response.json();
    } catch (error) {
        console.error('❌ Error updating users:', error);
        return { success: false };
    }
}

// ==================== FUNCȚII AUTHENTIFICARE ====================

// Login SIMPLU și FUNCȚIONAL
async function loginUser(username, password) {
    console.log(`🔐 Login attempt: ${username}`);
    
    try {
        const users = await getUsers();
        
        // Găsește user-ul
        const user = users.find(u => 
            (u.username === username || u.email === username) && 
            u.password === password
        );
        
        if (user) {
            // Salvează user-ul (fără parolă)
            const userToSave = {
                id: user.id,
                username: user.username,
                email: user.email || `${user.username}@animeuke.com`,
                role: user.role,
                avatar: user.avatar || user.username.charAt(0).toUpperCase(),
                created: user.created || new Date().toISOString().split('T')[0],
                lastLogin: new Date().toISOString()
            };
            
            localStorage.setItem('currentUser', JSON.stringify(userToSave));
            
            console.log('✅ Login successful!');
            return {
                success: true,
                message: 'Conectat cu succes!',
                user: userToSave
            };
        } else {
            console.log('❌ Login failed: Invalid credentials');
            return {
                success: false,
                message: 'Username sau parolă incorectă!'
            };
        }
        
    } catch (error) {
        console.error('💥 Login error:', error);
        return {
            success: false,
            message: 'Eroare la conectare. Încearcă din nou.'
        };
    }
}

// Logout SIMPLU
function logout() {
    console.log('👋 Logging out...');
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
}

// Verifică dacă user-ul este logat
function isLoggedIn() {
    return localStorage.getItem('currentUser') !== null;
}

// Obține user-ul curent
function getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

// Verifică dacă este admin
function isAdmin() {
    const user = getCurrentUser();
    return user && user.role === 'admin';
}

// ==================== UI FUNCTIONS ====================

// Update UI bazat pe login
function updateUIBasedOnLogin() {
    const user = getCurrentUser();
    const loginBtn = document.getElementById('loginBtn');
    const userNavItem = document.getElementById('userNavItem');
    const adminLink = document.getElementById('adminLink');
    const settingsLink = document.getElementById('settingsLink');
    const profileLink = document.getElementById('profileLink');
    
    if (user) {
        // User logat - arată informații
        if (userNavItem) {
            userNavItem.innerHTML = `
                <div class="nav-item dropdown">
                    <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown">
                        <i class="fas fa-user"></i> ${user.username}
                        <span class="badge bg-danger ms-1">${user.role}</span>
                    </a>
                    <div class="dropdown-menu dropdown-menu-end">
                        <a class="dropdown-item" href="profile.html">
                            <i class="fas fa-user-circle"></i> Profil
                        </a>
                        <a class="dropdown-item" href="settings.html">
                            <i class="fas fa-cog"></i> Setări
                        </a>
                        <div class="dropdown-divider"></div>
                        <a class="dropdown-item text-danger" href="#" onclick="logout()">
                            <i class="fas fa-sign-out-alt"></i> Logout
                        </a>
                    </div>
                </div>
            `;
        }
        
        // Arată link-uri pentru admin
        if (adminLink && user.role === 'admin') {
            adminLink.style.display = 'inline-block';
        }
        
        // Arată link-uri pentru toți userii
        if (settingsLink) settingsLink.style.display = 'inline-block';
        if (profileLink) profileLink.style.display = 'inline-block';
        
        // Ascunde butonul Login
        if (loginBtn) loginBtn.style.display = 'none';
        
    } else {
        // User nelogat - arată buton Login
        if (userNavItem && loginBtn) {
            loginBtn.style.display = 'block';
        }
        
        // Ascunde link-uri
        if (adminLink) adminLink.style.display = 'none';
        if (settingsLink) settingsLink.style.display = 'none';
        if (profileLink) profileLink.style.display = 'none';
    }
}

// Redirect dacă nu e logat
function requireLogin() {
    if (!isLoggedIn()) {
        alert('Trebuie să fii logat pentru a accesa această pagină!');
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Redirect dacă nu e admin
function requireAdmin() {
    if (!isAdmin()) {
        alert('Acces interzis! Numai administratorii pot accesa această pagină.');
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

// ==================== ADMIN FUNCTIONS ====================

// Încarcă useri pentru admin panel
async function loadAdminUsers() {
    if (!requireAdmin()) return;
    
    try {
        const users = await getUsers();
        const tbody = document.getElementById('usersTableBody');
        
        if (!tbody) return;
        
        let html = '';
        users.forEach(user => {
            const roleClass = user.role === 'admin' ? 'danger' : 
                            user.role === 'membru' ? 'primary' : 'secondary';
            
            html += `
            <tr>
                <td>${user.id}</td>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="user-avatar-small bg-white text-dark rounded-circle d-flex align-items-center justify-content-center me-2" 
                             style="width: 30px; height: 30px; font-weight: bold;">
                            ${user.avatar || user.username.charAt(0).toUpperCase()}
                        </div>
                        ${user.username}
                    </div>
                </td>
                <td>${user.email || '-'}</td>
                <td>
                    <span class="badge bg-${roleClass}">${user.role}</span>
                </td>
                <td>${user.created || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteUserPrompt(${user.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
            `;
        });
        
        tbody.innerHTML = html;
        
        // Update stats
        document.getElementById('totalUsers').textContent = users.length;
        
    } catch (error) {
        console.error('Error loading admin users:', error);
    }
}

// Șterge user (admin only)
async function deleteUserPrompt(userId) {
    if (!confirm('Sigur vrei să ștergi acest utilizator?')) return;
    
    try {
        const users = await getUsers();
        const updatedUsers = users.filter(user => user.id !== userId);
        
        const result = await updateUsers(updatedUsers);
        
        if (result.success !== false) {
            alert('Utilizator șters cu succes!');
            loadAdminUsers(); // Reîncarcă tabela
        } else {
            alert('Eroare la ștergerea utilizatorului.');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        alert('Eroare: ' + error.message);
    }
}

// ==================== INITIALIZATION ====================

// Inițializează la încărcarea paginii
document.addEventListener('DOMContentLoaded', function() {
    console.log('🎮 Anime Uke System Ready!');
    
    // Update UI
    updateUIBasedOnLogin();
    
    // Încarcă admin users dacă suntem pe admin.html
    if (window.location.pathname.includes('admin.html')) {
        loadAdminUsers();
    }
    
    // Setează data curentă în admin panel
    const currentDate = document.getElementById('currentDate');
    if (currentDate) {
        currentDate.textContent = new Date().toLocaleDateString('ro-RO');
    }
});

// ==================== EXPORT FUNCTIONS ====================

// Face funcțiile disponibile global
window.loginUser = loginUser;
window.logout = logout;
window.isLoggedIn = isLoggedIn;
window.getCurrentUser = getCurrentUser;
window.isAdmin = isAdmin;
window.updateUIBasedOnLogin = updateUIBasedOnLogin;
window.requireLogin = requireLogin;
window.requireAdmin = requireAdmin;
window.loadAdminUsers = loadAdminUsers;
window.deleteUserPrompt = deleteUserPrompt;

console.log('✅ Anime Uke System Loaded Successfully!');
