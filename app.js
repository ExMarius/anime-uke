// app.js - Sistem complet de gestionare anime
// Folosește LocalStorage ca fallback, dar pe Cloudflare Pages poți folosi KV Storage

const STORAGE_KEY = 'anime_nexus_data';

// ====== FUNCȚII DE BAZĂ ======

// Salvează toate datele
async function saveAllData(data) {
    try {
        // Pe Cloudflare Pages, aici ai folosi KV Storage
        // await ANIME_KV.put('series', JSON.stringify(data));
        
        // Pentru local development, folosim localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Eroare la salvarea datelor:', error);
        return false;
    }
}

// Încarcă toate datele
async function getAllData() {
    try {
        // Pe Cloudflare Pages: const data = await ANIME_KV.get('series', 'json');
        
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.error('Eroare la încărcarea datelor:', error);
        return [];
    }
}

// ====== FUNCȚII PENTRU SERII ======

// Obține toate seriile
async function getSeries() {
    return await getAllData();
}

// Adaugă o serie nouă
async function addSerie(serieData) {
    const series = await getSeries();
    
    // Verifică dacă ID-ul există deja
    if (series.some(s => s.id === serieData.id)) {
        return { success: false, message: 'Există deja o serie cu acest ID!' };
    }
    
    // Adaugă data creării și array gol pentru episoade
    const newSerie = {
        ...serieData,
        data_creare: new Date().toISOString().split('T')[0],
        episoade: [],
        vizionari_totale: 0
    };
    
    series.push(newSerie);
    const saved = await saveAllData(series);
    
    return {
        success: saved,
        message: saved ? 'Serie adăugată cu succes!' : 'Eroare la salvare',
        serie: newSerie
    };
}

// Șterge o serie
async function deleteSerie(serieId) {
    if (!confirm(`Sigur vrei să ștergi această serie și toate episoadele ei?`)) {
        return false;
    }
    
    const series = await getSeries();
    const filteredSeries = series.filter(s => s.id !== serieId);
    
    const saved = await saveAllData(filteredSeries);
    
    if (saved) {
        alert('Serie ștearsă cu succes!');
        location.reload();
    }
    
    return saved;
}

// ====== FUNCȚII PENTRU EPISOADE ======

// Adaugă un episod nou
async function addEpisode(serieId, episodeData) {
    const series = await getSeries();
    const serieIndex = series.findIndex(s => s.id === serieId);
    
    if (serieIndex === -1) {
        return { success: false, message: 'Serie negăsită!' };
    }
    
    // Verifică dacă episodul există deja
    if (series[serieIndex].episoade.some(ep => ep.numar === episodeData.numar)) {
        return { success: false, message: 'Există deja un episod cu acest număr!' };
    }
    
    // Adaugă data și vizionări inițiale
    const newEpisode = {
        ...episodeData,
        data_adaugare: new Date().toISOString().split('T')[0],
        vizionari: 0
    };
    
    series[serieIndex].episoade.push(newEpisode);
    
    // Sortează episoadele după număr
    series[serieIndex].episoade.sort((a, b) => a.numar - b.numar);
    
    const saved = await saveAllData(series);
    
    return {
        success: saved,
        message: saved ? 'Episod adăugat cu succes!' : 'Eroare la salvare',
        episode: newEpisode
    };
}

// ====== FUNCȚII PENTRU AFIȘARE ======

