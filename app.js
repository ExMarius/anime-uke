const API_BASE = '/api';
let token = null;
let currentUser = null;

function getToken() {
  return document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1];
}

async function apiCall(endpoint, options = {}) {
  const t = getToken();
  if (t) options.headers = { ...options.headers, Cookie: `token=${t}` };
  const res = await fetch(API_BASE + endpoint, options);
  if (res.status === 401) { logout(); return null; }
  return res.json();
}

function logout() {
  document.cookie = "token=; Max-Age=0";
  location.href = '/login.html';
}

// Tailwind init
function initTailwind() {
  tailwind.config = { content: ["./**/*.html"], theme: { extend: {} } };
}
