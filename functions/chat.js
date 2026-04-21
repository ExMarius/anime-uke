export async function onRequest(context) {
  const { request, env } = context;
  const id = env.CHAT.idFromName("global-chat");
  const stub = env.CHAT.get(id);
  return stub.fetch(request);
}
