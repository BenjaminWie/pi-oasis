// Shared guard for Pi-local ingest endpoints.
//
// Order of checks:
//  1. PI_INGEST_TOKEN (static bearer for Node-RED) — if set it must match, OR
//  2. a valid HMAC-signed Pi dashboard token (same secret as the UI session), OR
//  3. no token configured at all → only localhost / private LAN callers.
//
// Once the Pi is published through a Cloudflare Tunnel (PI_HUB_PUBLIC_URL set)
// the LAN fallback is disabled: a token is then mandatory on every request.
import { bearer } from "./agent-api.server";
import { verifyPiToken } from "./pi-auth.server";

function isPrivateHost(host: string | null) {
  const h = (host ?? "").split(":")[0];
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.startsWith("192.168.") ||
    h.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function isLocalCaller(request: Request) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null;
  return isPrivateHost(request.headers.get("host")) || isPrivateHost(ip);
}

/** True when this Pi is reachable from the internet through a tunnel. */
export function isPubliclyExposed() {
  return Boolean(process.env.PI_HUB_PUBLIC_URL || process.env.PI_HUB_TUNNEL === "1");
}

/** Returns null when allowed, otherwise a reason string. */
export function guardLocalIngest(request: Request): "unauthorized" | "local ingest only" | null {
  const token = bearer(request);
  const expected = process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN || "";

  if (expected && token === expected) return null;
  if (token && verifyPiToken(token)) return null;
  if (expected || token) return "unauthorized";

  // No credentials at all: LAN-only, and never when exposed through a tunnel.
  if (isPubliclyExposed()) return "unauthorized";
  return isLocalCaller(request) ? null : "local ingest only";
}
