export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // Folosește direct service binding (mai rapid)
  const response = await env.API_WORKER.fetch(
    new Request(`https://dummy${url.pathname}${url.search}`, request)
  );
  
  return response;
}
