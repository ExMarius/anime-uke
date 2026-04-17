async function loadSeriesSelects(){
    const res=await fetch('/api/series');
    const series=await res.json();
    const opts=series.map(s=>`<option value="${s.id}">${s.name}</option>`);
    document.getElementById('episodeSeriesId').innerHTML=opts;
    document.getElementById('deleteSeriesId').innerHTML=opts;
    const epsRes=await fetch('/api/episodes/all'); // custom admin endpoint
    const eps=await epsRes.json();
    document.getElementById('deleteEpisodeId').innerHTML=eps.map(e=>`<option value="${e.id}">${e.series_name} - Ep.${e.episode_number}</option>`);
}
document.getElementById('addSeriesForm').addEventListener('submit', async(e)=>{
    e.preventDefault();
    await fetch('/api/admin/series',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:seriesName.value,slug:seriesSlug.value,description:seriesDesc.value,image_url:seriesImage.value,age_min:seriesAge.value})});
    location.reload();
});
// similar addEpisode, delete...
loadSeriesSelects();
