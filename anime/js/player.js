const episodeId=new URLSearchParams(location.search).get('episode_id');
let currentUser=null;
fetch('/api/user').then(r=>r.ok?r.json():null).then(u=>currentUser=u);
async function loadEpisode(){
    const res=await fetch(`/api/episodes/${episodeId}/watch`,{method:'GET'}); // custom endpoint for episode details
    const ep=await res.json();
    document.getElementById('video-container').innerHTML=`<iframe src="${ep.doodstream_link}" width="100%" height="500" frameborder="0" allowfullscreen></iframe>`;
    // check if already watched
    const watched=await fetch(`/api/episodes/${episodeId}/watched`).then(r=>r.json());
    if(watched.watched) document.getElementById('markWatchedBtn').disabled=true;
}
document.getElementById('markWatchedBtn').addEventListener('click',async()=>{
    const res=await fetch(`/api/episodes/${episodeId}/watch`,{method:'POST'});
    if(res.ok){ alert('+5 Gold, +10 XP'); location.reload(); }
    else alert('Deja vizionat sau eroare');
});
function renderComments(comments){
    const container=document.getElementById('comments-list');
    container.innerHTML=comments.map(c=>`<div class="comment" data-id="${c.id}"><b>${c.username}</b> <small>${new Date(c.created_at).toLocaleString()}</small> <span>👍 ${c.score}</span> <button class="vote-up">👍</button> <button class="vote-down">👎</button><div>${formatSpoilers(c.content)}</div>${c.parent_id==null?'<button class="reply-btn">Răspunde</button>':''}</div>`).join('');
    // attach vote events
}
function formatSpoilers(text){ return text.replace(/\[spoiler\](.*?)\[\/spoiler\]/g,'<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>'); }
loadEpisode();
fetch(`/api/comments?episode_id=${episodeId}`).then(r=>r.json()).then(renderComments);
