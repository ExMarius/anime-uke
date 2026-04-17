export async function initDB(env){
    const db=env.DB;
    await db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, email TEXT UNIQUE, password_hash TEXT, role TEXT DEFAULT 'user', gold INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, preferred_server TEXT DEFAULT '');`);
    await db.exec(`CREATE TABLE IF NOT EXISTS anime_series (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE, description TEXT, image_url TEXT, age_min INTEGER);`);
    await db.exec(`CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, series_id INTEGER, episode_number INTEGER, title TEXT, doodstream_link TEXT, FOREIGN KEY(series_id) REFERENCES anime_series(id) ON DELETE CASCADE);`);
    await db.exec(`CREATE TABLE IF NOT EXISTS user_watch_history (user_id INTEGER, episode_id INTEGER, PRIMARY KEY(user_id,episode_id));`);
    await db.exec(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id INTEGER, user_id INTEGER, parent_comment_id INTEGER, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
    await db.exec(`CREATE TABLE IF NOT EXISTS comment_votes (comment_id INTEGER, user_id INTEGER, vote_type INTEGER, PRIMARY KEY(comment_id,user_id));`);
}
export async function getUserFromToken(request, env){
    const cookie=request.headers.get('Cookie')||'';
    const token=cookie.split('auth_token=')[1]?.split(';')[0];
    if(!token) return null;
    const session=await env.SESSIONS.get(`session:${token}`,{type:'json'});
    if(!session || session.expires<Date.now()) return null;
    const user=await env.DB.prepare('SELECT id,username,role,gold,xp,preferred_server FROM users WHERE id=?').bind(session.userId).first();
    return user;
}
