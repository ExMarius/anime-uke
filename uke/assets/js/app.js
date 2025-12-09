// AnimeUKE App Utilities
console.log('AnimeUKE App loaded successfully! 🎬');

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

// Get URL parameters
function getUrlParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Set URL parameter
function setUrlParam(name, value) {
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set(name, value);
    window.history.replaceState({}, '', `${window.location.pathname}?${urlParams}`);
}

// Show notification
function showNotification(message, type = 'info', duration = 3000) {
    // Remove existing notification
    const existingNotif = document.getElementById('animeuke-notification');
    if (existingNotif) existingNotif.remove();
    
    // Create notification
    const notification = document.createElement('div');
    notification.id = 'animeuke-notification';
    notification.className = `alert alert-${type} position-fixed`;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 10000;
        min-width: 300px;
        max-width: 500px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease;
    `;
    notification.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
            <span>${message}</span>
            <button type="button" class="btn-close" onclick="this.parentElement.parentElement.remove()"></button>
        </div>
    `;
    
    // Add animation style
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(notification);
    
    // Auto remove after duration
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, duration);
    
    return notification;
}

// Format number with commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Check if element is in viewport
function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}

// Smooth scroll to element
function smoothScrollTo(element, duration = 500) {
    const targetPosition = element.getBoundingClientRect().top + window.pageYOffset;
    const startPosition = window.pageYOffset;
    const distance = targetPosition - startPosition;
    let startTime = null;

    function animation(currentTime) {
        if (startTime === null) startTime = currentTime;
        const timeElapsed = currentTime - startTime;
        const run = ease(timeElapsed, startPosition, distance, duration);
        window.scrollTo(0, run);
        if (timeElapsed < duration) requestAnimationFrame(animation);
    }

    function ease(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t + b;
        t--;
        return -c / 2 * (t * (t - 2) - 1) + b;
    }

    requestAnimationFrame(animation);
}

// Local storage wrapper
const Storage = {
    set: (key, value) => {
        try {
            localStorage.setItem(`animeuke_${key}`, JSON.stringify(value));
        } catch (e) {
            console.error('LocalStorage error:', e);
        }
    },
    
    get: (key, defaultValue = null) => {
        try {
            const item = localStorage.getItem(`animeuke_${key}`);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.error('LocalStorage error:', e);
            return defaultValue;
        }
    },
    
    remove: (key) => {
        localStorage.removeItem(`animeuke_${key}`);
    },
    
    clear: () => {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('animeuke_')) {
                localStorage.removeItem(key);
            }
        });
    }
};

// Watch history management
const WatchHistory = {
    add: (animeSlug, episodeNumber, animeTitle, episodeTitle) => {
        const history = Storage.get('watch_history', []);
        const existingIndex = history.findIndex(item => 
            item.animeSlug === animeSlug && item.episodeNumber === episodeNumber
        );
        
        const entry = {
            animeSlug,
            episodeNumber,
            animeTitle,
            episodeTitle,
            timestamp: Date.now(),
            watchedAt: new Date().toLocaleString()
        };
        
        if (existingIndex !== -1) {
            history[existingIndex] = entry;
        } else {
            history.unshift(entry);
        }
        
        // Keep only last 50 entries
        Storage.set('watch_history', history.slice(0, 50));
    },
    
    get: () => {
        return Storage.get('watch_history', []);
    },
    
    clear: () => {
        Storage.remove('watch_history');
    },
    
    getLastWatched: (animeSlug) => {
        const history = Storage.get('watch_history', []);
        return history.find(item => item.animeSlug === animeSlug);
    }
};

// Favorites management
const Favorites = {
    add: (animeSlug, animeTitle, poster) => {
        const favorites = Storage.get('favorites', []);
        
        if (!favorites.some(fav => fav.animeSlug === animeSlug)) {
            favorites.push({
                animeSlug,
                animeTitle,
                poster,
                addedAt: Date.now()
            });
            Storage.set('favorites', favorites);
            return true;
        }
        return false;
    },
    
    remove: (animeSlug) => {
        const favorites = Storage.get('favorites', []);
        const newFavorites = favorites.filter(fav => fav.animeSlug !== animeSlug);
        Storage.set('favorites', newFavorites);
        return true;
    },
    
    getAll: () => {
        return Storage.get('favorites', []);
    },
    
    isFavorite: (animeSlug) => {
        const favorites = Storage.get('favorites', []);
        return favorites.some(fav => fav.animeSlug === animeSlug);
    }
};

// Export for use in other files
window.AnimeUKE = {
    loadJSON,
    getUrlParam,
    setUrlParam,
    showNotification,
    formatNumber,
    debounce,
    throttle,
    isInViewport,
    smoothScrollTo,
    Storage,
    WatchHistory,
    Favorites,
    version: '2.0.0'
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Add current page to visit history
    const visitHistory = Storage.get('visit_history', []);
    const currentPage = {
        url: window.location.href,
        title: document.title,
        visitedAt: Date.now(),
        timestamp: new Date().toLocaleString()
    };
    
    visitHistory.unshift(currentPage);
    Storage.set('visit_history', visitHistory.slice(0, 100));
    
    // Add anime-uke class to body for CSS targeting
    document.body.classList.add('anime-uke');
    
    console.log(`🎬 AnimeUKE v${window.AnimeUKE.version} initialized`);
});
