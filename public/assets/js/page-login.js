import { renderNav } from './core.js';
import { initAuthForm } from './auth.js';
initAuthForm('login');

renderNav('/login').catch(() => { /* nav e decorativ aici */ });
