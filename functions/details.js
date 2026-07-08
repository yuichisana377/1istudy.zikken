
export class details {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/get")) {
      const data = await this.state.storage.get("data");
      return new Response(JSON.stringify(data || {}), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname.endsWith("/set")) {
      const body = await request.json();
      await this.state.storage.put("data", body);
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }
}
