const USERS = [
    { id: 1, username: 'admin', password: 'admin123', role: 'admin', email: 'admin@anime.com' },
    { id: 2, username: 'membru', password: 'membru123', role: 'member', email: 'membru@anime.com' },
    { id: 3, username: 'subscriber', password: 'sub123', role: 'subscriber', email: 'sub@anime.com' }
];

const POSTS = [
    { id: 1, title: 'Începutul Spiritului Ninja', content: 'Astăzi am început lucrul la primul episod din Spiritul Ninja...', author: 'admin', anime: 'Spiritul Ninja', season: 1, episode: 1, access: 'public', date: '2024-01-15', likes: 24 },
    { id: 2, title: 'Design personaje Dragon\'s Legacy', content: 'Am creat primele schițe pentru personajele principale...', author: 'admin', anime: 'Dragon\'s Legacy', season: 2, episode: 1, access: 'subscriber', date: '2024-01-14', likes: 15 },
    { id: 3, title: 'Update Cyber Samurai', content: 'Progrese bune la animațiile din episodul 1...', author: 'admin', anime: 'Cyber Samurai', season: 1, episode: 1, access: 'member', date: '2024-01-13', likes: 32 },
    { id: 4, title: 'Noul website!', content: 'Bun venit pe noul website dedicat anime-urilor mele!', author: 'admin', anime: 'General', season: 0, episode: 0, access: 'public', date: '2024-01-12', likes: 45 }
];

function saveUser(user) { localStorage.setItem('currentUser', JSON.stringify(user)); localStorage.setItem('isLoggedIn', 'true'); }
function loadUser() { const userStr = localStorage.getItem('currentUser'); return userStr ? JSON.parse(userStr) : null; }
function clearUser() { localStorage.removeItem('currentUser'); localStorage.setItem('isLoggedIn', 'false'); }
function isLoggedIn() { return localStorage.getItem('isLoggedIn') === 'true'; }

function hasAccess(requiredRole) {
    const user = loadUser();
    if (!user) return false;
    const roleHierarchy = { 'visitor': 0, 'member': 1, 'subscriber': 2, 'moderator': 3, 'admin': 4 };
    const userLevel = roleHierarchy[user.role] || 0;
    const requiredLevel = roleHierarchy[requiredRole] || 0;
    return userLevel >= requiredLevel;
}

function updateUI() {
    const user = loadUser();
    const userInfo = document.getElementById('user-info');
    const loginLink = document.getElementById('login-link');
    const adminLink = document.getElementById('admin-link');
    const postsContainer = document.getElementById('posts-container');
    
    if (user) {
        loginLink.innerHTML = `<i class="fas fa-sign-out-alt"></i> Logout (${user.username})`;
        loginLink.href = "#";
        loginLink.onclick = () => { logout(); return false; };
        
        userInfo.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-user-circle" style="font-size: 2rem;"></i>
                <div>
                    <strong>${user.username}</strong>
                    <span class="role-badge role-${user.role}">${user.role.toUpperCase()}</span>
                </div>
            </div>
        `;
        
        if (user.role === 'admin' && adminLink) {
            adminLink.style.display = 'inline';
        }
    } else {
        loginLink.innerHTML = `<i class="fas fa-sign-in-alt"></i> Login`;
        loginLink.href = "login.html";
        loginLink.onclick = null;
        userInfo.innerHTML = '<p>Loghează-te pentru mai multe funcții!</p>';
        if (adminLink) adminLink.style.display = 'none';
    }
    
    if (postsContainer) {
        postsContainer.innerHTML = '';
        POSTS.forEach(post => {
            if (post.access === 'public' || (user && post.access === 'member') || 
                (user && user.role === 'subscriber' && post.access === 'subscriber') || 
                (user && user.role === 'admin')) {
                
                const postCard = document.createElement('div');
                postCard.className = `post-card ${post.access}`;
                postCard.innerHTML = `
                    <div class="post-header">
                        <div class="post-title">${post.title}</div>
                        <span class="post-access access ${post.access}">
                            <i class="fas ${post.access === 'public' ? 'fa-globe' : post.access === 'member' ? 'fa-user-friends' : 'fa-crown'}"></i>
                            ${post.access === 'public' ? 'Public' : post.access === 'member' ? 'Membri' : 'Subscriberi'}
                        </span>
                    </div>
                    <div class="post-content">${post.content}</div>
                    <div class="post-meta">
                        <span><i class="fas fa-film"></i> ${post.anime} ${post.season > 0 ? `- Sezon ${post.season}` : ''}</span>
                        <span><i class="fas fa-heart"></i> ${post.likes} likes</span>
                    </div>
                    <div class="post-meta">
                        <span><i class="fas fa-user"></i> ${post.author}</span>
                        <span><i class="fas fa-calendar"></i> ${post.date}</span>
                    </div>
                `;
                postsContainer.appendChild(postCard);
            }
        });
        
        if (postsContainer.children.length === 0) {
            postsContainer.innerHTML = '<div class="error">Nu ai acces la nicio postare momentan.</div>';
        }
    }
}

function logout() {
    if (confirm('Sigur vrei să te deconectezi?')) {
        clearUser();
        updateUI();
        alert('Te-ai deconectat cu succes!');
    }
}

function viewAnime(animeSlug) {
    const user = loadUser();
    if (animeSlug === 'dragons-legacy' && (!user || user.role !== 'subscriber')) {
        alert('Acest anime este disponibil doar pentru subscriberi!');
        return;
    }
    alert(`Vei fi redirecționat către ${animeSlug}...`);
}

window.loginUser = function(username, password) {
    const user = USERS.find(u => (u.username === username || u.email === username) && u.password === password);
    if (user) {
        const { password: _, ...userWithoutPassword } = user;
        saveUser(userWithoutPassword);
        return { success: true, user: userWithoutPassword };
    }
    return { success: false, message: 'Username sau parolă incorectă' };
};

window.loadUser = loadUser;
window.logout = logout;
window.hasAccess = hasAccess;
window.isLoggedIn = isLoggedIn;

document.addEventListener('DOMContentLoaded', function() {
    updateUI();
    document.querySelectorAll('.btn-view').forEach(btn => {
        btn.addEventListener('click', function() {
            const animeCard = this.closest('.anime-card');
            const animeTitle = animeCard.querySelector('h3').textContent;
            viewAnime(animeTitle.toLowerCase().replace(/\s+/g, '-'));
        });
    });
});
