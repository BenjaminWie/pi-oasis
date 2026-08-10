// Shared guard for Pi-local ingest endpoints: require PI_INGEST_TOKEN when it
// is set, otherwise only accept callers from localhost / the private LAN.
import { bearer } from "./agent-api.server";

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

/** Returns null when allowed, otherwise a reason string. */
export function guardLocalIngest(request: Request): "unauthorized" | "local ingest only" | null {
  const expected = process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN || "";
  if (expected) return bearer(request) === expected ? null : "unauthorized";
  return isLocalCaller(request) ? null : "local ingest only";
}
