import { timingSafeEqual } from "node:crypto";

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Secret",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(res, status, body) {
  res.statusCode = status;
  for (const [key, value] of Object.entries(corsHeaders())) {
    res.setHeader(key, value);
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    for (const [key, value] of Object.entries(corsHeaders())) {
      res.setHeader(key, value);
    }
    res.end();
    return true;
  }
  return false;
}

export function readJsonBody(req, limit = 4_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function authorizeSync(req) {
  const expected = process.env.SYNC_SECRET;
  if (!expected) {
    return { ok: false, status: 503, error: "SYNC_SECRET is not configured" };
  }
  const got = String(req.headers["x-sync-secret"] ?? "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}
