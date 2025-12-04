// Anime Uke - Firebase Version
console.log('🚀 Anime Uke with Firebase Starting...');

// ==================== FIREBASE INIT ====================
let auth, db;

try {
    // Get config from firebase-config.js
    if (typeof firebaseConfig !== 'undefined') {
        // Initialize Firebase with compat version
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        console.log('✅ Firebase initialized successfully');
    } else {
        console.error('❌ Firebase config not found!');
    }
} catch (error) {
    console.error('❌ Firebase initialization error:', error);
}

// ==================== AUTHENTICATION FUNCTIONS ====================

// Register new user with Firebase
async function registerUser(username, email, password) {
    console.log(`📝 Register attempt: ${username}`);
    
    try {
        // 1. Create user in Firebase Authentication
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // 2. Save user data to Firestore
        await db.collection('users').doc(user.uid).set({
            uid: user.uid,
            username: username,
            email: email,
            role: 'user', // Default role
            avatar: username.charAt(0).toUpperCase(),
            created: firebase.firestore.FieldValue.serverTimestamp(),
            lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'active',
            episodesWatched: 0,
            seriesCompleted: 0,
            watchHours: 0
        });
        
        console.log('✅ User registered successfully:', username);
        
        // Auto-login after registration
        const loginResult = await loginUser(email, password);
        
        return {
            success: true,
            message: 'Cont creat cu succes!',
            user: loginResult.user
        };
        
    } catch (error) {
        console.error('💥 Register error:', error);
        
        let message = 'Eroare la înregistrare. ';
        if (error.code === 'auth/email-already-in-use') {
            message = 'Email-ul este deja înregistrat!';
        } else if (error.code === 'auth/weak-password') {
            message = 'Parola este prea slabă! (minim 6 caractere)';
        } else if (error.code === 'auth/invalid-email') {
            message = 'Email invalid!';
        } else if (error.code === 'auth/network-request-failed') {
            message = 'Eroare de conexiune. Verifică internetul.';
        }
        
        return {
            success: false,
            message: message
        };
    }
}

// Login with Firebase
async function loginUser(email, password) {
    console.log(`🔐 Login attempt: ${email}`);
    
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // Get user data from Firestore
        const userDoc = await db.collection('users').doc(user.uid).get();
        
        if (!userDoc.exists) {
            // Create user document if it doesn't exist (for backward compatibility)
            await db.collection('users').doc(user.uid).set({
                uid: user.uid,
                username: email.split('@')[0],
                email: user.email,
                role: 'user',
                avatar: email.charAt(0).toUpperCase(),
                created: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'active'
            });
            
            const newDoc = await db.collection('users').doc(user.uid).get();
            var userData = newDoc.data();
        } else {
            var userData = userDoc.data();
            
            // Update last login
            await db.collection('users').doc(user.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        // Save user to localStorage for quick access
        const userToSave = {
            uid: user.uid,
            username: userData.username,
            email: user.email,
            role: userData.role || 'user',
            avatar: userData.avatar || user.email.charAt(0).toUpperCase(),
            created: userData.created ? userData.created.toDate().toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
        };
        
        localStorage.setItem('currentUser', JSON.stringify(userToSave));
        
        console.log('✅ Login successful:', userData.username);
        
        return {
            success: true,
            message: 'Conectat cu succes!',
            user: userToSave
        };
        
    } catch (error) {
        console.error('💥 Login error:', error);
        
        let message = 'Eroare la conectare. ';
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            message = 'Email sau parolă incorectă!';
        } else if (error.code === 'auth/too-many-requests') {
            message = 'Cont blocat temporar. Încearcă mai târziu!';
        } else if (error.code === 'auth/network-request-failed') {
            message = 'Eroare de conexiune. Verifică internetul.';
        }
        
        return {
            success: false,
            message: message
        };
    }
}

// Logout with Firebase
function logout() {
    console.log('👋 Logging out...');
    
    auth.signOut().then(() => {
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    }).catch(error => {
        console.error('Logout error:', error);
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    });
}

