// AnimeNexus App - Basic loading
console.log('AnimeNexus loaded');

async function loadHomeData() {
    try {
        const response = await fetch('/episodes.json');
        const episodes = await response.json();
        console.log('Loaded episodes:', episodes.length);
        
        // Aici va fi logica pentru afișarea episoadelor
        // Moment doar logăm
        return episodes;
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded');
    loadHomeData();
});
