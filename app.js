// Anime Uke - Complete System
console.log('🚀 Anime Uke System Starting...');

// ==================== FIREBASE INIT ====================
let auth, db;

try {
    if (typeof firebaseConfig !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        console.log('✅ Firebase initialized');
    }
} catch (error) {
    console.error('❌ Firebase error:', error);
}

// ==================== AUTH FUNCTIONS ====================
async function registerUser(username, email, password) {
    console.log(`📝 Register: ${username}`);
    
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        await db.collection('users').doc(user.uid).set({
            uid: user.uid,
            username: username,
            email: email,
            role: 'user',
            avatar: username.charAt(0).toUpperCase(),
            created: firebase.firestore.FieldValue.serverTimestamp(),
            lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'active'
        });
        
        console.log('✅ User registered:', username);
        
        // Auto-login
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
        }
        
        return {
            success: false,
            message: message
        };
    }
}

async function loginUser(email, password) {
    console.log(`🔐 Login: ${email}`);
    
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        const userDoc = await db.collection('users').doc(user.uid).get();
        
        let userData;
        if (!userDoc.exists) {
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
            userData = newDoc.data();
        } else {
            userData = userDoc.data();
            
            await db.collection('users').doc(user.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
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
        }
        
        return {
            success: false,
            message: message
        };
    }
}

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

function isLoggedIn() {
    return localStorage.getItem('currentUser') !== null;
}

function getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

function isAdmin() {
    const user = getCurrentUser();
    return user && user.role === 'admin';
}

// ==================== ANIME FUNCTIONS ====================
async function addToWatchlist(animeId) {
    const user = getCurrentUser();
    if (!user) {
        alert('Trebuie să fii logat pentru a adăuga la watchlist!');
        return false;
    }
    
    try {
        const watchlistItem = {
            animeId: animeId,
            addedAt: new Date().toISOString(),
            lastWatched: null,
            progress: 0
        };
        
        await db.collection('users').doc(user.uid)
            .collection('watchlist').doc(animeId).set(watchlistItem);
        
        console.log('✅ Added to watchlist:', animeId);
        return true;
        
    } catch (error) {
        console.error('❌ Watchlist error:', error);
        return false;
    }
}

async function trackEpisodeView(animeId, episodeNumber) {
    const user = getCurrentUser();
    if (!user) return;
    
    try {
        const viewData = {
            animeId: animeId,
            episodeNumber: episodeNumber,
            watchedAt: new Date().toISOString(),
            userAgent: navigator.userAgent
        };
        
        await db.collection('views').add(viewData);
        console.log('📊 Tracked view:', animeId, episodeNumber);
        
    } catch (error) {
        console.error('❌ Tracking error:', error);
    }
}

// ==================== UI FUNCTIONS ====================
function updateUIBasedOnLogin() {
    const user = getCurrentUser();
    const authNav = document.getElementById('authNav');
    
    if (!authNav) return;
    
    if (user) {
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
        
        const adminLink = document.getElementById('adminLink');
        if (adminLink && user.role === 'admin') {
            adminLink.style.display = 'inline-block';
        }
        
    } else {
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
    }
}

function requireLogin() {
    if (!isLoggedIn()) {
        alert('Trebuie să fii logat pentru a accesa această pagină!');
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

function requireAdmin() {
    if (!isAdmin()) {
        alert('Acces interzis! Numai administratorii pot accesa această pagină.');
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🎮 Anime Uke System Ready!');
    
    updateUIBasedOnLogin();
});

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
window.addToWatchlist = addToWatchlist;
window.trackEpisodeView = trackEpisodeView;

console.log('✅ Anime Uke System Loaded Successfully!');
