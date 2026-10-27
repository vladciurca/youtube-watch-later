// Test-only resolver: api/sync.js loads storage through @vercel/blob. Point that
// import at an in-memory stub so the real handler can be exercised without a
// network or a token that talks to production.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@vercel/blob") {
    return {
      shortCircuit: true,
      url: new URL("./blob-memory-stub.mjs", import.meta.url).href,
    };
  }
  return nextResolve(specifier, context);
}
