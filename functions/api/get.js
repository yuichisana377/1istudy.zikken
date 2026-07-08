
export async function onRequest({ env }) {
  const id = env.details.idFromName("main");
  const obj = env.details.get(id);
  return obj.fetch(new Request("http://dummy/get"));
}
