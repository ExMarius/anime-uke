export async function onRequest(context) {
  const { request, env } = context;
  
  // Citește token-ul din cookie
  const cookie = request.headers.get('Cookie') || '';
  const tokenMatch = cookie.match(/token=([^;]+)/);
  
  if (!tokenMatch) {
    return new Response(JSON.stringify({ error: 'Neautorizat' }), { status: 401 });
  }
  
  // Aici ar trebui să cauți utilizatorul asociat token-ului
  // Varianta simplă: token-ul = userId (dar nu e sigur)
  // Revii la mine după ce testezi și îți fac versiunea completă
  
  return new Response(JSON.stringify({ message: 'Funcționează' }));
}
