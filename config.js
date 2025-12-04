// config.js - CONFIGURARE JSONBIN pentru Anime Uke
const JSONBIN_CONFIG = {
  BIN_ID: "693177b4d0ea881f401260aa",  // Bin ID-ul tău
  API_KEY: "$2a$10$chxy/E8m6jlMEUh7n7/qfuEDpFt.uv4AMZGCwfzju51RM.ApKwonO",  // API Key-ul tău
  
  // NU MODIFICA restul
  API_URL: "https://api.jsonbin.io/v3/b",
  
  get HEADERS() {
    return {
      'Content-Type': 'application/json',
      'X-Master-Key': this.API_KEY
    };
  }
};

// Salvează în localStorage pentru toate paginile
try {
  localStorage.setItem('jsonbin_id', JSONBIN_CONFIG.BIN_ID);
  localStorage.setItem('jsonbin_key', JSONBIN_CONFIG.API_KEY);
  console.log('✅ JSONBin config loaded successfully');
} catch (error) {
  console.warn('⚠️ Could not save to localStorage:', error);
}

// Export pentru module (dacă e nevoie)
if (typeof module !== 'undefined') {
  module.exports = JSONBIN_CONFIG;
}