// Check if user is logged in
function isLoggedIn() {
    return localStorage.getItem('currentUser') !== null;
}

// Get current user
function getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

// Check if user is admin
function isAdmin() {
    const user = getCurrentUser();
    return user && user.role === 'admin';
}

// ==================== FIRESTORE FUNCTIONS ====================

// Get all users (admin only)
async function getAllUsers() {
    if (!isAdmin()) {
        console.warn('⚠️ Non-admin tried to get all users');
        return [];
    }
    
    try {
        const snapshot = await db.collection('users').get();
        const users = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            users.push({
                id: doc.id,
                uid: data.uid,
                username: data.username,
                email: data.email,
                role: data.role || 'user',
                avatar: data.avatar,
                created: data.created ? data.created.toDate().toLocaleDateString('ro-RO') : 'Necunoscută',
                lastLogin: data.lastLogin ? data.lastLogin.toDate().toLocaleString('ro-RO') : 'Necunoscută',
                status: data.status || 'active'
            });
        });
        
        console.log(`✅ Loaded ${users.length} users from Firestore`);
        return users;
        
    } catch (error) {
        console.error('❌ Error getting users:', error);
        return [];
    }
}

// Delete user (admin only)
async function deleteUser(userId) {
    if (!isAdmin()) {
        alert('Numai administratorii pot șterge utilizatori!');
        return false;
    }
    
    if (!confirm('Sigur vrei să ștergi acest utilizator? Acțiunea este permanentă!')) {
        return false;
    }
    
    try {
        // Delete from Firestore
        await db.collection('users').doc(userId).delete();
        
        console.log('✅ User deleted from Firestore:', userId);
        
        // Note: To delete from Firebase Auth too, you need Cloud Functions
        alert('Utilizator șters cu succes din baza de date!');
        return true;
        
    } catch (error) {
        console.error('❌ Error deleting user:', error);
        alert('Eroare la ștergerea utilizatorului: ' + error.message);
        return false;
    }
}

// Update user role (admin only)
async function updateUserRole(userId, newRole) {
    if (!isAdmin()) {
        alert('Numai administratorii pot modifica roluri!');
        return false;
    }
    
    try {
        await db.collection('users').doc(userId).update({
            role: newRole
        });
        
        console.log(`✅ User ${userId} role updated to: ${newRole}`);
        return true;
        
    } catch (error) {
        console.error('❌ Error updating user role:', error);
        return false;
    }
}

// ==================== UI FUNCTIONS ====================

// Update UI based on login status
function updateUIBasedOnLogin() {
    const user = getCurrentUser();
    const authNav = document.getElementById('authNav');
    
    if (!authNav) return;
    
    if (user) {
        // User logged in - show user dropdown
        authNav.innerHTML = `
            <li class="nav-item dropdown">
                <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown">
                    <i class="fas fa-user"></i> ${user.username}
                    <span class="badge bg-danger ms-1">${user.role}</span>
                </a>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><a class="dropdown-item" href="profile.html">
                        <i class="fas fa-user-circle"></i> Profil
                    </a></li>
                    <li><a class="dropdown-item" href="settings.html">
                        <i class="fas fa-cog"></i> Setări
                    </a></li>
                    ${user.role === 'admin' ? `
                    <li><a class="dropdown-item" href="admin.html">
                        <i class="fas fa-shield-alt"></i> Admin
                    </a></li>
                    ` : ''}
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item text-danger" href="#" onclick="logout()">
                        <i class="fas fa-sign-out-alt"></i> Logout
                    </a></li>
                </ul>
            </li>
        `;
        
        // Show links in footer
        const adminLink = document.getElementById('adminLink');
        const settingsLink = document.getElementById('settingsLink');
        const profileLink = document.getElementById('profileLink');
        
        if (adminLink && user.role === 'admin') {
            adminLink.style.display = 'inline-block';
        }
        if (settingsLink) settingsLink.style.display = 'inline-block';
        if (profileLink) profileLink.style.display = 'inline-block';
        
    } else {
        // User not logged in - show Login/Register buttons
        authNav.innerHTML = `
            <li class="nav-item">
                <a class="nav-link" href="login.html">
                    <i class="fas fa-sign-in-alt"></i> Login
                </a>
            </li>
            <li class="nav-item">
                <a class="nav-link" href="register.html">
                    <i class="fas fa-user-plus"></i> Register
                </a>
            </li>
        `;
        
        // Hide links in footer
        const adminLink = document.getElementById('adminLink');
        const settingsLink = document.getElementById('settingsLink');
        const profileLink = document.getElementById('profileLink');
        
        if (adminLink) adminLink.style.display = 'none';
        if (settingsLink) settingsLink.style.display = 'none';
        if (profileLink) profileLink.style.display = 'none';
    }
}

