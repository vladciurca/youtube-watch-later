function memory() {
  if (!globalThis.__wlBlob) globalThis.__wlBlob = { store: {}, puts: [] };
  return globalThis.__wlBlob;
}

export async function get(pathname) {
  const raw = memory().store[pathname];
  if (raw == null) return null;
  return { statusCode: 200, stream: new Blob([raw]).stream() };
}

export async function put(pathname, body) {
  let text;
  if (typeof body === "string") text = body;
  else if (body instanceof Uint8Array) text = new TextDecoder().decode(body);
  else text = await new Response(body).text();
  const slot = memory();
  slot.store[pathname] = text;
  slot.puts.push(pathname);
  return { pathname, url: `https://example.invalid/${pathname}` };
}

export async function list() {
  return {
    blobs: Object.keys(memory().store).map((pathname) => ({ pathname })),
  };
}
