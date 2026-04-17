import { initDB, getUserFromToken } from '../utils/db.js';
export async function onRequest(context){
    const {request,env,params}=context;
    await initDB(env);
    const user=await getUserFromToken(request,env);
    if(!user) return new Response('Unauth',{status:401});
    const episodeId=params.id;
    if(request.method==='POST'){
        const exists=await env.DB.prepare('SELECT 1 FROM user_watch_history WHERE user_id=? AND episode_id=?').bind(user.id,episodeId).first();
        if(exists) return new Response('Already watched',{status:400});
        await env.DB.prepare('INSERT INTO user_watch_history (user_id,episode_id) VALUES (?,?)').bind(user.id,episodeId).run();
        await env.DB.prepare('UPDATE users SET gold=gold+5, xp=xp+10 WHERE id=?').bind(user.id).run();
        return new Response('OK');
    }
    // GET episode details
    const ep=await env.DB.prepare('SELECT * FROM episodes WHERE id=?').bind(episodeId).first();
    return new Response(JSON.stringify(ep));
}
