// Shared crypto + helpers for agent API routes
import { createHash, randomBytes } from "crypto";

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function newDeviceToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export function jsonResponse(body: any, init: number | ResponseInit = 200): Response {
  const opts: ResponseInit = typeof init === "number" ? { status: init } : init;
  return new Response(JSON.stringify(body), {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

export function bearer(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7);
}
