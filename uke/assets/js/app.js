// AnimeNexus - JavaScript Principal

// Încarcă datele pentru homepage
async function loadHomePageData() {
    try {
        // Încarcă ultimele episoade
        const episodesResponse = await fetch('/episodes.json');
        const episodes = await episodesResponse.json();
        displayLatestEpisodes(episodes.slice(-6).reverse());
        
        // Încarcă seriile populare
        const seriesResponse = await fetch('/series.json');
        const series = await seriesResponse.json();
        displayPopularSeries(series.slice(0, 8));
        
        // Încarcă genurile
        const genresResponse = await fetch('/genres.json');
        const genres = await genresResponse.json();
        displayGenres(genres);
        
    } catch (error) {
        console.error('Eroare la încărcarea datelor:', error);
        showError('Nu s-au putut încărca datele.');
    }
}

// Afișează ultimele episoade
function displayLatestEpisodes(episodes) {
    const container = document.getElementById('latest-episodes-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    episodes.forEach(episode => {
        const col = document.createElement('div');
        col.className = 'col-md-4 col-lg-2';
        
        col.innerHTML = `
            <div class="anime-card h-100" onclick="window.location.href='/watch.html?anime=${episode.animeSlug}&ep=${episode.number}'">
                <img src="https://cdn.myanimelist.net/images/anime/1244/138851.jpg" 
                     class="anime-poster" alt="${episode.animeTitle}">
                <div class="p-3">
                    <h6 class="fw-bold">${episode.animeTitle}</h6>
                    <p class="mb-1"><strong>Episod ${episode.number}</strong></p>
                    <small class="text-muted">${episode.title || ''}</small>
                    <div class="mt-2">
                        <span class="badge bg-danger">${episode.releaseDate}</span>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(col);
    });
}

// Afișează seriile populare
function displayPopularSeries(series) {
    const container = document.getElementById('popular-series-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    series.forEach(anime => {
        const col = document.createElement('div');
        col.className = 'col-md-3 col-lg-3';
        
        col.innerHTML = `
            <div class="anime-card h-100" onclick="viewSeries('${anime.slug}')">
                <img src="${anime.poster}" 
                     class="anime-poster" alt="${anime.title}"
                     onerror="this.src='https://via.placeholder.com/300x400?text=No+Image'">
                <div class="p-3">
                    <h6 class="fw-bold">${anime.title}</h6>
                    <div class="mb-2">
                        ${anime.genres.slice(0, 2).map(genre => 
                            `<span class="badge bg-secondary me-1">${genre}</span>`
                        ).join('')}
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <small>${anime.year}</small>
                        <small><i class="fas fa-star text-warning"></i> ${anime.rating}</small>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(col);
    });
}

// Afișează genurile
function displayGenres(genres) {
    const container = document.getElementById('genres-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    genres.forEach(genre => {
        const badge = document.createElement('span');
        badge.className = 'badge-genre';
        badge.textContent = genre.name;
        badge.style.cursor = 'pointer';
        badge.onclick = () => {
            window.location.href = `/series.html?genre=${genre.id}`;
        };
        
        container.appendChild(badge);
    });
}

// Funcție pentru a vizualiza o serie
function viewSeries(slug) {
    window.location.href = `/series.html?slug=${slug}`;
}

// Initializează
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('latest-episodes-container')) {
        loadHomePageData();
    }
});
