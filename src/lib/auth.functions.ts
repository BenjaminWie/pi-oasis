import { createServerFn } from "@tanstack/react-start";

// Mock PIN auth. On the Pi this is replaced with:
//   - bcrypt-compared hash from ~/.pi-dashboard/db.sqlite
//   - signed device JWT set as httpOnly cookie
//   - rate-limit with progressive lockout
const DEMO_PIN = "1234";

export const verifyPin = createServerFn({ method: "POST" })
  .inputValidator((d: { pin: string; trust?: boolean }) => d)
  .handler(async ({ data }) => {
    await new Promise((r) => setTimeout(r, 250));
    if (data.pin !== DEMO_PIN) return { ok: false as const };
    return { ok: true as const, token: "demo-device-token" };
  });
