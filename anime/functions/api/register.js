import { initDB, getUserFromToken } from '../utils/db.js';
export async function onRequest(context){
    const {request,env}=context;
    await initDB(env);
    const {username,email,password}=await request.json();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const count=await env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first();
    const role=count.cnt===0?'admin':'user';
    try{
        await env.DB.prepare('INSERT INTO users (username,email,password_hash,role) VALUES (?,?,?,?)').bind(username,email,hash,role).run();
        return new Response(JSON.stringify({success:true}),{status:201});
    }catch(e){ return new Response(JSON.stringify({error:'Email/username deja folosit'}),{status:400});}
}
