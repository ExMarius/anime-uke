export async function onRequest() {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/'
    }
  });
}
