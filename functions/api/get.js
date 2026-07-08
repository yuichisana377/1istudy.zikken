
export async function onRequest({ env }) {
  const id = env.details.idFromName("main");
  const obj = env.details.get(id);
  return obj.fetch(new Request("http://dummy/get"));
}
export async function onRequestGet(context) {
  const id = context.env.details.idFromName("global");
  const stub = context.env.details.get(id);
  return stub.fetch(new Request("https://do/get"));
}
