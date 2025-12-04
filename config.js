// config.js - Configurație simplă pentru Anime Uke
console.log('🔧 Loading Anime Uke Config...');

const JSONBIN_CONFIG = {
    // ÎNLOQUEȘTE CU DATELE TALE REALE:
    BIN_ID: "693177b4d0ea881f401260aa", // Bin ID-ul tău
    API_KEY: "$2a$10$chxy/E8m6jlMEUh7n7/qfuEDpFt.uv4AMZGCwfzju51RM.ApKwonO", // API Key-ul tău
    
    // URL-uri
    API_URL: "https://api.jsonbin.io/v3/b",
    
    // Useri default (folosiți dacă JSONBin nu merge)
    DEFAULT_USERS: [
        {
            id: 1,
            username: "admin",
            password: "admin123",
            email: "admin@animeuke.com",
            role: "admin",
            avatar: "A",
            created: "2024-12-01",
            lastLogin: new Date().toISOString()
        },
        {
            id: 2,
            username: "membru",
            password: "membru123", 
            email: "membru@animeuke.com",
            role: "membru",
            avatar: "M",
            created: "2024-12-01",
            lastLogin: new Date().toISOString()
        }
    ]
};

// Verifică config
if (!JSONBIN_CONFIG.BIN_ID || JSONBIN_CONFIG.BIN_ID === "693177b4d0ea881f401260aa") {
    console.log('✅ JSONBin Config loaded successfully');
} else {
    console.warn('⚠️ Please update BIN_ID with your actual ID');
}

// Salvează în localStorage pentru backup
try {
    localStorage.setItem('anime_uke_bin_id', JSONBIN_CONFIG.BIN_ID);
    localStorage.setItem('anime_uke_api_key', JSONBIN_CONFIG.API_KEY);
    console.log('📁 Config saved to localStorage');
} catch (e) {
    console.warn('⚠️ Could not save to localStorage:', e.message);
}
