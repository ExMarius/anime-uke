export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // Construiește URL-ul către Worker-ul tău API
  const apiUrl = `https://anime-uke-api.workers.dev${url.pathname}${url.search}`;
  
  // Proxy request-ul (păstrează method, headers, body etc.)
  const apiRequest = new Request(apiUrl, request);
  
  try {
    const response = await fetch(apiRequest);
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: "API proxy error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}
