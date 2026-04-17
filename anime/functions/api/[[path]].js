export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Schimbă doar hostname-ul către Worker-ul tău API
  const apiUrl = `https://anime-uke-api.workers.dev${url.pathname}${url.search}`;

  // Proxy complet (păstrează metodă, headers, body, cookies etc.)
  const apiRequest = new Request(apiUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'follow'
  });

  try {
    const response = await fetch(apiRequest);
    
    // Copiază răspunsul înapoi (inclusiv status, headers)
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });

    return newResponse;
  } catch (err) {
    console.error("API proxy error:", err);
    return new Response(JSON.stringify({ error: "Internal proxy error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}
