export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    
    // Forward to Worker
    const workerUrl = `https://anime-uke-api.marius7like7.workers.dev${url.pathname}${url.search}`;
    
    const response = await fetch(workerUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body
    });
    
    return response;
}
