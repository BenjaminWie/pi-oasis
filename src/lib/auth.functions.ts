import { createServerFn } from "@tanstack/react-start";

// PIN auth for the Pi-local dashboard. The PIN itself stays simple (single
// user device), but successful verification issues an HMAC-signed token that
// every protected server fn validates server-side via `requirePiAuth`.
const DEMO_PIN = process.env.PI_DASHBOARD_PIN || "1234";

export const verifyPin = createServerFn({ method: "POST" })
  .inputValidator((d: { pin: string; trust?: boolean }) => {
    if (typeof d.pin !== "string" || d.pin.length === 0 || d.pin.length > 32) {
      throw new Error("invalid pin");
    }
    return d;
  })
  .handler(async ({ data }) => {
    await new Promise((r) => setTimeout(r, 250));
    if (data.pin !== DEMO_PIN) return { ok: false as const };
    const { signPiToken } = await import("./pi-auth.server");
    const ttl = data.trust ? 60 * 60 * 24 * 30 : 60 * 60 * 24; // 30d vs 1d
    return { ok: true as const, token: signPiToken("device", ttl) };
  });
