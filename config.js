// config.js - CONFIGURARE JSONBIN
const JSONBIN_CONFIG = {
  BIN_ID: "693177b4d0ea881f401260aa", // Înlocuiește cu Bin ID-ul tău
  API_KEY: "$2a$10$chxy/E8m6jlMEUh7n7/qfuEDpFt.uv4AMZGCwfzju51RM.ApKwonO",    // Înlocuiește cu API Key-ul tău
  
  // Nu modifica restul
  API_URL: "https://api.jsonbin.io/v3/b",
  HEADERS: {
    'Content-Type': 'application/json',
    'X-Master-Key': "$2a$10$chxy/E8m6jlMEUh7n7/qfuEDpFt.uv4AMZGCwfzju51RM.ApKwonO" // Aici se pune același KEY
  }
};

// Salvează în localStorage pentru toate paginile
localStorage.setItem('jsonbin_id', JSONBIN_CONFIG.BIN_ID);
localStorage.setItem('jsonbin_key', JSONBIN_CONFIG.API_KEY);

console.log('✅ JSONBin config loaded');