// Încarcă ultimele episoade (cele mai recente)
async function loadLatestEpisodes() {
    const series = await getSeries();
    const container = document.getElementById('latestEpisodes');
    
    if (!container) return;
    
    if (series.length === 0) {
        container.innerHTML = '<p class="no-data">Nu există episoade încă.</p>';
        return;
    }
    
    // Colectează toate episoadele
    let allEpisodes = [];
    series.forEach(serie => {
        serie.episoade.forEach(ep => {
            allEpisodes.push({
                ...ep,
                serieId: serie.id,
                serieTitlu: serie.titlu,
                serieImagine: serie.imagine
            });
        });
    });
    
    // Sortează după dată (cele mai noi primele)
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
                        <span>👁️ ${ep.vizionari}</span>
                        <span>📅 ${ep.data_adaugare}</span>
                    </div>
                    <a href="/serie.html?id=${ep.serieId}&ep=${ep.numar}" class="btn-watch">▶ Vizionează</a>
                </div>
            </div>
        `;
    });
}

// Încarcă toate seriile
async function loadAllSeries() {
    const series = await getSeries();
    const container = document.getElementById('allSeries');
    
    if (!container) return;
    
    if (series.length === 0) {
        container.innerHTML = '<p class="no-data">Nu există serii încă.</p>';
        return;
    }
    
    container.innerHTML = '';
    series.forEach(serie => {
        container.innerHTML += `
            <a href="/serie.html?id=${serie.id}" class="series-card-link">
                <div class="series-card">
                    <div class="series-image" style="background-image: url('${serie.imagine}')">
                        <div class="series-overlay">
                            <span class="episode-count">${serie.episoade.length} episoade</span>
                        </div>
                    </div>
                    <div class="series-content">
                        <h3>${serie.titlu}</h3>
                        <p class="series-desc">${serie.descriere.substring(0, 80)}...</p>
                        <div class="series-genres">
                            ${serie.genuri.slice(0, 3).map(gen => `<span class="genre">${gen}</span>`).join('')}
                        </div>
                    </div>
                </div>
            </a>
        `;
    });
}

// ====== FUNCȚII PENTRU ADMIN ======

// Funcția apelată din admin.html pentru adăugare serie
async function addSerieFromForm() {
    const serieData = {
        id: document.getElementById('serieId').value.trim().toLowerCase(),
        titlu: document.getElementById('serieTitlu').value.trim(),
        descriere: document.getElementById('serieDesc').value.trim(),
        genuri: document.getElementById('serieGenuri').value.split(',').map(g => g.trim()),
        imagine: document.getElementById('serieImagine').value.trim(),
        tara: document.getElementById('serieTara').value.trim() || 'Japonia'
    };
    
    // Validare
    if (!serieData.id || !serieData.titlu || !serieData.descriere) {
        showStatus('serieStatus', 'Completează toate câmpurile obligatorii!', 'error');
        return;
    }
    
    const result = await addSerie(serieData);
    
    if (result.success) {
        showStatus('serieStatus', '✅ Serie adăugată cu succes!', 'success');
        // Reset form
        document.getElementById('serieId').value = '';
        document.getElementById('serieTitlu').value = '';
        document.getElementById('serieDesc').value = '';
        document.getElementById('serieGenuri').value = '';
        document.getElementById('serieImagine').value = '';
        
        // Reîncarcă listele
        loadSeriesForSelect();
        loadSeriesForManagement();
        loadAllData();
    } else {
        showStatus('serieStatus', `❌ ${result.message}`, 'error');
    }
}

// Funcția apelată din admin.html pentru adăugare episod
async function addEpisodeFromForm() {
    const serieId = document.getElementById('selectSerie').value;
    const episodeData = {
        numar: parseInt(document.getElementById('episodeNumber').value),
        titlu: document.getElementById('episodeTitlu').value.trim(),
        filemoon: document.getElementById('episodeFilemoon').value.trim(),
        descriere: document.getElementById('episodeDesc').value.trim(),
        durata: parseInt(document.getElementById('episodeDurata').value) || 24
    };
    
    // Validare
    if (!serieId || !episodeData.numar || !episodeData.titlu || !episodeData.filemoon) {
        showStatus('episodeStatus', 'Completează toate câmpurile obligatorii!', 'error');
        return;
    }
    
    const result = await addEpisode(serieId, episodeData);
    
    if (result.success) {
        showStatus('episodeStatus', '✅ Episod adăugat cu succes!', 'success');
        // Reset form
        document.getElementById('episodeNumber').value = '';
        document.getElementById('episodeTitlu').value = '';
        document.getElementById('episodeFilemoon').value = '';
        document.getElementById('episodeDesc').value = '';
        document.getElementById('episodeDurata').value = '24';
    } else {
        showStatus('episodeStatus', `❌ ${result.message}`, 'error');
    }
}

// Afișează mesaj de status
function showStatus(elementId, message, type = 'info') {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    element.textContent = message;
    element.className = `status-message status-${type}`;
    element.style.display = 'block';
    
    // Ascunde mesajul după 5 secunde
    setTimeout(() => {
        element.style.display = 'none';
    }, 5000);
}

// ====== DATE DE EXEMPLU PENTRU PRIMUL START ======

// Funcție pentru a inițializa cu date demo
async function initDemoData() {
    const series = await getSeries();
    
    if (series.length === 0) {
        const demoSeries = [
            {
                id: "one-piece",
                titlu: "One Piece",
                descriere: "Povestea lui Monkey D. Luffy și a echipajului său de pirați în căutarea celui mai mare comoară din lume, One Piece.",
                genuri: ["Aventură", "Acțiune", "Shounen", "Fantastic"],
                imagine: "https://i.imgur.com/one-piece.jpg",
                tara: "Japonia",
                data_creare: "2025-12-07",
                episoade: [
                    {
                        numar: 1,
                        titlu: "Eu sunt Luffy! Omul care va deveni Regele Piraților!",
                        filemoon: "https://filemoon.to/e/qx8ixv2merzt/One_Piece_-_0001__480p_RoSub___Shinobi_ACG_.mp4",
                        descriere: "Primul episod din One Piece",
                        durata: 24,
                        data_adaugare: "2025-12-07",
                        vizionari: 91235
                    }
                ],
                vizionari_totale: 91235
            },
            {
                id: "look-plus-one-piece",
                titlu: "Look Plus One Piece Special Movie",
                descriere: "O colaborare cu One Piece pentru produsele de curățare marca Lions „Look Plus”.",
                genuri: ["Comedie", "Shounen"],
                imagine: "https://i.imgur.com/tKnzRWrl.png",
                tara: "Japonia",
                data_creare: "2025-12-07",
                episoade: [
                    {
                        numar: 1,
                        titlu: "Look Plus x One Piece",
                        filemoon: "https://filemoon.to/e/exemplu",
                        descriere: "Episod special de colaborare",
                        durata: 2,
                        data_adaugare: "2025-12-07",
                        vizionari: 1500
                    }
                ],
                vizionari_totale: 1500
            }
        ];
        
        await saveAllData(demoSeries);
        console.log('Date demo inițializate cu succes!');
    }
}

// Inițializează la încărcare
document.addEventListener('DOMContentLoaded', async function() {
    // Comentează linia de mai jos după prima rulare
    // await initDemoData();
    
    // Încarcă datele pe paginile principale
    if (document.getElementById('latestEpisodes')) {
        loadLatestEpisodes();
    }
    
    if (document.getElementById('allSeries')) {
        loadAllSeries();
    }
});

// Expune funcțiile global pentru admin.html
window.addSerie = addSerieFromForm;
window.addEpisode = addEpisodeFromForm;
window.getSeries = getSeries;
window.deleteSerie = deleteSerie;
window.loadSeriesForSelect = loadSeriesForSelect;
window.loadSeriesForManagement = loadSeriesForManagement;
window.loadAllData = loadAllData;
