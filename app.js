// app.js - Sistem complet cu GitHub JSON
const DATA_URL = 'https://raw.githubusercontent.com/ExMarius/anime-uke/main/data.json';

// Cache pentru performanță
let animeCache = null;
let lastFetch = 0;

// Încarcă datele de pe GitHub
async function loadData() {
    // Folosește cache dacă e fresh (5 minute)
    if (animeCache && Date.now() - lastFetch < 300000) {
        return animeCache;
    }
    
    try {
        const response = await fetch(DATA_URL + '?t=' + Date.now());
        if (!response.ok) throw new Error('Eroare la încărcare');
        
        animeCache = await response.json();
        lastFetch = Date.now();
        return animeCache;
    } catch (error) {
        console.error('Eroare la încărcarea datelor:', error);
        return [];
    }
}

// Obține toate seriile
async function getSeries() {
    return await loadData();
}

// ====== PENTRU AFIȘARE PE SITE ======

// Încarcă ultimele episoade
async function loadLatestEpisodes() {
    const container = document.getElementById('latestEpisodes');
    if (!container) return;
    
    const series = await getSeries();
    
    if (series.length === 0) {
        container.innerHTML = '<p class="no-data">🎬 Nu există episoade încă. Verifică mai târziu!</p>';
        return;
    }
    
    // Colectează TOATE episoadele
    let allEpisodes = [];
    series.forEach(serie => {
        if (serie.episoade && serie.episoade.length > 0) {
            serie.episoade.forEach(ep => {
                allEpisodes.push({
                    ...ep,
                    serieId: serie.id,
                    serieTitlu: serie.titlu,
                    serieImagine: serie.imagine || 'https://i.imgur.com/zocDECh'
                });
            });
        }
    });
    
    if (allEpisodes.length === 0) {
        container.innerHTML = '<p class="no-data">📺 Niciun episod adăugat încă.</p>';
        return;
    }
    
    // Sortează după dată (cele mai noi)
    allEpisodes.sort((a, b) => new Date(b.data_adaugare) - new Date(a.data_adaugare));
    
    // Afișează primele 6
    container.innerHTML = '';
    allEpisodes.slice(0, 6).forEach(ep => {
        container.innerHTML += `
            <div class="episode-card">
                <div class="episode-thumbnail" style="background-image: url('${ep.serieImagine}')">
                    <div class="episode-badge">Ep ${ep.numar}</div>
                </div>
                <div class="episode-info">
                    <h4>${ep.serieTitlu}</h4>
                    <h3>${ep.titlu}</h3>
                    <div class="episode-meta">
                        <span>👁️ ${ep.vizionari || 0}</span>
                        <span>⏱️ ${ep.durata || 24}min</span>
                        <span>📅 ${ep.data_adaugare || 'Recent'}</span>
                    </div>
                    <a href="serie.html?id=${ep.serieId}&ep=${ep.numar}" class="btn-watch">▶ Vizionează</a>
                </div>
            </div>
        `;
    });
}

// Încarcă toate seriile
async function loadAllSeries() {
    const container = document.getElementById('allSeries');
    if (!container) return;
    
    const series = await getSeries();
    
    if (series.length === 0) {
        container.innerHTML = `
            <div class="no-data">
                <h3>📭 Nu există serii încă</h3>
                <p>Administratorul va adăuga serii în curând!</p>
                <a href="admin.html" class="btn-watch">➕ Adaugă prima serie</a>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    series.forEach(serie => {
        const epCount = serie.episoade ? serie.episoade.length : 0;
        const genres = serie.genuri ? serie.genuri.slice(0, 3) : [];
        
        container.innerHTML += `
            <a href="serie.html?id=${serie.id}" class="series-card-link">
                <div class="series-card">
                    <div class="series-image" style="background-image: url('${serie.imagine || 'https://i.imgur.com/zocDECh'}')">
                        <div class="series-overlay">
                            <span class="episode-count">${epCount} episoade</span>
                        </div>
                    </div>
                    <div class="series-content">
                        <h3>${serie.titlu}</h3>
                        <p class="series-desc">${(serie.descriere || '').substring(0, 80)}...</p>
                        <div class="series-genres">
                            ${genres.map(gen => `<span class="genre">${gen}</span>`).join('')}
                            ${epCount === 0 ? '<span class="genre">În așteptare</span>' : ''}
                        </div>
                    </div>
                </div>
            </a>
        `;
    });
}

// ====== AUTO-LOAD LA DESCHIDERE ======
document.addEventListener('DOMContentLoaded', function() {
    // Verifică ce pagină e deschisă
    if (document.getElementById('latestEpisodes')) {
        loadLatestEpisodes();
    }
    
    if (document.getElementById('allSeries')) {
        loadAllSeries();
    }
    
    // Pentru admin, încarcă datele pentru dropdown
    if (document.getElementById('selectSerie')) {
        loadData().then(series => {
            const select = document.getElementById('selectSerie');
            select.innerHTML = '<option value="">Alege o serie...</option>' +
                series.map(s => 
                    `<option value="${s.id}">${s.titlu} (${s.episoade?.length || 0} episoade)</option>`
                ).join('');
        });
    }
});
