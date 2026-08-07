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

/**
 * Trace support: Node-RED sends `x-request-id` with every push. We echo it back
 * in the JSON body (`rid`) and in the response header so the flow can correlate
 * "what was sent" with "what the cloud did with it".
 */
export function requestId(request: Request): string {
  const h = request.headers.get("x-request-id")?.trim();
  if (h && h.length > 0 && h.length <= 64) return h;
  return `srv-${randomBytes(6).toString("hex")}`;
}

/** Returns a jsonResponse variant that always carries the request id. */
export function tracedResponse(rid: string) {
  return (body: any, init: number | ResponseInit = 200): Response => {
    const opts: ResponseInit = typeof init === "number" ? { status: init } : init;
    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? { ...body, rid } : { data: body, rid };
    return jsonResponse(payload, {
      ...opts,
      headers: { "x-request-id": rid, ...(opts.headers || {}) },
    });
  };
}