// Redirect if not logged in
function requireLogin() {
    if (!isLoggedIn()) {
        alert('Trebuie să fii logat pentru a accesa această pagină!');
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Redirect if not admin
function requireAdmin() {
    if (!isAdmin()) {
        alert('Acces interzis! Numai administratorii pot accesa această pagină.');
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

// ==================== INITIALIZATION ====================

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('🎮 Anime Uke with Firebase Ready!');
    
    // Update UI
    updateUIBasedOnLogin();
    
    // Load admin users if on admin page
    if (window.location.pathname.includes('admin.html')) {
        loadAdminUsers();
    }
});

// Load admin users
async function loadAdminUsers() {
    if (!requireAdmin()) return;
    
    try {
        const users = await getAllUsers();
        const tbody = document.getElementById('usersTableBody');
        
        if (!tbody) return;
        
        let html = '';
        users.forEach(user => {
            const roleClass = user.role === 'admin' ? 'danger' : 
                            user.role === 'membru' ? 'primary' : 'secondary';
            
            html += `
            <tr>
                <td>${user.id.substring(0, 8)}...</td>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="user-avatar-small bg-white text-dark rounded-circle d-flex align-items-center justify-content-center me-2" 
                             style="width: 30px; height: 30px; font-weight: bold;">
                            ${user.avatar || user.username.charAt(0).toUpperCase()}
                        </div>
                        ${user.username}
                    </div>
                </td>
                <td>${user.email}</td>
                <td>
                    <select class="form-select form-select-sm user-role-select" data-userid="${user.id}" style="width: 100px;">
                        <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                        <option value="membru" ${user.role === 'membru' ? 'selected' : ''}>Membru</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </td>
                <td>${user.created}</td>
                <td>${user.lastLogin}</td>
                <td>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteUserPrompt('${user.id}', '${user.username}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
            `;
        });
        
        tbody.innerHTML = html;
        
        // Add event listeners for role changes
        document.querySelectorAll('.user-role-select').forEach(select => {
            select.addEventListener('change', async function() {
                const userId = this.getAttribute('data-userid');
                const newRole = this.value;
                
                if (confirm(`Schimbi rolul utilizatorului în "${newRole}"?`)) {
                    const success = await updateUserRole(userId, newRole);
                    if (success) {
                        alert('Rol actualizat cu succes!');
                    }
                } else {
                    // Reset to original value
                    this.value = this.defaultValue;
                }
            });
        });
        
        // Update stats
        document.getElementById('totalUsers').textContent = users.length;
        
    } catch (error) {
        console.error('Error loading admin users:', error);
        document.getElementById('usersTableBody').innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-danger">
                    <i class="fas fa-exclamation-triangle"></i> Eroare la încărcarea userilor: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Delete user prompt
async function deleteUserPrompt(userId, username) {
    if (confirm(`Sigur vrei să ștergi utilizatorul "${username}"?`)) {
        const success = await deleteUser(userId);
        if (success) {
            loadAdminUsers();
        }
    }
}

// ==================== EXPORT FUNCTIONS ====================

window.registerUser = registerUser;
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
