import { initDB } from '../utils/db.js';
export async function onRequest(context){
    const {request,env}=context;
    await initDB(env);
    const {email,password}=await request.json();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const user=await env.DB.prepare('SELECT id FROM users WHERE email=? AND password_hash=?').bind(email,hash).first();
    if(!user) return new Response('Invalid',{status:401});
    const token=crypto.randomUUID();
    await env.SESSIONS.put(`session:${token}`,JSON.stringify({userId:user.id,expires:Date.now()+7*86400000}),{expirationTtl:604800});
    return new Response(JSON.stringify({success:true}),{headers:{'Set-Cookie':`auth_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`}});
}
