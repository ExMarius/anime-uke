// Anime Uke - Authentication System
// DOAR admin și membru (fără subscriber)

// Predefined users
const USERS = [
    {
        username: 'admin',
        password: 'admin123',
        email: 'admin@animeuke.com',
        role: 'admin',
        created: '2024-01-01'
    },
    {
        username: 'membru',
        password: 'membru123',
        email: 'membru@animeuke.com',
        role: 'membru',
        created: '2024-01-02'
    }
];

// Check if user is logged in
function checkLoginStatus() {
    return localStorage.getItem('currentUser') !== null;
}

// Login function
function loginUser(username, password) {
    // Find user
    const user = USERS.find(u => 
        (u.username === username || u.email === username) && 
        u.password === password
    );
    
    if (user) {
        // Remove password before storing
        const userToStore = { ...user };
        delete userToStore.password;
        
        // Save to localStorage
        localStorage.setItem('currentUser', JSON.stringify(userToStore));
        
        return {
            success: true,
            message: 'Login successful!',
            user: userToStore
        };
    } else {
        return {
            success: false,
            message: 'Username/email sau parolă incorectă!'
        };
    }
}

// Logout function
function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
}

// Get current user
function getCurrentUser() {
    const userStr = localStorage.getItem('currentUser');
    return userStr ? JSON.parse(userStr) : null;
}

// Check if user has admin role
function isAdmin() {
    const user = getCurrentUser();
    return user && user.role === 'admin';
}

// Check if user has member role
function isMember() {
    const user = getCurrentUser();
    return user && user.role === 'membru';
}

// Redirect if not logged in
function requireLogin(redirectUrl = 'login.html') {
    if (!checkLoginStatus()) {
        window.location.href = redirectUrl;
        return false;
    }
    return true;
}

// Redirect if not admin
function requireAdmin(redirectUrl = 'index.html') {
    if (!isAdmin()) {
        alert('Acces interzis! Numai administratorii pot accesa această pagină.');
        window.location.href = redirectUrl;
        return false;
    }
    return true;
}

// Update UI based on login status
function updateUIBasedOnLogin() {
    const user = getCurrentUser();
    const loginBtn = document.getElementById('loginBtn');
    const userInfo = document.getElementById('userInfo');
    const adminLink = document.getElementById('adminLink');
    
    if (user && userInfo) {
        // Show user info
        userInfo.innerHTML = `
            <span class="mr-2">Bun venit, <strong>${user.username}</strong></span>
            <span class="badge badge-danger">${user.role}</span>
            <button onclick="logout()" class="btn btn-sm btn-outline-light ml-2">
                <i class="fa fa-sign-out"></i>
            </button>
        `;
        userInfo.style.display = 'block';
        
        if (loginBtn) loginBtn.style.display = 'none';
        
        // Show admin link only for admin
        if (adminLink && user.role === 'admin') {
            adminLink.style.display = 'block';
        }
    } else if (loginBtn) {
        // Show login button
        loginBtn.style.display = 'block';
        if (userInfo) userInfo.style.display = 'none';
        if (adminLink) adminLink.style.display = 'none';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    updateUIBasedOnLogin();
    
    // Add logout functionality to all logout buttons
    document.querySelectorAll('.logout-btn').forEach(btn => {
        btn.addEventListener('click', logout);
    });
});

// Export functions for use in HTML
window.loginUser = loginUser;
window.logout = logout;
window.checkLoginStatus = checkLoginStatus;
window.getCurrentUser = getCurrentUser;
window.isAdmin = isAdmin;
window.isMember = isMember;
window.requireLogin = requireLogin;
window.requireAdmin = requireAdmin;
window.updateUIBasedOnLogin = updateUIBasedOnLogin;
