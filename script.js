// Anime Uke V2 - Authentication System cu JSONBin.io

// Configurație JSONBin (se ia din localStorage sau default)
const JSONBIN_CONFIG = {
  get BIN_ID() {
    return localStorage.getItem('jsonbin_id') || 'YOUR_BIN_ID_HERE';
  },
  get API_KEY() {
    return localStorage.getItem('jsonbin_key') || 'YOUR_API_KEY_HERE';
  },
  API_URL: 'https://api.jsonbin.io/v3/b'
};

// ==================== FUNCTII JSONBIN ====================

// Obține toți userii din JSONBin
async function getUsersFromJSONBin() {
  try {
    console.log('📡 Fetching users from JSONBin...');
    
    const response = await fetch(
      `${JSONBIN_CONFIG.API_URL}/${JSONBIN_CONFIG.BIN_ID}/latest`,
      {
        headers: {
          'X-Master-Key': JSONBIN_CONFIG.API_KEY
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ Users loaded:', data.record.users.length);
    return data.record.users || [];
    
  } catch (error) {
    console.error('❌ Error loading users:', error);
    
    // Fallback la useri locali în caz de eroare
    return [
      {
        id: 1,
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        email: 'admin@animeuke.com'
      },
      {
        id: 2,
        username: 'membru',
        password: 'membru123',
        role: 'membru',
        email: 'membru@animeuke.com'
      }
    ];
  }
}

// Actualizează userii în JSONBin
async function updateUsersInJSONBin(usersArray) {
  try {
    console.log('📡 Updating users in JSONBin...');
    
    const response = await fetch(
      `${JSONBIN_CONFIG.API_URL}/${JSONBIN_CONFIG.BIN_ID}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_CONFIG.API_KEY
        },
        body: JSON.stringify({ users: usersArray })
      }
    );
    
    const data = await response.json();
    console.log('✅ Users updated successfully');
    return data;
    
  } catch (error) {
    console.error('❌ Error updating users:', error);
    return { success: false, error: error.message };
  }
}

// Adaugă un user nou în JSONBin
async function addUserToJSONBin(newUser) {
  try {
    const users = await getUsersFromJSONBin();
    
    // Generează ID unic
    newUser.id = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
    newUser.created = new Date().toISOString().split('T')[0];
    newUser.status = 'active';
    newUser.avatar = newUser.username.charAt(0).toUpperCase();
    
    users.push(newUser);
    
    const result = await updateUsersInJSONBin(users);
    
    if (result.success !== false) {
      console.log('✅ User added:', newUser.username);
      return { success: true, user: newUser };
    } else {
      return { success: false, message: 'Failed to update JSONBin' };
    }
    
  } catch (error) {
    console.error('❌ Error adding user:', error);
    return { success: false, message: error.message };
  }
}

// ==================== FUNCTII AUTHENTIFICATION ====================

// Login function cu JSONBin
async function loginUser(username, password) {
  try {
    console.log(`🔐 Attempting login for: ${username}`);
    
    const users = await getUsersFromJSONBin();
    console.log(`📊 Total users in DB: ${users.length}`);
    
    // Caută user-ul
    const user = users.find(u => 
      (u.username === username || u.email === username) && 
      u.password === password
    );
    
    if (user) {
      // Actualizează lastLogin
      user.lastLogin = new Date().toISOString();
      
      // Salvează user în localStorage (fără parolă)
      const userToStore = { 
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        created: user.created,
        lastLogin: user.lastLogin
      };
      
      localStorage.setItem('currentUser', JSON.stringify(userToStore));
      localStorage.setItem('authToken', btoa(`${username}:${Date.now()}`));
      
      console.log('✅ Login successful for:', username);
      
      return {
        success: true,
        message: 'Login successful!',
        user: userToStore
      };
      
    } else {
      console.log('❌ Login failed: Invalid credentials');
      return {
        success: false,
        message: 'Username/email sau parolă incorectă!'
      };
    }
    
  } catch (error) {
    console.error('❌ Login error:', error);
    return {
      success: false,
      message: 'Eroare de conexiune. Verifică internetul.'
    };
  }
}

// Logout function
function logout() {
  const user = getCurrentUser();
  console.log(`👋 Logging out: ${user ? user.username : 'Unknown'}`);
  
  localStorage.removeItem('currentUser');
  localStorage.removeItem('authToken');
  
  window.location.href = 'index.html';
}

// Verifică dacă user-ul este logat
function checkLoginStatus() {
  const user = getCurrentUser();
  const token = localStorage.getItem('authToken');
  return !!(user && token);
}

// Obține user-ul curent
function getCurrentUser() {
  const userStr = localStorage.getItem('currentUser');
  return userStr ? JSON.parse(userStr) : null;
}

// Verifică dacă este admin
function isAdmin() {
  const user = getCurrentUser();
  return user && user.role === 'admin';
}

// Verifică dacă este membru
function isMember() {
  const user = getCurrentUser();
  return user && user.role === 'membru';
}

// Redirect dacă nu e logat
function requireLogin(redirectUrl = 'login.html') {
  if (!checkLoginStatus()) {
    alert('Trebuie să fii logat pentru a accesa această pagină!');
    window.location.href = redirectUrl;
    return false;
  }
  return true;
}

// Redirect dacă nu e admin
function requireAdmin(redirectUrl = 'index.html') {
  if (!isAdmin()) {
    alert('Acces interzis! Numai administratorii pot accesa această pagină.');
    window.location.href = redirectUrl;
    return false;
  }
  return true;
}

// Update UI bazat pe login status
function updateUIBasedOnLogin() {
  const user = getCurrentUser();
  
  // Update navbar
  const userNavItem = document.getElementById('userNavItem');
  const adminLink = document.getElementById('adminLink');
  const settingsLink = document.getElementById('settingsLink');
  
  if (user && userNavItem) {
    // Show user info in navbar
    userNavItem.innerHTML = `
      <div class="nav-item dropdown">
        <a class="nav-link dropdown-toggle" href="#" role="button" data-toggle="dropdown">
          <span class="badge badge-danger mr-1">${user.role}</span>
          <i class="fa fa-user"></i> ${user.username}
        </a>
        <div class="dropdown-menu">
          <a class="dropdown-item" href="profile.html">
            <i class="fa fa-user-circle"></i> Profil
          </a>
          <a class="dropdown-item" href="settings.html">
            <i class="fa fa-cog"></i> Setări
          </a>
          <div class="dropdown-divider"></div>
          <a class="dropdown-item text-danger" href="#" onclick="logout()">
            <i class="fa fa-sign-out"></i> Logout
          </a>
        </div>
      </div>
    `;
    
    // Show admin link only for admin
    if (adminLink && user.role === 'admin') {
      adminLink.style.display = 'block';
    }
    
    if (settingsLink) {
      settingsLink.style.display = 'block';
    }
    
  } else if (userNavItem) {
    // Show login button
    userNavItem.innerHTML = `
      <a class="nav-link" href="login.html">
        <i class="fa fa-sign-in"></i> Login
      </a>
    `;
    
    if (adminLink) adminLink.style.display = 'none';
    if (settingsLink) settingsLink.style.display = 'none';
  }
  
  // Update sidebar în index.html
  const loginSidebar = document.getElementById('loginSidebar');
  const userSidebar = document.getElementById('userSidebar');
  
  if (user && userSidebar) {
    if (loginSidebar) loginSidebar.style.display = 'none';
    userSidebar.style.display = 'block';
    document.getElementById('sidebarUsername').textContent = user.username;
    document.getElementById('sidebarRole').textContent = user.role.toUpperCase();
  } else if (loginSidebar) {
    loginSidebar.style.display = 'block';
    if (userSidebar) userSidebar.style.display = 'none';
  }
}

// ==================== FUNCTII ADMIN ====================

// Obține toți userii pentru admin panel
async function getAllUsersForAdmin() {
  try {
    const users = await getUsersFromJSONBin();
    return users.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      created: user.created,
      lastLogin: user.lastLogin,
      status: user.status || 'active'
    }));
  } catch (error) {
    console.error('Error getting users for admin:', error);
    return [];
  }
}

// Șterge user (doar admin)
async function deleteUserById(userId) {
  if (!confirm('Sigur vrei să ștergi acest utilizator? Acțiunea este permanentă!')) {
    return false;
  }
  
  try {
    const users = await getUsersFromJSONBin();
    const filteredUsers = users.filter(user => user.id !== userId);
    
    const result = await updateUsersInJSONBin(filteredUsers);
    
    if (result.success !== false) {
      alert('Utilizator șters cu succes!');
      return true;
    } else {
      alert('Eroare la ștergerea utilizatorului.');
      return false;
    }
    
  } catch (error) {
    console.error('Error deleting user:', error);
    alert('Eroare la ștergerea utilizatorului: ' + error.message);
    return false;
  }
}

// Schimbă rolul user-ului
async function changeUserRole(userId, newRole) {
  try {
    const users = await getUsersFromJSONBin();
    const userIndex = users.findIndex(user => user.id === userId);
    
    if (userIndex === -1) {
      alert('Utilizatorul nu a fost găsit!');
      return false;
    }
    
    users[userIndex].role = newRole;
    
    const result = await updateUsersInJSONBin(users);
    
    if (result.success !== false) {
      alert(`Rolul utilizatorului a fost schimbat în: ${newRole}`);
      return true;
    } else {
      alert('Eroare la schimbarea rolului.');
      return false;
    }
    
  } catch (error) {
    console.error('Error changing user role:', error);
    alert('Eroare: ' + error.message);
    return false;
  }
}

// ==================== INITIALIZATION ====================

// Inițializează la load
document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 Anime Uke V2 Initialized');
  
  // Update UI based on login
  updateUIBasedOnLogin();
  
  // Add logout event listeners
  document.querySelectorAll('.logout-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      logout();
    });
  });
  
  // Load admin panel dacă există
  if (document.getElementById('usersTableBody')) {
    loadAdminUsersTable();
  }
});

// Load admin users table
async function loadAdminUsersTable() {
  if (!isAdmin()) return;
  
  try {
    const users = await getAllUsersForAdmin();
    let html = '';
    
    users.forEach(user => {
      const statusClass = user.status === 'active' ? 'badge-success' : 'badge-secondary';
      const roleClass = user.role === 'admin' ? 'badge-danger' : 
                        user.role === 'membru' ? 'badge-primary' : 'badge-info';
      
      html += `
      <tr>
        <td>${user.id}</td>
        <td>
          <div class="d-flex align-items-center">
            <div class="user-avatar mr-2" style="background: #6d0019;">
              ${user.avatar}
            </div>
            ${user.username}
          </div>
        </td>
        <td>${user.email}</td>
        <td>
          <span class="badge ${roleClass}">
            ${user.role}
          </span>
        </td>
        <td>${user.created}</td>
        <td>
          <span class="badge ${statusClass}">
            ${user.status}
          </span>
        </td>
        <td>
          <button class="btn btn-sm btn-anime" onclick="promptEditUser(${user.id})">
            <i class="fa fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger ml-1" onclick="promptDeleteUser(${user.id})">
            <i class="fa fa-trash"></i>
          </button>
        </td>
      </tr>
      `;
    });
    
    document.getElementById('usersTableBody').innerHTML = html;
    
    // Update stats
    document.getElementById('totalUsers').textContent = users.length;
    
  } catch (error) {
    console.error('Error loading admin table:', error);
  }
}

// Prompt pentru ștergere user
async function promptDeleteUser(userId) {
  const success = await deleteUserById(userId);
  if (success) {
    loadAdminUsersTable();
  }
}

// Prompt pentru editare user
async function promptEditUser(userId) {
  const users = await getAllUsersForAdmin();
  const user = users.find(u => u.id === userId);
  
  if (!user) {
    alert('User not found!');
    return;
  }
  
  const newRole = prompt(`Schimbă rolul pentru ${user.username}\n\nOpțiuni: admin, membru, user`, user.role);
  
  if (newRole && newRole !== user.role && ['admin', 'membru', 'user'].includes(newRole)) {
    const success = await changeUserRole(userId, newRole);
    if (success) {
      loadAdminUsersTable();
    }
  }
}

// ==================== EXPORT FUNCTII ====================

window.loginUser = loginUser;
window.logout = logout;
window.checkLoginStatus = checkLoginStatus;
window.getCurrentUser = getCurrentUser;
window.isAdmin = isAdmin;
window.isMember = isMember;
window.requireLogin = requireLogin;
window.requireAdmin = requireAdmin;
window.updateUIBasedOnLogin = updateUIBasedOnLogin;
window.getAllUsersForAdmin = getAllUsersForAdmin;
window.deleteUserById = deleteUserById;
window.changeUserRole = changeUserRole;
window.loadAdminUsersTable = loadAdminUsersTable;
window.promptDeleteUser = promptDeleteUser;
window.promptEditUser = promptEditUser;

console.log('🎮 Anime Uke V2 Auth System Ready!');
