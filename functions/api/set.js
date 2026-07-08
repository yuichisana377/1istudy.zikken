export async function onRequest({ env, request }) {
  const id = env.details.idFromName("main");
  const obj = env.details.get(id);
  return obj.fetch(new Request("http://dummy/set", {
    method: "POST",
    body: await request.text()
  }));
}

