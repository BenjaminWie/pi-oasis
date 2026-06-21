// Server-only HMAC token for the Pi-local dashboard.
// Token format: `${sub}.${exp}.${nonce}.${hexHmacSha256}`.
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const SECRET =
  process.env.PI_DASHBOARD_SECRET ||
  // dev-only fallback — production MUST set PI_DASHBOARD_SECRET
  "dev-insecure-pi-dashboard-secret-change-me";

const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 days

export function signPiToken(sub = "device", ttlSec = DEFAULT_TTL) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const nonce = randomBytes(8).toString("hex");
  const base = `${sub}.${exp}.${nonce}`;
  const sig = createHmac("sha256", SECRET).update(base).digest("hex");
  return `${base}.${sig}`;
}

export function verifyPiToken(token: string | null | undefined): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [sub, expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = createHmac("sha256", SECRET)
    .update(`${sub}.${expStr}.${nonce}`)
    .digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
