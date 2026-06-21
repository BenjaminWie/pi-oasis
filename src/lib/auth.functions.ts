import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "./pi-auth-middleware";

// PIN auth for the Pi-local dashboard. PIN is stored as a scrypt hash in
// ~/.pi-hub/state.json (created on first call). Successful verification
// issues an HMAC-signed token validated by `requirePiAuth`.

export const verifyPin = createServerFn({ method: "POST" })
  .inputValidator((d: { pin: string; trust?: boolean; label?: string }) => {
    if (typeof d.pin !== "string" || d.pin.length === 0 || d.pin.length > 32) {
      throw new Error("invalid pin");
    }
    return d;
  })
  .handler(async ({ data }) => {
    await new Promise((r) => setTimeout(r, 200));
    const { hasProcStats } = await import("./pi-runtime.server");
    let ok = false;
    if (hasProcStats()) {
      const { verifyPinValue, recordTrustedDevice } = await import("./pin-store.server");
      ok = await verifyPinValue(data.pin);
      if (ok && data.trust) {
        await recordTrustedDevice(data.label || "Browser");
      }
    } else {
      // Cloudflare Worker / non-Pi: fall back to env-PIN demo
      ok = data.pin === (process.env.PI_DASHBOARD_PIN || "1234");
    }
    if (!ok) return { ok: false as const };
    const { signPiToken } = await import("./pi-auth.server");
    const ttl = data.trust ? 60 * 60 * 24 * 30 : 60 * 60 * 24;
    return { ok: true as const, token: signPiToken("device", ttl) };
  });

export const changePin = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: { currentPin: string; newPin: string }) => {
    if (typeof d.newPin !== "string" || !/^\d{4,8}$/.test(d.newPin)) {
      throw new Error("PIN muss 4–8 Ziffern sein");
    }
    return d;
  })
  .handler(async ({ data }) => {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) {
      return { ok: false as const, error: "PIN-Änderung nur auf dem Pi möglich" };
    }
    const { verifyPinValue, setPinValue } = await import("./pin-store.server");
    if (!(await verifyPinValue(data.currentPin))) {
      return { ok: false as const, error: "Aktuelle PIN falsch" };
    }
    await setPinValue(data.newPin);
    return { ok: true as const };
  });

export const resetPinWithFactoryToken = createServerFn({ method: "POST" })
  .inputValidator((d: { factoryToken: string; newPin: string }) => {
    if (!/^\d{4,8}$/.test(d.newPin)) throw new Error("PIN muss 4–8 Ziffern sein");
    if (typeof d.factoryToken !== "string" || d.factoryToken.length < 16) {
      throw new Error("Factory-Token ungültig");
    }
    return d;
  })
  .handler(async ({ data }) => {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) return { ok: false as const, error: "Reset nur auf dem Pi möglich" };
    const { verifyFactoryToken, setPinValue } = await import("./pin-store.server");
    if (!(await verifyFactoryToken(data.factoryToken))) {
      return { ok: false as const, error: "Factory-Token falsch" };
    }
    await setPinValue(data.newPin);
    return { ok: true as const };
  });
