// Ruta separată există doar pentru routerul explicit: ambele endpoint-uri
// folosesc aceeași implementare de recuperare, dar router.js caută mereu
// exportul standard `onRequestPost`.
export { onRequestPostConfirm as onRequestPost } from './password-reset.js';
