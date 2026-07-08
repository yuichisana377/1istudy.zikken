export async function onRequest({ env, request }) {
  const id = env.details.idFromName("main");
  const obj = env.details.get(id);
  return obj.fetch(new Request("http://dummy/set", {
    method: "POST",
    body: await request.text()
  }));
}

export async function onRequestPost(context) {
  const id = context.env.details.idFromName("global");
  const stub = context.env.details.get(id);
  const body = await context.request.text();
  return stub.fetch(new Request("https://do/set", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" }
  }));
}
