// AnimeUKE App
console.log('AnimeUKE loaded successfully!');

// Utility function for loading JSON
async function loadJSON(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`Error loading ${url}:`, error);
        return null;
    }
}

// Export for use in other files
window.AnimeUKE = {
    loadJSON,
    version: '1.0.0'
};
