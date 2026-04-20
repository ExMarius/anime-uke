// src/auth.js
import jwt from 'jsonwebtoken';

export function generateId() {
  return crypto.randomUUID();
}

// Hash parolă simplă (pentru demo - în producție folosește bcrypt)
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'anime-secret-salt');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password, hash) {
  const newHash = await hashPassword(password);
  return newHash === hash;
}

export async function verifyAuth(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const tokenMatch = cookie.match(/auth_token=([^;]+)/);
  
  if (!tokenMatch) return null;
  
  try {
    const decoded = jwt.verify(tokenMatch[1], env.JWT_SECRET);
    const user = await env.DB.prepare(
      'SELECT id, username, email, role, points FROM users WHERE id = ?'
    ).bind(decoded.userId).first();
    return user;
  } catch (error) {
    return null;
  }
}

export async function handleRegister(request, env) {
  try {
    const { username, email, password } = await request.json();
    
    if (!username || !email || !password || password.length < 4) {
      return new Response(JSON.stringify({ error: 'Date invalide. Parola minim 4 caractere.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ? OR username = ?'
    ).bind(email, username).first();
    
    if (existing) {
      return new Response(JSON.stringify({ error: 'Email sau username deja folosit.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const passwordHash = await hashPassword(password);
    const userId = generateId();
    
    await env.DB.prepare(
      `INSERT INTO users (id, username, email, password_hash, points, role) 
       VALUES (?, ?, ?, ?, 0, 'user')`
    ).bind(userId, username, email, passwordHash).run();
    
    return new Response(JSON.stringify({ success: true, userId }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Register error:', error);
    return new Response(JSON.stringify({ error: 'Eroare internă.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleLogin(request, env) {
  try {
    const { email, password } = await request.json();
    
    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email și parolă obligatorii.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const user = await env.DB.prepare(
      'SELECT id, username, email, password_hash, role, points FROM users WHERE email = ?'
    ).bind(email).first();
    
    if (!user) {
      return new Response(JSON.stringify({ error: 'Email sau parolă incorecte.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Email sau parolă incorecte.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    await env.DB.prepare(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(user.id).run();
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    return new Response(JSON.stringify({ 
      success: true, 
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        points: user.points
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `auth_token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/`
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({ error: 'Eroare internă.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export function handleLogout() {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'auth_token=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/'
    }
  });
}

export async function handleGetMe(request, env) {
  const user = await verifyAuth(request, env);
  
  if (!user) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
