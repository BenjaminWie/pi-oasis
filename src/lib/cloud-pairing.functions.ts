import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePiAuth } from "./pi-auth-middleware";
import { z } from "zod";

// --- Pi-local: issue a single-use HMAC nonce that the cloud must echo back
// to /api/public/cloud-bridge/install to prove the user really clicked
// "pair with cloud" in *this* dashboard.

export const createPairingNonce = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) {
      return { ok: false as const, error: "Pairing only available on the Pi runtime" };
    }
    const { signPiToken } = await import("./pi-auth.server");
    // 10 minutes, distinct subject so it can't be reused as a session token
    const nonce = signPiToken("cloud-pair", 600);
    return { ok: true as const, nonce };
  });

// --- Cloud side: after the user signs into the cloud, mint a fresh
// device+token for the local host and hand it back to the Pi.

export const mintLocalPairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      hostname: z.string().min(1).max(128),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { randomBytes, createHash } = await import("node:crypto");
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");

    const { data: device, error } = await context.supabase
      .from("devices")
      .insert({
        user_id: context.userId,
        name: data.hostname,
        device_token_hash: hash,
      })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    return { deviceId: device.id, deviceToken: token, name: device.name };
  });
